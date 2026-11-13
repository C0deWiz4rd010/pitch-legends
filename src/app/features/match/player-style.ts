import { PlayerVisualIdentity } from '../../models/visual.model';
import { hash32 } from '../../core/visual-identity';

/**
 * The look a player puts together for himself: how he wears his kit and what he adds to it. Every trait is drawn from the
 * player's visual seed, so the same player always looks the same and no save data is needed; traits combine freely, which
 * is where the variety comes from.
 */
export interface PlayerStyle {
  /** Silhouette: shoulders, chest and thighs relative to the build. */
  frame: 'lean' | 'balanced' | 'powerful' | 'compact';
  shirt: 'tucked' | 'loose';
  /** A base layer under a short-sleeved shirt, in black, white or the trim colour. */
  baseLayer: 'none' | 'black' | 'white' | 'trim';
  socks: 'high' | 'low' | 'over-knee';
  ankleTape: boolean;
  /** Compression shorts showing below the hem. */
  underShorts: boolean;
  wrist: 'none' | 'sweatband' | 'double-sweatband';
  gloves: boolean;
  snood: boolean;
  face: 'none' | 'goggles' | 'nose-strip' | 'eye-black';
  earring: boolean;
  thighTape: 'none' | 'left' | 'right';
  boots: 'classic' | 'stripes' | 'two-tone' | 'neon-sole' | 'collar';
  /** Accent colour of tape, boots and bands. */
  accent: string;
}

const ACCENTS = ['#f6f1df', '#101820', '#f5d042', '#ff5a5f', '#4be3c1', '#7b6cff', '#ff9f1c', '#e6edf3'];

/** Draws `value` from the weights: a list of [value, weight]. */
function pick<T>(roll: number, options: readonly (readonly [T, number])[]): T {
  const total = options.reduce((sum, option) => sum + option[1], 0);
  let at = roll % total;
  for (const [value, weight] of options) { if (at < weight) return value; at -= weight; }
  return options[0][0];
}

export function createPlayerStyle(identity: PlayerVisualIdentity): PlayerStyle {
  const roll = (trait: string) => hash32(`${identity.seed}|style-v1|${trait}`);
  const build = identity.bodyBuild;
  return {
    frame: build === 'strong' ? pick(roll('frame'), [['powerful', 6], ['compact', 3], ['balanced', 1]] as const)
      : build === 'slim' ? pick(roll('frame'), [['lean', 7], ['balanced', 3]] as const)
      : pick(roll('frame'), [['balanced', 6], ['lean', 2], ['powerful', 1], ['compact', 1]] as const),
    shirt: pick(roll('shirt'), [['tucked', 6], ['loose', 4]] as const),
    baseLayer: identity.longSleeves ? 'none' : pick(roll('base'), [['none', 15], ['black', 2], ['white', 2], ['trim', 1]] as const),
    socks: pick(roll('socks'), [['high', 7], ['low', 2], ['over-knee', 1]] as const),
    ankleTape: roll('ankle') % 4 === 0,
    underShorts: roll('under') % 5 === 0,
    wrist: identity.wristTape !== 'none' ? 'none' : pick(roll('wrist'), [['none', 7], ['sweatband', 2], ['double-sweatband', 1]] as const),
    gloves: roll('gloves') % 14 === 0,
    snood: roll('snood') % 19 === 0,
    face: pick(roll('face'), [['none', 26], ['goggles', 1], ['nose-strip', 2], ['eye-black', 2]] as const),
    earring: roll('ear') % 7 === 0,
    thighTape: pick(roll('tape'), [['none', 12], ['left', 1], ['right', 1]] as const),
    boots: pick(roll('boots') + identity.bootStyle, [['classic', 3], ['stripes', 3], ['two-tone', 2], ['neon-sole', 2], ['collar', 2]] as const),
    accent: ACCENTS[roll('accent') % ACCENTS.length],
  };
}

/** Short labels of what a player wears, for the studio card. */
export function styleTraits(style: PlayerStyle): { de: string; en: string }[] {
  const traits: { de: string; en: string }[] = [];
  const add = (de: string, en: string) => traits.push({ de, en });
  if (style.shirt === 'loose') add('Trikot über der Hose', 'Shirt untucked');
  if (style.baseLayer !== 'none') add('Unterziehshirt', 'Base layer');
  if (style.socks === 'low') add('Stutzen unten', 'Socks rolled down');
  if (style.socks === 'over-knee') add('Stutzen übers Knie', 'Socks over the knee');
  if (style.ankleTape) add('Knöcheltape', 'Ankle tape');
  if (style.underShorts) add('Radlerhose', 'Compression shorts');
  if (style.wrist !== 'none') add('Schweißband', 'Sweatband');
  if (style.gloves) add('Handschuhe', 'Gloves');
  if (style.snood) add('Halswärmer', 'Snood');
  if (style.face === 'goggles') add('Sportbrille', 'Sports goggles');
  if (style.face === 'nose-strip') add('Nasenpflaster', 'Nose strip');
  if (style.face === 'eye-black') add('Schwarze Balken', 'Eye black');
  if (style.earring) add('Ohrstecker', 'Ear stud');
  if (style.thighTape !== 'none') add('Kinesio-Tape', 'Kinesio tape');
  if (style.boots === 'neon-sole') add('Neon-Sohle', 'Neon soleplate');
  if (style.boots === 'collar') add('Sockenschuh', 'Collar boots');
  if (style.boots === 'two-tone') add('Zweifarbige Schuhe', 'Two-tone boots');
  return traits;
}
