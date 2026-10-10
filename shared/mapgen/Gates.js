import { reachable, nodeKey } from '../world/PathSearch.js';
import { AGENT_PROFILES } from '../world/TraversalRules.js';
import { footprintIoU } from './SiteSolver.js';

export function checkGeneratedGates(mission,{site,layout,design}) {
    const search=reachable(mission.store,mission.spawns.player[0],Infinity,AGENT_PROFILES.player);
    const stairs=reachable(mission.store,mission.spawns.player[0],Infinity,AGENT_PROFILES.player,{ladders:false,jump:false});
    const escapes=reachable(mission.store,mission.spawns.player[0],Infinity,AGENT_PROFILES.player,{jump:false,blocked:p=>mission.buildings.some(b=>b.stairs.some(r=>r.cells.some(c=>c.x===p.x&&c.y===p.y&&c.z===p.z)))});
    const reaches=(r,s=search)=>r?.cells.some(([x,y])=>s.costs.has(nodeKey({x,y,z:r.floorZ})));
    const room=(p)=>mission.rooms.find(r=>r.buildingId===p.building&&r.storey===p.floor&&r.kind===p.room);
    const checks={
        buildingCount:mission.buildings.length===site.buildings.length,
        footprintOverlap:mission.buildings.every(b=>footprintIoU(layout.reference.find(r=>r.id===b.id),b)>=0.85),
        storeys:mission.buildings.every(b=>b.storeys===layout.reference.find(r=>r.id===b.id).storeys&&b.storeys>=1&&b.storeys<=4),
        floorsReachable:mission.rooms.filter(r=>r.gameplay).every(r=>reaches(r)&&reaches(r,stairs)),
        secondEscape:mission.buildings.filter(b=>b.storeys>=3).every(b=>Array.from({length:b.storeys-1},(_,i)=>mission.rooms.find(r=>r.buildingId===b.id&&r.storey===i+1&&r.kind==='hall')).every(r=>reaches(r,escapes))),
        closedRooms:mission.rooms.filter(r=>!r.gameplay).every(r=>!reaches(r)),
        storyBeats:design.beats.every(p=>reaches(room(p))),
        objectiveReachable:reaches(room(design.mission.target)),
        windowLines:mission.buildings.every(b=>Array.from({length:b.storeys},(_,s)=>b.windows.some(w=>w.storey===s)).every(Boolean)),
        firstContact:mission.metrics.firstContact>=12,
        heightBudget:mission.store.height<=18&&mission.store.width<=64&&mission.store.depth<=64,
        enemiesReachable:mission.spawns.enemy.length===design.encounters.reduce((n,e)=>n+e.types.length,0)&&mission.spawns.enemy.every(e=>search.costs.has(nodeKey(e.pos)))
    };
    mission.metrics.gates={...mission.metrics.gates,...checks};
    mission.metrics.pass=Object.values(mission.metrics.gates).every(Boolean);
    const failures=Object.entries(checks).filter(([,ok])=>!ok).map(([name])=>name);
    if(failures.length)throw Error(`mapgen.gates: ${mission.id}: ${failures.join(', ')} ${mission.rooms.filter(r=>r.kind==='hall').map(r=>`${r.buildingId}:${r.storey}:${reaches(r,escapes)}`).join(' ')}`);
    return checks;
}
