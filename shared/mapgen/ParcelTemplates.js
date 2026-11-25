// PLAN-13 — authored parcel layouts. Open lots and building yards no longer take a random scatter of bay pieces
// (the "random boxes": lone dumpsters, vending machines, bins, rubble blocks, barrier stubs). Each lot kind has one designed layout
// in frontage-local bay coordinates, the way XCOM 2 parcels and plot cover pieces are authored: cover comes from
// what the place is, laid out along its edges and its use (a fenced vacant lot with a gate, a container yard in
// aisles, a plaza of planters, trees and benches, a park inside its hedge), and the rest of the lot stays open.
//
// A lot is 4 × 4 bays. Local u runs along the frontage (0–3), v runs inward from it (v = 0 touches the street).
// Line pieces take a local side ('front' | 'back' | 'left' | 'right') that becomes their facing (the bay row the
// line sits on). Pins that do not fit (a protected route cell, the wrong ground, a building margin) are dropped by
// the bay solver, so a layout never blocks the line of play.
import { BAY_PIECES } from './LotCatalogue.js';
import { plotLot } from './PlotCatalogue.js';
import { hashString } from '../util/Rng.js';

const LB = 4;
const SIDE_VEC = { n: [0, -1], s: [0, 1], w: [-1, 0], e: [1, 0] };
const VEC_SIDE = v => (v[0] === 0 ? (v[1] < 0 ? 'n' : 's') : (v[0] < 0 ? 'w' : 'e'));
const LOCAL_VEC = { front: [0, -1], back: [0, 1], left: [-1, 0], right: [1, 0] };
/** Local (u, v) → lot bay (i, j), and local side → world side, for a lot whose street lies to `F`. */
const toLot = { n: (u, v) => [u, v], s: (u, v) => [3 - u, 3 - v], w: (u, v) => [v, 3 - u], e: (u, v) => [3 - v, u] };
const rotVec = { n: ([a, b]) => [a, b], s: ([a, b]) => [-a, -b], w: ([a, b]) => [b, -a], e: ([a, b]) => [-b, a] };
const worldSide = (F, side) => VEC_SIDE(rotVec[F](LOCAL_VEC[side]));

/** Designed layouts: [u, v, base, side]. `side` is null for single-cell pieces (trees). */
export const PARCEL_LAYOUTS = Object.freeze({
    // Fenced along the street with a gate: open ground to cross, cover only at its edge.
    vacant_lot: [[0, 0, 'chainlink', 'front'], [2, 0, 'chainlink', 'front'], [3, 0, 'chainlink', 'front']],
    // Hoarding with a site gate, side fences and a staging line of barriers.
    construction_site: [[0, 0, 'chainlink', 'front'], [1, 0, 'chainlink', 'front'], [3, 0, 'chainlink', 'front'],
        [0, 1, 'chainlink', 'left'], [0, 2, 'chainlink', 'left'], [0, 3, 'chainlink', 'left'],
        [3, 1, 'chainlink', 'right'], [3, 2, 'chainlink', 'right'], [3, 3, 'chainlink', 'right'],
        [1, 2, 'jersey', 'front'], [2, 2, 'jersey', 'front']],
    // A barrier lane along one side and a fenced back boundary with a gate. No dumpsters or bins: lone boxes.
    depot_yard: [[0, 1, 'jersey', 'left'], [0, 2, 'jersey', 'left'], [0, 3, 'jersey', 'left'], [1, 3, 'chainlink', 'back'], [3, 3, 'chainlink', 'back']],
    // An alley is a clear run between buildings.
    alley: [],
    // A small square: planters at the corners of the street edge, two trees with benches facing them, tall planters
    // (full cover) closing the back corners.
    plaza: [[0, 0, 'planter', 'front'], [3, 0, 'planter', 'front'], [1, 1, 'tree', null], [2, 1, 'tree', null],
        [1, 2, 'bench', 'front'], [2, 2, 'bench', 'front'], [0, 3, 'tall_planter', 'back'], [3, 3, 'tall_planter', 'back']],
    subway_plaza: [[0, 0, 'planter', 'front'], [3, 0, 'planter', 'front'], [0, 3, 'bench', 'back'], [3, 3, 'bench', 'back']],
    // Hedged on three sides and open to the street, trees and a bench inside.
    pocket_park: [[0, 0, 'hedge', 'left'], [0, 1, 'hedge', 'left'], [0, 2, 'hedge', 'left'], [0, 3, 'hedge', 'left'],
        [3, 0, 'hedge', 'right'], [3, 1, 'hedge', 'right'], [3, 2, 'hedge', 'right'], [3, 3, 'hedge', 'right'],
        [1, 3, 'hedge', 'back'], [2, 3, 'hedge', 'back'], [1, 1, 'tree', null], [2, 2, 'tree', null], [2, 1, 'bench', 'left']],
    // A fenced garden: fence on the back and sides, a hedge on the street edge with a gap, one tree.
    backyard: [[0, 1, 'fence', 'left'], [0, 2, 'fence', 'left'], [0, 3, 'fence', 'left'], [3, 1, 'fence', 'right'], [3, 2, 'fence', 'right'],
        [3, 3, 'fence', 'right'], [1, 3, 'fence', 'back'], [2, 3, 'fence', 'back'], [0, 0, 'hedge', 'front'], [3, 0, 'hedge', 'front'], [2, 1, 'tree', null]],
    community_garden: [[0, 0, 'tree', null], [3, 0, 'tree', null], [0, 1, 'planter', 'left'], [0, 2, 'planter', 'left'],
        [3, 1, 'planter', 'right'], [3, 2, 'planter', 'right'], [1, 3, 'hedge', 'back'], [2, 3, 'hedge', 'back'],
        [0, 3, 'bench', 'back'], [3, 3, 'bench', 'back']],
    civic_green: [[0, 1, 'tree', null], [3, 1, 'tree', null], [0, 2, 'bench', 'left'], [3, 2, 'bench', 'right'],
        [0, 3, 'low_wall', 'back'], [3, 3, 'low_wall', 'back'], [1, 3, 'hedge', 'back'], [2, 3, 'hedge', 'back']]
});

export const PARCEL_VARIANTS = Object.freeze({
    vacant_lot: [
        PARCEL_LAYOUTS.vacant_lot,
        [[0, 0, 'chainlink', 'front'], [2, 0, 'chainlink', 'front'], [3, 0, 'chainlink', 'front'], [1, 2, 'boulder', null]],
        [[0, 0, 'drystone', 'front'], [3, 0, 'drystone', 'front'], [2, 2, 'tree', null]]
    ],
    construction_site: [
        PARCEL_LAYOUTS.construction_site,
        [[0, 0, 'chainlink', 'front'], [3, 0, 'chainlink', 'front'], [0, 2, 'jersey', 'front'], [2, 2, 'jersey', 'front'], [3, 3, 'tree', null]]
    ],
    depot_yard: [
        PARCEL_LAYOUTS.depot_yard,
        [[0, 1, 'jersey', 'left'], [0, 2, 'jersey', 'left'], [1, 3, 'chainlink', 'back'], [3, 3, 'chainlink', 'back'], { vehicle: 'truck', u: 1, v: 1, dir: 'front' }],
        [[0, 1, 'chainlink', 'left'], [3, 1, 'chainlink', 'right'], [1, 3, 'jersey', 'back'], [2, 3, 'jersey', 'back'], { vehicle: 'abandoned_car', u: 1, v: 1, dir: 'front' }]
    ],
    plaza: [
        PARCEL_LAYOUTS.plaza,
        [[0, 0, 'planter', 'front'], [3, 0, 'planter', 'front'], [1, 1, 'fountain', null], [0, 2, 'bench', 'left'], [3, 2, 'bench', 'right'], [0, 3, 'tall_planter', 'back'], [3, 3, 'tall_planter', 'back']],
        [[0, 0, 'tree', null], [3, 0, 'tree', null], [1, 1, 'cafe_patio', 'front'], [2, 1, 'cafe_patio', 'front'], [0, 3, 'planter', 'back'], [3, 3, 'planter', 'back']]
    ],
    subway_plaza: [
        PARCEL_LAYOUTS.subway_plaza,
        [[0, 0, 'planter', 'front'], [3, 0, 'planter', 'front'], [1, 2, 'bench', 'front'], [2, 2, 'bench', 'front'], [0, 3, 'tall_planter', 'back'], [3, 3, 'tall_planter', 'back']]
    ],
    pocket_park: [
        PARCEL_LAYOUTS.pocket_park,
        [[0, 1, 'hedge', 'left'], [0, 2, 'hedge', 'left'], [3, 1, 'hedge', 'right'], [3, 2, 'hedge', 'right'], [1, 1, 'tree', null], [2, 2, 'tree', null], [1, 3, 'bench', 'back']],
        [[1, 1, 'tree', null], [2, 1, 'tree', null], [0, 3, 'low_wall', 'back'], [3, 3, 'low_wall', 'back'], [1, 2, 'bench', 'front']]
    ],
    backyard: [
        PARCEL_LAYOUTS.backyard,
        [[0, 1, 'fence', 'left'], [0, 2, 'fence', 'left'], [3, 1, 'fence', 'right'], [3, 2, 'fence', 'right'], [1, 1, 'tree', null], [2, 3, 'low_wall', 'back']]
    ],
    // Multi-lot open setpiece variants & single-lot biome variants
    market_square: [
        [[0, 0, 'planter', 'front'], [3, 0, 'planter', 'front'], [1, 1, 'market_stall', 'front'], [2, 1, 'market_stall', 'front'], [0, 3, 'cafe_patio', 'back'], [3, 3, 'cafe_patio', 'back']],
        [[0, 0, 'market_stall', 'left'], [2, 1, 'fountain', null], [0, 3, 'tree', null], [3, 3, 'market_stall', 'back']]
    ],
    civic_plaza: [
        [[0, 0, 'tall_planter', 'front'], [3, 0, 'tall_planter', 'front'], [1, 1, 'fountain', null], [2, 2, 'tree', null], [0, 3, 'bench', 'back'], [3, 3, 'bench', 'back']],
        [[0, 0, 'planter', 'front'], [3, 0, 'tree', null], [1, 2, 'bench', 'front'], [2, 2, 'bench', 'front'], [0, 3, 'tall_planter', 'back'], [3, 3, 'tall_planter', 'back']]
    ],
    transit_bay: [
        [[0, 0, 'jersey', 'front'], [3, 0, 'jersey', 'front'], [1, 3, 'bench', 'back'], [2, 3, 'bench', 'back'], { vehicle: 'bus', u: 0, v: 1, dir: 'front' }],
        [[0, 3, 'planter', 'back'], [3, 3, 'planter', 'back'], { vehicle: 'abandoned_car', u: 1, v: 2, dir: 'front' }]
    ],
    container_depot: [
        [[0, 1, 'jersey', 'left'], [3, 3, 'chainlink', 'back'], { vehicle: 'truck', u: 0, v: 2, dir: 'front' }],
        [[0, 0, 'chainlink', 'front'], [3, 0, 'chainlink', 'front'], { vehicle: 'container', u: 0, v: 2, dir: 'front' }]
    ],
    fuel_forecourt: [
        [[0, 0, 'jersey', 'front'], [3, 0, 'jersey', 'front'], [1, 1, 'fuel_pump', 'front'], [2, 1, 'fuel_pump', 'front'], [0, 3, 'planter', 'back'], [3, 3, 'planter', 'back']],
        [[1, 1, 'fuel_pump', 'front'], [2, 1, 'fuel_pump', 'front'], { vehicle: 'abandoned_car', u: 1, v: 2, dir: 'front' }]
    ],
    checkpoint_yard: [
        [[0, 0, 'checkpoint', 'front'], [3, 0, 'checkpoint', 'front'], [0, 2, 'drystone', 'left'], [3, 2, 'drystone', 'right'], [2, 3, 'boulder', null]],
        [[1, 0, 'checkpoint', 'front'], [2, 0, 'checkpoint', 'front'], { vehicle: 'truck', u: 0, v: 2, dir: 'front' }]
    ],
    canal_dock: [
        [[0, 0, 'jersey', 'front'], [3, 0, 'jersey', 'front'], [1, 2, 'bench', 'front'], [2, 2, 'bench', 'front']],
        [[0, 0, 'planter', 'front'], [3, 0, 'planter', 'front'], { vehicle: 'truck', u: 0, v: 2, dir: 'front' }]
    ],
    frozen_pond: [
        [[0, 0, 'boulder', null], [3, 0, 'tree', null], [0, 3, 'tree', null], [3, 3, 'drystone', 'back']],
        [[0, 1, 'boulder', null], [3, 1, 'boulder', null], [1, 3, 'drystone', 'back'], [2, 3, 'tree', null]]
    ]
});

/** Building-yard edges, by the yard's pool: what stands on the parcel boundary (street edge / other edges). */
const YARD_EDGES = Object.freeze({
    yard_garden: { street: 'hedge', boundary: 'fence', gateEvery: 3 },
    yard_industrial: { street: null, boundary: 'chainlink', gateEvery: 4 },
    yard_paved: { street: 'planter', boundary: null, cornersOnly: true }
});

/** The side of a lot that faces a street (the first neighbouring road lot), or null. */
export function lotFrontage(plot, lot) {
    for (const s of ['s', 'n', 'w', 'e']) { const [dx, dy] = SIDE_VEC[s]; if (plotLot(plot, lot.lx + dx, lot.ly + dy)?.road) return s; }
    return null;
}

/** The piece id a layout entry asks for, in world terms (multi-cell objects pick their axis). */
function pieceId(base, side, F) {
    if (base === 'tree' || base === 'rubble' || base === 'boulder' || base === 'fountain') return base;
    if (base === 'dumpster') return F === 'n' || F === 's' ? 'dumpster_x' : 'dumpster_y';
    if (!side) return BAY_PIECES[base] ? base : null;
    const id = `${base}_${worldSide(F, side)}`;
    return BAY_PIECES[id] ? id : null;
}

function pinVehicle(pins, bayGrid, bx0, by0, u, v, F, base, dir, bayOk) {
    const parts = base === 'bus' ? 4 : base === 'truck' || base === 'container' ? 3 : 2;
    const alongAxis = F === 'n' || F === 's' ? (dir === 'front' || dir === 'back' ? 'x' : 'y') : (dir === 'front' || dir === 'back' ? 'y' : 'x');
    const step = alongAxis === 'x' ? [1, 0] : [0, 1];
    const [si, sj] = toLot[F](u, v);
    const startX = alongAxis === 'x' ? bx0 + Math.min(si, LB - parts) : bx0 + si;
    const startY = alongAxis === 'y' ? by0 + Math.min(sj, LB - parts) : by0 + sj;
    const coords = Array.from({ length: parts }, (_, k) => [startX + step[0] * k, startY + step[1] * k, `${base}_${alongAxis}_${'abcd'[k]}`]);
    if (coords.every(([bx, by, id]) => {
        const bay = bayGrid.at(bx, by), p = BAY_PIECES[id];
        return bay && p && !bay.blocked && !bay.protected.length && !pins.has(`${bx},${by}`) && bayOk(bay, p);
    })) {
        for (const [bx, by, id] of coords) pins.set(`${bx},${by}`, id);
    }
}

/**
 * Pins for every open lot and building yard (bay id → piece id). Pocket and repair pins are merged over these by the
 * caller, so line-of-play cover always wins.
 */
export function planParcelPins(plot, bayGrid, lotKindAt, lotPoolOf, opts = {}) {
    const seed = opts?.seed ?? plot?.seed ?? 1;
    const pins = new Map();
    const bayOk = (bay, p) => {
        if (!p || bay.blocked || bay.cls === 'sidewalk' || bay.cls === 'carriageway' || bay.cls.startsWith('lane_') || bay.cls.startsWith('parking_')) return false;
        const surf = bay.cls.startsWith('parking_') ? 'asphalt' : bay.cls.startsWith('lane_') ? 'lane' : bay.cls;
        if (p.surfaces && !p.surfaces.includes(surf)) return false;
        if (p.cells.some(([x, y]) => bay.protected.some(([px, py]) => px === x && py === y))) return false;
        if ((p.base === 'tree' || p.base === 'dumpster' || p.base === 'fountain') && bay.protected.length) return false;
        return true;
    };
    const set = (bx, by, id) => {
        const bay = bayGrid.at(bx, by), p = BAY_PIECES[id];
        if (!id || !bay || !bayOk(bay, p)) return;
        pins.set(`${bx},${by}`, id);
    };
    for (const lot of plot.lots) {
        if (lot.road) continue;
        const kind = lotKindAt(lot); if (!kind) continue;
        const F = lotFrontage(plot, lot) || 's';
        const bx0 = lot.lx * LB, by0 = lot.ly * LB;
        if (kind === 'container_yard') { containerYard(pins, bayGrid, bx0, by0, F, `${seed}:${lot.lx},${lot.ly}`); continue; }
        const variants = PARCEL_VARIANTS[kind];
        const layout = variants ? variants[hashString(`${seed}:${lot.lx},${lot.ly}:${kind}`) % variants.length] : PARCEL_LAYOUTS[kind];
        if (layout) {
            for (const item of layout) {
                if (!Array.isArray(item) && item?.vehicle) { pinVehicle(pins, bayGrid, bx0, by0, item.u, item.v, F, item.vehicle, item.dir || 'front', bayOk); continue; }
                const [u, v, base, side] = item;
                const [i, j] = toLot[F](u, v);
                set(bx0 + i, by0 + j, pieceId(base, side, F));
            }
            continue;
        }
        // Building parcels: dress the yard edge that is the parcel boundary.
        const yard = YARD_EDGES[lotPoolOf(kind)]; if (!yard) continue;
        for (const s of ['n', 's', 'w', 'e']) {
            const [dx, dy] = SIDE_VEC[s], n = plotLot(plot, lot.lx + dx, lot.ly + dy);
            if (n && !n.road && lotKindAt(n) === kind) continue;          // same parcel continues past this edge
            const base = n?.road ? yard.street : yard.boundary; if (!base) continue;
            for (let t = 0; t < LB; t++) {
                if (yard.cornersOnly && t !== 0 && t !== LB - 1) continue;
                if (yard.gateEvery && t % yard.gateEvery === 1) continue;  // a gate / gap in every run
                const [i, j] = s === 'n' ? [t, 0] : s === 's' ? [t, LB - 1] : s === 'w' ? [0, t] : [LB - 1, t];
                set(bx0 + i, by0 + j, BAY_PIECES[`${base}_${s}`] ? `${base}_${s}` : null);
            }
        }
    }
    return pins;
}

/** Containers in two aisles (X or Y axis by seed/frontage, 3 bays each), the street edge fenced with a gate. */
function containerYard(pins, bayGrid, bx0, by0, F, seed = '1') {
    const alongY = (hashString(`${seed}:caxis`) & 1) === 1;
    const used = new Set();
    if (alongY) {
        const cols = F === 'e' ? [0, 2] : [1, 3], j0 = F === 's' ? 0 : 1;
        for (const i of cols) {
            const parts = ['container_y_a', 'container_y_b', 'container_y_c'].map((id, k) => [bx0 + i, by0 + j0 + k, id]);
            if (parts.every(([bx, by]) => { const b = bayGrid.at(bx, by); return b && !b.blocked && !b.protected.length; })) for (const [bx, by, id] of parts) { pins.set(`${bx},${by}`, id); used.add(`${bx},${by}`); }
        }
    } else {
        const rows = F === 's' ? [0, 2] : [1, 3], i0 = F === 'w' ? 1 : 0;
        for (const j of rows) {
            const parts = ['container_x_a', 'container_x_b', 'container_x_c'].map((id, k) => [bx0 + i0 + k, by0 + j, id]);
            if (parts.every(([bx, by]) => { const b = bayGrid.at(bx, by); return b && !b.blocked && !b.protected.length; })) for (const [bx, by, id] of parts) { pins.set(`${bx},${by}`, id); used.add(`${bx},${by}`); }
        }
    }
    for (let t = 0; t < LB; t++) {
        if (t === 1) continue;
        const [i, j] = F === 'n' ? [t, 0] : F === 's' ? [t, 3] : F === 'w' ? [0, t] : [3, t];
        const bx = bx0 + i, by = by0 + j, b = bayGrid.at(bx, by);
        if (!b || b.blocked || used.has(`${bx},${by}`) || b.protected.length) continue;
        pins.set(`${bx},${by}`, `chainlink_${F}`);
    }
}

/** Street trees on a fixed rhythm (every fourth sidewalk bay), the XCOM 2 roadside cover strip. */
export function planStreetTrees(bayGrid) {
    const pins = new Map();
    for (const b of bayGrid.bays) if (!b.blocked && b.cls === 'sidewalk' && !b.protected.length && (b.bx + b.by) % 4 === 2) pins.set(`${b.bx},${b.by}`, 'tree');
    return pins;
}
