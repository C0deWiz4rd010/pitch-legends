const CAPACITY = 3600;

/** Bounded local diagnostics; never sent to a server or included in simulation state. */
export class MatchMetrics {
  private readonly frame = new Float32Array(CAPACITY);
  private readonly simulation = new Float32Array(CAPACITY);
  private readonly render = new Float32Array(CAPACITY);
  /** Button edge to submitted frame in ms; NaN for frames that consumed no edge. */
  private readonly input = new Float32Array(CAPACITY).fill(NaN);
  private cursor = 0;
  private count = 0;

  record(frame: number, simulation: number, render: number, inputLatency = NaN): void {
    this.frame[this.cursor] = frame;
    this.simulation[this.cursor] = simulation;
    this.render[this.cursor] = render;
    this.input[this.cursor] = inputLatency;
    this.cursor = (this.cursor + 1) % CAPACITY;
    if (this.count < CAPACITY) this.count++;
  }

  summary() {
    // Each series is sorted once, then every percentile is a lookup.
    const sorted = (series: Float32Array, skipNaN = false) => {
      const values = Float32Array.from(series.subarray(0, this.count));
      if (!skipNaN) return values.sort();
      const kept = values.filter((value) => !Number.isNaN(value));
      return kept.sort();
    };
    const at = (values: Float32Array, p: number) => values[Math.max(0, Math.ceil(values.length * p) - 1)] ?? 0;
    const frame = sorted(this.frame), simulation = sorted(this.simulation), render = sorted(this.render), input = sorted(this.input, true);
    return {
      samples: this.count, frameMedian: at(frame, .5), frameP95: at(frame, .95), frameP99: at(frame, .99),
      simulationP95: at(simulation, .95), renderP95: at(render, .95),
      inputSamples: input.length, inputLatencyP95: at(input, .95),
    };
  }
}
