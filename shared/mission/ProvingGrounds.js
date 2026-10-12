// Training Facility (id 'proving-grounds'): a hand-laid test map that puts every system in one place — a firing
// range with a section of each wall type to shoot through, a two-storey concrete bunker with rooms and stairs, a
// fuel store full of drums, a concrete watchtower with roof access, a two-storey townhouse, a pond (shallow, deep,
// ice), a sand pit, a hill with a ramp, hedges, trees, vehicles and barriers. Used by the tests and the balance sim.
import { MAT } from '../voxel/Materials.js';
import { createMap } from './modern/MapKit.js';
import { DOCKS_PROPS } from './PropCatalog.js';

export const PROVING_GROUNDS_ID = 'proving-grounds';

export function buildProvingGrounds({ seed = 1 } = {}) {
    const W = 60, D = 46;
    const m = createMap({ id: PROVING_GROUNDS_ID, width: W, depth: D, height: 16, seed, ground: 'lawn' });
    const { store } = m;
    const G = 1;   // ground surface z

    // Roads.
    m.ground(2, 22, W - 3, 23, 'asphalt');
    m.ground(20, 2, 21, D - 3, 'paving');
    for (let x = 4; x < W - 3; x += 4) m.ground(x, 22, x + 1, 22, 'road_mark');

    // Hill with a ramp on its east side (sniper nest behind sandbags).
    // Earth berm: three grassed tiers (each one cell in from the last), a ramp up its east side.
    for (let y = 28; y <= 36; y++) for (let x = 3; x <= 11; x++) {
        const tier = Math.min(x - 3, 11 - x, y - 28, 36 - y);
        const h = Math.min(3, 1 + tier);
        for (let z = 2; z <= 1 + h; z++) store.set(x, y, z, z === 1 + h ? MAT.grass : MAT.soil);
    }
    for (let i = 0; i < 3; i++) for (let y = 31; y <= 33; y++) for (let z = 2; z <= 3 - i + 1 && z <= 4; z++) store.set(12 + i, y, z, z === 4 - i ? MAT.grass : MAT.soil);
    m.line(5, 30, 5, 'x', 'sandbag', 1, 4);
    m.tree(8, 33, 'round', 4);

    // Firing range: rows of each cover material across the lane, then a section of each wall type.
    m.hedge(3, 8, 7, 'x');
    m.line(4, 12, 1, 'x', 'crate', 2); m.line(5, 12, 1, 'x', 'crate'); m.line(9, 12, 1, 'x', 'crate'); m.line(12, 12, 1, 'x', 'barrel_powder');
    m.line(2, 15, 4, 'x', 'brick', 2);
    m.line(6, 15, 3, 'x', 'siding', 2);
    m.line(9, 15, 3, 'x', 'stucco', 2);
    store.set(10, 15, G + 2, MAT.glass);
    m.line(13, 15, 4, 'x', 'sandbag');
    m.tree(15, 6, 'round');

    // Buildings (ids are used by tests: bunker, shack, tower, house).
    m.building({ id: 'bunker', name: 'Command bunker', program: 'bunker', x0: 24, y0: 4, w: 16, d: 12, storeys: 2, front: 's' });
    m.building({ id: 'shack', name: 'Fuel store', program: 'garage', x0: 44, y0: 5, w: 9, d: 8, front: 'w', roof: 'pitched' });
    m.building({ id: 'tower', name: 'Watchtower', program: 'tower', x0: 46, y0: 16, w: 9, d: 9, front: 'w', roofAccess: true });
    m.building({ id: 'house', name: 'Townhouse', program: 'townhouse', x0: 24, y0: 27, w: 8, d: 10, storeys: 2, front: 'w' });

    // Pond: shallow ring, deep middle; ice and snow beside it; a sand pit.
    for (let y = 28; y <= 38; y++) for (let x = 38; x <= 50; x++) {
        const d = Math.hypot((x - 44) / 6.5, (y - 33) / 5.5);
        if (d > 1) continue;
        store.set(x, y, G, d < 0.55 ? MAT.deep_water : MAT.water);
    }
    for (let y = 37; y <= 42; y++) for (let x = 51; x <= 57; x++) store.set(x, y, G, (x + y) % 5 === 0 ? MAT.ice : MAT.snow);
    for (let y = 26; y <= 32; y++) for (let x = 52; x <= 57; x++) store.set(x, y, G, MAT.sand);

    // Yard: vehicles, barriers, a fuel drum pair, planters round a water feature.
    m.car(30, 18, 'x', 1); m.car(34, 24, 'x', -1, [0.85, 0.7, 0.1]);
    m.line(41, 20, 2, 'x', 'crate', 2); m.line(38, 19, 1, 'x', 'barrel_powder'); m.line(39, 19, 1, 'x', 'barrel_water');
    m.line(16, 26, 2, 'x', 'jersey'); m.tree(34, 39, 'round'); m.tree(54, 43, 'conifer');
    m.hedge(14, 40, 6, 'x'); m.line(33, 32, 4, 'y', 'brick');
    for (let y = 19; y <= 22; y++) for (let x = 13; x <= 16; x++) {
        const rim = x === 13 || y === 19 || x === 16 || y === 22;
        if (rim) store.set(x, y, G + 1, MAT.planter); else store.set(x, y, G, MAT.water);
    }
    m.decorAt('streetlight', 22, 25, { yaw: 0 });

    // Outdoor cover pass on the open ground (keeps the firing range lane, the pond and the spawn clear).
    m.line(20, 45, 3, 'x', 'jersey'); m.line(26, 45, 3, 'x', 'jersey');
    m.reserve(21, 41, 28, 44);
    m.reserve(0, 7, 16, 16);
    const cover = m.scatter(DOCKS_PROPS, { maxGap: 4, targetShare: 0.3 });

    const spawns = {
        player: [{ x: 22, y: 42 }, { x: 24, y: 42 }, { x: 26, y: 42 }, { x: 23, y: 44 }, { x: 25, y: 44 }, { x: 27, y: 44 }].map(p => ({ ...p, z: G })),
        enemy: [
            { type: 'cultist', group: 0, at: { x: 6, y: 5 } }, { type: 'archer', group: 0, at: { x: 10, y: 5 } },
            { type: 'warden_foe', group: 1, room: { building: 'bunker', storey: 0, kind: 'hall' } },
            { type: 'cultist', group: 1, room: { building: 'bunker', storey: 0, index: 1 } },
            { type: 'archer', group: 1, room: { building: 'bunker', storey: 1, index: 2 } },
            { type: 'pyromancer', group: 2, room: { building: 'shack', storey: 0, index: 0 } },
            { type: 'brute', group: 2, at: { x: 42, y: 15 } },
            { type: 'archer', group: 3, roof: 'tower' },
            { type: 'cultist', group: 4, room: { building: 'house', storey: 1, index: 0 } },
            { type: 'wall_strider', group: 5, at: { x: 38, y: 30 } },
            { type: 'siege_weaver', group: 6, at: { x: 10, y: 24 } }
        ]
    };
    return m.finish({
        name: 'Training Facility', spawns,
        objective: { kind: 'eliminate', text: 'Live-fire exercise: eliminate all hostiles.' },
        meta: { kind: 'proving-grounds', lighting: 'overcast', theme: 'Training', defaultCut: 4, coverProps: cover.placed.length }
    });
}
