/** Per-device graphics choices; kept in the browser's preferences, not in a career save. */
export type GraphicsQualityPref = 'auto' | 'high' | 'balanced' | 'low';
export type FrameCap = 0 | 30 | 60;

export interface GraphicsPrefs {
  /** `auto` starts from the device class and adapts while playing; the others are fixed. */
  quality: GraphicsQualityPref;
  /** Frames per second the 3D view may draw; 0 means as often as the display refreshes. */
  frameCap: FrameCap;
  /** Share of the normal render resolution, 0.5 to 1. */
  renderScale: number;
}

export const GRAPHICS_PREFS_KEY = 'pitch-legends:graphics:v1';

export const DEFAULT_GRAPHICS_PREFS: GraphicsPrefs = { quality: 'auto', frameCap: 0, renderScale: 1 };

/** Anything that is not a valid choice falls back to the default for that field. */
export function sanitizeGraphicsPrefs(value: unknown): GraphicsPrefs {
  const input = (typeof value === 'object' && value !== null ? value : {}) as Record<string, unknown>;
  const quality = ['auto', 'high', 'balanced', 'low'].includes(input['quality'] as string) ? (input['quality'] as GraphicsQualityPref) : DEFAULT_GRAPHICS_PREFS.quality;
  const frameCap = input['frameCap'] === 30 || input['frameCap'] === 60 ? input['frameCap'] : 0;
  const scale = typeof input['renderScale'] === 'number' && Number.isFinite(input['renderScale']) ? Math.min(1, Math.max(0.5, input['renderScale'])) : 1;
  return { quality, frameCap, renderScale: scale };
}
