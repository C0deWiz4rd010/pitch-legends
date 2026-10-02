import type { ArcadeMatch, ScenarioSetup } from '../services/arcade-match';
import { FIELD_LENGTH, FIELD_WIDTH, MATCH_TICK } from './match-types';

export type ChallengeId = 'slalom' | 'passing' | 'finishing' | 'freekick' | 'penalty';
export type Medal = 'gold' | 'silver' | 'bronze';

export interface ChallengeDefinition {
  id: ChallengeId;
  de: string;
  en: string;
  descriptionDe: string;
  descriptionEn: string;
  /** Bronze, silver, gold thresholds. */
  medals: [number, number, number];
  lowerIsBetter: boolean;
  unit: { de: string; en: string };
  seed: number;
}

export const CHALLENGES: ChallengeDefinition[] = [
  { id: 'slalom', de: 'Dribbel-Parcours', en: 'Dribble course', descriptionDe: 'Umdribble die sechs Hütchen abwechselnd links und rechts und schieb ins leere Tor ein. Falsche Seite kostet 2 Sekunden.', descriptionEn: 'Dribble round the six cones, alternating sides, and finish into the empty goal. A wrong side costs 2 seconds.', medals: [24, 18, 14], lowerIsBetter: true, unit: { de: 's', en: 's' }, seed: 70101 },
  { id: 'passing', de: 'Passkombination', en: 'Passing combination', descriptionDe: '60 Sekunden: Spiele so viele Pässe wie möglich, ohne dass die zwei Verteidiger den Ball erobern.', descriptionEn: '60 seconds: complete as many passes as you can while two defenders hunt the ball.', medals: [6, 10, 15], lowerIsBetter: false, unit: { de: 'Pässe', en: 'passes' }, seed: 70102 },
  { id: 'finishing', de: 'Abschluss', en: 'Finishing', descriptionDe: '8 Versuche aus rund 24 Metern gegen den Torwart.', descriptionEn: '8 attempts from about 24 metres against the keeper.', medals: [3, 5, 7], lowerIsBetter: false, unit: { de: 'Tore', en: 'goals' }, seed: 70103 },
  { id: 'freekick', de: 'Freistöße', en: 'Free kicks', descriptionDe: '5 direkte Freistöße über die Mauer.', descriptionEn: '5 direct free kicks over the wall.', medals: [1, 2, 3], lowerIsBetter: false, unit: { de: 'Tore', en: 'goals' }, seed: 70104 },
  { id: 'penalty', de: 'Elfmeter', en: 'Penalties', descriptionDe: '5 Elfmeter. Der Torwart wählt eine Ecke.', descriptionEn: '5 penalties. The keeper picks a corner.', medals: [3, 4, 5], lowerIsBetter: false, unit: { de: 'Tore', en: 'goals' }, seed: 70105 },
];

export function medalFor(definition: ChallengeDefinition, score: number): Medal | null {
  const [bronze, silver, gold] = definition.medals;
  const reached = (limit: number) => definition.lowerIsBetter ? score <= limit : score >= limit;
  return reached(gold) ? 'gold' : reached(silver) ? 'silver' : reached(bronze) ? 'bronze' : null;
}

export interface ChallengeMarker { x: number; y: number; done: boolean }

export interface ChallengeHud {
  attempt: number;
  attempts: number;
  score: number;
  seconds: number;
  /** Feedback for the last attempt, e.g. "TOR" / "GOAL". */
  flash: { de: string; en: string } | null;
}

export interface ChallengeOutcome {
  id: ChallengeId;
  score: number;
  medal: Medal | null;
}

/**
 * Drives one challenge on top of a normal match: sets up every attempt, watches the match after
 * each 60 Hz step and ends the challenge. The match engine itself stays unchanged.
 */
export class ChallengeController {
  done = false;
  private attempt = 0;
  private score = 0;
  private attemptStartTick = 0;
  private startTick = 0;
  private goalsBefore = 0;
  private passesBefore = 0;
  private flash: ChallengeHud['flash'] = null;
  private flashUntil = 0;
  private cones: ChallengeMarker[] = [];
  private penalties = 0;
  private finishSeconds = 0;
  /** Tick at which the ball came into play (set pieces wait for the kick). */
  private kickedAt: number | null = null;

  constructor(readonly definition: ChallengeDefinition, private readonly match: ArcadeMatch) {}

  get attempts(): number {
    return this.definition.id === 'finishing' ? 8 : this.definition.id === 'freekick' || this.definition.id === 'penalty' ? 5 : 1;
  }

  start(): void {
    this.startTick = this.match.tick;
    this.passesBefore = this.match.homeStats.passesCompleted;
    this.nextAttempt();
  }

  private nextAttempt(): void {
    const match = this.match;
    if (match.phase === 'goalReplay') match.endReplay();
    this.attemptStartTick = match.tick;
    this.kickedAt = null;
    this.goalsBefore = match.homeScore;
    match.setupScenario(this.setup(this.attempt));
  }

  private setup(attempt: number): ScenarioSetup {
    const L = FIELD_LENGTH, W = FIELD_WIDTH, mid = W / 2;
    const keeper = { index: 0, x: L - 1.2, y: mid };
    switch (this.definition.id) {
      case 'slalom': {
        this.cones = Array.from({ length: 6 }, (_, index) => ({ x: 34 + index * 8.5, y: mid + (index % 2 ? 4 : -4), done: false }));
        return { home: [{ index: 9, x: 26, y: mid }], away: [], ball: { x: 26.6, y: mid, owner: { side: 'home', index: 9 } } };
      }
      case 'passing':
        return {
          home: [{ index: 5, x: 40, y: mid - 8 }, { index: 6, x: 48, y: mid + 8 }, { index: 7, x: 56, y: mid - 8 }, { index: 9, x: 48, y: mid - 1 }],
          away: [{ index: 2, x: 50, y: mid + 2 }, { index: 3, x: 44, y: mid - 3 }],
          ball: { x: 40.6, y: mid - 8, owner: { side: 'home', index: 5 } },
        };
      case 'finishing': {
        const lateral = [-8, 6, -3, 9, 0, -10, 4, -6][attempt % 8];
        return { home: [{ index: 9, x: L - 24, y: mid + lateral }], away: [keeper], ball: { x: L - 23.4, y: mid + lateral, owner: { side: 'home', index: 9 } } };
      }
      case 'freekick': {
        const spot = [{ x: L - 22, y: mid - 4 }, { x: L - 25, y: mid + 6 }, { x: L - 20, y: mid + 9 }, { x: L - 24, y: mid }, { x: L - 21, y: mid - 9 }][attempt % 5];
        return {
          home: [{ index: 9, x: spot.x - 0.5, y: spot.y }],
          away: [keeper, { index: 2, x: L - 12, y: mid - 2 }, { index: 3, x: L - 12, y: mid }, { index: 5, x: L - 12, y: mid + 2 }, { index: 6, x: L - 12, y: mid + 4 }],
          ball: { x: spot.x, y: spot.y }, restart: { phase: 'freeKick', side: 'home' },
        };
      }
      case 'penalty':
        return { home: [{ index: 9, x: L - 13, y: mid }], away: [keeper], ball: { x: L - 11, y: mid }, restart: { phase: 'penalty', side: 'home' } };
    }
  }

  /** Called after every simulation step. */
  afterStep(): void {
    if (this.done) return;
    const match = this.match;
    const tick = match.tick;
    const seconds = (tick - this.attemptStartTick) * MATCH_TICK;
    const scored = match.homeScore > this.goalsBefore;
    if (this.flash && tick > this.flashUntil) this.flash = null;
    switch (this.definition.id) {
      case 'slalom': return this.slalom(scored);
      case 'passing': return this.passing();
      default: {
        const lost = this.attemptOver(seconds);
        if (scored || lost) this.endAttempt(scored);
      }
    }
  }

  private attemptOver(seconds: number): boolean {
    const match = this.match;
    const live = match.rule.phase === 'playing' || match.rule.phase === 'advantage';
    if (live && this.kickedAt === null) this.kickedAt = match.tick;
    // Penalties and free kicks wait for the taker (with a generous cap).
    if (this.kickedAt === null) return seconds > 30;
    const sinceKick = (match.tick - this.kickedAt) * MATCH_TICK;
    if (sinceKick > (this.definition.id === 'finishing' ? 8 : 5)) return true;
    // Ball held by the keeper or a defender, or out of play.
    const owner = match.actors.find((actor) => actor.player.id === match.ball.ownerId);
    if (owner && owner.side === 'away') return true;
    if (!live) return true;
    // A free ball that has stopped.
    return !match.ball.ownerId && Math.hypot(match.ball.vx, match.ball.vy) < 0.4 && sinceKick > 2;
  }

  private endAttempt(scored: boolean): void {
    if (scored) this.score++;
    this.flash = scored ? { de: 'TOR!', en: 'GOAL!' } : { de: 'VERGEBEN', en: 'MISSED' };
    this.flashUntil = this.match.tick + 70;
    this.attempt++;
    if (this.attempt >= this.attempts) { this.done = true; return; }
    this.nextAttempt();
  }

  private slalom(scored: boolean): void {
    const match = this.match;
    const runner = match.actors.find((actor) => actor.player.id === match.selectedPlayerId);
    const elapsed = (match.tick - this.startTick) * MATCH_TICK;
    if (runner) {
      for (const [index, cone] of this.cones.entries()) {
        if (cone.done || runner.x < cone.x) continue;
        cone.done = true;
        const wantsLeft = index % 2 === 0; // pass the first cone on the right-hand side of the screen (y > cone)
        const correct = wantsLeft ? runner.y > cone.y : runner.y < cone.y;
        if (!correct) { this.penalties += 2; this.flash = { de: '+2 S', en: '+2 S' }; this.flashUntil = match.tick + 60; }
      }
    }
    if (scored) {
      this.finishSeconds = Math.round((elapsed + this.penalties) * 10) / 10;
      this.score = this.finishSeconds;
      this.done = true;
      return;
    }
    // Lost the ball or out: start again from the beginning, the clock keeps running.
    if (match.rule.phase !== 'playing' && match.rule.phase !== 'advantage' || elapsed > 60) {
      if (elapsed > 60) { this.score = 99; this.done = true; return; }
      this.nextAttempt();
    }
  }

  private passing(): void {
    const match = this.match;
    const elapsed = (match.tick - this.startTick) * MATCH_TICK;
    this.score = match.homeStats.passesCompleted - this.passesBefore;
    const owner = match.actors.find((actor) => actor.player.id === match.ball.ownerId);
    const out = match.rule.phase !== 'playing' && match.rule.phase !== 'advantage';
    if (elapsed >= 60) { this.done = true; return; }
    if (out || owner?.side === 'away') {
      // Possession lost: the counter stays, play restarts with the ball back at the squad.
      this.flash = { de: 'BALLVERLUST', en: 'TURNOVER' };
      this.flashUntil = match.tick + 60;
      const start = this.attemptStartTick;
      this.nextAttempt();
      this.attemptStartTick = start;
    }
  }

  hud(): ChallengeHud {
    const elapsed = (this.match.tick - this.startTick) * MATCH_TICK;
    const seconds = this.definition.id === 'passing' ? Math.max(0, 60 - elapsed) : this.definition.id === 'slalom' ? elapsed + this.penalties : 0;
    return { attempt: Math.min(this.attempt + 1, this.attempts), attempts: this.attempts, score: this.definition.id === 'slalom' ? this.penalties : this.score, seconds: Math.round(seconds * 10) / 10, flash: this.flash };
  }

  markers(): ChallengeMarker[] {
    return this.cones;
  }

  outcome(): ChallengeOutcome {
    return { id: this.definition.id, score: this.score, medal: medalFor(this.definition, this.score) };
  }
}

const RECORDS_KEY = 'pitch-legends:challenges:v1';

export type ChallengeRecords = Partial<Record<ChallengeId, { best: number; medal: Medal | null; attempts: number }>>;

export function loadChallengeRecords(): ChallengeRecords {
  try { return JSON.parse(localStorage.getItem(RECORDS_KEY) ?? '{}') as ChallengeRecords; } catch { return {}; }
}

/** Stores a result and returns whether it is a new personal best. */
export function saveChallengeResult(outcome: ChallengeOutcome): boolean {
  const records = loadChallengeRecords();
  const definition = CHALLENGES.find((candidate) => candidate.id === outcome.id)!;
  const previous = records[outcome.id];
  const better = !previous || (definition.lowerIsBetter ? outcome.score < previous.best : outcome.score > previous.best);
  records[outcome.id] = {
    best: better ? outcome.score : previous!.best,
    medal: better ? outcome.medal : previous!.medal,
    attempts: (previous?.attempts ?? 0) + 1,
  };
  try { localStorage.setItem(RECORDS_KEY, JSON.stringify(records)); } catch { /* the result just is not remembered */ }
  return better;
}
