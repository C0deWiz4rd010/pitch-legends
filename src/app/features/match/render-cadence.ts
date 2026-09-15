/** Accumulates visual time while keeping software rasterization below driver capacity. */
export class RenderCadence {
  private accumulated = 0;
  constructor(private readonly interval = 0) {}

  consume(delta: number): number {
    this.accumulated += Math.max(0, delta);
    if (this.accumulated + .001 < this.interval) return 0;
    const elapsed = this.accumulated;
    this.accumulated = 0;
    return elapsed;
  }
}
