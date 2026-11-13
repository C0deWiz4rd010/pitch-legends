import type { ArcadeMatch } from '../../services/arcade-match';

export function updateAdvantage(m: ArcadeMatch, dt: number): void {
  if (m.rule.phase !== 'advantage') return;
  m.rule.elapsed += dt;
  const owner = m.owner();
  if (owner && owner.side !== m.rule.advantageSide) {
    m.setRestart('freeKick', m.rule.advantageSide ?? m.opposite(owner.side), m.rule.spotX, m.rule.spotY);
  } else if (m.rule.elapsed >= 2.4) {
    m.rule = m.newRule('playing', null, m.ball.x, m.ball.y);
  }
}
