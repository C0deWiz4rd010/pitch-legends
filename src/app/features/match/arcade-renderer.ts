import { ArcadeActor, ArcadeMatch, FIELD_LENGTH, FIELD_WIDTH, GOAL_WIDTH } from '../../core/services/arcade-match';
import { MatchSnapshot, PlayerRuntimeSnapshot } from '../../models/match.model';
import { KitDesign } from '../../models/visual.model';
import { PlayerSpriteFactory } from './player-sprite.factory';

interface Point { x: number; y: number }

export class ArcadePitchRenderer {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly w = 640;
  private readonly h = 360;
  private time = 0;
  private flash = 0;
  private cameraX = FIELD_LENGTH / 2;
  private cameraY = FIELD_WIDTH / 2;
  private cameraScale = 8.2;
  private readonly sprites = new PlayerSpriteFactory();
  private prewarmedMatchId = '';

  constructor(private readonly canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('Canvas 2D is unavailable.');
    this.ctx = ctx;
    canvas.width = this.w;
    canvas.height = this.h;
    canvas.style.imageRendering = 'pixelated';
    ctx.imageSmoothingEnabled = false;
  }

  triggerGoal(): void {
    this.flash = 1;
  }

  render(match: ArcadeMatch, replay?: MatchSnapshot): void {
    this.time += 1 / 60;
    if (this.prewarmedMatchId !== match.matchId) {
      this.prewarmedMatchId = match.matchId;
      this.sprites.prewarm(match.actors, (actor) => this.kitFor(actor, match));
    }
    this.updateCamera(match, replay);
    this.drawBackdrop(match);
    this.drawPitch(match);
    this.drawActors(match, replay);
    this.drawBall(match, replay);
    this.drawEdgeIndicators(match, replay);
    this.drawMinimap(match, replay);
    this.drawHud(match, replay);
    if (replay) this.drawReplayLabel();
    if (this.flash > 0) {
      this.ctx.fillStyle = `rgba(255,211,78,${this.flash * 0.2})`;
      this.ctx.fillRect(0, 0, this.w, this.h);
      this.flash = Math.max(0, this.flash - 0.025);
    }
  }

  destroy(): void {
    this.sprites.destroy();
  }

  private updateCamera(match: ArcadeMatch, replay?: MatchSnapshot): void {
    const ball = replay?.ball ?? match.ball;
    const selectedId = replay?.controlledPlayerId ?? match.selectedPlayerId;
    const selected = replay?.players.find((player) => player.id === selectedId) ?? match.actors.find((actor) => actor.player.id === selectedId);
    const mirror = (replay?.attackDirection ?? match.currentAttackDirection) < 0;
    const bx = mirror ? FIELD_LENGTH - ball.x : ball.x;
    const sx = selected ? (mirror ? FIELD_LENGTH - selected.x : selected.x) : bx;
    const goalX = FIELD_LENGTH;
    const dangerX = bx > FIELD_LENGTH / 2 ? goalX : FIELD_LENGTH / 2;
    const speed = Math.hypot(ball.vx, ball.vy);
    const targetX = bx * 0.58 + sx * 0.24 + dangerX * 0.18 + Math.sign(mirror ? -ball.vx : ball.vx) * Math.min(7, speed * 0.22);
    const targetY = ball.y * 0.62 + (selected?.y ?? ball.y) * 0.25 + FIELD_WIDTH / 2 * 0.13;
    const penaltyScene = bx > 82 || bx < 23;
    const counter = speed > 15;
    const viewLength = replay ? 57 : penaltyScene ? 59 : counter ? 78 : 70;
    const targetScale = this.w / viewLength;
    const smooth = replay || match.config.camera.reducedMotion ? 0.16 : 0.085;
    this.cameraX += (targetX - this.cameraX) * smooth;
    this.cameraY += (targetY - this.cameraY) * smooth;
    this.cameraScale += (targetScale - this.cameraScale) * 0.055;
    const halfW = this.w / this.cameraScale / 2;
    const halfH = this.h / this.cameraScale / 2;
    this.cameraX = Math.round(clampCamera(this.cameraX, halfW, FIELD_LENGTH - halfW) * this.cameraScale) / this.cameraScale;
    this.cameraY = Math.round(clampCamera(this.cameraY, halfH, FIELD_WIDTH - halfH) * this.cameraScale) / this.cameraScale;
  }

  private drawBackdrop(match: ArcadeMatch): void {
    const ctx = this.ctx;
    ctx.fillStyle = '#050713';
    ctx.fillRect(0, 0, this.w, this.h);
    for (let y = 0; y < this.h; y += 8) {
      ctx.fillStyle = y % 16 ? '#0a1730' : '#0c1d39';
      ctx.fillRect(0, y, this.w, 8);
    }
    const weatherTint = match.config.weather === 'rain' ? 'rgba(35,92,138,.13)' : match.config.weather === 'storm' ? 'rgba(8,12,28,.26)' : 'transparent';
    ctx.fillStyle = weatherTint;
    ctx.fillRect(0, 0, this.w, this.h);
  }

  private drawPitch(match: ArcadeMatch): void {
    const ctx = this.ctx;
    const topLeft = this.worldToScreen(match, 0, 0);
    const bottomRight = this.worldToScreen(match, FIELD_LENGTH, FIELD_WIDTH);
    const left = Math.min(topLeft.x, bottomRight.x);
    const right = Math.max(topLeft.x, bottomRight.x);
    const top = Math.min(topLeft.y, bottomRight.y);
    const bottom = Math.max(topLeft.y, bottomRight.y);
    ctx.fillStyle = '#07120c';
    ctx.fillRect(Math.floor(left - 8), Math.floor(top - 8), Math.ceil(right - left + 16), Math.ceil(bottom - top + 16));
    for (let metre = 0; metre < FIELD_LENGTH; metre += 10.5) {
      const a = this.worldToScreen(match, metre, 0);
      const b = this.worldToScreen(match, Math.min(FIELD_LENGTH, metre + 10.5), FIELD_WIDTH);
      ctx.fillStyle = Math.floor(metre / 10.5) % 2 ? '#218f50' : '#279f5b';
      ctx.fillRect(Math.floor(Math.min(a.x, b.x)), Math.floor(top), Math.ceil(Math.abs(b.x - a.x)), Math.ceil(bottom - top));
    }
    ctx.strokeStyle = '#e8f5d2';
    ctx.lineWidth = 2;
    this.rectWorld(match, 0, 0, FIELD_LENGTH, FIELD_WIDTH);
    this.lineWorld(match, FIELD_LENGTH / 2, 0, FIELD_LENGTH / 2, FIELD_WIDTH);
    this.circleWorld(match, FIELD_LENGTH / 2, FIELD_WIDTH / 2, 9.15);
    this.dotWorld(match, FIELD_LENGTH / 2, FIELD_WIDTH / 2, 0.3);
    this.rectWorld(match, 0, FIELD_WIDTH / 2 - 20.16, 16.5, 40.32);
    this.rectWorld(match, FIELD_LENGTH - 16.5, FIELD_WIDTH / 2 - 20.16, 16.5, 40.32);
    this.rectWorld(match, 0, FIELD_WIDTH / 2 - 9.16, 5.5, 18.32);
    this.rectWorld(match, FIELD_LENGTH - 5.5, FIELD_WIDTH / 2 - 9.16, 5.5, 18.32);
    this.dotWorld(match, 11, FIELD_WIDTH / 2, 0.24);
    this.dotWorld(match, FIELD_LENGTH - 11, FIELD_WIDTH / 2, 0.24);
    this.drawGoal(match, 0);
    this.drawGoal(match, FIELD_LENGTH);
    if (match.config.weather !== 'clear') this.drawWeather(match.config.weather);
  }

  private drawGoal(match: ArcadeMatch, x: number): void {
    const ctx = this.ctx;
    const a = this.worldToScreen(match, x, FIELD_WIDTH / 2 - GOAL_WIDTH / 2);
    const b = this.worldToScreen(match, x, FIELD_WIDTH / 2 + GOAL_WIDTH / 2);
    const depth = x === 0 ? -11 : 11;
    ctx.strokeStyle = '#dfe8ff';
    ctx.lineWidth = 2;
    ctx.strokeRect(Math.round(a.x + (depth < 0 ? depth : 0)), Math.round(Math.min(a.y, b.y)), Math.abs(depth), Math.round(Math.abs(b.y - a.y)));
    ctx.strokeStyle = '#49619a';
    ctx.lineWidth = 1;
    for (let y = Math.min(a.y, b.y) + 4; y < Math.max(a.y, b.y); y += 5) {
      ctx.beginPath();
      ctx.moveTo(a.x, y);
      ctx.lineTo(a.x + depth, y);
      ctx.stroke();
    }
  }

  private drawWeather(weather: 'rain' | 'storm'): void {
    const ctx = this.ctx;
    ctx.strokeStyle = weather === 'storm' ? 'rgba(185,217,255,.34)' : 'rgba(185,217,255,.22)';
    ctx.lineWidth = 1;
    const count = weather === 'storm' ? 70 : 42;
    for (let index = 0; index < count; index++) {
      const x = (index * 97 + Math.floor(this.time * 190)) % this.w;
      const y = (index * 53 + Math.floor(this.time * 285)) % this.h;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x - 3, y + 7);
      ctx.stroke();
    }
  }

  private drawActors(match: ArcadeMatch, replay?: MatchSnapshot): void {
    const players = replay?.players ?? match.actors;
    const sorted = players.filter((actor) => actor.active).sort((a, b) => a.y - b.y);
    for (const position of sorted) {
      const actor = match.actors.find((candidate) => candidate.player.id === ('id' in position ? position.id : position.player.id));
      if (actor) this.drawActor(actor, position, match, replay?.controlledPlayerId ?? match.selectedPlayerId, replay?.tick ?? match.tick);
    }
  }

  private drawActor(actor: ArcadeActor, position: ArcadeActor | PlayerRuntimeSnapshot, match: ArcadeMatch, selectedId: string, renderTick: number): void {
    const ctx = this.ctx;
    const point = this.worldToScreen(match, position.x, position.y);
    if (point.x < -20 || point.x > this.w + 20 || point.y < -25 || point.y > this.h + 25) return;
    const x = Math.round(point.x);
    const y = Math.round(point.y);
    const team = actor.side === 'home' ? match.home : match.away;
    const selected = actor.player.id === selectedId;
    ctx.fillStyle = 'rgba(2,4,10,.48)';
    ctx.fillRect(x - 8, y + 8, 17, 4);
    if (selected) {
      ctx.fillStyle = '#ffd34e';
      ctx.fillRect(x - 8, y - 20, 16, 3);
      ctx.fillRect(x - 4, y - 17, 8, 2);
    }
    if (position.card === 'yellow') {
      ctx.fillStyle = '#ffd34e';
      ctx.fillRect(x + 8, y - 18, 3, 5);
    }
    const kit = this.kitFor(actor, match);
    try {
      const sprite = this.sprites.get(actor, position, kit, renderTick);
      ctx.drawImage(sprite, x - 16, y - 29, 32, 40);
    } catch {
      this.drawPrimitiveActor(x, y, kit, actor.player.kitNumber);
    }
  }

  private kitFor(actor: ArcadeActor, match: ArcadeMatch): KitDesign {
    const team = actor.side === 'home' ? match.home : match.away;
    if (actor.player.positionGroup === 'GK') return team.visuals.kits.goalkeeper;
    return actor.side === 'home' ? team.visuals.kits.home : team.visuals.kits.away;
  }

  private drawPrimitiveActor(x: number, y: number, kit: KitDesign, number: number): void {
    const ctx = this.ctx;
    ctx.fillStyle = kit.shorts;
    ctx.fillRect(x - 5, y + 2, 4, 8);
    ctx.fillRect(x + 2, y + 2, 4, 8);
    ctx.fillStyle = kit.shirt;
    ctx.fillRect(x - 8, y - 10, 17, 13);
    ctx.fillStyle = '#d79a69';
    ctx.fillRect(x - 4, y - 18, 9, 8);
    ctx.fillStyle = this.contrast(kit.shirt);
    ctx.font = '7px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(String(number), x, y - 2);
  }

  private drawBall(match: ArcadeMatch, replay?: MatchSnapshot): void {
    const ball = replay?.ball ?? match.ball;
    const ground = this.worldToScreen(match, ball.x, ball.y);
    const x = Math.round(ground.x);
    const y = Math.round(ground.y - ball.z * this.cameraScale * 0.6);
    const shadowSize = Math.max(2, 7 - Math.round(ball.z));
    this.ctx.fillStyle = 'rgba(2,4,10,.48)';
    this.ctx.fillRect(x - Math.floor(shadowSize / 2), Math.round(ground.y + 4), shadowSize, 2);
    this.ctx.fillStyle = '#f4f4df';
    this.ctx.fillRect(x - 3, y - 3, 7, 7);
    this.ctx.fillStyle = '#172144';
    this.ctx.fillRect(x - 1, y - 1, 3, 3);
  }

  private drawEdgeIndicators(match: ArcadeMatch, replay?: MatchSnapshot): void {
    const players = replay?.players ?? match.actors;
    const selectedSide = match.controlledSide;
    for (const player of players.filter((candidate) => candidate.active && candidate.side === selectedSide)) {
      const playerId = 'id' in player ? player.id : player.player.id;
      const point = this.worldToScreen(match, player.x, player.y);
      if (point.x >= 10 && point.x <= this.w - 10 && point.y >= 12 && point.y <= this.h - 12) continue;
      const x = clampCamera(point.x, 9, this.w - 9);
      const y = clampCamera(point.y, 12, this.h - 12);
      this.ctx.fillStyle = playerId === (replay?.controlledPlayerId ?? match.selectedPlayerId) ? '#ffd34e' : '#54f28b';
      this.ctx.fillRect(Math.round(x - 3), Math.round(y - 3), 7, 7);
    }
  }

  private drawMinimap(match: ArcadeMatch, replay?: MatchSnapshot): void {
    const ctx = this.ctx;
    const map = { x: this.w - 140, y: this.h - 68, w: 126, h: 52 };
    ctx.fillStyle = 'rgba(5,7,19,.84)';
    ctx.fillRect(map.x - 4, map.y - 4, map.w + 8, map.h + 8);
    ctx.fillStyle = '#146b3c';
    ctx.fillRect(map.x, map.y, map.w, map.h);
    ctx.strokeStyle = '#9acba7';
    ctx.strokeRect(map.x, map.y, map.w, map.h);
    ctx.beginPath();
    ctx.moveTo(map.x + map.w / 2, map.y);
    ctx.lineTo(map.x + map.w / 2, map.y + map.h);
    ctx.stroke();
    const players = replay?.players ?? match.actors;
    for (const player of players.filter((candidate) => candidate.active)) {
      const playerId = 'id' in player ? player.id : player.player.id;
      const x = map.x + (match.currentAttackDirection < 0 ? 1 - player.x / FIELD_LENGTH : player.x / FIELD_LENGTH) * map.w;
      const y = map.y + player.y / FIELD_WIDTH * map.h;
      ctx.fillStyle = player.side === match.controlledSide ? '#54f28b' : '#ff5d7d';
      ctx.fillRect(Math.round(x - 1), Math.round(y - 1), 3, 3);
      if (playerId === (replay?.controlledPlayerId ?? match.selectedPlayerId)) {
        ctx.strokeStyle = '#ffd34e';
        ctx.strokeRect(Math.round(x - 3), Math.round(y - 3), 7, 7);
      }
    }
    const ball = replay?.ball ?? match.ball;
    const bx = map.x + (match.currentAttackDirection < 0 ? 1 - ball.x / FIELD_LENGTH : ball.x / FIELD_LENGTH) * map.w;
    const by = map.y + ball.y / FIELD_WIDTH * map.h;
    ctx.fillStyle = '#fff';
    ctx.fillRect(Math.round(bx - 1), Math.round(by - 1), 3, 3);
  }

  private drawHud(match: ArcadeMatch, replay?: MatchSnapshot): void {
    const ctx = this.ctx;
    const selected = match.actors.find((actor) => actor.player.id === (replay?.controlledPlayerId ?? match.selectedPlayerId));
    ctx.fillStyle = 'rgba(5,7,19,.92)';
    ctx.fillRect(12, 12, 172, 31);
    ctx.strokeStyle = '#49619a';
    ctx.strokeRect(12, 12, 172, 31);
    if (selected) {
      ctx.fillStyle = '#f4f4df';
      ctx.font = '8px Silkscreen, monospace';
      ctx.textAlign = 'left';
      ctx.fillText(`${selected.player.kitNumber} ${selected.player.lastName.toUpperCase()}`, 19, 23);
      ctx.fillStyle = '#172144';
      ctx.fillRect(19, 30, 116, 4);
      ctx.fillStyle = selected.stamina > 40 ? '#54f28b' : selected.stamina > 25 ? '#ffd34e' : '#ff5d7d';
      ctx.fillRect(19, 30, Math.round(116 * selected.stamina / 100), 4);
      if (selected.card === 'yellow') {
        ctx.fillStyle = '#ffd34e';
        ctx.fillRect(143, 19, 6, 9);
      }
    }
    if (match.actionPower > 0) {
      ctx.fillStyle = '#172144';
      ctx.fillRect(19, 37, 116, 3);
      ctx.fillStyle = match.actionPower > 0.85 ? '#ff5d7d' : '#39c8ff';
      ctx.fillRect(19, 37, Math.round(116 * match.actionPower), 3);
    }
    if (match.rule.phase !== 'playing') {
      const label = match.rule.phase.replace(/([A-Z])/g, ' $1').toUpperCase();
      ctx.fillStyle = 'rgba(5,7,19,.9)';
      ctx.fillRect(this.w / 2 - 66, 44, 132, 20);
      ctx.strokeStyle = '#ffd34e';
      ctx.strokeRect(this.w / 2 - 66, 44, 132, 20);
      ctx.fillStyle = '#ffd34e';
      ctx.font = '8px Silkscreen, monospace';
      ctx.textAlign = 'center';
      ctx.fillText(label, this.w / 2, 54);
    }
  }

  private drawReplayLabel(): void {
    const ctx = this.ctx;
    ctx.fillStyle = 'rgba(5,7,19,.9)';
    ctx.fillRect(this.w / 2 - 47, 12, 94, 20);
    ctx.strokeStyle = '#ffd34e';
    ctx.strokeRect(this.w / 2 - 47, 12, 94, 20);
    ctx.fillStyle = '#ffd34e';
    ctx.font = '8px Silkscreen, monospace';
    ctx.textAlign = 'center';
    ctx.fillText('GOAL REPLAY', this.w / 2, 22);
  }

  private worldToScreen(match: ArcadeMatch, x: number, y: number): Point {
    const transformedX = match.currentAttackDirection < 0 ? FIELD_LENGTH - x : x;
    return {
      x: Math.round((transformedX - this.cameraX) * this.cameraScale + this.w / 2),
      y: Math.round((y - this.cameraY) * this.cameraScale + this.h / 2),
    };
  }

  private lineWorld(match: ArcadeMatch, x1: number, y1: number, x2: number, y2: number): void {
    const a = this.worldToScreen(match, x1, y1);
    const b = this.worldToScreen(match, x2, y2);
    this.ctx.beginPath();
    this.ctx.moveTo(a.x, a.y);
    this.ctx.lineTo(b.x, b.y);
    this.ctx.stroke();
  }

  private rectWorld(match: ArcadeMatch, x: number, y: number, width: number, height: number): void {
    const a = this.worldToScreen(match, x, y);
    const b = this.worldToScreen(match, x + width, y + height);
    this.ctx.strokeRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y));
  }

  private circleWorld(match: ArcadeMatch, x: number, y: number, radius: number): void {
    const p = this.worldToScreen(match, x, y);
    this.ctx.beginPath();
    this.ctx.arc(p.x, p.y, radius * this.cameraScale, 0, Math.PI * 2);
    this.ctx.stroke();
  }

  private dotWorld(match: ArcadeMatch, x: number, y: number, radius: number): void {
    const p = this.worldToScreen(match, x, y);
    this.ctx.fillStyle = '#e8f5d2';
    this.ctx.fillRect(Math.round(p.x - radius * this.cameraScale), Math.round(p.y - radius * this.cameraScale), Math.max(2, Math.round(radius * this.cameraScale * 2)), Math.max(2, Math.round(radius * this.cameraScale * 2)));
  }

  private contrast(hex: string): string {
    const clean = hex.replace('#', '');
    if (clean.length !== 6) return '#fff';
    const r = parseInt(clean.slice(0, 2), 16);
    const g = parseInt(clean.slice(2, 4), 16);
    const b = parseInt(clean.slice(4, 6), 16);
    return r * 0.299 + g * 0.587 + b * 0.114 > 150 ? '#06120b' : '#f4f4df';
  }
}

function clampCamera(value: number, min: number, max: number): number {
  if (min > max) return (min + max) / 2;
  return Math.max(min, Math.min(max, value));
}
