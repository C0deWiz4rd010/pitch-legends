import { AttributeKey } from '../../models/enums';

/** Derived values the match engine asks the pipeline about, besides the eight attributes. */
export type DerivedHook =
  | 'shotError' | 'shotPower' | 'curve' | 'passError' | 'throughLead' | 'firstTouch'
  | 'acceleration' | 'sprintBurst' | 'tackleWin' | 'pressTackle' | 'shielding' | 'aerial'
  | 'keeperReaction' | 'keeperReach' | 'staminaDrain' | 'staminaRecovery' | 'composure'
  | 'xpGain' | 'injuryRisk' | 'growthChance';

export type EffectHook = AttributeKey | DerivedHook;

const DERIVED_HOOKS: DerivedHook[] = [
  'shotError', 'shotPower', 'curve', 'passError', 'throughLead', 'firstTouch', 'acceleration', 'sprintBurst', 'tackleWin', 'pressTackle',
  'shielding', 'aerial', 'keeperReaction', 'keeperReach', 'staminaDrain', 'staminaRecovery', 'composure', 'xpGain', 'injuryRisk', 'growthChance',
];

export const HOOK_COUNT = DERIVED_HOOKS.length;

/** Numeric ids of the derived hooks as a plain literal, so engine calls are cheap array lookups. */
export const HK = {
  shotError: 0, shotPower: 1, curve: 2, passError: 3, throughLead: 4, firstTouch: 5, acceleration: 6, sprintBurst: 7, tackleWin: 8, pressTackle: 9,
  shielding: 10, aerial: 11, keeperReaction: 12, keeperReach: 13, staminaDrain: 14, staminaRecovery: 15, composure: 16, xpGain: 17, injuryRisk: 18, growthChance: 19,
} as const;

export function hookName(index: number): DerivedHook {
  return DERIVED_HOOKS[index];
}
export const HOOK_INDEX = Object.fromEntries(DERIVED_HOOKS.map((hook, index) => [hook, index])) as Record<DerivedHook, number>;

/** One bit per derived hook: lets the engine skip a hook with a single AND when a player has no modifier for it. */
export const HOOK_BIT = Object.fromEntries(DERIVED_HOOKS.map((hook, index) => [hook, 1 << index])) as Record<DerivedHook, number>;

export type ModifierSourceKind = 'trait' | 'talent' | 'signature' | 'quirk' | 'state' | 'training' | 'form';

export interface ModifierSource {
  kind: ModifierSourceKind;
  id: string;
}

/** A modifier as written in data files: the pipeline attaches the source. */
export interface EffectSpec {
  hook: EffectHook;
  /** `add` shifts the value, `mul` scales it (applied after all additions). */
  op: 'add' | 'mul';
  value: number;
  /** Cond flags that must all be set for the modifier to apply; omitted means always. */
  when?: number;
}

export interface StatModifier extends EffectSpec {
  source: ModifierSource;
}

export interface EffectCap {
  /** Bounds for the summed additive part. */
  add: readonly [number, number];
  /** Bounds for the product of all multipliers. */
  mul: readonly [number, number];
}

const ATTRIBUTE_CAP: EffectCap = { add: [-15, 15], mul: [0.8, 1.25] };
const DEFAULT_CAP: EffectCap = { add: [-1, 1], mul: [0.5, 1.5] };

/**
 * Hard limits on what stacked modifiers can do to one hook, so no combination of traits,
 * talents and (later) signatures can break the match balance.
 */
export const EFFECT_CAPS: Partial<Record<EffectHook, EffectCap>> = {
  shotError: { add: [-0.5, 0.5], mul: [0.65, 1.5] },
  passError: { add: [-0.04, 0.04], mul: [0.55, 1.5] },
  tackleWin: { add: [-0.15, 0.2], mul: [0.8, 1.25] },
  pressTackle: { add: [-0.1, 0.15], mul: [0.7, 1.4] },
  keeperReaction: { add: [-0.2, 0.3], mul: [0.8, 1.4] },
  staminaDrain: { add: [-0.3, 0.3], mul: [0.4, 1.4] },
  acceleration: { add: [-2, 4], mul: [0.8, 1.25] },
  sprintBurst: { add: [-1, 2], mul: [0.85, 1.2] },
};

export function capFor(hook: EffectHook, isAttribute: boolean): EffectCap {
  return EFFECT_CAPS[hook] ?? (isAttribute ? ATTRIBUTE_CAP : DEFAULT_CAP);
}
