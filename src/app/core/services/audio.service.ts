import { Injectable, computed, effect, inject, signal } from '@angular/core';
import { GameStateService } from './game-state.service';
import { defaultSettings } from '../../models/game.model';
import { FootballContact, MatchEvent } from '../../models/match.model';

type Channel = 'musicVolume' | 'sfxVolume' | 'crowdVolume';

/** Original, locally synthesized football audio with independent mixer channels. */
@Injectable({ providedIn: 'root' })
export class AudioService {
  private readonly gs=inject(GameStateService);
  private readonly standalone=signal(defaultSettings());
  readonly settings=computed(()=>this.gs.game()?.settings ?? this.standalone());
  private context:AudioContext|null=null;
  private musicTimer:ReturnType<typeof setInterval>|null=null;
  private musicStep=0;
  private crowd: {source:AudioBufferSourceNode; filter:BiquadFilterNode; gain:GainNode}|null=null;
  private intensity=.12;
  private lastContactTick=-1;
  private noiseBuffer:AudioBuffer|null=null;

  constructor() { effect(()=>{this.settings();this.updateCrowdGain();}); }
  setVolume(channel:Channel, value:number):void {
    const level=Number.isFinite(value)?Math.max(0,Math.min(1,value)):0;
    if(this.gs.game()) this.gs.mutate(game=>{game.settings[channel]=level;});
    else this.standalone.update(settings=>({...settings,[channel]:level}));
    this.updateCrowdGain();
  }
  toggleSound():void {
    if(this.gs.game()) this.gs.mutate(game=>{game.settings.soundEnabled=!game.settings.soundEnabled;});
    else this.standalone.update(settings=>({...settings,soundEnabled:!settings.soundEnabled}));
    this.updateCrowdGain();
  }
  click():void { this.tone(320,.035,'sine',.12,460); }
  whistle():void { this.tone(2200,.22,'sine',.10,2700); this.tone(2450,.19,'sine',.035,2300); }
  goal():void {
    this.setCrowdIntensity(1);
    this.noise(.35,.25,700);
    [392,523,659].forEach((frequency,index)=>this.tone(frequency,.3,'triangle',.075,frequency,'sfxVolume',index*.09));
  }
  error():void {this.tone(150,.16,'sawtooth',.10,90);}
  contact(contact:FootballContact, speed:number):void {
    if(contact.tick<=this.lastContactTick) return;
    this.lastContactTick=contact.tick;
    const strength=Math.min(1,Math.max(.1,speed/30));
    this.tone(contact.kind==='head'?115:contact.kind==='hand'?90:150,.045+strength*.055,'sine',.10+strength*.18,45);
    this.noise(.035+strength*.04,.04+strength*.08,contact.kind==='hand'?1300:600);
  }
  resetContacts():void {this.lastContactTick=-1;}
  post():void {this.tone(740,.22,'triangle',.16,710);this.tone(1170,.15,'sine',.045,1100);}
  matchEvent(event:MatchEvent):void {
    if(event.type==='goal') this.goal();
    else if(event.type==='foul'||event.type==='yellow'||event.type==='red') this.whistle();
    else if(event.type==='save') {this.noise(.12,.12,1200);this.setCrowdIntensity(.7);}
    else if(event.messageKey==='match.post') this.post();
  }
  startMusic():void {
    if(this.musicTimer) return;
    const bass=[98,98,131,147,98,165,147,131];
    this.musicTimer=setInterval(()=>{const note=bass[this.musicStep++%bass.length];this.tone(note,.14,'triangle',.07,note*.99,'musicVolume');},260);
  }
  stopMusic():void {if(this.musicTimer) clearInterval(this.musicTimer);this.musicTimer=null;}
  startCrowd():void {
    if(this.crowd) return;
    const ctx=this.audioContext();if(!ctx) return;
    const source=ctx.createBufferSource(),filter=ctx.createBiquadFilter(),gain=ctx.createGain();
    source.buffer=this.getNoise(ctx);source.loop=true;
    filter.type='bandpass';filter.frequency.value=650;filter.Q.value=.55;
    gain.gain.value=0;
    source.connect(filter).connect(gain).connect(ctx.destination);source.start();
    this.crowd={source,filter,gain};this.updateCrowdGain();
  }
  stopCrowd():void {
    if(!this.crowd) return;
    this.crowd.source.stop();this.crowd.source.disconnect();this.crowd.filter.disconnect();this.crowd.gain.disconnect();this.crowd=null;
  }
  setCrowdIntensity(value:number):void {this.intensity=Math.max(.08,Math.min(1,value));this.updateCrowdGain();}
  private level(channel:Channel):number {
    const settings=this.settings();
    return settings.soundEnabled?Math.max(0,Math.min(1,settings[channel]??.45)):0;
  }
  private updateCrowdGain():void {
    if(!this.crowd||!this.context) return;
    this.crowd.gain.gain.setTargetAtTime(this.level('crowdVolume')*(.09+this.intensity*.32),this.context.currentTime,.18);
    this.crowd.filter.frequency.setTargetAtTime(480+this.intensity*650,this.context.currentTime,.3);
  }
  private audioContext():AudioContext|null {
    if(typeof window==='undefined'||!('AudioContext' in window)) return null;
    const context=this.context??=new AudioContext();
    if(context.state==='suspended') void context.resume().catch(()=>undefined);
    return context;
  }
  private getNoise(ctx:AudioContext):AudioBuffer {
    if(this.noiseBuffer) return this.noiseBuffer;
    const buffer=ctx.createBuffer(1,ctx.sampleRate*2,ctx.sampleRate),samples=buffer.getChannelData(0);
    let previous=0;
    for(let i=0;i<samples.length;i++) {previous=(previous+Math.random()*2-1)/1.8;samples[i]=previous;}
    return this.noiseBuffer=buffer;
  }
  private noise(duration:number, volume:number, cutoff:number):void {
    const level=this.level('sfxVolume')*volume;if(level<=0) return;
    const ctx=this.audioContext();if(!ctx) return;
    const source=ctx.createBufferSource(),filter=ctx.createBiquadFilter(),gain=ctx.createGain();
    source.buffer=this.getNoise(ctx);filter.type='lowpass';filter.frequency.value=cutoff;
    gain.gain.setValueAtTime(level,ctx.currentTime);gain.gain.exponentialRampToValueAtTime(.0001,ctx.currentTime+duration);
    source.connect(filter).connect(gain).connect(ctx.destination);source.start();source.stop(ctx.currentTime+duration);
    source.onended=()=>{source.disconnect();filter.disconnect();gain.disconnect();};
  }
  private tone(frequency:number,duration:number,wave:OscillatorType,volume:number,endFrequency=frequency,channel:Channel='sfxVolume',delay=0):void {
    const level=this.level(channel)*volume;if(level<=0) return;
    const ctx=this.audioContext();if(!ctx) return;
    const oscillator=ctx.createOscillator(),gain=ctx.createGain(),start=ctx.currentTime+delay;
    oscillator.type=wave;oscillator.frequency.setValueAtTime(frequency,start);
    oscillator.frequency.exponentialRampToValueAtTime(Math.max(20,endFrequency),start+duration);
    gain.gain.setValueAtTime(.0001,start);gain.gain.linearRampToValueAtTime(level,start+.005);
    gain.gain.exponentialRampToValueAtTime(.0001,start+duration);
    oscillator.connect(gain).connect(ctx.destination);oscillator.start(start);oscillator.stop(start+duration);
    oscillator.onended=()=>{oscillator.disconnect();gain.disconnect();};
  }
}
