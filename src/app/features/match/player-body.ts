import * as THREE from 'three';
import { KitDesign, PlayerVisualIdentity } from '../../models/visual.model';
import { mixHex } from '../../core/visual-identity';
import { createLimbSurface } from './limb-surface';
import { PlayerStyle } from './player-style';
import { Surface } from './player-material';

const TAU = Math.PI * 2;

/** One cross-section of a stacked surface: an off-centre super-ellipse around (x, y, z), skinned to two bones. */
export interface StackRing {
  x?: number; y: number; z?: number;
  /** Half width, and the half depth towards the front (+z) and the back. */
  hw: number; front: number; back: number;
  /** Bones of this ring and the weight of the second one. */
  a: number; b?: number; w?: number;
}

/**
 * A closed skin through a stack of cross-sections. `power` shapes them: 2 is an ellipse, higher values square the
 * section off (a chest, a boot). The surface is one piece, so nothing can gape open between the rings.
 */
export function stackSurface(rings: readonly StackRing[], radial: number, power = 2, capStart = false, capEnd = false): THREE.BufferGeometry {
  const positions: number[] = [], indices: number[] = [], bones: number[] = [], weights: number[] = [];
  const exponent = 2 / power;
  const shape = (value: number) => Math.sign(value) * Math.pow(Math.abs(value), exponent);
  for (const ring of rings) {
    for (let segment = 0; segment < radial; segment++) {
      const angle = segment / radial * TAU;
      const cos = shape(Math.cos(angle)), sin = shape(Math.sin(angle));
      positions.push((ring.x ?? 0) + cos * ring.hw, ring.y, (ring.z ?? 0) + sin * (sin > 0 ? ring.front : ring.back));
      bones.push(ring.a, ring.b ?? ring.a, 0, 0);
      weights.push(1 - (ring.w ?? 0), ring.w ?? 0, 0, 0);
    }
  }
  // The rings may run up or down: the winding follows, so the surface always faces outwards.
  const rising = rings[rings.length - 1].y > rings[0].y;
  for (let ring = 0; ring < rings.length - 1; ring++) {
    for (let segment = 0; segment < radial; segment++) {
      const a = ring * radial + segment, b = ring * radial + (segment + 1) % radial;
      if (rising) indices.push(a, a + radial, b, b, a + radial, b + radial);
      else indices.push(a, b, a + radial, b, b + radial, a + radial);
    }
  }
  const cap = (ringIndex: number, outward: boolean) => {
    const ring = rings[ringIndex], centre = positions.length / 3;
    positions.push(ring.x ?? 0, ring.y, (ring.z ?? 0) + (ring.front - ring.back) / 2);
    bones.push(ring.a, ring.b ?? ring.a, 0, 0); weights.push(1 - (ring.w ?? 0), ring.w ?? 0, 0, 0);
    for (let segment = 0; segment < radial; segment++) {
      const a = ringIndex * radial + segment, b = ringIndex * radial + (segment + 1) % radial;
      if (outward) indices.push(centre, b, a); else indices.push(centre, a, b);
    }
  };
  if (capStart) cap(0, rising);
  if (capEnd) cap(rings.length - 1, !rising);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(bones, 4));
  geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(weights, 4));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

/** Rings between control rings, so a few numbers describe a smooth outline. */
function refine(control: readonly StackRing[], steps: number): StackRing[] {
  const out: StackRing[] = [];
  for (let index = 0; index < control.length - 1; index++) {
    const from = control[index], to = control[index + 1];
    for (let step = 0; step < steps; step++) {
      const t = step / steps, ease = t * t * (3 - 2 * t);
      const mix = (a: number, b: number) => a + (b - a) * ease;
      out.push({ x: mix(from.x ?? 0, to.x ?? 0), y: from.y + (to.y - from.y) * t, z: mix(from.z ?? 0, to.z ?? 0), hw: mix(from.hw, to.hw), front: mix(from.front, to.front), back: mix(from.back, to.back), a: from.a, b: from.b, w: from.w });
    }
  }
  out.push({ ...control[control.length - 1] });
  return out;
}

type JointName = 'hips' | 'spine' | 'chest' | 'head' | 'leftThigh' | 'leftShin' | 'leftFoot' | 'rightThigh' | 'rightShin' | 'rightFoot' |
  'leftArm' | 'leftForearm' | 'leftHand' | 'rightArm' | 'rightForearm' | 'rightHand';

export interface BodyContext {
  /** A rigid part on one joint; the offset is from the joint in the bind pose. */
  part(geometry: THREE.BufferGeometry, color: string, joint: JointName, x: number, y: number, z: number, scale?: THREE.Vector3, rotation?: THREE.Euler, surface?: Surface): void;
  /** A surface built in bind-pose coordinates that carries its own skin weights. `shirt` puts it into the shirt's pattern frame. */
  skinned(geometry: THREE.BufferGeometry, color: string, surface: Surface, shirt?: boolean): void;
  bind: Record<JointName, THREE.Vector3>;
  index: Record<JointName, number>;
  identity: PlayerVisualIdentity;
  style: PlayerStyle;
  kit: KitDesign;
  skin: string;
  scale: number;
  shoulder: number;
  /** Half depth of the shirt at the chest: the print sits just behind it, the crest just in front. */
  shirtDepth: number;
  goalkeeper: boolean;
  /** Fewer segments. */
  coarse: boolean;
  /** The figure for the distance: no small parts. */
  simple: boolean;
}

const FRAMES: Record<PlayerStyle['frame'], { shoulders: number; chest: number; waist: number; thigh: number }> = {
  lean: { shoulders: 0.96, chest: 0.93, waist: 0.9, thigh: 0.92 },
  balanced: { shoulders: 1, chest: 1, waist: 1, thigh: 1 },
  powerful: { shoulders: 1.06, chest: 1.09, waist: 1.02, thigh: 1.1 },
  compact: { shoulders: 1.02, chest: 1.05, waist: 1.08, thigh: 1.07 },
};

/** Torso, shorts, legs, boots, arms and hands. The skeleton is given; this only dresses it. */
export function buildBody(c: BodyContext): void {
  const { bind, index, kit, style, skin, scale: s, coarse, simple } = c;
  const frame = FRAMES[style.frame];
  // Section counts are a budget: every figure is built at kick-off, twenty-two of them.
  const radial = coarse ? 8 : 12;
  const limb = coarse ? 6 : 10;
  const steps = coarse ? 1 : 2;
  const H = bind.hips.y, spineY = bind.spine.y, chestY = bind.chest.y;
  const armX = bind.leftArm.x, armY = bind.leftArm.y;
  const D = c.shirtDepth;
  const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

  // --- Torso: one surface from the hem to the neck, wide at the shoulders and narrow at the waist.
  const torsoBones = (y: number): Pick<StackRing, 'a' | 'b' | 'w'> => y < (spineY + chestY) / 2
    ? { a: index.hips, b: index.spine, w: THREE.MathUtils.smoothstep(y, spineY - 0.08, spineY + 0.08) }
    : { a: index.spine, b: index.chest, w: THREE.MathUtils.smoothstep(y, chestY - 0.08, chestY + 0.08) };
  const loose = style.shirt === 'loose';
  const torso: Omit<StackRing, 'a'>[] = [
    loose ? { y: H - 0.04, hw: 0.158 * frame.waist, front: 0.118, back: 0.124 } : { y: H + 0.04, hw: 0.139 * frame.waist, front: 0.1, back: 0.108 },
    { y: H + 0.105 * s, hw: 0.13 * frame.waist, front: 0.1, back: 0.112 },
    { y: H + 0.2 * s, hw: armX * 0.76 * frame.chest, front: D - 0.026, back: D - 0.016 },
    { y: H + 0.3 * s, hw: armX * 0.88 * frame.chest, front: (D - 0.01) * frame.chest, back: D - 0.012 },
    { y: H + 0.385 * s, hw: armX * 0.95 * frame.shoulders, front: (D - 0.004) * frame.chest, back: D - 0.012 },
    { y: armY - 0.004, hw: armX * 0.98 * frame.shoulders, front: D - 0.03, back: D - 0.024 },
    { y: armY + 0.045, hw: armX * 0.6, front: 0.08, back: 0.092 },
    { y: armY + 0.088, hw: 0.082, front: 0.064, back: 0.074 },
  ];
  c.skinned(stackSurface(refine(torso.map((ring) => ({ ...ring, ...torsoBones(ring.y) })), steps).map((ring) => ({ ...ring, ...torsoBones(ring.y) })), radial, 2.25), kit.shirt, Surface.Fabric, true);

  // --- Shorts: a pelvis and two legs that flare a little at the hem.
  const hip: StackRing[] = [
    { y: H + 0.078, hw: 0.142 * frame.waist, front: 0.104, back: 0.112, a: index.hips },
    { y: H - 0.02, hw: 0.165 * frame.thigh, front: 0.12 * frame.thigh, back: 0.128 * frame.thigh, a: index.hips },
    { y: H - 0.105, hw: 0.168 * frame.thigh, front: 0.118 * frame.thigh, back: 0.122 * frame.thigh, a: index.hips },
  ];
  c.skinned(stackSurface(refine(hip, steps), radial, 2.3, false, true), kit.shorts, Surface.Fabric);
  if (!loose && !simple) c.skinned(stackSurface([
    { y: H + 0.086, hw: 0.145 * frame.waist, front: 0.107, back: 0.115, a: index.hips }, { y: H + 0.062, hw: 0.147 * frame.waist, front: 0.108, back: 0.116, a: index.hips },
  ], radial, 2.3), kit.trim, Surface.Fabric);

  for (const side of ['left', 'right'] as const) {
    const sign = side === 'left' ? 1 : -1;
    const thigh = `${side}Thigh` as const, shin = `${side}Shin` as const, foot = `${side}Foot` as const;
    const arm = `${side}Arm` as const, forearm = `${side}Forearm` as const, hand = `${side}Hand` as const;
    const legX = bind[thigh].x, kneeY = bind[shin].y, ankleY = bind[foot].y;
    const upper = H - kneeY, lower = kneeY - ankleY;
    const legBones = (y: number): Pick<StackRing, 'a' | 'b' | 'w'> => ({ a: index[thigh], b: index[shin], w: THREE.MathUtils.smoothstep(kneeY - y, -0.085, 0.085) });

    // The leg of the shorts.
    c.skinned(stackSurface(refine([
      { x: legX, y: H - 0.03, hw: 0.118 * frame.thigh, front: 0.122 * frame.thigh, back: 0.122 * frame.thigh, a: index[thigh] },
      { x: legX, y: H - upper * 0.36, hw: 0.121 * frame.thigh, front: 0.127 * frame.thigh, back: 0.12 * frame.thigh, a: index[thigh] },
      { x: legX, y: H - upper * 0.52, hw: 0.124 * frame.thigh, front: 0.13 * frame.thigh, back: 0.122 * frame.thigh, a: index[thigh] },
    ], 1), limb, 2), kit.shorts, Surface.Fabric);


    // The leg itself: quadriceps, knee, a calf that sits at the back, a slim ankle.
    const leg: Omit<StackRing, 'a'>[] = [
      { x: legX, y: H - 0.05, hw: 0.104 * frame.thigh, front: 0.108 * frame.thigh, back: 0.104 * frame.thigh },
      { x: legX, y: H - upper * 0.45, hw: 0.104 * frame.thigh, front: 0.112 * frame.thigh, back: 0.098 * frame.thigh },
      { x: legX, y: H - upper * 0.8, hw: 0.08, front: 0.088, back: 0.074 },
      { x: legX, y: kneeY, hw: 0.067, front: 0.075, back: 0.062 },
      { x: legX, y: kneeY - lower * 0.16, hw: 0.068, front: 0.06, back: 0.076 },
      { x: legX, y: kneeY - lower * 0.38, hw: 0.079 * (0.6 + 0.4 * frame.thigh), front: 0.056, back: 0.096 * (0.6 + 0.4 * frame.thigh) },
      { x: legX, y: kneeY - lower * 0.72, hw: 0.05, front: 0.048, back: 0.056 },
      { x: legX, y: ankleY + 0.02, hw: 0.041, front: 0.043, back: 0.045 },
    ];
    const rings = refine(leg.map((ring) => ({ ...ring, ...legBones(ring.y) })), coarse ? 2 : 3).map((ring) => ({ ...ring, ...legBones(ring.y) }));
    const sockTop = style.socks === 'low' ? kneeY - lower * 0.55 : style.socks === 'over-knee' ? kneeY + upper * 0.12 : kneeY - lower * 0.1;
    const split = rings.findIndex((ring) => ring.y <= sockTop);
    c.skinned(stackSurface(rings.slice(0, split + 1), limb), skin, Surface.Skin);
    if (style.underShorts && !simple) {
      // Compression shorts follow the leg under them, down to just above the knee.
      const tight = rings.filter((ring) => ring.y < H - upper * 0.44 && ring.y > H - upper * 0.8).map((ring) => ({ ...ring, hw: ring.hw + 0.006, front: ring.front + 0.006, back: ring.back + 0.006 }));
      if (tight.length > 1) c.skinned(stackSurface(tight, limb), '#161b22', Surface.Fabric);
    }
    const sock = rings.slice(split).map((ring) => ({ ...ring, hw: ring.hw + 0.004, front: ring.front + 0.004, back: ring.back + 0.004 }));
    c.skinned(stackSurface(sock, limb), kit.socks, Surface.Fabric);
    if (!simple) {
      // The top of the sock: a turned-over band, thicker when the sock is rolled down.
      const top = sock[0], roll = style.socks === 'low' ? 0.012 : 0.005;
      c.skinned(stackSurface([
        { ...top, y: top.y + 0.004, hw: top.hw + roll, front: top.front + roll, back: top.back + roll },
        { ...top, y: top.y - 0.03, hw: top.hw + roll, front: top.front + roll, back: top.back + roll },
      ], limb), kit.trim, Surface.Fabric);
      if (style.ankleTape) {
        const low = sock[sock.length - 1];
        c.skinned(stackSurface([
          { ...low, y: low.y + 0.075, hw: low.hw + 0.008, front: low.front + 0.008, back: low.back + 0.008 },
          { ...low, y: low.y + 0.005, hw: low.hw + 0.005, front: low.front + 0.005, back: low.back + 0.005 },
        ], limb), '#eef2ee', Surface.Fabric);
      }
      if (style.thighTape === side) c.part(new THREE.BoxGeometry(0.028, upper * 0.4, 0.006), style.accent, thigh, 0.02 * sign, -upper * 0.55, 0.092 * frame.thigh, undefined, new THREE.Euler(-0.06, 0, sign * 0.08), Surface.Fabric);
    }

    buildBoot(c, foot, sign, limb);

    // Shoulder and sleeve, then one surface from the upper arm to the wrist.
    const build = c.identity.bodyBuild === 'strong' ? 1.1 : c.identity.bodyBuild === 'slim' ? 0.91 : 1;
    const width = build * (0.55 + 0.45 * frame.shoulders);
    const sleeveColor = kit.sleeve === 'raglan' ? kit.secondary : kit.shirt;
    const lean = (bind[forearm].x - bind[arm].x) / (bind[arm].y - bind[forearm].y);
    const sleeveRing = (drop: number, hw: number): StackRing => ({ x: bind[arm].x + lean * drop - sign * 0.012 * Math.max(0, 1 - drop / 0.08), y: bind[arm].y - drop, hw: hw * width, front: hw * width * 1.02, back: hw * width * 1.02, a: index[arm] });
    c.skinned(stackSurface(refine([sleeveRing(-0.062, 0.03), sleeveRing(-0.04, 0.074), sleeveRing(0.0, 0.094), sleeveRing(0.07, 0.089), sleeveRing(0.15, 0.081), sleeveRing(0.172, 0.083)], 1), limb, 2, true), sleeveColor, Surface.Fabric);
    if (!simple) c.skinned(stackSurface([sleeveRing(0.158, 0.086), sleeveRing(0.18, 0.086)], limb), kit.sleeve === 'cuff' ? kit.trim : mixHex(kit.shirt, '#000000', 0.14), Surface.Fabric);
    const base = style.baseLayer === 'black' ? '#15191f' : style.baseLayer === 'white' ? '#eef1ee' : style.baseLayer === 'trim' ? kit.trim : null;
    const sleeve = c.identity.longSleeves || c.goalkeeper ? kit.shirt : base ?? skin;
    c.skinned(createLimbSurface(bind[arm].clone().lerp(bind[forearm], 0.42), bind[forearm], bind[hand], index[arm], index[forearm], width, coarse), sleeve, sleeve === skin ? Surface.Skin : Surface.Fabric);

    // Wrist: tape, sweatbands.
    if (!simple) {
      if (c.identity.wristTape === side || c.identity.wristTape === 'both') c.part(new THREE.CylinderGeometry(0.05, 0.048, 0.05, 8), '#eef2ee', hand, 0, 0.04, 0);
      const banded = style.wrist === 'double-sweatband' || (style.wrist === 'sweatband' && (c.identity.seed % 2 === 0) === (side === 'left'));
      if (banded) c.part(new THREE.CylinderGeometry(0.054, 0.054, 0.045, 8), style.accent, hand, 0, 0.045, 0, undefined, undefined, Surface.Fabric);
    }
    buildHand(c, hand, sign);
  }

  if (style.snood && !simple) c.part(new THREE.CylinderGeometry(0.088, 0.1, 0.085, coarse ? 8 : 12), '#1b2028', 'chest', 0, 0.155, -0.004, v(1, 1, 0.96), undefined, Surface.Fabric);
}

function buildBoot(c: BodyContext, foot: JointName, sign: number, radial: number): void {
  const { style, simple } = c;
  const upper = c.identity.bootColor;
  const dark = '#12161d';
  const sole = style.boots === 'neon-sole' ? (style.accent === '#101820' ? '#c8ff3e' : style.accent) : dark;
  /** Sections of the boot from the heel to the tip: position along the foot, half width, top and bottom. */
  const sections: [number, number, number, number][] = [
    [-0.078, 0.026, 0.0, -0.056], [-0.05, 0.04, 0.034, -0.066], [0.015, 0.047, 0.04, -0.068], [0.075, 0.05, 0.012, -0.068],
    [0.135, 0.05, -0.016, -0.068], [0.185, 0.04, -0.032, -0.066], [0.214, 0.02, -0.046, -0.062],
  ];
  /** The stack runs along the foot: it is built upright and laid down, so "front" of a ring is its underside. */
  const lay = (parts: [number, number, number, number][], grow = 0): THREE.BufferGeometry => {
    const rings: StackRing[] = parts.map(([along, hw, top, bottom]) => ({ y: along, hw: hw + grow, front: (top - bottom) / 2 + grow, back: (top - bottom) / 2 + grow, z: -(top + bottom) / 2, a: c.index[foot] }));
    const geometry = stackSurface(rings, c.coarse ? 6 : Math.min(radial, 12), 2.6, true, true);
    geometry.rotateX(Math.PI / 2);
    return geometry;
  };
  const place = (geometry: THREE.BufferGeometry, color: string) => {
    geometry.translate(c.bind[foot].x, c.bind[foot].y, c.bind[foot].z);
    c.skinned(geometry, color, Surface.Other);
  };
  place(lay(sections), upper);
  // The soleplate: a little wider than the upper and flat on the grass.
  place(lay(sections.map(([along, hw]) => [along, hw + 0.003, -0.064, -0.08] as [number, number, number, number])), sole);
  if (simple) return;
  const part = (geometry: THREE.BufferGeometry, color: string, x: number, y: number, z: number, rotation?: THREE.Euler) => c.part(geometry, color, foot, x, y, z, undefined, rotation, Surface.Other);
  // Laces.
  part(new THREE.BoxGeometry(0.04, 0.008, 0.085), '#f4f5ee', 0, 0.022, 0.07, new THREE.Euler(0.42, 0, 0));
  if (style.boots === 'stripes') {
    for (const side of [-1, 1]) for (let stripe = 0; stripe < 3; stripe++) {
      part(new THREE.BoxGeometry(0.005, 0.05, 0.012), style.accent === upper ? '#f4f5ee' : style.accent, side * 0.05, -0.022, 0.035 + stripe * 0.028, new THREE.Euler(-0.5, 0, 0));
    }
  } else if (style.boots === 'two-tone') {
    place(lay(sections.slice(4), 0.003), style.accent === upper ? '#f4f5ee' : style.accent);
  } else if (style.boots === 'collar') {
    // A knitted collar that runs up over the ankle.
    part(new THREE.CylinderGeometry(0.046, 0.05, 0.085, 10), mixHex(upper, '#000000', 0.25), 0, 0.06, -0.006);
  } else if (style.boots === 'classic') {
    part(new THREE.BoxGeometry(0.044, 0.006, 0.05), '#f4f5ee', 0, 0.03, 0.03, new THREE.Euler(0.2, 0, 0));
  }
  // Heel tab in the accent colour: the one detail that reads from behind.
  part(new THREE.BoxGeometry(0.022, 0.03, 0.006), style.accent, 0, -0.012, -0.078, new THREE.Euler(-0.25, 0, 0));
  void sign;
}

function buildHand(c: BodyContext, hand: JointName, sign: number): void {
  const { coarse, simple, style } = c;
  const keeper = c.goalkeeper;
  const color = keeper ? ['#f5f1d7', '#e1ff70', '#4ccbd4'][c.identity.goalkeeperGloves % 3] : style.gloves ? '#171b22' : c.skin;
  const surface = keeper || style.gloves ? Surface.Other : Surface.Skin;
  const grow = keeper ? 1.35 : 1;
  const ball = (x: number, y: number, z: number, sx: number, sy: number, sz: number) =>
    c.part(new THREE.SphereGeometry(1, coarse ? 6 : 8, coarse ? 4 : 6), color, hand, x, y, z, new THREE.Vector3(sx * grow, sy * grow, sz * grow), undefined, surface);
  // Palm, curled fingers and a thumb that points forwards.
  ball(0, -0.034, 0.004, 0.038, 0.05, 0.024);
  if (simple) return;
  ball(0, -0.082, 0.014, 0.034, 0.034, 0.022);
  ball(-sign * 0.03, -0.04, 0.024, 0.014, 0.03, 0.016);
  if (keeper) {
    c.part(new THREE.CylinderGeometry(0.058, 0.054, 0.05, 8), c.kit.trim, hand, 0, 0.03, 0, undefined, undefined, Surface.Other);
    c.part(new THREE.BoxGeometry(0.06, 0.05, 0.008), '#1b2028', hand, 0, -0.045, -0.03, undefined, undefined, Surface.Other);
  }
}
