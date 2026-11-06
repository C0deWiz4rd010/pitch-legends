import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { AudioService } from './core/services/audio.service';
import { GameStateService } from './core/services/game-state.service';
import { isWinterWeek, weatherFor } from './core/football/weather';
import { CAMERA_PRESETS, gradeFor } from './features/match/three-pitch.renderer';
import { WEAR_HEIGHT, WEAR_WIDTH, meanWear, stampWear, wearTexel } from './features/match/pitch-wear';
import { TACTIC_LABELS } from './shared/tactic-labels';

/** A context that records the stereo panners that were created and where they were set. */
class PanContext {
  static pans: number[] = [];
  get currentTime() { return Date.now() / 1000; }
  sampleRate = 100; state = 'running'; destination = {};
  private param() { return { value: 0, setValueAtTime: vi.fn(), setTargetAtTime: vi.fn(), linearRampToValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() }; }
  private node() { const node = { connect: (_: unknown) => node, disconnect: vi.fn(), start: vi.fn(), stop: vi.fn(), onended: null as null | (() => void) }; return node; }
  createOscillator() { return { ...this.node(), frequency: this.param() }; }
  createGain() { return { ...this.node(), gain: this.param() }; }
  createBiquadFilter() { return { ...this.node(), frequency: this.param(), Q: this.param() }; }
  createBufferSource() { return this.node(); }
  createBuffer(_: number, length: number) { return { getChannelData: () => new Float32Array(length) }; }
  createStereoPanner() {
    const pan = { value: 0 };
    const panner = { ...this.node(), pan };
    // The value is read when the sound is over; record it as soon as it is set.
    Object.defineProperty(pan, 'value', { set: (value: number) => { PanContext.pans.push(value); }, get: () => 0 });
    return panner;
  }
}

describe('Presentation 3c – stereo contacts and answering chants', () => {
  beforeEach(() => { localStorage.clear(); PanContext.pans = []; });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); TestBed.resetTestingModule(); localStorage.clear(); });

  it('places a ball contact on the side of the pitch where it happens', () => {
    vi.stubGlobal('AudioContext', PanContext);
    TestBed.configureTestingModule({ providers: [{ provide: GameStateService, useValue: { game: () => null } }] });
    const audio = TestBed.inject(AudioService);
    audio.contact({ tick: 10, x: 10, y: 34, z: 0.11, kind: 'foot', foot: 'right' }, 22, -0.6);
    expect(PanContext.pans.length).toBeGreaterThan(0);
    expect(PanContext.pans.every((pan) => pan === -0.6)).toBe(true);
    PanContext.pans = [];
    audio.contact({ tick: 20, x: 90, y: 34, z: 0.11, kind: 'foot', foot: 'right' }, 22, 0.6);
    expect(PanContext.pans.every((pan) => pan === 0.6)).toBe(true);
    // No place, no panner: a centred sound goes straight to the speakers.
    PanContext.pans = [];
    audio.contact({ tick: 30, x: 52, y: 34, z: 0.11, kind: 'foot', foot: 'right' }, 22);
    expect(PanContext.pans).toEqual([]);
  });

  it('lets the two ends of the ground answer each other in the chants', () => {
    vi.useFakeTimers();
    vi.stubGlobal('AudioContext', PanContext);
    TestBed.configureTestingModule({ providers: [{ provide: GameStateService, useValue: { game: () => null } }] });
    const audio = TestBed.inject(AudioService);
    audio.setChant(true);
    vi.advanceTimersByTime(9000);
    audio.setChant(false);
    expect(PanContext.pans.some((pan) => pan < 0)).toBe(true);
    expect(PanContext.pans.some((pan) => pan > 0)).toBe(true);
    expect(PanContext.pans.every((pan) => Math.abs(pan) <= 1)).toBe(true);
  });

  it('works on a context without stereo panners', () => {
    vi.stubGlobal('AudioContext', class extends PanContext { override createStereoPanner = undefined as never; });
    TestBed.configureTestingModule({ providers: [{ provide: GameStateService, useValue: { game: () => null } }] });
    const audio = TestBed.inject(AudioService);
    expect(() => audio.contact({ tick: 5, x: 20, y: 34, z: 0.11, kind: 'foot', foot: 'left' }, 20, 0.5)).not.toThrow();
  });
});

describe('Presentation 3c – weather, grade and cameras', () => {
  it('snows only in the winter weeks, in four fixtures of ten, and keeps the other weather as before', () => {
    expect(isWinterWeek(1, 22)).toBe(false);
    expect(isWinterWeek(10, 22)).toBe(true);
    expect(isWinterWeek(22, 22)).toBe(false);
    expect(isWinterWeek(5, 6)).toBe(false);
    const winter = Array.from({ length: 10 }, (_, roll) => weatherFor(roll, 10, 22));
    expect(winter.filter((weather) => weather === 'snow')).toHaveLength(4);
    const summer = Array.from({ length: 10 }, (_, roll) => weatherFor(roll, 2, 22));
    expect(summer).toEqual(['clear', 'clear', 'clear', 'clear', 'clear', 'clear', 'rain', 'rain', 'rain', 'storm']);
    expect(TACTIC_LABELS.snow.de).toBe('Schnee');
  });

  it('grades each atmosphere differently and takes the colour out of bad weather', () => {
    const night = gradeFor('night', 'clear'), day = gradeFor('day', 'clear'), sunset = gradeFor('sunset', 'clear');
    expect(night.tint[2]).toBeGreaterThan(night.tint[0]);
    expect(sunset.tint[0]).toBeGreaterThan(sunset.tint[2]);
    expect(day).not.toEqual(night);
    for (const weather of ['rain', 'storm', 'snow'] as const) expect(gradeFor('day', weather).saturation).toBeLessThan(day.saturation);
    expect(gradeFor('day', 'storm').saturation).toBeLessThan(gradeFor('day', 'rain').saturation);
    for (const atmosphere of ['day', 'sunset', 'night'] as const) for (const weather of ['clear', 'rain', 'storm', 'snow'] as const) {
      const grade = gradeFor(atmosphere, weather);
      expect(grade.saturation).toBeGreaterThan(0.5);
      expect(grade.contrast).toBeGreaterThan(0.9);
      expect(grade.contrast).toBeLessThan(1.2);
      grade.tint.forEach((value) => { expect(value).toBeGreaterThan(0.8); expect(value).toBeLessThan(1.2); });
    }
  });

  it('has a player camera that is closer than every other angle', () => {
    expect(CAMERA_PRESETS.player.width).toBeLessThan(CAMERA_PRESETS.arcade.width);
    expect(CAMERA_PRESETS.player.width).toBeLessThan(CAMERA_PRESETS.tv.width);
    expect(CAMERA_PRESETS.player.follow).toBe(1);
  });
});

describe('Presentation 3c – pitch wear', () => {
  it('maps a point of the pitch to a texel and keeps the corners inside the map', () => {
    expect(wearTexel(0, 68, 105, 68)).toEqual({ column: 0, row: 0 });
    expect(wearTexel(105, 0, 105, 68)).toEqual({ column: WEAR_WIDTH - 1, row: WEAR_HEIGHT - 1 });
    expect(wearTexel(-5, 80, 105, 68)).toEqual({ column: 0, row: 0 });
    expect(wearTexel(52.5, 34, 105, 68)).toEqual({ column: WEAR_WIDTH / 2, row: WEAR_HEIGHT / 2 });
  });

  it('wears the turf where players run, and more where they run fast, and never past full wear', () => {
    const data = new Uint8Array(WEAR_WIDTH * WEAR_HEIGHT);
    expect(meanWear(data)).toBe(0);
    stampWear(data, 52.5, 34, 105, 68, 3);
    const { column, row } = wearTexel(52.5, 34, 105, 68);
    const at = row * WEAR_WIDTH + column;
    expect(data[at]).toBe(3);
    expect(data[at - 1]).toBe(1);
    expect(data[at + 1]).toBe(1);
    expect(meanWear(data)).toBeGreaterThan(0);
    for (let i = 0; i < 200; i++) stampWear(data, 52.5, 34, 105, 68, 3);
    expect(data[at]).toBe(255);
    expect(Math.max(...data)).toBe(255);
    // A stamp at the edge does not spill over to the next row.
    const edge = new Uint8Array(WEAR_WIDTH * WEAR_HEIGHT);
    stampWear(edge, 0, 34, 105, 68);
    expect(edge.reduce((sum, value) => sum + (value ? 1 : 0), 0)).toBe(2);
  });
});
