import { CONTROL_INPUT_MAP, MOVEMENT_KEYS } from '../../data/control-bindings';

/** Buttons that can be rebound. Movement keeps the arrow keys in addition to whatever is chosen. */
export type ButtonAction = keyof typeof CONTROL_INPUT_MAP;
export type MoveDirection = keyof typeof MOVEMENT_KEYS;
export type BindableAction = ButtonAction | `move-${MoveDirection}`;

export const BUTTON_ACTIONS = Object.keys(CONTROL_INPUT_MAP) as ButtonAction[];
export const MOVE_ACTIONS: BindableAction[] = ['move-up', 'move-left', 'move-down', 'move-right'];
export const BINDABLE_ACTIONS: BindableAction[] = [...MOVE_ACTIONS, ...BUTTON_ACTIONS];

/** Keys the match itself needs: pause, quick tactics and browser/menu navigation. */
export const RESERVED_KEYS = new Set(['Escape', 'KeyQ', 'Tab', 'Enter', 'NumpadEnter', 'Backspace', 'MetaLeft', 'MetaRight', 'ContextMenu', 'CapsLock']);
/** Arrow keys always move in their own direction, whatever else is bound, so they cannot be rebound. */
const ARROWS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);

export interface TouchLayout {
  /** Size of stick and buttons, 0.8–1.5. */
  scale: number;
  /** 0.4–1. */
  opacity: number;
  /** Extra distance from the bottom edge in px, 0–120 (thumbs, phone cases, bezels). */
  lift: number;
  /** Buttons left, stick right. */
  leftHanded: boolean;
}

export interface ControlPrefs {
  version: 1;
  keyboard: Partial<Record<BindableAction, string>>;
  gamepad: Partial<Record<ButtonAction, number>>;
  touch: TouchLayout;
}

export const DEFAULT_TOUCH_LAYOUT: TouchLayout = { scale: 1, opacity: 0.86, lift: 0, leftHanded: false };

export function defaultControlPrefs(): ControlPrefs {
  return { version: 1, keyboard: {}, gamepad: {}, touch: { ...DEFAULT_TOUCH_LAYOUT } };
}

const clamp = (value: unknown, min: number, max: number, fallback: number) =>
  typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;

/** Accepts anything read from storage and returns valid preferences. */
export function normaliseControlPrefs(source: unknown): ControlPrefs {
  const prefs = defaultControlPrefs();
  if (!source || typeof source !== 'object') return prefs;
  const value = source as Partial<ControlPrefs>;
  for (const action of BINDABLE_ACTIONS) {
    const code = value.keyboard?.[action];
    if (typeof code === 'string' && code && !RESERVED_KEYS.has(code)) prefs.keyboard[action] = code;
  }
  for (const action of BUTTON_ACTIONS) {
    const button = value.gamepad?.[action];
    if (Number.isInteger(button) && button! >= 0 && button! < 32) prefs.gamepad[action] = button;
  }
  const touch = value.touch;
  prefs.touch = {
    scale: clamp(touch?.scale, 0.8, 1.5, DEFAULT_TOUCH_LAYOUT.scale),
    opacity: clamp(touch?.opacity, 0.4, 1, DEFAULT_TOUCH_LAYOUT.opacity),
    lift: clamp(touch?.lift, 0, 120, DEFAULT_TOUCH_LAYOUT.lift),
    leftHanded: touch?.leftHanded === true,
  };
  return prefs;
}

function defaultKeys(action: BindableAction): readonly string[] {
  if (action.startsWith('move-')) return MOVEMENT_KEYS[action.slice(5) as MoveDirection];
  return CONTROL_INPUT_MAP[action as ButtonAction].keyboard;
}

/** Every key that triggers the action. */
export function keysFor(prefs: ControlPrefs, action: BindableAction): readonly string[] {
  const custom = prefs.keyboard[action];
  if (!custom) return defaultKeys(action);
  if (action.startsWith('move-')) {
    const arrow = defaultKeys(action).find((key) => ARROWS.has(key));
    return arrow && arrow !== custom ? [custom, arrow] : [custom];
  }
  return [custom];
}

/** The key shown for the action: the chosen one, or the first default. */
export function primaryKey(prefs: ControlPrefs, action: BindableAction): string {
  return prefs.keyboard[action] ?? defaultKeys(action).find((key) => !ARROWS.has(key)) ?? defaultKeys(action)[0];
}

export function buttonFor(prefs: ControlPrefs, action: ButtonAction): number {
  return prefs.gamepad[action] ?? CONTROL_INPUT_MAP[action].gamepadButton;
}

export type BindResult = { ok: true; prefs: ControlPrefs; swappedWith: BindableAction | null } | { ok: false; reason: 'reserved' | 'arrow' };

/**
 * Binds a key. If another action already uses it, the two swap keys, so no key ever does two things.
 * The pass/through keys are deliberately not special: whatever the player binds is used everywhere.
 */
export function bindKey(prefs: ControlPrefs, action: BindableAction, code: string): BindResult {
  if (RESERVED_KEYS.has(code)) return { ok: false, reason: 'reserved' };
  if (ARROWS.has(code)) return { ok: false, reason: 'arrow' };
  const next: ControlPrefs = { ...prefs, keyboard: { ...prefs.keyboard } };
  const previous = primaryKey(prefs, action);
  const holder = BINDABLE_ACTIONS.find((other) => other !== action && keysFor(prefs, other).includes(code)) ?? null;
  next.keyboard[action] = code;
  if (holder) next.keyboard[holder] = previous;
  return { ok: true, prefs: next, swappedWith: holder };
}

/** Binds a gamepad button; a button already in use swaps with the action's old one. */
export function bindButton(prefs: ControlPrefs, action: ButtonAction, button: number): { prefs: ControlPrefs; swappedWith: ButtonAction | null } {
  const next: ControlPrefs = { ...prefs, gamepad: { ...prefs.gamepad } };
  const previous = buttonFor(prefs, action);
  const holder = BUTTON_ACTIONS.find((other) => other !== action && buttonFor(prefs, other) === button) ?? null;
  next.gamepad[action] = button;
  if (holder) next.gamepad[holder] = previous;
  return { prefs: next, swappedWith: holder };
}

/** A readable name for a `KeyboardEvent.code`. */
export function keyLabel(code: string): string {
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return `NUM ${code.slice(6)}`;
  const names: Record<string, string> = {
    Space: 'SPACE', ShiftLeft: 'SHIFT', ShiftRight: 'R-SHIFT', ControlLeft: 'CTRL', ControlRight: 'R-CTRL', AltLeft: 'ALT', AltRight: 'ALT GR',
    ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', Comma: ',', Period: '.', Slash: '/', Semicolon: ';', Quote: "'",
    BracketLeft: '[', BracketRight: ']', Backslash: '\\', Minus: '-', Equal: '=', Backquote: '`', IntlBackslash: '<',
  };
  return names[code] ?? code.toUpperCase();
}

const GAMEPAD_NAMES = ['A', 'B', 'X', 'Y', 'LB', 'RB', 'LT', 'RT', 'VIEW', 'MENU', 'L3', 'R3', '↑', '↓', '←', '→', 'HOME'];
export function buttonLabel(button: number): string {
  return GAMEPAD_NAMES[button] ?? `#${button}`;
}
