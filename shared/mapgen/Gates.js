import { castRay, blocksSight } from '../voxel/Raycast.js';
import { reachable, nodeKey } from '../world/PathSearch.js';
import { AGENT_PROFILES } from '../world/TraversalRules.js';
import { settleUnsupported } from '../voxel/Destruction.js';
import { footprintIoU } from './SiteSolver.js';

export function checkGeneratedGates(mission,{site,layout,design}) {
    const search=reachable(mission.store,mission.spawns.player[0],Infinity,AGENT_PROFILES.player);
    const stairs=reachable(mission.store,mission.spawns.player[0],Infinity,AGENT_PROFILES.player,{ladders:false,jump:false});
    const escapes=reachable(mission.store,mission.spawns.player[0],Infinity,AGENT_PROFILES.player,{jump:false,blocked:p=>mission.buildings.some(b=>b.stairs.some(r=>r.cells.some(c=>c.x===p.x&&c.y===p.y&&c.z===p.z)))});
    const reaches=(r,s=search)=>r?.cells.some(([x,y])=>s.costs.has(nodeKey({x,y,z:r.floorZ})));
    const room=(p)=>mission.rooms.find(r=>r.buildingId===p.building&&r.storey===p.floor&&r.kind===p.room);
    const stability=settleUnsupported(mission.store.clone());
    const checks={
        initialSupport:stability.removed===0,
        spawnConnectivity:mission.spawns.player.every(p=>search.costs.has(nodeKey(p))&&stairs.costs.has(nodeKey(p))),
        escapeLandings:mission.buildings.every(b=>b.escapes.every(e=>escapes.costs.has(nodeKey(e.landing)))),
        roofsReachable:mission.buildings.every(b=>search.costs.has(nodeKey({x:b.x0+1,y:b.y0+1,z:b.top}))),
        facadeAttachment:mission.buildings.every(b=>b.escapes.every(e=>mission.store.isSolid(b.x0+b.w-1,e.landing.y,e.landing.z))),
        buildingCount:mission.buildings.length===site.buildings.length,
        footprintOverlap:mission.buildings.every(b=>footprintIoU(layout.reference.find(r=>r.id===b.id),b)>=0.85),
        storeys:mission.buildings.every(b=>b.storeys===layout.buildings.find(r=>r.id===b.id).storeys&&b.storeys>=1&&b.storeys<=4),
        floorsReachable:mission.rooms.filter(r=>r.gameplay).every(r=>reaches(r)&&reaches(r,stairs)),
        secondEscape:mission.buildings.filter(b=>b.storeys>=3).every(b=>Array.from({length:b.storeys-1},(_,i)=>mission.rooms.find(r=>r.buildingId===b.id&&r.storey===i+1&&r.kind==='hall')).every(r=>reaches(r,escapes))),
        closedRooms:mission.rooms.filter(r=>!r.gameplay).every(r=>!reaches(r)),
        storyBeats:design.beats.every(p=>reaches(room(p))),
        objectiveReachable:reaches(room(design.mission.target)),
        windowLines:mission.buildings.every(b=>Array.from({length:b.storeys},(_,s)=>b.windows.some(w=>w.storey===s)).every(Boolean)),
        firstContact:mission.metrics.firstContact>=12,
        heightBudget:mission.store.height<=18&&mission.store.width<=64&&mission.store.depth<=64,
        enemiesReachable:mission.spawns.enemy.length===design.encounters.reduce((n,e)=>n+e.types.length,0)+(mission.meta.underground?1:0)&&mission.spawns.enemy.every(e=>search.costs.has(nodeKey(e.pos)))
    };
    if(mission.meta.underground)Object.assign(checks,checkLayerGates(mission));
    mission.metrics.gates={...mission.metrics.gates,...checks};
    mission.metrics.pass=Object.values(mission.metrics.gates).every(Boolean);
    const failures=Object.entries(checks).filter(([,ok])=>!ok).map(([name])=>name);
    if(failures.length)throw Error(`mapgen.gates: ${mission.id}: ${failures.join(', ')} ${JSON.stringify(mission.metrics.flank)} ${mission.rooms.filter(r=>r.kind==='hall').map(r=>`${r.buildingId}:${r.storey}:${reaches(r,escapes)}`).join(' ')}`);
    return checks;
}

export function checkLayerGates(mission) {
 const {store,meta,spawns}=mission,u=meta.underground;
 const start=spawns.player[0],entrances=u.openings.filter(e=>e.kind!=='jump'),end=entrances.at(-1);
 const search=reachable(store,start,Infinity,AGENT_PROFILES.player),direct=reachable(store,start,Infinity,AGENT_PROFILES.player,{blocked:p=>p.z<4}).costs.get(nodeKey(end.from));
 const below=reachable(store,entrances[0].to,Infinity,AGENT_PROFILES.player,{blocked:p=>p.z>1});
 const tunnelCost=below.costs.get(nodeKey(end.to)),approach=search.costs.get(nodeKey(entrances[0].to));
 const cost=approach+tunnelCost+4.5;
 mission.metrics.flank={cost,direct,tunnelCost,approach,ratio:cost/direct};
 const sees=(e,p)=>Math.hypot(e.pos.x-p.x,e.pos.y-p.y)<24&&!castRay(store,{x:e.pos.x+.5,y:e.pos.y+.5,h:e.pos.z+2.5},{x:p.x+.5,y:p.y+.5,h:p.z+2},{blocks:blocksSight}).hit;
 const hidden=u.route.filter(p=>!spawns.enemy.some(e=>sees(e,p))).length/u.route.length;
 const drops=u.openings.filter(e=>e.kind==='jump');
 return {layerConnectivity:u.cells.every(p=>search.costs.has(nodeKey(p))),twoEntrances:entrances.length>=2&&entrances.every(e=>search.costs.has(nodeKey(e.to))&&search.costs.has(nodeKey(e.from))),
  flankLength:Number.isFinite(cost)&&cost<=direct*1.6,flankHidden:hidden>.5,
  dropSafe:drops.every(d=>!spawns.enemy.some(e=>sees(e,d.from))),flankGuard:spawns.enemy.some(e=>e.pos.z<4&&u.route.some(p=>Math.hypot(e.pos.x-p.x,e.pos.y-p.y)<=3))};
}
