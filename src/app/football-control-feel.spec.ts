import { ArcadeMatch, MATCH_TICK } from './core/services/arcade-match';
import { createPracticeTeams } from './core/football/practice';
import { EMPTY_MATCH_COMMAND } from './models/match.model';
import { advanceBroadcastCamera } from './features/match/broadcast-camera';
import { createProceduralFootballer,poseFootballer } from './features/match/three-player.factory';
import { Vector3 } from 'three';

function scene() {
  const {home,away}=createPracticeTeams();
  const match=new ArcadeMatch(home,away,home.id);
  match.rule.phase='playing';match.tick=100;
  const selected=match.actors.find(a=>a.player.id===match.selectedPlayerId)!;
  const other=match.actors.find(a=>a.side==='home'&&a!==selected&&a.player.positionGroup!=='GK')!;
  for(const actor of match.actors) actor.active=actor===selected||actor===other;
  for(const [index,actor] of [selected,other].entries()) Object.assign(actor,{x:40+index*4,y:34,vx:0,vy:0,intentX:40+index*4,intentY:34,decisionCooldown:100});
  Object.assign(match.ball,{ownerId:null,x:43,y:34,z:.11,vx:0,vy:0,vz:0,controlledTouch:1});
  return {match,selected,other};
}
describe('Calm control and football animation',()=>{
  it('holds the camera inside its quiet area and caps a sudden long-pass pan',()=>{
    const initial={x:0,z:0,width:48};
    expect(advanceBroadcastCamera(initial,{x:2,z:1,width:48},1/60)).toEqual(initial);
    let camera=initial;
    for(let i=0;i<60;i++) {
      const next=advanceBroadcastCamera(camera,{x:100,z:40,width:80},1/60);
      expect(Math.hypot(next.x-camera.x,next.z-camera.z)).toBeLessThanOrEqual(20/60+.00001);
      expect(next.width-camera.width).toBeLessThan(.5);
      camera=next;
    }
    expect(Math.hypot(camera.x,camera.z)).toBeLessThanOrEqual(20.00001);
    expect(camera.width).toBeLessThan(68);
  });
  it('keeps the chosen player when loose-ball proximity alternates between teammates',()=>{
    const {match,selected,other}=scene();
    for(let i=0;i<120;i++) {
      match.ball.ownerId=null;match.ball.x=i%2?selected.x+1.5:other.x-1.5;
      match.ball.vx=match.ball.vy=0;
      match.step(MATCH_TICK,EMPTY_MATCH_COMMAND);
      expect(match.selectedPlayerId).toBe(selected.player.id);
    }
  });
  it('waits for secure possession and leaves a manual switch untouched for 1.5 seconds',()=>{
    const {match,selected,other}=scene();
    Object.assign(match.ball,{ownerId:other.player.id,x:other.x+.4});
    for(let i=0;i<10;i++) match.step(MATCH_TICK,EMPTY_MATCH_COMMAND);
    expect(match.selectedPlayerId).toBe(selected.player.id);
    for(let i=0;i<4;i++) match.step(MATCH_TICK,EMPTY_MATCH_COMMAND);
    expect(match.selectedPlayerId).toBe(other.player.id);
    match.step(MATCH_TICK,{...EMPTY_MATCH_COMMAND,switchPlayer:true});
    const chosen=match.selectedPlayerId;
    expect(chosen).not.toBe(other.player.id);
    for(let i=0;i<89;i++) match.step(MATCH_TICK,EMPTY_MATCH_COMMAND);
    expect(match.selectedPlayerId).toBe(chosen);
  });
  it('never takes a manual selection away merely because a teammate controls the ball',()=>{
    const {match,selected,other}=scene();match.config.autoSwitch='manual';
    Object.assign(match.ball,{ownerId:other.player.id,x:other.x+.4});
    for(let i=0;i<120;i++) match.step(MATCH_TICK,EMPTY_MATCH_COMMAND);
    expect(match.selectedPlayerId).toBe(selected.player.id);
  });
  it('keeps a caught ball in the goalkeeper hands during the gathering animation',()=>{
    const {match}=scene();
    const keeper=match.actors.find(a=>a.side==='away'&&a.player.positionGroup==='GK')!;
    Object.assign(keeper,{active:true,x:102,y:34,vx:0,vy:0,facingX:-1,facingY:0,action:'keeper-catch',actionStartedTick:match.tick});
    Object.assign(match.ball,{ownerId:keeper.player.id,x:101.8,y:34,z:.6,vx:0,vy:0});
    for(let i=0;i<30;i++) match.step(MATCH_TICK,EMPTY_MATCH_COMMAND);
    expect(keeper.action).toBe('keeper-catch');
    expect(match.ball.ownerId).toBe(keeper.player.id);
    expect(match.ball.z).toBeGreaterThan(1.09);
    expect(Math.hypot(keeper.vx,keeper.vy)).toBeLessThan(.1);
  });
  it('places both goalkeeper hands around the caught ball and returns the kicking leg smoothly',()=>{
    const {home,away}=createPracticeTeams();
    const state=new ArcadeMatch(home,away,home.id).snapshot().players[0];
    Object.assign(state,{x:0,y:0,vx:0,vy:0,facingX:0,facingY:1,action:'keeper-catch',actionStartedTick:100,actionTarget:{x:0,y:.35,z:1.1}});
    const model=createProceduralFootballer(home.players[0].visuals,home.visuals.kits.home,1,true);
    poseFootballer(model,state,115,2,true);model.mesh.updateMatrixWorld(true);
    for(const side of ['left','right'] as const) expect(model.joints[`${side}Hand`].getWorldPosition(new Vector3()).distanceTo(new Vector3(0,1.1,.35))).toBeLessThan(.16);
    Object.assign(state,{action:'shot',actionStartedTick:100,actionTarget:undefined});
    poseFootballer(model,state,129,2,true);const before=model.joints.rightThigh.quaternion.clone();
    poseFootballer(model,state,131,2,true);
    expect(before.angleTo(model.joints.rightThigh.quaternion)).toBeLessThan(.05);
    model.destroy();
  });
});
