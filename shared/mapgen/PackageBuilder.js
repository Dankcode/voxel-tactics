// Offline image analysis becomes data. Runtime compilation is deterministic and shares the gameplay voxel matrix.
import { createMap } from '../mission/modern/MapKit.js';
import { designSlate } from './DesignSlate.js';
import { SUBURB_PROPS, DOWNTOWN_PROPS, DOCKS_PROPS, FORECOURT_PROPS } from '../mission/PropCatalog.js';
import { reachable, nodeKey, pathTo } from '../world/PathSearch.js';
import { AGENT_PROFILES } from '../world/TraversalRules.js';

export function validateSite(site) {
    const fail = reason => { throw new Error(`Invalid image map: ${reason}`); };
    if (site.name != null && (typeof site.name !== 'string' || site.name.length > 80 || /[<>]/.test(site.name))) fail('plain-text mission name required');
    if (site.theme != null && !['Suburbs','Downtown','Industrial','Roadside'].includes(site.theme)) fail('theme');
    if (site.version !== 1 || !/^[a-z0-9-]+$/.test(site.id || '')) fail('version/id');
    if (!['day', 'dusk', 'night', 'dawn', 'overcast'].includes(site.timeOfDay)) fail('timeOfDay');
    if (!Array.isArray(site.buildings) || !site.buildings.length || site.buildings.length > 8) fail('1–8 buildings required');
    const box = b => Array.isArray(b) && b.length === 4 && b.every(n => Number.isFinite(n) && n >= 0 && n <= 1) && b[2] > b[0] && b[3] > b[1];
    const ids = new Set();
    for (const b of site.buildings) {
        if (typeof b.id !== 'string' || !/^[a-z0-9-]+$/.test(b.id) || ids.has(b.id) || !box(b.bounds) || !['house','shop','office','warehouse','diner','garage'].includes(b.program) || !['n','s','e','w'].includes(b.front)) fail('building footprint/program/front/id');
        ids.add(b.id);
        if ((b.bounds[2]-b.bounds[0])*48 < 12 || (b.bounds[3]-b.bounds[1])*40 < 11) fail('building too small for connected combat rooms');
        for (const other of site.buildings) if (other !== b && b.bounds[0] < other.bounds[2] && b.bounds[2] > other.bounds[0] && b.bounds[1] < other.bounds[3] && b.bounds[3] > other.bounds[1]) fail('overlapping buildings');
    }
    for (const s of site.surfaces || []) if (!box(s.bounds) || !['lawn','concrete','paving','asphalt','deck'].includes(s.material)) fail('surface');
    const point = p => Array.isArray(p) && p.length === 2 && p.every(n => Number.isFinite(n) && n > 0 && n < 1);
    if (!point(site.insertion) || site.insertion.some(n=>n<0.06 || n>0.94) || !Array.isArray(site.flow) || site.flow.length < 2 || !site.flow.every(point)) fail('insertion and at least two gameplay flow waypoints required');
    return site;
}

export function buildImageMap(site, { seed = 1 } = {}) {
    validateSite(site);
    const width = 48, depth = 40;
    const m = createMap({ id: site.id, width, depth, height: 12, seed });
    const point = p => [Math.round(p[0]*(width-1)), Math.round(p[1]*(depth-1))];
    const rect = b => [...point(b.slice(0,2)), ...point(b.slice(2))];
    for (const surface of site.surfaces || []) m.ground(...rect(surface.bounds), surface.material);
    for (const b of site.buildings) {
        const [x0,y0,x1,y1] = rect(b.bounds);
        m.building({ id: b.id, program: b.program, x0,y0,w:x1-x0+1,d:y1-y0+1,front:b.front });
    }
    const flow = [site.insertion, ...site.flow].map(point);
    const [sx,sy] = flow[0];
    m.reserve(sx-2,sy-1,sx+3,sy+1);
    m.line(Math.max(1,sx-3),Math.max(1,sy-2),2,'x','planter');
    for (const [i,b] of m.buildings.entries()) {
        const e=b.entry;
        m.line(Math.max(1,e.x-3),Math.min(depth-2,e.y+2),2,'x','planter');
        if (b.x0 > 1) m.tree(b.x0-1,b.y0,'conifer');
        const carY=Math.min(depth-4,b.y0+b.d+3);
        m.car(Math.min(width-5,b.x0+4),carY,'x',i%2 ? -1 : 1);
    }
    // Boundary cover matters too: the scatter pass excludes edge cells and reserved approach lanes.
    const edge=[];
    for(let y=4;y<depth-2;y+=8) edge.push([1,y],[width-2,y]);
    for(let x=4;x<width-2;x+=8) edge.push([x,1],[x,depth-2]);
    for(const [x,y] of edge) {
        let clear=true;
        for(let dx=-1;dx<=1;dx++)for(let dy=-1;dy<=1;dy++) if(m.keep.has(`${x+dx},${y+dy}`)||m.store.isSolid(x+dx,y+dy,2))clear=false;
        if(clear)m.line(x,y,1,'x','planter');
    }
    const catalog=({Downtown:DOWNTOWN_PROPS,Industrial:DOCKS_PROPS,Roadside:FORECOURT_PROPS})[site.theme] || SUBURB_PROPS;
    // Trace routes on the placed architecture and fixed props, then reserve them before adding scattered cover.
    const traceFlow = () => {
        const routes = [];
        for (let i = 1; i < flow.length; i++) {
            const start = { x: flow[i-1][0], y: flow[i-1][1], z: 1 };
            const goal = { x: flow[i][0], y: flow[i][1], z: 1 };
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
    const enemies=m.buildings.flatMap((b,i) => b.rooms.filter(r=>r.gameplay && r.storey===0).filter(r=>['living','study','sales','open_office','warehouse','dining','workshop'].includes(r.kind)).slice(0,2).map((r,j)=>({type:j?'archer':'cultist',group:i,room:{building:b.id,kind:r.kind}})));
    const mission=m.finish({ name:site.name || site.id, spawns:{ player:[[-1,0],[1,0],[0,0],[-1,1],[1,1],[0,1]].map(([dx,dy])=>({x:sx+dx,y:sy+dy,z:1})), enemy:enemies }, objective:{kind:'eliminate',text:'Advance through the approach lanes and clear the occupied buildings.'}, meta:{theme:site.theme || 'Suburbs',lighting:site.timeOfDay,timeOfDay:site.timeOfDay,defaultCut:4,imageGenerated:true,source:site.source,flow,flowRoutes} });
    const search=reachable(mission.store,mission.spawns.player[0],Infinity,AGENT_PROFILES.player);
    for (const [x,y] of flow) if (!search.costs.has(nodeKey({x,y,z:1}))) throw new Error(`Gameplay waypoint ${x},${y} is blocked; revise image analysis flow`);
    for (const room of mission.rooms.filter(r=>r.gameplay)) if (!room.cells.some(([x,y])=>search.costs.has(nodeKey({x,y,z:room.floorZ})))) throw new Error(`Combat room ${room.buildingId}/${room.kind} is unreachable`);
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
