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

  async portrait(player: Player, team?: Team): Promise<string> {
    const kit = team?.visuals.kits.home ?? neutralKit();
    const key = `portrait-v3|${player.id}|${player.visuals.seed}|${kitVisualSignature(kit)}`;
    const cached = this.cache.get(key);
    if (cached) return cached;
    const sprite = this.sprites.getPortrait(player, kit);
    const uri = renderDataUri(sprite, 48, 48);
    this.cache.set(key, uri);
    return uri;
  }

  async figure(player: Player, kit: KitDesign): Promise<string> {
    const key = `figure-v3|${player.id}|${player.visuals.seed}|${kitVisualSignature(kit)}`;
    const cached = this.cache.get(key);
    if (cached) return cached;
    const sprite = this.sprites.getStandalone(player, kit, 'idle', 1, 2);
    const uri = renderDataUri(sprite, PLAYER_SPRITE_WIDTH, PLAYER_SPRITE_HEIGHT);
    this.cache.set(key, uri);
    return uri;
  }

  clear(): void {
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
