export interface CameraPosition { x:number; z:number; width:number; }

/** Soft tracking leaves small dribbles inside a stable frame and caps long-pass pans. */
export function advanceBroadcastCamera(current:CameraPosition,target:CameraPosition,dt:number,replay=false):CameraPosition {
  const delta=Math.max(0,Math.min(.05,dt));
  const dead=(value:number,zone:number)=>Math.sign(value)*Math.max(0,Math.abs(value)-zone);
  const dx=dead(target.x-current.x,replay?.8:3.2), dz=dead(target.z-current.z,replay?.6:2.1);
  const blend=1-Math.exp(-(replay?2.2:1.8)*delta);
  const length=Math.hypot(dx,dz);
  const ratio=length>0?Math.min(blend,20*delta/length):0;
  return {x:current.x+dx*ratio,z:current.z+dz*ratio,width:current.width+(target.width-current.width)*(1-Math.exp(-.85*delta))};
}
