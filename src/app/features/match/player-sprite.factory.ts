import { ArcadeActor } from '../../core/services/arcade-match';
import { contrastText } from '../../core/visual-identity';
import { PlayerActionState, PlayerRuntimeSnapshot } from '../../models/match.model';
import { KitDesign, PlayerVisualIdentity } from '../../models/visual.model';

const WIDTH = 32;
const HEIGHT = 40;
const MAX_FRAMES = 768;
const SKIN = ['#f5d0a9', '#e9b989', '#d99a68', '#bf7b50', '#9b5c3d', '#75422f', '#573126', '#35221f'];
const HAIR = ['#17141d', '#2c1b18', '#4b2e24', '#71462b', '#9b673d', '#c89b62', '#d9c6a2', '#702c32'];

type SpriteSurface = OffscreenCanvas | HTMLCanvasElement;
type SpriteContext = OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;

export class PlayerSpriteFactory {
  private readonly cache = new Map<string, CanvasImageSource>();

  get(actor: ArcadeActor, runtime: ArcadeActor | PlayerRuntimeSnapshot, kit: KitDesign, tick: number): CanvasImageSource {
    const direction = quantizeDirection(runtime.facingX, runtime.facingY);
    const actionTick = Math.max(0, tick - runtime.actionStartedTick);
    const frame = animationFrame(runtime.action, actionTick);
    const visual = actor.player.visuals;
    const key = [actor.player.id, kitSignature(kit), runtime.action, direction, frame, actor.player.positionGroup === 'GK' ? 1 : 0].join('|');
    const cached = this.cache.get(key);
    if (cached) {
      this.cache.delete(key);
      this.cache.set(key, cached);
      return cached;
    }

    const surface = createSurface();
    const ctx = surface.getContext('2d') as SpriteContext | null;
    if (!ctx) return surface;
    ctx.imageSmoothingEnabled = false;
    this.draw(ctx, visual, kit, actor.player.kitNumber, actor.player.positionGroup === 'GK', runtime.action, direction, frame);
    const source: CanvasImageSource = 'transferToImageBitmap' in surface ? surface.transferToImageBitmap() : surface;
    this.cache.set(key, source);
    this.trim();
    return source;
  }

  prewarm(actors: readonly ArcadeActor[], resolveKit: (actor: ArcadeActor) => KitDesign): void {
    const actions: PlayerActionState[] = ['idle', 'carry', 'sprint'];
    for (const actor of actors) {
      const teamKit = resolveKit(actor);
      for (const action of actions) {
        for (const [facingX, facingY] of [[1, 0], [0, 1], [-1, 0], [0, -1]] as const) {
          for (let frame = 0; frame < 2; frame++) {
            this.get(actor, { ...actor, action, actionStartedTick: -frame * 6, facingX, facingY }, teamKit, 0);
          }
        }
      }
    }
  }

  destroy(): void {
    for (const source of this.cache.values()) closeBitmap(source);
    this.cache.clear();
  }

  private draw(
    ctx: SpriteContext,
    visual: PlayerVisualIdentity,
    kit: KitDesign,
    number: number,
    goalkeeper: boolean,
    action: PlayerActionState,
    direction: number,
    frame: number,
  ): void {
    const mirror = direction >= 3 && direction <= 5;
    const front = direction === 1 || direction === 2 || direction === 3;
    const back = direction >= 5 && direction <= 7;
    const side = !front && !back;
    if (mirror) {
      ctx.translate(WIDTH, 0);
      ctx.scale(-1, 1);
    }

    const build = visual.bodyBuild === 'strong' ? 2 : visual.bodyBuild === 'slim' ? -1 : 0;
    const run = ['jog', 'sprint', 'carry', 'press', 'support-press', 'keeper-rush', 'subbed-on'].includes(action);
    const kicking = ['pass', 'through-pass', 'lob', 'shot', 'low-shot', 'finesse-shot', 'chip-shot'].includes(action);
    const sliding = action === 'slide' || action === 'injured';
    const bob = run ? frame : action === 'idle' || action === 'formation' ? frame : 0;
    const skin = SKIN[visual.skinTone % SKIN.length];
    const hair = HAIR[visual.hairColor % HAIR.length];
    const outline = '#090b16';

    if (sliding) {
      pixel(ctx, 6, 23, 21, 7, outline);
      pixel(ctx, 7, 24, 13, 5, kit.shirt);
      pixel(ctx, 18, 24, 8, 4, skin);
      pixel(ctx, 3, 27, 10, 4, kit.shorts);
      pixel(ctx, 1, 30, 8, 3, visual.bootColor);
      this.drawHead(ctx, 21, 18, visual, skin, hair, front, back, side);
      return;
    }

    const hipY = 25 + bob;
    const leftLeg = run ? (frame ? 2 : -2) : 0;
    const rightLeg = run ? -leftLeg : kicking ? -5 : 0;
    const legColor = kit.shorts;
    limb(ctx, 11, hipY, 5, 9 + leftLeg, outline, legColor);
    limb(ctx, 17, hipY, 5, 9 + rightLeg, outline, legColor);
    pixel(ctx, 10, hipY + 8 + leftLeg, 5, 5, kit.socks, outline);
    pixel(ctx, 18, hipY + 8 + rightLeg, 5, 5, kit.socks, outline);
    pixel(ctx, 9, hipY + 12 + leftLeg, 7, 3, visual.bootColor, outline);
    pixel(ctx, 18, hipY + 12 + rightLeg, 7, 3, visual.bootColor, outline);

    const torsoX = 9 - Math.max(0, build);
    const torsoW = 15 + Math.max(0, build * 2) + (build < 0 ? build : 0);
    pixel(ctx, torsoX, 12 + bob, torsoW, 14, kit.shirt, outline);
    this.drawKitPattern(ctx, kit, torsoX, 12 + bob, torsoW, 14);

    const armLift = kicking || action === 'celebrate' || action === 'keeper-catch' ? -5 : run ? (frame ? -2 : 2) : 0;
    const sleeve = visual.longSleeves ? kit.shirt : skin;
    limb(ctx, torsoX - 4, 14 + bob + armLift, 4, 10, outline, sleeve);
    limb(ctx, torsoX + torsoW, 14 + bob - armLift, 4, 10, outline, sleeve);
    if (visual.wristTape === 'left' || visual.wristTape === 'both') pixel(ctx, torsoX - 4, 21 + bob + armLift, 4, 2, '#f4f4df');
    if (visual.wristTape === 'right' || visual.wristTape === 'both') pixel(ctx, torsoX + torsoW, 21 + bob - armLift, 4, 2, '#f4f4df');
    if (goalkeeper) {
      pixel(ctx, torsoX - 5, 22 + bob + armLift, 5, 4, gloveColor(visual.goalkeeperGloves), outline);
      pixel(ctx, torsoX + torsoW, 22 + bob - armLift, 5, 4, gloveColor(visual.goalkeeperGloves), outline);
    }

    this.drawHead(ctx, 11, 3 + bob, visual, skin, hair, front, back, side);
    if (back || side) {
      ctx.fillStyle = contrastText(kit.shirt);
      ctx.font = '7px monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      if (!side) ctx.fillText(String(number), 16, 20 + bob);
      else pixel(ctx, mirror ? 13 : 17, 17 + bob, 2, 6, contrastText(kit.shirt));
    }
  }

  private drawHead(ctx: SpriteContext, x: number, y: number, visual: PlayerVisualIdentity, skin: string, hair: string, front: boolean, back: boolean, side: boolean): void {
    const wide = visual.headShape % 3 === 0 ? 1 : 0;
    pixel(ctx, x - wide, y + 1, 10 + wide * 2, 9, skin, '#090b16');
    const hairStyle = visual.hairStyle % 6;
    pixel(ctx, x - wide, y, 10 + wide * 2, hairStyle === 0 ? 2 : 3, hair);
    if (hairStyle === 2 || hairStyle === 5) pixel(ctx, x - wide - 1, y + 2, 3, 6, hair);
    if (hairStyle === 3) {
      pixel(ctx, x + 2, y - 2, 3, 3, hair);
      pixel(ctx, x + 6, y - 1, 3, 3, hair);
    }
    if (hairStyle === 4) pixel(ctx, x + 8 + wide, y + 2, 2, 5, hair);
    if (visual.headAccessory === 'headband') pixel(ctx, x - wide, y + 3, 10 + wide * 2, 2, '#f4f4df');
    if (visual.headAccessory === 'protective-cap') pixel(ctx, x - wide - 1, y - 1, 12 + wide * 2, 5, '#171c34', '#090b16');
    if (front) {
      pixel(ctx, x + 2, y + 5, 2, 1, '#17141d');
      pixel(ctx, x + 7, y + 5, 2, 1, '#17141d');
      if (visual.facialHair > 0) pixel(ctx, x + 2, y + 8, 6, 2, hair);
    } else if (side) {
      pixel(ctx, x + 8, y + 5, 2, 1, '#17141d');
    } else if (back) {
      pixel(ctx, x, y + 3, 10, 5, hair);
    }
  }

  private drawKitPattern(ctx: SpriteContext, kit: KitDesign, x: number, y: number, width: number, height: number): void {
    ctx.fillStyle = kit.secondary;
    if (kit.pattern === 'halves') ctx.fillRect(x + Math.floor(width / 2), y, Math.ceil(width / 2), height);
    if (kit.pattern === 'stripes' || kit.pattern === 'pinstripes') {
      const step = kit.pattern === 'stripes' ? 4 : 3;
      const stripe = kit.pattern === 'stripes' ? 2 : 1;
      for (let px = x + 1; px < x + width; px += step) ctx.fillRect(px, y, stripe, height);
    }
    if (kit.pattern === 'hoops') for (let py = y + 2; py < y + height; py += 5) ctx.fillRect(x, py, width, 2);
    if (kit.pattern === 'chest-band') ctx.fillRect(x, y + 5, width, 4);
    if (kit.pattern === 'sash') for (let row = 0; row < height; row++) ctx.fillRect(x + Math.min(width - 3, Math.floor(row * width / height)), y + row, 3, 1);
    if (kit.pattern === 'chevron') for (let row = 0; row < 5; row++) {
      ctx.fillRect(x + 2 + row, y + 3 + row, 2, 1);
      ctx.fillRect(x + width - 4 - row, y + 3 + row, 2, 1);
    }
    ctx.fillStyle = kit.trim;
    if (kit.sleeve === 'cuff') {
      ctx.fillRect(x, y + 2, 2, 4);
      ctx.fillRect(x + width - 2, y + 2, 2, 4);
    }
    if (kit.collar === 'v') {
      ctx.fillRect(x + Math.floor(width / 2) - 2, y, 4, 1);
      ctx.fillRect(x + Math.floor(width / 2) - 1, y + 1, 2, 1);
    } else ctx.fillRect(x + Math.floor(width / 2) - 3, y, 6, 1);
  }

  private trim(): void {
    while (this.cache.size > MAX_FRAMES) {
      const key = this.cache.keys().next().value as string | undefined;
      if (!key) break;
      const source = this.cache.get(key);
      if (source) closeBitmap(source);
      this.cache.delete(key);
    }
  }
}

function createSurface(): SpriteSurface {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(WIDTH, HEIGHT);
  const canvas = document.createElement('canvas');
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  return canvas;
}

function animationFrame(action: PlayerActionState, ticks: number): number {
  const speed = action === 'sprint' ? 4 : action === 'carry' || action === 'jog' || action === 'press' ? 6 : 14;
  return Math.floor(ticks / speed) % 2;
}

function quantizeDirection(x: number, y: number): number {
  if (Math.hypot(x, y) < 0.05) return 0;
  return (Math.round(Math.atan2(y, x) / (Math.PI / 4)) + 8) % 8;
}

function kitSignature(kit: KitDesign): string {
  return `${kit.pattern}:${kit.shirt}:${kit.secondary}:${kit.trim}:${kit.shorts}:${kit.socks}:${kit.collar}:${kit.sleeve}`;
}

function gloveColor(style: number): string {
  return ['#f4f4df', '#ffd34e', '#37d8ff', '#ff4f78', '#54f28b', '#e55bff'][style % 6];
}

function pixel(ctx: SpriteContext, x: number, y: number, width: number, height: number, color: string, outline?: string): void {
  if (outline) {
    ctx.fillStyle = outline;
    ctx.fillRect(Math.round(x - 1), Math.round(y - 1), Math.round(width + 2), Math.round(height + 2));
  }
  ctx.fillStyle = color;
  ctx.fillRect(Math.round(x), Math.round(y), Math.max(1, Math.round(width)), Math.max(1, Math.round(height)));
}

function limb(ctx: SpriteContext, x: number, y: number, width: number, height: number, outline: string, color: string): void {
  pixel(ctx, x, y, width, Math.max(3, height), color, outline);
}

function closeBitmap(source: CanvasImageSource): void {
  if (typeof ImageBitmap !== 'undefined' && source instanceof ImageBitmap) source.close();
}
