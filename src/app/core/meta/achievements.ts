import { MetaState } from '../../models/meta.model';

export type AchievementGroup = 'skill' | 'career' | 'collection';

export interface AchievementDef {
  id: string;
  group: AchievementGroup;
  /** The counter the achievement reads and the value it needs. */
  counter: string;
  target: number;
  /** Profile experience for the Legends Path. */
  xp: number;
  /** Step of its ladder: 1 is the first, easiest. */
  step: number;
  name: [string, string];
  text: [string, string];
}

interface Ladder {
  key: string;
  group: AchievementGroup;
  counter: string;
  targets: number[];
  name: [string, string];
  /** `{n}` is the target of the step. */
  text: [string, string];
}

const ROMAN = ['I', 'II', 'III', 'IV'];
const STEP_XP = [40, 100, 250, 500];

/** One ladder of steps becomes one achievement per step. */
const LADDERS: Ladder[] = [
  // Skill: what happens on the pitch
  { key: 'goals', group: 'skill', counter: 'goals', targets: [1, 50, 250], name: ['Torjäger', 'Goal getter'], text: ['Erzielt {n} Tore.', 'Score {n} goals.'] },
  { key: 'wins', group: 'skill', counter: 'wins', targets: [1, 25, 100], name: ['Sieger', 'Winner'], text: ['Gewinne {n} Spiele.', 'Win {n} matches.'] },
  { key: 'clean', group: 'skill', counter: 'cleanSheets', targets: [1, 10, 40], name: ['Mauer', 'Wall'], text: ['Spiele {n} Mal zu null.', 'Keep {n} clean sheets.'] },
  { key: 'hattrick', group: 'skill', counter: 'hattricks', targets: [1, 5], name: ['Dreierpack', 'Hat-trick hero'], text: ['Ein Spieler erzielt in {n} Spielen drei Tore.', 'A player scores three goals in {n} matches.'] },
  { key: 'rout', group: 'skill', counter: 'bigWins', targets: [1, 10], name: ['Kantersieg', 'Rout'], text: ['Gewinne {n} Mal mit vier Toren Unterschied.', 'Win {n} times by four goals.'] },
  { key: 'derby', group: 'skill', counter: 'derbyWins', targets: [1, 5], name: ['Derbyheld', 'Derby hero'], text: ['Gewinne {n} Derbys.', 'Win {n} derbies.'] },
  { key: 'medal', group: 'skill', counter: 'medals', targets: [1, 8, 25], name: ['Herausforderer', 'Challenger'], text: ['Hole {n} Medaillen in den Herausforderungen.', 'Earn {n} medals in the challenges.'] },
  { key: 'gold', group: 'skill', counter: 'goldMedals', targets: [1, 8], name: ['Goldfinger', 'Gold touch'], text: ['Hole {n} Goldmedaillen.', 'Earn {n} gold medals.'] },
  { key: 'streak', group: 'skill', counter: 'winStreak', targets: [3, 6, 10], name: ['Siegesserie', 'Winning streak'], text: ['Gewinne {n} Ligaspiele in Folge.', 'Win {n} league matches in a row.'] },
  // Career: the manager's story
  { key: 'seasons', group: 'career', counter: 'seasons', targets: [1, 4, 10], name: ['Dauerbrenner', 'Long haul'], text: ['Schließe {n} Saisons ab.', 'Complete {n} seasons.'] },
  { key: 'titles', group: 'career', counter: 'titles', targets: [1, 4], name: ['Meistertrainer', 'Champion manager'], text: ['Werde {n} Mal Meister.', 'Win the title {n} times.'] },
  { key: 'promotions', group: 'career', counter: 'promotions', targets: [1, 3], name: ['Aufsteiger', 'Climber'], text: ['Steige {n} Mal auf.', 'Win promotion {n} times.'] },
  { key: 'levels', group: 'career', counter: 'levelUps', targets: [5, 40, 150], name: ['Entwickler', 'Developer'], text: ['Deine Spieler erreichen {n} Level-ups.', 'Your players reach {n} level-ups.'] },
  { key: 'evolution', group: 'career', counter: 'evolutions', targets: [1, 8], name: ['Evolution', 'Evolution'], text: ['Entwickle {n} Signaturen weiter.', 'Evolve {n} signatures.'] },
  { key: 'signings', group: 'career', counter: 'signings', targets: [1, 15], name: ['Transfermarkt', 'Transfer market'], text: ['Verpflichte {n} Spieler.', 'Sign {n} players.'] },
  { key: 'training', group: 'career', counter: 'trainings', targets: [10, 60], name: ['Trainingsfleiß', 'Training ground'], text: ['Führe {n} Trainingseinheiten durch.', 'Run {n} training sessions.'] },
  { key: 'press', group: 'career', counter: 'pressConferences', targets: [1, 8], name: ['Medienprofi', 'Media pro'], text: ['Beantworte {n} Pressekonferenzen.', 'Answer {n} press conferences.'] },
  { key: 'staff', group: 'career', counter: 'staffHired', targets: [1, 4], name: ['Stab', 'Backroom'], text: ['Verpflichte {n} Mitarbeiter.', 'Hire {n} staff members.'] },
  { key: 'academy', group: 'career', counter: 'academyPromoted', targets: [1, 8], name: ['Eigengewächs', 'Homegrown'], text: ['Übernimm {n} Jugendspieler in den Kader.', 'Promote {n} academy players.'] },
  // Collection: Legends Team
  { key: 'packs', group: 'collection', counter: 'packsOpened', targets: [1, 15, 60], name: ['Packöffner', 'Pack opener'], text: ['Öffne {n} Packs.', 'Open {n} packs.'] },
  { key: 'cards', group: 'collection', counter: 'cardsMax', targets: [30, 100, 250], name: ['Sammler', 'Collector'], text: ['Besitze {n} Karten.', 'Own {n} cards.'] },
  { key: 'goldcards', group: 'collection', counter: 'goldMax', targets: [1, 12, 40], name: ['Goldrausch', 'Gold rush'], text: ['Besitze {n} verschiedene Gold-Karten.', 'Own {n} different gold cards.'] },
  { key: 'legends', group: 'collection', counter: 'legendMax', targets: [1, 5], name: ['Legendenjäger', 'Legend hunter'], text: ['Besitze {n} verschiedene Legenden.', 'Own {n} different legends.'] },
  { key: 'sbc', group: 'collection', counter: 'sbcs', targets: [1, 5, 15], name: ['Bastler', 'Builder'], text: ['Schließe {n} Bauaufgaben ab.', 'Complete {n} squad challenges.'] },
  { key: 'draft', group: 'collection', counter: 'draftWins', targets: [1, 8, 30], name: ['Draft-König', 'Draft king'], text: ['Gewinne {n} Draft-Runden.', 'Win {n} draft rounds.'] },
  { key: 'division', group: 'collection', counter: 'divisionDepth', targets: [3, 6, 9], name: ['Rivals-Aufstieg', 'Rivals climb'], text: ['Erreiche in Division Rivals mindestens Division {d}.', 'Reach division {d} or better in Division Rivals.'] },
  { key: 'album', group: 'collection', counter: 'albumSets', targets: [1, 4, 8], name: ['Albumfüller', 'Album filler'], text: ['Schließe {n} Albumsätze ab.', 'Complete {n} album sets.'] },
  { key: 'lwins', group: 'collection', counter: 'legendsWins', targets: [1, 15, 60], name: ['Legends-Sieger', 'Legends winner'], text: ['Gewinne {n} Spiele mit deinem Legends Team.', 'Win {n} matches with your Legends team.'] },
];

/** The wording of a step that asks for exactly one, where the plural of the ladder would read wrongly ("1 Tore"). */
const SINGULAR: Record<string, [string, string]> = {
  goals: ['Erziele ein Tor.', 'Score a goal.'],
  wins: ['Gewinne ein Spiel.', 'Win a match.'],
  clean: ['Spiele einmal zu null.', 'Keep a clean sheet.'],
  hattrick: ['Ein Spieler erzielt in einem Spiel drei Tore.', 'A player scores three goals in a match.'],
  rout: ['Gewinne einmal mit vier Toren Unterschied.', 'Win once by four goals.'],
  derby: ['Gewinne ein Derby.', 'Win a derby.'],
  medal: ['Hole eine Medaille in den Herausforderungen.', 'Earn a medal in the challenges.'],
  gold: ['Hole eine Goldmedaille.', 'Earn a gold medal.'],
  seasons: ['Schließe eine Saison ab.', 'Complete a season.'],
  titles: ['Werde einmal Meister.', 'Win the title once.'],
  promotions: ['Steige einmal auf.', 'Win promotion once.'],
  evolution: ['Entwickle eine Signatur weiter.', 'Evolve a signature.'],
  signings: ['Verpflichte einen Spieler.', 'Sign a player.'],
  press: ['Beantworte eine Pressekonferenz.', 'Answer a press conference.'],
  staff: ['Verpflichte einen Mitarbeiter.', 'Hire a staff member.'],
  academy: ['Übernimm einen Jugendspieler in den Kader.', 'Promote an academy player.'],
  packs: ['Öffne ein Pack.', 'Open a pack.'],
  goldcards: ['Besitze eine Gold-Karte.', 'Own a gold card.'],
  legends: ['Besitze eine Legende.', 'Own a legend.'],
  sbc: ['Schließe eine Bauaufgabe ab.', 'Complete a squad challenge.'],
  draft: ['Gewinne eine Draft-Runde.', 'Win a draft round.'],
  album: ['Schließe einen Albumsatz ab.', 'Complete an album set.'],
  lwins: ['Gewinne ein Spiel mit deinem Legends Team.', 'Win a match with your Legends team.'],
};

export const ACHIEVEMENTS: AchievementDef[] = LADDERS.flatMap((ladder) =>
  ladder.targets.map((target, index) => ({
    id: `${ladder.key}-${index + 1}`,
    group: ladder.group,
    counter: ladder.counter,
    target,
    step: index + 1,
    xp: STEP_XP[Math.min(index, STEP_XP.length - 1)],
    name: [`${ladder.name[0]} ${ROMAN[index]}`, `${ladder.name[1]} ${ROMAN[index]}`] as [string, string],
    text: (target === 1 && SINGULAR[ladder.key] ? SINGULAR[ladder.key] : ladder.text.map((line) => line.replace('{n}', String(target)).replace('{d}', String(11 - target)))) as [string, string],
  })),
);

/** Counters that only ever go up to their largest value, not add up (a record or the size of a collection). */
export const MAX_COUNTERS: ReadonlySet<string> = new Set(['winStreak', 'cardsMax', 'goldMax', 'legendMax', 'divisionDepth']);

export function achievementById(id: string): AchievementDef | undefined {
  return ACHIEVEMENTS.find((candidate) => candidate.id === id);
}

export function counterValue(meta: MetaState, counter: string): number {
  return meta.counters[counter] ?? 0;
}

/** Progress of one achievement, 0 to 1. */
export function achievementProgress(meta: MetaState, def: AchievementDef): number {
  return Math.min(1, counterValue(meta, def.counter) / def.target);
}

/**
 * Unlocks every achievement whose counter has reached its target. Each one unlocks exactly once: the order is kept, a second
 * call with the same counters returns nothing. Returns the achievements unlocked by this call, and adds their experience.
 */
export function unlockReached(meta: MetaState): AchievementDef[] {
  const fresh: AchievementDef[] = [];
  for (const def of ACHIEVEMENTS) {
    if (def.id in meta.unlocked || counterValue(meta, def.counter) < def.target) continue;
    meta.unlocked[def.id] = Object.keys(meta.unlocked).length + 1;
    meta.xp += def.xp;
    fresh.push(def);
  }
  return fresh;
}
