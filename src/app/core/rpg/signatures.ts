import { Cond } from './conditions';
import { EffectSpec } from './effects';
import { RARITY_DEFS, Rarity } from '../../data/rarity';
import { SignatureDef, getSignature, signaturesFor } from '../../data/signatures';
import { Player, PlayerDNA, SignatureState } from '../../models/player.model';
import { Rng } from '../util';
import { hash32 } from '../visual-identity';

/** Evolution stages scale the effects (Phase 6 raises a signature's level). */
const LEVEL_SCALE = { 1: 1, 2: 1.15, 3: 1.3 } as const;

/** Strength from the rarity budget: Common 0.8 up to Mythic 1.2. */
export function signaturePower(rarity: Rarity, tuning = 1): number {
  return (0.6 + 0.1 * RARITY_DEFS[rarity].budget) * tuning;
}

/** The signatures a player of this tier carries: Common the passive one, Rare/Epic the triggered one, both from Legendary. */
export function generateSignatures(player: Pick<Player, 'id' | 'archetype'>, rarity: Rarity): SignatureState[] {
  const rng = new Rng(hash32(`${player.id}|signature-v1`));
  const options = signaturesFor(player.archetype);
  const passive = options.find((definition) => definition.minRarity === 'common');
  const triggered = options.find((definition) => definition.minRarity === 'rare');
  const wanted = rarity === 'common' ? [passive] : rarity === 'rare' || rarity === 'epic' ? [triggered] : [passive, triggered];
  const chosen = wanted.filter((definition): definition is SignatureDef => !!definition);
  return chosen.map((definition) => ({
    id: definition.id,
    name: definition.variants[rng.int(0, definition.variants.length - 1)],
    power: Math.round(signaturePower(rarity, rng.float(0.94, 1.06)) * 1000) / 1000,
    level: 1,
    path: null,
  }));
}

/** Scales an effect around its neutral point: +6 becomes +6·power, ×0.7 becomes ×(1 − 0.3·power). */
export function scaleEffect(spec: EffectSpec, factor: number): EffectSpec {
  return { ...spec, value: spec.op === 'add' ? spec.value * factor : 1 + (spec.value - 1) * factor };
}

/** The effects of a signature in slot 0 or 1, scaled and bound to that slot's awake flag. */
export function signatureEffects(state: SignatureState, slot: 0 | 1): EffectSpec[] {
  const definition = getSignature(state.id);
  if (!definition) return [];
  const bit = slot === 0 ? Cond.signature : Cond.signature2;
  const condition = definition.trigger.kind === 'condition';
  const pathScale = state.path === 'a' ? 1.25 : state.path === 'b' && condition ? 1.1 : 1;
  const factor = state.power * LEVEL_SCALE[state.level] * pathScale;
  return definition.effects.map((effect) => {
    const scaled = scaleEffect(effect, factor);
    scaled.when = ((effect.when ?? 0) & ~Cond.signature) | bit;
    return scaled;
  });
}

/** Per-match state of one signature of one player on the pitch. */
export interface SignatureRuntime {
  slot: 0 | 1;
  definition: SignatureDef;
  state: SignatureState;
  /** Tick until which an event-driven signature stays awake. */
  until: number;
  /** Tick from which it may wake up again. */
  readyAt: number;
  awake: boolean;
  /** Stamina refill is a once-per-match gift. */
  refilled: boolean;
  /** Seconds awake and cooldown of an event trigger after the branch of the signature is applied. */
  seconds: number;
  cooldown: number;
  /** True for condition triggers; `masks` caches their situation masks for the per-tick test. */
  isCondition: boolean;
  masks: number[];
}

export function createRuntimes(dna: PlayerDNA | undefined): SignatureRuntime[] {
  const runtimes: SignatureRuntime[] = [];
  (dna?.signatures ?? []).forEach((state, index) => {
    const definition = getSignature(state.id);
    if (definition && index < 2) runtimes.push({
      slot: index as 0 | 1, definition, state, until: 0, readyAt: 0, awake: false, refilled: false,
      seconds: definition.trigger.kind === 'event' ? definition.trigger.seconds * (state.path === 'b' ? 1.5 : 1) : 0,
      cooldown: definition.trigger.kind === 'event' ? definition.trigger.cooldown * (state.path === 'b' ? 0.7 : 1) : 0,
      isCondition: definition.trigger.kind === 'condition',
      masks: definition.trigger.kind === 'condition' ? definition.trigger.any : [],
    });
  });
  return runtimes;
}

export function signatureBit(slot: 0 | 1): number {
  return slot === 0 ? Cond.signature : Cond.signature2;
}
