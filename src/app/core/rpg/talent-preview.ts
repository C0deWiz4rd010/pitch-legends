import { ACTIONS, ActionId } from '../../data/actions';
import { conditionText } from '../../data/cond-labels';
import { TalentNode, getTalent } from '../../data/talents';
import { ATTRIBUTE_KEYS, AttributeKey } from '../../models/enums';
import { Player } from '../../models/player.model';
import { EffectHook, EffectSpec } from './effects';
import { scaleEffect } from './signatures';
import { clamp } from '../util';

const HOOK_LABEL: Record<EffectHook, [string, string]> = {
  pace: ['Tempo', 'Pace'],
  shooting: ['Schuss', 'Shooting'],
  passing: ['Passen', 'Passing'],
  dribbling: ['Dribbling', 'Dribbling'],
  defending: ['Verteidigen', 'Defending'],
  physical: ['Physis', 'Physical'],
  stamina: ['Ausdauer', 'Stamina'],
  goalkeeping: ['Torwart', 'Goalkeeping'],
  shotError: ['Schussfehler', 'Shot error'],
  shotPower: ['Schusskraft', 'Shot power'],
  curve: ['Effet', 'Curve'],
  passError: ['Passfehler', 'Pass error'],
  throughLead: ['Steilpass-Vorhalt', 'Through-ball lead'],
  firstTouch: ['Ballannahme', 'First touch'],
  acceleration: ['Antritt', 'Acceleration'],
  sprintBurst: ['Sprinttempo', 'Sprint speed'],
  tackleWin: ['Zweikampfchance', 'Tackle chance'],
  pressTackle: ['Pressing-Zweikämpfe', 'Pressing tackles'],
  shielding: ['Ballabschirmen', 'Shielding'],
  aerial: ['Kopfballstärke', 'Aerial ability'],
  keeperReaction: ['Torwartreaktion', 'Keeper reaction'],
  keeperReach: ['Reichweite', 'Reach'],
  staminaDrain: ['Ausdauerverbrauch', 'Stamina drain'],
  staminaRecovery: ['Erholung', 'Recovery'],
  composure: ['Schussstreuung', 'Shot spread'],
  xpGain: ['Erfahrung', 'Experience'],
  injuryRisk: ['Verletzungsrisiko', 'Injury risk'],
  growthChance: ['Wachstumschance', 'Growth chance'],
  linkPartner: ['Duo-Bindung', 'Duo bond'],
};

export function hookLabel(hook: EffectHook, language: 'de' | 'en'): string {
  return HOOK_LABEL[hook][language === 'de' ? 0 : 1];
}

const signed = (value: number, digits = 1): string => {
  const rounded = Math.round(value * 10 ** digits) / 10 ** digits;
  return `${rounded > 0 ? '+' : ''}${rounded}`;
};

/** One effect as a line of text: "Passfehler −3 % (im Konter)". `rank` scales it like the pipeline does. */
export function describeEffect(effect: EffectSpec, rank: number, language: 'de' | 'en'): string {
  const scaled = scaleEffect(effect, rank);
  const label = hookLabel(effect.hook, language);
  const value =
    scaled.op === 'mul'
      ? `${signed((scaled.value - 1) * 100, 0).replace('-', '−')} %`
      : signed(scaled.value, Math.abs(scaled.value) < 1 ? 3 : 1).replace('-', '−');
  const when = conditionText(effect.when ?? 0, effect.unless ?? 0, language);
  return `${label} ${value}${when ? ` (${when})` : ''}`;
}

export interface TalentPreview {
  talent: TalentNode;
  rankBefore: number;
  rankAfter: number;
  /** Points of the attributes the next rank adds, flat and unconditional. */
  attributes: { key: AttributeKey; delta: number }[];
  /** Situational and derived effects, as written lines, and the action the node unlocks. */
  effects: string[];
  unlocks: { id: ActionId; name: string; text: string }[];
  cost: number;
  pointsBefore: number;
  pointsAfter: number;
  /** Overall rating the sheet would show, with talents counted: before and after. */
  overallBefore: number;
  overallAfter: number;
}

/** What the next rank of a talent would change, so the sheet can show it before the points are spent. */
export function previewTalent(
  player: Player,
  talentId: string,
  language: 'de' | 'en',
  overallOf: (attributes: Record<AttributeKey, number>) => number,
): TalentPreview | null {
  const talent = getTalent(talentId);
  if (!talent) return null;
  const rankBefore = player.talentRanks?.[talent.id] ?? 0;
  const rankAfter = Math.min(talent.maxRank, rankBefore + 1);
  const attributes: TalentPreview['attributes'] = [];
  const after = { ...player.attributes };
  const before = { ...player.attributes };
  for (const key of ATTRIBUTE_KEYS) {
    const delta = (talent.modifiers[key] ?? 0) + flatEffect(talent, key);
    if (delta) attributes.push({ key, delta });
  }
  // Overall with every talent already owned counted, then the same with the new rank.
  const withTalents = (ranks: Record<string, number>) => {
    const result = { ...player.attributes };
    for (const [id, rank] of Object.entries(ranks)) {
      const node = getTalent(id);
      if (!node) continue;
      for (const key of ATTRIBUTE_KEYS)
        result[key] = clamp(
          result[key] + ((node.modifiers[key] ?? 0) + flatEffect(node, key)) * rank,
          1,
          99,
        );
    }
    return result;
  };
  Object.assign(before, withTalents(player.talentRanks ?? {}));
  Object.assign(after, withTalents({ ...player.talentRanks, [talent.id]: rankAfter }));
  const effects = (talent.effects ?? [])
    .filter((effect) => !isFlat(effect))
    .map((effect) => describeEffect(effect, 1, language));
  const unlocks = (talent.unlocks ?? []).map((id) => {
    const info = ACTIONS.find((action) => action.id === id)!;
    const index = language === 'de' ? 0 : 1;
    return { id, name: info.name[index], text: info.text[index] };
  });
  return {
    talent,
    rankBefore,
    rankAfter,
    attributes,
    effects,
    unlocks,
    cost: talent.cost,
    pointsBefore: player.skillPoints,
    pointsAfter: player.skillPoints - talent.cost,
    overallBefore: overallOf(before),
    overallAfter: overallOf(after),
  };
}

const isFlat = (effect: EffectSpec): boolean =>
  !effect.when &&
  !effect.unless &&
  effect.op === 'add' &&
  (ATTRIBUTE_KEYS as string[]).includes(effect.hook);

function flatEffect(talent: TalentNode, key: AttributeKey): number {
  return (talent.effects ?? [])
    .filter((effect) => isFlat(effect) && effect.hook === key)
    .reduce((sum, effect) => sum + effect.value, 0);
}

/** Skill points a player has put into talents, by what the nodes cost. */
export function spentOnTalents(player: Pick<Player, 'talentRanks'>): number {
  return Object.entries(player.talentRanks ?? {}).reduce(
    (sum, [id, rank]) => sum + (getTalent(id)?.cost ?? 0) * Math.max(0, rank),
    0,
  );
}
