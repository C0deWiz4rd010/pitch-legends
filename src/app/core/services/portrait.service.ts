import { Injectable } from '@angular/core';
import { Player } from '../../models/player.model';
import { Team } from '../../models/team.model';
import { KitDesign } from '../../models/visual.model';
import { kitVisualSignature } from '../kit-visuals';
import { PlayerSpriteFactory, PLAYER_SPRITE_HEIGHT, PLAYER_SPRITE_WIDTH } from '../../features/match/player-sprite.factory';

@Injectable({ providedIn: 'root' })
export class PortraitService {
  private readonly cache = new Map<string, string>();
  private readonly sprites = new PlayerSpriteFactory();

  private readonly inFlight = new Map<string, Promise<string>>();
  private epoch = 0;

  portrait(player: Player, team?: Team): Promise<string> {
    const kit = (player.positionGroup === 'GK' ? team?.visuals.kits.goalkeeper : team?.visuals.kits.home) ?? neutralKit();
    return this.image(player, kit, false);
  }

  figure(player: Player, kit: KitDesign): Promise<string> {
    return this.image(player, kit, true);
  }

  private image(player: Player, kit: KitDesign, full: boolean): Promise<string> {
    const key = `three-v1|${full}|${player.id}|${JSON.stringify(player.visuals)}|${player.kitNumber}|${kitVisualSignature(kit)}`;
    const cached = this.cache.get(key);
    if (cached) return Promise.resolve(cached);
    const active = this.inFlight.get(key);
    if (active) return active;
    const epoch = this.epoch;
    const job = import('../../features/match/footballer-portrait')
      .then(module => module.footballerPortrait(player, kit, full))
      .catch(() => {
        const sprite = full ? this.sprites.getStandalone(player, kit, 'idle', 1, 2) : this.sprites.getPortrait(player, kit);
        return renderDataUri(sprite, full ? PLAYER_SPRITE_WIDTH : 48, full ? PLAYER_SPRITE_HEIGHT : 48);
      }).then(uri => {
        if (epoch === this.epoch) {
          if (this.cache.size >= 256) this.cache.delete(this.cache.keys().next().value!);
          this.cache.set(key, uri);
          this.inFlight.delete(key);
        }
        return uri;
      });
    this.inFlight.set(key, job);
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
