// Harbor Yard — Industrial docks. A container yard on the quay: stacked shipping containers form lanes and high
// walls, a corrugated warehouse with roller doors and a site office, pallets and fuel drums (they explode) between
// them, a chain-link fence along the access road where the squad arrives.
import { createMap } from './modern/MapKit.js';
import { DOCKS_PROPS } from './PropCatalog.js';

export const HARBOR_ID = 'harbor-yard';

export function buildHarbor({ seed = 1 } = {}) {
    const W = 54, D = 44;
    const m = createMap({ id: HARBOR_ID, width: W, depth: D, height: 14, seed, ground: 'concrete' });
    const { rng } = m;

    // Water along the north edge, the quay apron, the yard, the access road along the south.
    m.ground(0, 0, W - 1, 3, 'deep_water');
    for (let y = 0; y <= 3; y++) m.ground(0, y, W - 1, y, 'bedrock', 0);
    m.ground(0, 4, W - 1, 5, 'paving');
    for (let x = 3; x < W; x += 7) m.decorAt('bollard', x, 4);
    m.roadX(39, 42, 0, W - 1, { curb: 'concrete' });
    m.ground(0, 36, W - 1, 37, 'gravel');
    // A driving lane through the yard.
    m.ground(0, 22, 31, 23, 'asphalt');
    for (let x = 1; x < 31; x += 4) m.ground(x, 22, x + 1, 22, 'road_mark');

    // Warehouse with roller doors and an office; a site office by the gate.
    m.building({ id: 'warehouse', name: 'Warehouse 4', program: 'warehouse', x0: 33, y0: 8, w: 18, d: 13, front: 'w', entryAt: 0.5 });
    m.building({ id: 'site-office', name: 'Site office', program: 'garage', x0: 4, y0: 26, w: 10, d: 8, front: 's', entryAt: 0.3 });

    // Container stacks: rows with lanes between them.
    const rows = [[4, 8], [4, 14], [16, 8], [16, 14], [10, 24], [20, 26], [24, 8]];
    rows.forEach(([x, y], i) => m.container(x, y, 'x', null, 1, i % 3 === 1));
    m.container(28, 15, 'y'); m.container(45, 25, 'y', null, 1, true);

    // Chain-link fence along the yard boundary with a gate at the road.
    for (let x = 0; x < W; x++) if (x < 22 || x > 27) m.line(x, 35, 1, 'x', 'chainlink', 2);
    m.decorAt('gate_sign', 22, 34);
    // Yard clutter and vehicles.
    m.line(12, 20, 3, 'x', 'pallet'); m.line(30, 30, 2, 'y', 'pallet', 2);
    m.line(26, 21, 2, 'x', 'barrel_powder'); m.line(14, 31, 2, 'x', 'barrel_water');
    m.car(36, 26, 'y', 1, [0.85, 0.7, 0.1]); m.car(47, 39, 'x', -1); m.car(6, 39, 'x', 1);
    m.line(30, 4, 3, 'x', 'jersey'); m.line(10, 4, 2, 'x', 'crate', 2); m.line(2, 5, 2, 'x', 'pallet'); m.line(40, 5, 2, 'x', 'crate', 2); m.line(20, 5, 2, 'x', 'sandbag');
    m.car(14, 40, 'x', 1, [0.92, 0.93, 0.94]); m.line(28, 40, 2, 'x', 'jersey');
    for (const x of [8, 26, 44]) m.decorAt('floodlight', x, 34, { yaw: Math.PI / 2 });
    m.decorAt('crane_leg', 18, 4); m.decorAt('crane_leg', 18, 6, { yaw: Math.PI });

    m.line(19, 43, 3, 'x', 'jersey'); m.line(25, 43, 2, 'x', 'jersey');
    m.reserve(19, 40, 26, 42);
    const cover = m.scatter(DOCKS_PROPS, { maxGap: 4, targetShare: 0.3 });

    const spawns = {
        player: [[20, 41], [22, 41], [24, 41], [21, 42], [23, 42], [25, 42]].map(([x, y]) => ({ x, y, z: 1 })),
        enemy: [
            { type: 'cultist', group: 0, at: { x: 9, y: 12 } },
            { type: 'archer', group: 0, at: { x: 21, y: 12 } },
            { type: 'warden_foe', group: 1, room: { building: 'warehouse', kind: 'loading' } },
            { type: 'brute', group: 1, room: { building: 'warehouse', kind: 'warehouse' } },
            { type: 'cultist', group: 1, room: { building: 'warehouse', kind: 'office' } },
            { type: 'pyromancer', group: 2, at: { x: 27, y: 6 } },
            { type: 'archer', group: 3, at: { x: 44, y: 5 } },
            { type: 'cultist', group: 3, room: { building: 'site-office', kind: 'workshop' } }
        ]
    };
    return m.finish({
        name: 'Harbor Yard', spawns,
        objective: { kind: 'eliminate', text: 'A Syndicate shipment is on the quay. Clear the container yard and the warehouse.' },
        meta: { kind: 'docks', theme: 'Industrial', defaultCut: 4, coverProps: cover.placed.length, lighting: 'night', rng: rng.next() }
    });
}
