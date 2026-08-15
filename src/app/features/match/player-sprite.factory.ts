import { ArcadeActor } from '../../core/services/arcade-match';
import { createPixelRamp, kitVisualSignature } from '../../core/kit-visuals';
import { contrastText, mixHex } from '../../core/visual-identity';
import { PlayerActionState, PlayerRuntimeSnapshot } from '../../models/match.model';
import { Player, PlayerPersonality } from '../../models/player.model';
import { KitDesign, PlayerVisualIdentity } from '../../models/visual.model';

export const PLAYER_SPRITE_WIDTH = 48;
export const PLAYER_SPRITE_HEIGHT = 48;
export const PLAYER_SPRITE_CACHE_LIMIT = 736;
export const PLAYER_SPRITE_ART_VERSION = 'v3-topdown';

const SKIN = ['#f5d0a9', '#e9b989', '#d99a68', '#bf7b50', '#9b5c3d', '#75422f', '#573126', '#35221f'];
const HAIR = ['#17141d', '#2c1b18', '#4b2e24', '#71462b', '#9b673d', '#c89b62', '#d9c6a2', '#702c32'];
const OUTLINE = '#080a13';
const PIXEL_DIGITS: Record<string, readonly string[]> = {
  '0': ['111', '101', '101', '101', '111'], '1': ['010', '110', '010', '010', '111'],
  '2': ['111', '001', '111', '100', '111'], '3': ['111', '001', '111', '001', '111'],
  '4': ['101', '101', '111', '001', '001'], '5': ['111', '100', '111', '001', '111'],
  '6': ['111', '100', '111', '101', '111'], '7': ['111', '001', '010', '010', '010'],
  '8': ['111', '101', '111', '101', '111'], '9': ['111', '101', '111', '001', '111'],
};

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
  private readonly actorDirections = new Map<string, number>();
  private readonly fallbackKeys = new Map<string, string>();
  private readonly pendingCompositions = new Map<string, () => void>();
  private compositionBudget = Number.POSITIVE_INFINITY;
  private idleScheduled = false;

  beginFrame(compositionBudget = 2): void {
    this.compositionBudget = Math.max(0, compositionBudget);
  }

  get(actor: ArcadeActor, runtime: ArcadeActor | PlayerRuntimeSnapshot, kit: KitDesign, tick: number): CanvasImageSource {
    const direction = this.resolveActorDirection(actor.player.id, runtime.facingX, runtime.facingY);
    const actionTick = Math.max(0, tick - runtime.actionStartedTick);
    const frame = animationFrameFor(runtime.action, actionTick, Math.hypot(runtime.vx, runtime.vy), runtime.animationDistance ?? 0);
    const visual = actor.player.visuals;
    const goalkeeper = actor.player.positionGroup === 'GK';
    const key = [PLAYER_SPRITE_ART_VERSION, actor.player.id, kitVisualSignature(kit), runtime.action, direction, frame, goalkeeper ? 1 : 0].join('|');
    const cached = this.cache.get(key);
    if (cached) {
      this.cache.delete(key);
      this.cache.set(key, cached);
      return cached;
    }

    if (this.compositionBudget <= 0) {
      const fallbackKey = this.fallbackKeys.get(actor.player.id);
      const fallback = fallbackKey ? this.cache.get(fallbackKey) : undefined;
      if (fallback) {
        this.enqueueComposition(key, () => {
          this.composeAndCache(key, visual, kit, actor.player.kitNumber, goalkeeper, actor.player.personality, runtime.action, direction, frame);
        });
        return fallback;
      }
    }

    if (Number.isFinite(this.compositionBudget)) this.compositionBudget--;
    return this.composeAndCache(key, visual, kit, actor.player.kitNumber, goalkeeper, actor.player.personality, runtime.action, direction, frame);
  }

  /** Render a UI figure from the exact same layers used by live match sprites. */
  getStandalone(player: Player, kit: KitDesign, action: PlayerActionState = 'idle', frame = 1, direction = 2): CanvasImageSource {
    const key = [PLAYER_SPRITE_ART_VERSION, 'standalone', player.id, kitVisualSignature(kit), action, direction, frame].join('|');
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

  /** A readable 3/4 bust built from the same identity recipe as the top-down match figure. */
  getPortrait(player: Player, kit: KitDesign): CanvasImageSource {
    const key = [PLAYER_SPRITE_ART_VERSION, 'portrait', player.id, player.visuals.seed, kitVisualSignature(kit)].join('|');
    const cached = this.cache.get(key);
    if (cached) return cached;
    const surface = createSurface();
    const ctx = surface.getContext('2d') as SpriteContext | null;
    if (!ctx) return surface;
    ctx.imageSmoothingEnabled = false;
    this.drawPortrait(ctx, player.visuals, kit, player.positionGroup === 'GK');
    const source: CanvasImageSource = 'transferToImageBitmap' in surface ? surface.transferToImageBitmap() : surface;
    this.cache.set(key, source);
    this.trim();
    return source;
  }

  prewarm(actors: readonly ArcadeActor[], resolveKit: (actor: ArcadeActor) => KitDesign): void {
    // One guaranteed fallback per actor keeps the first frame cheap. Rare frames are admitted under a per-frame budget.
    this.compositionBudget = Number.POSITIVE_INFINITY;
    for (const actor of actors) {
      const kit = resolveKit(actor);
      const action: PlayerActionState = actor.player.positionGroup === 'GK' ? 'keeper-ready' : 'idle';
      const direction = 2;
      const key = [PLAYER_SPRITE_ART_VERSION, actor.player.id, kitVisualSignature(kit), action, direction, 0, actor.player.positionGroup === 'GK' ? 1 : 0].join('|');
      this.get(actor, { ...actor, action, actionStartedTick: 0, facingX: 0, facingY: 1, animationDistance: 0 }, kit, 0);
      this.fallbackKeys.set(actor.player.id, key);
    }
  }

  destroy(): void {
    for (const source of this.cache.values()) closeBitmap(source);
    this.cache.clear();
    this.actorDirections.clear();
    this.fallbackKeys.clear();
    this.pendingCompositions.clear();
    this.idleScheduled = false;
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
    ctx.save();
    if (mirror) {
      ctx.translate(PLAYER_SPRITE_WIDTH - 4, 0);
      ctx.scale(-1, 1);
    } else ctx.translate(4, 0);

    const front = canonicalDirection === 1 || canonicalDirection === 2;
    const back = canonicalDirection === 6 || canonicalDirection === 7;
    const side = canonicalDirection === 0;
    const celebrationVariant = (visual.seed + personalityVariant(personality)) % 4;
    if (action === 'slide' || action === 'injured' || (action === 'keeper-dive' && frame >= 2)) {
      this.drawGroundPose(ctx, visual, kit, goalkeeper, action, frame, front, back, side);
      ctx.restore();
      return;
    }

    const pose = orientPose(buildPose(visual, action, frame, celebrationVariant, side), canonicalDirection);
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
    ctx.restore();
  }

  private resolveActorDirection(playerId: string, x: number, y: number): number {
    const previous = this.actorDirections.get(playerId);
    const direction = quantizeDirection(x, y, previous);
    this.actorDirections.set(playerId, direction);
    return direction;
  }

  private composeAndCache(
    key: string,
    visual: PlayerVisualIdentity,
    kit: KitDesign,
    number: number,
    goalkeeper: boolean,
    personality: PlayerPersonality,
    action: PlayerActionState,
    direction: number,
    frame: number,
  ): CanvasImageSource {
    const existing = this.cache.get(key);
    if (existing) return existing;
    const surface = createSurface();
    const ctx = surface.getContext('2d') as SpriteContext | null;
    if (!ctx) return surface;
    ctx.imageSmoothingEnabled = false;
    this.draw(ctx, visual, kit, number, goalkeeper, personality, action, direction, frame);
    const source: CanvasImageSource = 'transferToImageBitmap' in surface ? surface.transferToImageBitmap() : surface;
    this.cache.set(key, source);
    this.trim();
    return source;
  }

  private enqueueComposition(key: string, job: () => void): void {
    if (this.pendingCompositions.has(key) || this.cache.has(key)) return;
    if (this.pendingCompositions.size >= 128) this.pendingCompositions.delete(this.pendingCompositions.keys().next().value as string);
    this.pendingCompositions.set(key, job);
    if (this.idleScheduled) return;
    this.idleScheduled = true;
    const run = (deadline?: IdleDeadline) => {
      this.idleScheduled = false;
      let completed = 0;
      while (this.pendingCompositions.size && completed < 1 && (!deadline || deadline.timeRemaining() > 6)) {
        const next = this.pendingCompositions.entries().next().value as [string, () => void] | undefined;
        if (!next) break;
        this.pendingCompositions.delete(next[0]);
        next[1]();
        completed++;
      }
      if (this.pendingCompositions.size) this.scheduleIdle(run);
    };
    this.scheduleIdle(run);
  }

  private scheduleIdle(callback: (deadline?: IdleDeadline) => void): void {
    if (typeof requestIdleCallback === 'function') requestIdleCallback(callback);
    else setTimeout(() => callback(), 0);
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
    const centre = polygonCentre(torso);
    const inner = torso.map((point) => moveTowards(point, centre, 1.35));
    this.drawKitMaterial(ctx, kit, inner);
    const top = Math.floor(Math.min(...inner.map((point) => point.y)));
    const bottom = Math.ceil(Math.max(...inner.map((point) => point.y)));
    const left = Math.floor(Math.min(...inner.map((point) => point.x)));
    const right = Math.ceil(Math.max(...inner.map((point) => point.x)));
    this.drawCollar(ctx, kit, left, top, Math.max(3, right - left));
    if (visual.bodyBuild === 'strong') {
      ctx.fillStyle = createPixelRamp(kit.shirt).shadow;
      for (let x = left; x <= right; x++) if (pointInPolygon({ x: x + .5, y: bottom - 1.5 }, inner)) ctx.fillRect(x, bottom - 2, 1, 1);
    }
  }

  private drawHead(ctx: SpriteContext, centre: Point, visual: PlayerVisualIdentity, skin: Palette, front: boolean, back: boolean, side: boolean): void {
    const shape = visual.headShape % 8;
    const width = side ? 8 : 9 + (shape % 3 === 0 ? 2 : shape % 3 === 1 ? 1 : 0);
    const height = 9 + (shape === 4 || shape === 7 ? 1 : 0);
    const x = Math.round(centre.x - width / 2);
    const y = Math.round(centre.y - height / 2);
    const jawInset = shape === 2 || shape === 5 ? 2 : 1;
    const face: Point[] = [
      { x: x + 2, y }, { x: x + width - 2, y }, { x: x + width, y: y + 2 },
      { x: x + width - jawInset, y: y + height - 1 }, { x: x + width - 3, y: y + height },
      { x: x + 2, y: y + height }, { x: x + jawInset, y: y + height - 1 }, { x, y: y + 2 },
    ];
    pixelPolygon(ctx, face, skin.outline);
    pixelPolygon(ctx, face.map((point) => moveTowards(point, centre, 1)), skin.base);
    pixel(ctx, x + 2, y + 1, Math.max(2, width - 5), 1, skin.highlight);
    if (shape === 2 || shape === 5) pixel(ctx, x + 2, y + height - 2, width - 4, 1, skin.shadow);
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
    drawPixelNumber(ctx, String(number), 20, y - 2, colour);
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

  private drawKitMaterial(ctx: SpriteContext, kit: KitDesign, polygon: Point[]): void {
    const left = Math.floor(Math.min(...polygon.map((point) => point.x)));
    const right = Math.ceil(Math.max(...polygon.map((point) => point.x)));
    const top = Math.floor(Math.min(...polygon.map((point) => point.y)));
    const bottom = Math.ceil(Math.max(...polygon.map((point) => point.y)));
    const width = Math.max(1, right - left + 1);
    const height = Math.max(1, bottom - top + 1);
    const primary = createPixelRamp(kit.shirt);
    const secondary = createPixelRamp(kit.secondary);
    for (let y = top; y <= bottom; y++) {
      for (let x = left; x <= right; x++) {
        if (!pointInPolygon({ x: x + .5, y: y + .5 }, polygon)) continue;
        const normalizedX = (x - left) / Math.max(1, width - 1);
        const normalizedY = (y - top) / Math.max(1, height - 1);
        const ramp = kitPatternAt(kit, normalizedX, normalizedY, x - left, y - top) ? secondary : primary;
        const colour = normalizedY > .78 || normalizedX > .86 ? ramp.shadow : normalizedX < .2 && normalizedY < .7 ? ramp.highlight : ramp.base;
        ctx.fillStyle = colour;
        ctx.fillRect(x, y, 1, 1);
      }
    }
  }

  private drawCollar(ctx: SpriteContext, kit: KitDesign, x: number, y: number, width: number): void {
    ctx.fillStyle = kit.trim;
    if (kit.collar === 'v') {
      ctx.fillRect(x + Math.floor(width / 2) - 2, y, 4, 1);
      ctx.fillRect(x + Math.floor(width / 2) - 1, y + 1, 2, 1);
    } else if (kit.collar === 'polo') {
      ctx.fillRect(x + Math.floor(width / 2) - 3, y, 6, 2);
      ctx.fillRect(x + Math.floor(width / 2) - 1, y + 2, 2, 2);
    } else ctx.fillRect(x + Math.floor(width / 2) - 3, y, 6, 1);
  }

  private drawPortrait(ctx: SpriteContext, visual: PlayerVisualIdentity, kit: KitDesign, goalkeeper: boolean): void {
    const skin = palette(SKIN[visual.skinTone % SKIN.length]);
    const torso: Point[] = [{ x: 4, y: 48 }, { x: 7, y: 37 }, { x: 15, y: 30 }, { x: 33, y: 30 }, { x: 41, y: 37 }, { x: 44, y: 48 }];
    pixelPolygon(ctx, torso, OUTLINE);
    this.drawKitMaterial(ctx, kit, torso.map((point) => moveTowards(point, { x: 24, y: 40 }, 1.4)));
    this.drawCollar(ctx, kit, 17, 30, 14);
    pixel(ctx, 20, 26, 8, 7, skin.base, skin.outline);

    const shape = visual.headShape % 8;
    const halfWidth = shape % 3 === 0 ? 10 : shape % 3 === 1 ? 9 : 8;
    const jawInset = shape === 2 || shape === 5 ? 3 : 2;
    const face: Point[] = [
      { x: 24 - halfWidth, y: 7 }, { x: 24 + halfWidth, y: 7 },
      { x: 24 + halfWidth + 1, y: 18 }, { x: 24 + halfWidth - jawInset, y: 28 },
      { x: 24, y: 31 }, { x: 24 - halfWidth + jawInset, y: 28 }, { x: 24 - halfWidth - 1, y: 18 },
    ];
    pixelPolygon(ctx, face, skin.outline);
    const innerFace = face.map((point) => moveTowards(point, { x: 24, y: 19 }, 1.25));
    pixelPolygon(ctx, innerFace, skin.base);
    pixel(ctx, 16, 12, 3, 11, skin.highlight);
    pixel(ctx, 31, 16, 2, 10, skin.shadow);
    pixel(ctx, 14 - (halfWidth - 8), 17, 2, 6, skin.base, skin.outline);
    pixel(ctx, 32 + (halfWidth - 8), 17, 2, 6, skin.base, skin.outline);
    this.drawPortraitHair(ctx, visual, halfWidth);
    this.drawPortraitFeatures(ctx, visual, skin);
    if (visual.headAccessory === 'headband') pixel(ctx, 14, 12, 20, 2, kit.trim);
    if (visual.headAccessory === 'protective-cap') {
      pixel(ctx, 13, 6, 22, 7, '#202947', OUTLINE);
      pixel(ctx, 15, 7, 17, 2, '#4b5f91');
    }
    if (goalkeeper) {
      const glove = palette(gloveColor(visual.goalkeeperGloves));
      pixel(ctx, 4, 39, 6, 7, glove.base, glove.outline);
      pixel(ctx, 38, 39, 6, 7, glove.base, glove.outline);
    }
  }

  private drawPortraitHair(ctx: SpriteContext, visual: PlayerVisualIdentity, halfWidth: number): void {
    const style = visual.hairStyle % 18;
    if (style === 0) return;
    const hair = HAIR[visual.hairColor % HAIR.length];
    const shadow = mixHex(hair, '#000000', .34);
    const left = 24 - halfWidth;
    const width = halfWidth * 2;
    const height = [3, 4, 5, 6, 7, 4][style % 6];
    pixel(ctx, left, 6 - Math.max(0, height - 4), width, height, hair, OUTLINE);
    pixel(ctx, left + 2, 7 - Math.max(0, height - 4), Math.max(4, width - 7), 2, mixHex(hair, '#ffffff', .18));
    if ([2, 5, 8, 11, 14, 17].includes(style)) pixel(ctx, left - 1, 9, 4, 13, shadow);
    if ([4, 7, 10, 13, 16].includes(style)) pixel(ctx, left + width - 2, 9, 4, 15, shadow);
    if ([3, 6, 9, 12, 15].includes(style)) for (let index = 0; index < 6; index++) pixel(ctx, left + 2 + index * 3, 4 - index % 2, 2, 4, hair);
    if (style === 17) for (let index = 0; index < 5; index++) pixel(ctx, left + 2 + index * 4, 2 - index % 2, 2, 7, hair, OUTLINE);
  }

  private drawPortraitFeatures(ctx: SpriteContext, visual: PlayerVisualIdentity, skin: Palette): void {
    const hair = HAIR[visual.hairColor % HAIR.length];
    pixel(ctx, 18, 17, 3, 2, '#10131c');
    pixel(ctx, 27, 17, 3, 2, '#10131c');
    pixel(ctx, 19, 17, 1, 1, '#e7f4ff');
    pixel(ctx, 28, 17, 1, 1, '#e7f4ff');
    pixel(ctx, 23, 19, 3, 5, skin.shadow);
    pixel(ctx, 24, 19, 1, 3, skin.highlight);
    pixel(ctx, 21, 26, 6, 1, '#6e352f');
    const beard = visual.facialHair % 6;
    if (beard === 1 || beard === 4) pixel(ctx, 20, 24, 8, 2, hair);
    if (beard === 2 || beard === 4 || beard === 5) {
      pixel(ctx, 18, 27, 12, 3, hair);
      pixel(ctx, 21, 30, 6, 2, hair);
    }
    if (beard === 3 || beard === 5) {
      pixel(ctx, 15, 22, 3, 7, hair);
      pixel(ctx, 30, 22, 3, 7, hair);
    }
  }

  private trim(): void {
    while (this.cache.size > PLAYER_SPRITE_CACHE_LIMIT) {
      const protectedKeys = new Set(this.fallbackKeys.values());
      const key = [...this.cache.keys()].find((candidate) => !protectedKeys.has(candidate));
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

function orientPose(pose: BodyPose, direction: number): BodyPose {
  const profile = direction === 0
    ? { scaleX: .58, scaleY: .86, skewY: .08, headX: 2, headY: 0 }
    : direction === 1
      ? { scaleX: .82, scaleY: .89, skewY: .1, headX: 1, headY: 0 }
      : direction === 7
        ? { scaleX: .82, scaleY: .89, skewY: -.1, headX: 1, headY: -1 }
        : direction === 6
          ? { scaleX: 1, scaleY: .92, skewY: 0, headX: 0, headY: -1 }
          : { scaleX: 1, scaleY: .92, skewY: 0, headX: 0, headY: 0 };
  const transform = (point: Point): Point => ({
    x: Math.round(20 + (point.x - 20) * profile.scaleX),
    y: Math.round(43 + (point.y - 43) * profile.scaleY + (point.x - 20) * profile.skewY),
  });
  return {
    head: { x: transform(pose.head).x + profile.headX, y: transform(pose.head).y + profile.headY },
    shoulderLeft: transform(pose.shoulderLeft), shoulderRight: transform(pose.shoulderRight),
    elbowLeft: transform(pose.elbowLeft), elbowRight: transform(pose.elbowRight),
    handLeft: transform(pose.handLeft), handRight: transform(pose.handRight),
    hipLeft: transform(pose.hipLeft), hipRight: transform(pose.hipRight),
    kneeLeft: transform(pose.kneeLeft), kneeRight: transform(pose.kneeRight),
    footLeft: transform(pose.footLeft), footRight: transform(pose.footRight),
    airborne: pose.airborne,
  };
}

function createSurface(): SpriteSurface {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(PLAYER_SPRITE_WIDTH, PLAYER_SPRITE_HEIGHT);
  const canvas = document.createElement('canvas');
  canvas.width = PLAYER_SPRITE_WIDTH;
  canvas.height = PLAYER_SPRITE_HEIGHT;
  return canvas;
}

export function quantizeDirection(x: number, y: number, previous?: number): number {
  if (Math.hypot(x, y) < 0.05) return previous ?? 0;
  const angle = Math.atan2(y, x);
  const candidate = (Math.round(angle / (Math.PI / 4)) + 8) % 8;
  if (previous === undefined || candidate === previous) return candidate;
  const previousAngle = previous * Math.PI / 4;
  const delta = Math.atan2(Math.sin(angle - previousAngle), Math.cos(angle - previousAngle));
  const hysteresisBoundary = Math.PI / 8 + Math.PI / 24;
  return Math.abs(delta) < hysteresisBoundary ? previous : candidate;
}

function personalityVariant(personality: PlayerPersonality): number {
  return ({ professional: 0, driven: 1, flair: 2, 'team-player': 3, volatile: 2 })[personality];
}

function gloveColor(style: number): string {
  return ['#f4f4df', '#ffd34e', '#37d8ff', '#ff4f78', '#54f28b', '#e55bff'][style % 6];
}

function palette(base: string): Palette {
  const ramp = createPixelRamp(base);
  return { outline: ramp.outline, shadow: ramp.shadow, base: ramp.base, highlight: ramp.highlight };
}

function segment(ctx: SpriteContext, from: Point, to: Point, width: number, colours: Palette): void {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.max(1, Math.hypot(dx, dy));
  const normal = { x: -dy / length, y: dx / length };
  const middleA = interpolate(from, to, .32);
  const middleB = interpolate(from, to, .76);
  pixelPolygon(ctx, segmentPolygon(from, to, width + 2, Math.max(2, width + 1), normal), colours.outline);
  pixelPolygon(ctx, segmentPolygon(from, middleA, width, Math.max(2, width - 1), normal), colours.highlight);
  pixelPolygon(ctx, segmentPolygon(middleA, middleB, Math.max(2, width - 1), Math.max(2, width - 1), normal), colours.base);
  pixelPolygon(ctx, segmentPolygon(middleB, to, Math.max(2, width - 1), Math.max(2, width - 2), normal), colours.shadow);
}

function segmentPolygon(from: Point, to: Point, fromWidth: number, toWidth: number, normal: Point): Point[] {
  return [
    { x: Math.round(from.x + normal.x * fromWidth / 2), y: Math.round(from.y + normal.y * fromWidth / 2) },
    { x: Math.round(to.x + normal.x * toWidth / 2), y: Math.round(to.y + normal.y * toWidth / 2) },
    { x: Math.round(to.x - normal.x * toWidth / 2), y: Math.round(to.y - normal.y * toWidth / 2) },
    { x: Math.round(from.x - normal.x * fromWidth / 2), y: Math.round(from.y - normal.y * fromWidth / 2) },
  ];
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

function polygonCentre(points: Point[]): Point {
  return {
    x: points.reduce((sum, point) => sum + point.x, 0) / points.length,
    y: points.reduce((sum, point) => sum + point.y, 0) / points.length,
  };
}

function moveTowards(point: Point, target: Point, amount: number): Point {
  const distance = Math.max(1, Math.hypot(target.x - point.x, target.y - point.y));
  return {
    x: Math.round(point.x + (target.x - point.x) / distance * amount),
    y: Math.round(point.y + (target.y - point.y) / distance * amount),
  };
}

function pointInPolygon(point: Point, polygon: Point[]): boolean {
  let inside = false;
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index++) {
    const a = polygon[index];
    const b = polygon[previous];
    if ((a.y > point.y) !== (b.y > point.y) && point.x < (b.x - a.x) * (point.y - a.y) / ((b.y - a.y) || 1) + a.x) inside = !inside;
  }
  return inside;
}

function kitPatternAt(kit: KitDesign, normalizedX: number, normalizedY: number, x: number, y: number): boolean {
  switch (kit.pattern) {
    case 'halves': return normalizedX >= .5;
    case 'stripes': return Math.floor(x / 2) % 2 === 1;
    case 'pinstripes': return x % 3 === 1;
    case 'hoops': return Math.floor(y / 2) % 2 === 1;
    case 'chest-band': return normalizedY >= .34 && normalizedY <= .58;
    case 'sash': return Math.abs(normalizedX - normalizedY) <= .16;
    case 'chevron': return normalizedY >= .24 && normalizedY <= .62 && Math.abs(Math.abs(normalizedX - .5) - normalizedY * .52) <= .14;
    default: return false;
  }
}

function drawPixelNumber(ctx: SpriteContext, value: string, centreX: number, top: number, colour: string): void {
  const digits = value.slice(-2).split('');
  const width = digits.length * 3 + Math.max(0, digits.length - 1);
  const left = Math.round(centreX - width / 2);
  ctx.fillStyle = colour;
  digits.forEach((digit, digitIndex) => {
    const rows = PIXEL_DIGITS[digit] ?? PIXEL_DIGITS['0'];
    rows.forEach((row, y) => row.split('').forEach((bit, x) => {
      if (bit === '1') ctx.fillRect(left + digitIndex * 4 + x, top + y, 1, 1);
    }));
  });
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
