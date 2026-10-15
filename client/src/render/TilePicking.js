import { castRay } from '../../../shared/voxel/Raycast.js';
import { AIR, MAT, materialById } from '../../../shared/voxel/Materials.js';
/** Interior selection passes through retained walls and windows; floors still obey physical traversal; selecting a destination never reveals enemies. */
export function pickVisibleTile(store,from,to,{cutZ=Infinity,buildingView=null,preferredFloor=null,reachable=null,origin=null}={}) {
    const hidden=(x,y,z)=>(buildingView?.pickHiddenAt?.(x,y,z)??buildingView?.hiddenAt(x,y,z))||false;
    const r=castRay(store,from,to,{skipStart:false,blocks:(s,x,y,z)=>z<cutZ&&!hidden(x,y,z)&&s.get(x,y,z)!==AIR&&s.get(x,y,z)!==MAT.glass&&materialById(s.get(x,y,z)).render!=='none'});
    // Intermediate terrain belongs to the displayed floor band. Prefer its visible top to the
    // nominal floor plane behind it, so ramps and stairs remain selectable at an oblique angle.
    if(Number.isFinite(preferredFloor)&&r.hit&&r.normal?.[2]===1&&r.hit.z>preferredFloor) {
        const v=r.hit,surface=store.surfaces(v.x,v.y).find(s=>s.z===v.z&&s.headroom>=2);
        if(surface&&(!reachable||reachable.has(`${v.x},${v.y},${v.z}`)))
            return {cell:{x:v.x,y:v.y,z:v.z},voxel:v,point:r.point,normal:r.normal};
    }
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
    if(!r.hit)return null;
    const v=r.hit;let cx=v.x,cy=v.y;
    if(r.normal&&(r.normal[0]||r.normal[1])){cx+=r.normal[0];cy+=r.normal[1];}
    const surface=(x,y)=>store.surfaces(x,y).filter(s=>s.z<=v.z&&s.z<cutZ&&!hidden(x,y,s.z)).at(-1);
    const surf=surface(cx,cy)||surface(v.x,v.y);
    const cell=surf?{x:surf.x,y:surf.y,z:surf.z}:null;
    if(Number.isFinite(preferredFloor)&&(!cell||cell.z<preferredFloor))return null;
    return {cell,voxel:v,point:r.point,normal:r.normal};
}

/**
 * Move picking that does not depend on the elevation cut: walk the whole pick ray (through roofs, walls and floors,
 * nothing blocks) and return the first standable node in `reachable` whose floor voxel the ray passes, i.e. the
 * highest reachable floor under the cursor. Used when the ordinary visible pick is not a tile the unit can move to,
 * so a roof or wall under the cursor no longer stops a move to the floor inside; the elevation cut only helps browse.
 * `reachable` is a Set/Map of "x,y,z" node keys; cells at or above `cutZ` are skipped.
 */
export function pickReachableAlongRay(store, from, to, reachable, { cutZ = Infinity } = {}) {
    if (!reachable?.size) return null;
    let found = null;
    const take = (x, y, z, t) => {
        if (found || z >= cutZ || !reachable.has(`${x},${y},${z}`)) return;
        found = { cell: { x, y, z }, voxel: { x, y, z }, t };
    };
    // The start cell is not visited by the traversal; test it first.
    take(Math.floor(from.x), Math.floor(from.y), Math.floor(from.h), 0);
    castRay(store, from, to, { blocks: () => false, visit: (x, y, z, t) => take(x, y, z, t) });
    if (!found) return null;
    const len = Math.hypot(to.x - from.x, to.y - from.y, to.h - from.h) || 1, k = found.t / len;
    const { t, ...out } = found;
    return { ...out, point: { x: from.x + (to.x - from.x) * k, y: from.y + (to.y - from.y) * k, h: from.h + (to.h - from.h) * k }, normal: [0, 0, 1], through: true };
}
