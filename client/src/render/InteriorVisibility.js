// Presentation visibility only. Gameplay voxels remain untouched for collision and replay.
export class InteriorVisibility {
    constructor(mission, revealed, enabled = () => true, seen = new Set()) {
        this.rooms = mission.rooms || []; this.revealed = revealed; this.enabled = enabled; this.seen=seen;
        this.byCell = new Map();
        this.roomById=new Map(this.rooms.map(r=>[r.id,{floorZ:r.floorZ,cells:new Set(r.cells.map(([x,y])=>`${x},${y}`))}]));
        const add = (x,y,z,id) => {const k=`${x},${y},${z}`;if(!this.byCell.has(k))this.byCell.set(k,new Set());this.byCell.get(k).add(id);};
        for (const r of this.rooms) for (const [x,y] of r.cells) {
            for(let z=r.floorZ;z<=r.floorZ+2;z++) add(x,y,z,r.id);
            // Interior wall/door cells often have no room tag; retain the exterior shell.
            const b=(mission.buildings||[]).find(b=>b.id===r.buildingId||b.rooms?.some(q=>q.id===r.id));
            if(b)for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
                const nx=x+dx,ny=y+dy;
                if(nx>b.x0&&nx<b.x0+b.w-1&&ny>b.y0&&ny<b.y0+b.d-1)
                    for(let z=r.floorZ+1;z<=r.floorZ+2;z++)add(nx,ny,z,r.id);
            }
        }
    }
    hiddenAt(x,y,z) {
        if(!this.enabled())return false;
        const ids=this.byCell.get(`${Math.floor(x)},${Math.floor(y)},${Math.floor(z)}`);
        if(ids&&[...ids].some(id=>{const r=this.roomById.get(id);const deltas=r.cells.has(`${Math.floor(x)},${Math.floor(y)}`)?[[0,0]]:[[0,0],[1,0],[-1,0],[0,1],[0,-1]];return deltas.some(([dx,dy])=>this.seen.has(`${Math.floor(x)+dx},${Math.floor(y)+dy},${r.floorZ}`));}))return false;
        return !!ids && [...ids].every(id=>!this.revealed.has(id));
    }
    concealedRooms() {return this.enabled()?this.rooms.filter(r=>!this.revealed.has(r.id)):[];}
}
