import { TestBed } from '@angular/core/testing';
import { DEFAULT_GRAPHICS_PREFS, sanitizeGraphicsPrefs } from './core/graphics-prefs';
import { GraphicsPrefsService } from './core/services/graphics-prefs.service';
import { GpuTimer } from './features/match/gpu-timer';
import { decideQuality, GPU_HEADROOM_MS, GPU_OVER_MS, QualityInput } from './features/match/quality-policy';
import { RenderCadence } from './features/match/render-cadence';

const base: QualityInput = { average: 1 / 60, gpuMs: null, quality: 'high', ceiling: 'high', cooldown: 0, stable: 0, downgrades: 0, software: false };

describe('Phase 6 – graphics preferences', () => {
  afterEach(() => { localStorage.clear(); TestBed.resetTestingModule(); });

  it('falls back to the defaults for anything invalid and clamps the render scale', () => {
    expect(sanitizeGraphicsPrefs(null)).toEqual(DEFAULT_GRAPHICS_PREFS);
    expect(sanitizeGraphicsPrefs({ quality: 'ultra', frameCap: 144, renderScale: 'big' })).toEqual(DEFAULT_GRAPHICS_PREFS);
    expect(sanitizeGraphicsPrefs({ quality: 'low', frameCap: 30, renderScale: 0.1 })).toEqual({ quality: 'low', frameCap: 30, renderScale: 0.5 });
    expect(sanitizeGraphicsPrefs({ renderScale: 7 }).renderScale).toBe(1);
  });

  it('keeps the choice on the device across sessions', () => {
    TestBed.configureTestingModule({});
    TestBed.inject(GraphicsPrefsService).update({ quality: 'balanced', frameCap: 60, renderScale: 0.8 });
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({});
    expect(TestBed.inject(GraphicsPrefsService).prefs()).toEqual({ quality: 'balanced', frameCap: 60, renderScale: 0.8 });
  });
});

describe('Phase 6 – quality policy', () => {
  it('without a GPU timer behaves as before: slow frames step down, fast ones earn the profile back', () => {
    expect(decideQuality({ ...base, average: 0.03 }).action).toBe('down');
    expect(decideQuality({ ...base, average: 0.03, cooldown: 3 }).action).toBe('none');
    expect(decideQuality({ ...base, average: 0.03, quality: 'low' }).action).toBe('none');
    expect(decideQuality({ ...base, quality: 'balanced', stable: 1 })).toEqual({ action: 'up', stable: 0 });
    expect(decideQuality({ ...base, quality: 'balanced', stable: 0 })).toEqual({ action: 'none', stable: 1 });
    // A profile never rises above the ceiling, and software rendering never rises at all.
    expect(decideQuality({ ...base, quality: 'high', stable: 11 }).action).toBe('none');
    expect(decideQuality({ ...base, quality: 'low', ceiling: 'low', stable: 11 }).action).toBe('none');
    expect(decideQuality({ ...base, quality: 'balanced', stable: 11, software: true })).toEqual({ action: 'none', stable: 0 });
    // Every stall raises the bar for the next promotion.
    // After three stalls eight fast samples are needed (it is 2 x (1 + stalls), at most 12).
    expect(decideQuality({ ...base, quality: 'balanced', stable: 5, downgrades: 3 }).action).toBe('none');
    expect(decideQuality({ ...base, quality: 'balanced', stable: 7, downgrades: 3 }).action).toBe('up');
  });

  it('with a GPU timer only steps down when the GPU is the limit', () => {
    // A display capped at 30 Hz: long intervals, an idle GPU. Lowering the resolution would change nothing.
    expect(decideQuality({ ...base, average: 1 / 30, gpuMs: 4 }).action).toBe('none');
    expect(decideQuality({ ...base, average: 1 / 30, gpuMs: GPU_HEADROOM_MS + 2 })).toEqual({ action: 'none', stable: 0 });
    // A GPU past its budget steps down even before the intervals show it.
    expect(decideQuality({ ...base, average: 1 / 60, gpuMs: GPU_OVER_MS + 1 }).action).toBe('down');
    // Headroom is required for a promotion.
    expect(decideQuality({ ...base, quality: 'balanced', stable: 1, gpuMs: 12 })).toEqual({ action: 'none', stable: 0 });
    expect(decideQuality({ ...base, quality: 'balanced', stable: 1, gpuMs: 5 }).action).toBe('up');
  });
});

describe('Phase 6 – frame cap and GPU timer', () => {
  it('draws at most the capped number of frames on a faster display', () => {
    const drawn = (interval: number, hertz: number) => {
      const cadence = new RenderCadence(interval);
      let frames = 0;
      for (let i = 0; i < hertz * 4; i++) if (cadence.consume(1 / hertz) > 0) frames++;
      return frames / 4;
    };
    expect(drawn(0, 144)).toBe(144);
    expect(drawn(1 / 60, 144)).toBeGreaterThan(47);
    expect(drawn(1 / 60, 144)).toBeLessThanOrEqual(61);
    expect(drawn(1 / 30, 60)).toBeCloseTo(30, 0);
  });

  function fakeContext(extension: boolean, ready: () => boolean, nanoseconds: () => number, disjoint = () => false) {
    const deleted: object[] = [];
    const gl = {
      QUERY_RESULT_AVAILABLE: 1, QUERY_RESULT: 2,
      getExtension: () => (extension ? { TIME_ELAPSED_EXT: 10, GPU_DISJOINT_EXT: 11 } : null),
      createQuery: () => ({}), beginQuery: () => undefined, endQuery: () => undefined,
      deleteQuery: (query: object) => deleted.push(query),
      getParameter: () => disjoint(),
      getQueryParameter: (_: object, name: number) => (name === 1 ? ready() : nanoseconds()),
    };
    return { gl: gl as unknown as WebGL2RenderingContext, deleted };
  }

  it('reports nothing without the extension', () => {
    const { gl } = fakeContext(false, () => true, () => 0);
    const timer = new GpuTimer(gl, 0);
    timer.begin(); timer.end(); timer.poll();
    expect(timer.available).toBe(false);
    expect(timer.ms).toBeNull();
  });

  it('reads results a frame later, smooths them and drops measurements marred by a disjoint event', () => {
    let ready = false, value = 8e6, disjoint = false;
    const { gl, deleted } = fakeContext(true, () => ready, () => value, () => disjoint);
    const timer = new GpuTimer(gl, 0);
    timer.begin(); timer.end(); timer.poll();
    expect(timer.ms).toBeNull();
    ready = true; timer.poll();
    expect(timer.ms).toBeCloseTo(8, 5);
    expect(deleted).toHaveLength(1);
    value = 18e6; timer.begin(); timer.end(); timer.poll();
    expect(timer.ms).toBeCloseTo(8 * 0.9 + 18 * 0.1, 5);
    disjoint = true; value = 500e6; timer.begin(); timer.end(); timer.poll();
    expect(timer.ms).toBeCloseTo(8 * 0.9 + 18 * 0.1, 5);
    timer.dispose();
  });

  it('ignores the first results, which include shader compilation', () => {
    const { gl } = fakeContext(true, () => true, () => 900e6);
    const timer = new GpuTimer(gl, 3);
    for (let i = 0; i < 3; i++) { timer.begin(); timer.end(); timer.poll(); }
    expect(timer.ms).toBeNull();
    timer.begin(); timer.end(); timer.poll();
    expect(timer.ms).toBeCloseTo(900, 5);
  });
});
