import { CONTROL_BINDINGS, CONTROL_INPUT_MAP, MOVEMENT_KEYS, PICK_KEYS } from './data/control-bindings';

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

  it('documents every button of the input map, including the modifier and the run request', () => {
    const documented = new Set(CONTROL_BINDINGS.map((binding) => binding.action as string));
    for (const action of Object.keys(CONTROL_INPUT_MAP)) expect(documented.has(action), action).toBe(true);
    for (const action of ['modifier', 'request']) {
      const binding = CONTROL_BINDINGS.find((candidate) => candidate.action === action)!;
      expect(binding.keyboard.length).toBeGreaterThan(0);
      expect(binding.gamepad.length).toBeGreaterThan(0);
      expect(binding.touch.length).toBeGreaterThan(0);
    }
  });

  it('gives no key two jobs: buttons, movement and the player-pick keys are all different', () => {
    const keys = [
      ...Object.values(CONTROL_INPUT_MAP).flatMap((entry) => [...entry.keyboard]),
      ...Object.values(MOVEMENT_KEYS).flat(),
      ...Object.values(PICK_KEYS),
    ];
    expect(new Set(keys).size).toBe(keys.length);
    const buttons = Object.values(CONTROL_INPUT_MAP).map((entry) => entry.gamepadButton);
    expect(new Set(buttons).size).toBe(buttons.length);
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
