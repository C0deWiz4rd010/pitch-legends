let softwareAdapter:boolean|undefined;

/** Query once before creating the real context, whose antialias option is immutable. */
export function usesSoftwareGraphics():boolean {
  if(softwareAdapter!==undefined) return softwareAdapter;
  const canvas=document.createElement('canvas');
  const gl=canvas.getContext('webgl2',{antialias:false,powerPreference:'high-performance'});
  const debug=gl?.getExtension('WEBGL_debug_renderer_info');
  const name=debug?String(gl!.getParameter(debug.UNMASKED_RENDERER_WEBGL)):'';
  softwareAdapter=/swiftshader|llvmpipe|software/i.test(name);
  gl?.getExtension('WEBGL_lose_context')?.loseContext();
  return softwareAdapter;
}
