import { castRay } from '../../../shared/voxel/Raycast.js';
import { AIR, MAT, materialById } from '../../../shared/voxel/Materials.js';
/** Interior selection passes through retained walls and windows; floors still obey physical traversal; selecting a destination never reveals enemies. */
export function pickVisibleTile(store,from,to,{cutZ=Infinity,buildingView=null,preferredFloor=null,reachable=null,origin=null}={}) {
    const hidden=(x,y,z)=>(buildingView?.pickHiddenAt?.(x,y,z)??buildingView?.hiddenAt(x,y,z))||false;
    // Pick the chosen floor directly, rather than a wall/furniture side that redirects the click outside.
    if(Number.isFinite(preferredFloor)&&from.h!==to.h) {
        const t=(preferredFloor+1.001-from.h)/(to.h-from.h);
        if(t>=0&&t<=1) {
            const px=from.x+(to.x-from.x)*t,py=from.y+(to.y-from.y)*t;
            let x=Math.floor(px),y=Math.floor(py);
            const axis=store.windowOpenings?.get(`${x},${y},${preferredFloor}`);
            if(axis&&origin){if(axis==='x')x+=origin.x<x?1:-1;else y+=origin.y<y?1:-1;}
            const surface=store.surfaces(x,y).find(s=>s.z===preferredFloor&&s.headroom>=2);
            if(surface&&!hidden(x,y,preferredFloor)&&(!reachable||reachable.has(`${x},${y},${preferredFloor}`)))
                return {cell:{x,y,z:preferredFloor},voxel:{x,y,z:preferredFloor},point:{x:px,y:py,h:preferredFloor+1},normal:[0,0,1]};
        }
    }
    const r=castRay(store,from,to,{skipStart:false,blocks:(s,x,y,z)=>z<cutZ&&!hidden(x,y,z)&&s.get(x,y,z)!==AIR&&s.get(x,y,z)!==MAT.glass&&materialById(s.get(x,y,z)).render!=='none'});
    if(!r.hit)return null;
    const v=r.hit;let cx=v.x,cy=v.y;
    if(r.normal&&(r.normal[0]||r.normal[1])){cx+=r.normal[0];cy+=r.normal[1];}
    const surface=(x,y)=>store.surfaces(x,y).filter(s=>s.z<=v.z&&s.z<cutZ&&!hidden(x,y,s.z)).at(-1);
    const surf=surface(cx,cy)||surface(v.x,v.y);
    const cell=surf?{x:surf.x,y:surf.y,z:surf.z}:null;
    if(Number.isFinite(preferredFloor)&&cell?.z!==preferredFloor)return null;
    return {cell,voxel:v,point:r.point,normal:r.normal};
}
