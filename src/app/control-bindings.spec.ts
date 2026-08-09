import { CONTROL_BINDINGS, CONTROL_INPUT_MAP, MOVEMENT_KEYS } from './data/control-bindings';

describe('shared control bindings', () => {
  it('keeps the visible pass help aligned with the actual input map', () => {
    const pass = CONTROL_BINDINGS.find((binding) => binding.action === 'pass');

    expect(pass?.keyboard.map((glyph) => glyph.label)).toContain('J');
    expect(pass?.gamepad.map((glyph) => glyph.label)).toContain('A');
    expect(pass?.touch.map((glyph) => glyph.label)).toContain('A');
    expect(CONTROL_INPUT_MAP.pass.keyboard).toContain('KeyJ');
    expect(CONTROL_INPUT_MAP.pass.gamepadButton).toBe(0);
  });

  it('has one canonical entry for each documented action', () => {
    const actions = CONTROL_BINDINGS.map((binding) => binding.action);
    expect(new Set(actions).size).toBe(actions.length);
    expect(actions).toEqual(expect.arrayContaining(['move', 'switch', 'pass', 'through', 'lob', 'shoot', 'sprint', 'skill', 'keeper', 'tactics']));
  });

  it('keeps movement keys synchronized with the visual WASD guide', () => {
    expect(MOVEMENT_KEYS).toEqual({
      left: ['ArrowLeft', 'KeyA'],
      right: ['ArrowRight', 'KeyD'],
      up: ['ArrowUp', 'KeyW'],
      down: ['ArrowDown', 'KeyS'],
    });
  });
});
