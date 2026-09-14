import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { AudioService } from './core/services/audio.service';
import { GameStateService } from './core/services/game-state.service';
import { ReplayRing } from './core/football/replay-ring';
import { ArcadeMatch, MATCH_TICK } from './core/services/arcade-match';
import { createPracticeTeams } from './core/football/practice';
import { EMPTY_MATCH_COMMAND } from './models/match.model';
import { playerInCameraSpace } from './features/match/three-render-state';

class FakeAudioContext {
  static oscillators=0;
  static stopped=0;
  currentTime=0; sampleRate=100; state='running'; destination={};
  private param() {return {value:0,setValueAtTime:vi.fn(),setTargetAtTime:vi.fn(),linearRampToValueAtTime:vi.fn(),exponentialRampToValueAtTime:vi.fn()};}
  private node() {const node={connect:(_:unknown)=>node,disconnect:vi.fn(),start:vi.fn(),stop:()=>FakeAudioContext.stopped++};return node;}
  createOscillator(){FakeAudioContext.oscillators++;return {...this.node(),frequency:this.param()};}
  createGain(){return {...this.node(),gain:this.param()};}
  createBiquadFilter(){return {...this.node(),frequency:this.param(),Q:this.param()};}
  createBufferSource(){return this.node();}
  createBuffer(_:number,length:number){return {getChannelData:()=>new Float32Array(length)};}
}

describe('Football presentation',()=>{
  afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals();TestBed.resetTestingModule();});
  it('keeps music audible when effects are muted, and honors the master switch',()=>{
    vi.useFakeTimers();vi.stubGlobal('AudioContext',FakeAudioContext);FakeAudioContext.oscillators=0;
    TestBed.configureTestingModule({providers:[{provide:GameStateService,useValue:{game:()=>null}}]});
    const audio=TestBed.inject(AudioService);
    audio.setVolume('sfxVolume',0);audio.setVolume('musicVolume',1);
    audio.click(); expect(FakeAudioContext.oscillators).toBe(0);
    audio.startMusic(); vi.advanceTimersByTime(270);
    expect(FakeAudioContext.oscillators).toBe(1);
    audio.toggleSound(); vi.advanceTimersByTime(270);
    expect(FakeAudioContext.oscillators).toBe(1);
    audio.stopMusic();
  });
  it('plays an authoritative contact once and releases the looping crowd source',()=>{
    vi.stubGlobal('AudioContext',FakeAudioContext);FakeAudioContext.oscillators=FakeAudioContext.stopped=0;
    TestBed.configureTestingModule({providers:[{provide:GameStateService,useValue:{game:()=>null}}]});
    const audio=TestBed.inject(AudioService);
    const contact={tick:20,x:30,y:34,z:.11,kind:'foot' as const,foot:'right' as const};
    audio.contact(contact,20);audio.contact(contact,20);
    expect(FakeAudioContext.oscillators).toBe(1);
    audio.startCrowd();const stopped=FakeAudioContext.stopped;
    audio.stopCrowd();expect(FakeAudioContext.stopped).toBe(stopped+1);
    audio.stopCrowd();expect(FakeAudioContext.stopped).toBe(stopped+1);
  });
  it('retains twelve seconds in order and freezes the actual goal crossing before kickoff',()=>{
    const {home,away}=createPracticeTeams();
    const match=new ArcadeMatch(home,away,home.id);
    match.rule.phase='playing';
    const player=match.actors.find(a=>a.player.id===match.selectedPlayerId)!;
    for(const actor of match.actors) actor.active=actor===player;
    Object.assign(match.ball,{ownerId:null,x:80,y:34,z:.11,vx:0,vy:0,vz:0});
    for(let i=0;i<750;i++) match.step(MATCH_TICK,EMPTY_MATCH_COMMAND);
    const ring=new ReplayRing();
    const sample=match.snapshot();
    for(let i=0;i<750;i++) ring.push({...sample,tick:i});
    expect(ring.latest()).toHaveLength(720);
    expect(ring.latest()[0].tick).toBe(30);
    expect(ring.latest().at(-1)!.tick).toBe(749);
    Object.assign(match.ball,{x:104.9,y:34,z:.11,vx:30});
    match.step(MATCH_TICK,EMPTY_MATCH_COMMAND);
    const replay=match.replaySnapshots();
    expect(replay).toHaveLength(360);
    expect(replay.at(-1)!.ball.x).toBeGreaterThan(105.11);
    expect(match.ball.x).toBe(52.5);
    for(let i=1;i<replay.length;i++) expect(replay[i].tick-replay[i-1].tick).toBe(1);
  });
  it('reflects ball contacts together with motion after the team changes sides',()=>{
    const {home,away}=createPracticeTeams();
    const player=new ArcadeMatch(home,away,home.id).snapshot().players[0];
    player.contact={tick:1,x:player.x+.5,y:player.y+.1,z:.11,kind:'foot',foot:'right'};
    const mirrored=playerInCameraSpace(player,-1);
    expect(mirrored.contact!.x-mirrored.x).toBeCloseTo(-.5);
    expect(mirrored.facingX).toBe(-player.facingX);
    expect(playerInCameraSpace(mirrored,-1)).toEqual(player);
  });
});
