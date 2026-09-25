import { Injectable, InjectionToken, inject } from '@angular/core';
import { Player } from '../../models/player.model';
import { Team } from '../../models/team.model';
import { KitDesign } from '../../models/visual.model';
import { createPixelRamp, kitVisualSignature } from '../kit-visuals';

export const PORTRAIT_RENDERER_LOADER = new InjectionToken<() => Promise<typeof import('../../features/match/footballer-portrait')>>('Portrait renderer loader', {
  providedIn: 'root', factory: () => () => import('../../features/match/footballer-portrait'),
});

@Injectable({ providedIn: 'root' })
export class PortraitService {
  private readonly loadRenderer = inject(PORTRAIT_RENDERER_LOADER);
  private readonly cache = new Map<string, string>();

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
        return kitSilhouetteUri(kit, player.kitNumber, full);
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
  }
}

/** Lightweight static fallback when WebGL portraits are unavailable. */
export function kitSilhouetteUri(kit: KitDesign, number: number, full: boolean): string {
  const shirt = createPixelRamp(kit.shirt), shorts = createPixelRamp(kit.shorts);
  const body = full
    ? `<rect x="26" y="96" width="12" height="26" fill="${kit.socks}"/><rect x="58" y="96" width="12" height="26" fill="${kit.socks}"/>`
      + `<rect x="24" y="74" width="48" height="24" fill="${shorts.base}" stroke="${shorts.outline}" stroke-width="2"/>`
    : '';
  const height = full ? 128 : 96;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 ${height}">`
    + `<circle cx="48" cy="22" r="15" fill="#c9a27e" stroke="${shirt.outline}" stroke-width="2"/>`
    + `<path d="M18 44 L34 36 L62 36 L78 44 L78 ${full ? 76 : 96} L18 ${full ? 76 : 96} Z" fill="${shirt.base}" stroke="${shirt.outline}" stroke-width="2"/>`
    + `<rect x="18" y="44" width="60" height="6" fill="${shirt.highlight}" opacity=".45"/>`
    + `<text x="48" y="${full ? 66 : 74}" font-family="monospace" font-size="18" font-weight="700" text-anchor="middle" fill="${kit.number}">${Math.max(0, Math.round(number))}</text>`
    + body + '</svg>';
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function neutralKit(): KitDesign {
  return {
    pattern: 'chest-band', shirt: '#37415f', secondary: '#151a2c', trim: '#d7e1ff',
    shorts: '#151a2c', socks: '#37415f', number: '#f4f4df', collar: 'crew', sleeve: 'cuff',
  };
}
