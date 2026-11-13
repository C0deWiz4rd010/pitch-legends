import { PlayerActionState } from '../../models/match.model';

/** Follow-through durations in fixed 60 Hz ticks. Contacts are simulation events. */
export const ACTION_DURATION_TICKS: Partial<Record<PlayerActionState, number>> = {
  receive: 11, 'heavy-touch': 15, pass: 20, 'through-pass': 22, lob: 27,
  shot: 30, 'low-shot': 25, 'finesse-shot': 31, 'chip-shot': 28, header: 23,
  'ball-roll': 23, 'drag-back': 25, 'skill-failed': 19, 'body-feint': 18, 'knock-on': 16,
  'standing-tackle': 20, slide: 38, stumble: 28,
  'keeper-catch': 42, 'keeper-parry': 40, 'keeper-dive': 66,
  'keeper-throw': 27, 'keeper-kick': 29, 'subbed-on': 24, injured: 150,
  'keeper-punch': 34, 'keeper-smother': 40, volley: 30, 'side-volley': 36, 'bicycle-kick': 44, 'flying-header': 36, 'wall-jump': 24, 'fake-shot': 22,
};

/**
 * Wind-up: ticks between the release (the tick the action starts) and the simulated ball contact. The pose of an action
 * swings back during this time and reaches the ball at exactly this tick, then follows through until the duration above.
 * Actions not listed here touch the ball at tick 0 (or have no contact, like a feint).
 */
export const ACTION_CONTACT_TICKS: Partial<Record<PlayerActionState, number>> = {
  pass: 3, 'through-pass': 3, lob: 4, shot: 5, 'low-shot': 5, 'finesse-shot': 5, 'chip-shot': 4,
  volley: 4, 'side-volley': 6, 'bicycle-kick': 10, 'flying-header': 12,
};

export function actionIsPlaying(action: PlayerActionState, startedTick: number, tick: number): boolean {
  return tick - startedTick < (ACTION_DURATION_TICKS[action] ?? 0);
}

const LOCOMOTION: ReadonlySet<PlayerActionState> = new Set<PlayerActionState>(['formation', 'idle', 'jog', 'sprint', 'carry', 'close-control', 'press', 'support-press', 'keeper-ready', 'keeper-rush', 'jockey']);

export function isLocomotionAction(action: PlayerActionState): boolean {
  return LOCOMOTION.has(action);
}
