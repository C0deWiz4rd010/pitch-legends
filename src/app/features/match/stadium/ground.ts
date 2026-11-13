import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { MatchWeather } from '../../../models/match.model';
import { StadiumVisualTheme } from '../../../models/visual.model';
import { contrastText, hash32 } from '../../../core/visual-identity';
import { flashLit } from '../replay-director';
import { Crowd, createCrowd, createCrowdAtlas } from './crowd';
import { END_HALF, END_STAND_START, LONG_HALF, LONG_STAND_START, ROW_DEPTH, ROW_RISE, Seat, StadiumPlan, mosaicColor, stadiumPlan, stadiumSeats } from './stadium-plan';

export interface GroundOptions {
  seed: number;
  theme: StadiumVisualTheme;
  /** Expansion level of the ground, 1 to 5. */
  level: number;
  clubName: string;
  home: { shirt: string; secondary: string; trim: string };
  away: { shirt: string; secondary: string };
  /** Colour of flags and LED lettering from a worn cosmetic, or null. */
  decor: string | null;
  atmosphere: 'day' | 'sunset' | 'night';
  weather: MatchWeather;
  quality: 'high' | 'balanced' | 'low';
  software: boolean;
  english: boolean;
  softDot: THREE.Texture;
  glow: THREE.Texture;
}

export interface GroundFrame {
  time: number;
  dt: number;
  reduced: boolean;
  /** Seconds since the last goal (large when there was none) and who scored it. */
  goalAge: number;
  goalBy: 'home' | 'away' | null;
  homeLeads: boolean;
  /** Both teams stand ready for the first kick-off. */
  preKickoff: boolean;
  /** Half time or full time. */
  interval: boolean;
  cameraZ: number;
  viewportHeight: number;
}

export interface Ground {
  group: THREE.Group;
  plan: StadiumPlan;
  update(frame: GroundFrame): void;
  setQuality(quality: 'high' | 'balanced' | 'low'): void;
}

interface Part { position: [number, number, number]; scale: [number, number, number]; color: string; tilt?: [number, number, number] }

/** The camera stands in the main stand: from further back than this it is hidden. */
const MAIN_STAND_HIDE_Z = 37;
const SLOGANS = ['PITCH LEGENDS', 'PLAY BEAUTIFUL', 'THE GAME IS YOURS', 'ONE MORE MATCH', 'LEGENDS ARE MADE HERE', 'FOR THE LOVE OF THE GAME', 'EVERY WEEK COUNTS', 'FIGHT FOR EVERY BALL'];

/** A box whose top is lit and whose sides are shaded: the steps of a stand read as steps without a texture. */
function steppedBox(): THREE.BoxGeometry {
  const geometry = new THREE.BoxGeometry();
  const shades = [0.74, 0.74, 1, 0.5, 0.86, 0.66];
  const colors: number[] = [];
  for (let face = 0; face < 6; face++) for (let vertex = 0; vertex < 4; vertex++) colors.push(shades[face], shades[face], shades[face]);
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  return geometry;
}

function instancedBoxes(parts: Part[]): THREE.InstancedMesh {
  const mesh = new THREE.InstancedMesh(steppedBox(), new THREE.MeshStandardMaterial({ roughness: 0.88, vertexColors: true }), parts.length);
  const dummy = new THREE.Object3D(), color = new THREE.Color();
  parts.forEach((part, index) => {
    dummy.position.fromArray(part.position);
    dummy.scale.fromArray(part.scale);
    dummy.rotation.set(...(part.tilt ?? [0, 0, 0]));
    dummy.updateMatrix();
    mesh.setMatrixAt(index, dummy.matrix);
    mesh.setColorAt(index, color.set(part.color));
  });
  return mesh;
}

/** Cloth that waves from its pole: the further from the pole, the more it moves. Instances wave out of step. */
function clothMaterial(map: THREE.Texture | null, color: THREE.ColorRepresentation, width: number, time: { value: number }, wind: { value: number }): THREE.MeshBasicMaterial {
  const material = new THREE.MeshBasicMaterial({ map, color, side: THREE.DoubleSide });
  material.onBeforeCompile = (shader) => {
    shader.uniforms['clothTime'] = time;
    shader.uniforms['clothWind'] = wind;
    shader.vertexShader = 'uniform float clothTime; uniform float clothWind;\n' + shader.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
      float clothPhase = 0.0;
      #ifdef USE_INSTANCING
      clothPhase = instanceMatrix[3].x * 0.7 + instanceMatrix[3].z * 1.3;
      #endif
      float clothReach = position.x / ${width.toFixed(3)};
      float clothTravel = position.x * ${(7.5 / width).toFixed(3)} - clothTime * (2.2 + clothWind * 3.4) + clothPhase;
      transformed.z += sin(clothTravel) * ${(width * 0.16).toFixed(3)} * clothReach * (0.55 + clothWind * 0.45);
      transformed.y += sin(clothTravel * 0.6 + 1.3) * ${(width * 0.05).toFixed(3)} * clothReach - clothReach * clothReach * ${(width * 0.22).toFixed(3)} * (1.0 - clothWind);`);
  };
  material.customProgramCacheKey = () => `cloth-${width}`;
  return material;
}

/** A two-colour flag in the club's pattern. */
function flagTexture(pattern: StadiumVisualTheme['bannerPattern'], a: string, b: string): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 96; canvas.height = 64;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = a; ctx.fillRect(0, 0, 96, 64);
    ctx.fillStyle = b;
    if (pattern === 'stripe') for (let x = 0; x < 96; x += 24) ctx.fillRect(x, 0, 12, 64);
    else if (pattern === 'hoops') for (let y = 0; y < 64; y += 21) ctx.fillRect(0, y, 96, 10);
    else if (pattern === 'halves') ctx.fillRect(48, 0, 48, 64);
    else if (pattern === 'quarters') { ctx.fillRect(48, 0, 48, 32); ctx.fillRect(0, 32, 48, 32); }
    else if (pattern === 'sash') { ctx.beginPath(); ctx.moveTo(0, 46); ctx.lineTo(0, 64); ctx.lineTo(18, 64); ctx.lineTo(96, 18); ctx.lineTo(96, 0); ctx.lineTo(78, 0); ctx.closePath(); ctx.fill(); }
    else if (pattern === 'chevron') { ctx.beginPath(); ctx.moveTo(0, 10); ctx.lineTo(48, 40); ctx.lineTo(96, 10); ctx.lineTo(96, 26); ctx.lineTo(48, 56); ctx.lineTo(0, 26); ctx.closePath(); ctx.fill(); }
    else ctx.fillRect(0, 24, 96, 16);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function textTexture(width: number, height: number, draw: (ctx: CanvasRenderingContext2D) => void, repeat = false): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (ctx) draw(ctx);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  if (repeat) texture.wrapS = THREE.RepeatWrapping;
  return texture;
}

/** A soft horizontal streak: the flare a bright lamp throws across a lens. */
function streakTexture(): THREE.CanvasTexture {
  return textTexture(256, 16, (ctx) => {
    const across = ctx.createLinearGradient(0, 0, 256, 0);
    across.addColorStop(0, 'rgba(210,228,255,0)'); across.addColorStop(0.5, 'rgba(235,242,255,1)'); across.addColorStop(1, 'rgba(210,228,255,0)');
    ctx.fillStyle = across; ctx.fillRect(0, 0, 256, 16);
    ctx.globalCompositeOperation = 'destination-in';
    const down = ctx.createLinearGradient(0, 0, 0, 16);
    down.addColorStop(0, 'rgba(0,0,0,0)'); down.addColorStop(0.5, 'rgba(0,0,0,1)'); down.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = down; ctx.fillRect(0, 0, 256, 16);
  });
}

/** One cone of light per lamp, bright at the lamp and fading to nothing at the grass. */
function beamGeometry(lamps: readonly THREE.Vector3[]): THREE.BufferGeometry {
  const positions: number[] = [], colors: number[] = [], index: number[] = [];
  const axis = new THREE.Vector3(), side = new THREE.Vector3(), up = new THREE.Vector3(), point = new THREE.Vector3(), target = new THREE.Vector3();
  const ring = 18;
  for (const lamp of lamps) {
    const base = positions.length / 3;
    target.set(lamp.x * 0.3, 0, lamp.z * 0.25);
    axis.subVectors(target, lamp);
    const reach = axis.length();
    axis.normalize();
    side.crossVectors(axis, new THREE.Vector3(0, 1, 0)).normalize();
    up.crossVectors(side, axis).normalize();
    positions.push(lamp.x, lamp.y, lamp.z); colors.push(1, 1, 1, 1);
    for (let step = 0; step < ring; step++) {
      const angle = step / ring * Math.PI * 2;
      point.copy(target).addScaledVector(side, Math.cos(angle) * reach * 0.34).addScaledVector(up, Math.sin(angle) * reach * 0.34);
      positions.push(point.x, point.y, point.z); colors.push(1, 1, 1, 0);
      index.push(base, base + 1 + step, base + 1 + (step + 1) % ring);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 4));
  geometry.setIndex(index);
  return geometry;
}

/** How visible the cones of the floodlights are: only when they are on, and more in rain, snow and storm. */
export function beamOpacity(atmosphere: 'day' | 'sunset' | 'night', weather: MatchWeather): number {
  const lit = atmosphere === 'night' ? 1 : atmosphere === 'sunset' ? 0.45 : 0;
  return lit * (weather === 'storm' ? 0.065 : weather === 'snow' ? 0.06 : weather === 'rain' ? 0.05 : 0.028);
}

/**
 * The ground around the pitch: stands by expansion level, roofs, tunnel, benches, masts or roof lamps with their cones of
 * light, flags, LED boards and the supporters. The main stand on the camera side is a group of its own that only shows when
 * the camera looks back at it.
 */
export function createGround(options: GroundOptions): Ground {
  const { theme, home, away } = options;
  const plan = stadiumPlan(options.level, theme.standStyle);
  const night = options.atmosphere === 'night';
  const group = new THREE.Group(), mainStand = new THREE.Group();
  mainStand.visible = false;
  group.add(mainStand);
  const always: Part[] = [], main: Part[] = [];
  const box = (list: Part[], x: number, y: number, z: number, w: number, h: number, d: number, color: string, tilt?: [number, number, number]) => list.push({ position: [x, y, z], scale: [w, h, d], color, tilt });
  const stand = theme.standStyle === 'industrial' ? ['#46535a', '#374349'] : theme.standStyle === 'classic' ? ['#4a4338', '#3b352c'] : ['#354858', '#2b3d4b'];
  const seatColor = theme.seatColor, wall = '#1d2a35', roofColor = '#2c3a45';
  const slope = Math.atan2(ROW_RISE, ROW_DEPTH), rake = Math.hypot(ROW_RISE, ROW_DEPTH);

  // The two long stands: far side always, camera side in the main-stand group.
  const longStand = (list: Part[], side: -1 | 1, rows: number) => {
    const total = rows + plan.upperRows;
    for (let row = 0; row < total; row++) {
      const upper = row >= rows;
      const depth = LONG_STAND_START + row * ROW_DEPTH + (upper ? 2.4 : 0), height = 0.7 + row * ROW_RISE + (upper ? 1.5 : 0);
      box(list, 0, height / 2, side * depth, LONG_HALF * 2 + 6, height, 0.98, stand[row % 2]);
      if (!plan.terrace) box(list, 0, height + 0.03, side * (depth + 0.18), LONG_HALF * 2 + 2, 0.06, 0.5, seatColor);
    }
    const top = 0.7 + (total - 1) * ROW_RISE + (plan.upperRows ? 1.5 : 0), back = LONG_STAND_START + total * ROW_DEPTH + (plan.upperRows ? 2.4 : 0);
    if (plan.upperRows) {
      // The front of the second tier carries the club colour; a rail runs along it.
      const tierZ = LONG_STAND_START + rows * ROW_DEPTH + 1.9, tierY = 0.7 + rows * ROW_RISE;
      box(list, 0, tierY + 0.55, side * tierZ, LONG_HALF * 2 + 6, 1.5, 0.3, home.shirt);
      box(list, 0, tierY + 1.75, side * tierZ, LONG_HALF * 2 + 6, 0.07, 0.07, '#dfe5e8');
    }
    // Stairways between the blocks, as light ramps along the rake.
    if (!plan.terrace) for (let along = -LONG_HALF + 8; along < LONG_HALF; along += 16) {
      box(list, along, 0.74 + (rows - 1) * ROW_RISE / 2, side * (LONG_STAND_START + (rows - 1) * ROW_DEPTH / 2), 1.1, 0.06, rows * rake, '#7c8a92', [-side * slope, 0, 0]);
    }
    if (plan.terrace) {
      // A village ground: a crush barrier in front of the terrace instead of a back wall.
      box(list, 0, 1.25, side * (LONG_STAND_START - 0.7), LONG_HALF * 2, 0.08, 0.08, '#c9d2d6');
      for (let along = -LONG_HALF; along <= LONG_HALF; along += 5.5) box(list, along, 0.9, side * (LONG_STAND_START - 0.7), 0.08, 0.8, 0.08, '#c9d2d6');
    } else {
      box(list, 0, (top + 1.6) / 2, side * (back + 0.6), LONG_HALF * 2 + 12, top + 1.6, 0.4, wall);
      box(list, 0, top + 0.62, side * (back + 0.1), LONG_HALF * 2 + 10, 0.55, 0.6, seatColor);
    }
    if (plan.roof !== 'none') {
      const depth = back - LONG_STAND_START + 3.5;
      box(list, 0, top + 3.2, side * (LONG_STAND_START - 0.5 + depth / 2), LONG_HALF * 2 + 14, 0.28, depth, roofColor);
      box(list, 0, top + 2.95, side * (LONG_STAND_START - 0.4), LONG_HALF * 2 + 14, 0.5, 0.25, '#dfe5e8');
      for (let x = -54; x <= 54; x += theme.standStyle === 'industrial' ? 9 : 18) box(list, x, (top + 3.2) / 2 + 0.8, side * (back + 0.4), theme.standStyle === 'industrial' ? 0.45 : 0.3, top + 1.6, 0.3, '#56646d');
    }
    return { top, back };
  };
  const far = longStand(always, -1, plan.farRows);
  longStand(main, 1, plan.mainRows);

  // The two ends: stands, or grass banks on a village ground.
  for (const end of [-1, 1]) {
    for (let row = 0; row < plan.endRows; row++) {
      const height = 0.7 + row * ROW_RISE;
      box(always, end * (END_STAND_START + row * ROW_DEPTH), height / 2, 0, 0.98, height, END_HALF * 2 + 3, stand[row % 2]);
      box(always, end * (END_STAND_START + row * ROW_DEPTH + 0.18), height + 0.03, 0, 0.5, 0.06, END_HALF * 2, seatColor);
    }
    if (plan.endRows) {
      const top = 0.7 + (plan.endRows - 1) * ROW_RISE, back = END_STAND_START + plan.endRows * ROW_DEPTH;
      box(always, end * (back + 0.6), (top + 1.6) / 2, 0, 0.4, top + 1.6, END_HALF * 2 + 8, wall);
      box(always, end * (back + 0.1), top + 0.62, 0, 0.6, 0.55, END_HALF * 2 + 6, seatColor);
      for (let along = -END_HALF + 8; along < END_HALF; along += 12) box(always, end * (END_STAND_START + (plan.endRows - 1) * ROW_DEPTH / 2), 0.74 + (plan.endRows - 1) * ROW_RISE / 2, along - 2, plan.endRows * rake, 0.06, 1.1, '#7c8a92', [0, 0, end * slope]);
      if (plan.roof === 'all') {
        const depth = back - END_STAND_START + 3.5;
        box(always, end * (END_STAND_START - 0.5 + depth / 2), top + 3.2, 0, depth, 0.28, END_HALF * 2 + 10, roofColor);
        box(always, end * (END_STAND_START - 0.4), top + 2.95, 0, 0.25, 0.5, END_HALF * 2 + 10, '#dfe5e8');
      }
    } else if (plan.banks) {
      for (let step = 0; step < 3; step++) box(always, end * (END_STAND_START + 0.4 + step * 1.5), (0.35 + step * 0.35) / 2, 0, 1.5, 0.35 + step * 0.35, END_HALF * 2, step % 2 ? '#2f6a3f' : '#2b6139');
    }
    if (plan.corners) {
      // The corners are closed: a block per row between the long stand and the end.
      const rows = Math.min(plan.farRows, plan.endRows);
      for (const side of [-1, 1]) for (let row = 0; row < rows; row++) {
        const height = 0.7 + row * ROW_RISE;
        box(side < 0 ? always : main, end * (57.5 + row * 0.7), height / 2, side * (39.5 + row * 0.7), 3.2 + row * 0.7, height, 3.2 + row * 0.7, stand[row % 2]);
      }
    }
    // Pitch-side walls and the advertising hoardings behind them.
    box(always, end * 56.4, 0.46, 0, 0.26, 0.9, 76, '#f1ebd2');
  }
  for (const side of [-1, 1]) {
    box(always, 0, 0.46, side * 37.6, 111, 0.9, 0.26, '#f1ebd2');
    for (let x = -48; x <= 48; x += 16) box(always, x, 0.5, side * 37.78, 12, 0.54, 0.12, x % 32 ? home.shirt : '#163748');
  }

  // Players' tunnel in the middle of the far stand, with a canopy in the club colour.
  if (!plan.terrace) {
    box(always, 0, 1.25, -(LONG_STAND_START + 0.9), 5.2, 2.5, 3.2, '#090d12');
    box(always, 0, 2.6, -(LONG_STAND_START - 1.1), 6.4, 0.16, 2.6, home.shirt);
    for (const x of [-3, 3]) box(always, x, 1.3, -(LONG_STAND_START - 0.6), 0.2, 2.6, 1.6, '#dfe5e8');
  }
  // Benches and technical areas on the far touchline.
  for (const x of [-13, 13]) {
    box(always, x, 1.25, -38.7, 9.5, 0.14, 2.5, '#b6cbd0');
    box(always, x, 0.62, -39.8, 9.5, 1.3, 0.12, '#426976');
    box(always, x, 0.4, -39, 8.8, 0.2, 0.55, seatColor);
    for (const offset of [-4.5, 4.5]) box(always, x + offset, 0.65, -39, 0.12, 1.3, 2.3, '#8ba9b0');
  }

  // Light: four masts, or lamps under the roof of the biggest grounds.
  const lamps: THREE.Vector3[] = [];
  const lampFaces: THREE.BufferGeometry[] = [];
  const lampFace = (width: number, height: number, at: THREE.Vector3) => {
    const face = new THREE.BoxGeometry(width, height, 0.1);
    const pose = new THREE.Object3D();
    pose.position.copy(at); pose.lookAt(0, 0, 0); pose.updateMatrix();
    face.applyMatrix4(pose.matrix);
    lampFaces.push(face);
  };
  if (plan.mastHeight > 0) {
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const x = sx * 62, z = sz * 44, target = sz < 0 ? always : main;
      box(target, x, plan.mastHeight / 2, z, 0.45, plan.mastHeight, 0.45, '#8da2a6');
      box(target, x, plan.mastHeight, z, 5.2, 2, 0.55, '#c2c8c1');
      const at = new THREE.Vector3(x, plan.mastHeight, z + (sz > 0 ? -0.3 : 0.3));
      if (sz < 0) { lampFace(4.8, 1.5, at); lamps.push(at); }
    }
  } else {
    for (const x of [-42, -14, 14, 42]) { const at = new THREE.Vector3(x, far.top + 2.85, -(LONG_STAND_START - 0.7)); lampFace(7, 0.45, at); lamps.push(at); }
    for (const end of [-1, 1]) for (const z of [-20, 12]) { const at = new THREE.Vector3(end * (END_STAND_START - 0.7), 0.7 + plan.endRows * ROW_RISE + 2.2, z); lampFace(7, 0.45, at); lamps.push(at); }
  }
  const lampMesh = new THREE.Mesh(mergeGeometries(lampFaces)!, new THREE.MeshBasicMaterial({ color: new THREE.Color('#fff6d8').multiplyScalar(night ? 4 : 2.6) }));
  lampFaces.forEach((face) => face.dispose());
  group.add(lampMesh);
  let beams: THREE.Mesh | null = null;
  const beamStrength = beamOpacity(options.atmosphere, options.weather);
  if (beamStrength > 0 && !options.software) {
    beams = new THREE.Mesh(beamGeometry(lamps), new THREE.MeshBasicMaterial({ color: '#dfeaff', vertexColors: true, transparent: true, opacity: beamStrength, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false }));
    beams.name = 'beams';
    beams.renderOrder = 3;
    beams.visible = options.quality !== 'low';
    group.add(beams);
  }
  if (night) {
    const streak = options.software ? null : streakTexture();
    for (const lamp of lamps) {
      const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: options.glow, color: '#fff3cf', transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending }));
      glow.position.copy(lamp);
      glow.scale.setScalar(plan.mastHeight > 0 ? 14 : 9);
      group.add(glow);
      if (!streak) continue;
      const flare = new THREE.Sprite(new THREE.SpriteMaterial({ map: streak, color: '#dbe8ff', transparent: true, opacity: 0.34, depthWrite: false, blending: THREE.AdditiveBlending }));
      flare.position.copy(lamp);
      flare.scale.set(plan.mastHeight > 0 ? 34 : 22, 1.5, 1);
      flare.name = 'beams';
      flare.visible = options.quality !== 'low';
      group.add(flare);
    }
  }

  group.add(instancedBoxes(always));
  mainStand.add(instancedBoxes(main));

  // Flags: corner flags and the big flags of the home end, all cloth in the wind.
  const clothTime = { value: 0 }, clothWind = { value: options.weather === 'storm' ? 1 : options.weather === 'clear' ? 0.35 : 0.6 };
  const dummy = new THREE.Object3D();
  const flagColor = options.decor ?? '#ffd967';
  const poles = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.035, 0.035, 1, 5), new THREE.MeshStandardMaterial({ color: '#eeeac9' }), 4 + 8);
  const cornerCloth = new THREE.PlaneGeometry(0.6, 0.38, 6, 2);
  cornerCloth.translate(0.3, 0, 0);
  const corners = new THREE.InstancedMesh(cornerCloth, clothMaterial(null, flagColor, 0.6, clothTime, clothWind), 4);
  let pole = 0;
  [[-52.5, -34], [52.5, -34], [-52.5, 34], [52.5, 34]].forEach(([x, z], index) => {
    dummy.rotation.set(0, 0, 0); dummy.scale.set(1, 1.6, 1); dummy.position.set(x, 0.8, z); dummy.updateMatrix();
    poles.setMatrixAt(pole++, dummy.matrix);
    dummy.scale.set(1, 1, 1); dummy.position.set(x, 1.36, z); dummy.rotation.set(0, 0.35, 0); dummy.updateMatrix();
    corners.setMatrixAt(index, dummy.matrix);
  });
  corners.frustumCulled = false;
  group.add(corners);
  const bigCloth = new THREE.PlaneGeometry(2.6, 1.7, 10, 4);
  bigCloth.translate(1.3, 0, 0);
  const bigFlags = new THREE.InstancedMesh(bigCloth, clothMaterial(flagTexture(theme.bannerPattern, home.shirt, home.secondary), night ? '#b9c4d6' : '#ffffff', 2.6, clothTime, clothWind), 8);
  let flagCount = 0;
  const flagAt = (x: number, y: number, z: number, turn: number) => {
    dummy.rotation.set(0, 0, 0); dummy.scale.set(1.6, 3.4, 1.6); dummy.position.set(x, y + 1.7, z); dummy.updateMatrix();
    poles.setMatrixAt(pole++, dummy.matrix);
    dummy.scale.set(1, 1, 1); dummy.position.set(x, y + 2.6, z); dummy.rotation.set(0, turn, 0); dummy.updateMatrix();
    bigFlags.setMatrixAt(flagCount++, dummy.matrix);
  };
  if (plan.endRows >= 3) for (let i = 0; i < 6; i++) { const row = 1 + (i * 2) % Math.min(5, plan.endRows - 1); flagAt(-(END_STAND_START + row * ROW_DEPTH), 0.7 + row * ROW_RISE, -30 + i * 12, Math.PI / 2 + 0.3); }
  for (let i = 0; i < 2; i++) { const row = Math.min(plan.farRows - 1, 2); flagAt(-40 + i * 80, 0.7 + row * ROW_RISE, -(LONG_STAND_START + row * ROW_DEPTH), 0.3); }
  poles.count = pole;
  bigFlags.count = flagCount;
  bigFlags.frustumCulled = false;
  group.add(poles, bigFlags);

  // The club's name on a banner at the back of the far stand.
  if (!plan.terrace) {
    const ink = contrastText(home.shirt);
    const banner = new THREE.Mesh(new THREE.PlaneGeometry(40, 1.5), new THREE.MeshBasicMaterial({ color: night ? '#aab6c8' : '#ffffff', map: textTexture(1024, 40, (ctx) => {
      ctx.fillStyle = home.shirt; ctx.fillRect(0, 0, 1024, 40);
      ctx.fillStyle = home.secondary; ctx.fillRect(0, 0, 1024, 4); ctx.fillRect(0, 36, 1024, 4);
      ctx.fillStyle = ink; ctx.font = '800 26px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(options.clubName.toUpperCase(), 512, 21, 980);
    }) }));
    banner.position.set(0, far.top + 1.35, -(far.back + 0.35));
    group.add(banner);
  }

  // LED boards: the club's name and the wordmarks of the game, scrolling; after a goal they flash the goal.
  const start = theme.sponsorSeed % SLOGANS.length;
  const lines = [options.clubName.toUpperCase(), SLOGANS[start], SLOGANS[(start + 3) % SLOGANS.length], options.clubName.toUpperCase(), SLOGANS[(start + 6) % SLOGANS.length]];
  const ledColor = options.decor ?? '#f4e5ac';
  const boardTexture = textTexture(1024, 64, (ctx) => {
    ctx.fillStyle = '#102c36'; ctx.fillRect(0, 0, 1024, 64);
    ctx.fillStyle = home.shirt;
    const pattern = theme.bannerPattern;
    for (let x = 0; x < 1024; x += 32) {
      if (pattern === 'stripe' || pattern === 'hoops' || pattern === 'sash') { ctx.fillRect(x, 0, 16, 5); ctx.fillRect(x + 16, 59, 16, 5); }
      else if (pattern === 'chevron') { ctx.fillRect(x, 0, 16, 3 + (x / 32) % 3 * 2); ctx.fillRect(x, 61 - (x / 32) % 3 * 2, 16, 3 + (x / 32) % 3 * 2); }
      else if (pattern === 'halves' || pattern === 'quarters') { ctx.fillRect(x < 512 ? 0 : 512, 0, 512, 4); ctx.fillRect(x < 512 ? 512 : 0, 60, 512, 4); }
      else { ctx.fillRect(0, 0, 1024, 4); ctx.fillRect(0, 60, 1024, 4); }
    }
    ctx.fillStyle = ledColor; ctx.font = 'bold 25px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText(lines.join('     •     '), 512, 41, 1000);
  }, true);
  const goalTexture = textTexture(512, 64, (ctx) => {
    ctx.fillStyle = home.shirt; ctx.fillRect(0, 0, 512, 64);
    ctx.fillStyle = contrastText(home.shirt); ctx.font = '900 44px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const word = options.english ? 'GOAL!' : 'TOR!';
    for (let i = 0; i < 3; i++) ctx.fillText(word, 85 + i * 171, 34);
  }, true);
  goalTexture.repeat.x = 3;
  const boards: { material: THREE.MeshBasicMaterial; texture: THREE.Texture; shift: number }[] = [];
  const board = (width: number, x: number, z: number, turn: number, shift: number) => {
    const texture = shift ? boardTexture.clone() : boardTexture;
    texture.needsUpdate = true;
    const material = new THREE.MeshBasicMaterial({ map: texture });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, 0.86), material);
    mesh.position.set(x, 0.6, z);
    mesh.rotation.y = turn;
    group.add(mesh);
    boards.push({ material, texture, shift });
  };
  board(98, 0, -37.43, 0, 0);
  for (const end of [-1, 1]) board(60, end * 56.65, 0, -end * Math.PI / 2, end * 0.25);

  // Supporters, staff on the benches and photographers behind the goals.
  let crowd: Crowd | null = null;
  let flashes: THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial> | null = null;
  if (!options.software) {
    const seats: Seat[] = stadiumSeats(plan, options.seed, options.quality === 'high' ? 0.66 : 0.95);
    for (const x of [-13, 13]) for (let i = 0; i < 6; i++) seats.push({ x: x - 3.4 + i * 1.35, y: 0.45, z: -39.05, block: 2, around: 0, main: false, u: -1, v: -1 });
    for (const end of [-1, 1]) for (let i = 0; i < 9; i++) {
      const z = -15 + i * 3.75 + (hash32(`photo-${options.seed}-${end}-${i}`) % 10) / 10;
      if (Math.abs(z) < 5) continue;
      seats.push({ x: end * 55.3, y: 0, z, block: 2, around: 0, main: false, u: -1, v: -1 });
    }
    crowd = createCrowd(seats, options.seed, {
      home: [home.shirt, home.shirt, home.shirt, home.secondary, '#f2e5c8', '#384960', '#c88669', '#98adb7'],
      away: [away.shirt, away.shirt, away.shirt, away.secondary, '#dfe3e6', '#3b4252'],
      mosaic: [home.shirt, home.secondary, home.trim],
      card: (u, v) => mosaicColor(theme.bannerPattern, u, v),
    }, createCrowdAtlas(), { night, light: night ? '#9fadc9' : options.atmosphere === 'sunset' ? '#ffdcb8' : '#ffffff', terrace: plan.terrace });
    if (crowd.mesh) { crowd.mesh.visible = options.quality !== 'low'; group.add(crowd.mesh); }
    if (crowd.mainMesh) { crowd.mainMesh.visible = options.quality !== 'low'; mainStand.add(crowd.mainMesh); }
    if (crowd.phones) group.add(crowd.phones);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(crowd.bulbs, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(crowd.bulbs.length), 3));
    flashes = new THREE.Points(geometry, new THREE.PointsMaterial({ size: 1.1, map: options.softDot, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
    flashes.name = 'flashes';
    flashes.frustumCulled = false;
    flashes.visible = false;
    group.add(flashes);
  }

  let quality = options.quality;
  let homeMood = 0, awayMood = 0, chant = 0, choreo = 0, phones = 0;
  const ease = (value: number, target: number, dt: number, rise: number, fall: number) => value + (target - value) * Math.min(1, dt * (target > value ? rise : fall));
  return {
    group, plan,
    setQuality(next) {
      quality = next;
      group.traverse((object) => { if (object.name === 'crowd' || object.name === 'beams') object.visible = next !== 'low'; });
    },
    update(frame) {
      const { dt, reduced } = frame;
      mainStand.visible = frame.cameraZ < MAIN_STAND_HIDE_Z;
      const celebrating = frame.goalAge >= 0 && frame.goalAge < 5;
      homeMood = ease(homeMood, celebrating && frame.goalBy === 'home' ? 1 : 0, dt, 9, 0.7);
      awayMood = ease(awayMood, celebrating && frame.goalBy === 'away' ? 1 : 0, dt, 9, 0.7);
      chant = ease(chant, frame.homeLeads && !celebrating && !frame.interval ? 1 : 0, dt, 1.5, 1.5);
      choreo = ease(choreo, frame.preKickoff ? 1 : 0, dt, 1.4, 0.8);
      phones = ease(phones, night && (frame.interval || frame.preKickoff) ? 1 : night ? 0.22 : 0, dt, 0.6, 0.6);
      // The wave goes round once every forty seconds while the home side is ahead.
      const lap = frame.time % 40;
      const wave = frame.homeLeads && !celebrating && !reduced && lap < 8 ? lap / 8 : -1;
      if (crowd) {
        crowd.setViewport(frame.viewportHeight);
        crowd.update(reduced ? { time: 0, home: 0, away: 0, chant: 0, choreo, wave: -1, phones: quality === 'low' ? 0 : phones }
          : { time: frame.time, home: homeMood, away: awayMood, chant, choreo, wave, phones: quality === 'low' ? 0 : phones });
      }
      if (!reduced) clothTime.value = frame.time;
      // LED boards: scroll slowly, and flash the goal for four seconds after one.
      const goal = frame.goalAge >= 0 && frame.goalAge < 4;
      for (const entry of boards) {
        const map = goal ? goalTexture : entry.texture;
        if (entry.material.map !== map) { entry.material.map = map; entry.material.needsUpdate = true; }
        if (!goal && !reduced) entry.texture.offset.x = (entry.shift + frame.time * 0.012) % 1;
        entry.material.color.setScalar(goal && !reduced ? 0.75 + 0.25 * Math.sign(Math.sin(frame.goalAge * 14)) : 1);
      }
      if (goal && !reduced) goalTexture.offset.x = (frame.time * 0.45) % 1;
      if (flashes) {
        const active = frame.goalAge >= 0 && frame.goalAge < 3 && quality !== 'low';
        if (flashes.visible !== active) flashes.visible = active;
        if (active) {
          const color = flashes.geometry.getAttribute('color') as THREE.BufferAttribute, out = color.array as Float32Array, fade = 1 - frame.goalAge / 3;
          for (let index = 0, count = color.count; index < count; index++) {
            const lit = flashLit(index, frame.time) ? fade : 0;
            out[index * 3] = lit; out[index * 3 + 1] = lit; out[index * 3 + 2] = lit * 0.92;
          }
          color.needsUpdate = true;
        }
      }
    },
  };
}
