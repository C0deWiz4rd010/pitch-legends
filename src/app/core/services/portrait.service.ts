import { Injectable, InjectionToken, inject } from '@angular/core';
import { Player } from '../../models/player.model';
import { Team } from '../../models/team.model';
import { KitDesign } from '../../models/visual.model';
import { kitVisualSignature } from '../kit-visuals';
import { PlayerSpriteFactory, PLAYER_SPRITE_HEIGHT, PLAYER_SPRITE_WIDTH } from '../../features/match/player-sprite.factory';

export const PORTRAIT_RENDERER_LOADER = new InjectionToken<() => Promise<typeof import('../../features/match/footballer-portrait')>>('Portrait renderer loader', {
  providedIn: 'root', factory: () => () => import('../../features/match/footballer-portrait'),
});

@Injectable({ providedIn: 'root' })
export class PortraitService {
  private readonly loadRenderer = inject(PORTRAIT_RENDERER_LOADER);
  private readonly cache = new Map<string, string>();
  private readonly sprites = new PlayerSpriteFactory();

  private readonly inFlight = new Map<string, { promise: Promise<string>; consumers: (() => boolean)[] }>();
  private epoch = 0;

  portrait(player: Player, team?: Team, signal?: AbortSignal): Promise<string> {
    const kit = (player.positionGroup === 'GK' ? team?.visuals.kits.goalkeeper : team?.visuals.kits.home) ?? neutralKit();
    return this.image(player, kit, false, signal);
  }

  figure(player: Player, kit: KitDesign, signal?: AbortSignal): Promise<string> {
    return this.image(player, kit, true, signal);
  }

  /** Finish/cancel menu work and release its context before preparing the pitch. */
  async releaseGraphics(): Promise<void> {
    await Promise.all([...this.inFlight.values()].map(job => job.promise));
    const module = await this.loadRenderer();
    module.disposePortraitRenderer();
  }

  private image(player: Player, kit: KitDesign, full: boolean, signal?: AbortSignal): Promise<string> {
    if (signal?.aborted) return Promise.resolve('');
    const key = `three-v1|${full}|${player.id}|${JSON.stringify(player.visuals)}|${player.kitNumber}|${kitVisualSignature(kit)}`;
    const cached = this.cache.get(key);
    if (cached) return Promise.resolve(cached);
    const active = this.inFlight.get(key);
    if (active) { active.consumers.push(() => !signal?.aborted); return active.promise; }
    const epoch = this.epoch;
    const consumers = [() => !signal?.aborted];
    const needed = () => epoch === this.epoch && consumers.some(consumer => consumer());
    const job = this.loadRenderer()
      .then(module => needed() ? module.footballerPortrait(player, kit, full, needed) : '')
      .catch(() => {
        if (!needed()) return '';
        const sprite = full ? this.sprites.getStandalone(player, kit, 'idle', 1, 2) : this.sprites.getPortrait(player, kit);
        return renderDataUri(sprite, full ? PLAYER_SPRITE_WIDTH : 48, full ? PLAYER_SPRITE_HEIGHT : 48);
      }).then(uri => {
        if (epoch === this.epoch) {
          if (uri) {
            if (this.cache.size >= 256) this.cache.delete(this.cache.keys().next().value!);
            this.cache.set(key, uri);
          }
          this.inFlight.delete(key);
        }
        return uri;
      });
    this.inFlight.set(key, { promise: job, consumers });
    return job;
  }

  clear(): void {
    this.epoch++;
    this.inFlight.clear();
    this.cache.clear();
    this.sprites.destroy();
  }
}

function renderDataUri(source: CanvasImageSource, width: number, height: number, crop?: { sx: number; sy: number; sw: number; sh: number }): string {
  if (typeof document === 'undefined') return '';
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';
  ctx.imageSmoothingEnabled = false;
  if (crop) ctx.drawImage(source, crop.sx, crop.sy, crop.sw, crop.sh, 0, 0, width, height);
  else ctx.drawImage(source, 0, 0, width, height);
  return canvas.toDataURL('image/png');
}

function neutralKit(): KitDesign {
  return {
    pattern: 'chest-band', shirt: '#37415f', secondary: '#151a2c', trim: '#d7e1ff',
    shorts: '#151a2c', socks: '#37415f', number: '#f4f4df', collar: 'crew', sleeve: 'cuff',
  };
}
