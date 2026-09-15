import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { PORTRAIT_RENDERER_LOADER, PortraitService } from './core/services/portrait.service';
import { createPracticeTeams } from './core/football/practice';

const render = vi.fn(async (_player: unknown, _kit: unknown, _full: boolean, needed: () => boolean) => needed() ? 'data:image/png;base64,portrait' : '');
const release = vi.fn();

describe('Portrait work lifecycle', () => {
  beforeEach(() => {
    render.mockClear(); release.mockClear();
    TestBed.configureTestingModule({ providers: [{ provide: PORTRAIT_RENDERER_LOADER, useValue: async () => ({ footballerPortrait: render, disposePortraitRenderer: release }) }] });
  });
  afterEach(() => TestBed.resetTestingModule());
  it('skips abandoned requests before they reach the graphics renderer', async () => {
    const service = TestBed.inject(PortraitService), { home } = createPracticeTeams();
    const request = new AbortController();
    const image = service.portrait(home.players[0], home, request.signal);
    request.abort();
    expect(await image).toBe('');
    expect(render).not.toHaveBeenCalled();
    expect(await service.portrait(home.players[0], home)).toContain('data:image/png');
    expect(render).toHaveBeenCalledTimes(1);
  });
  it('keeps a shared request alive while another visible consumer still needs it', async () => {
    const service = TestBed.inject(PortraitService), { home } = createPracticeTeams();
    const first = new AbortController(), second = new AbortController();
    const a = service.portrait(home.players[0], home, first.signal);
    const b = service.portrait(home.players[0], home, second.signal);
    first.abort();
    expect(await a).toBe(await b);
    expect(await b).toContain('data:image/png');
    expect(render).toHaveBeenCalledTimes(1);
  });
  it('invalidates queued work when the portrait cache is cleared', async () => {
    const service = TestBed.inject(PortraitService), { home } = createPracticeTeams();
    const image = service.portrait(home.players[0], home);
    service.clear();
    expect(await image).toBe('');
    expect(render).not.toHaveBeenCalled();
  });
  it('releases the menu context after outstanding images finish and retains cached images', async () => {
    const service = TestBed.inject(PortraitService), { home } = createPracticeTeams();
    const image = service.portrait(home.players[0], home);
    await service.releaseGraphics();
    expect(release).toHaveBeenCalledTimes(1);
    expect(await service.portrait(home.players[0], home)).toBe(await image);
    expect(render).toHaveBeenCalledTimes(1);
  });
});
