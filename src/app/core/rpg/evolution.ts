import { ASCENSION_CAP, ASCENSION_REASONS, AscensionReason, EVOLUTION_STAGES, EvolutionStage, PATH_NAMES, impactPoints } from '../../data/evolutions';
import { NICKNAMES } from '../../data/nicknames';
import { AURA_FROM, Rarity, RARITIES, atLeast, rarityRank } from '../../data/rarity';
import { GameState } from '../../models/game.model';
import { MatchResult } from '../../models/match.model';
import { Player, SignatureState } from '../../models/player.model';
import { Team } from '../../models/team.model';
import { addChronicle } from './story';
import { generateSignatures } from './signatures';
import { Rng } from '../util';
import { hash32 } from '../visual-identity';

export interface SignatureQuest {
  /** The step this signature can take next, or null at the top. */
  stage: EvolutionStage | null;
  points: number;
  target: number;
  pointsOk: boolean;
  levelOk: boolean;
  rarityOk: boolean;
  ready: boolean;
}

export function signatureProgress(state: SignatureState) {
  return (state.progress ??= { activations: 0, shots: 0, goals: 0 });
}

export function signatureQuest(player: Player, state: SignatureState): SignatureQuest {
  const stage = EVOLUTION_STAGES.find((candidate) => candidate.to === state.level + 1) ?? null;
  const points = impactPoints(state.progress ?? { activations: 0, shots: 0, goals: 0 });
  if (!stage) return { stage: null, points, target: 0, pointsOk: false, levelOk: false, rarityOk: false, ready: false };
  const rarity = player.dna?.rarity ?? 'common';
  const pointsOk = points >= stage.points;
  const levelOk = player.level >= stage.playerLevel;
  const rarityOk = atLeast(rarity, stage.minRarity);
  return { stage, points, target: stage.points, pointsOk, levelOk, rarityOk, ready: pointsOk && levelOk && rarityOk };
}

/** Name shown for a signature: the personal variant, or the branch name once stage II is chosen. */
export function signatureTitle(state: SignatureState, archetype: Player['archetype'], language: 'de' | 'en'): string {
  const index = language === 'de' ? 0 : 1;
  const path = state.path ? PATH_NAMES[archetype]?.[state.path] : null;
  return path ? path[index] : state.name[index];
}

export interface EvolveResult {
  ok: boolean;
  error?: 'unknown-signature' | 'not-ready' | 'path-required' | 'path-not-allowed';
}

/**
 * Takes the next step of a signature. Stage I to II needs a branch (A or B), II to III keeps it.
 * The choice is final; there is no re-roll.
 */
export function evolveSignature(player: Player, signatureId: string, path: 'a' | 'b' | null, at: { season: number; week: number }): EvolveResult {
  const state = player.dna?.signatures?.find((signature) => signature.id === signatureId);
  if (!state) return { ok: false, error: 'unknown-signature' };
  const quest = signatureQuest(player, state);
  if (!quest.ready || !quest.stage) return { ok: false, error: 'not-ready' };
  if (quest.stage.to === 2) {
    if (path !== 'a' && path !== 'b') return { ok: false, error: 'path-required' };
    state.path = path;
  } else if (path !== null && path !== state.path) return { ok: false, error: 'path-not-allowed' };
  state.level = quest.stage.to;
  addChronicle(player, { ...at, kind: 'signature', params: { nameDe: state.name[0], nameEn: state.name[1], level: state.level } });
  return { ok: true };
}

/** Adds what the signatures of the managed club's players did in a match to their career tallies. */
export function applySignatureProgress(team: Team, result: MatchResult): void {
  for (const entry of result.signatures ?? []) {
    const player = team.players.find((candidate) => candidate.id === entry.playerId);
    const state = player?.dna?.signatures?.find((signature) => signature.id === entry.signatureId);
    if (!state) continue;
    const progress = signatureProgress(state);
    progress.activations += entry.activations;
    progress.shots += entry.shots;
    progress.goals += entry.goals;
  }
}

export interface Ascension {
  player: Player;
  reason: AscensionReason;
  from: Rarity;
  to: Rarity;
}

/** The standout achievement of a finished season that lifts a player one rarity step, if any. */
function ascensionReason(player: Player, isTopScorer: boolean): AscensionReason | null {
  const reasonId = isTopScorer ? 'top-scorer'
    : player.seasonStats.motmAwards >= 5 ? 'mvp-season'
      : (player.career?.appearances ?? 0) + player.seasonStats.appearances >= 100 ? 'club-legend' : null;
  return ASCENSION_REASONS.find((reason) => reason.id === reasonId) ?? null;
}

/** Merges the signatures of the new tier into the existing ones, keeping levels and branches. */
function mergeSignatures(player: Player, rarity: Rarity): SignatureState[] {
  const existing = player.dna?.signatures ?? [];
  const wanted = generateSignatures(player, rarity);
  return [...existing, ...wanted.filter((signature) => !existing.some((own) => own.id === signature.id))];
}

/**
 * Season-end achievements lift players one tier (once per career, never beyond Legendary): the
 * world's top scorer (10+ goals), five man-of-the-match awards, or 100 appearances. Call before the
 * season statistics are archived. Returns what happened.
 */
export function ascendPlayers(game: GameState): Ascension[] {
  const players = game.teams.flatMap((team) => team.players);
  const topGoals = Math.max(0, ...players.map((player) => player.seasonStats.goals));
  const topScorer = topGoals >= 10 ? players.find((player) => player.seasonStats.goals === topGoals) : undefined;
  const changes: Ascension[] = [];
  for (const player of players) {
    const dna = player.dna;
    if (!dna || dna.ascended || rarityRank(dna.rarity) >= rarityRank(ASCENSION_CAP)) continue;
    const reason = ascensionReason(player, player === topScorer);
    if (!reason) continue;
    const from = dna.rarity;
    const to = RARITIES[rarityRank(from) + 1];
    dna.rarity = to;
    dna.ascended = true;
    dna.signatures = mergeSignatures(player, to);
    if (!dna.nickname && atLeast(to, AURA_FROM)) {
      const nicknames = NICKNAMES[player.archetype] ?? [];
      if (nicknames.length) dna.nickname = nicknames[new Rng(hash32(`${player.id}|ascension-nickname`)).int(0, nicknames.length - 1)];
    }
    addChronicle(player, { season: game.league.season, week: game.league.currentWeek, kind: 'ascension', params: { from, to, reason: reason.id } });
    changes.push({ player, reason, from, to });
  }
  return changes;
}
