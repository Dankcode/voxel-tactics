// Route 9 Stop — Roadside. A gas station (forecourt canopy, fuel pumps that explode, a convenience store), a
// one-storey motel with a door per room, and its parking lot, beside a highway. The squad arrives along the highway.
import { createMap } from './modern/MapKit.js';
import { FORECOURT_PROPS } from './PropCatalog.js';
import { MAT } from '../voxel/Materials.js';

export const ROUTE9_ID = 'route-9';

export function buildRoute9({ seed = 1 } = {}) {
    const W = 52, D = 42;
    const m = createMap({ id: ROUTE9_ID, width: W, depth: D, height: 12, seed, ground: 'gravel' });
    const { store } = m;

    m.roadX(34, 39, 0, W - 1, { curb: 'concrete' });
    m.ground(0, 40, W - 1, 41, 'gravel');
    m.ground(2, 15, 23, 32, 'concrete');                // forecourt
    m.ground(25, 16, W - 2, 32, 'asphalt');             // motel lot
    for (let x = 27; x <= W - 4; x += 3) m.ground(x, 17, x, 19, 'road_mark');
    m.ground(0, 0, W - 1, 1, 'lawn');

    m.building({ id: 'station', name: 'Gas & Go', program: 'station', x0: 4, y0: 3, w: 15, d: 11, front: 's', entryAt: 0.5 });
    m.building({ id: 'motel', name: 'Starlite Motel', program: 'motel', x0: 25, y0: 4, w: 25, d: 10, front: 's' });

    // Canopy over two pump islands: steel columns (full cover) carrying a roof that is scenery only, so the storey
    // cutaway never hides it.
    for (const [x, y] of [[5, 19], [20, 19], [5, 27], [20, 27]]) for (let z = 2; z < 5; z++) { store.set(x, y, z, MAT.metal); m.hints[`${x},${y},${z}`] = { piece: 'column' }; }
    m.decorAt('canopy', 12.5, 23, { z: 5, w: 18, d: 11, free: true });
    for (const y of [21, 25]) { m.line(9, y, 1, 'x', 'pump'); m.line(15, y, 1, 'x', 'pump'); m.line(10, y, 2, 'x', 'jersey'); }
    m.decorAt('price_sign', 23, 31, { yaw: Math.PI });
    m.decorAt('air_pump', 3, 16);

    // Lot: parked cars, an ice machine, bins.
    m.car(27, 20, 'y', -1); m.car(33, 20, 'y', -1, [0.55, 0.14, 0.12]); m.car(42, 20, 'y', -1); m.car(36, 27, 'x', 1);
    m.car(12, 30, 'x', -1, [0.2, 0.3, 0.45]);
    m.line(19, 14, 2, 'x', 'appliance', 2);
    m.line(48, 15, 2, 'x', 'bin'); m.dumpster(22, 4, 'y');
    for (const x of [26, 40]) m.decorAt('streetlight', x, 33, { yaw: Math.PI / 2 });
    m.decorAt('motel_sign', 49, 31, { yaw: Math.PI });
    m.tree(1, 4, 'conifer'); m.tree(1, 10, 'conifer'); m.tree(50, 3, 'conifer'); m.tree(24, 31, 'round');

    m.car(10, 36, 'x', -1, [0.62, 0.66, 0.7]); m.line(0, 40, 3, 'x', 'jersey');
    m.reserve(1, 35, 8, 39);
    m.reserve(4, 18, 21, 28);   // under the canopy: pumps and islands only
    const cover = m.scatter(FORECOURT_PROPS, { maxGap: 4, targetShare: 0.3 });

    const spawns = {
        player: [[2, 36], [4, 36], [6, 36], [3, 38], [5, 38], [7, 38]].map(([x, y]) => ({ x, y, z: 1 })),
        enemy: [
            { type: 'cultist', group: 0, room: { building: 'station', kind: 'sales' } },
            { type: 'archer', group: 0, room: { building: 'station', kind: 'storeroom' } },
            { type: 'pyromancer', group: 1, at: { x: 16, y: 23 } },
            { type: 'warden_foe', group: 2, room: { building: 'motel', kind: 'unit', index: 1 } },
            { type: 'cultist', group: 2, room: { building: 'motel', kind: 'unit', index: 2 } },
            { type: 'brute', group: 2, at: { x: 39, y: 18 } },
            { type: 'archer', group: 3, at: { x: 46, y: 26 } }
        ]
    };
    return m.finish({
        name: 'Route 9 Stop', spawns,
        objective: { kind: 'eliminate', text: 'Syndicate couriers are holed up at the motel. Mind the fuel pumps.' },
        meta: { kind: 'roadside', theme: 'Roadside', defaultCut: 4, coverProps: cover.placed.length, lighting: 'dusk' }
    });
}
