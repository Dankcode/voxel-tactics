// Cedar Close — Suburbs. Two modern homes on a quiet close, after docs/design/cedar-close-concept.png: glass-walled
// living rooms, furnished interiors, front gardens with paths and planters, a shared driveway, fenced back gardens
// with patios, a tree-lined sidewalk and a two-lane street with parked cars.
//
// Approaches: the street (cars, planters, verge trees), the shared driveway between the homes, and the back gardens
// (fence gate) — every room has two ways in.
import { createMap } from './modern/MapKit.js';
import { SUBURB_PROPS } from './PropCatalog.js';

export const CEDAR_CLOSE_ID = 'cedar-close';

export function buildCedarClose({ seed = 1 } = {}) {
    const W = 48, D = 40;
    const m = createMap({ id: CEDAR_CLOSE_ID, width: W, depth: D, height: 12, seed, ground: 'lawn' });
    const { rng } = m;

    // Street: sidewalk, verge, curb, two lanes, curb, sidewalk.
    m.ground(0, 28, W - 1, 29, 'concrete');
    m.ground(0, 30, W - 1, 30, 'lawn');
    m.roadX(32, 36);
    m.ground(0, 38, W - 1, 39, 'paving');
    // Driveways: shared one between the homes, one east of number 14.
    m.ground(20, 10, 24, 31, 'concrete');
    m.ground(43, 12, 46, 31, 'concrete');

    // The homes.
    const a = m.building({ id: 'home-12', name: '12 Cedar Close', program: 'house', x0: 3, y0: 9, w: 16, d: 13, front: 's', entryAt: 0.3 });
    const b = m.building({ id: 'home-14', name: '14 Cedar Close', program: 'house', x0: 27, y0: 9, w: 15, d: 13, front: 's', entryAt: 0.7 });

    // Front gardens: a paved path from each front door to the sidewalk, planters either side, clipped hedges along
    // the sidewalk (concealment only).
    for (const h of [a, b]) {
        const e = h.entry;
        m.ground(e.x - 1, e.y + 1, e.x, 27, 'paving');
        m.reserve(e.x - 1, e.y + 1, e.x, 29);
        for (let x = h.x0; x <= h.x0 + h.w - 1; x++) if (x < e.x - 2 || x > e.x + 1) m.hedge(x, 27, 1, 'x');
        m.line(e.x - 3, 24, 2, 'x', 'planter'); m.line(e.x + 2, 24, 2, 'x', 'planter');
        m.decorAt('mailbox', e.x + 1, 28, { yaw: Math.PI });
        for (let i = 0; i < 3; i++) m.decorAt('flowers', e.x - 4 + i, 23);
    }
    // Garden walls on the front corners (half cover), conifers at the house corners.
    m.line(1, 26, 2, 'y', 'brick'); m.line(42, 25, 2, 'x', 'brick');
    m.tree(2, 22, 'conifer'); m.tree(25, 23, 'conifer'); m.tree(42, 9, 'conifer');

    // Back gardens: patios, a timber deck, privacy fences on the boundary and between the gardens (with a gate).
    m.ground(5, 3, 12, 7, 'paving');
    m.ground(29, 3, 37, 7, 'deck');
    for (let x = 1; x < W - 1; x++) m.line(x, 1, 1, 'x', 'privacy_fence', 2);
    for (let y = 2; y <= 8; y++) if (y !== 5 && y !== 6) m.line(22, y, 1, 'x', 'privacy_fence', 2);
    m.decorAt('patio_set', 8, 5, { yaw: rng.next() * 0.4 }); m.decorAt('umbrella', 8, 5);
    m.decorAt('patio_set', 33, 5, { yaw: 0.3 });
    m.line(13, 4, 2, 'y', 'planter'); m.line(38, 4, 2, 'y', 'planter');
    m.tree(16, 4, 'round'); m.tree(42, 5, 'round');
    for (const [x, y] of [[4, 6], [27, 7], [40, 3]]) m.decorAt('shrub', x, y);
    m.line(25, 3, 2, 'x', 'bench');

    // Driveway: the family car, bins by the garage side.
    m.car(21, 14, 'y', -1);
    m.car(44, 19, 'y', -1);
    m.line(23, 26, 2, 'x', 'bin');
    m.line(46, 9, 1, 'x', 'bin');

    // Street: verge trees, parked cars, street lights, a hydrant.
    for (const x of [6, 17, 33, 41]) m.tree(x, 30, 'round');
    m.car(9, 33, 'x', 1);
    m.car(28, 35, 'x', -1);
    m.car(40, 33, 'x', 1);
    m.car(1, 35, 'x', 1, [0.92, 0.93, 0.94]);
    m.car(17, 35, 'x', -1, [0.2, 0.3, 0.45]);
    for (const x of [12, 30, 45]) m.decorAt('streetlight', x, 29, { yaw: Math.PI / 2 });
    m.decorAt('hydrant', 26, 29);
    m.decorAt('drain', 15, 32); m.decorAt('drain', 37, 36);

    // Squad on the far sidewalk; keep the spawn and the road lanes clear of scattered props.
    m.reserve(0, 32, W - 1, 36);
    m.reserve(1, 37, 9, 39);
    const cover = m.scatter(SUBURB_PROPS, { maxGap: 4, targetShare: 0.3 });

    const spawns = {
        player: [[2, 38], [4, 38], [6, 38], [3, 39], [5, 39], [7, 39]].map(([x, y]) => ({ x, y, z: 1 })),
        enemy: [
            { type: 'cultist', group: 0, room: { building: 'home-12', kind: 'living' } },
            { type: 'warden_foe', group: 0, room: { building: 'home-12', kind: 'kitchen' } },
            { type: 'archer', group: 1, room: { building: 'home-14', kind: 'study' } },
            { type: 'cultist', group: 1, room: { building: 'home-14', kind: 'living' } },
            { type: 'brute', group: 2, at: { x: 9, y: 5 } },
            { type: 'cultist', group: 2, at: { x: 22, y: 20 } },
            { type: 'archer', group: 3, at: { x: 34, y: 4 } }
        ]
    };
    return m.finish({
        name: 'Cedar Close', spawns,
        objective: { kind: 'eliminate', text: 'Clear the Syndicate safehouse. Use the gardens and the driveway to flank.' },
        meta: { kind: 'suburban', theme: 'Suburbs', defaultCut: 4, coverProps: cover.placed.length, lighting: 'day' }
    });
}
