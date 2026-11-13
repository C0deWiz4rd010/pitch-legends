import { CrestPattern, StadiumVisualTheme } from '../../../models/visual.model';

/** What a ground of a given expansion level consists of. Pure data, so the levels can be checked without a renderer. */
export interface StadiumPlan {
  /** Rows of the far long stand, the two ends and the main stand on the camera side. */
  farRows: number;
  endRows: number;
  mainRows: number;
  /** Rows of a second tier on the two long stands (0: none). */
  upperRows: number;
  /** Grass banks behind the goals instead of stands. */
  banks: boolean;
  roof: 'none' | 'long' | 'all';
  /** The corners between the stands are built up: a closed bowl. */
  corners: boolean;
  /** Height of the four floodlight masts in metres; 0 when the lamps hang under the roof instead. */
  mastHeight: number;
  /** Everybody stands (a terrace without seats). */
  terrace: boolean;
  /** Share of the places that are taken, 0 to 1. */
  fill: number;
}

/**
 * The five expansion levels of the career, from a village pitch with a standing bank to a closed two-tier bowl. The style of
 * the club shifts the picture a little: compact grounds are a row lower, bowls close their corners a level earlier.
 */
export function stadiumPlan(level: number, style: StadiumVisualTheme['standStyle']): StadiumPlan {
  const tier = Math.max(1, Math.min(5, Math.round(level)));
  const shift = style === 'compact' ? -1 : style === 'bowl' ? 1 : 0;
  const rows = (base: number) => Math.max(2, base + shift);
  if (tier === 1) return { farRows: rows(3), endRows: 0, mainRows: rows(2), upperRows: 0, banks: true, roof: 'none', corners: false, mastHeight: 10, terrace: true, fill: 0.5 };
  if (tier === 2) return { farRows: rows(6), endRows: rows(3), mainRows: rows(5), upperRows: 0, banks: false, roof: style === 'classic' ? 'long' : 'none', corners: false, mastHeight: 13, terrace: false, fill: 0.68 };
  if (tier === 3) return { farRows: rows(8), endRows: rows(6), mainRows: rows(8), upperRows: 0, banks: false, roof: 'long', corners: false, mastHeight: 16, terrace: false, fill: 0.8 };
  if (tier === 4) return { farRows: rows(9), endRows: rows(8), mainRows: rows(9), upperRows: 0, banks: false, roof: 'all', corners: style === 'bowl', mastHeight: 17, terrace: false, fill: 0.88 };
  return { farRows: rows(9), endRows: rows(9), mainRows: rows(9), upperRows: 5, banks: false, roof: 'all', corners: true, mastHeight: 0, terrace: false, fill: 0.95 };
}

/** Rise and depth of one row, and where the first row of each stand begins (metres from the centre of the pitch). */
export const ROW_RISE = 0.62;
export const ROW_DEPTH = 0.95;
export const LONG_STAND_START = 41;
export const END_STAND_START = 59;
/** Half length of a long stand and of an end stand. */
export const LONG_HALF = 55;
export const END_HALF = 38;

export interface Seat {
  x: number; y: number; z: number;
  /** 0 home supporter, 1 away supporter, 2 staff and press (they never jump or wave). */
  block: 0 | 1 | 2;
  /** Position round the ground, 0 to 1: the La Ola travels along it. */
  around: number;
  /** On the main stand (camera side): only drawn when the camera looks back at it. */
  main: boolean;
  /** Along (0 to 1) and up (0 to 1) the far stand, for the mosaic before kick-off; -1 elsewhere. */
  u: number; v: number;
}

/** A cheap, stable 0-to-1 number per seat. */
export function seatRoll(seed: number, index: number): number {
  let h = (seed ^ Math.imul(index + 1, 0x9e3779b1)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/**
 * Every taken place of the ground. `step` is the distance between neighbours in metres (denser on the high profile).
 * The away supporters stand in the far half of the end at +x; aisles and the players' tunnel stay free.
 */
export function stadiumSeats(plan: StadiumPlan, seed: number, step: number): Seat[] {
  const seats: Seat[] = [];
  let index = 0;
  const around = (x: number, z: number) => Math.atan2(z, x) / (Math.PI * 2) + 0.5;
  const place = (x: number, y: number, z: number, block: 0 | 1, main: boolean, u = -1, v = -1) => {
    if (seatRoll(seed, index++) > plan.fill) return;
    seats.push({ x, y, z, block, around: around(x, z), main, u, v });
  };
  const long = (side: -1 | 1, rows: number, upper: number) => {
    const total = rows + upper;
    for (let row = 0; row < total; row++) {
      const tier = row >= rows;
      // The second tier starts behind a walkway and a little higher.
      const depth = LONG_STAND_START + row * ROW_DEPTH + (tier ? 2.4 : 0), height = 0.7 + row * ROW_RISE + (tier ? 1.5 : 0);
      for (let along = -LONG_HALF + 1; along <= LONG_HALF - 1; along += step) {
        if (Math.abs(((along % 16) + 16) % 16 - 8) > 7.3) continue;
        if (side < 0 && !tier && row < 4 && Math.abs(along) < 3.4) continue;
        place(along, height, side * depth, 0, side > 0, side < 0 ? (along + LONG_HALF) / (LONG_HALF * 2) : -1, side < 0 ? row / Math.max(1, total - 1) : -1);
      }
    }
  };
  long(-1, plan.farRows, plan.upperRows);
  long(1, plan.mainRows, plan.upperRows);
  for (const end of [-1, 1] as const) {
    for (let row = 0; row < plan.endRows; row++) {
      for (let along = -END_HALF + 1; along <= END_HALF - 1; along += step) {
        if (Math.abs(((along % 12) + 12) % 12 - 6) > 5.35) continue;
        // The near part of each end belongs to the camera side of the ground.
        place(end * (END_STAND_START + row * ROW_DEPTH), 0.7 + row * ROW_RISE, along, end > 0 && along < -10 ? 1 : 0, false);
      }
    }
    if (plan.banks) {
      // A handful of people on the grass bank behind each goal.
      for (let row = 0; row < 2; row++) for (let along = -END_HALF + 4; along <= END_HALF - 4; along += step * 2.2) {
        place(end * (END_STAND_START + 0.6 + row * 1.5), 0.35 + row * 0.7, along + row, end > 0 && along < -10 ? 1 : 0, false);
      }
    }
  }
  return seats;
}

/** Colour index (0 shirt, 1 secondary, 2 trim) of a card in the mosaic before kick-off, from the pattern of the club's ground. */
export function mosaicColor(pattern: CrestPattern, u: number, v: number): 0 | 1 | 2 {
  // A light frame runs round the whole picture.
  if (u < 0.02 || u > 0.98 || v > 0.9) return 2;
  if (pattern === 'stripe') return Math.floor(u * 12) % 2 ? 1 : 0;
  if (pattern === 'hoops') return Math.floor(v * 5) % 2 ? 1 : 0;
  if (pattern === 'halves') return u < 0.5 ? 0 : 1;
  if (pattern === 'quarters') return (u < 0.5) === (v < 0.5) ? 0 : 1;
  if (pattern === 'sash') return Math.abs(u - v * 0.35 - 0.33) < 0.07 ? 1 : 0;
  if (pattern === 'chevron') return Math.abs(Math.abs(u - 0.5) * 1.6 - (0.8 - v)) < 0.09 ? 1 : 0;
  // Plain grounds show one broad band across the middle.
  return v > 0.38 && v < 0.6 ? 1 : 0;
}
