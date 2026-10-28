import { RARITIES, RARITY_DEFS, Rarity } from '../../data/rarity';
import { QuirkStat, getQuirk, rollableQuirks } from '../../data/quirks';
import { Player, QuirkState } from '../../models/player.model';
import { Rng } from '../util';
import { hash32 } from '../visual-identity';

/** Matches after which the next hidden quirk shows itself: 3, 6, 9 … */
export const REVEAL_EVERY = 3;

/** One to three quirks by rarity, deterministic from the player id; all start hidden. */
export function generateQuirks(player: Pick<Player, 'id'>, rarity: Rarity): QuirkState[] {
  const rng = new Rng(hash32(`${player.id}|quirks-v1`));
  const [min, max] = RARITY_DEFS[rarity].quirkSlots;
  const count = rng.int(min, max);
  const pool = rollableQuirks(rarity, RARITIES);
  const chosen: QuirkState[] = [];
  while (chosen.length < count && pool.length) {
    const [quirk] = pool.splice(rng.int(0, pool.length - 1), 1);
    chosen.push({ id: quirk.id, revealed: false });
  }
  return chosen;
}

export function quirkSlots(rarity: Rarity): number {
  return RARITY_DEFS[rarity].quirkSlots[1];
}

/** Career total of a stat that quirks can evolve on (finished seasons plus the running one). */
export function careerTotal(player: Player, stat: QuirkStat): number {
  const career = player.career;
  const season = player.seasonStats;
  switch (stat) {
    case 'goals': return (career?.goals ?? 0) + season.goals;
    case 'assists': return (career?.assists ?? 0) + season.assists;
    case 'appearances': return (career?.appearances ?? 0) + season.appearances;
    case 'cleanSheets': return (career?.cleanSheets ?? 0) + season.cleanSheets;
    case 'motm': return (career?.motmAwards ?? 0) + season.motmAwards;
  }
}

/** Shows the first hidden quirk (scouting reports and training events use this). */
export function revealNext(player: Player): QuirkState | null {
  const hidden = player.dna?.quirks?.find((quirk) => !quirk.revealed);
  if (hidden) hidden.revealed = true;
  return hidden ?? null;
}

/** Match experience reveals quirks: the n-th one after 3·n appearances. Returns what was revealed now. */
export function revealByAppearances(player: Player): QuirkState[] {
  const quirks = player.dna?.quirks;
  if (!quirks?.length) return [];
  const appearances = careerTotal(player, 'appearances');
  const shown = quirks.filter((quirk) => quirk.revealed).length;
  const due = Math.min(quirks.length, Math.floor(appearances / REVEAL_EVERY));
  const revealed: QuirkState[] = [];
  for (let index = shown; index < due; index++) {
    const next = quirks.find((quirk) => !quirk.revealed);
    if (!next) break;
    next.revealed = true;
    revealed.push(next);
  }
  return revealed;
}

/** Revealed quirks whose milestone is reached turn into their successor. Returns the changes. */
export function evolveQuirks(player: Player): { from: string; to: string }[] {
  const changes: { from: string; to: string }[] = [];
  for (const quirk of player.dna?.quirks ?? []) {
    const evolve = quirk.revealed ? getQuirk(quirk.id)?.evolve : undefined;
    if (!evolve || careerTotal(player, evolve.stat) < evolve.target) continue;
    if (player.dna!.quirks!.some((other) => other.id === evolve.to)) continue;
    changes.push({ from: quirk.id, to: evolve.to });
    quirk.id = evolve.to;
    quirk.revealed = true;
  }
  return changes;
}

/** Chance per session that a junior picks up a quirk of a mentor. */
export const INHERIT_CHANCE = 0.1;

/**
 * A senior passes one of his revealed, inheritable quirks to a junior with a free slot. The junior
 * learns it hidden, like every quirk. Returns the quirk id or null.
 */
export function inheritQuirk(seniors: readonly Player[], junior: Player, seed: string): string | null {
  const dna = junior.dna;
  if (!dna) return null;
  const quirks = (dna.quirks ??= []);
  if (quirks.length >= quirkSlots(dna.rarity)) return null;
  const rng = new Rng(hash32(`${seed}|${junior.id}|inherit`));
  if (!rng.bool(INHERIT_CHANCE)) return null;
  const options = seniors.flatMap((senior) => (senior.dna?.quirks ?? [])
    .filter((quirk) => quirk.revealed && getQuirk(quirk.id)?.inheritable && !quirks.some((own) => own.id === quirk.id))
    .map((quirk) => quirk.id));
  if (!options.length) return null;
  const id = options[rng.int(0, options.length - 1)];
  quirks.push({ id, revealed: false });
  return id;
}
