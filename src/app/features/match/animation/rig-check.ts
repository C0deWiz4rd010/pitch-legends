import * as THREE from 'three';
import type { ProceduralFootballer } from '../three-player.factory';

/** What a rig check found on one figure. Zero everywhere means the rig is sound. */
export interface RigReport {
  vertices: number;
  /** Vertices whose four skin weights do not add up to one, or that have a negative weight. */
  badWeights: number;
  /** Vertices bound to a bone that does not exist, or with a position, normal or weight that is not a finite number. */
  invalid: number;
  /** Largest factor by which a triangle edge grows when the figure is posed (tearing at a joint shows here). */
  maxStretch: number;
  /** Largest distance of a posed vertex from the hips, in metres (an exploding vertex shows here). */
  maxExtent: number;
}

/** Checks skin weights and attributes of a figure without a pose: cheap, no GPU. */
export function checkWeights(model: ProceduralFootballer): Pick<RigReport, 'vertices' | 'badWeights' | 'invalid'> {
  const geometry = model.mesh.geometry;
  const position = geometry.getAttribute('position'), normal = geometry.getAttribute('normal');
  const indices = geometry.getAttribute('skinIndex'), weights = geometry.getAttribute('skinWeight');
  const bones = model.mesh.skeleton.bones.length;
  let badWeights = 0, invalid = 0;
  for (let i = 0; i < position.count; i++) {
    const finite = Number.isFinite(position.getX(i) + position.getY(i) + position.getZ(i) + normal.getX(i) + normal.getY(i) + normal.getZ(i));
    let sum = 0, negative = false, missing = false;
    for (let slot = 0; slot < 4; slot++) {
      const weight = slot === 0 ? weights.getX(i) : slot === 1 ? weights.getY(i) : slot === 2 ? weights.getZ(i) : weights.getW(i);
      const index = slot === 0 ? indices.getX(i) : slot === 1 ? indices.getY(i) : slot === 2 ? indices.getZ(i) : indices.getW(i);
      if (!Number.isFinite(weight)) { missing = true; continue; }
      sum += weight;
      if (weight < -1e-6) negative = true;
      if (weight > 1e-6 && (index < 0 || index >= bones)) missing = true;
    }
    if (!finite || missing) invalid++;
    if (Math.abs(sum - 1) > 1e-3 || negative) badWeights++;
  }
  return { vertices: position.count, badWeights, invalid };
}

const VERTEX = new THREE.Vector3();

/** Skinned positions of every vertex in the current pose, into `out` (3 floats per vertex). */
function skinnedPositions(model: ProceduralFootballer, out: Float32Array): void {
  const count = model.mesh.geometry.getAttribute('position').count;
  for (let i = 0; i < count; i++) {
    model.mesh.getVertexPosition(i, VERTEX);
    out[i * 3] = VERTEX.x; out[i * 3 + 1] = VERTEX.y; out[i * 3 + 2] = VERTEX.z;
  }
}

/**
 * Poses the figure with `pose` (which sets joint rotations) and measures how far its triangle edges stretch compared with the
 * bind pose and how far any vertex flies from the hips. Leaves the figure in the bind pose afterwards.
 */
export function checkPose(model: ProceduralFootballer, pose: () => void): { maxStretch: number; maxExtent: number } {
  const geometry = model.mesh.geometry;
  const count = geometry.getAttribute('position').count;
  const rest = new Float32Array(count * 3), posed = new Float32Array(count * 3);
  model.mesh.skeleton.pose();
  model.mesh.updateMatrixWorld(true);
  // The bone matrices are only refreshed on render: bring them up to date before skinning on the CPU.
  model.joints.hips.updateWorldMatrix(true, true);
  model.mesh.skeleton.update();
  skinnedPositions(model, rest);
  pose();
  model.mesh.updateMatrixWorld(true);
  model.joints.hips.updateWorldMatrix(true, true);
  model.mesh.skeleton.update();
  skinnedPositions(model, posed);
  const index = geometry.getIndex();
  let maxStretch = 1, maxExtent = 0;
  const edge = (a: number, b: number) => {
    const before = Math.hypot(rest[a * 3] - rest[b * 3], rest[a * 3 + 1] - rest[b * 3 + 1], rest[a * 3 + 2] - rest[b * 3 + 2]);
    // Hair and eye details create tiny edges where a ratio means nothing.
    if (before < 0.02) return;
    const after = Math.hypot(posed[a * 3] - posed[b * 3], posed[a * 3 + 1] - posed[b * 3 + 1], posed[a * 3 + 2] - posed[b * 3 + 2]);
    maxStretch = Math.max(maxStretch, after / before);
  };
  const hips = model.joints.hips.getWorldPosition(new THREE.Vector3());
  for (let i = 0; i < count; i++) maxExtent = Math.max(maxExtent, Math.hypot(posed[i * 3] - hips.x, posed[i * 3 + 1] - hips.y, posed[i * 3 + 2] - hips.z));
  if (index) {
    for (let i = 0; i < index.count; i += 3) {
      const a = index.getX(i), b = index.getX(i + 1), c = index.getX(i + 2);
      edge(a, b); edge(b, c); edge(c, a);
    }
  }
  model.mesh.skeleton.pose();
  model.mesh.updateMatrixWorld(true);
  model.joints.hips.updateWorldMatrix(true, true);
  model.mesh.skeleton.update();
  return { maxStretch, maxExtent };
}
