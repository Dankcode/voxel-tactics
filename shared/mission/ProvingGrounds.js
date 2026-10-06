// Proving Grounds: a hand-laid test map that puts every system in one place — a firing range with each
// cover material, a two-storey corridor bunker with rooms and stairs, a timber shack full of powder,
// a stone watchtower with roof access, a pond (shallow, deep, ice), a sand patch, a hill with a ramp,
// hedges, trees, stalls and barrels. Used by the battle scenario, the tests and the balance sim.
import { VoxelStore } from '../voxel/VoxelStore.js';
import { MAT } from '../voxel/Materials.js';
import { createRng, hashString } from '../util/Rng.js';
import { buildBuilding } from './BuildingBuilder.js';
import { placeProp } from './Props.js';
import { scatterCover } from './CoverScatter.js';
import { finalizeMission } from './MissionCommon.js';

export const PROVING_GROUNDS_ID = 'proving-grounds';

export function buildProvingGrounds({ seed = 1 } = {}) {
    const W = 60, D = 46, H = 16;
    const store = new VoxelStore(W, D, H);
    const rng = createRng(hashString(`proving:${seed}`));
    for (let y = 0; y < D; y++) for (let x = 0; x < W; x++) { store.set(x, y, 0, MAT.bedrock); store.set(x, y, 1, MAT.grass); }
    const G = 1;   // ground surface z

    // Roads.
    for (let x = 2; x < W - 2; x++) for (const y of [22, 23]) store.set(x, y, G, MAT.road);
    for (let y = 2; y < D - 2; y++) for (const x of [20, 21]) store.set(x, y, G, MAT.cobble);

    // Hill with a ramp on its east side (stone cap = sniper nest).
    for (let y = 28; y <= 36; y++) for (let x = 3; x <= 11; x++) for (let z = 2; z <= 4; z++) store.set(x, y, z, z === 4 ? MAT.grass : MAT.soil);
    for (let i = 0; i < 3; i++) for (let y = 31; y <= 33; y++) for (let z = 2; z <= 3 - i + 1 && z <= 4; z++) store.set(12 + i, y, z, z === 4 - i ? MAT.grass : MAT.soil);
    placeProp(store, 'sandbags', 4, 28, 4, 6, true);
    placeProp(store, 'tree', 9, 35, 4);

    // Firing range: rows of each cover material across the lane.
    placeProp(store, 'hedge_row', 3, 8, G, 7, true);
    placeProp(store, 'crates', 4, 12, G); placeProp(store, 'crate', 9, 12, G); placeProp(store, 'keg', 12, 12, G);
    // Range targets: a section of each building wall type (stone, timber, plaster with a window) to shoot through.
    placeProp(store, 'wall', 2, 15, G, 4, true, 'stone', 2);
    placeProp(store, 'wall', 6, 15, G, 3, true, 'timber', 2);
    placeProp(store, 'wall', 9, 15, G, 3, true, 'plaster', 2);
    store.set(10, 15, G + 2, MAT.glass);
    placeProp(store, 'sandbags', 13, 15, G, 4, true);
    placeProp(store, 'tree', 15, 6, G);

    let next = 0;
    const ctx = { rng, rooms: [], nextRoomId: () => next++ };
    const buildings = [];
    // Two-storey stone bunker with a corridor.
    buildings.push(buildBuilding(store, { id: 'bunker', name: 'Bunker', x0: 24, y0: 4, w: 16, d: 12, baseZ: G, storeys: 2, wall: 'stone', role: 'keep', entry: { side: 's' }, roof: 'flat' }, ctx));
    // Timber shack (powder store).
    buildings.push(buildBuilding(store, { id: 'shack', name: 'Powder Shack', x0: 44, y0: 5, w: 9, d: 8, baseZ: G, storeys: 1, wall: 'timber', role: 'workshop', entry: { side: 'w' }, roof: 'dome' }, ctx));
    // Stone watchtower with roof access.
    buildings.push(buildBuilding(store, { id: 'tower', name: 'Watchtower', x0: 46, y0: 16, w: 9, d: 9, baseZ: G, storeys: 1, wall: 'stone', role: 'keep', entry: { side: 'w' }, roof: 'flat', roofAccess: true }, ctx));
    // Plaster house with a split plan.
    buildings.push(buildBuilding(store, { id: 'house', name: 'House', x0: 24, y0: 27, w: 8, d: 10, baseZ: G, storeys: 2, wall: 'plaster', role: 'home', entry: { side: 'w' }, roof: 'flat' }, ctx));

    // Pond: shallow ring, deep middle; ice and snow beside it; sand bank.
    for (let y = 28; y <= 38; y++) for (let x = 38; x <= 50; x++) {
        const d = Math.hypot((x - 44) / 6.5, (y - 33) / 5.5);
        if (d > 1) continue;
        if (d < 0.55) store.set(x, y, G, MAT.deep_water);
        else store.set(x, y, G, MAT.water);
    }
    for (let y = 37; y <= 42; y++) for (let x = 51; x <= 57; x++) store.set(x, y, G, (x + y) % 5 === 0 ? MAT.ice : MAT.snow);
    for (let y = 26; y <= 32; y++) for (let x = 52; x <= 57; x++) store.set(x, y, G, MAT.sand);

    // Street clutter.
    placeProp(store, 'stall', 30, 19, G); placeProp(store, 'cart', 35, 25, G); placeProp(store, 'crates', 41, 20, G);
    placeProp(store, 'keg', 38, 19, G); placeProp(store, 'water_barrel', 39, 19, G);
    placeProp(store, 'boulder', 16, 26, G); placeProp(store, 'tree', 34, 39, G); placeProp(store, 'tree', 54, 43, G);
    placeProp(store, 'hedge_row', 14, 40, G, 6, true); placeProp(store, 'low_wall', 33, 32, G, 4, false);
    placeProp(store, 'lantern_cluster', 22, 25, G); placeProp(store, 'fountain', 14, 20, G);

    // Outdoor cover pass on the open ground (keeps the firing range lane, the pond and the spawn clear).
    const doorFronts = new Set();
    for (const b of buildings) for (const d of b.doors) for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) doorFronts.add(`${d.x + dx},${d.y + dy}`);
    const inBuilding = (x, y) => buildings.some(b => x >= b.x0 - 1 && y >= b.y0 - 1 && x <= b.x0 + b.w && y <= b.y0 + b.d);
    const reserved = (x, y) => inBuilding(x, y) || doorFronts.has(`${x},${y}`) || (y >= 41 && x >= 21 && x <= 28) || (x <= 16 && y >= 7 && y <= 16);
    const cover = scatterCover(store, { rng, blocked: reserved, maxGap: 4, targetShare: 0.3 });

    const spawns = {
        player: [{ x: 22, y: 42 }, { x: 24, y: 42 }, { x: 26, y: 42 }, { x: 23, y: 44 }, { x: 25, y: 44 }, { x: 27, y: 44 }].map(p => ({ ...p, z: G })),
        enemy: [
            { type: 'cultist', group: 0, at: { x: 6, y: 5 } }, { type: 'archer', group: 0, at: { x: 10, y: 5 } },
            { type: 'warden_foe', group: 1, room: { building: 'bunker', storey: 0, kind: 'corridor' } },
            { type: 'cultist', group: 1, room: { building: 'bunker', storey: 0, index: 1 } },
            { type: 'archer', group: 1, room: { building: 'bunker', storey: 1, index: 2 } },
            { type: 'pyromancer', group: 2, room: { building: 'shack', storey: 0, index: 0 } },
            { type: 'brute', group: 2, at: { x: 42, y: 15 } },
            { type: 'archer', group: 3, roof: 'tower' },
            { type: 'cultist', group: 4, room: { building: 'house', storey: 1, index: 0 } }
        ]
    };
    return finalizeMission({ id: PROVING_GROUNDS_ID, name: 'Proving Grounds', store, rooms: ctx.rooms, buildings, spawns, rng,
        objective: { kind: 'eliminate', text: 'Eliminate all hostiles.' }, meta: { kind: 'proving-grounds', seed, coverProps: cover.placed.length } });
}
