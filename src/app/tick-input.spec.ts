import { TickInputBuffer } from './core/football/tick-input';
import { EMPTY_MATCH_COMMAND } from './models/match.model';

describe('tick-consumed football input', () => {
  for (const hz of [30, 60, 120, 144]) {
    it(`retains a 10 ms tap with a ${hz} Hz renderer`, () => {
      const buffer = new TickInputBuffer();
      let accumulator = 0;
      let simulationTime = 0;
      const frames: boolean[] = [];
      buffer.set('key-j', 'pass', true, 1);
      buffer.set('key-j', 'pass', false, 11);
      for (let time = 1000 / hz; time < 100; time += 1000 / hz) {
        accumulator += 1000 / hz;
        while (accumulator >= 1000 / 60 - 1e-6) {
          simulationTime += 1000 / 60;
          frames.push(buffer.consume(EMPTY_MATCH_COMMAND, time).pass);
          accumulator -= 1000 / 60;
        }
      }
      expect(frames.filter(Boolean)).toHaveLength(1);
      expect(frames[frames.length - 1]).toBe(false);
      expect(simulationTime).toBeGreaterThan(50);
    });
  }
  it('does not release another device holding the same action', () => {
    const buffer = new TickInputBuffer();
    buffer.set('keyboard', 'shoot', true, 0);
    expect(buffer.consume(EMPTY_MATCH_COMMAND, 16).shoot).toBe(true);
    buffer.set('touch', 'shoot', true, 20);
    buffer.set('keyboard', 'shoot', false, 21);
    expect(buffer.consume(EMPTY_MATCH_COMMAND, 33).shoot).toBe(true);
    buffer.set('touch', 'shoot', false, 34);
    expect(buffer.consume(EMPTY_MATCH_COMMAND, 50).shoot).toBe(false);
  });
  it('drops stale presses and resets all held controls on focus loss', () => {
    const buffer = new TickInputBuffer();
    buffer.set('a', 'pass', true, 0);
    buffer.set('a', 'pass', false, 10);
    expect(buffer.consume(EMPTY_MATCH_COMMAND, 150).pass).toBe(false);
    buffer.set('b', 'sprint', true, 160);
    buffer.clear();
    expect(buffer.consume(EMPTY_MATCH_COMMAND, 170).sprint).toBe(false);
  });
});
