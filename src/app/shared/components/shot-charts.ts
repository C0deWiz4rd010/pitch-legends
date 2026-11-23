import { ShotRecord, Side } from '../../models/match.model';

/** One step of a cumulative xG line: the minute of a shot and the total after it. */
export interface XgStep { minute: number; total: number; goal: boolean }

/** Cumulative expected goals of one side, shot by shot, in the order they were taken. */
export function xgSteps(shots: readonly ShotRecord[], side: Side): XgStep[] {
  let total = 0;
  return shots.filter((shot) => shot.side === side).map((shot) => {
    total = Math.round((total + shot.xG) * 100) / 100;
    return { minute: shot.minute, total, goal: shot.goal };
  });
}

/** Last minute on the time axis: the regular ninety (or the half that was played), longer when shots came later. */
export function xgAxisEnd(shots: readonly ShotRecord[], minute: number): number {
  return Math.max(15, minute, ...shots.map((shot) => shot.minute));
}

/**
 * The stepped path of a cumulative xG line in a chart of `width` by `height`: flat until a shot, then straight up.
 * `peak` is the value at the top of the chart.
 */
export function xgPath(steps: readonly XgStep[], end: number, peak: number, width: number, height: number): string {
  const x = (minute: number) => Math.round(Math.min(1, minute / end) * width * 100) / 100;
  const y = (total: number) => Math.round((height - Math.min(1, total / peak) * height) * 100) / 100;
  let path = `M0 ${height}`, last = 0;
  for (const step of steps) {
    path += ` L${x(step.minute)} ${y(last)} L${x(step.minute)} ${y(step.total)}`;
    last = step.total;
  }
  return `${path} L${width} ${y(last)}`;
}

/** A shot on the shot map: the home side attacks to the right, the away side to the left. */
export function shotMarker(shot: ShotRecord, length = 105, width = 68): { x: number; y: number; r: number } {
  const home = shot.side === 'home';
  return { x: home ? shot.x : length - shot.x, y: home ? shot.y : width - shot.y, r: 0.9 + Math.sqrt(Math.max(0, shot.xG)) * 2.6 };
}
