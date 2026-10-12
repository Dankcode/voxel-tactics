import { castRay } from '../../../shared/voxel/Raycast.js';
import { AIR, MAT, materialById } from '../../../shared/voxel/Materials.js';
/** Interior selection passes through retained walls and windows; floors still obey physical traversal; selecting a destination never reveals enemies. */
export function pickVisibleTile(store,from,to,{cutZ=Infinity,buildingView=null}={}) {
    const hidden=(x,y,z)=>(buildingView?.pickHiddenAt?.(x,y,z)??buildingView?.hiddenAt(x,y,z))||false;
    const r=castRay(store,from,to,{skipStart:false,blocks:(s,x,y,z)=>z<cutZ&&!hidden(x,y,z)&&s.get(x,y,z)!==AIR&&s.get(x,y,z)!==MAT.glass&&materialById(s.get(x,y,z)).render!=='none'});
    if(!r.hit)return null;
    const v=r.hit;let cx=v.x,cy=v.y;
    if(r.normal&&(r.normal[0]||r.normal[1])){cx+=r.normal[0];cy+=r.normal[1];}
    const surface=(x,y)=>store.surfaces(x,y).filter(s=>s.z<=v.z&&s.z<cutZ&&!hidden(x,y,s.z)).at(-1);
    const surf=surface(cx,cy)||surface(v.x,v.y);
    const cell=surf?{x:surf.x,y:surf.y,z:surf.z}:null;
    return {cell,voxel:v,point:r.point,normal:r.normal};
}
