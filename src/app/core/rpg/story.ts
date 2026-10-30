import { BIO_ORIGIN, BIO_PERSONALITY, BIO_RARITY, CHRONICLE_TEXT } from '../../data/story';
import { ASCENSION_REASONS } from '../../data/evolutions';
import { RARITY_DEFS, Rarity } from '../../data/rarity';
import { getQuirk } from '../../data/quirks';
import { getTrait } from '../../data/traits';
import { GameState } from '../../models/game.model';
import { MatchResult } from '../../models/match.model';
import { ChronicleEntry, ChronicleKind, Player } from '../../models/player.model';
import { Team } from '../../models/team.model';
import { careerTotal, evolveQuirks, revealByAppearances } from './quirks';
import { dnaOf } from './player-dna';
import { hash32 } from '../visual-identity';

export const CHRONICLE_LIMIT = 40;

/** Appends a line to the story; the oldest line makes room when the limit is reached. */
export function addChronicle(player: Player, entry: ChronicleEntry): void {
  if (!player.dna) return;
  const list = (player.dna.chronicle ??= []);
  list.push(entry);
  if (list.length > CHRONICLE_LIMIT) list.splice(0, list.length - CHRONICLE_LIMIT);
}

function fill(template: string, params: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => String(params[key] ?? ''));
}

/** The text of a chronicle line in German or English; ids in params are resolved to names. */
export function chronicleLine(entry: ChronicleEntry, language: 'de' | 'en'): string {
  const index = language === 'de' ? 0 : 1;
  const params: Record<string, string | number> = { ...(entry.params ?? {}) };
  for (const key of ['quirk', 'from', 'to']) {
    const quirk = typeof params[key] === 'string' ? getQuirk(params[key] as string) : undefined;
    if (quirk) params[key] = quirk.name[index];
  }
  if (typeof params['nameDe'] === 'string')
    params['name'] = params[index === 0 ? 'nameDe' : 'nameEn'];
  if (entry.kind === 'ascension') {
    for (const key of ['from', 'to']) {
      const def = RARITY_DEFS[params[key] as Rarity];
      if (def) params[key] = def.label[index];
    }
    const reason = ASCENSION_REASONS.find((candidate) => candidate.id === params['reason']);
    if (reason) params['reason'] = reason.text[index];
  }
  if (typeof params['trait'] === 'string')
    params['trait'] = getTrait(params['trait'])?.name ?? params['trait'];
  return fill(CHRONICLE_TEXT[entry.kind][index], params);
}

/** Something the club's story wants to tell the manager about. */
export interface StoryBeat {
  kind: 'quirk' | 'evolution' | 'firstGoal';
  player: Player;
  /** Quirk id (for `quirk`) or the new quirk id (for `evolution`). */
  quirkId?: string;
}

/**
 * Writes the story of one finished match into the squad of the managed club: debut, first goal,
 * hat-trick, man of the match, injuries and comebacks, level milestones, quirks that show themselves
 * and quirks that change. Returns the beats worth a news item.
 */
export function recordMatchStory(game: GameState, team: Team, result: MatchResult): StoryBeat[] {
  const beats: StoryBeat[] = [];
  const opponentId = result.homeTeamId === team.id ? result.awayTeamId : result.homeTeamId;
  const opponent = game.teams.find((candidate) => candidate.id === opponentId)?.name ?? '—';
  const at = { season: game.league.season, week: result.week || game.league.currentWeek };
  for (const player of team.players) {
    if (result.ratings[player.id] === undefined || !player.dna) continue;
    const goals = result.contributions[player.id]?.goals ?? 0;
    const log = (kind: ChronicleKind, params?: Record<string, string | number>) =>
      addChronicle(player, { ...at, kind, params });
    if (careerTotal(player, 'appearances') === 1) log('debut', { club: team.name });
    if (goals > 0 && careerTotal(player, 'goals') - goals === 0) {
      log('firstGoal', { opponent });
      beats.push({ kind: 'firstGoal', player });
    }
    if (goals >= 3) log('hattrick', { opponent });
    if (result.manOfTheMatchId === player.id) log('motm', { opponent });
    const chronicle = player.dna.chronicle ?? [];
    const lastHealth = [...chronicle]
      .reverse()
      .find((entry) => entry.kind === 'injury' || entry.kind === 'comeback');
    if (result.events.some((event) => event.type === 'injury' && event.playerId === player.id))
      log('injury', { weeks: player.injuryWeeks });
    else if (lastHealth?.kind === 'injury' && player.injuryWeeks === 0) log('comeback');
    if (
      player.level % 5 === 0 &&
      !chronicle.some((entry) => entry.kind === 'level' && entry.params?.['level'] === player.level)
    )
      log('level', { level: player.level });
    for (const quirk of revealByAppearances(player)) {
      log('quirk', { quirk: quirk.id });
      beats.push({ kind: 'quirk', player, quirkId: quirk.id });
    }
    for (const change of evolveQuirks(player)) {
      log('evolution', { from: change.from, to: change.to });
      beats.push({ kind: 'evolution', player, quirkId: change.to });
    }
  }
  return beats;
}

/** Two or three sentences about a player, deterministic from his id and the world (hometown, youth club). */
export function buildBio(player: Player, game: GameState, language: 'de' | 'en'): string {
  const index = language === 'de' ? 0 : 1;
  const seed = hash32(`${player.id}|bio-v1`);
  const cities = game.world?.cities ?? [];
  const city = cities.length ? cities[seed % cities.length].name : player.nationality;
  const youthClubs = game.teams.filter((team) => team.id !== game.clubId);
  const youth = youthClubs.length ? youthClubs[(seed >>> 5) % youthClubs.length].name : '—';
  const dna = dnaOf(player);
  const nickname = dna.nickname ? dna.nickname[index] : '';
  const lines = [
    fill(BIO_ORIGIN[(seed >>> 3) % BIO_ORIGIN.length][index], { city, youth }),
    BIO_PERSONALITY[player.personality]?.[index],
    BIO_RARITY[dna.rarity] ? fill(BIO_RARITY[dna.rarity][index], { nickname }) : '',
  ];
  return lines.filter(Boolean).join(' ');
}
