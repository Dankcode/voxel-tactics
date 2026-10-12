// Grid-authoritative multi-tile walkers. The IK renderer uses these same contact points.
import { MinHeap } from '../util/MinHeap.js';
import { nodeKey } from '../world/PathSearch.js';
export const WALKERS = Object.freeze({
    wall_strider: { legs:[[-1,-1],[1,-1],[-1,1],[1,1]], height:1.9, color:0x8baf9a },
    siege_weaver: { legs:[[-2,-1],[2,-1],[-2,0],[2,0],[-2,1],[2,1]], height:2.1, color:0xa5846a }
});
export function occupiedCells(u, at=u, store=null) {
    if(WALKERS[u.type]&&store){const stance=wallStance(store,u,at);if(stance)return [{x:at.x,y:at.y,z:at.z},...stance.cells];}
    if(at===u && u.footprint)return u.footprint;
    return [{x:at.x,y:at.y,z:at.z},...(WALKERS[u.type]?.legs||[]).map(([dx,dy])=>({x:at.x+dx,y:at.y+dy,z:at.z}))];
}
function wallStance(store,u,at) {
    // A wall stance rotates the footprint into a vertical plane: every toe owns its wall tile.
    if(WALKERS[u.type].legs.every(([dx,dy])=>[0,-1,1].some(dz=>store.isSolid(at.x+dx,at.y+dy,at.z+dz)&&!store.isSolid(at.x+dx,at.y+dy,at.z+dz+1))))return null;
    for(const [nx,ny] of [[1,0],[-1,0],[0,1],[0,-1]]) {
        const cells=WALKERS[u.type].legs.map(([dx,dy])=>({x:at.x+nx+(ny?dy:0),y:at.y+ny+(nx?dy:0),z:at.z+Math.sign(dx)}));
        if(cells.every(c=>store.inBounds(c.x,c.y,c.z+1)&&store.isSolid(c.x,c.y,c.z+1)))return {cells,contacts:cells.map(c=>({x:c.x+.5-nx*.52,y:c.y+.5-ny*.52,h:c.z+1.25,kind:'wall'}))};
    }
    return null;
}
export function walkerContacts(store,u,at=u) {
    const wall=wallStance(store,u,at);if(wall)return wall.contacts;
    return (WALKERS[u.type]?.legs||[]).map(([dx,dy])=>{
        const x=at.x+dx,y=at.y+dy;
        if(!store.inBounds(x,y,at.z))return null;
        // Prefer a planted foot on nearby ground/roof, including uneven terrain.
        for(const dz of [0,-1,1]) {
            const z=at.z+dz;
            if(store.isSolid(x,y,z)&&!store.isSolid(x,y,z+1))return {x:x+.5,y:y+.5,h:z+1,kind:'floor'};
        }
        // Attach toes to a vertical face, rather than requiring a ladder.
        for(const [ax,ay] of [[0,0],[1,0],[-1,0],[0,1],[0,-1]]) {
            if(store.isSolid(x+ax,y+ay,at.z+1)){
                if(!ax&&!ay)return Math.abs(dx)>=Math.abs(dy)?{x:x+(dx>0?-.02:1.02),y:y+.5,h:at.z+1.25,kind:'wall'}:{x:x+.5,y:y+(dy>0?-.02:1.02),h:at.z+1.25,kind:'wall'};
                return {x:x+.5+ax*.49,y:y+.5+ay*.49,h:at.z+1.25,kind:'wall'};
            }
        }
        return null;
    });
}
export function walkerFits(store,u,at=u,blocked=()=>false) {
    if(!WALKERS[u.type]||!store.inBounds(at.x,at.y,at.z+3))return false;
    if([1,2,3].some(h=>store.isSolid(at.x,at.y,at.z+h)))return false;
    const cells=occupiedCells(u,at,store);
    if(cells.some(c=>!store.inBounds(c.x,c.y,c.z)||blocked(c)))return false;
    const contacts=walkerContacts(store,u,at);
    if(!wallStance(store,u,at)&&cells.slice(1).some(c=>store.isSolid(c.x,c.y,c.z+1)))return false;
    // Every leg requires a real terrain contact. No floating or unsupported destinations.
    return contacts.every(Boolean);
}
export function walkerReach(b,u,budget) {
    const costs=new Map(),parents=new Map(),nodes=new Map(),heap=new MinHeap();
    const blocked=c=>{const o=b.occupant(c.x,c.y,c.z);return o&&o.id!==u.id;};
    if(!walkerFits(b.store,u,u,blocked))return {costs,parents,nodes};
    const root=nodeKey(u),start={x:u.x,y:u.y,z:u.z};costs.set(root,0);nodes.set(root,start);heap.push(start,0);
    while(heap.size){
        const {value:from,priority}=heap.pop(),key=nodeKey(from);if(priority!==costs.get(key))continue;
        for(const [dx,dy] of [[0,0],[1,0],[-1,0],[0,1],[0,-1],[2,0],[-2,0],[0,2],[0,-2]])for(const dz of [-2,-1,0,1,2]) {
            if(!dx&&!dy&&!dz)continue;
            if(Math.abs(dz)===2&&Math.abs(dx)+Math.abs(dy)!==2)continue;
            if(Math.abs(dx)+Math.abs(dy)===2&&!dz)continue;
            const to={x:from.x+dx,y:from.y+dy,z:from.z+dz},k=nodeKey(to),next=priority+Math.abs(dx)+Math.abs(dy)+Math.abs(dz)*1.5;
            if(next>budget||next>=(costs.get(k)??Infinity)||!walkerFits(b.store,u,to,blocked))continue;
            // Sweep the body when simultaneously moving up and across a ledge.
            const high=Math.max(from.z,to.z);
            const sweep=[from,to];if(Math.abs(dx)+Math.abs(dy)===2)sweep.push({x:from.x+Math.sign(dx),y:from.y+Math.sign(dy)});
            if(sweep.some(p=>[1,2,3].some(h=>b.store.isSolid(p.x,p.y,high+h))))continue;
            if(sweep.some(p=>occupiedCells(u,{x:p.x,y:p.y,z:high},b.store).some(blocked)))continue;
            costs.set(k,next);parents.set(k,key);nodes.set(k,to);heap.push(to,next);
        }
    }
    return {costs,parents,nodes};
}
export function fitWalkerSpawn(b,u) {
    const blocked=c=>{const o=b.occupant(c.x,c.y,c.z);return o&&o.id!==u.id;};
    if(walkerFits(b.store,u,u,blocked))return;
    const candidates=[];
    for(let dy=-10;dy<=10;dy++)for(let dx=-10;dx<=10;dx++)for(const s of b.store.surfaces(u.x+dx,u.y+dy)) {
        const p={x:u.x+dx,y:u.y+dy,z:s.z};if(walkerFits(b.store,u,p,blocked))candidates.push(p);
    }
    candidates.sort((a,c)=>(Math.abs(a.x-u.x)+Math.abs(a.y-u.y)+Math.abs(a.z-u.z))-(Math.abs(c.x-u.x)+Math.abs(c.y-u.y)+Math.abs(c.z-u.z))||a.z-c.z||a.y-c.y||a.x-c.x);
    if(!candidates.length)throw Error(`No valid multi-tile spawn for ${u.type}`);
    Object.assign(u,candidates[0]);
}
