import { BufferGeometry, MathUtils, Vector3 } from 'three';

/** Give neighboring surfaces the same deformation field around a shared joint. */
export function blendJointSkin(
  geometry: BufferGeometry, parent: number, child: number,
  parentOrigin: Vector3, jointOrigin: Vector3, halfLength: number, radius: number,
): void {
  const positions = geometry.getAttribute('position');
  const indices = geometry.getAttribute('skinIndex');
  const weights = geometry.getAttribute('skinWeight');
  const axis = jointOrigin.clone().sub(parentOrigin).normalize();
  const offset = new Vector3();
  for (let i = 0; i < positions.count; i++) {
    const bone = indices.getX(i);
    if (bone !== parent && bone !== child) continue;
    offset.fromBufferAttribute(positions, i).sub(jointOrigin);
    const along = offset.dot(axis);
    if (Math.abs(along) > halfLength || offset.lengthSq() - along * along > radius * radius) continue;
    const weight = MathUtils.smoothstep(along, -halfLength, halfLength);
    indices.setXYZW(i, parent, child, 0, 0);
    weights.setXYZW(i, 1 - weight, weight, 0, 0);
  }
}
