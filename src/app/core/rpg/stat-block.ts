import { ATTRIBUTE_KEYS, AttributeKey } from '../../models/enums';
import { Player } from '../../models/player.model';
import { getTalent } from '../../data/talents';
import { getQuirk } from '../../data/quirks';
import { getTrait } from '../../data/traits';
import { computeOverall, positionFamiliarity } from '../ratings';
import { clamp } from '../util';
import { condMatches } from './conditions';
import { scaleEffect, signatureEffects } from './signatures';
import { DerivedHook, EffectHook, EffectSpec, HOOK_BIT, HOOK_INDEX, ModifierSource, StatModifier, capFor } from './effects';

export interface StatContext {
  /** Formation slot the player fills; out-of-position players lose some sharpness. */
  slotPosition?: string;
}

/** One line of the "why is my shot 78?" breakdown. */
export interface StatPart {
  source: ModifierSource;
  label: string;
  value: number;
  /** `mul` parts are factors (1.03), `add` parts are points. */
  op: 'base' | 'add' | 'mul';
  active: boolean;
}

/**
 * Everything the match needs to know about the numbers of one player. Plain data (no functions)
 * so it can sit on an actor without upsetting structured clones.
 */
export interface StatBlock {
  playerId: string;
  /** Attributes + talents, scaled by form, morale and familiarity. */
  base: Record<AttributeKey, number>;
  /** Situational modifiers grouped by hook; absent hooks have none. */
  mods: Partial<Record<EffectHook, StatModifier[]>>;
  state: { morale: number; form: number; familiarity: number };
  /** False for players without a situational modifier: lets the engine skip all lookups. */
  hasMods: boolean;
  /** The attributes that have a situational modifier; only these change with the flags. */
  modAttrs: AttributeKey[];
  /** True when a derived engine hook (not an attribute) is modified, so hook() has work to do. */
  hasHookMods: boolean;
  /** OR of every flag any modifier depends on: other flag changes cannot change a resolved value. */
  flagMask: number;
  /** Bit of every modified derived hook (see HOOK_BIT); a hook without its bit needs no lookup. */
  hookMask: number;
}

const IS_ATTRIBUTE = new Set<string>(ATTRIBUTE_KEYS);

/** Hooks the live match never asks about; they live in the block for the squad and training code. */
const OFF_PITCH_HOOKS = new Set<string>(['xpGain', 'injuryRisk', 'growthChance']);

/** Fresh attribute record with one fixed shape, so every attribute view the engine reads is monomorphic. */
export function newAttributes(source?: Record<AttributeKey, number>): Record<AttributeKey, number> {
  return {
    pace: source?.pace ?? 0, shooting: source?.shooting ?? 0, passing: source?.passing ?? 0, dribbling: source?.dribbling ?? 0,
    defending: source?.defending ?? 0, physical: source?.physical ?? 0, stamina: source?.stamina ?? 0, goalkeeping: source?.goalkeeping ?? 0,
  };
}

/** Morale 65 is neutral; form is -5..+5. Both stay within a few percent so talent still matters most. */
export function stateMultipliers(player: Player, slotPosition?: string): StatBlock['state'] {
  const morale = 1 + clamp((player.morale - 65) / 35, -1, 1) * 0.04;
  const form = 1 + clamp(player.form, -5, 5) * 0.008;
  const familiarity = slotPosition ? 0.5 + 0.5 * positionFamiliarity(player, slotPosition) : 1;
  return { morale, form, familiarity };
}

/** Unconditional attribute bonuses are baked into the base; only situational ones stay as modifiers. */
function isFlatBonus(effect: EffectSpec): boolean {
  return !effect.when && !effect.unless && effect.op === 'add' && IS_ATTRIBUTE.has(effect.hook);
}

export function buildStatBlock(player: Player, context: StatContext = {}): StatBlock {
  const state = stateMultipliers(player, context.slotPosition);
  const scale = state.morale * state.form * state.familiarity;
  const raw = { ...player.attributes };
  for (const id of player.traitIds ?? []) {
    for (const effect of getTrait(id)?.effects ?? []) {
      if (isFlatBonus(effect)) raw[effect.hook as AttributeKey] += effect.value;
    }
  }
  for (const buff of player.training?.buffs ?? []) {
    for (const effect of buff.effects) {
      if (isFlatBonus(effect)) raw[effect.hook as AttributeKey] += effect.value;
    }
  }
  for (const quirk of player.dna?.quirks ?? []) {
    for (const effect of getQuirk(quirk.id)?.effects ?? []) {
      if (isFlatBonus(effect)) raw[effect.hook as AttributeKey] += effect.value;
    }
  }
  for (const [id, rank] of Object.entries(player.talentRanks ?? {})) {
    const talent = getTalent(id);
    if (!talent || rank <= 0) continue;
    for (const key of Object.keys(talent.modifiers) as AttributeKey[]) raw[key] += talent.modifiers[key]! * rank;
    for (const effect of talent.effects ?? []) {
      const scaled = scaleEffect(effect, rank);
      if (isFlatBonus(scaled)) raw[scaled.hook as AttributeKey] += scaled.value;
    }
  }
  const base = newAttributes();
  for (const key of ATTRIBUTE_KEYS) base[key] = clamp(raw[key] * scale, 1, 99);

  const mods: StatBlock['mods'] = {};
  for (const id of player.traitIds ?? []) {
    const trait = getTrait(id);
    if (!trait?.effects) continue;
    for (const effect of trait.effects) if (!isFlatBonus(effect)) (mods[effect.hook] ??= []).push({ ...effect, source: { kind: 'trait', id } });
  }
  for (const buff of player.training?.buffs ?? []) {
    for (const effect of buff.effects) {
      if (!isFlatBonus(effect)) (mods[effect.hook] ??= []).push({ ...effect, source: { kind: 'training', id: buff.drillId } });
    }
  }
  for (const [id, rank] of Object.entries(player.talentRanks ?? {})) {
    const talent = getTalent(id);
    if (!talent || rank <= 0) continue;
    for (const effect of talent.effects ?? []) {
      const scaled = scaleEffect(effect, rank);
      if (!isFlatBonus(scaled)) (mods[scaled.hook] ??= []).push({ ...scaled, source: { kind: 'talent', id } });
    }
  }
  for (const quirk of player.dna?.quirks ?? []) {
    for (const effect of getQuirk(quirk.id)?.effects ?? []) {
      if (!isFlatBonus(effect)) (mods[effect.hook] ??= []).push({ ...effect, source: { kind: 'quirk', id: quirk.id } });
    }
  }
  (player.dna?.signatures ?? []).slice(0, 2).forEach((signature, slot) => {
    for (const effect of signatureEffects(signature, slot as 0 | 1)) (mods[effect.hook] ??= []).push({ ...effect, source: { kind: 'signature', id: signature.id } });
  });
  return {
    playerId: player.id, base, mods, state,
    hasMods: Object.keys(mods).length > 0,
    modAttrs: ATTRIBUTE_KEYS.filter((key) => !!mods[key]),
    hasHookMods: Object.keys(mods).some((hook) => !IS_ATTRIBUTE.has(hook) && !OFF_PITCH_HOOKS.has(hook)),
    flagMask: Object.values(mods).reduce((mask, list) => (list ?? []).reduce((inner, mod) => inner | (mod.when ?? 0) | (mod.unless ?? 0), mask), 0),
    hookMask: Object.keys(mods).reduce((mask, hook) => mask | (HOOK_BIT[hook as DerivedHook] ?? 0), 0),
  };
}

/** A block that plays the plain attributes: used when effects are switched off for comparisons. */
export function rawStatBlock(player: Player): StatBlock {
  return {
    playerId: player.id,
    base: newAttributes(player.attributes),
    mods: {},
    state: { morale: 1, form: 1, familiarity: 1 },
    hasMods: false,
    modAttrs: [],
    hasHookMods: false,
    flagMask: 0,
    hookMask: 0,
  };
}

function resolve(block: StatBlock, hook: EffectHook, start: number, flags: number): number {
  if (!block.hasMods) return start;
  const list = block.mods[hook];
  if (!list) return start;
  let add = 0;
  let mul = 1;
  for (const mod of list) {
    if (!condMatches(flags, mod.when, mod.unless)) continue;
    if (mod.op === 'add') add += mod.value;
    else mul *= mod.value;
  }
  const cap = capFor(hook, IS_ATTRIBUTE.has(hook));
  return (start + clamp(add, cap.add[0], cap.add[1])) * clamp(mul, cap.mul[0], cap.mul[1]);
}

/** An attribute as it plays right now: base value plus every modifier whose condition holds. */
export function resolveAttribute(block: StatBlock, key: AttributeKey, flags: number): number {
  if (!block.hasMods) return block.base[key];
  return clamp(resolve(block, key, block.base[key], flags), 1, 99);
}

/**
 * Caches the additive and multiplicative part of every modified derived hook for one flag set, so the
 * engine answers a hook with `(base + add) * mul` instead of walking modifier lists on every call.
 */
export function refreshHooks(block: StatBlock, flags: number, add: Float64Array, mul: Float64Array): void {
  for (const hook of Object.keys(block.mods) as EffectHook[]) {
    if (IS_ATTRIBUTE.has(hook)) continue;
    const index = HOOK_INDEX[hook as DerivedHook];
    let sum = 0;
    let product = 1;
    for (const modifier of block.mods[hook]!) {
      if (!condMatches(flags, modifier.when, modifier.unless)) continue;
      if (modifier.op === 'add') sum += modifier.value;
      else product *= modifier.value;
    }
    const cap = capFor(hook, false);
    add[index] = clamp(sum, cap.add[0], cap.add[1]);
    mul[index] = clamp(product, cap.mul[0], cap.mul[1]);
  }
}

/**
 * Re-resolves the attributes that have situational modifiers into `into`, a buffer that starts as a
 * copy of the base. The other attributes never change with the flags.
 */
export function refreshAttributes(block: StatBlock, flags: number, into: Record<AttributeKey, number>): Record<AttributeKey, number> {
  for (const key of block.modAttrs) into[key] = resolveAttribute(block, key, flags);
  return into;
}

/** A derived engine value (an error rate, a chance) after modifiers. */
export function resolveHook(block: StatBlock, hook: EffectHook, base: number, flags: number): number {
  return resolve(block, hook, base, flags);
}

/** Itemised contributions to an attribute, for the player sheet. */
export function explainStat(player: Player, key: AttributeKey, flags = 0, context: StatContext = {}): StatPart[] {
  const block = buildStatBlock(player, context);
  const parts: StatPart[] = [{ source: { kind: 'state', id: 'attribute' }, label: key, value: player.attributes[key], op: 'base', active: true }];
  for (const [id, rank] of Object.entries(player.talentRanks ?? {})) {
    const talent = getTalent(id);
    const value = (talent?.modifiers[key] ?? 0) * rank;
    if (talent && rank > 0 && value) parts.push({ source: { kind: 'talent', id }, label: talent.name, value, op: 'add', active: true });
  }
  const { morale, form, familiarity } = block.state;
  parts.push({ source: { kind: 'state', id: 'morale' }, label: 'morale', value: morale, op: 'mul', active: morale !== 1 });
  parts.push({ source: { kind: 'form', id: 'form' }, label: 'form', value: form, op: 'mul', active: form !== 1 });
  parts.push({ source: { kind: 'state', id: 'familiarity' }, label: 'familiarity', value: familiarity, op: 'mul', active: familiarity !== 1 });
  for (const id of player.traitIds ?? []) {
    const trait = getTrait(id);
    for (const effect of trait?.effects ?? []) {
      if (effect.hook !== key) continue;
      parts.push({ source: { kind: 'trait', id }, label: trait!.name, value: effect.value, op: effect.op, active: condMatches(flags, effect.when, effect.unless) });
    }
  }
  return parts;
}

/** Share of a situational bonus counted when a single number has to stand in for a whole match. */
const SITUATIONAL_WEIGHT = 0.4;

/**
 * Overall rating of a player with form, morale, position and traits folded in, used where the
 * 60 Hz match is not played (quick simulation). Situational bonuses count partially.
 */
export function staticOverall(player: Player, slotPosition?: string): number {
  const block = buildStatBlock(player, { slotPosition });
  const attributes = { ...block.base };
  for (const key of ATTRIBUTE_KEYS) {
    for (const mod of block.mods[key] ?? []) {
      if (mod.op === 'add') attributes[key] = clamp(attributes[key] + mod.value * (mod.when ? SITUATIONAL_WEIGHT : 1), 1, 99);
    }
  }
  return computeOverall(attributes, player.positionGroup);
}

export interface AttributeSources {
  /** The attribute as printed on the card. */
  base: number;
  talents: number;
  traits: number;
  training: number;
  quirks: number;
  /** Form, morale and position, as points. */
  state: number;
  /** What the match engine starts from. */
  total: number;
  /** Situational effects on this attribute, shown with the condition flags they need. */
  conditional: { source: ModifierSource; label: [string, string]; value: number; op: 'add' | 'mul'; when: number; unless: number }[];
}

/** Where the number of one attribute comes from, for the player sheet. */
export function attributeSources(player: Player, key: AttributeKey, slotPosition?: string): AttributeSources {
  const flat = (effects: readonly EffectSpec[] | undefined): number =>
    (effects ?? []).filter((effect) => effect.hook === key && isFlatBonus(effect)).reduce((sum, effect) => sum + effect.value, 0);
  let talents = 0;
  for (const [id, rank] of Object.entries(player.talentRanks ?? {})) {
    const talent = getTalent(id);
    if (!talent || rank <= 0) continue;
    talents += (talent.modifiers[key] ?? 0) * rank + flat((talent.effects ?? []).map((effect) => scaleEffect(effect, rank)));
  }
  const traits = (player.traitIds ?? []).reduce((sum, id) => sum + flat(getTrait(id)?.effects), 0);
  const training = (player.training?.buffs ?? []).reduce((sum, buff) => sum + flat(buff.effects), 0);
  const quirks = (player.dna?.quirks ?? []).reduce((sum, quirk) => sum + flat(getQuirk(quirk.id)?.effects), 0);
  const block = buildStatBlock(player, { slotPosition });
  const total = block.base[key];
  const base = player.attributes[key];
  const conditional: AttributeSources['conditional'] = [];
  for (const mod of block.mods[key] ?? []) {
    const same = (name: string | undefined): [string, string] | undefined => (name ? [name, name] : undefined);
    const label = mod.source.kind === 'trait' ? same(getTrait(mod.source.id)?.name)
      : mod.source.kind === 'talent' ? same(getTalent(mod.source.id)?.name)
        : mod.source.kind === 'quirk' ? getQuirk(mod.source.id)?.name
          : mod.source.kind === 'training' ? same(mod.source.id)
            : player.dna?.signatures?.find((signature) => signature.id === mod.source.id)?.name;
    conditional.push({ source: mod.source, label: label ?? [mod.source.id, mod.source.id], value: mod.value, op: mod.op, when: mod.when ?? 0, unless: mod.unless ?? 0 });
  }
  return { base, talents, traits, training, quirks, state: total - (base + talents + traits + training + quirks), total, conditional };
}

