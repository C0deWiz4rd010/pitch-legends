import { MatchSnapshot } from '../../models/match.model';

/** Twelve seconds at the simulation rate. Rendering never changes these samples. */
export class ReplayRing {
  private readonly frames: (MatchSnapshot | undefined)[];
  private cursor=0;
  private count=0;
  constructor(readonly capacity=720) { this.frames=new Array(capacity); }
  push(frame:MatchSnapshot):void {
    this.frames[this.cursor]=frame;
    this.cursor=(this.cursor+1)%this.capacity;
    this.count=Math.min(this.capacity,this.count+1);
  }
  /** Reuses the frame object that is about to be overwritten. */
  record(write:(reuse:MatchSnapshot|undefined)=>MatchSnapshot):void {
    this.push(write(this.frames[this.cursor]));
  }
  latest(count=this.count):MatchSnapshot[] {
    const length=Math.min(this.count,Math.max(0,count));
    return Array.from({length},(_,i)=>this.frames[(this.cursor-length+i+this.capacity)%this.capacity]!);
  }
  clear():void { this.frames.fill(undefined); this.cursor=this.count=0; }
}
