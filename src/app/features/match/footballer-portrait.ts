import * as THREE from 'three';
import { Player } from '../../models/player.model';
import { KitDesign } from '../../models/visual.model';
import { createProceduralFootballer } from './three-player.factory';

let renderer: THREE.WebGLRenderer | null = null;
let releaseTimer: ReturnType<typeof setTimeout> | undefined;
let pending: Promise<unknown> = Promise.resolve();

/** One temporary GPU context services every portrait; figures use the match factory. */
export function footballerPortrait(player: Player, kit: KitDesign, full: boolean): Promise<string> {
  const job = pending.then(async () => {
    await new Promise<void>(resolve => setTimeout(resolve, 0));
    clearTimeout(releaseTimer);
    if (!renderer) {
      renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
      renderer.setSize(256, 256);
      renderer.setPixelRatio(1);
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.1;
    }
    const scene = new THREE.Scene();
    if (!full) scene.background = new THREE.Color('#203c4c');
    scene.add(new THREE.HemisphereLight('#e9f5ff', '#574939', 2.5));
    const key = new THREE.DirectionalLight('#fff0da', 3);
    key.position.set(-2, 4, 5);
    scene.add(key);
    const rim = new THREE.DirectionalLight('#86dbef', 1.8);
    rim.position.set(3, 2, -2);
    scene.add(rim);
    const model = createProceduralFootballer(player.visuals, kit, player.kitNumber, player.positionGroup === 'GK', player.foot === 'Left');
    scene.add(model.mesh);
    model.mesh.rotation.y = full ? -0.3 : 0.12;
    const scale = full ? 1.07 : 0.32;
    const centre = full ? model.recipe.height * 0.50 : model.joints.head.getWorldPosition(new THREE.Vector3()).y - 0.055;
    const camera = new THREE.OrthographicCamera(-scale, scale, scale, -scale, 0.1, 20);
    camera.position.set(0, centre, 5);
    camera.lookAt(0, centre, 0);
    try {
      renderer.render(scene, camera);
      return renderer.domElement.toDataURL('image/png');
    } finally {
      model.destroy();
      releaseTimer = setTimeout(disposePortraitRenderer, 15_000);
    }
  });
  pending = job.catch(() => undefined);
  return job;
}

export function disposePortraitRenderer(): void {
  clearTimeout(releaseTimer);
  renderer?.dispose();
  renderer?.forceContextLoss();
  renderer = null;
}
