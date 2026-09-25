import { PlayerActionState } from '../../models/match.model';

/** Follow-through durations in fixed 60 Hz ticks. Contacts are simulation events. */
export const ACTION_DURATION_TICKS: Partial<Record<PlayerActionState, number>> = {
  receive: 11, 'heavy-touch': 15, pass: 20, 'through-pass': 22, lob: 27,
  shot: 30, 'low-shot': 25, 'finesse-shot': 31, 'chip-shot': 28, header: 23,
  'ball-roll': 23, 'drag-back': 25, 'skill-failed': 19, 'body-feint': 18, 'knock-on': 16,
  'standing-tackle': 20, slide: 38, stumble: 28,
  'keeper-catch': 42, 'keeper-parry': 40, 'keeper-dive': 66,
  'keeper-throw': 27, 'keeper-kick': 29, 'subbed-on': 24, injured: 150,
};

export function actionIsPlaying(action: PlayerActionState, startedTick: number, tick: number): boolean {
  return tick - startedTick < (ACTION_DURATION_TICKS[action] ?? 0);
}

const LOCOMOTION: ReadonlySet<PlayerActionState> = new Set<PlayerActionState>(['formation', 'idle', 'jog', 'sprint', 'carry', 'close-control', 'press', 'support-press', 'keeper-ready', 'keeper-rush', 'jockey']);

export function isLocomotionAction(action: PlayerActionState): boolean {
  return LOCOMOTION.has(action);
}
