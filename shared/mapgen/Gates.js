import { MAT } from '../voxel/Materials.js';
import { measureMission } from '../mission/MissionMetrics.js';
import { castRay, blocksSight } from '../voxel/Raycast.js';
import { reachable, nodeKey } from '../world/PathSearch.js';
import { AGENT_PROFILES } from '../world/TraversalRules.js';
import { settleUnsupported } from '../voxel/Destruction.js';
import { footprintIoU } from './SiteSolver.js';
import { checkAccess } from './AccessModules.js';

/** Throwing form, used when a package is installed or a battle starts: every gate must pass. */
export function checkGeneratedGates(mission,ctx) {
    const checks=evaluateGeneratedGates(mission,ctx);
    const failures=Object.entries(checks).filter(([,ok])=>!ok).map(([name])=>name);
    if(failures.length)throw Error(`mapgen.gates: ${mission.id}: ${failures.join(', ')} ${JSON.stringify(mission.metrics.flank||{})} ${mission.rooms.filter(r=>r.kind==='hall').map(r=>`${r.buildingId}:${r.storey}:${mission.metrics.hallEscapes?.[`${r.buildingId}:${r.storey}`]}`).join(' ')}`);
    return checks;
}

/** Evaluate the generated-map gates (and merge them into mission.metrics) without throwing; the repair loop reads them. */
export function evaluateGeneratedGates(mission,{site,layout,design}) {
    const search=reachable(mission.store,mission.spawns.player[0],Infinity,AGENT_PROFILES.player);
    const stairs=reachable(mission.store,mission.spawns.player[0],Infinity,AGENT_PROFILES.player,{ladders:false,jump:false});
    const escapes=reachable(mission.store,mission.spawns.player[0],Infinity,AGENT_PROFILES.player,{jump:false,blocked:p=>mission.buildings.some(b=>b.stairs.some(r=>r.cells.some(c=>c.x===p.x&&c.y===p.y&&c.z===p.z)))});
    const reaches=(r,s=search)=>r?.cells.some(([x,y])=>s.costs.has(nodeKey({x,y,z:r.floorZ})));
    const room=(p)=>mission.rooms.find(r=>r.buildingId===p.building&&r.storey===p.floor&&r.name===p.room)||mission.rooms.find(r=>r.buildingId===p.building&&r.storey===p.floor&&r.kind===p.room);
    const stability=settleUnsupported(mission.store.clone());
    const checks={
        initialSupport:stability.removed===0,
        spawnConnectivity:mission.spawns.player.every(p=>search.costs.has(nodeKey(p))&&stairs.costs.has(nodeKey(p))),
        escapeLandings:mission.buildings.every(b=>b.escapes.every(e=>escapes.costs.has(nodeKey(e.landing)))),
        roofsReachable:mission.buildings.every(b=>search.costs.has(nodeKey({x:b.x0+1,y:b.y0+1,z:b.top}))),
        ...checkAccess(mission),
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
    if(layout?.version===3)Object.assign(checks,checkV3Gates(mission,layout));
    mission.metrics.hallEscapes=Object.fromEntries(mission.rooms.filter(r=>r.kind==='hall').map(r=>[`${r.buildingId}:${r.storey}`,!!reaches(r,escapes)]));
    mission.metrics.gates={...mission.metrics.gates,...checks};
    mission.metrics.pass=Object.values(mission.metrics.gates).every(Boolean);
    return {...mission.metrics.gates};
}

/**
 * PLAN-04 gates: the map edge is closed (world pieces or buildings on every border cell that is not a road exit),
 * engagement pockets sit along the line of play, and every flank route is still walkable on the compiled matrix.
 */
export function checkV3Gates(mission,layout) {
    const {store}=mission,G=mission.meta.streetDatum,W=store.width,D=store.depth;
    let open=0,border=0;
    for(let x=0;x<W;x++)for(const y of [0,D-1]){border++;if(!store.isSolid(x,y,G+1)&&!mission.buildings.some(b=>x>=b.x0&&x<b.x0+b.w&&y>=b.y0&&y<b.y0+b.d))open++;}
    for(let y=1;y<D-1;y++)for(const x of [0,W-1]){border++;if(!store.isSolid(x,y,G+1)&&!mission.buildings.some(b=>x>=b.x0&&x<b.x0+b.w&&y>=b.y0&&y<b.y0+b.d))open++;}
    const search=reachable(store,mission.spawns.player[0],Infinity,AGENT_PROFILES.player);
    const flanks=(layout.lineOfPlay?.flanks||[]).filter(f=>f.path.length);
    const walkable=f=>f.path.filter(([x,y])=>search.costs.has(nodeKey({x,y,z:G}))).length/f.path.length;
    return {worldEdges:open/border<=0.02,pockets:(layout.pockets||[]).length>=2,flanksWalkable:flanks.length>=1&&flanks.every(f=>walkable(f)>=0.95)};
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

/** Close optional street drops exposed to a starting pod; stairs/manholes remain usable. */
export function secureStreetDrops(mission) {
    const u=mission.meta.underground;if(!u)return;
    const unsafe=u.openings.filter(d=>d.kind==='jump'&&mission.spawns.enemy.some(e=>Math.hypot(e.pos.x-d.from.x,e.pos.y-d.from.y)<24&&!castRay(mission.store,{x:e.pos.x+.5,y:e.pos.y+.5,h:e.pos.z+2.5},{x:d.from.x+.5,y:d.from.y+.5,h:d.from.z+2},{blocks:blocksSight}).hit));
    if(!unsafe.length)return;
    for(const d of unsafe)mission.store.set(d.to.x,d.to.y,d.from.z,MAT.concrete);
    u.openings=u.openings.filter(d=>!unsafe.includes(d));
    mission.meta.repairs=[...(mission.meta.repairs||[]),...unsafe.map(d=>({kind:'close-exposed-drop',at:{...d.to}}))];
    mission.metrics={...mission.metrics,...measureMission(mission)};
}
