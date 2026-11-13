import * as THREE from 'three';

/** What a triangle of the ball belongs to: a white hexagon, a dark pentagon or the stitching between two panels. */
export const enum BallPart { Body = 0, Panel = 1, Seam = 2 }

export interface BallMesh {
  geometry: THREE.BufferGeometry;
  /** One entry per triangle, so a ball design can repaint the panels. */
  parts: Uint8Array;
}

type Vec = [number, number, number];
const add = (a: Vec, b: Vec): Vec => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a: Vec, s: number): Vec => [a[0] * s, a[1] * s, a[2] * s];
const mix = (a: Vec, b: Vec, t: number): Vec => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const dot = (a: Vec, b: Vec) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec, b: Vec): Vec => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a: Vec): Vec => scale(a, 1 / Math.hypot(a[0], a[1], a[2]));

/** The twelve corners of an icosahedron (edge length 2). */
function icosahedron(): Vec[] {
  const phi = (1 + Math.sqrt(5)) / 2, out: Vec[] = [];
  for (const a of [-1, 1]) for (const b of [-phi, phi]) out.push([0, a, b], [a, b, 0], [b, 0, a]);
  return out;
}

/**
 * The 32 panels of a classic football (a truncated icosahedron): twelve pentagons where the corners of an icosahedron were
 * cut off, twenty hexagons where its faces were. Each panel is a list of corners on the unit sphere, counter-clockwise from outside.
 */
export function ballPanels(): { corners: Vec[]; pentagon: boolean }[] {
  const corners = icosahedron();
  const near = (a: Vec, b: Vec) => Math.abs(Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) - 2) < 1e-6;
  const ordered = (centre: Vec, points: Vec[]): Vec[] => {
    // Sort around the outward axis, so every panel winds the same way.
    const axis = unit(centre), ref = unit(cross(axis, Math.abs(axis[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0])), side = cross(axis, ref);
    return points.map((p) => ({ p, angle: Math.atan2(dot(p, side), dot(p, ref)) })).sort((a, b) => a.angle - b.angle).map((entry) => unit(entry.p));
  };
  const panels: { corners: Vec[]; pentagon: boolean }[] = [];
  for (const v of corners) {
    const neighbours = corners.filter((n) => near(v, n));
    panels.push({ pentagon: true, corners: ordered(v, neighbours.map((n) => mix(v, n, 1 / 3))) });
  }
  for (let a = 0; a < 12; a++) for (let b = a + 1; b < 12; b++) for (let c = b + 1; c < 12; c++) {
    const A = corners[a], B = corners[b], C = corners[c];
    if (!near(A, B) || !near(B, C) || !near(A, C)) continue;
    const centre = add(add(A, B), C);
    panels.push({ pentagon: false, corners: ordered(centre, [mix(A, B, 1 / 3), mix(A, B, 2 / 3), mix(B, C, 1 / 3), mix(B, C, 2 / 3), mix(C, A, 1 / 3), mix(C, A, 2 / 3)]) });
  }
  return panels;
}

/**
 * A football as real geometry: every panel is a patch of triangles pushed out to the sphere, with a thin strip of stitching
 * along its edge. Panels stay crisp at any distance and need no texture; the colours are vertex colours.
 */
export function createBallMesh(radius: number, detail = 3, seam = 0.07): BallMesh {
  const positions: number[] = [], parts: number[] = [];
  const triangle = (a: Vec, b: Vec, c: Vec, part: BallPart) => {
    for (const p of [a, b, c]) { const u = unit(p); positions.push(u[0] * radius, u[1] * radius, u[2] * radius); }
    parts.push(part);
  };
  /** A flat triangle cut into detail² smaller ones before it is pushed out to the sphere. */
  const patch = (a: Vec, b: Vec, c: Vec, part: BallPart) => {
    const at = (i: number, j: number): Vec => add(add(scale(a, 1 - (i + j) / detail), scale(b, i / detail)), scale(c, j / detail));
    for (let i = 0; i < detail; i++) for (let j = 0; j < detail - i; j++) {
      triangle(at(i, j), at(i + 1, j), at(i, j + 1), part);
      if (i + j < detail - 1) triangle(at(i + 1, j), at(i + 1, j + 1), at(i, j + 1), part);
    }
  };
  for (const panel of ballPanels()) {
    const count = panel.corners.length;
    const centre = unit(panel.corners.reduce((sum, p) => add(sum, p), [0, 0, 0] as Vec));
    const inner = panel.corners.map((p) => mix(p, centre, seam));
    for (let i = 0; i < count; i++) {
      const next = (i + 1) % count;
      patch(centre, inner[i], inner[next], panel.pentagon ? BallPart.Panel : BallPart.Body);
      // The stitching: a strip between the panel and its edge, cut along the edge so it follows the curve.
      for (let step = 0; step < detail; step++) {
        const t0 = step / detail, t1 = (step + 1) / detail;
        const o0 = mix(panel.corners[i], panel.corners[next], t0), o1 = mix(panel.corners[i], panel.corners[next], t1);
        const i0 = mix(inner[i], inner[next], t0), i1 = mix(inner[i], inner[next], t1);
        triangle(i0, o0, o1, BallPart.Seam);
        triangle(i0, o1, i1, BallPart.Seam);
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  const position = new THREE.Float32BufferAttribute(positions, 3);
  geometry.setAttribute('position', position);
  // On a sphere the normal is the direction from the centre: smooth shading without welding the panels.
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(positions.map((value) => value / radius), 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(positions.length), 3));
  const mesh = { geometry, parts: Uint8Array.from(parts) };
  paintBall(mesh, '#1c3651', '#fcfaf1');
  return mesh;
}

/** Repaints the ball: pentagons in the panel colour, hexagons in the body colour, the stitching a shade between and darker. */
export function paintBall(ball: BallMesh, panel: string, body: string): void {
  const colors = ball.geometry.getAttribute('color') as THREE.BufferAttribute;
  const panelColor = new THREE.Color(panel), bodyColor = new THREE.Color(body);
  const seamColor = bodyColor.clone().lerp(panelColor, 0.35).multiplyScalar(0.62);
  ball.parts.forEach((part, index) => {
    const color = part === BallPart.Panel ? panelColor : part === BallPart.Seam ? seamColor : bodyColor;
    for (let n = 0; n < 3; n++) colors.setXYZ(index * 3 + n, color.r, color.g, color.b);
  });
  colors.needsUpdate = true;
}
