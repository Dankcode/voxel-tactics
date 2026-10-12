import { reachable } from '../world/PathSearch.js';
// Keep the first insertion tile stable, then choose nearby connected cells with breathing room.
export function spreadInsertion(store,spawns) {
    const root=spawns[0],search=reachable(store,root,14),out=[];
    for(const preferred of spawns) {
        const candidates=[...search.nodes.values()].filter(c=>Math.abs(c.z-root.z)<=1 && Math.hypot(c.x-root.x,c.y-root.y)<=7);
        candidates.sort((a,b)=>Math.hypot(a.x-preferred.x,a.y-preferred.y)-Math.hypot(b.x-preferred.x,b.y-preferred.y)||a.y-b.y||a.x-b.x);
        const free=c=>out.every(p=>p.x!==c.x||p.y!==c.y||p.z!==c.z);
        const chosen=candidates.find(c=>free(c)&&out.every(p=>Math.hypot(p.x-c.x,p.y-c.y)>=3))||candidates.find(free);
        if(!chosen)throw Error('No free insertion tile for the squad');
        out.push({x:chosen.x,y:chosen.y,z:chosen.z});
    }
    return out;
}
