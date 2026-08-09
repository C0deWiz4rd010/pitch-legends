import { Injectable } from '@angular/core';
import { Player } from '../../models/player.model';
import { Team } from '../../models/team.model';

const SKIN_COLORS = ['ffdbac', 'f5cfa0', 'eac393', 'e0b687', 'cb9e6e', 'b68655', 'a26d3d', '8d5524'];
const HAIR_COLORS = ['cab188', '603a14', '83623b', '611c17', '28150a', '009bbd', 'bd1700', '91cb15'];

@Injectable({ providedIn: 'root' })
export class PortraitService {
  private readonly cache = new Map<string, string>();
  private stylePromise?: Promise<unknown>;

  async portrait(player: Player, team?: Team): Promise<string> {
    const key = `${player.id}|${team?.visuals.seed ?? 'free'}|${player.visuals.seed}`;
    const cached = this.cache.get(key);
    if (cached) return cached;
    const [{ Avatar }, style] = await Promise.all([import('@dicebear/core'), this.loadStyle()]);
    const visual = player.visuals;
    const home = team?.visuals.kits.home;
    const options = {
      seed: [visual.portraitSeed],
      backgroundColor: [stripHash(home?.secondary ?? '#172144')],
      clothingColor: [stripHash(home?.shirt ?? '#37d8ff')],
      skinColor: [SKIN_COLORS[visual.skinTone % SKIN_COLORS.length]],
      hairColor: [HAIR_COLORS[visual.hairColor % HAIR_COLORS.length]],
      hair: [`short${String(visual.hairStyle % 18 + 1).padStart(2, '0')}`],
      beardProbability: [visual.facialHair === 0 ? 0 : 100],
      beard: [`variant${String(Math.max(1, visual.facialHair)).padStart(2, '0')}`],
      glassesProbability: [0],
      hatProbability: [0],
      size: 96,
      scale: 94,
    } as never;
    const avatar = new Avatar(style as never, options);
    const uri = avatar.toDataUri();
    this.cache.set(key, uri);
    return uri;
  }

  clear(): void {
    this.cache.clear();
  }

  private loadStyle(): Promise<unknown> {
    this.stylePromise ??= Promise.all([import('@dicebear/core'), import('@dicebear/styles/pixel-art.json')])
      .then(([{ Style }, definition]) => new Style(definition.default as never));
    return this.stylePromise;
  }
}

function stripHash(color: string): string {
  return color.replace('#', '');
}
