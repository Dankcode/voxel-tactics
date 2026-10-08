// A continuous liquid/ice skin: world-space UVs, no internal side faces or per-cell colour noise.
import { materialById } from '../../../shared/voxel/Materials.js';
import { liquidFootprint } from '../../../shared/voxel/ConnectedShapes.js';
const WATER = new Set(['water', 'deep_water', 'ice', 'deep_ice']);
/** Water and ice lie this far below the bank top, so shorelines read as banks rather than a raised slab. */
export const SURFACE_DROP = 0.2;
export function emitConnectedWater(store, x, y, z, key, buf, quad, tint, cut = Infinity) {
    const family = key === 'lava' ? new Set(['lava']) : WATER;
    const same=(ax,ay,az)=>az<cut&&family.has(materialById(store.get(ax,ay,az)).key);
    const poly=liquidFootprint(store,x,y,z), top=z+1-(key==='lava'?0.12:SURFACE_DROP), center=[x+.5,y+.5,top];
    // Share depth colour at shoreline vertices, retaining readable shallows without a checkerboard.
    const color=pts=>pts.map(p=>{
        if (key !== 'water' && key !== 'deep_water') return 1;
        let sum=0,count=0;
        for(const ax of [Math.floor(p[0]-1e-6),Math.floor(p[0]+1e-6)])
            for(const ay of [Math.floor(p[1]-1e-6),Math.floor(p[1]+1e-6)]) {
                const k=materialById(store.get(ax,ay,z)).key;
                if(k==='water'||k==='deep_water'){sum+=k==='water'?1:.68;count++;}
            }
        return count?sum/count:1;
    });
    const uv=pts=>pts.map(p=>[p[0]/4,p[1]/4]);
    if (!same(x,y,z+1) && !store.isSolid(x,y,z+1)) {
        for(let i=0;i<poly.length;i++) {
            const p=poly[i],q=poly[(i+1)%poly.length];
            const points=[center,[x+p[0],y+p[1],top],[x+q[0],y+q[1],top]];
            quad(buf,points,[0,0,1],uv(points),color(points),tint);
        }
    }
    for(let i=0;i<poly.length;i++) {
        const p=poly[i],q=poly[(i+1)%poly.length];
        const dx=q[0]-p[0],dy=q[1]-p[1],l=Math.hypot(dx,dy);
        const nx=p[0]===q[0]&&p[0]===0?-1:p[0]===q[0]&&p[0]===1?1:0;
        const ny=p[1]===q[1]&&p[1]===0?-1:p[1]===q[1]&&p[1]===1?1:0;
        if ((nx||ny) && (same(x+nx,y+ny,z)||store.isSolid(x+nx,y+ny,z))) continue;
        const points=[[x+p[0],y+p[1],z],[x+q[0],y+q[1],z],[x+q[0],y+q[1],top],[x+p[0],y+p[1],top]];
        quad(buf,points,[dy/l,-dx/l,0],points.map(a=>[(a[0]+a[1])/4,a[2]/4]),color(points),tint);
    }
}
