import { BufferGeometry, Float32BufferAttribute, Uint16BufferAttribute, Vector3 } from 'three';
import { blendJointSkin } from './features/match/joint-skinning';
import { createProceduralFootballer, poseFootballer } from './features/match/three-player.factory';
import { createPracticeTeams } from './core/football/practice';
import { ArcadeMatch } from './core/services/arcade-match';
import { createLimbSurface } from './features/match/limb-surface';

describe('Continuous joint deformation', () => {
  it('has open edges only at the sleeve and wrist, with no separate elbow seam', () => {
    const geometry = createLimbSurface(new Vector3(0,.3,0), new Vector3(0,.15,0), new Vector3(0,-.1,0), 0, 1);
    const triangles = geometry.index!;
    const edges = new Map<string, number>();
    for(let i=0;i<triangles.count;i+=3) {
      const face=[triangles.getX(i),triangles.getX(i+1),triangles.getX(i+2)];
      for(let j=0;j<3;j++) {
        const a=face[j],b=face[(j+1)%3],key=`${Math.min(a,b)}:${Math.max(a,b)}`;
        edges.set(key,(edges.get(key)??0)+1);
      }
    }
    expect([...edges.values()].filter(count=>count===1)).toHaveLength(16);
    expect([...edges.values()].every(count=>count===1||count===2)).toBe(true);
    geometry.dispose();
  });
  it('keeps touching surfaces together even when they originally belonged to different bones', () => {
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new Float32BufferAttribute([.05, 0, 0, .05, 0, 0], 3));
    geometry.setAttribute('skinIndex', new Uint16BufferAttribute([0,0,0,0,1,0,0,0], 4));
    geometry.setAttribute('skinWeight', new Float32BufferAttribute([1,0,0,0,1,0,0,0], 4));
    blendJointSkin(geometry, 0, 1, new Vector3(0,1,0), new Vector3(), .1, .1);
    const weight = geometry.getAttribute('skinWeight');
    expect(weight.getX(0)).toBeCloseTo(.5);
    expect(weight.getX(1)).toBeCloseTo(weight.getX(0));
    expect(weight.getY(1)).toBeCloseTo(weight.getY(0));
    geometry.dispose();
  });

  it('keeps skin weights normalized and all posed vertices finite across body types and goalkeeper actions', () => {
    const { home, away } = createPracticeTeams();
    const state = new ArcadeMatch(home, away, home.id).snapshot().players[0];
    Object.assign(state, { x:0, y:0, vx:0, vy:0, facingX:0, facingY:1, actionStartedTick:0, actionTarget:{x:1.05,y:.35,z:.6} });
    for (const bodyBuild of ['slim','average','strong'] as const) {
      const model = createProceduralFootballer({ ...home.players[0].visuals, bodyBuild }, home.visuals.kits.home, 1, true);
      const weights = model.mesh.geometry.getAttribute('skinWeight');
      let blended = 0;
      for (let i=0;i<weights.count;i++) {
        expect(weights.getX(i)+weights.getY(i)+weights.getZ(i)+weights.getW(i)).toBeCloseTo(1,6);
        if(weights.getX(i)>0 && weights.getY(i)>0) blended++;
      }
      expect(blended).toBeGreaterThan(100);
      for (const action of ['keeper-catch','keeper-dive','shot'] as const) {
        state.action=action;
        poseFootballer(model,state,15,.25,true);
        model.mesh.updateMatrixWorld(true); model.mesh.skeleton.update();
        const vertex=new Vector3();
        for(let i=0;i<weights.count;i+=11) {
          model.mesh.getVertexPosition(i,vertex);
          expect(Number.isFinite(vertex.lengthSq())).toBe(true);
          expect(vertex.length()).toBeLessThan(3);
        }
      }
      model.destroy();
    }
  });
});
