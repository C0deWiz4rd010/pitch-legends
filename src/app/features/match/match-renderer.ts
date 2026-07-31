import { Team } from '../../models/team.model';
import { MatchKeyframe } from '../../models/match.model';

type Theme = 'day' | 'dusk' | 'night';
type Weather = 'clear' | 'rain' | 'snow';

interface Dot {
  bx: number;
  by: number;
  x: number;
  y: number;
  px: number;
  py: number;
  color: string;
  text: string;
  num: number;
  isGK: boolean;
  phase: number;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  color: string;
  kind: 'confetti' | 'grass' | 'rain' | 'snow';
  rot: number;
  vr: number;
}

interface Seat {
  x: number;
  y: number;
  base: string;
  phase: number;
}

/** Cinematic Canvas 2D match renderer: stadium, crowd, floodlights, camera and particles. */
export class MatchPitchRenderer {
  private ctx: CanvasRenderingContext2D;
  private dpr = Math.min(window.devicePixelRatio || 1, 2);
  private dots: Dot[] = [];
  private seats: Seat[] = [];
  private particles: Particle[] = [];
  private ball = { x: 0.5, y: 0.5 };
  private ballTrail: { x: number; y: number }[] = [];
  private ballSpin = 0;

  private w = 0;
  private h = 0;
  private pitch = { x: 0, y: 0, w: 0, h: 0 };

  private cam = { x: 0, y: 0, zoom: 1.12, shake: 0 };
  private goalFlash = 0;
  private goalHome = false;
  private time = 0;

  private theme: Theme;
  private weather: Weather;
  private homeColor: string;
  private awayColor: string;

  constructor(
    private canvas: HTMLCanvasElement,
    home: Team,
    away: Team,
    private keyframes: MatchKeyframe[],
  ) {
    this.ctx = canvas.getContext('2d')!;
    this.homeColor = home.kit.primary;
    this.awayColor = away.kit.primary;
    const themes: Theme[] = ['day', 'dusk', 'night'];
    const weathers: Weather[] = ['clear', 'clear', 'clear', 'rain', 'snow'];
    this.theme = themes[Math.floor(Math.random() * themes.length)];
    this.weather = weathers[Math.floor(Math.random() * weathers.length)];
    this.buildDots(home, away);
    this.resize();
    window.addEventListener('resize', this.resize);
  }

  private buildDots(home: Team, away: Team): void {
    const make = (team: Team, isHome: boolean) => {
      team.formation.slots.forEach((slot) => {
        const player = team.players.find((p) => p.id === slot.playerId);
        const bx = isHome ? slot.x : 1 - slot.x;
        const by = isHome ? slot.y : 1 - slot.y;
        this.dots.push({
          bx,
          by,
          x: bx,
          y: by,
          px: bx,
          py: by,
          color: isHome ? this.homeColor : this.awayColor,
          text: this.contrast(isHome ? this.homeColor : this.awayColor),
          num: player?.kitNumber ?? 0,
          isGK: slot.position === 'GK',
          phase: Math.random() * Math.PI * 2,
        });
      });
    };
    make(home, true);
    make(away, false);
  }

  /** Refresh shirt numbers after substitutions. */
  refreshNumbers(home: Team, away: Team): void {
    const slots = [...home.formation.slots, ...away.formation.slots];
    const players = [...home.players, ...away.players];
    this.dots.forEach((d, i) => {
      const slot = slots[i];
      if (!slot) return;
      const player = players.find((p) => p.id === slot.playerId);
      d.num = player?.kitNumber ?? d.num;
    });
  }

  private resize = (): void => {
    const rect = this.canvas.getBoundingClientRect();
    this.w = rect.width;
    this.h = rect.height;
    this.canvas.width = Math.round(rect.width * this.dpr);
    this.canvas.height = Math.round(rect.height * this.dpr);
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    // Pitch inset leaves room for stands on all sides.
    const mx = this.w * 0.1;
    const my = this.h * 0.12;
    this.pitch = { x: mx, y: my, w: this.w - mx * 2, h: this.h - my * 2 };
    this.buildSeats();
  };

  private buildSeats(): void {
    this.seats = [];
    const homeC = this.homeColor;
    const awayC = this.awayColor;
    const cols = ['#c9d4e6', '#9fb0c9', homeC, awayC, '#e8eef7'];
    const bandDepth = { x: this.w * 0.09, y: this.h * 0.1 };
    const spacing = 9;
    const add = (x: number, y: number, side: 'h' | 'a' | 'n') => {
      const base = side === 'h' ? homeC : side === 'a' ? awayC : cols[Math.floor(Math.random() * cols.length)];
      this.seats.push({ x, y, base, phase: Math.random() * Math.PI * 2 });
    };
    // Top & bottom stands (home fans behind left goal-ish, away behind right).
    for (let x = 6; x < this.w - 6; x += spacing) {
      for (let y = 4; y < bandDepth.y; y += spacing) {
        add(x, y, x < this.w / 2 ? 'h' : 'a');
      }
      for (let y = this.h - bandDepth.y; y < this.h - 4; y += spacing) {
        add(x, y, x < this.w / 2 ? 'h' : 'a');
      }
    }
    // Left & right stands.
    for (let y = bandDepth.y; y < this.h - bandDepth.y; y += spacing) {
      for (let x = 4; x < bandDepth.x; x += spacing) add(x, y, 'h');
      for (let x = this.w - bandDepth.x; x < this.w - 4; x += spacing) add(x, y, 'a');
    }
  }

  triggerGoal(home: boolean): void {
    this.goalFlash = 1;
    this.goalHome = home;
    this.cam.shake = 1;
    this.cam.zoom = 1.32;
    // Confetti burst near the scoring goal mouth.
    const gx = home ? 0.9 : 0.1;
    for (let i = 0; i < 90; i++) {
      const px = this.pitch.x + gx * this.pitch.w + (Math.random() - 0.5) * 60;
      const py = this.pitch.y + this.pitch.h * (0.2 + Math.random() * 0.6);
      const ang = Math.random() * Math.PI * 2;
      const spd = 1.5 + Math.random() * 4;
      this.particles.push({
        x: px,
        y: py,
        vx: Math.cos(ang) * spd,
        vy: Math.sin(ang) * spd - 2,
        life: 1,
        maxLife: 1,
        size: 3 + Math.random() * 4,
        color: this.confettiColor(),
        kind: 'confetti',
        rot: Math.random() * Math.PI,
        vr: (Math.random() - 0.5) * 0.4,
      });
    }
  }

  render(minute: number): void {
    this.time += 0.016;
    this.updateBall(minute);
    this.updateDots();
    this.updateCamera();
    this.updateParticles();
    this.spawnWeather();
    this.draw();
    if (this.goalFlash > 0) this.goalFlash = Math.max(0, this.goalFlash - 0.018);
  }

  private updateBall(minute: number): void {
    const kfs = this.keyframes;
    if (kfs.length) {
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
      const dx = tx - this.ball.x;
      const dy = ty - this.ball.y;
      this.ball.x += dx * 0.12;
      this.ball.y += dy * 0.12;
      this.ballSpin += Math.hypot(dx, dy) * 8;
    }
    this.ballTrail.push({ x: this.ball.x, y: this.ball.y });
    if (this.ballTrail.length > 16) this.ballTrail.shift();
  }

  private updateDots(): void {
    for (const d of this.dots) {
      d.px = d.x;
      d.py = d.y;
      const distToBall = Math.hypot(this.ball.x - d.bx, this.ball.y - d.by);
      const pull = Math.max(0, 0.18 - distToBall * 0.16);
      const wanderX = Math.sin(this.time * 0.8 + d.phase) * 0.006;
      const wanderY = Math.cos(this.time * 0.7 + d.phase) * 0.006;
      const tx = d.bx + (this.ball.x - d.bx) * pull + wanderX;
      const ty = d.by + (this.ball.y - d.by) * pull + wanderY;
      d.x += (tx - d.x) * 0.06;
      d.y += (ty - d.y) * 0.06;
    }
  }

  private updateCamera(): void {
    const bx = this.px(this.ball.x);
    const by = this.py(this.ball.y);
    this.cam.x += (bx - this.cam.x) * 0.05;
    this.cam.y += (by - this.cam.y) * 0.05;
    const targetZoom = this.goalFlash > 0.3 ? this.cam.zoom : 1.12;
    this.cam.zoom += (targetZoom - this.cam.zoom) * 0.08;
    this.cam.shake *= 0.9;
  }

  private updateParticles(): void {
    for (const p of this.particles) {
      p.x += p.vx;
      p.y += p.vy;
      p.rot += p.vr;
      if (p.kind === 'confetti') {
        p.vy += 0.12;
        p.vx *= 0.99;
        p.life -= 0.012;
      } else if (p.kind === 'grass') {
        p.vy += 0.08;
        p.life -= 0.04;
      } else {
        // rain / snow reset when off the bottom
        if (p.y > this.h + 10) {
          p.y = -10;
          p.x = Math.random() * this.w;
        }
      }
    }
    this.particles = this.particles.filter((p) => p.kind === 'rain' || p.kind === 'snow' || p.life > 0);
  }

  private spawnWeather(): void {
    if (this.weather === 'clear') return;
    const target = this.weather === 'rain' ? 120 : 90;
    const current = this.particles.filter((p) => p.kind === this.weather).length;
    for (let i = current; i < target; i++) {
      if (this.weather === 'rain') {
        this.particles.push({
          x: Math.random() * this.w,
          y: Math.random() * this.h,
          vx: 1.4,
          vy: 11,
          life: 1,
          maxLife: 1,
          size: 1.4,
          color: 'rgba(180,200,230,0.5)',
          kind: 'rain',
          rot: 0,
          vr: 0,
        });
      } else {
        this.particles.push({
          x: Math.random() * this.w,
          y: Math.random() * this.h,
          vx: Math.sin(Math.random() * 6) * 0.6,
          vy: 1 + Math.random() * 1.2,
          life: 1,
          maxLife: 1,
          size: 1.6 + Math.random() * 1.8,
          color: 'rgba(255,255,255,0.85)',
          kind: 'snow',
          rot: 0,
          vr: 0,
        });
      }
    }
  }

  // ── Coordinate mapping ─────────────────────────────────────────────────────
  private px(nx: number): number {
    return this.pitch.x + nx * this.pitch.w;
  }
  private py(ny: number): number {
    return this.pitch.y + ny * this.pitch.h;
  }

  private draw(): void {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.w, this.h);
    this.drawSky();

    ctx.save();
    // Camera: gentle follow with parallax + zoom + shake.
    const cx = this.w / 2;
    const cy = this.h / 2;
    const panX = cx + (this.cam.x - cx) * 0.32;
    const panY = cy + (this.cam.y - cy) * 0.32;
    const sh = this.cam.shake;
    ctx.translate(cx + (Math.random() - 0.5) * 10 * sh, cy + (Math.random() - 0.5) * 10 * sh);
    ctx.scale(this.cam.zoom, this.cam.zoom);
    ctx.translate(-panX, -panY);

    this.drawStands();
    this.drawCrowd();
    this.drawPitch();
    this.drawShadows();
    this.drawPlayers();
    this.drawBall();
    this.drawWorldParticles();

    ctx.restore();

    this.drawFloodlights();
    this.drawVignette();
    if (this.goalFlash > 0) {
      ctx.fillStyle = `rgba(56,224,123,${this.goalFlash * 0.26})`;
      ctx.fillRect(0, 0, this.w, this.h);
    }
  }

  private drawSky(): void {
    const ctx = this.ctx;
    const g = ctx.createLinearGradient(0, 0, 0, this.h);
    if (this.theme === 'day') {
      g.addColorStop(0, '#243447');
      g.addColorStop(1, '#0f1826');
    } else if (this.theme === 'dusk') {
      g.addColorStop(0, '#3a2740');
      g.addColorStop(1, '#160f1e');
    } else {
      g.addColorStop(0, '#0b1524');
      g.addColorStop(1, '#05080f');
    }
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, this.w, this.h);
  }

  private drawStands(): void {
    const ctx = this.ctx;
    ctx.fillStyle = '#0c1420';
    ctx.fillRect(-this.w, -this.h, this.w * 3, this.h * 3);
  }

  private drawCrowd(): void {
    const ctx = this.ctx;
    for (const s of this.seats) {
      const tw = 0.6 + Math.sin(this.time * 4 + s.phase) * 0.4;
      ctx.globalAlpha = 0.45 + tw * 0.4;
      ctx.fillStyle = s.base;
      ctx.fillRect(s.x, s.y, 3, 3);
    }
    ctx.globalAlpha = 1;
  }

  private drawPitch(): void {
    const ctx = this.ctx;
    const { x, y, w, h } = this.pitch;
    const stripes = 10;
    for (let i = 0; i < stripes; i++) {
      ctx.fillStyle = i % 2 === 0 ? '#1e8a4b' : '#1a7d44';
      ctx.fillRect(x + (i / stripes) * w, y, w / stripes + 1, h);
    }
    // Soft turf sheen.
    const sheen = ctx.createLinearGradient(x, y, x, y + h);
    sheen.addColorStop(0, 'rgba(255,255,255,0.06)');
    sheen.addColorStop(0.5, 'rgba(255,255,255,0)');
    sheen.addColorStop(1, 'rgba(0,0,0,0.18)');
    ctx.fillStyle = sheen;
    ctx.fillRect(x, y, w, h);

    ctx.strokeStyle = 'rgba(255,255,255,0.55)';
    ctx.lineWidth = 2;
    ctx.strokeRect(x, y, w, h);
    // Halfway line + centre circle + spot.
    ctx.beginPath();
    ctx.moveTo(x + w / 2, y);
    ctx.lineTo(x + w / 2, y + h);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(x + w / 2, y + h / 2, Math.min(w, h) * 0.13, 0, Math.PI * 2);
    ctx.stroke();
    this.spot(x + w / 2, y + h / 2);
    // Penalty boxes, six-yard boxes, spots and arcs.
    const boxH = h * 0.5;
    const boxW = w * 0.15;
    const sixH = h * 0.24;
    const sixW = w * 0.06;
    ctx.strokeRect(x, y + (h - boxH) / 2, boxW, boxH);
    ctx.strokeRect(x + w - boxW, y + (h - boxH) / 2, boxW, boxH);
    ctx.strokeRect(x, y + (h - sixH) / 2, sixW, sixH);
    ctx.strokeRect(x + w - sixW, y + (h - sixH) / 2, sixW, sixH);
    this.spot(x + boxW * 0.72, y + h / 2);
    this.spot(x + w - boxW * 0.72, y + h / 2);
    ctx.beginPath();
    ctx.arc(x + boxW * 0.72, y + h / 2, boxW * 0.55, -0.5, 0.5);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(x + w - boxW * 0.72, y + h / 2, boxW * 0.55, Math.PI - 0.5, Math.PI + 0.5);
    ctx.stroke();
    // Goals.
    ctx.strokeStyle = 'rgba(255,255,255,0.8)';
    const goalH = h * 0.16;
    ctx.strokeRect(x - 5, y + (h - goalH) / 2, 5, goalH);
    ctx.strokeRect(x + w, y + (h - goalH) / 2, 5, goalH);
  }

  private spot(x: number, y: number): void {
    const ctx = this.ctx;
    ctx.beginPath();
    ctx.arc(x, y, 2, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.fill();
  }

  private drawShadows(): void {
    const ctx = this.ctx;
    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    for (const d of this.dots) {
      ctx.beginPath();
      ctx.ellipse(this.px(d.x) + 3, this.py(d.y) + 9, 10, 4, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.beginPath();
    ctx.ellipse(this.px(this.ball.x) + 2, this.py(this.ball.y) + 6, 5, 2.5, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  private drawPlayers(): void {
    const ctx = this.ctx;
    for (const d of this.dots) {
      const x = this.px(d.x);
      const y = this.py(d.y);
      const speed = Math.hypot(d.x - d.px, d.y - d.py);
      const bob = Math.sin(this.time * 12 + d.phase) * Math.min(speed * 120, 3);
      const r = 11;
      ctx.save();
      ctx.translate(x, y - bob);
      // Body.
      const grad = ctx.createRadialGradient(-3, -4, 2, 0, 0, r);
      grad.addColorStop(0, this.lighten(d.color, 0.35));
      grad.addColorStop(1, d.color);
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.fillStyle = grad;
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = d.isGK ? '#ffd24a' : 'rgba(255,255,255,0.7)';
      ctx.stroke();
      // Number.
      ctx.fillStyle = d.text;
      ctx.font = '800 10px Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(d.num), 0, 0);
      ctx.restore();
    }
  }

  private drawBall(): void {
    const ctx = this.ctx;
    for (let i = 0; i < this.ballTrail.length; i++) {
      const p = this.ballTrail[i];
      const a = (i / this.ballTrail.length) * 0.4;
      ctx.beginPath();
      ctx.arc(this.px(p.x), this.py(p.y), 2 + (i / this.ballTrail.length) * 3, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(255,255,255,${a})`;
      ctx.fill();
    }
    const bx = this.px(this.ball.x);
    const by = this.py(this.ball.y);
    ctx.save();
    ctx.translate(bx, by);
    ctx.rotate(this.ballSpin);
    ctx.beginPath();
    ctx.arc(0, 0, 6, 0, Math.PI * 2);
    ctx.fillStyle = '#fff';
    ctx.shadowColor = 'rgba(255,255,255,0.9)';
    ctx.shadowBlur = 12;
    ctx.fill();
    ctx.shadowBlur = 0;
    // Spin accents.
    ctx.fillStyle = 'rgba(20,30,45,0.85)';
    ctx.beginPath();
    ctx.arc(1.6, 0, 1.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  private drawWorldParticles(): void {
    const ctx = this.ctx;
    for (const p of this.particles) {
      if (p.kind === 'rain') continue; // rain drawn in screen space
      ctx.save();
      ctx.globalAlpha = p.kind === 'confetti' ? Math.max(0, p.life) : 0.85;
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = p.color;
      if (p.kind === 'snow') {
        ctx.beginPath();
        ctx.arc(0, 0, p.size, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 1.6);
      }
      ctx.restore();
    }
  }

  private drawFloodlights(): void {
    const ctx = this.ctx;
    const intensity = this.theme === 'night' ? 0.5 : this.theme === 'dusk' ? 0.32 : 0.2;
    const corners = [
      [this.w * 0.16, this.h * 0.05],
      [this.w * 0.84, this.h * 0.05],
      [this.w * 0.16, this.h * 0.95],
      [this.w * 0.84, this.h * 0.95],
    ];
    for (const [cx, cy] of corners) {
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, this.h * 0.7);
      g.addColorStop(0, `rgba(220,235,255,${intensity})`);
      g.addColorStop(0.3, `rgba(200,225,255,${intensity * 0.25})`);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, this.w, this.h);
    }
    // Rain streaks (screen space, above lighting).
    if (this.weather === 'rain') {
      ctx.strokeStyle = 'rgba(190,210,235,0.35)';
      ctx.lineWidth = 1.2;
      for (const p of this.particles) {
        if (p.kind !== 'rain') continue;
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(p.x - p.vx * 1.5, p.y - p.vy * 1.5);
        ctx.stroke();
      }
    }
  }

  private drawVignette(): void {
    const ctx = this.ctx;
    const g = ctx.createRadialGradient(
      this.w / 2,
      this.h / 2,
      this.h * 0.3,
      this.w / 2,
      this.h / 2,
      this.h * 0.8,
    );
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, 'rgba(0,0,0,0.45)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, this.w, this.h);
  }

  // ── Color helpers ──────────────────────────────────────────────────────────
  private contrast(hex: string): string {
    const { r, g, b } = this.rgb(hex);
    const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    return lum > 0.6 ? '#0a1420' : '#ffffff';
  }
  private lighten(hex: string, amt: number): string {
    const { r, g, b } = this.rgb(hex);
    const l = (c: number) => Math.round(c + (255 - c) * amt);
    return `rgb(${l(r)},${l(g)},${l(b)})`;
  }
  private rgb(hex: string): { r: number; g: number; b: number } {
    const c = hex.replace('#', '');
    if (c.length < 6) return { r: 120, g: 140, b: 170 };
    return {
      r: parseInt(c.slice(0, 2), 16),
      g: parseInt(c.slice(2, 4), 16),
      b: parseInt(c.slice(4, 6), 16),
    };
  }
  private confettiColor(): string {
    const palette = ['#38e07b', '#22d3ee', '#f5c542', '#f5455c', '#ffffff', this.homeColor];
    return palette[Math.floor(Math.random() * palette.length)];
  }

  destroy(): void {
    window.removeEventListener('resize', this.resize);
  }
}
