import { clamp } from '../util';
import { ArcadeActor, FIELD_LENGTH, FIELD_WIDTH } from './match-types';

const CELL_SIZE = 6;
const COLUMNS = 18;
const ROWS = 12;
const MINIMUM_GAP = 1.05;

/** Mass-weighted player separation on a reusable 6 m spatial grid. */
export class PlayerCollisionGrid {
  private readonly grid: ArcadeActor[][] = Array.from({ length: COLUMNS * ROWS }, () => []);
  private readonly used: number[] = [];

  resolve(actors: readonly ArcadeActor[]): void {
    for (const index of this.used) this.grid[index].length = 0;
    this.used.length = 0;
    for (const actor of actors) {
      if (!actor.active) continue;
      const gx = Math.min(COLUMNS - 1, Math.floor(actor.x / CELL_SIZE));
      const gy = Math.min(ROWS - 1, Math.floor(actor.y / CELL_SIZE));
      const index = gy * COLUMNS + gx;
      if (this.grid[index].length === 0) this.used.push(index);
      this.grid[index].push(actor);
    }
    for (const actor of actors) {
      if (!actor.active) continue;
      const gx = Math.floor(actor.x / CELL_SIZE);
      const gy = Math.floor(actor.y / CELL_SIZE);
      for (let ox = -1; ox <= 1; ox++) for (let oy = -1; oy <= 1; oy++) {
        const cx = gx + ox;
        const cy = gy + oy;
        if (cx < 0 || cy < 0 || cx >= COLUMNS || cy >= ROWS) continue;
        for (const other of this.grid[cy * COLUMNS + cx]) {
          if (other === actor || other.player.id < actor.player.id) continue;
          separate(actor, other);
        }
      }
    }
  }
}

function separate(actor: ArcadeActor, other: ArcadeActor): void {
  const dx = other.x - actor.x;
  const dy = other.y - actor.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared >= MINIMUM_GAP * MINIMUM_GAP) return;
  const length = Math.sqrt(lengthSquared) || 0.001;
  const normalX = dx / length;
  const normalY = dy / length;
  const penetration = Math.max(0, MINIMUM_GAP - length - 0.02);
  const push = penetration * 0.78;
  const massA = 0.75 + actor.player.attributes.physical / 100;
  const massB = 0.75 + other.player.attributes.physical / 100;
  const totalMass = massA + massB;
  actor.x = clamp(actor.x - normalX * push * (massB / totalMass), 0.8, FIELD_LENGTH - 0.8);
  actor.y = clamp(actor.y - normalY * push * (massB / totalMass), 0.8, FIELD_WIDTH - 0.8);
  other.x = clamp(other.x + normalX * push * (massA / totalMass), 0.8, FIELD_LENGTH - 0.8);
  other.y = clamp(other.y + normalY * push * (massA / totalMass), 0.8, FIELD_WIDTH - 0.8);
  const closingSpeed = (other.vx - actor.vx) * normalX + (other.vy - actor.vy) * normalY;
  if (closingSpeed < 0) {
    const impulse = -closingSpeed * 0.32;
    actor.vx -= normalX * impulse * (massB / totalMass);
    actor.vy -= normalY * impulse * (massB / totalMass);
    other.vx += normalX * impulse * (massA / totalMass);
    other.vy += normalY * impulse * (massA / totalMass);
  }
}
