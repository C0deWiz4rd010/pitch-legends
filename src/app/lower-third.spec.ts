import { lowerThirdFor, LowerThirdContext } from './features/match/lower-third';
import type { MatchEvent, ShotRecord } from './models/match.model';

const context = (shots: ShotRecord[] = [], lang: 'de' | 'en' = 'de'): LowerThirdContext => ({
  pick: (de, en) => (lang === 'de' ? de : en),
  teamName: (side) => (side === 'home' ? 'HAR' : 'ORI'),
  score: '2:1',
  shots,
});
const event = (patch: Partial<MatchEvent>): MatchEvent => ({ minute: 34, type: 'goal', side: 'home', playerId: 'p', ...patch });

describe('Lower thirds', () => {
  it('names the scorer with the score, the assist and the xG of the shot that went in', () => {
    const shots: ShotRecord[] = [
      { minute: 20, side: 'home', playerId: 'p', x: 90, y: 30, xG: 0.12, goal: false },
      { minute: 33, side: 'away', playerId: 'q', x: 88, y: 34, xG: 0.4, goal: true },
      { minute: 34, side: 'home', playerId: 'p', x: 96, y: 33, xG: 0.31, goal: true },
    ];
    const banner = lowerThirdFor(event({ playerName: 'Moreira', assistName: 'Kok' }), context(shots))!;
    expect(banner.kind).toBe('goal');
    expect(banner.kicker).toBe("Tor · 34'");
    expect(banner.title).toBe('Moreira');
    expect(banner.detail).toBe('HAR 2:1 · Vorlage Kok · xG 0.31');
  });

  it('leaves out what is not known and speaks English', () => {
    const banner = lowerThirdFor(event({ playerName: 'Moreira' }), context([], 'en'))!;
    expect(banner.kicker).toBe("Goal · 34'");
    expect(banner.detail).toBe('HAR 2:1');
  });

  it('marks own goals, cards, substitutions and injuries', () => {
    expect(lowerThirdFor(event({ ownGoal: true, side: 'away', playerName: 'Denner' }), context())).toMatchObject({ kind: 'own-goal', title: 'Denner', detail: 'ORI 2:1' });
    expect(lowerThirdFor(event({ type: 'yellow', params: { player: 'Franco' } }), context())).toMatchObject({ kind: 'yellow', kicker: "Gelbe Karte · 34'", title: 'Franco', detail: 'HAR' });
    expect(lowerThirdFor(event({ type: 'red', side: 'away', params: { player: 'Peroni' } }), context())!.detail).toBe('ORI · in Unterzahl');
    expect(lowerThirdFor(event({ type: 'sub', params: { incoming: 'Willems', outgoing: 'Walker' } }), context())).toMatchObject({ kind: 'sub', title: '▲ Willems', detail: '▼ Walker' });
    expect(lowerThirdFor(event({ type: 'injury', params: { player: 'Vieweg' } }), context())).toMatchObject({ kind: 'injury', title: 'Vieweg' });
  });

  it('shows nothing for the rest of the match events', () => {
    for (const type of ['kickoff', 'shot', 'save', 'foul', 'chance'] as const) expect(lowerThirdFor(event({ type }), context())).toBeNull();
  });
});

import { LOWER_THIRD_GAP, LOWER_THIRD_SECONDS, LowerThird, LowerThirdQueue } from './features/match/lower-third';

describe('Lower third queue', () => {
  const banner = (title: string): LowerThird => ({ kind: 'goal', side: 'home', kicker: '', title, detail: '' });
  const up = LOWER_THIRD_SECONDS * 1000, gap = LOWER_THIRD_GAP * 1000;

  it('shows captions one after the other with a gap between them', () => {
    const queue = new LowerThirdQueue();
    queue.push(banner('A')); queue.push(banner('B'));
    expect(queue.advance(0, false)).toBe(true);
    expect(queue.current?.title).toBe('A');
    expect(queue.advance(up - 1, false)).toBe(false);
    expect(queue.advance(up, false)).toBe(true);
    expect(queue.current).toBeNull();
    expect(queue.advance(up + gap - 1, false)).toBe(false);
    queue.advance(up + gap, false);
    expect(queue.current?.title).toBe('B');
  });

  it('keeps a goal caption back during the replay and then shows it for its full time', () => {
    const queue = new LowerThirdQueue();
    queue.push(banner('Scorer'));
    // The replay lasts ten seconds: nothing comes up, nothing runs out.
    for (let now = 0; now <= 10_000; now += 500) expect(queue.advance(now, true)).toBe(false);
    expect(queue.current).toBeNull();
    queue.advance(10_500, false);
    expect(queue.current?.title).toBe('Scorer');
    queue.advance(10_500 + up - 1, false);
    expect(queue.current?.title).toBe('Scorer');
  });

  it('starts empty again after clear', () => {
    const queue = new LowerThirdQueue();
    queue.push(banner('A'));
    queue.advance(0, false);
    queue.clear();
    expect(queue.current).toBeNull();
    expect(queue.advance(1, false)).toBe(false);
  });
});
