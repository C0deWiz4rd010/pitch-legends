/**
 * GPU time per frame through EXT_disjoint_timer_query_webgl2, where the browser offers it. A query wraps the frame's draw
 * calls; its result is read a few frames later, when the GPU has finished, and smoothed. Without the extension (many
 * browsers hide it) `ms` stays null and the quality policy falls back to frame intervals.
 */
export class GpuTimer {
  private readonly extension: { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number } | null;
  private readonly pending: WebGLQuery[] = [];
  private active: WebGLQuery | null = null;
  private smoothed: number | null = null;

  /** The first results include shader compilation and uploads, which say nothing about steady play: `warmup` of them are dropped. */
  constructor(private readonly gl: WebGL2RenderingContext, private warmup = 12) {
    this.extension = gl.getExtension('EXT_disjoint_timer_query_webgl2') as GpuTimer['extension'];
  }

  get available(): boolean {
    return this.extension !== null;
  }

  /** Smoothed GPU milliseconds per frame, or null before the first result (or without a timer). */
  get ms(): number | null {
    return this.smoothed;
  }

  begin(): void {
    if (!this.extension || this.active || this.pending.length >= 8) return;
    const query = this.gl.createQuery();
    if (!query) return;
    this.gl.beginQuery(this.extension.TIME_ELAPSED_EXT, query);
    this.active = query;
  }

  end(): void {
    if (!this.extension || !this.active) return;
    this.gl.endQuery(this.extension.TIME_ELAPSED_EXT);
    this.pending.push(this.active);
    this.active = null;
  }

  /** Reads the results of the frames that have finished; call once per frame after `end`. */
  poll(): void {
    if (!this.extension) return;
    const disjoint = !!this.gl.getParameter(this.extension.GPU_DISJOINT_EXT);
    while (this.pending.length) {
      const query = this.pending[0];
      if (!this.gl.getQueryParameter(query, this.gl.QUERY_RESULT_AVAILABLE)) break;
      this.pending.shift();
      // A disjoint event (power state change, context switch) invalidates what was measured.
      if (this.warmup > 0) this.warmup--;
      else if (!disjoint) {
        const milliseconds = Number(this.gl.getQueryParameter(query, this.gl.QUERY_RESULT)) / 1e6;
        this.smoothed = this.smoothed === null ? milliseconds : this.smoothed * 0.9 + milliseconds * 0.1;
      }
      this.gl.deleteQuery(query);
    }
  }

  dispose(): void {
    for (const query of this.pending) this.gl.deleteQuery(query);
    if (this.active) this.gl.deleteQuery(this.active);
    this.pending.length = 0;
    this.active = null;
  }
}
