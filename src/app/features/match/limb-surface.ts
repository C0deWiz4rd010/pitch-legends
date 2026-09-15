import { BufferGeometry, Float32BufferAttribute, MathUtils, Uint16BufferAttribute, Vector3 } from 'three';

/** A connected upper/lower limb surface; shared rings cannot pull apart at the elbow. */
export function createLimbSurface(start: Vector3, joint: Vector3, end: Vector3, parent: number, child: number, width = 1, compact = false): BufferGeometry {
  const upper = start.distanceTo(joint), lower = joint.distanceTo(end), length = upper + lower;
  const axis = end.clone().sub(start).normalize();
  const u = new Vector3(axis.y, -axis.x, 0).normalize();
  const v = new Vector3().crossVectors(axis, u).normalize();
  const radial = compact ? 6 : 8, segments = 9;
  const positions: number[] = [], indices: number[] = [], bones: number[] = [], weights: number[] = [];
  const blend = Math.min(.085, upper * .65, lower * .65);
  for (let ring = 0; ring <= segments; ring++) {
    const distance = ring / segments * length;
    const centre = distance <= upper ? start.clone().lerp(joint, distance / upper) : joint.clone().lerp(end, (distance - upper) / lower);
    const radius = distance <= upper
      ? MathUtils.lerp(.073 * width, .061 * width, distance / upper)
      : MathUtils.lerp(.061 * width, .043, (distance - upper) / lower);
    const weight = MathUtils.smoothstep(distance, upper - blend, upper + blend);
    for (let segment = 0; segment < radial; segment++) {
      const angle = segment / radial * Math.PI * 2;
      const point = centre.clone().addScaledVector(u, Math.cos(angle) * radius).addScaledVector(v, Math.sin(angle) * radius);
      positions.push(point.x, point.y, point.z);
      bones.push(parent, child, 0, 0); weights.push(1 - weight, weight, 0, 0);
      if (ring < segments) {
        const a = ring * radial + segment, b = ring * radial + (segment + 1) % radial;
        indices.push(a, b, a + radial, b, b + radial, a + radial);
      }
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('skinIndex', new Uint16BufferAttribute(bones, 4));
  geometry.setAttribute('skinWeight', new Float32BufferAttribute(weights, 4));
  geometry.setIndex(indices); geometry.computeVertexNormals();
  return geometry;
}
