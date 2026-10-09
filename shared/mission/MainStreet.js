// Main Street — Downtown. A shop, a diner and a two-storey office on the north side of a main road, a pharmacy and a
// parking lot to the south, a side street up from the south where the squad arrives. Roadworks barriers, planters,
// benches and parked cars give street cover; the shops have storefront glass and back doors onto the service alley.
import { createMap } from './modern/MapKit.js';
import { DOWNTOWN_PROPS } from './PropCatalog.js';
import { MAT } from '../voxel/Materials.js';

export const MAIN_STREET_ID = 'main-street';

export function buildMainStreet({ seed = 1 } = {}) {
    const W = 52, D = 42;
    const m = createMap({ id: MAIN_STREET_ID, width: W, depth: D, height: 14, seed, ground: 'paving' });

    // Service alley behind the north row, the main road, the side street, the parking lot.
    m.ground(0, 0, W - 1, 1, 'asphalt');
    m.roadX(17, 22);
    m.roadY(23, 28, 24, D - 1);
    m.ground(31, 27, W - 2, D - 2, 'asphalt');
    for (let x = 33; x <= W - 4; x += 3) { m.ground(x, 28, x, 30, 'road_mark'); m.ground(x, D - 5, x, D - 3, 'road_mark'); }
    m.crossingX(8, 17, 22); m.crossingX(40, 17, 22);
    m.ground(0, 26, 22, D - 1, 'concrete');

    // North row.
    m.building({ id: 'grocer', name: 'Corner grocer', program: 'shop', x0: 1, y0: 3, w: 13, d: 12, front: 's', entryAt: 0.4 });
    m.building({ id: 'diner', name: 'Route diner', program: 'diner', x0: 16, y0: 3, w: 14, d: 11, front: 's', entryAt: 0.5 });
    m.building({ id: 'office', name: 'Harmon & Pike offices', program: 'office', x0: 32, y0: 2, w: 17, d: 13, front: 's', storeys: 2, entryAt: 0.35 });
    // South-west: a pocket park with a fountain, and a kiosk.
    m.ground(2, 28, 19, D - 3, 'lawn');
    m.ground(9, 28, 11, D - 3, 'paving'); m.ground(2, 33, 19, 34, 'paving');
    for (let y = 31; y <= 36; y++) for (let x = 13; x <= 18; x++) {
        const rim = x === 13 || y === 31 || x === 18 || y === 36;
        if (rim) m.store.set(x, y, 2, MAT.planter); else m.store.set(x, y, 1, MAT.water);
    }
    m.building({ id: 'kiosk', name: 'News kiosk', program: 'garage', x0: 2, y0: 35, w: 6, d: 5, front: 'n', wall: 'brick', roof: 'flat' });
    m.tree(4, 30, 'round'); m.tree(16, 39, 'round'); m.line(5, 33, 2, 'x', 'bench'); m.line(12, 38, 2, 'y', 'bench');

    // Street furniture.
    for (const x of [4, 20, 36, 46]) m.tree(x, 15, 'round');
    m.line(13, 15, 2, 'x', 'bench'); m.line(28, 15, 2, 'x', 'planter'); m.line(47, 15, 2, 'x', 'planter');
    m.line(30, 24, 2, 'x', 'planter'); m.line(18, 24, 2, 'x', 'bench');
    // Roadworks: barriers closing one lane.
    m.line(14, 18, 3, 'x', 'jersey'); m.line(33, 21, 3, 'x', 'jersey');
    m.car(4, 20, 'x', 1); m.car(43, 17, 'x', -1); m.car(24, 31, 'y', 1, [0.75, 0.7, 0.6]);
    // Parking lot.
    m.car(34, 28, 'y', -1); m.car(40, 28, 'y', -1); m.car(46, 34, 'y', 1); m.car(37, 35, 'y', 1);
    m.dumpster(17, 1, 'x'); m.dumpster(30, 0, 'x'); m.line(14, 0, 2, 'x', 'bin'); m.line(49, 0, 1, 'x', 'bin');
    m.line(31, 26, 4, 'x', 'jersey');
    for (const x of [10, 26, 44]) m.decorAt('streetlight', x, 16, { yaw: -Math.PI / 2 });
    for (const x of [16, 34]) m.decorAt('streetlight', x, 23, { yaw: Math.PI / 2 });
    m.decorAt('hydrant', 22, 16); m.decorAt('bus_stop', 9, 23, { yaw: Math.PI });
    m.decorAt('drain', 12, 17); m.decorAt('drain', 30, 22);

    m.reserve(23, 36, 28, D - 1);
    const cover = m.scatter(DOWNTOWN_PROPS, { maxGap: 4, targetShare: 0.28 });

    const spawns = {
        player: [[24, 39], [26, 39], [28, 39], [23, 40], [25, 40], [27, 40]].map(([x, y]) => ({ x, y, z: 1 })),
        enemy: [
            { type: 'cultist', group: 0, room: { building: 'diner', kind: 'dining' } },
            { type: 'brute', group: 0, room: { building: 'diner', kind: 'galley' } },
            { type: 'archer', group: 1, room: { building: 'office', kind: 'open_office', storey: 1 } },
            { type: 'warden_foe', group: 1, room: { building: 'office', kind: 'lobby' } },
            { type: 'cultist', group: 2, room: { building: 'grocer', kind: 'sales' } },
            { type: 'pyromancer', group: 2, at: { x: 12, y: 19 } },
            { type: 'cultist', group: 3, at: { x: 44, y: 31 } },
            { type: 'archer', group: 3, at: { x: 6, y: 30 } }
        ]
    };
    return m.finish({
        name: 'Main Street', spawns,
        objective: { kind: 'hold', text: 'The Syndicate has taken Main Street. Hold the junction in front of the diner for 4 rounds so the convoy can get through.',
            zone: { x0: 22, y0: 17, x1: 29, y1: 22 }, rounds: 4 },
        meta: { kind: 'downtown', theme: 'Downtown', defaultCut: 4, coverProps: cover.placed.length, lighting: 'dusk' }
    });
}
