// Offline image analysis becomes data. Runtime compilation is deterministic and shares the gameplay voxel matrix.
import { solveLayout } from './LayoutSolver.js';
import { compileBuilding } from './StoreyCompiler.js';
import { checkGeneratedGates } from './Gates.js';
import { createMap } from '../mission/modern/MapKit.js';
import { designSlate } from './DesignSlate.js';
import { SUBURB_PROPS, DOWNTOWN_PROPS, DOCKS_PROPS, FORECOURT_PROPS } from '../mission/PropCatalog.js';
import { reachable, nodeKey, pathTo } from '../world/PathSearch.js';
import { AGENT_PROFILES } from '../world/TraversalRules.js';

export function validateSite(site) {
    const fail = reason => { throw new Error(`Invalid image map: ${reason}`); };
    if (site.name != null && (typeof site.name !== 'string' || site.name.length > 80 || /[<>]/.test(site.name))) fail('plain-text mission name required');
    if (site.theme != null && !['Suburbs','Downtown','Industrial','Roadside'].includes(site.theme)) fail('theme');
    if (![1,2].includes(site.version) || !/^[a-z0-9-]+$/.test(site.id || '')) fail('version/id');
    if (!['day', 'dusk', 'night', 'dawn', 'overcast'].includes(site.timeOfDay)) fail('timeOfDay');
    if (!Array.isArray(site.buildings) || !site.buildings.length) fail('buildings required');
    const box = b => Array.isArray(b) && b.length === 4 && b.every(n => Number.isFinite(n) && n >= 0 && n <= 1) && b[2] > b[0] && b[3] > b[1];
    if(site.version===2&&(!site.frame||![site.frame.width,site.frame.height].every(n=>Number.isFinite(n)&&n>0)))fail('frame: source extents required');
    const ids = new Set();
    for (const b of site.buildings) {
        if (typeof b.id !== 'string' || !/^[a-z0-9-]+$/.test(b.id) || ids.has(b.id) || !box(b.bounds) || !['house','shop','office','warehouse','diner','garage'].includes(b.program) || !['n','s','e','w'].includes(b.front)) fail('building footprint/program/front/id');
        ids.add(b.id);
        if (b.storeys != null && (!Number.isInteger(b.storeys) || b.storeys < 1 || b.storeys > 4)) fail('storeys must be 1–4 before policy clamp');
    }
    for (const s of site.surfaces || []) if (!box(s.bounds) || !['lawn','concrete','paving','asphalt','deck'].includes(s.material)) fail('surface');
    const point = p => Array.isArray(p) && p.length === 2 && p.every(n => Number.isFinite(n) && n > 0 && n < 1);
    if (!point(site.insertion) || site.insertion.some(n=>n<0.06 || n>0.94) || !Array.isArray(site.flow) || site.flow.length < 2 || !site.flow.every(point)) fail('insertion and at least two gameplay flow waypoints required');
    return site;
}

export function buildImageMap(site, { seed = 1, design = null, floorSpecs = [] } = {}) {
    validateSite(site);
    return buildPackagedMap({site,...solveLayout(site,{seed,design,floorSpecs})},{seed});
}

export function buildPackagedMap({site,layout,design,manifest}, { seed = 1 } = {}) {
    validateSite(site);
    const {width,depth,height}=layout;
    const m = createMap({ id: site.id, width, depth, height, seed, datum:layout.datum??4 });
    for(const parcel of layout.parcels)if(parcel.kind==='sidewalk') {
        const [px,py]=parcel.id.split(',').map(Number);m.ground(px*4,py*4,px*4+3,py*4+3,'concrete');
    }
    for(const s of layout.surfaces)m.ground(s.x0,s.y0,s.x0+s.w-1,s.y0+s.d-1,s.material);
    for(const b of layout.buildings)compileBuilding(m,b);
    const flow=layout.flow;
    const [sx,sy] = flow[0];
    m.reserve(sx-2,sy-1,sx+3,sy+1);
    m.line(Math.max(1,sx-3),Math.max(1,sy-2),2,'x','planter');
    // Reserve architecture and escape aprons before placing optional outdoor props.
    for(const b of m.buildings)for(const e of b.exits) {const x=e.side==='w'?e.x-1:e.x+1;if(!m.keep.has(`${x},${e.y+2}`))m.line(x,e.y+2,2,'y','planter');}
    // Boundary cover matters too: the scatter pass excludes edge cells and reserved approach lanes.
    const edge=[];
    for(let y=4;y<depth-2;y+=8) edge.push([1,y],[width-2,y]);
    for(let x=4;x<width-2;x+=8) edge.push([x,1],[x,depth-2]);
    for(const [x,y] of edge) {
        let clear=true;
        for(let dx=-1;dx<=1;dx++)for(let dy=-1;dy<=1;dy++) if(m.keep.has(`${x+dx},${y+dy}`)||m.store.isSolid(x+dx,y+dy,m.G+1))clear=false;
        if(clear)m.line(x,y,1,'x','planter');
    }
    const catalog=({Downtown:DOWNTOWN_PROPS,Industrial:DOCKS_PROPS,Roadside:FORECOURT_PROPS})[site.theme] || SUBURB_PROPS;
    // Trace routes on the placed architecture and fixed props, then reserve them before adding scattered cover.
    const traceFlow = () => {
        const routes = [];
        for (let i = 1; i < flow.length; i++) {
            const start = { x: flow[i-1][0], y: flow[i-1][1], z: m.G };
            const goal = { x: flow[i][0], y: flow[i][1], z: m.G };
            const outdoor = p => m.store.roomAt(p.x,p.y,p.z+1) < 0;
            const search = reachable(m.store,start,Infinity,AGENT_PROFILES.player,{
                vault:false, blocked:p=>!outdoor(p), goal:p=>nodeKey(p)===nodeKey(goal)
            });
            const path = outdoor(start) && outdoor(goal) ? pathTo(search,goal) : [];
            if (!path.length) throw new Error(`Gameplay waypoint ${goal.x},${goal.y} is blocked; no outdoor flow route`);
            routes.push(path);
        }
        return routes;
    };
    for (const route of traceFlow()) for (const {x,y} of route) m.reserve(x,y,x+1,y);
    m.scatter(catalog,{ maxGap:3,targetShare:0.34 });
    const flowRoutes = traceFlow();
    const enemies=design.encounters.flatMap(e=>e.types.map(type=>({type,group:e.group,room:{building:e.building,storey:e.floor,kind:e.room}})));
    const target=design.mission.target,targetRoom=m.ctx.rooms.find(r=>r.buildingId===target.building&&r.storey===target.floor&&r.kind===target.room);
    if(!targetRoom)throw Error('design.objective: target room does not exist');
    const item={room:{building:target.building,storey:target.floor,kind:target.room},label:'Syndicate intelligence'};
    const zone={x0:Math.min(...targetRoom.cells.map(c=>c[0])),y0:Math.min(...targetRoom.cells.map(c=>c[1])),x1:Math.max(...targetRoom.cells.map(c=>c[0])),y1:Math.max(...targetRoom.cells.map(c=>c[1])),z:targetRoom.floorZ,dz:0};
    const kind=design.mission.kind;
    const objective=kind==='recover'?{kind,item,text:'Recover the intelligence from the upper command room.'}:kind==='hold'?{kind,zone,rounds:3,needed:2,text:'Take and hold the command room.'}:kind==='extract'?{kind,zone,needed:3,text:'Reach the upper rendezvous with three soldiers.'}:{kind,text:'Clear the occupied buildings.'};
    const mission=m.finish({ name:design.mission.title, spawns:{ player:[[-1,0],[1,0],[0,0],[-1,1],[1,1],[0,1]].map(([dx,dy])=>({x:sx+dx,y:sy+dy,z:m.G})), enemy:enemies }, objective, meta:{theme:site.theme || 'Suburbs',lighting:site.timeOfDay,timeOfDay:site.timeOfDay,defaultCut:m.G+3,streetDatum:m.G,cutLevels:[m.G,...Array.from({length:4},(_,s)=>m.G+3*(s+1)),Infinity],imageGenerated:true,source:site.source,flow,flowRoutes,briefing:design.mission.briefing,storyBeats:design.beats,congruence:layout.congruence,repairs:layout.repairs,packageId:manifest?.id,concepts:manifest?.concepts||[]} });
    const search=reachable(mission.store,mission.spawns.player[0],Infinity,AGENT_PROFILES.player);
    for (const [x,y] of flow) if (!search.costs.has(nodeKey({x,y,z:m.G}))) throw new Error(`Gameplay waypoint ${x},${y} is blocked; revise image analysis flow`);
    for (const room of mission.rooms.filter(r=>r.gameplay)) if (!room.cells.some(([x,y])=>search.costs.has(nodeKey({x,y,z:room.floorZ})))) throw new Error(`Combat room ${room.buildingId}/${room.kind} is unreachable`);
    checkGeneratedGates(mission,{site,layout,design});
    mission.visual.slate = designSlate(mission);
    return mission;
}

/** Check the seeds offered by the authoring regression before publishing a map to the scenario registry. */
export function validateImageSeeds(site, seeds = [1, 2, 3, 4]) {
    return [...new Set(seeds)].map(seed => {
        const mission = buildImageMap(site, { seed });
        const failures = Object.entries(mission.metrics.gates).filter(([,pass])=>!pass).map(([gate])=>gate);
        if (failures.length) throw new Error(`Map ${site.id} seed ${seed} fails combat design gates: ${failures.join(', ')}`);
        return { seed, metrics: mission.metrics };
    });
}
