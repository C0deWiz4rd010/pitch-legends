import { ArcadeActor, ArcadeMatch, FIELD_LENGTH, FIELD_WIDTH, GOAL_WIDTH } from '../../core/services/arcade-match';
import { hash32, mixHex } from '../../core/visual-identity';
import { MatchRenderFrame, MatchRenderState, MatchSnapshot, PlayerRuntimeSnapshot } from '../../models/match.model';
import { KitDesign } from '../../models/visual.model';
import { PlayerSpriteFactory } from './player-sprite.factory';

interface Point { x: number; y: number }
interface VisualParticle { x: number; y: number; vx: number; vy: number; life: number; color: string; size: number }
interface BallTrailPoint { x: number; y: number; z: number; tick: number }
type VisualMatchState = MatchRenderState | MatchSnapshot;

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
  private readonly particles: VisualParticle[] = [];
  private readonly ballTrail: BallTrailPoint[] = [];
  private readonly emittedActions = new Map<string, number>();
  private pendingGoalBurst = false;
  private goalBurst = 0;
  private renderAttackDirection: 1 | -1 = 1;
  private visualBall = { x: FIELD_LENGTH / 2, y: FIELD_WIDTH / 2 };

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
    this.pendingGoalBurst = true;
    this.goalBurst = 1;
  }

  render(match: ArcadeMatch, frame?: MatchRenderFrame, replay?: MatchSnapshot): void {
    const deltaSeconds = Math.max(0, Math.min(0.05, frame?.deltaSeconds ?? 1 / 60));
    const state = replay ?? (frame ? interpolateMatchRenderFrame(frame) : match.renderState());
    this.time += deltaSeconds;
    this.renderAttackDirection = state.attackDirection;
    this.visualBall = state.ball;
    if (this.prewarmedMatchId !== match.matchId) {
      this.prewarmedMatchId = match.matchId;
      this.sprites.prewarm(match.actors, (actor) => this.kitFor(actor, match));
    }
    this.updateCamera(match, state, deltaSeconds, !!replay);
    this.drawBackdrop(match);
    this.drawPitch(match);
    this.recordBallTrail(match, state);
    this.drawBallTrail(match);
    this.spawnActionParticles(match);
    this.drawActors(match, state);
    this.drawBall(match, state);
    this.updateAndDrawParticles(match, deltaSeconds);
    this.drawEdgeIndicators(match, state);
    this.drawMinimap(match, state);
    this.drawHud(match, state);
    if (replay) this.drawReplayLabel();
    if (this.goalBurst > 0) this.drawGoalPresentation(match);
    if (this.flash > 0) {
      this.ctx.fillStyle = `rgba(255,211,78,${this.flash * 0.2})`;
      this.ctx.fillRect(0, 0, this.w, this.h);
      this.flash = Math.max(0, this.flash - 1.5 * deltaSeconds);
    }
    this.goalBurst = Math.max(0, this.goalBurst - (match.config.camera.reducedMotion ? 4.8 : 1.08) * deltaSeconds);
  }

  destroy(): void {
    this.sprites.destroy();
    this.particles.length = 0;
    this.ballTrail.length = 0;
    this.emittedActions.clear();
  }

  private updateCamera(match: ArcadeMatch, state: VisualMatchState, deltaSeconds: number, replay: boolean): void {
    const ball = state.ball;
    const selectedId = state.controlledPlayerId;
    const selected = state.players.find((player) => player.id === selectedId);
    const mirror = state.attackDirection < 0;
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
    const cameraLambda = replay || match.config.camera.reducedMotion ? 10.5 : 5.3;
    const positionSmooth = 1 - Math.exp(-cameraLambda * deltaSeconds);
    const scaleSmooth = 1 - Math.exp(-3.4 * deltaSeconds);
    this.cameraX += (targetX - this.cameraX) * positionSmooth;
    this.cameraY += (targetY - this.cameraY) * positionSmooth;
    this.cameraScale += (targetScale - this.cameraScale) * scaleSmooth;
    const halfW = this.w / this.cameraScale / 2;
    const halfH = this.h / this.cameraScale / 2;
    this.cameraX = Math.round(clampCamera(this.cameraX, halfW, FIELD_LENGTH - halfW) * this.cameraScale) / this.cameraScale;
    this.cameraY = Math.round(clampCamera(this.cameraY, halfH, FIELD_WIDTH - halfH) * this.cameraScale) / this.cameraScale;
  }

  private drawBackdrop(match: ArcadeMatch): void {
    const ctx = this.ctx;
    const atmosphere = match.home.visuals.stadium.atmosphere;
    const palettes = {
      day: ['#3d83aa', '#86c6cf', '#d7e9bd'],
      sunset: ['#27193f', '#bb4e5a', '#f6b35d'],
      night: ['#050713', '#0a1730', '#152e52'],
    } as const;
    const palette = palettes[atmosphere];
    ctx.fillStyle = palette[0];
    ctx.fillRect(0, 0, this.w, this.h);
    for (let y = 0; y < 160; y += 8) {
      const band = y < 56 ? palette[0] : y < 112 ? palette[1] : palette[2];
      ctx.fillStyle = band;
      ctx.fillRect(0, y, this.w, 8);
    }
    this.drawClouds(match, atmosphere);
    this.drawStands(match);
    const weatherTint = match.config.weather === 'rain' ? 'rgba(35,92,138,.14)' : match.config.weather === 'storm' ? 'rgba(5,8,24,.34)' : 'transparent';
    ctx.fillStyle = weatherTint;
    ctx.fillRect(0, 0, this.w, this.h);
    if (match.config.weather === 'storm' && !match.config.camera.reducedMotion && (match.tick + hash32(match.config.fixtureId ?? match.matchId)) % 733 < 3) {
      ctx.fillStyle = 'rgba(205,226,255,.2)';
      ctx.fillRect(0, 0, this.w, this.h);
    }
  }

  private drawClouds(match: ArcadeMatch, atmosphere: 'day' | 'sunset' | 'night'): void {
    const ctx = this.ctx;
    const seed = hash32(`${match.config.fixtureId ?? match.matchId}|clouds`);
    const motion = match.config.camera.reducedMotion ? 0 : Math.floor(this.time * 3);
    for (let index = 0; index < 7; index++) {
      const x = ((seed + index * 127 + motion * (index % 2 ? 1 : -1)) % 760) - 60;
      const y = 14 + ((seed >>> (index % 16)) + index * 31) % 88;
      const color = atmosphere === 'night' ? 'rgba(61,83,122,.24)' : atmosphere === 'sunset' ? 'rgba(255,205,168,.18)' : 'rgba(234,250,241,.3)';
      ctx.fillStyle = color;
      ctx.fillRect(x, y, 38 + index % 3 * 12, 5);
      ctx.fillRect(x + 8, y - 4, 24 + index % 2 * 10, 4);
    }
  }

  private drawStands(match: ArcadeMatch): void {
    const ctx = this.ctx;
    const seed = hash32(`${match.config.fixtureId ?? match.matchId}|crowd`);
    const home = match.home.visuals.kits.home;
    const rows = match.home.facilities.stadium >= 4 ? 6 : match.home.facilities.stadium >= 2 ? 5 : 4;
    ctx.fillStyle = '#070b18';
    ctx.fillRect(0, 108, this.w, 70);
    ctx.fillStyle = match.home.visuals.stadium.seatColor;
    for (let row = 0; row < rows; row++) {
      const y = 116 + row * 9;
      for (let x = 0; x < this.w; x += 7) {
        const occupied = ((seed + x * 17 + row * 83) >>> 2) % 10 > 1;
        if (!occupied) continue;
        const fanColor = (x + row * 19 + seed) % 11 < 5 ? home.shirt : (x + seed) % 7 < 3 ? home.secondary : '#d9e3ef';
        ctx.fillStyle = fanColor;
        const bounce = match.config.camera.reducedMotion ? 0 : Math.floor(this.time * 2 + x + row) % 17 === 0 ? -1 : 0;
        ctx.fillRect(x, y + bounce, 3, 4);
      }
    }
    ctx.fillStyle = '#111a31';
    ctx.fillRect(0, 166, this.w, 12);
    for (let x = 18; x < this.w; x += 82) {
      ctx.fillStyle = x % 164 ? home.shirt : home.secondary;
      const wave = match.config.camera.reducedMotion ? 0 : Math.floor(this.time * 4 + x) % 3;
      ctx.fillRect(x, 126, 2, 28);
      ctx.fillRect(x + 2, 127 + wave, 19, 10);
      ctx.fillStyle = home.trim;
      ctx.fillRect(x + 5, 130 + wave, 12, 2);
    }
    if (match.home.facilities.stadium >= 3 || match.home.visuals.stadium.atmosphere === 'night') {
      for (const x of [28, this.w - 34]) {
        ctx.fillStyle = '#2e3a58';
        ctx.fillRect(x, 22, 5, 104);
        ctx.fillStyle = '#d9f5ff';
        ctx.fillRect(x - 15, 20, 35, 6);
        ctx.fillStyle = 'rgba(200,238,255,.06)';
        ctx.fillRect(x - 42, 26, 90, 118);
      }
    }
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
    const grassA = match.config.weather === 'clear' ? '#279f5b' : '#207b50';
    const grassB = match.config.weather === 'clear' ? '#218f50' : '#1b7048';
    for (let metre = 0; metre < FIELD_LENGTH; metre += 10.5) {
      const a = this.worldToScreen(match, metre, 0);
      const b = this.worldToScreen(match, Math.min(FIELD_LENGTH, metre + 10.5), FIELD_WIDTH);
      ctx.fillStyle = Math.floor(metre / 10.5) % 2 ? grassB : grassA;
      ctx.fillRect(Math.floor(Math.min(a.x, b.x)), Math.floor(top), Math.ceil(Math.abs(b.x - a.x)), Math.ceil(bottom - top));
    }
    this.drawPitchWear(match);
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
    this.drawAdvertisingBoards(match);
    if (match.config.weather !== 'clear') this.drawWeather(match);
  }

  private drawPitchWear(match: ArcadeMatch): void {
    const ctx = this.ctx;
    const seed = hash32(`${match.config.fixtureId ?? match.matchId}|wear`);
    for (let index = 0; index < 24; index++) {
      const x = 5 + ((seed + index * 187) % 95);
      const y = 3 + (((seed >>> (index % 13)) + index * 113) % 62);
      const p = this.worldToScreen(match, x, y);
      ctx.fillStyle = index % 3 === 0 ? 'rgba(228,210,121,.09)' : 'rgba(5,54,28,.11)';
      ctx.fillRect(p.x, p.y, 2 + index % 4, 1 + index % 2);
    }
    for (const x of [11, FIELD_LENGTH - 11]) {
      const centre = this.worldToScreen(match, x, FIELD_WIDTH / 2);
      ctx.fillStyle = 'rgba(179,150,83,.13)';
      ctx.fillRect(centre.x - 10, centre.y - 3, 21, 6);
    }
  }

  private drawAdvertisingBoards(match: ArcadeMatch): void {
    const ctx = this.ctx;
    const seed = match.home.visuals.stadium.sponsorSeed;
    const labels = ['PIXEL', 'NOVA', 'KICK', 'VOLT', 'BYTE', 'RUSH', 'AERO', 'GOAL'];
    for (const boundaryY of [0, FIELD_WIDTH]) {
      for (let metre = 0; metre < FIELD_LENGTH; metre += 13) {
        const p = this.worldToScreen(match, metre + 6.5, boundaryY);
        if (p.y < -10 || p.y > this.h + 10) continue;
        const index = Math.floor(metre / 13);
        const color = index % 2 ? match.home.visuals.kits.home.shirt : mixHex(match.home.visuals.kits.home.secondary, '#172144', 0.35);
        ctx.fillStyle = color;
        ctx.fillRect(p.x - 39, p.y + (boundaryY === 0 ? -7 : 2), 78, 6);
        ctx.fillStyle = '#f4f4df';
        ctx.font = '5px Silkscreen, monospace';
        ctx.textAlign = 'center';
        ctx.fillText(labels[(seed + index) % labels.length], p.x, p.y + (boundaryY === 0 ? -3 : 6));
      }
    }
  }

  private drawGoal(match: ArcadeMatch, x: number): void {
    const ctx = this.ctx;
    const a = this.worldToScreen(match, x, FIELD_WIDTH / 2 - GOAL_WIDTH / 2);
    const b = this.worldToScreen(match, x, FIELD_WIDTH / 2 + GOAL_WIDTH / 2);
    const direction = x === 0 ? -1 : 1;
    const nearGoal = Math.abs(this.visualBall.x - x) < 3 && Math.abs(this.visualBall.y - FIELD_WIDTH / 2) < GOAL_WIDTH / 2 + 1;
    const flex = nearGoal ? Math.round(this.goalBurst * 4) : 0;
    const depth = direction * (11 + flex);
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

  private drawWeather(match: ArcadeMatch): void {
    const ctx = this.ctx;
    const weather = match.config.weather === 'storm' ? 'storm' : 'rain';
    ctx.strokeStyle = weather === 'storm' ? 'rgba(185,217,255,.34)' : 'rgba(185,217,255,.22)';
    ctx.lineWidth = 1;
    const count = weather === 'storm' ? 70 : 42;
    const motionX = match.config.camera.reducedMotion ? 0 : Math.floor(this.time * 190);
    const motionY = match.config.camera.reducedMotion ? 0 : Math.floor(this.time * 285);
    for (let index = 0; index < count; index++) {
      const x = (index * 97 + motionX) % this.w;
      const y = (index * 53 + motionY) % this.h;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x - 3, y + 7);
      ctx.stroke();
    }
  }

  private drawActors(match: ArcadeMatch, state: VisualMatchState): void {
    const players = state.players;
    const sorted = players.filter((actor) => actor.active).sort((a, b) => a.y - b.y);
    for (const position of sorted) {
      const actor = match.actors.find((candidate) => candidate.player.id === position.id);
      if (actor) this.drawActor(actor, position, match, state.controlledPlayerId, state.tick);
    }
  }

  private drawActor(actor: ArcadeActor, position: ArcadeActor | PlayerRuntimeSnapshot, match: ArcadeMatch, selectedId: string, renderTick: number): void {
    const ctx = this.ctx;
    const point = this.worldToScreen(match, position.x, position.y);
    if (point.x < -24 || point.x > this.w + 24 || point.y < -42 || point.y > this.h + 28) return;
    const x = Math.round(point.x);
    const y = Math.round(point.y);
    const team = actor.side === 'home' ? match.home : match.away;
    const selected = actor.player.id === selectedId;
    ctx.fillStyle = 'rgba(2,4,10,.48)';
    ctx.fillRect(x - 9, y + 8, 19, 4);
    if (selected) {
      ctx.fillStyle = '#ffd34e';
      ctx.fillRect(x - 9, y - 39, 18, 3);
      ctx.fillRect(x - 4, y - 36, 8, 2);
    }
    if (position.card === 'yellow') {
      ctx.fillStyle = '#ffd34e';
      ctx.fillRect(x + 10, y - 32, 3, 5);
    }
    const kit = this.kitFor(actor, match);
    try {
      const sprite = this.sprites.get(actor, position, kit, renderTick);
      ctx.drawImage(sprite, x - 20, y - 38, 40, 48);
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

  private drawBall(match: ArcadeMatch, state: VisualMatchState): void {
    const ball = state.ball;
    const ground = this.worldToScreen(match, ball.x, ball.y);
    const x = Math.round(ground.x);
    const y = Math.round(ground.y - ball.z * this.cameraScale * 0.6);
    const shadowSize = Math.max(2, 7 - Math.round(ball.z));
    this.ctx.fillStyle = 'rgba(2,4,10,.48)';
    this.ctx.fillRect(x - Math.floor(shadowSize / 2), Math.round(ground.y + 4), shadowSize, 2);
    const speed = Math.hypot(ball.vx, ball.vy, ball.vz);
    const stretch = speed > 18 ? 2 : speed > 10 ? 1 : 0;
    this.ctx.fillStyle = '#f4f4df';
    this.ctx.fillRect(x - 3 - stretch, y - 3, 7 + stretch * 2, 7 - Math.min(2, stretch));
    this.ctx.fillStyle = '#172144';
    const rotation = Math.floor((ball.spin * this.time * 5 + match.tick / 4) % 4);
    this.ctx.fillRect(x - 1 + (rotation === 1 ? 2 : rotation === 3 ? -2 : 0), y - 1 + (rotation === 2 ? 2 : 0), 3, 3);
  }

  private recordBallTrail(match: ArcadeMatch, state: VisualMatchState): void {
    const ball = state.ball;
    const tick = state.tick;
    if (this.ballTrail.at(-1)?.tick === tick) return;
    const speed = Math.hypot(ball.vx, ball.vy, ball.vz);
    if (speed > 8 || ball.z > 0.6) this.ballTrail.push({ x: ball.x, y: ball.y, z: ball.z, tick });
    while (this.ballTrail.length > 9 || (this.ballTrail[0] && tick - this.ballTrail[0].tick > 22)) this.ballTrail.shift();
  }

  private drawBallTrail(match: ArcadeMatch): void {
    const ctx = this.ctx;
    for (let index = 0; index < this.ballTrail.length; index++) {
      const trail = this.ballTrail[index];
      const point = this.worldToScreen(match, trail.x, trail.y);
      const alpha = (index + 1) / this.ballTrail.length * 0.23;
      ctx.fillStyle = `rgba(244,244,223,${alpha})`;
      ctx.fillRect(point.x - 1, Math.round(point.y - trail.z * this.cameraScale * 0.6), 3, 2);
    }
  }

  private spawnActionParticles(match: ArcadeMatch): void {
    if (match.config.camera.reducedMotion) return;
    for (const actor of match.actors) {
      if (!['slide', 'shot', 'low-shot', 'finesse-shot', 'lob', 'skill-failed'].includes(actor.action)) continue;
      if (match.tick - actor.actionStartedTick > 2 || this.emittedActions.get(actor.player.id) === actor.actionStartedTick) continue;
      this.emittedActions.set(actor.player.id, actor.actionStartedTick);
      const point = this.worldToScreen(match, actor.x, actor.y);
      const count = actor.action === 'slide' ? 9 : 5;
      for (let index = 0; index < count; index++) {
        const seed = hash32(`${match.config.seed}|${actor.player.id}|${actor.actionStartedTick}|${index}|visual-fx`);
        this.particles.push({
          x: point.x + ((seed & 7) - 3),
          y: point.y + 7,
          vx: ((seed >>> 4) % 9 - 4) * 0.22,
          vy: -0.35 - ((seed >>> 9) % 7) * 0.09,
          life: 1,
          color: match.config.weather === 'clear' ? (index % 3 ? '#4fba63' : '#c2a662') : '#8ec4bd',
          size: index % 3 === 0 ? 2 : 1,
        });
      }
    }
    if (this.pendingGoalBurst) {
      this.pendingGoalBurst = false;
      const point = this.worldToScreen(match, match.ball.x, match.ball.y);
      for (let index = 0; index < 32; index++) {
        const angle = index / 32 * Math.PI * 2;
        const speed = 0.7 + (hash32(`${match.config.seed}|goal|${match.tick}|${index}`) % 10) / 12;
        this.particles.push({
          x: point.x,
          y: point.y,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          life: 1,
          color: index % 3 === 0 ? '#ffd34e' : index % 3 === 1 ? '#f4f4df' : match.home.visuals.kits.home.shirt,
          size: index % 4 === 0 ? 3 : 2,
        });
      }
    }
  }

  private updateAndDrawParticles(match: ArcadeMatch, deltaSeconds: number): void {
    const ctx = this.ctx;
    const frameScale = deltaSeconds * 60;
    for (let index = this.particles.length - 1; index >= 0; index--) {
      const particle = this.particles[index];
      particle.x += particle.vx * frameScale;
      particle.y += particle.vy * frameScale;
      particle.vy += 0.025 * frameScale;
      particle.life -= (match.config.camera.reducedMotion ? 0.12 : 0.035) * frameScale;
      if (particle.life <= 0) {
        this.particles.splice(index, 1);
        continue;
      }
      ctx.globalAlpha = particle.life;
      ctx.fillStyle = particle.color;
      ctx.fillRect(Math.round(particle.x), Math.round(particle.y), particle.size, particle.size);
    }
    ctx.globalAlpha = 1;
  }

  private drawGoalPresentation(match: ArcadeMatch): void {
    const ctx = this.ctx;
    const controlledScored = match.events.at(-1)?.side === match.controlledSide;
    const team = controlledScored ? (match.controlledSide === 'home' ? match.home : match.away) : match.events.at(-1)?.side === 'home' ? match.home : match.away;
    const width = 152;
    const reveal = Math.min(1, (1 - this.goalBurst) * 5);
    const x = Math.round(this.w / 2 - width / 2);
    const y = 72;
    ctx.fillStyle = 'rgba(5,7,19,.92)';
    ctx.fillRect(x, y, Math.round(width * reveal), 38);
    ctx.strokeStyle = team.visuals.kits.home.shirt;
    ctx.strokeRect(x, y, Math.round(width * reveal), 38);
    if (reveal > 0.72) {
      ctx.fillStyle = '#ffd34e';
      ctx.font = '12px Silkscreen, monospace';
      ctx.textAlign = 'center';
      ctx.fillText('GOAL!', this.w / 2, y + 15);
      ctx.fillStyle = '#f4f4df';
      ctx.font = '7px Silkscreen, monospace';
      ctx.fillText(`${team.shortName} · ${match.homeScore}:${match.awayScore}`, this.w / 2, y + 29);
    }
  }

  private drawEdgeIndicators(match: ArcadeMatch, state: VisualMatchState): void {
    const players = state.players;
    const selectedSide = match.controlledSide;
    for (const player of players.filter((candidate) => candidate.active && candidate.side === selectedSide)) {
      const playerId = player.id;
      const point = this.worldToScreen(match, player.x, player.y);
      if (point.x >= 10 && point.x <= this.w - 10 && point.y >= 12 && point.y <= this.h - 12) continue;
      const x = clampCamera(point.x, 9, this.w - 9);
      const y = clampCamera(point.y, 12, this.h - 12);
      this.ctx.fillStyle = playerId === state.controlledPlayerId ? '#ffd34e' : '#54f28b';
      this.ctx.fillRect(Math.round(x - 3), Math.round(y - 3), 7, 7);
    }
  }

  private drawMinimap(match: ArcadeMatch, state: VisualMatchState): void {
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
    const players = state.players;
    for (const player of players.filter((candidate) => candidate.active)) {
      const playerId = player.id;
      const x = map.x + (state.attackDirection < 0 ? 1 - player.x / FIELD_LENGTH : player.x / FIELD_LENGTH) * map.w;
      const y = map.y + player.y / FIELD_WIDTH * map.h;
      ctx.fillStyle = player.side === match.controlledSide ? '#54f28b' : '#ff5d7d';
      ctx.fillRect(Math.round(x - 1), Math.round(y - 1), 3, 3);
      if (playerId === state.controlledPlayerId) {
        ctx.strokeStyle = '#ffd34e';
        ctx.strokeRect(Math.round(x - 3), Math.round(y - 3), 7, 7);
      }
    }
    const ball = state.ball;
    const bx = map.x + (state.attackDirection < 0 ? 1 - ball.x / FIELD_LENGTH : ball.x / FIELD_LENGTH) * map.w;
    const by = map.y + ball.y / FIELD_WIDTH * map.h;
    ctx.fillStyle = '#fff';
    ctx.fillRect(Math.round(bx - 1), Math.round(by - 1), 3, 3);
  }

  private drawHud(match: ArcadeMatch, state: VisualMatchState): void {
    const ctx = this.ctx;
    const selectedActor = match.actors.find((actor) => actor.player.id === state.controlledPlayerId);
    const selectedRuntime = state.players.find((actor) => actor.id === state.controlledPlayerId);
    ctx.fillStyle = 'rgba(5,7,19,.92)';
    ctx.fillRect(12, 12, 172, 31);
    ctx.strokeStyle = '#49619a';
    ctx.strokeRect(12, 12, 172, 31);
    if (selectedActor && selectedRuntime) {
      ctx.fillStyle = '#f4f4df';
      ctx.font = '8px Silkscreen, monospace';
      ctx.textAlign = 'left';
      ctx.fillText(`${selectedActor.player.kitNumber} ${selectedActor.player.lastName.toUpperCase()}`, 19, 23);
      ctx.fillStyle = '#172144';
      ctx.fillRect(19, 30, 116, 4);
      ctx.fillStyle = selectedRuntime.fitness > 40 ? '#54f28b' : selectedRuntime.fitness > 25 ? '#ffd34e' : '#ff5d7d';
      ctx.fillRect(19, 30, Math.round(116 * selectedRuntime.fitness / 100), 4);
      if (selectedRuntime.card === 'yellow') {
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
    const transformedX = this.renderAttackDirection < 0 ? FIELD_LENGTH - x : x;
    const shake = match.config.camera.shake && !match.config.camera.reducedMotion && this.goalBurst > 0
      ? Math.round(Math.sin(this.time * 91) * this.goalBurst * 2)
      : 0;
    return {
      x: Math.round((transformedX - this.cameraX) * this.cameraScale + this.w / 2) + shake,
      y: Math.round((y - this.cameraY) * this.cameraScale + this.h / 2) - shake,
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

export function interpolateMatchRenderFrame(frame: MatchRenderFrame): MatchRenderState {
  const alpha = Math.max(0, Math.min(1, frame.alpha));
  if (frame.previous.discontinuityKey !== frame.current.discontinuityKey) return frame.current;
  const previousPlayers = new Map(frame.previous.players.map((player) => [player.id, player]));
  const players = frame.current.players.map((current) => {
    const previous = previousPlayers.get(current.id);
    if (!previous) return current;
    const facingX = lerp(previous.facingX, current.facingX, alpha);
    const facingY = lerp(previous.facingY, current.facingY, alpha);
    const facingLength = Math.hypot(facingX, facingY) || 1;
    return {
      ...current,
      x: lerp(previous.x, current.x, alpha),
      y: lerp(previous.y, current.y, alpha),
      vx: lerp(previous.vx, current.vx, alpha),
      vy: lerp(previous.vy, current.vy, alpha),
      facingX: facingX / facingLength,
      facingY: facingY / facingLength,
      fitness: lerp(previous.fitness, current.fitness, alpha),
      animationDistance: lerp(previous.animationDistance ?? 0, current.animationDistance ?? 0, alpha),
    };
  });
  return {
    ...frame.current,
    tick: Math.round(lerp(frame.previous.tick, frame.current.tick, alpha)),
    ball: {
      ...frame.current.ball,
      x: lerp(frame.previous.ball.x, frame.current.ball.x, alpha),
      y: lerp(frame.previous.ball.y, frame.current.ball.y, alpha),
      z: lerp(frame.previous.ball.z, frame.current.ball.z, alpha),
      vx: lerp(frame.previous.ball.vx, frame.current.ball.vx, alpha),
      vy: lerp(frame.previous.ball.vy, frame.current.ball.vy, alpha),
      vz: lerp(frame.previous.ball.vz, frame.current.ball.vz, alpha),
      spin: lerp(frame.previous.ball.spin, frame.current.ball.spin, alpha),
    },
    players,
  };
}

function lerp(from: number, to: number, amount: number): number {
  return from + (to - from) * amount;
}
