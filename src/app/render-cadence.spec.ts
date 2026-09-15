import { RenderCadence } from './features/match/render-cadence';

describe('Software rendering cadence', () => {
  it('renders every other 60 Hz update and preserves all visual elapsed time', () => {
    const cadence = new RenderCadence(1 / 30);
    const rendered = Array.from({ length: 120 }, () => cadence.consume(1 / 60)).filter(Boolean);
    expect(rendered).toHaveLength(60);
    expect(rendered.reduce((sum, delta) => sum + delta, 0)).toBeCloseTo(2, 8);
  });
  it('does not halve a browser that is already presenting at 30 Hz', () => {
    const cadence = new RenderCadence(1 / 30);
    for (let i = 0; i < 60; i++) expect(cadence.consume(1 / 30)).toBeCloseTo(1 / 30, 8);
  });
  it('leaves hardware rendering at the browser refresh rate', () => {
    const cadence = new RenderCadence();
    for (let i = 0; i < 144; i++) expect(cadence.consume(1 / 144)).toBeCloseTo(1 / 144, 8);
  });
});
