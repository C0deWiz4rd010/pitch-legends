import type { MatchEvent, ShotRecord, Side } from '../../models/match.model';

/** A broadcast caption at the bottom of the picture: what just happened and to whom. */
export interface LowerThird {
  kind: 'goal' | 'own-goal' | 'yellow' | 'red' | 'sub' | 'injury';
  side: Side | null;
  /** Small line on top: what it is and the minute. */
  kicker: string;
  /** The name in large letters. */
  title: string;
  /** One line of detail under it. */
  detail: string;
}

export interface LowerThirdContext {
  pick(de: string, en: string): string;
  teamName(side: Side): string;
  /** The score right after the event, as "2:1". */
  score: string;
  shots: readonly ShotRecord[];
}

/** Seconds a caption stays up, and the pause before the next one. */
export const LOWER_THIRD_SECONDS = 4.2;
export const LOWER_THIRD_GAP = 0.35;

const param = (event: MatchEvent, key: string): string => String(event.params?.[key] ?? '');

/** The caption an event gets, or null for events that are not shown as one (shots, fouls, kick-off …). */
export function lowerThirdFor(event: MatchEvent, c: LowerThirdContext): LowerThird | null {
  const minute = `${event.minute}'`;
  const team = event.side ? c.teamName(event.side) : '';
  switch (event.type) {
    case 'goal': {
      if (event.ownGoal) {
        return { kind: 'own-goal', side: event.side, kicker: `${c.pick('Eigentor', 'Own goal')} · ${minute}`, title: event.playerName ?? param(event, 'player'), detail: `${team} ${c.score}` };
      }
      // The shot that went in, for its xG (the last goal of the side in the shot log).
      let xG: number | null = null;
      for (let index = c.shots.length - 1; index >= 0; index--) {
        const shot = c.shots[index];
        if (shot.side === event.side && shot.goal) { xG = shot.xG; break; }
      }
      const parts = [`${team} ${c.score}`];
      if (event.assistName) parts.push(`${c.pick('Vorlage', 'Assist')} ${event.assistName}`);
      if (xG !== null) parts.push(`xG ${xG.toFixed(2)}`);
      return { kind: 'goal', side: event.side, kicker: `${c.pick('Tor', 'Goal')} · ${minute}`, title: event.playerName ?? param(event, 'player'), detail: parts.join(' · ') };
    }
    case 'yellow':
      return { kind: 'yellow', side: event.side, kicker: `${c.pick('Gelbe Karte', 'Yellow card')} · ${minute}`, title: param(event, 'player'), detail: team };
    case 'red':
      return { kind: 'red', side: event.side, kicker: `${c.pick('Rote Karte', 'Red card')} · ${minute}`, title: param(event, 'player'), detail: `${team} · ${c.pick('in Unterzahl', 'down to ten')}` };
    case 'sub':
      return { kind: 'sub', side: event.side, kicker: `${c.pick('Wechsel', 'Substitution')} · ${team} · ${minute}`, title: `▲ ${param(event, 'incoming')}`, detail: `▼ ${param(event, 'outgoing')}` };
    case 'injury':
      return { kind: 'injury', side: event.side, kicker: `${c.pick('Verletzung', 'Injury')} · ${minute}`, title: param(event, 'player'), detail: team };
    default:
      return null;
  }
}

/**
 * Captions one after the other: each stays up for LOWER_THIRD_SECONDS, then the next follows after a short gap. While
 * `hold` is set (a goal replay) nothing new comes up, so a caption queued at the goal is shown in full afterwards.
 */
export class LowerThirdQueue {
  private waiting: LowerThird[] = [];
  private until = 0;
  current: LowerThird | null = null;

  push(banner: LowerThird): void { this.waiting.push(banner); }

  clear(): void { this.waiting = []; this.until = 0; this.current = null; }

  /** Moves on by the clock (milliseconds); returns true when the caption on screen changed. */
  advance(now: number, hold: boolean): boolean {
    if (hold || now < this.until) return false;
    if (this.current) {
      this.current = null;
      this.until = now + LOWER_THIRD_GAP * 1000;
      return true;
    }
    const next = this.waiting.shift();
    if (!next) return false;
    this.current = next;
    this.until = now + LOWER_THIRD_SECONDS * 1000;
    return true;
  }
}
