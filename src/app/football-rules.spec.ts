import { ArcadeMatch, MATCH_TICK } from './core/services/arcade-match';
import { createPracticeTeams } from './core/football/practice';
import { EMPTY_MATCH_COMMAND, MatchCommand, RuleState } from './models/match.model';
import { BALL_RADIUS } from './core/football/ball-physics';

function scene() {
  const {home,away} = createPracticeTeams();
  const match = new ArcadeMatch(home,away,{mode:'play',controllerMode:'human',controlledTeamId:home.id,seed:721,assist:'balanced',halfMinutes:3,difficulty:'normal',playerLockId:null,weather:'clear',inputDevice:'keyboard',camera:{zoom:1,lookAhead:.18,shake:false,reducedMotion:true}});
  match.tick=100;
  return match;
}
function tick(match:ArcadeMatch, command:Partial<MatchCommand>={}, count=1) {
  for(let i=0;i<count;i++) match.step(MATCH_TICK,{...EMPTY_MATCH_COMMAND,device:'keyboard',...command});
}
function restart(match:ArcadeMatch, phase:RuleState['phase'], x=80,y=34) {
  const save=match.checkpoint();
  save.rule={...save.rule,phase,restartSide:'home',spotX:x,spotY:y,elapsed:0};
  save.phase='stoppage';
  save.ball={...save.ball,ownerId:null,x,y,z:BALL_RADIUS,vx:0,vy:0,vz:0};
  match.restore(save);
}

describe('Complete football matches',()=>{
  it('buffers a short restart press, waits for setup and then releases a moving ball',()=>{
    const match=scene();
    restart(match,'freeKick');
    tick(match,{pass:true,aimX:1});
    tick(match,{aimX:1},8);
    expect(match.rule.phase).toBe('freeKick');
    tick(match,{aimX:1},17);
    expect(match.rule.phase).toBe('playing');
    expect(Math.hypot(match.ball.vx,match.ball.vy)).toBeGreaterThan(5);
    expect(match.ball.ownerId).toBeNull();
  });
  it.each(['throwIn','corner','goalKick'] as const)('does not flag direct offside from %s',phase=>{
    const match=scene();
    const forward=match.actors.find(a=>a.side==='home'&&a.player.positionGroup==='ATT')!;
    forward.x=104; forward.y=34;
    restart(match,phase,phase==='goalKick'?5.5:80,phase==='throwIn'?0:34);
    tick(match,{pass:true,aimX:1});
    tick(match,{aimX:1},25);
    expect(match.rule.phase).toBe('playing');
    expect(match.checkpoint().runtime.football?.offsideCandidates).toEqual([]);
    expect(match.checkpoint().runtime.football?.restartRelease?.phase).toBe(phase);
  });
  it('awards an indirect free kick when a taker touches the ball twice',()=>{
    const match=scene();
    restart(match,'freeKick',50,34);
    tick(match,{pass:true,aimX:1}); tick(match,{aimX:1},25);
    const takerId=match.checkpoint().runtime.football!.restartRelease!.takerId;
    const taker=match.actors.find(a=>a.player.id===takerId)!;
    for(const a of match.actors) a.active=a===taker;
    match.config.playerLockId=takerId;
    Object.assign(match.ball,{x:taker.x+.3,y:taker.y,z:BALL_RADIUS,vx:0,vy:0,vz:0,controlledTouch:1});
    tick(match);
    expect(match.rule.phase).toBe('freeKick');
    expect(match.rule.restartSide).toBe('away');
    expect(match.rule.indirect).toBe(true);
  });
  it('does not count an untouched throw directly into either goal',()=>{
    for(const own of [false,true]) {
      const match=scene();
      match.rule.phase='playing';
      for(const a of match.actors) {
        a.active=a.player.id===match.selectedPlayerId;
        a.x=50; a.y=34;
      }
      const save=match.checkpoint();
      save.runtime.football!.restartRelease={phase:'throwIn',side:'home',takerId:'thrower'};
      save.ball={...save.ball,ownerId:null,x:own?-.2:105.2,y:34,z:BALL_RADIUS,vx:0,vy:0,vz:0};
      match.restore(save); tick(match);
      expect(match.homeScore+match.awayScore).toBe(0);
      expect(match.rule.phase).toBe(own?'corner':'goalKick');
      expect(match.rule.restartSide).toBe('away');
    }
  });
  it('uses the nominated penalty taker and places other players outside the area',()=>{
    const match=scene();
    const taker=match.actors.find(a=>a.side==='home'&&a.player.positionGroup==='ATT')!;
    match.home.tactics.penaltyTakerId=taker.player.id;
    restart(match,'penalty',94,34); tick(match);
    expect(match.selectedPlayerId).toBe(taker.player.id);
    expect(taker.x).toBeCloseTo(93.55);
    for(const a of match.actors.filter(a=>a!==taker&&a.player.positionGroup!=='GK')) expect(a.x).toBeLessThanOrEqual(87);
    tick(match,{shoot:true,aimY:.5},35); tick(match,{aimY:.5});
    expect(match.rule.phase).toBe('playing');
    expect(match.homeStats.shots).toBe(1);
  });
  it('never waits indefinitely for an unattended human restart',()=>{
    const match=scene(); restart(match,'throwIn',50,0); tick(match,{},181);
    expect(match.rule.phase).toBe('playing');
  });
  it('restores substitutions, player lock and tactical changes without allowing re-entry',()=>{
    const match=scene();
    match.rule.phase='playing';
    const outgoing=match.actors.find(a=>a.player.id===match.selectedPlayerId)!;
    const incoming=match.bench()[0];
    match.config.playerLockId=outgoing.player.id;
    expect(match.makeSub(outgoing.player.id,incoming.id)).toBe(true);
    match.home.tactics.width='wide';
    const save=match.checkpoint();
    const twin=scene(); expect(twin.restore(save)).toBe(true);
    expect(twin.bench().some(p=>save.runtime.football!.subbedOutIds!.includes(p.id))).toBe(false);
    expect(twin.config.playerLockId).toBe(incoming.id);
    expect(twin.home.formation).toEqual(match.home.formation);
    expect(twin.home.tactics.width).toBe('wide');
    tick(match,{},60); tick(twin,{},60);
    expect(twin.stateHash()).toBe(match.stateHash());
  });
});
