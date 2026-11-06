/**
 * Wear of the pitch: a coarse map of where players have run. Every stamp darkens the texel under a player and, less, its
 * neighbours; the renderer lays the map over the grass as browner, worn turf. Purely visual, never read by the simulation.
 */
export const WEAR_WIDTH = 128;
export const WEAR_HEIGHT = 84;

/** Texel of a point on the pitch (real coordinates, not mirrored for the camera). */
export function wearTexel(x: number, y: number, length: number, width: number): { column: number; row: number } {
  const column = Math.min(WEAR_WIDTH - 1, Math.max(0, Math.floor((x / length) * WEAR_WIDTH)));
  // Row 0 is the bottom of the texture, which lies at the pitch's y = width side (see the plane's orientation).
  const row = Math.min(WEAR_HEIGHT - 1, Math.max(0, Math.floor((1 - y / width) * WEAR_HEIGHT)));
  return { column, row };
}

/** Adds one footstep: the texel under the player a little more than its left and right neighbours. Saturates at 255. */
export function stampWear(data: Uint8Array, x: number, y: number, length: number, width: number, strength = 2): void {
  const { column, row } = wearTexel(x, y, length, width);
  const at = row * WEAR_WIDTH + column;
  data[at] = Math.min(255, data[at] + strength);
  if (column > 0) data[at - 1] = Math.min(255, data[at - 1] + Math.max(1, strength >> 1));
  if (column < WEAR_WIDTH - 1) data[at + 1] = Math.min(255, data[at + 1] + Math.max(1, strength >> 1));
}

/** Mean wear of the map, 0 to 1: how much of the pitch has been worn. */
export function meanWear(data: Uint8Array): number {
  let sum = 0;
  for (let i = 0; i < data.length; i++) sum += data[i];
  return sum / (data.length * 255);
}
