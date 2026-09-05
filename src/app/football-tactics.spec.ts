import { createPracticeTeams } from './core/football/practice';
import { tacticalIntent } from './core/football/tactical-intent';
import { ArcadeMatch } from './core/services/arcade-match';

function scenario() {
  const teams = createPracticeTeams();
  const match = new ArcadeMatch(teams.home, teams.away, teams.home.id);
  const owner = match.actors.find(a => a.side==='home' && a.player.positionGroup==='MID')!;
  Object.assign(owner,{x:60,y:34});
  Object.assign(match.ball,{x:60,y:34,ownerId:owner.player.id});
  const defender = match.actors.find(a => a.side==='home' && a.player.positionGroup==='DEF')!;
  const slot = match.home.formation.slots.find(s=>s.playerId===defender.player.id)!;
  slot.roleId='fb'; slot.instruction.stayInPosition=false;
  Object.assign(defender,{homeX:25,homeY:12,x:25,y:12});
  const intent = () => tacticalIntent(defender,owner,match.ball,match.actors,match.home,1);
  return { match, owner, defender, slot, intent };
}

describe('Coordinated football tactics',()=>{
  it('moves the defensive line up and broadens the shape when instructed',()=>{
    const {match,intent}=scenario();
    match.home.tactics.defensiveLine='deep';match.home.tactics.width='narrow';
    const compact=intent();
    match.home.tactics.defensiveLine='high';match.home.tactics.width='wide';
    const expansive=intent();
    expect(expansive.x).toBeGreaterThan(compact.x+10);
    expect(Math.abs(expansive.y-34)).toBeGreaterThan(Math.abs(compact.y-34)+8);
  });
  it('coordinates one challenger and distinct cover pressers instead of piling on the ball',()=>{
    const {match}=scenario();
    const owner=match.actors.find(a=>a.side==='away' && a.player.positionGroup==='MID')!;
    Object.assign(owner,{x:55,y:34});Object.assign(match.ball,{x:55,y:34});
    const team=match.actors.filter(a=>a.side==='home' && a.player.positionGroup!=='GK');
    const intents=()=>team.map(actor=>tacticalIntent(actor,owner,match.ball,match.actors,match.home,1));
    match.home.tactics.pressing='low';expect(intents().filter(i=>i.action==='press'||i.action==='support-press')).toHaveLength(1);
    match.home.tactics.pressing='gegenpress';
    const pressing=intents().filter(i=>i.action==='press'||i.action==='support-press');
    expect(pressing).toHaveLength(3);
    expect(new Set(pressing.map(i=>`${i.x}|${i.y}`)).size).toBe(3);
  });
  it('keeps stay-in-position instructions bounded',()=>{
    const {defender,slot,match,intent}=scenario();
    match.home.tactics.mentality='ultra-attacking';match.home.tactics.defensiveLine='high';
    slot.instruction.stayInPosition=true;
    expect(Math.abs(intent().x-defender.homeX)).toBeLessThanOrEqual(7);
    expect(Math.abs(intent().y-defender.homeY)).toBeLessThanOrEqual(6);
  });
  it('gives an inverted full-back a central outlet instead of an overlapping wide run',()=>{
    const {slot,intent}=scenario();
    slot.roleId='wb';const overlap=intent();
    slot.roleId='ifb';const inverted=intent();
    expect(Math.abs(inverted.y-34)).toBeLessThan(Math.abs(overlap.y-34)-10);
  });
  it('mirrors tactical intent correctly after a change of ends',()=>{
    const {match,owner,defender,intent}=scenario();
    const first=intent();
    const mirrored=match.actors.map(a=>({...a,x:105-a.x,homeX:105-a.homeX,vx:-a.vx}));
    const second=tacticalIntent(mirrored.find(a=>a.player.id===defender.player.id)!,mirrored.find(a=>a.player.id===owner.player.id),{...match.ball,x:105-match.ball.x,vx:-match.ball.vx},mirrored,match.home,-1);
    expect(first.x+second.x).toBeCloseTo(105,8);
    expect(first.y).toBeCloseTo(second.y,8);
  });
});
