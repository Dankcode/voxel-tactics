// Compile a layout v3 (PLAN-04) into a mission: ground, buildings (shell, interiors, facades, access modules),
// underground layers, bay pieces, world edges, spawns, pods, objective — then the gates, the critic and the meta the
// AI reads (pockets, flanks). Pure and deterministic: the same layout and seed give the same matrix on every peer.
import { createMap } from '../mission/modern/MapKit.js';
import { MAT } from '../voxel/Materials.js';
import { compileBuilding } from './StoreyCompiler.js';
import { compileUnderground } from './UndergroundCompiler.js';
import { checkGeneratedGates, evaluateGeneratedGates, secureStreetDrops } from './Gates.js';
import { designSlate } from './DesignSlate.js';
import { decodeGround } from './Generator.js';
import { reachable, nodeKey, pathTo } from '../world/PathSearch.js';
import { AGENT_PROFILES } from '../world/TraversalRules.js';
import { hashString } from '../util/Rng.js';
import { critiqueMission } from './Critic.js';
import { compileTerrainFeatures, surfaceZAt } from './TerrainFeatures.js';

const unit = s => (hashString(s) >>> 0) / 4294967296;

const TREE_BIOME = {
    winter_outpost: ['conifer', 'conifer', 'birch', 'oak'],
    old_quarter: ['cypress', 'ornamental', 'oak', 'birch'],
    arid_compound: ['cypress', 'oak', 'ornamental'],
    harbor: ['conifer', 'cypress', 'oak'],
    suburb: ['oak', 'maple', 'birch', 'ornamental', 'conifer'],
    downtown: ['ornamental', 'maple', 'birch'],
    metro_hub: ['ornamental', 'birch', 'maple'],
    industrial: ['oak', 'birch', 'maple'],
    canal_district: ['cypress', 'birch', 'ornamental', 'oak'],
    hillside_ridge: ['conifer', 'birch', 'oak', 'cypress'],
    sunken_basin: ['oak', 'ornamental', 'maple']
};

/** One bay piece into voxels (+ whole-object hints and decor) at the street datum. */
export function compilePiece(m, p, district = 'commercial', family = 'downtown') {
    if (m.connectorFootprint?.has(`${Math.floor(p.x)},${Math.floor(p.y)}`)) return;
    const G = m.G, s = m.store;
    if (p.base === 'car') { m.car(p.x, p.y, p.axis, unit(`${m.id}:${p.x},${p.y}:car`) < 0.5 ? 1 : -1, null, G); return; }
    if (['truck', 'bus', 'abandoned_car'].includes(p.base)) { m.vehicle(p.base, p.x, p.y, p.axis || 'x', unit(`${m.id}:${p.x},${p.y}:veh`) < 0.5 ? 1 : -1, null, G); return; }
    if (p.base === 'container') { m.container(p.x, p.y, p.axis || 'x', null, G, unit(`${m.id}:${p.x},${p.y}:stack`) < 0.25); return; }
    if (p.base === 'dumpster') { m.dumpster(p.cells[0][0], p.cells[0][1], p.axis, G); return; }
    if (p.base === 'tree') {
        const list = TREE_BIOME[family] || (district === 'residential' || district === 'park' ? TREE_BIOME.suburb : TREE_BIOME.downtown);
        const kind = list[Math.floor(unit(`${m.id}:${p.x},${p.y}:tree`) * list.length) % list.length];
        m.tree(p.cells[0][0], p.cells[0][1], kind, G);
        return;
    }
    if (p.base === 'lamp') return; // Old packages may retain lamps; the curb planner replaces them.
    for (const [x, y, stack] of p.cells) stack.forEach((key, k) => s.set(x, y, G + 1 + k, MAT[key]));
    if (p.base === 'bus_stop') m.decorAt('bus_stop', p.x + 1, p.y + 0.5, { z: G + 1, yaw: 0, free: true });
    if (p.base === 'planter' && unit(`${m.id}:${p.x},${p.y}:flowers`) < 0.4) m.decorAt('flowers', p.cells[0][0], p.cells[0][1], { z: G + 2, free: true });
    if (p.base === 'market_stall') m.decorAt('storefront_awning', p.x + 0.5, p.y + 0.5, { z: G + 1, yaw: 0, free: true });
    if (p.base === 'fountain') m.decorAt('flowers', p.x + 0.5, p.y + 0.5, { z: G + 2, free: true });
}

/** World edges: barricades across off-map roads, neighbouring facades, walls, fences and chain-link. */
export function compileEdges(m, edges) {
    const G = m.G, s = m.store;
    for (const e of edges) {
        const key = { barricade: 'jersey', facade: 'concrete_wall', wall: 'brick', chainlink: 'chainlink', fence: 'privacy_fence' }[e.kind];
        const h = e.kind === 'barricade' ? 1 : e.height || 2;
        e.cells.forEach(([x, y], i) => {
            if (s.isSolid(x, y, G + 1)) return;
            // Yard fences stand on concrete blocks every fourth cell: real cover along an industrial edge.
            const blockAt = e.kind === 'chainlink' && i % 4 === 2;
            for (let k = 1; k <= h; k++) s.set(x, y, G + k, MAT[blockAt && k === 1 ? 'jersey' : key]);
            if (e.kind === 'barricade' && i % 3 === 1) m.decorAt('cordon', x, y, { z: G + 2, yaw: e.side === 'n' || e.side === 's' ? 0 : Math.PI / 2, free: true });
            if (e.kind === 'facade' && i % 4 === 2) {
                const [ox, oy] = { w: [1, 0], e: [-1, 0], n: [0, 1], s: [0, -1] }[e.side];        // the face looks into the map
                m.decorAt(i % 8 === 2 ? 'wall_sign' : 'wall_vent', x + ox * 0.55, y + oy * 0.55, { z: G + 2 + (i % 8 === 2 ? 1 : 0), yaw: Math.atan2(ox, oy), free: true });
            }
        });
    }
}

export function compileV3Map({ site, layout, design, manifest }, { seed = 1, gates = true, evaluateOnly = false } = {}) {
    const { width, depth, height } = layout;
    const m = createMap({ id: site.id, width, depth, height, seed, datum: layout.datum ?? 4, ground: 'concrete' });
    const G = m.G, mats = decodeGround(layout.ground.mat);
    for (let y = 0; y < depth; y++) for (let x = 0; x < width; x++) {
        const material=mats[x+y*width];m.store.set(x,y,G,MAT[material]);
        if(material==='air')for(let z=0;z<G;z++)m.store.set(x,y,z,0);
    }
    m.escapeBlocked = () => false;
    m.lightRoutes=layout.roads||[];
    m.beats = design.beats;
    for (const b of layout.buildings) compileBuilding(m, b);
    // Connect wing buildings to their parent block through a shared double-wall doorway.
    for (const b of layout.buildings) if (b.wingLink) {
        const [mx, my] = b.wingLink.mainCell, [wx, wy] = b.wingLink.wingCell;
        for (const [cx, cy] of [[mx, my], [wx, wy]]) {
            if (!m.store.inBounds(cx, cy, G + 1)) continue;
            for (let h = 1; h <= 2; h++) { m.store.set(cx, cy, G + h, MAT.door); delete m.ctx.hints[`${cx},${cy},${G + h}`]; }
        }
        const dx = Math.sign(wx - mx), dy = Math.sign(wy - my);
        for (const [fx, fy] of [[mx - dx, my - dy], [wx + dx, wy + dy]]) if (m.store.inBounds(fx, fy, G + 1)) {
            const vid = m.store.get(fx, fy, G + 1);
            if (vid && vid !== MAT.stairs_stone && vid !== MAT.stairs_wood && !m.store.material(fx, fy, G + 1).structural) {
                m.store.set(fx, fy, G + 1, 0); delete m.ctx.hints[`${fx},${fy},${G + 1}`];
            }
        }
        m.buildings.find(x => x.id === b.id)?.doors?.push({ x: wx, y: wy, z: G, storey: 0, exterior: false, wingLink: true });
    }
    m.connectorPaths=new Set([...(layout.lineOfPlay?.main||[]),...(layout.lineOfPlay?.flanks||[]).flatMap(f=>f.path)].map(([x,y])=>`${x},${y}`));
    const underground = compileUnderground(m, layout.layers);
    const family = layout.plot?.family || 'downtown';
    const district = (x, y) => layout.plot?.lots?.find(l => l.lx === x >> 3 && l.ly === y >> 3)?.district || 'commercial';
    for (const p of layout.pieces) compilePiece(m, p, district(p.x, p.y), family);
    compileEdges(m, layout.edges || []);
    const terrainMeta = compileTerrainFeatures(m, layout.terrain, layout);
    m.terrainMeta = terrainMeta;
    dressBiomeFeatures(m, layout, mats, family);
    // Street dressing that never blocks: street lights along sidewalks every ~10 cells, drains on the carriageway.
    const ins = layout.insertion, [sx, sy] = [ins.x, ins.y];
    // Visual-only dressing from the authored packages: checkpoint signs either side of the insertion, cable spools
    // inside industrial edges.
    for (const [x, y] of [[sx - 3, sy], [sx + 3, sy]]) if (m.store.inBounds(x, y, G + 1) && mats[x+y*width] !== 'asphalt' && !m.keep.has(`${x},${y}`) && !m.store.isSolid(x, y, G + 1) && !terrainMeta?.dz?.[x + y * width]) m.decorAt('checkpoint_sign', x, y, { z: G + 1 });
    if (layout.plot?.family === 'industrial') {
        const spots = (layout.edges || []).filter(e => e.kind === 'chainlink').flatMap(e => e.cells.filter((_, i) => i % 9 === 4).map(([x, y]) => [x + Math.sign(width / 2 - x) * (x === 0 || x === width - 1), y + Math.sign(depth / 2 - y) * (y === 0 || y === depth - 1)]));
        for (const [x, y] of spots.slice(0, 4)) if (mats[x+y*width] !== 'asphalt' && !m.keep.has(`${x},${y}`) && !m.store.isSolid(x, y, G + 1)) m.decorAt('cable_spool', x, y, { z: G + 1 });
    }
    // Spawns, pods and the objective.
    const enemies = [];
    for (const e of design.encounters) for (const type of e.types) {
        if (e.at) {
            const ez = surfaceZAt(m.store, e.at.x, e.at.y, G);
            enemies.push({ type, group: e.group, at: { x: e.at.x, y: e.at.y, z: ez } });
        } else enemies.push({ type, group: e.group, room: { building: e.building, storey: e.floor, kind: e.room } });
    }
    if (underground) enemies.push({ type: 'cultist', group: 99, pos: underground.guard });

    // Resolve player spawns on vertical pad when flow requests elevated or sunken insertion, keeping safe distance from pods.
    const flowKind = terrainMeta?.flow || 'auto';
    const enemyApprox = design.encounters.map(e => {
        if (e.at) return { x: e.at.x, y: e.at.y };
        const b = layout.buildings.find(q => q.id === e.building);
        return b ? { x: b.x0 + b.w / 2, y: b.y0 + b.d / 2 } : null;
    }).filter(Boolean);
    const padSafe = pad => pad && enemyApprox.every(ep => Math.hypot((pad.x0 + pad.x1) / 2 - ep.x, (pad.y0 + pad.y1) / 2 - ep.y) >= 14);
    const pickPadSpawns = (cx, cy, preferZ, pad = null) => {
        const out = [], seen = new Set();
        const tryCell = (x, y) => {
            const k = `${x},${y}`;
            if (seen.has(k) || !m.store.inBounds(x, y, 2)) return;
            if (layout.buildings.some(b => x >= b.x0 && x < b.x0 + b.w && y >= b.y0 && y < b.y0 + b.d)) return;
            const surfs = m.store.surfaces(x, y).filter(sr => sr.headroom >= 2 && sr.info?.walkable !== false && sr.info?.id !== MAT.water && sr.info?.key !== 'water');
            if (!surfs.length) return;
            const z = preferZ != null ? surfs.reduce((a, b) => (Math.abs(b.z - preferZ) < Math.abs(a.z - preferZ) ? b : a)).z : surfs[0].z;
            seen.add(k);
            out.push({ x, y, z });
        };
        if (pad) {
            for (let y = pad.y0; y <= pad.y1 && out.length < 6; y++) for (let x = pad.x0; x <= pad.x1 && out.length < 6; x++) tryCell(x, y);
        }
        for (const [dx, dy] of [[-1, 0], [1, 0], [0, 0], [-1, 1], [1, 1], [0, 1], [0, -1], [-1, -1], [1, -1]]) {
            if (out.length >= 6) break;
            tryCell(cx + dx, cy + dy);
        }
        for (let r = 2; r <= 5 && out.length < 6; r++) for (let dy = -r; dy <= r && out.length < 6; dy++) for (let dx = -r; dx <= r && out.length < 6; dx++) tryCell(cx + dx, cy + dy);
        return out;
    };
    let playerSpawns = null;
    if ((flowKind === 'high_to_low' || flowKind === 'top_to_bottom') && padSafe(terrainMeta?.highPad)) {
        const pad = terrainMeta.highPad;
        const pts = pickPadSpawns(Math.floor((pad.x0 + pad.x1) / 2), Math.floor((pad.y0 + pad.y1) / 2), pad.z, pad);
        if (pts.length >= 6) playerSpawns = pts;
    } else if ((flowKind === 'low_to_high_to_low' || flowKind === 'bottom_to_top') && padSafe(terrainMeta?.lowerPad)) {
        const pad = terrainMeta.lowerPad;
        const pts = pickPadSpawns(Math.floor((pad.x0 + pad.x1) / 2), Math.floor((pad.y0 + pad.y1) / 2), pad.z, pad);
        if (pts.length >= 6) playerSpawns = pts;
    }
    if (!playerSpawns) playerSpawns = pickPadSpawns(sx, sy, G);
    if (playerSpawns.length < 6) {
        playerSpawns = [[-1, 0], [1, 0], [0, 0], [-1, 1], [1, 1], [0, 1]].map(([dx, dy]) => ({ x: sx + dx, y: sy + dy, z: surfaceZAt(m.store, sx + dx, sy + dy, G) }));
    }
    const spawnAnchor = playerSpawns[0];

    const target = design.mission.target;
    const targetRoom = m.ctx.rooms.find(r => r.buildingId === target.building && r.storey === target.floor && (r.name === target.room || r.kind === target.room));
    if (!targetRoom) throw Error(`design.objective: target room ${target.building}/${target.floor}/${target.room} does not exist`);
    const xs = targetRoom.cells.map(c => c[0]), ys = targetRoom.cells.map(c => c[1]);
    const roomZone = { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys), z: targetRoom.floorZ, dz: 0 };
    const padToZone = pad => pad ? { x0: pad.x0, y0: pad.y0, x1: pad.x1, y1: pad.y1, z: pad.z, dz: 1 } : null;
    const farFromSpawn = z => z && Math.hypot((z.x0 + z.x1) / 2 - spawnAnchor.x, (z.y0 + z.y1) / 2 - spawnAnchor.y) >= 12;
    const lowerZone = padToZone(terrainMeta?.lowerPad);
    const highZone = padToZone(terrainMeta?.highPad);
    let zone = roomZone;
    const kind = design.mission.kind;
    if ((kind === 'extract' || kind === 'hold')) {
        if ((flowKind === 'high_to_low' || flowKind === 'top_to_bottom') && farFromSpawn(lowerZone)) zone = lowerZone;
        else if (flowKind === 'bottom_to_top' && farFromSpawn(highZone)) zone = highZone;
    }
    const item = { room: { building: target.building, storey: target.floor, kind: targetRoom.kind, index: m.ctx.rooms.filter(r => r.buildingId === target.building && r.storey === target.floor && r.kind === targetRoom.kind).indexOf(targetRoom) }, label: 'Syndicate intelligence' };
    const recoverZone = (kind === 'recover' && ['high_to_low', 'low_to_high_to_low', 'top_to_bottom'].includes(flowKind))
        ? (farFromSpawn(lowerZone) ? lowerZone : 'spawn') : null;
    const objective = kind === 'recover'
        ? (recoverZone
            ? { kind, item, zone: recoverZone, text: 'Recover the intelligence from the post, then extract at the lower extraction zone.' }
            : { kind, item, text: design.mission.briefing ? 'Recover the intelligence from the command room.' : 'Recover the intelligence.' })
        : kind === 'hold'
            ? { kind, zone, rounds: 3, needed: 2, text: zone === lowerZone ? 'Push down and hold the lower basin.' : zone === highZone ? 'Capture and hold the elevated crest.' : 'Take and hold the command room.' }
            : kind === 'extract'
                ? { kind, zone, needed: 3, text: zone === lowerZone ? 'Fight downhill to the lower extraction field with three soldiers.' : 'Reach the upper rendezvous with three soldiers.' }
                : { kind, text: 'Clear the Syndicate from the block.' };
    const flow = layout.flow;
    const storeysMax = Math.max(...layout.buildings.map(b => b.storeys));
    const mission = m.finish({
        name: design.mission.title,
        spawns: { player: playerSpawns, enemy: enemies },
        objective,
        meta: {
            theme: site.theme || 'Downtown', lighting: design.mission.timeOfDay || site.timeOfDay, timeOfDay: design.mission.timeOfDay || site.timeOfDay, defaultCut: G + 3, streetDatum: G,
            cutLevels: [G, ...Array.from({ length: storeysMax }, (_, s) => G + 3 * (s + 1)), Infinity], imageGenerated: true, generatorVersion: layout.generatorVersion, underground, source: site.source,
            flow, briefing: design.mission.briefing, storyBeats: design.beats, congruence: layout.congruence, repairs: layout.repairs, packageId: manifest?.id, concepts: manifest?.concepts || [],
            objectiveBuilding: layout.objective?.building, plot: layout.plot ? { family: layout.plot.family, seed: layout.plot.seed, picture: layout.plot.picture } : null,
            terrain: terrainMeta ? { flow: terrainMeta.flow, requestedFlow: terrainMeta.requestedFlow, highPad: terrainMeta.highPad, lowerPad: terrainMeta.lowerPad, featureCount: terrainMeta.features.length } : null,
            parcelAssignments:layout.parcelAssignments||[],roads:layout.roads||[],pockets: layout.pockets || [], lineOfPlay: layout.lineOfPlay, dressing: layout.dressing,
            backdrop: { family: layout.plot?.family, roadExits: (layout.edges || []).filter(e => e.kind === 'barricade').map(e => ({ side: e.side, from: e.cells[0], to: e.cells.at(-1) })) }
        }
    });
    secureStreetDrops(mission);
    // Outdoor flow between the waypoints, traced on the compiled matrix (the slate shows these).
    const routes = [];
    for (let i = 1; i < flow.length; i++) {
        const [x0, y0] = flow[i - 1], [x1, y1] = flow[i];
        const start = { x: x0, y: y0, z: surfaceZAt(mission.store, x0, y0, G) }, goal = { x: x1, y: y1, z: surfaceZAt(mission.store, x1, y1, G) };
        const search = reachable(mission.store, start, Infinity, AGENT_PROFILES.player, { vault: false, blocked: p => mission.store.roomAt(p.x, p.y, p.z + 1) >= 0, goal: p => nodeKey(p) === nodeKey(goal) });
        const path = pathTo(search, goal);
        if (path.length) routes.push(path);
    }
    mission.meta.flowRoutes = routes;
    mission.meta.flanks = (layout.lineOfPlay?.flanks || []).map(f => ({ side: f.side, cells: f.path }));
    if (gates) checkGeneratedGates(mission, { site, layout, design });
    else if (evaluateOnly) evaluateGeneratedGates(mission, { site, layout, design });
    mission.meta.critic = critiqueMission(mission, layout);
    mission.visual.slate = designSlate(mission);
    mission.visual.wear = wearOf(layout);
    return mission;
}

/**
 * Biome-specific architectural setpieces & street props compiled safely after buildings, pieces, and edges:
 * intersections, awnings, harbor canals, alpine frozen ponds & ridges, arid terraces, and downtown/metro skybridges.
 */
function dressBiomeFeatures(m, layout, mats, family) {
    const s = m.store, G = m.G, W = layout.width, D = layout.depth;
    const isClear = (x, y, margin = 0) => {
        for (let dy = -margin; dy <= margin; dy++) for (let dx = -margin; dx <= margin; dx++) {
            const cx = x + dx, cy = y + dy;
            if (!s.inBounds(cx, cy, G + 1)) return false;
            if (m.keep.has(`${cx},${cy}`) || m.connectorPaths?.has(`${cx},${cy}`) || m.connectorFootprint?.has(`${cx},${cy}`)) return false;
            if (m.terrainMeta?.dz?.[cx + cy * W]) return false;
            if (layout.buildings.some(b => cx >= b.x0 - 1 && cx <= b.x0 + b.w && cy >= b.y0 - 1 && cy <= b.y0 + b.d)) return false;
            if (s.isSolid(cx, cy, G + 1) || s.get(cx, cy, G + 1) !== 0) return false;
        }
        return true;
    };
    const isRoadMat = x => ['asphalt', 'cobble', 'road', 'road_mark'].includes(x);
    // 1. Contextual street props (decor only): corner signals/signs at road junctions + awning strips over storefronts.
    for (const lot of layout.plot?.lots || []) {
        if (!lot.road) continue;
        const r = lot.road;
        if ((r.n || r.s) && (r.e || r.w)) {
            const corners = [[lot.x0 + 1, lot.y0 + 1, Math.PI * 0.25], [lot.x0 + 6, lot.y0 + 6, -Math.PI * 0.75]];
            for (const [cx, cy, yaw] of corners) if (isClear(cx, cy) && !isRoadMat(mats[cx + cy * W])) {
                m.decorAt(['downtown', 'metro_hub'].includes(family) ? 'traffic_signal' : 'street_sign', cx, cy, { z: G + 1, yaw, free: true });
                break;
            }
        } else if ((r.e && r.w && !r.n && !r.s && lot.lx % 2 === 1) || (r.n && r.s && !r.e && !r.w && lot.ly % 2 === 1)) {
            const cx = lot.x0 + 1, cy = lot.y0 + 1;
            if (isClear(cx, cy) && !isRoadMat(mats[cx + cy * W])) {
                const kind = ['industrial', 'harbor', 'arid_compound'].includes(family) ? 'utility_pole'
                    : family === 'winter_outpost' ? 'floodlight' : 'stop_sign';
                m.decorAt(kind, cx, cy, { z: G + 1, yaw: 0, free: true });
            }
        }
    }
    for (const b of layout.buildings) if (['shop', 'diner', 'bar', 'corner_store', 'laundromat'].includes(b.program) && !b.wingOf) {
        const door = b.exits?.[0]; if (!door) continue;
        const outv = { n: [0, -1], s: [0, 1], e: [1, 0], w: [-1, 0] }[door.side];
        const yaw = Math.atan2(outv[0], outv[1]);
        const along = door.side === 'n' || door.side === 's' ? [1, 0] : [0, 1];
        for (const k of [-1, 0, 1]) {
            const ax = b.x0 + door.x + along[0] * k + outv[0], ay = b.y0 + door.y + along[1] * k + outv[1];
            if (s.inBounds(ax, ay, G + 2) && !s.isSolid(ax, ay, G + 1) && !s.isSolid(ax, ay, G + 2)) {
                m.decorAt('storefront_awning', ax, ay, { z: G + 1, yaw, free: true });
            }
        }
    }
    // 2. Waterfront canal basins in `harbor` dock lots (wadeable shallow water over solid stone base).
    if (family === 'harbor') {
        let canals = 0;
        for (const lot of layout.plot?.lots || []) if (!lot.road && lot.kind === 'canal_dock' && canals < 2) {
            const cells = [];
            for (let dy = 2; dy <= 5; dy++) for (let dx = 2; dx <= 5; dx++) cells.push([lot.x0 + dx, lot.y0 + dy]);
            if (!cells.every(([x, y]) => isClear(x, y, 0))) continue;
            for (const [x, y] of cells) {
                for (let z = 1; z < G; z++) s.set(x, y, z, MAT.stone);
                s.set(x, y, G, MAT.water);
            }
            canals++;
        }
    }
    // 3. Frozen ponds (`deep_ice` over `deep_water` supported by solid pond banks) in `winter_outpost`.
    if (family === 'winter_outpost') {
        let ponds = 0;
        for (const lot of layout.plot?.lots || []) if (!lot.road && lot.kind === 'frozen_pond' && ponds < 2) {
            const cells = [];
            for (let dy = 3; dy <= 4; dy++) for (let dx = 2; dx <= 5; dx++) cells.push([lot.x0 + dx, lot.y0 + dy]);
            if (!cells.every(([x, y]) => isClear(x, y, 0))) continue;
            // Solid stone collar around the pond guarantees 6-neighbor support for every `deep_ice` tile.
            for (let dy = 2; dy <= 5; dy++) for (let dx = 1; dx <= 6; dx++) {
                if (dy >= 3 && dy <= 4 && dx >= 2 && dx <= 5) continue;
                const rx = lot.x0 + dx, ry = lot.y0 + dy;
                if (s.inBounds(rx, ry, G)) for (let z = 0; z < G; z++) s.set(rx, ry, z, MAT.stone);
            }
            for (const [x, y] of cells) {
                s.set(x, y, 0, MAT.bedrock);
                for (let z = 1; z < G; z++) s.set(x, y, z, MAT.deep_water);
                s.set(x, y, G, MAT.deep_ice);
            }
            ponds++;
        }
    }
    // 4. Low terraced tactical platform (+1 high ground + 2-wide stone stairs) in `winter_outpost` and `arid_compound`.
    if (family === 'winter_outpost' || family === 'arid_compound') {
        let ridges = 0;
        for (const lot of layout.plot?.lots || []) if (!lot.road && ['vacant_lot', 'depot_yard', 'pocket_park', 'checkpoint_yard'].includes(lot.kind) && ridges < 1) {
            const plat = [];
            for (let dy = 3; dy <= 5; dy++) for (let dx = 2; dx <= 5; dx++) plat.push([lot.x0 + dx, lot.y0 + dy]);
            const ramp = [[lot.x0 + 3, lot.y0 + 6], [lot.x0 + 4, lot.y0 + 6]];
            if (![...plat, ...ramp].every(([x, y]) => isClear(x, y, 1))) continue;
            const edgeMat = family === 'winter_outpost' ? MAT.stone : MAT.drystone;
            const topMat = family === 'winter_outpost' ? MAT.snow : MAT.sand;
            for (const [x, y] of plat) {
                const rim = x === lot.x0 + 2 || x === lot.x0 + 5 || y === lot.y0 + 3 || y === lot.y0 + 5;
                s.set(x, y, G + 1, rim ? edgeMat : topMat);
            }
            for (const [x, y] of ramp) s.set(x, y, G + 1, MAT.stairs_stone);
            ridges++;
        }
    }
    // 5. Optional 2nd-storey skybridge connecting facing multi-storey buildings in `metro_hub` and `downtown`.
    if (family === 'metro_hub' || family === 'downtown') {
        const tall = layout.buildings.filter(b => b.storeys >= 2 && !b.wingOf);
        const z = G + 3;
        let built = false;
        for (let i = 0; i < tall.length && !built; i++) for (let j = i + 1; j < tall.length && !built; j++) {
            const a = tall[i], b = tall[j];
            const ox0 = Math.max(a.x0, b.x0) + 2, ox1 = Math.min(a.x0 + a.w, b.x0 + b.w) - 3;
            const gapY = Math.max(b.y0 - (a.y0 + a.d), a.y0 - (b.y0 + b.d));
            if (ox1 - ox0 >= 2 && gapY >= 2 && gapY <= 6) {
                const topB = a.y0 < b.y0 ? a : b, botB = a.y0 < b.y0 ? b : a;
                const bx = ox0 + ((ox1 - ox0) >> 1), spanY = [];
                for (let y = topB.y0 + topB.d; y < botB.y0; y++) spanY.push(y);
                const doorCells = [[bx, topB.y0 + topB.d - 1], [bx + 1, topB.y0 + topB.d - 1], [bx, botB.y0], [bx + 1, botB.y0]];
                const ok = spanY.every(y => [bx, bx + 1].every(x => s.inBounds(x, y, z + 2) && s.get(x, y, z) === 0 && s.get(x, y, z + 1) === 0 && s.get(x, y, z + 2) === 0))
                    && doorCells.every(([x, y]) => s.isSolid(x, y, z));
                if (!ok) continue;
                for (const y of spanY) for (const x of [bx, bx + 1]) { s.set(x, y, z, MAT.concrete); m.ctx.hints[`${x},${y},${z}`] = { bridge: true }; }
                for (const y of spanY) for (const [x, sideWall] of [[bx, bx - 1], [bx + 1, bx + 2]]) {
                    void sideWall;
                    if (s.inBounds(x, y, z + 1)) s.set(x, y, z + 1, MAT.railing);
                }
                // Carve 2nd-floor passages only on the two inner bridge lanes cleanly above wall slab.
                for (const [dx, dy] of doorCells) for (let h = 1; h <= 2; h++) {
                    s.set(dx, dy, z + h, 0);
                    delete m.ctx.hints[`${dx},${dy},${z + h}`];
                }
                built = true;
            }
        }
    }
}

/** Per-building and per-lot wear tints for the renderer (texture variants by noise, PLAN-04 P8). */
export function wearOf(layout) {
    const d = layout.dressing; if (!d) return null;
    return { buildings: d.buildings.map(w => { const b = layout.buildings.find(x => x.id === w.id); return { x0: b.x0, y0: b.y0, x1: b.x0 + b.w - 1, y1: b.y0 + b.d - 1, tint: w.tint, wear: w.wear, accent: w.accent }; }),
        lots: d.lots.map(l => ({ x0: l.lx * 8, y0: l.ly * 8, x1: l.lx * 8 + 7, y1: l.ly * 8 + 7, tint: l.tint, wear: l.wear })) };
}
