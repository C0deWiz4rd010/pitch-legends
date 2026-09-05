/** Bounded local diagnostics; never sent to a server or included in simulation state. */
export class MatchMetrics {
  private readonly samples: { frame: number; simulation: number; render: number }[] = [];
  private cursor = 0;
  record(frame: number, simulation: number, render: number): void {
    this.samples[this.cursor] = { frame, simulation, render };
    this.cursor = (this.cursor + 1) % 3600;
  }
  summary() {
    const percentile = (key: 'frame' | 'simulation' | 'render', p: number) => {
      const values = this.samples.map((sample) => sample[key]).sort((a, b) => a - b);
      return values[Math.max(0, Math.ceil(values.length * p) - 1)] ?? 0;
    };
    return { samples: this.samples.length, frameMedian: percentile('frame', .5), frameP95: percentile('frame', .95), frameP99: percentile('frame', .99), simulationP95: percentile('simulation', .95), renderP95: percentile('render', .95) };
  }
}
