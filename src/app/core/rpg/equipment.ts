import { EffectSpec } from './effects';
import { scaleEffect } from './signatures';
import { Player } from '../../models/player.model';
import { COSMETICS } from '../meta/legend-path';

/**
 * Boots with a trade-off. The type decides what a player gains and what he gives up; the tier (from the club's
 * supplier contract) only sharpens the gain, never the loss. The look is a free choice that does nothing: a
 * handsome pair of boots is never better than a plain one. Everything runs through the effect pipeline, so the
 * caps in `EFFECT_CAPS` bound any combination with traits, talents and signatures.
 */
export type BootType = 'balanced' | 'speed' | 'control' | 'power' | 'grip';
export type SupplierTier = 1 | 2 | 3;

export interface EquipmentState {
  boot: BootType;
  /** Colourway id (see `BOOT_LOOKS`); purely cosmetic. */
  look: string;
  /** Supplier tier of the club when the boots were last synchronised; 1 when absent. */
  tier?: SupplierTier;
}

export interface BootDef {
  id: BootType;
  name: [string, string];
  gain: [string, string];
  loss: [string, string];
  /** Effects at tier 2 (factor 1); scaled by the tier factor. */
  bonus: EffectSpec[];
  /** Effects that never scale. */
  penalty: EffectSpec[];
}

export const BOOT_TYPES: BootDef[] = [
  {
    id: 'balanced',
    name: ['Allround', 'All-round'],
    gain: ['Keine Stärke', 'No strength'],
    loss: ['Keine Schwäche', 'No weakness'],
    bonus: [],
    penalty: [],
  },
  {
    id: 'speed',
    name: ['Speed', 'Speed'],
    gain: ['Besserer Antritt und Sprint', 'Better burst and sprint'],
    loss: ['Schlechtere Ballmitnahme', 'Poorer first touch'],
    bonus: [
      { hook: 'acceleration', op: 'mul', value: 1.05 },
      { hook: 'sprintBurst', op: 'mul', value: 1.02 },
    ],
    penalty: [{ hook: 'firstTouch', op: 'add', value: -3 }],
  },
  {
    id: 'control',
    name: ['Kontrolle', 'Control'],
    gain: ['Bessere Ballmitnahme', 'Better first touch'],
    loss: ['Langsamerer Antritt', 'Slower burst'],
    bonus: [{ hook: 'firstTouch', op: 'add', value: 4 }],
    penalty: [{ hook: 'acceleration', op: 'mul', value: 0.96 }],
  },
  {
    id: 'power',
    name: ['Power', 'Power'],
    gain: ['Härtere Schüsse', 'Harder shots'],
    loss: ['Ungenauere Pässe', 'Looser passing'],
    bonus: [{ hook: 'shotPower', op: 'add', value: 0.8 }],
    penalty: [{ hook: 'passError', op: 'mul', value: 1.06 }],
  },
  {
    id: 'grip',
    name: ['Grip', 'Grip'],
    gain: ['Mehr Zweikampfglück', 'Better in the tackle'],
    loss: ['Etwas weniger Spitzentempo', 'A little less top speed'],
    bonus: [{ hook: 'tackleWin', op: 'add', value: 0.015 }],
    penalty: [{ hook: 'sprintBurst', op: 'mul', value: 0.98 }],
  },
];

/** Colourways with no effect at all. */
export const BOOT_LOOKS: { id: string; name: [string, string]; color: string }[] = [
  { id: 'classic', name: ['Klassisch Schwarz', 'Classic black'], color: '#1c1c22' },
  { id: 'neon', name: ['Neongrün', 'Neon green'], color: '#7dff3c' },
  { id: 'carbon', name: ['Carbon', 'Carbon'], color: '#4a5560' },
  { id: 'gold', name: ['Gold', 'Gold'], color: '#ffc83d' },
  { id: 'sunset', name: ['Abendrot', 'Sunset'], color: '#ff6a3d' },
  { id: 'ice', name: ['Eisblau', 'Ice blue'], color: '#52d1ff' },
  // The rest are rewards of the Legends Path (core/meta/legend-path.ts): open from the level that gives them.
  ...COSMETICS.filter((cosmetic) => cosmetic.slot === 'boots').map((cosmetic) => ({
    id: cosmetic.id,
    name: cosmetic.name,
    color: cosmetic.value,
  })),
];

/** What the supplier tier does to the gain of the boots: the cheap deal is a little weaker, the premium one a little stronger. */
export const TIER_FACTOR: Record<SupplierTier, number> = { 1: 0.8, 2: 1, 3: 1.2 };

export function bootDef(boot: BootType | undefined): BootDef {
  return BOOT_TYPES.find((candidate) => candidate.id === boot) ?? BOOT_TYPES[0];
}

export function defaultEquipment(): EquipmentState {
  return { boot: 'balanced', look: 'classic', tier: 1 };
}

export function ensureEquipment(player: Player): EquipmentState {
  return (player.equipment ??= defaultEquipment());
}

/** The modifiers the boots give a player: the gain scaled by the tier, the loss as written. */
export function equipmentEffects(equipment: EquipmentState | undefined): EffectSpec[] {
  if (!equipment || equipment.boot === 'balanced') return [];
  const def = bootDef(equipment.boot);
  const factor = TIER_FACTOR[equipment.tier ?? 1] ?? 1;
  return [...def.bonus.map((effect) => scaleEffect(effect, factor)), ...def.penalty];
}

export function setBoot(player: Player, boot: BootType): boolean {
  if (!BOOT_TYPES.some((candidate) => candidate.id === boot)) return false;
  ensureEquipment(player).boot = boot;
  return true;
}

/** The look changes nothing but the colour: a separate function so the effect path never sees it. */
export function setLook(player: Player, look: string): boolean {
  if (!BOOT_LOOKS.some((candidate) => candidate.id === look)) return false;
  ensureEquipment(player).look = look;
  return true;
}
