import { ArcadeActor } from '../../core/services/arcade-match';
import { contrastText, mixHex } from '../../core/visual-identity';
import { PlayerActionState, PlayerRuntimeSnapshot } from '../../models/match.model';
import { Player, PlayerPersonality } from '../../models/player.model';
import { KitDesign, PlayerVisualIdentity } from '../../models/visual.model';

export const PLAYER_SPRITE_WIDTH = 40;
export const PLAYER_SPRITE_HEIGHT = 48;
export const PLAYER_SPRITE_CACHE_LIMIT = 896;

const SKIN = ['#f5d0a9', '#e9b989', '#d99a68', '#bf7b50', '#9b5c3d', '#75422f', '#573126', '#35221f'];
const HAIR = ['#17141d', '#2c1b18', '#4b2e24', '#71462b', '#9b673d', '#c89b62', '#d9c6a2', '#702c32'];
const OUTLINE = '#080a13';

type SpriteSurface = OffscreenCanvas | HTMLCanvasElement;
type SpriteContext = OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;
type Point = { x: number; y: number };
type Palette = { outline: string; shadow: string; base: string; highlight: string };

interface BodyPose {
  head: Point;
  shoulderLeft: Point;
  shoulderRight: Point;
  elbowLeft: Point;
  elbowRight: Point;
  handLeft: Point;
  handRight: Point;
  hipLeft: Point;
  hipRight: Point;
  kneeLeft: Point;
  kneeRight: Point;
  footLeft: Point;
  footRight: Point;
  airborne: boolean;
}

export const PLAYER_ACTION_FRAME_COUNTS: Record<PlayerActionState, number> = {
  formation: 3, idle: 3, jog: 6, sprint: 8, carry: 6, 'close-control': 6,
  receive: 5, 'heavy-touch': 5, pass: 6, 'through-pass': 6, lob: 6, shot: 6,
  'low-shot': 5, 'finesse-shot': 6, 'chip-shot': 6, header: 5, 'ball-roll': 6,
  'drag-back': 6, 'skill-failed': 5, press: 6, 'support-press': 6,
  'standing-tackle': 5, slide: 6, stumble: 6, injured: 6, celebrate: 8,
  'keeper-ready': 3, 'keeper-rush': 8, 'keeper-catch': 6, 'keeper-parry': 6,
  'keeper-dive': 8, 'keeper-throw': 6, 'keeper-kick': 6, 'subbed-on': 3,
};

const LOCOMOTION = new Set<PlayerActionState>(['jog', 'sprint', 'carry', 'close-control', 'press', 'support-press', 'keeper-rush', 'subbed-on']);
const LOOPING = new Set<PlayerActionState>(['formation', 'idle', 'celebrate']);
const KICKING = new Set<PlayerActionState>(['pass', 'through-pass', 'lob', 'shot', 'low-shot', 'finesse-shot', 'chip-shot', 'keeper-kick']);

export class PlayerSpriteFactory {
  private readonly cache = new Map<string, CanvasImageSource>();

  get(actor: ArcadeActor, runtime: ArcadeActor | PlayerRuntimeSnapshot, kit: KitDesign, tick: number): CanvasImageSource {
    const direction = quantizeDirection(runtime.facingX, runtime.facingY);
    const actionTick = Math.max(0, tick - runtime.actionStartedTick);
    const frame = animationFrameFor(runtime.action, actionTick, Math.hypot(runtime.vx, runtime.vy), runtime.animationDistance ?? 0);
    const visual = actor.player.visuals;
    const goalkeeper = actor.player.positionGroup === 'GK';
    const key = [actor.player.id, kitSignature(kit), runtime.action, direction, frame, goalkeeper ? 1 : 0].join('|');
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
    this.draw(ctx, visual, kit, actor.player.kitNumber, goalkeeper, actor.player.personality, runtime.action, direction, frame);
    const source: CanvasImageSource = 'transferToImageBitmap' in surface ? surface.transferToImageBitmap() : surface;
    this.cache.set(key, source);
    this.trim();
    return source;
  }

  /** Render a UI figure from the exact same layers used by live match sprites. */
  getStandalone(player: Player, kit: KitDesign, action: PlayerActionState = 'idle', frame = 1, direction = 2): CanvasImageSource {
    const key = ['standalone', player.id, kitSignature(kit), action, direction, frame].join('|');
    const cached = this.cache.get(key);
    if (cached) return cached;
    const surface = createSurface();
    const ctx = surface.getContext('2d') as SpriteContext | null;
    if (!ctx) return surface;
    ctx.imageSmoothingEnabled = false;
    this.draw(ctx, player.visuals, kit, player.kitNumber, player.positionGroup === 'GK', player.personality, action, direction, frame);
    const source: CanvasImageSource = 'transferToImageBitmap' in surface ? surface.transferToImageBitmap() : surface;
    this.cache.set(key, source);
    this.trim();
    return source;
  }

  prewarm(actors: readonly ArcadeActor[], resolveKit: (actor: ArcadeActor) => KitDesign): void {
    const directions = [[1, 0], [0.7, 0.7], [0, 1], [0, -1], [0.7, -0.7]] as const;
    for (const actor of actors) {
      const kit = resolveKit(actor);
      for (const action of ['idle', 'carry', 'sprint'] as PlayerActionState[]) {
        for (const [facingX, facingY] of directions) {
          for (let frame = 0; frame < 2; frame++) {
            this.get(actor, { ...actor, action, actionStartedTick: 0, facingX, facingY, animationDistance: frame / 5 }, kit, frame * 4);
          }
        }
      }
    }
  }

  destroy(): void {
    for (const source of this.cache.values()) closeBitmap(source);
    this.cache.clear();
  }

  cacheSize(): number {
    return this.cache.size;
  }

  private draw(
    ctx: SpriteContext,
    visual: PlayerVisualIdentity,
    kit: KitDesign,
    number: number,
    goalkeeper: boolean,
    personality: PlayerPersonality,
    action: PlayerActionState,
    direction: number,
    frame: number,
  ): void {
    const mirror = direction >= 3 && direction <= 5;
    const canonicalDirection = ({ 3: 1, 4: 0, 5: 7 } as Record<number, number>)[direction] ?? direction;
    if (mirror) {
      ctx.translate(PLAYER_SPRITE_WIDTH, 0);
      ctx.scale(-1, 1);
    }

    const front = canonicalDirection === 1 || canonicalDirection === 2;
    const back = canonicalDirection === 6 || canonicalDirection === 7;
    const side = canonicalDirection === 0;
    const celebrationVariant = (visual.seed + personalityVariant(personality)) % 4;
    if (action === 'slide' || action === 'injured' || (action === 'keeper-dive' && frame >= 2)) {
      this.drawGroundPose(ctx, visual, kit, goalkeeper, action, frame, front, back, side);
      return;
    }

    const pose = buildPose(visual, action, frame, celebrationVariant, side);
    const skin = palette(SKIN[visual.skinTone % SKIN.length]);
    const shirt = palette(kit.shirt);
    const shorts = palette(kit.shorts);
    const socks = palette(kit.socks);
    const boots = palette(visual.bootColor);
    const rearIsLeft = back || (side && !mirror);
    const rearShoulder = rearIsLeft ? pose.shoulderLeft : pose.shoulderRight;
    const rearElbow = rearIsLeft ? pose.elbowLeft : pose.elbowRight;
    const rearHand = rearIsLeft ? pose.handLeft : pose.handRight;
    const frontShoulder = rearIsLeft ? pose.shoulderRight : pose.shoulderLeft;
    const frontElbow = rearIsLeft ? pose.elbowRight : pose.elbowLeft;
    const frontHand = rearIsLeft ? pose.handRight : pose.handLeft;

    this.drawLeg(ctx, pose.hipLeft, pose.kneeLeft, pose.footLeft, shorts, socks, boots, visual.bootStyle, false);
    this.drawArm(ctx, rearShoulder, rearElbow, rearHand, shirt, skin, visual, kit, goalkeeper, rearIsLeft ? 'left' : 'right');
    this.drawLeg(ctx, pose.hipRight, pose.kneeRight, pose.footRight, shorts, socks, boots, visual.bootStyle, true);
    this.drawTorso(ctx, pose, visual, kit, shirt, side);
    this.drawHead(ctx, pose.head, visual, skin, front, back, side);
    this.drawArm(ctx, frontShoulder, frontElbow, frontHand, shirt, skin, visual, kit, goalkeeper, rearIsLeft ? 'right' : 'left');

    if (back || side) this.drawNumber(ctx, pose, kit, number, side, mirror);
    if (pose.airborne) pixel(ctx, 17, 46, 7, 1, '#ffffff20');
  }

  private drawLeg(ctx: SpriteContext, hip: Point, knee: Point, foot: Point, shorts: Palette, socks: Palette, boots: Palette, bootStyle: number, front: boolean): void {
    segment(ctx, hip, knee, 5, shorts);
    const sockStart = interpolate(knee, foot, 0.42);
    segment(ctx, knee, sockStart, 4, palette(mixHex(shorts.base, socks.base, 0.45)));
    segment(ctx, sockStart, foot, 4, socks);
    const toe = { x: foot.x + 3, y: foot.y + (front ? 0 : 1) };
    segment(ctx, foot, toe, 3, boots);
    const detail = bootStyle % 12;
    const contrast = detail % 2 ? '#f0f4ff' : boots.highlight;
    if ([0, 4, 8, 9].includes(detail)) pixel(ctx, toe.x - 2, toe.y - 1, 2, 1, contrast);
    if ([1, 4, 7, 10].includes(detail)) pixel(ctx, foot.x, foot.y, 3, 1, contrast);
    if ([2, 5, 8, 11].includes(detail)) pixel(ctx, toe.x - 2, toe.y + 1, 3, 1, boots.shadow);
    if ([3, 6, 9, 11].includes(detail)) pixel(ctx, foot.x - 1, foot.y - 1, 1, 3, contrast);
    if ([6, 7, 10].includes(detail)) pixel(ctx, foot.x, foot.y + 2, 4, 1, OUTLINE);
  }

  private drawArm(ctx: SpriteContext, shoulder: Point, elbow: Point, hand: Point, shirt: Palette, skin: Palette, visual: PlayerVisualIdentity, kit: KitDesign, goalkeeper: boolean, side: 'left' | 'right'): void {
    const sleeve = kit.sleeve === 'raglan' ? palette(kit.secondary) : shirt;
    segment(ctx, shoulder, elbow, visual.bodyBuild === 'strong' ? 5 : 4, sleeve);
    segment(ctx, elbow, hand, visual.longSleeves ? 4 : 3, visual.longSleeves ? shirt : skin);
    if (kit.sleeve === 'cuff') pixel(ctx, elbow.x - 2, elbow.y - 2, 4, 2, kit.trim);
    const taped = visual.wristTape === side || visual.wristTape === 'both';
    if (taped) pixel(ctx, hand.x - 1, hand.y - 2, 3, 2, '#f4f4df');
    const handPalette = goalkeeper ? palette(gloveColor(visual.goalkeeperGloves)) : skin;
    pixel(ctx, hand.x - (goalkeeper ? 2 : 1), hand.y - 1, goalkeeper ? 4 : 3, goalkeeper ? 4 : 3, handPalette.base, handPalette.outline);
    if (goalkeeper) pixel(ctx, hand.x - 1, hand.y, 2, 1, handPalette.highlight);
  }

  private drawTorso(ctx: SpriteContext, pose: BodyPose, visual: PlayerVisualIdentity, kit: KitDesign, shirt: Palette, side: boolean): void {
    const shoulderInset = side ? 2 : 0;
    const torso = [
      { x: pose.shoulderLeft.x + shoulderInset, y: pose.shoulderLeft.y - 1 },
      { x: pose.shoulderRight.x - shoulderInset, y: pose.shoulderRight.y - 1 },
      { x: pose.hipRight.x + 1, y: pose.hipRight.y + 1 },
      { x: pose.hipLeft.x - 1, y: pose.hipLeft.y + 1 },
    ];
    pixelPolygon(ctx, torso, shirt.outline);
    pixelPolygon(ctx, torso.map((point) => ({ x: point.x + (point.x < 20 ? 1 : -1), y: point.y + 1 })), shirt.base);
    const top = Math.min(...torso.map((point) => point.y)) + 2;
    const bottom = Math.max(...torso.map((point) => point.y)) - 1;
    const left = Math.min(...torso.map((point) => point.x)) + 2;
    const right = Math.max(...torso.map((point) => point.x)) - 2;
    this.drawKitPattern(ctx, kit, left, top, Math.max(3, right - left), Math.max(4, bottom - top));
    pixel(ctx, left + 1, top + 1, 1, Math.max(2, bottom - top - 2), shirt.highlight);
    if (visual.bodyBuild === 'strong') pixel(ctx, left, bottom - 2, right - left, 2, shirt.shadow);
  }

  private drawHead(ctx: SpriteContext, centre: Point, visual: PlayerVisualIdentity, skin: Palette, front: boolean, back: boolean, side: boolean): void {
    const shape = visual.headShape % 8;
    const width = side ? 8 : 9 + (shape % 3 === 0 ? 2 : shape % 3 === 1 ? 1 : 0);
    const height = 9 + (shape === 4 || shape === 7 ? 1 : 0);
    const x = Math.round(centre.x - width / 2);
    const y = Math.round(centre.y - height / 2);
    pixel(ctx, x, y, width, height, skin.base, skin.outline);
    pixel(ctx, x + 1, y + 1, Math.max(2, width - 3), 2, skin.highlight);
    if (shape === 2 || shape === 5) pixel(ctx, x + 1, y + height - 2, width - 2, 2, skin.shadow);
    this.drawHair(ctx, x, y, width, height, visual, back, side);
    const hair = HAIR[visual.hairColor % HAIR.length];
    if (front) {
      pixel(ctx, x + 2, y + 5, 1, 1, '#12121a');
      pixel(ctx, x + width - 3, y + 5, 1, 1, '#12121a');
      this.drawFacialHair(ctx, x, y, width, height, visual.facialHair % 6, hair);
    } else if (side) {
      pixel(ctx, x + width - 2, y + 5, 1, 1, '#12121a');
      if (visual.facialHair > 0) pixel(ctx, x + width - 3, y + 7, 2, 2, hair);
    }
    if (visual.headAccessory === 'headband') pixel(ctx, x, y + 3, width, 2, '#f4f4df');
    if (visual.headAccessory === 'protective-cap') {
      pixel(ctx, x - 1, y - 1, width + 2, 4, '#202947', OUTLINE);
      pixel(ctx, x + width - 1, y + 3, 2, 4, '#202947');
    }
  }

  private drawHair(ctx: SpriteContext, x: number, y: number, width: number, height: number, visual: PlayerVisualIdentity, back: boolean, side: boolean): void {
    const style = visual.hairStyle % 18;
    const hair = HAIR[visual.hairColor % HAIR.length];
    const shadow = mixHex(hair, '#000000', 0.35);
    const topHeight = [1, 2, 2, 3, 4, 2][style % 6];
    if (style === 0) return;
    pixel(ctx, x, y - Math.max(0, topHeight - 2), width, topHeight, hair);
    if ([2, 5, 8, 11, 14, 17].includes(style)) pixel(ctx, x - 1, y + 1, 2, height - 2, shadow);
    if ([3, 6, 9, 12, 15].includes(style)) {
      for (let index = 0; index < Math.ceil(width / 2); index++) pixel(ctx, x + index * 2, y - 2 - index % 2, 1, 3, hair);
    }
    if ([4, 10, 16].includes(style)) {
      pixel(ctx, x + 1, y - 4, width - 2, 4, hair, OUTLINE);
      pixel(ctx, x + width - 2, y, 2, 5, shadow);
    }
    if ([7, 13].includes(style)) {
      pixel(ctx, x + width - 2, y + 1, 3, height - 1, hair);
      pixel(ctx, x + width, y + height - 1, 2, 4, shadow);
    }
    if (back) pixel(ctx, x, y + 2, width, Math.max(3, Math.floor(height * (style % 3 === 0 ? .75 : .48))), hair);
    if (side && style % 2 === 0) pixel(ctx, x + width - 1, y + 2, 2, 5, shadow);
    if (style === 17) for (let index = 0; index < 4; index++) pixel(ctx, x + 1 + index * 2, y - 4 - index % 2, 2, 4, hair, OUTLINE);
  }

  private drawFacialHair(ctx: SpriteContext, x: number, y: number, width: number, height: number, style: number, hair: string): void {
    if (style === 0) return;
    if (style === 1 || style === 4) pixel(ctx, x + 3, y + 7, Math.max(2, width - 6), 1, hair);
    if (style === 2 || style === 4 || style === 5) pixel(ctx, x + 2, y + height - 3, width - 4, 2, hair);
    if (style === 3 || style === 5) {
      pixel(ctx, x + 1, y + 6, 2, height - 6, hair);
      pixel(ctx, x + width - 3, y + 6, 2, height - 6, hair);
      pixel(ctx, x + 2, y + height - 2, width - 4, 2, hair);
    }
  }

  private drawNumber(ctx: SpriteContext, pose: BodyPose, kit: KitDesign, number: number, side: boolean, mirror: boolean): void {
    const colour = contrastText(kit.shirt);
    const y = Math.round((pose.shoulderLeft.y + pose.hipLeft.y) / 2);
    if (side) {
      pixel(ctx, mirror ? 18 : 21, y - 2, 2, 5, colour);
      return;
    }
    ctx.fillStyle = colour;
    ctx.font = '6px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(number), 20, y);
  }

  private drawGroundPose(ctx: SpriteContext, visual: PlayerVisualIdentity, kit: KitDesign, goalkeeper: boolean, action: PlayerActionState, frame: number, front: boolean, back: boolean, side: boolean): void {
    const progress = frame / Math.max(1, PLAYER_ACTION_FRAME_COUNTS[action] - 1);
    const dive = action === 'keeper-dive';
    const direction = dive ? -1 : 1;
    const y = dive ? 23 - Math.round(Math.sin(progress * Math.PI) * 8) : 31;
    const skin = palette(SKIN[visual.skinTone % SKIN.length]);
    const shirt = palette(kit.shirt);
    const shorts = palette(kit.shorts);
    const socks = palette(kit.socks);
    const boots = palette(visual.bootColor);
    const torsoStart = { x: dive ? 12 : 10, y };
    const torsoEnd = { x: dive ? 27 : 25, y: y + (dive ? -2 : 2) };
    segment(ctx, torsoStart, torsoEnd, visual.bodyBuild === 'strong' ? 11 : 9, shirt);
    segment(ctx, { x: 11, y: y + 2 }, { x: 4, y: y + 7 }, 5, shorts);
    segment(ctx, { x: 8, y: y + 4 }, { x: 2, y: y + 10 }, 4, socks);
    segment(ctx, { x: 2, y: y + 10 }, { x: 5, y: y + 11 }, 3, boots);
    const head = { x: dive ? 29 : 28, y: y - 4 };
    this.drawHead(ctx, head, visual, skin, front, back, side);
    const handPalette = goalkeeper ? palette(gloveColor(visual.goalkeeperGloves)) : skin;
    const armY = y - Math.round(progress * 3);
    segment(ctx, { x: 24, y: armY }, { x: 34, y: armY - direction * 2 }, goalkeeper ? 5 : 4, visual.longSleeves ? shirt : skin);
    pixel(ctx, 33, armY - direction * 2 - 1, goalkeeper ? 5 : 3, goalkeeper ? 4 : 3, handPalette.base, handPalette.outline);
  }

  private drawKitPattern(ctx: SpriteContext, kit: KitDesign, x: number, y: number, width: number, height: number): void {
    ctx.fillStyle = kit.secondary;
    if (kit.pattern === 'halves') ctx.fillRect(x + Math.floor(width / 2), y, Math.ceil(width / 2), height);
    if (kit.pattern === 'stripes' || kit.pattern === 'pinstripes') {
      const step = kit.pattern === 'stripes' ? 4 : 3;
      const stripe = kit.pattern === 'stripes' ? 2 : 1;
      for (let px = x + 1; px < x + width; px += step) ctx.fillRect(px, y, stripe, height);
    }
    if (kit.pattern === 'hoops') for (let py = y + 2; py < y + height; py += 4) ctx.fillRect(x, py, width, 2);
    if (kit.pattern === 'chest-band') ctx.fillRect(x, y + 4, width, 3);
    if (kit.pattern === 'sash') for (let row = 0; row < height; row++) ctx.fillRect(x + Math.min(width - 2, Math.floor(row * width / height)), y + row, 2, 1);
    if (kit.pattern === 'chevron') for (let row = 0; row < Math.min(5, height); row++) {
      ctx.fillRect(x + 1 + row, y + 2 + row, 2, 1);
      ctx.fillRect(x + width - 3 - row, y + 2 + row, 2, 1);
    }
    ctx.fillStyle = kit.trim;
    if (kit.collar === 'v') {
      ctx.fillRect(x + Math.floor(width / 2) - 2, y, 4, 1);
      ctx.fillRect(x + Math.floor(width / 2) - 1, y + 1, 2, 1);
    } else if (kit.collar === 'polo') {
      ctx.fillRect(x + Math.floor(width / 2) - 3, y, 6, 2);
      ctx.fillRect(x + Math.floor(width / 2) - 1, y + 2, 2, 2);
    } else ctx.fillRect(x + Math.floor(width / 2) - 3, y, 6, 1);
  }

  private trim(): void {
    while (this.cache.size > PLAYER_SPRITE_CACHE_LIMIT) {
      const key = this.cache.keys().next().value as string | undefined;
      if (!key) break;
      const source = this.cache.get(key);
      if (source) closeBitmap(source);
      this.cache.delete(key);
    }
  }
}

export function animationFrameFor(action: PlayerActionState, ticks: number, worldSpeed: number, animationDistance: number): number {
  const frames = PLAYER_ACTION_FRAME_COUNTS[action] ?? 3;
  if (LOCOMOTION.has(action)) {
    const cadence = action === 'sprint' || action === 'keeper-rush' ? 5.4 : action === 'close-control' ? 6.2 : 5;
    const distancePhase = Math.floor(Math.max(0, animationDistance) * cadence);
    return distancePhase % frames;
  }
  if (LOOPING.has(action)) return Math.floor(ticks / (action === 'celebrate' ? 5 : 14)) % frames;
  const frameTicks = worldSpeed > 7 ? 2 : 3;
  return Math.min(frames - 1, Math.floor(ticks / frameTicks));
}

function buildPose(visual: PlayerVisualIdentity, action: PlayerActionState, frame: number, celebrationVariant: number, side: boolean): BodyPose {
  const count = PLAYER_ACTION_FRAME_COUNTS[action] ?? 3;
  const progress = count <= 1 ? 0 : frame / (count - 1);
  const phase = frame / count * Math.PI * 2;
  const build = visual.bodyBuild;
  const shoulderHalf = build === 'strong' ? 7 : build === 'slim' ? 5 : 6;
  const hipHalf = build === 'strong' ? 4 : 3;
  const torsoLength = build === 'slim' ? 14 : 13;
  const legLength = build === 'slim' ? 16 : 15;
  const moving = LOCOMOTION.has(action);
  const sprint = action === 'sprint' || action === 'keeper-rush';
  const bob = moving ? Math.round(Math.abs(Math.sin(phase)) * (sprint ? 2 : 1)) :
    action === 'idle' || action === 'formation' ? [0, -1, 0][frame % 3] :
    action === 'keeper-ready' ? [1, 2, 1][frame % 3] : 0;
  const lean = sprint ? 2 : KICKING.has(action) ? Math.round(progress * 2) : action === 'press' || action === 'support-press' ? 1 : 0;
  const shoulderY = 15 + bob;
  const hipY = shoulderY + torsoLength;
  let legSwing = moving ? Math.round(Math.sin(phase) * (sprint ? 6 : 4)) : 0;
  let armSwing = moving ? Math.round(Math.sin(phase) * (sprint ? 5 : 3)) : 0;
  let kick = KICKING.has(action) ? Math.round(Math.sin(progress * Math.PI) * (action === 'lob' || action === 'chip-shot' ? 8 : 11)) : 0;
  if (action === 'standing-tackle') kick = Math.round(Math.sin(progress * Math.PI) * 7);
  if (action === 'receive') legSwing = Math.round(Math.sin(progress * Math.PI) * 5);
  if (action === 'ball-roll') legSwing = Math.round(Math.sin(phase) * 5);
  if (action === 'drag-back') legSwing = -Math.round(Math.sin(progress * Math.PI) * 7);
  const jump = action === 'header' || action === 'keeper-catch' || action === 'keeper-parry' ? Math.round(Math.sin(progress * Math.PI) * 5) : 0;
  const shoulderLeft = { x: 20 - shoulderHalf + lean, y: shoulderY - jump };
  const shoulderRight = { x: 20 + shoulderHalf + lean, y: shoulderY - jump };
  const hipLeft = { x: 20 - hipHalf + lean, y: hipY - jump };
  const hipRight = { x: 20 + hipHalf + lean, y: hipY - jump };
  let elbowLeft = { x: shoulderLeft.x - 2 + armSwing, y: shoulderLeft.y + 6 };
  let elbowRight = { x: shoulderRight.x + 2 - armSwing, y: shoulderRight.y + 6 };
  let handLeft = { x: elbowLeft.x - 1, y: elbowLeft.y + 6 };
  let handRight = { x: elbowRight.x + 1, y: elbowRight.y + 6 };

  if (KICKING.has(action) || action === 'standing-tackle') {
    elbowLeft = { x: shoulderLeft.x - 5, y: shoulderLeft.y + 2 };
    handLeft = { x: elbowLeft.x - 3, y: elbowLeft.y + 4 };
    elbowRight = { x: shoulderRight.x + 5, y: shoulderRight.y + 3 };
    handRight = { x: elbowRight.x + 3, y: elbowRight.y + 3 };
  }
  if (action === 'keeper-catch' || action === 'keeper-parry' || action === 'header') {
    const reach = action === 'header' ? 5 : 9;
    elbowLeft = { x: shoulderLeft.x - 3, y: shoulderLeft.y - reach / 2 };
    elbowRight = { x: shoulderRight.x + 3, y: shoulderRight.y - reach / 2 };
    handLeft = { x: elbowLeft.x - 2, y: elbowLeft.y - reach / 2 };
    handRight = { x: elbowRight.x + 2, y: elbowRight.y - reach / 2 };
  }
  if (action === 'keeper-ready') {
    elbowLeft = { x: shoulderLeft.x - 5, y: shoulderLeft.y + 3 };
    elbowRight = { x: shoulderRight.x + 5, y: shoulderRight.y + 3 };
    handLeft = { x: elbowLeft.x - 2, y: elbowLeft.y + 3 };
    handRight = { x: elbowRight.x + 2, y: elbowRight.y + 3 };
  }
  if (action === 'celebrate') {
    if (celebrationVariant === 0) { handLeft.y -= 14; handRight.y -= 14; elbowLeft.y -= 8; elbowRight.y -= 8; }
    if (celebrationVariant === 1) { handRight.y -= 15; elbowRight.y -= 9; handLeft.x -= 4; }
    if (celebrationVariant === 2) { handLeft.x -= 8; handRight.x += 8; handLeft.y -= 5; handRight.y -= 5; }
    if (celebrationVariant === 3) { handLeft.y -= 11; handRight.y -= 3; elbowLeft.y -= 7; handRight.x += 5; }
  }
  if (action === 'keeper-throw') { handRight.x += Math.round(progress * 9); handRight.y -= Math.round(Math.sin(progress * Math.PI) * 8); elbowRight.x += Math.round(progress * 5); }
  if (action === 'stumble' || action === 'skill-failed' || action === 'heavy-touch') { handLeft.x -= 5; handRight.x += 6; legSwing = Math.round(Math.sin(progress * Math.PI) * 5); }

  const kneeLeft = { x: hipLeft.x + Math.round(legSwing * .55), y: hipLeft.y + Math.round(legLength * .52) };
  const kneeRight = { x: hipRight.x - Math.round((legSwing + kick) * .48), y: hipRight.y + Math.round(legLength * .52) - Math.round(Math.abs(kick) * .18) };
  const footLeft = { x: hipLeft.x + legSwing, y: hipLeft.y + legLength };
  const footRight = { x: hipRight.x - legSwing - kick, y: hipRight.y + legLength - Math.round(Math.abs(kick) * .45) };
  return {
    head: { x: 20 + lean + (action === 'header' ? 2 : 0), y: 8 + bob - jump },
    shoulderLeft, shoulderRight, elbowLeft, elbowRight, handLeft, handRight,
    hipLeft, hipRight, kneeLeft, kneeRight, footLeft, footRight, airborne: jump > 0,
  };
}

function createSurface(): SpriteSurface {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(PLAYER_SPRITE_WIDTH, PLAYER_SPRITE_HEIGHT);
  const canvas = document.createElement('canvas');
  canvas.width = PLAYER_SPRITE_WIDTH;
  canvas.height = PLAYER_SPRITE_HEIGHT;
  return canvas;
}

function quantizeDirection(x: number, y: number): number {
  if (Math.hypot(x, y) < 0.05) return 0;
  return (Math.round(Math.atan2(y, x) / (Math.PI / 4)) + 8) % 8;
}

function kitSignature(kit: KitDesign): string {
  return `${kit.pattern}:${kit.shirt}:${kit.secondary}:${kit.trim}:${kit.shorts}:${kit.socks}:${kit.collar}:${kit.sleeve}`;
}

function personalityVariant(personality: PlayerPersonality): number {
  return ({ professional: 0, driven: 1, flair: 2, 'team-player': 3, volatile: 2 })[personality];
}

function gloveColor(style: number): string {
  return ['#f4f4df', '#ffd34e', '#37d8ff', '#ff4f78', '#54f28b', '#e55bff'][style % 6];
}

function palette(base: string): Palette {
  return { outline: OUTLINE, shadow: mixHex(base, '#000000', 0.34), base, highlight: mixHex(base, '#ffffff', 0.3) };
}

function segment(ctx: SpriteContext, from: Point, to: Point, width: number, colours: Palette): void {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy))));
  const outlineWidth = width + 2;
  for (let index = 0; index <= steps; index++) {
    const x = Math.round(from.x + dx * index / steps);
    const y = Math.round(from.y + dy * index / steps);
    pixel(ctx, x - Math.floor(outlineWidth / 2), y - Math.floor(outlineWidth / 2), outlineWidth, outlineWidth, colours.outline);
  }
  for (let index = 0; index <= steps; index++) {
    const x = Math.round(from.x + dx * index / steps);
    const y = Math.round(from.y + dy * index / steps);
    pixel(ctx, x - Math.floor(width / 2), y - Math.floor(width / 2), width, width, index < steps * .35 ? colours.highlight : index > steps * .72 ? colours.shadow : colours.base);
  }
}

function pixelPolygon(ctx: SpriteContext, points: Point[], colour: string): void {
  const minY = Math.floor(Math.min(...points.map((point) => point.y)));
  const maxY = Math.ceil(Math.max(...points.map((point) => point.y)));
  ctx.fillStyle = colour;
  for (let y = minY; y <= maxY; y++) {
    const intersections: number[] = [];
    for (let index = 0; index < points.length; index++) {
      const a = points[index];
      const b = points[(index + 1) % points.length];
      if ((a.y <= y && b.y > y) || (b.y <= y && a.y > y)) intersections.push(a.x + (y - a.y) * (b.x - a.x) / (b.y - a.y));
    }
    intersections.sort((a, b) => a - b);
    for (let index = 0; index < intersections.length; index += 2) {
      const left = Math.ceil(intersections[index]);
      const right = Math.floor(intersections[index + 1] ?? intersections[index]);
      ctx.fillRect(left, y, Math.max(1, right - left + 1), 1);
    }
  }
}

function interpolate(from: Point, to: Point, amount: number): Point {
  return { x: Math.round(from.x + (to.x - from.x) * amount), y: Math.round(from.y + (to.y - from.y) * amount) };
}

function pixel(ctx: SpriteContext, x: number, y: number, width: number, height: number, color: string, outline?: string): void {
  if (outline) {
    ctx.fillStyle = outline;
    ctx.fillRect(Math.round(x - 1), Math.round(y - 1), Math.round(width + 2), Math.round(height + 2));
  }
  ctx.fillStyle = color;
  ctx.fillRect(Math.round(x), Math.round(y), Math.max(1, Math.round(width)), Math.max(1, Math.round(height)));
}

function closeBitmap(source: CanvasImageSource): void {
  if (typeof ImageBitmap !== 'undefined' && source instanceof ImageBitmap) source.close();
}
