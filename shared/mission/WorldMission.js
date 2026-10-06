// World mission: a vibe-game site (WorldSites.js) upscaled ×2 into a voxel battlefield with rebuilt,
// enterable buildings, decorations as cover props, a clutter pass toward the cover-density gate,
// a squad spawn on the best map edge and enemy pods inside buildings and out in the streets.
import { VoxelStore } from '../voxel/VoxelStore.js';
import { MAT } from '../voxel/Materials.js';
import { createRng, hashString } from '../util/Rng.js';
import { buildBuilding, roleFor, wallMaterialFor } from './BuildingBuilder.js';
import { placeProp } from './Props.js';
import { scatterCover } from './CoverScatter.js';
import { finalizeMission } from './MissionCommon.js';
import { ENEMY_PODS } from '../content/units.js';

export const TACTICAL_SCALE = 2;
const E = { VOID: 0, GEO: 1, HYDRO: 2, ANEMO: 3, CRYO: 4, PYRO: 5, STRUCTURE: 6 };

function surfaceMaterial([element, texture]) {
    switch (element) {
        case E.GEO: return ['grass', 'forest_floor', 'road', 'grass', 'stone', 'road', 'cobble', 'cobble', 'grass'][texture] || 'grass';
        case E.ANEMO: return 'sand';
        case E.CRYO: return texture === 1 ? 'ice' : 'snow';
        case E.PYRO: return 'lava';
        case E.STRUCTURE: return 'cobble';
        default: return 'grass';
    }
}

export function buildWorldMission(site, { seed = 1, scale = TACTICAL_SCALE } = {}) {
    const rng = createRng(hashString(`world:${site.id}:${seed}`));
    const W = site.cols * scale, D = site.rows * scale, H = 18;
    const store = new VoxelStore(W, D, H);
    const cell = (cx, cy) => site.cells[cy * site.cols + cx];
    const isWallCell = c => c[0] === E.STRUCTURE && c[1] === 1;
    const isStructure = c => c[0] === E.STRUCTURE || c[2] > 0;
    // Ground height per cell: structure cells take the median height of non-structure neighbours.
    const ground = new Int16Array(site.cols * site.rows);
    for (let y = 0; y < site.rows; y++) for (let x = 0; x < site.cols; x++) {
        const c = cell(x, y);
        if (!isStructure(c)) { ground[y * site.cols + x] = Math.min(4, c[3]); continue; }
        const hs = [];
        for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
            const n = site.cells[(y + dy) * site.cols + (x + dx)];
            if (x + dx >= 0 && y + dy >= 0 && x + dx < site.cols && y + dy < site.rows && n && !isStructure(n)) hs.push(Math.min(4, n[3]));
        }
        hs.sort((a, b) => a - b);
        ground[y * site.cols + x] = hs.length ? hs[hs.length >> 1] : 0;
    }
    // Terrain.
    for (let ty = 0; ty < D; ty++) for (let tx = 0; tx < W; tx++) {
        const cx = Math.floor(tx / scale), cy = Math.floor(ty / scale), c = cell(cx, cy);
        const h = ground[cy * site.cols + cx], top = h + 1;
        store.set(tx, ty, 0, MAT.bedrock);
        for (let z = 1; z < top; z++) store.set(tx, ty, z, MAT.soil);
        if (c[0] === E.HYDRO) {
            const deep = c[1] === 2 || c[1] === 3;
            store.set(tx, ty, top, MAT[deep ? 'deep_water' : 'water']);
            if (top > 1) store.set(tx, ty, top - 1, MAT.sand);
        } else store.set(tx, ty, top, MAT[surfaceMaterial(c)]);
        if (isWallCell(c)) for (let z = top + 1; z <= top + 3; z++) store.set(tx, ty, z, MAT.city_wall);
    }
    // Buildings.
    let next = 0;
    const ctx = { rng, rooms: [], nextRoomId: () => next++ };
    const buildings = [];
    for (const b of site.buildings) {
        const x0 = b.x * scale, y0 = b.y * scale, w = b.w * scale, d = b.h * scale;
        let base = 1;
        for (let y = y0; y < y0 + d; y++) for (let x = x0; x < x0 + w; x++) base = Math.max(base, store.surfaces(x, y).filter(s => s.z <= 6).at(-1)?.z ?? 1);
        const role = roleFor(b);
        const big = b.w * b.h >= 30;
        const storeys = role === 'keep' ? (big ? 2 : 2) : role === 'inn' ? 2 : role === 'home' ? (rng.next() < 0.45 ? 2 : 1) : 1;
        buildings.push(buildBuilding(store, {
            id: b.id, name: b.name, x0, y0, w, d, baseZ: base, storeys, wall: wallMaterialFor(b), role,
            entry: { side: b.entry.side, offset: b.entry.offset * scale + 1 }, roof: b.roofStyle || 'flat'
        }, ctx));
    }
    const inBuilding = (x, y) => buildings.some(b => x >= b.x0 - 1 && y >= b.y0 - 1 && x <= b.x0 + b.w && y <= b.y0 + b.d);
    const groundZ = (x, y) => { const s = store.surfaces(x, y); return s.length ? s[s.length - 1].z : null; };
    const PROP_FOR = { tree: 'tree', boulder: 'boulder', stall: 'stall', fountain: 'fountain', lantern_cluster: 'lantern_cluster', banner: 'banner',
        archway: 'archway', shrub: 'shrub', plant: 'plant', resource_node: 'resource_node' };
    for (const d of site.decorations) {
        const type = PROP_FOR[d.type]; if (!type) continue;
        const x = d.x * scale, y = d.y * scale;
        if (x < 2 || y < 2 || x >= W - 4 || y >= D - 4 || inBuilding(x, y) || inBuilding(x + 1, y + 1)) continue;
        const z = groundZ(x, y);
        if (z == null || store.material(x, y, z).liquid) continue;
        placeProp(store, type, x, y, z);
    }
    // Outdoor cover pass (§13.3): props on open ground until no outdoor tile is far from cover.
    const doorFronts = new Set();
    for (const b of buildings) for (const d of b.doors) for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) doorFronts.add(`${d.x + dx},${d.y + dy}`);
    const preSpawns = chooseSpawns(store, buildings, createRng(hashString(`spawns:${site.id}:${seed}`)), W, D);
    const nearSpawn = (x, y) => preSpawns.player.some(p => Math.abs(p.x - x) <= 2 && Math.abs(p.y - y) <= 2);
    const cover = scatterCover(store, { rng, blocked: (x, y) => inBuilding(x, y) || doorFronts.has(`${x},${y}`) || nearSpawn(x, y), maxGap: 4, targetShare: 0.32 });
    const spawns = chooseSpawns(store, buildings, rng, W, D);
    spawns.player = preSpawns.player;            // the cover pass kept these clear
    return finalizeMission({ id: `${site.id}:${seed}`, name: site.name, store, rooms: ctx.rooms, buildings, spawns, rng,
        objective: { kind: 'eliminate', text: `Clear ${site.name} of hostiles.` },
        meta: { kind: 'world', siteId: site.id, seed, scale, coverProps: cover.placed.length, biome: site.biome, architectureThemeId: site.architectureThemeId, generationVersion: site.generationVersion } });
}

function chooseSpawns(store, buildings, rng, W, D) {
    // Squad: the edge whose middle stretch has the most open ground.
    const edges = [
        { side: 's', cells: Array.from({ length: W - 8 }, (_, i) => [4 + i, D - 3]) },
        { side: 'n', cells: Array.from({ length: W - 8 }, (_, i) => [4 + i, 2]) },
        { side: 'w', cells: Array.from({ length: D - 8 }, (_, i) => [2, 4 + i]) },
        { side: 'e', cells: Array.from({ length: D - 8 }, (_, i) => [W - 3, 4 + i]) }
    ];
    const open = ([x, y]) => { const s = store.surfaces(x, y).at(-1); return s && s.headroom >= 2 && !store.material(x, y, s.z).liquid && store.roomAt(x, y, s.z + 1) < 0; };
    let best = null;
    for (const e of edges) {
        const mid = e.cells.slice(Math.floor(e.cells.length * 0.25), Math.floor(e.cells.length * 0.75));
        const score = mid.filter(open).length;
        if (!best || score > best.score) best = { ...e, score, mid };
    }
    const middle = best.mid.filter(open);
    const centre = middle[Math.floor(middle.length / 2)] || best.mid[0];
    const player = middle.sort((a, b) => Math.hypot(a[0] - centre[0], a[1] - centre[1]) - Math.hypot(b[0] - centre[0], b[1] - centre[1]))
        .filter((_, i) => i % 2 === 0).slice(0, 6).map(([x, y]) => ({ x, y, z: store.surfaces(x, y).at(-1).z }));
    // Enemies: pods in the far half — two in buildings, two in the open.
    const far = (x, y) => Math.hypot(x - centre[0], y - centre[1]) > Math.min(W, D) * 0.45;
    const pods = Object.values(ENEMY_PODS);
    const enemy = [];
    let group = 0;
    const farBuildings = buildings.filter(b => far(b.x0 + b.w / 2, b.y0 + b.d / 2) && b.rooms.length).sort((a, b) => b.w * b.d - a.w * a.d);
    for (const b of farBuildings.slice(0, 2)) {
        const pod = pods[group % pods.length];
        pod.forEach((type, i) => {
            const rooms = b.rooms.filter(r => !r.cells.length || true);
            const room = rooms[(i * 3 + group) % rooms.length];
            enemy.push({ type, group, room: { building: b.id, storey: room.storey, index: b.rooms.filter(r => r.storey === room.storey).indexOf(room) } });
        });
        group++;
    }
    for (let k = 0; k < 2; k++) {
        let spot = null;
        for (let tries = 0; tries < 200 && !spot; tries++) {
            const x = 3 + Math.floor(rng.next() * (W - 6)), y = 3 + Math.floor(rng.next() * (D - 6));
            if (!far(x, y) || !open([x, y])) continue;
            spot = { x, y };
        }
        if (!spot) continue;
        const pod = pods[(group + 1) % pods.length];
        pod.forEach((type, i) => enemy.push({ type, group, at: { x: spot.x + (i % 2) * 2, y: spot.y + Math.floor(i / 2) * 2 } }));
        group++;
    }
    return { player, enemy };
}
