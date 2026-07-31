import { Team } from '../../models/team.model';
import { MatchResult, MatchKeyframe } from '../../models/match.model';

interface Dot {
  bx: number; // base normalized x (length, 0-1)
  by: number; // base normalized y (width, 0-1)
  x: number;
  y: number;
  color: string;
  text: string;
  num: number;
  home: boolean;
  phase: number;
}

/** Draws an attractive, animated abstract match replay onto a canvas. */
export class MatchPitchRenderer {
  private ctx: CanvasRenderingContext2D;
  private dpr = Math.min(window.devicePixelRatio || 1, 2);
  private dots: Dot[] = [];
  private keyframes: MatchKeyframe[];
  private ball = { x: 0.5, y: 0.5 };
  private ballTrail: { x: number; y: number }[] = [];
  private goalFlash = 0;
  private goalHome = false;
  private w = 0;
  private h = 0;

  constructor(
    private canvas: HTMLCanvasElement,
    home: Team,
    away: Team,
    result: MatchResult,
  ) {
    this.ctx = canvas.getContext('2d')!;
    this.keyframes = result.keyframes;
    this.buildDots(home, away);
    this.resize();
    window.addEventListener('resize', this.resize);
  }

  private buildDots(home: Team, away: Team): void {
    const make = (team: Team, isHome: boolean) => {
      team.formation.slots.forEach((slot) => {
        const player = team.players.find((p) => p.id === slot.playerId);
        this.dots.push({
          bx: isHome ? slot.x : 1 - slot.x,
          by: isHome ? slot.y : 1 - slot.y,
          x: isHome ? slot.x : 1 - slot.x,
          y: isHome ? slot.y : 1 - slot.y,
          color: isHome ? home.kit.primary : away.kit.primary,
          text: this.contrast(isHome ? home.kit.primary : away.kit.primary),
          num: player?.kitNumber ?? 0,
          home: isHome,
          phase: Math.random() * Math.PI * 2,
        });
      });
    };
    make(home, true);
    make(away, false);
  }

  private resize = (): void => {
    const rect = this.canvas.getBoundingClientRect();
    this.w = rect.width;
    this.h = rect.height;
    this.canvas.width = Math.round(rect.width * this.dpr);
    this.canvas.height = Math.round(rect.height * this.dpr);
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
  };

  triggerGoal(home: boolean): void {
    this.goalFlash = 1;
    this.goalHome = home;
  }

  render(minute: number): void {
    this.updateBall(minute);
    this.updateDots();
    this.draw();
    if (this.goalFlash > 0) this.goalFlash = Math.max(0, this.goalFlash - 0.02);
  }

  private updateBall(minute: number): void {
    const kfs = this.keyframes;
    if (!kfs.length) return;
    let prev = kfs[0];
    let next = kfs[kfs.length - 1];
    for (let i = 0; i < kfs.length - 1; i++) {
      if (kfs[i].minute <= minute && kfs[i + 1].minute >= minute) {
        prev = kfs[i];
        next = kfs[i + 1];
        break;
      }
    }
    const span = next.minute - prev.minute || 1;
    const t = Math.max(0, Math.min(1, (minute - prev.minute) / span));
    const tx = prev.ball.x + (next.ball.x - prev.ball.x) * t;
    const ty = prev.ball.y + (next.ball.y - prev.ball.y) * t;
    this.ball.x += (tx - this.ball.x) * 0.12;
    this.ball.y += (ty - this.ball.y) * 0.12;
    this.ballTrail.push({ x: this.ball.x, y: this.ball.y });
    if (this.ballTrail.length > 14) this.ballTrail.shift();
  }

  private updateDots(): void {
    const now = performance.now() / 1000;
    for (const d of this.dots) {
      const distToBall = Math.hypot(this.ball.x - d.bx, this.ball.y - d.by);
      const pull = Math.max(0, 0.16 - distToBall * 0.16);
      const wanderX = Math.sin(now * 0.8 + d.phase) * 0.006;
      const wanderY = Math.cos(now * 0.7 + d.phase) * 0.006;
      const tx = d.bx + (this.ball.x - d.bx) * pull + wanderX;
      const ty = d.by + (this.ball.y - d.by) * pull + wanderY;
      d.x += (tx - d.x) * 0.06;
      d.y += (ty - d.y) * 0.06;
    }
  }

  private nx(v: number): number {
    return 14 + v * (this.w - 28);
  }
  private ny(v: number): number {
    return 14 + v * (this.h - 28);
  }

  private draw(): void {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.w, this.h);
    this.drawPitch();

    // Ball trail
    for (let i = 0; i < this.ballTrail.length; i++) {
      const p = this.ballTrail[i];
      const alpha = (i / this.ballTrail.length) * 0.35;
      ctx.beginPath();
      ctx.arc(this.nx(p.x), this.ny(p.y), 3, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(255,255,255,${alpha})`;
      ctx.fill();
    }

    // Players
    for (const d of this.dots) {
      const x = this.nx(d.x);
      const y = this.ny(d.y);
      ctx.beginPath();
      ctx.arc(x, y, 11, 0, Math.PI * 2);
      ctx.fillStyle = d.color;
      ctx.shadowColor = 'rgba(0,0,0,0.5)';
      ctx.shadowBlur = 6;
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.lineWidth = 2;
      ctx.strokeStyle = 'rgba(255,255,255,0.65)';
      ctx.stroke();
      ctx.fillStyle = d.text;
      ctx.font = '700 10px Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(d.num), x, y);
    }

    // Ball
    const bx = this.nx(this.ball.x);
    const by = this.ny(this.ball.y);
    ctx.beginPath();
    ctx.arc(bx, by, 5.5, 0, Math.PI * 2);
    ctx.fillStyle = '#fff';
    ctx.shadowColor = 'rgba(255,255,255,0.9)';
    ctx.shadowBlur = 12;
    ctx.fill();
    ctx.shadowBlur = 0;

    if (this.goalFlash > 0) {
      ctx.fillStyle = `rgba(56,224,123,${this.goalFlash * 0.28})`;
      ctx.fillRect(0, 0, this.w, this.h);
    }
  }

  private drawPitch(): void {
    const ctx = this.ctx;
    const W = this.w;
    const H = this.h;
    // Turf stripes (vertical, along length).
    const stripes = 8;
    for (let i = 0; i < stripes; i++) {
      ctx.fillStyle = i % 2 === 0 ? '#1c8046' : '#1a7742';
      ctx.fillRect((i / stripes) * W, 0, W / stripes + 1, H);
    }
    ctx.strokeStyle = 'rgba(255,255,255,0.32)';
    ctx.lineWidth = 2;
    const pad = 12;
    ctx.strokeRect(pad, pad, W - pad * 2, H - pad * 2);
    // Halfway line (vertical) + centre circle.
    ctx.beginPath();
    ctx.moveTo(W / 2, pad);
    ctx.lineTo(W / 2, H - pad);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(W / 2, H / 2, Math.min(W, H) * 0.12, 0, Math.PI * 2);
    ctx.stroke();
    // Penalty boxes (left & right).
    const boxH = H * 0.44;
    const boxW = W * 0.14;
    ctx.strokeRect(pad, (H - boxH) / 2, boxW, boxH);
    ctx.strokeRect(W - pad - boxW, (H - boxH) / 2, boxW, boxH);
  }

  private contrast(hex: string): string {
    const c = hex.replace('#', '');
    if (c.length < 6) return '#fff';
    const r = parseInt(c.slice(0, 2), 16);
    const g = parseInt(c.slice(2, 4), 16);
    const b = parseInt(c.slice(4, 6), 16);
    const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    return lum > 0.6 ? '#0a1420' : '#ffffff';
  }

  destroy(): void {
    window.removeEventListener('resize', this.resize);
  }
}
