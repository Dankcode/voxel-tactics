import { MAT } from '../../../shared/voxel/Materials.js';
const WALLS=new Set([MAT.stone,MAT.plaster,MAT.timber,MAT.stucco,MAT.brick,MAT.concrete_wall,MAT.siding,MAT.city_wall,MAT.glass]);
export const BUILDING_VIEWS=['auto','interiors','exterior'];
/** Local presentation only: never change collision voxels, discovery or authoritative state. */
export class BuildingView {
    constructor(mission) {
        this.store=mission.store;this.buildings=mission.buildings||[];this.active=new Map();this.byCell=new Map();
        for(const b of this.buildings)for(let y=b.y0;y<b.y0+b.d;y++)for(let x=b.x0;x<b.x0+b.w;x++)this.byCell.set(`${x},${y}`,b);
    }
    buildingAt(x,y){return this.byCell.get(`${Math.floor(x)},${Math.floor(y)}`)||null;}
    update({unit,units=[],cutZ=Infinity,mode='auto',zoomFloor=null}) {
        const next=new Map();
        if(mode!=='exterior'&&zoomFloor!==0)for(const b of this.buildings) {
            const distanceTo=u=>Math.hypot(Math.max(b.x0-u.x,0,u.x-(b.x0+b.w-1)),Math.max(b.y0-u.y,0,u.y-(b.y0+b.d-1)));
            const occupants=[...units,...(unit?[unit]:[])].sort((a,c)=>distanceTo(a)-distanceTo(c));
            const distance=occupants.length?distanceTo(occupants[0]):Infinity;
            if(zoomFloor===null&&mode==='auto'&&distance>(this.active.has(b)?4:2))continue;
            const base=b.baseZ??b.rooms?.[0]?.floorZ??1;
            const observer=unit&&distanceTo(unit)<=4?unit:occupants[0];
            const z=Number.isFinite(cutZ)?cutZ-1:observer?.z??base;
            const maxFloor=mode==='interiors'?Math.max(0,(b.storeys??1)-1):(b.storeys??1);
            const floor=Math.max(0,Math.min(Math.max(0,(b.storeys??1)-1),zoomFloor===null?Math.min(maxFloor,Math.floor((z-base)/3)):zoomFloor-1));
            next.set(b,base+floor*3);
        }
        const changed=next.size!==this.active.size||[...next].some(([b,z])=>this.active.get(b)!==z);
        this.active=next;return changed;
    }
    hiddenAt(x,y,z) {
        x=Math.floor(x);y=Math.floor(y);z=Math.floor(z);
        const b=this.buildingAt(x,y),floor=this.active.get(b);if(floor===undefined)return false;
        if(z>=floor+3)return true; // Roofs, ceilings and upper storeys are removed together.
        return false; // Keep the active storey's walls, partitions and glazing intact.
    }
    pickHiddenAt(x,y,z) {
        if(this.hiddenAt(x,y,z))return true;
        const floor=this.active.get(this.buildingAt(x,y));
        return floor!==undefined&&z>floor&&WALLS.has(this.store.get(x,y,z));
    }
}
