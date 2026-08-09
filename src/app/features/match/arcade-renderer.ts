import { ArcadeActor, ArcadeMatch } from '../../core/services/arcade-match';

export class ArcadePitchRenderer {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly w = 640;
  private readonly h = 360;
  private readonly pitch = { x: 42, y: 34, w: 556, h: 292 };
  private time = 0;
  private flash = 0;

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

  render(match: ArcadeMatch): void {
    this.time += 1 / 60;
    this.drawBackdrop(match);
    this.drawPitch();
    this.drawActors(match);
    this.drawBall(match);
    this.drawHud(match);
    if (this.flash > 0) {
      this.ctx.fillStyle = `rgba(255,211,78,${this.flash * 0.24})`;
      this.ctx.fillRect(0, 0, this.w, this.h);
      this.flash = Math.max(0, this.flash - 0.025);
    }
  }

  destroy(): void {
    // Kept for a shared renderer lifecycle with the coach renderer.
  }

  private drawBackdrop(match: ArcadeMatch): void {
    const ctx = this.ctx;
    ctx.fillStyle = '#050713';
    ctx.fillRect(0, 0, this.w, this.h);
    ctx.fillStyle = '#101938';
    ctx.fillRect(0, 10, this.w, 26);
    ctx.fillRect(0, this.h - 34, this.w, 24);
    for (let x = 4; x < this.w; x += 8) {
      const home = x < this.w / 2;
      const base = home ? match.home.kit.primary : match.away.kit.primary;
      ctx.fillStyle = (x / 8 + Math.floor(this.time * 3)) % 5 === 0 ? '#ffd34e' : base;
      ctx.fillRect(x, 17 + ((x / 8) % 2) * 5, 3, 3);
      ctx.fillRect(x, this.h - 25 - ((x / 8) % 2) * 4, 3, 3);
    }
  }

  private drawPitch(): void {
    const ctx = this.ctx;
    const p = this.pitch;
    ctx.fillStyle = '#07120c';
    ctx.fillRect(p.x - 6, p.y - 6, p.w + 12, p.h + 12);
    for (let i = 0; i < 10; i++) {
      ctx.fillStyle = i % 2 ? '#218f50' : '#27a45e';
      ctx.fillRect(p.x + Math.floor((i * p.w) / 10), p.y, Math.ceil(p.w / 10), p.h);
    }
    ctx.strokeStyle = '#e8f5d2';
    ctx.lineWidth = 2;
    ctx.strokeRect(p.x, p.y, p.w, p.h);
    ctx.beginPath();
    ctx.moveTo(p.x + p.w / 2, p.y);
    ctx.lineTo(p.x + p.w / 2, p.y + p.h);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(p.x + p.w / 2, p.y + p.h / 2, 36, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = '#e8f5d2';
    ctx.fillRect(p.x + p.w / 2 - 2, p.y + p.h / 2 - 2, 4, 4);

    const boxW = 76;
    const boxH = 138;
    ctx.strokeRect(p.x, p.y + (p.h - boxH) / 2, boxW, boxH);
    ctx.strokeRect(p.x + p.w - boxW, p.y + (p.h - boxH) / 2, boxW, boxH);
    ctx.strokeRect(p.x, p.y + (p.h - 68) / 2, 30, 68);
    ctx.strokeRect(p.x + p.w - 30, p.y + (p.h - 68) / 2, 30, 68);

    ctx.fillStyle = '#dfe8ff';
    ctx.fillRect(p.x - 8, p.y + p.h / 2 - 25, 8, 50);
    ctx.fillRect(p.x + p.w, p.y + p.h / 2 - 25, 8, 50);
    ctx.fillStyle = '#49619a';
    for (let y = p.y + p.h / 2 - 23; y < p.y + p.h / 2 + 25; y += 6) {
      ctx.fillRect(p.x - 7, y, 6, 1);
      ctx.fillRect(p.x + p.w + 1, y, 6, 1);
    }
  }

  private drawActors(match: ArcadeMatch): void {
    const sorted = [...match.actors].sort((a, b) => a.y - b.y);
    for (const actor of sorted) this.drawActor(actor, match);
  }

  private drawActor(actor: ArcadeActor, match: ArcadeMatch): void {
    const ctx = this.ctx;
    const x = Math.round(this.pitch.x + actor.x * this.pitch.w);
    const y = Math.round(this.pitch.y + actor.y * this.pitch.h);
    const team = actor.side === 'home' ? match.home : match.away;
    const goalkeeper = actor.player.positionGroup === 'GK';
    const selected = actor.player.id === match.selectedPlayerId;
    const moving = Math.abs(actor.vx) + Math.abs(actor.vy) > 0.02;
    const frame = moving ? Math.floor(this.time * 9 + actor.player.kitNumber) % 2 : 0;

    ctx.fillStyle = 'rgba(2,4,10,.45)';
    ctx.fillRect(x - 6, y + 8, 13, 3);
    if (selected) {
      ctx.fillStyle = '#ffd34e';
      ctx.fillRect(x - 7, y - 18, 14, 2);
      ctx.fillRect(x - 4, y - 16, 8, 2);
    }

    // legs
    ctx.fillStyle = goalkeeper ? '#172144' : team.kit.secondary;
    ctx.fillRect(x - 5, y + 4 + frame, 4, 6);
    ctx.fillRect(x + 2, y + 4 + (1 - frame), 4, 6);
    // shirt
    ctx.fillStyle = goalkeeper ? '#ffd34e' : team.kit.primary;
    ctx.fillRect(x - 7, y - 7, 15, 12);
    ctx.fillStyle = team.kit.secondary;
    ctx.fillRect(x - 7, y - 7, 3, 9);
    ctx.fillRect(x + 5, y - 7, 3, 9);
    // head + hair
    ctx.fillStyle = '#d79a69';
    ctx.fillRect(x - 4, y - 14, 9, 7);
    ctx.fillStyle = '#2a1730';
    ctx.fillRect(x - 4, y - 15, 9, 2);

    ctx.fillStyle = this.contrast(goalkeeper ? '#ffd34e' : team.kit.primary);
    ctx.font = '7px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(actor.player.kitNumber), x, y - 1);
  }

  private drawBall(match: ArcadeMatch): void {
    const x = Math.round(this.pitch.x + match.ball.x * this.pitch.w);
    const y = Math.round(this.pitch.y + match.ball.y * this.pitch.h);
    this.ctx.fillStyle = 'rgba(2,4,10,.5)';
    this.ctx.fillRect(x - 2, y + 4, 7, 2);
    this.ctx.fillStyle = '#f4f4df';
    this.ctx.fillRect(x - 3, y - 3, 7, 7);
    this.ctx.fillStyle = '#172144';
    this.ctx.fillRect(x - 1, y - 1, 3, 3);
  }

  private drawHud(match: ArcadeMatch): void {
    const ctx = this.ctx;
    const selected = match.actors.find((actor) => actor.player.id === match.selectedPlayerId);
    if (!selected) return;
    ctx.fillStyle = 'rgba(5,7,19,.9)';
    ctx.fillRect(50, 41, 132, 18);
    ctx.strokeStyle = '#49619a';
    ctx.strokeRect(50, 41, 132, 18);
    ctx.fillStyle = '#f4f4df';
    ctx.font = '7px Silkscreen, monospace';
    ctx.textAlign = 'left';
    ctx.fillText(`${selected.player.kitNumber} ${selected.player.lastName.toUpperCase()}`, 56, 50);
    ctx.fillStyle = '#172144';
    ctx.fillRect(56, 53, 116, 3);
    ctx.fillStyle = selected.stamina > 35 ? '#54f28b' : '#ff9f43';
    ctx.fillRect(56, 53, Math.round(116 * selected.stamina / 100), 3);
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
