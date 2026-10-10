// PLAN-04 §5.3 step 3 — lots (parcels) and bay pieces. A lot is 8 × 8 cells; lot kinds are parcel templates with
// sockets on their sides (street frontage S, building wall W, open margin O, internal P between the parts of a multi-lot
// parcel); building parcels carry a footprint rule in the kit metric (n bays + shell, so facades always tile). Bay
// pieces are the 2 × 2-cell outdoor modules the bay-level WFC places inside lots: cover that represents real objects,
// vehicles, trees and street furniture, with sockets so cars sit on roads, benches face streets and barrier runs join.
//
// Size [along, deep] is in lots relative to the frontage: a 2 × 1 shop row fronting south is 2 lots wide, 1 deep.

export const LOT_KINDS = Object.freeze({
    // ---------------------------------------------------------------- buildings
    office_block: { size: [2, 2], districts: ['commercial'], w: 1.6, building: { program: 'office', along: 13, deep: 9, front: 1, storeys: [3, 4] }, ground: 'concrete', pool: 'yard_paved' },
    apartment: { size: [2, 2], districts: ['residential', 'commercial'], w: 1.3, building: { program: 'apartment', along: 11, deep: 9, front: 2, storeys: [2, 4] }, ground: 'paving', pool: 'yard_paved' },
    warehouse: { size: [2, 2], districts: ['industrial'], w: 2, building: { program: 'warehouse', along: 15, deep: 11, front: 1, storeys: [1, 2] }, ground: 'concrete', pool: 'yard_industrial' },
    house: { size: [2, 2], districts: ['residential'], w: 2.2, building: { program: 'house', along: 13, deep: 9, front: 3, storeys: [1, 2] }, ground: 'lawn', pool: 'yard_garden' },
    shop_row: { size: [2, 1], districts: ['commercial', 'residential'], w: 1.8, building: { program: 'shop', along: 15, deep: 7, front: 1, storeys: [1, 2] }, ground: 'paving', pool: 'yard_paved' },
    diner: { size: [2, 1], districts: ['commercial', 'residential', 'yard'], w: 0.7, building: { program: 'diner', along: 13, deep: 7, front: 1, storeys: [1, 1] }, ground: 'paving', pool: 'yard_paved' },
    garage_row: { size: [2, 1], districts: ['industrial', 'yard'], w: 1.4, building: { program: 'garage', along: 13, deep: 7, front: 1, storeys: [1, 1] }, ground: 'concrete', pool: 'yard_industrial' },
    bungalow: { size: [2, 1], districts: ['residential'], w: 1.2, building: { program: 'house', along: 13, deep: 7, front: 1, storeys: [1, 1] }, ground: 'lawn', pool: 'yard_garden' },
    // ---------------------------------------------------------------- objective parcels (a separate pool, as in XCOM 2)
    objective_office: { size: [2, 2], objective: true, families: ['downtown'], building: { program: 'office', along: 13, deep: 9, front: 1, storeys: [4, 4] }, ground: 'concrete', pool: 'yard_paved' },
    objective_depot: { size: [2, 2], objective: true, families: ['industrial'], building: { program: 'office', along: 13, deep: 9, front: 1, storeys: [3, 3] }, ground: 'concrete', pool: 'yard_industrial' },
    objective_safehouse: { size: [2, 2], objective: true, families: ['suburb'], building: { program: 'house', along: 13, deep: 9, front: 2, storeys: [2, 2] }, ground: 'lawn', pool: 'yard_garden' },
    // ---------------------------------------------------------------- open lots (1 × 1)
    parking_lot: { size: [1, 1], districts: ['commercial', 'industrial', 'yard', 'residential'], w: 1.4, ground: 'asphalt', pool: 'parking', marks: true },
    plaza: { size: [1, 1], districts: ['commercial', 'plaza'], w: 1.4, ground: 'paving', pool: 'plaza' },
    pocket_park: { size: [1, 1], districts: ['residential', 'park', 'plaza'], w: 1.2, ground: 'lawn', pool: 'park' },
    vacant_lot: { size: [1, 1], districts: ['commercial', 'industrial', 'residential', 'yard'], w: 0.6, ground: 'gravel', pool: 'vacant' },
    container_yard: { size: [1, 1], districts: ['industrial', 'yard'], w: 1.6, ground: 'concrete', pool: 'containers' },
    depot_yard: { size: [1, 1], districts: ['industrial', 'yard'], w: 1.5, ground: 'concrete', pool: 'depot' },
    construction_site: { size: [1, 1], districts: ['commercial', 'industrial'], w: 0.6, ground: 'gravel', pool: 'construction' },
    backyard: { size: [1, 1], districts: ['residential', 'park'], w: 1.3, ground: 'lawn', pool: 'garden' },
    alley: { size: [1, 1], districts: ['commercial', 'residential', 'industrial'], w: 0.8, ground: 'paving', pool: 'alley' },
    subway_plaza: { size: [1, 1], districts: ['commercial', 'plaza'], families: ['downtown'], w: 0.6, ground: 'paving', pool: 'plaza', underground: true }
});

/** Which district kinds a plot family can field, and which lots may stand in them. */
export const DISTRICT_KINDS = Object.freeze(['commercial', 'residential', 'industrial', 'yard', 'plaza', 'park']);
export const DISTRICT_WALLS = Object.freeze({
    commercial: ['concrete_wall', 'brick', 'stucco'], residential: ['brick', 'stucco', 'siding'], industrial: ['siding', 'concrete_wall', 'brick'],
    yard: ['siding', 'concrete_wall'], plaza: ['concrete_wall', 'brick'], park: ['brick', 'stucco']
});
export const DISTRICT_PALETTE = Object.freeze({
    commercial: [[0.62, 0.18, 0.16], [0.16, 0.36, 0.52], [0.86, 0.62, 0.2], [0.2, 0.46, 0.38]],
    residential: [[0.36, 0.42, 0.3], [0.58, 0.32, 0.24], [0.3, 0.38, 0.5], [0.74, 0.7, 0.6]],
    industrial: [[0.86, 0.62, 0.16], [0.3, 0.42, 0.56], [0.6, 0.22, 0.16], [0.4, 0.44, 0.4]],
    yard: [[0.86, 0.62, 0.16], [0.6, 0.22, 0.16]], plaza: [[0.16, 0.36, 0.52], [0.2, 0.46, 0.38]], park: [[0.36, 0.42, 0.3], [0.2, 0.46, 0.38]]
});

// ------------------------------------------------------------------------------------------------ bay pieces
// A bay is 2 × 2 cells. `cells` are [dx, dy, stack] in bay coordinates (stack: material keys bottom-up); `make` builds
// a multi-cell object through MapKit instead (cars, containers, dumpsters, trees). `solid` cells are what the
// no-touch socket rule looks at; `cover` is what XCOM's shields will read; `surfaces` are where the piece may stand.
// Line pieces come in four facings: the line sits on that side of the bay, so the other row is the firing position.
const FACING_CELLS = { n: [[0, 0], [1, 0]], s: [[0, 1], [1, 1]], w: [[0, 0], [0, 1]], e: [[1, 0], [1, 1]] };
const line = (id, stack, { cover = 'half', surfaces, w = 1, hazard = null, decor = null } = {}) => Object.fromEntries(Object.entries(FACING_CELLS).map(([f, cells]) =>
    [`${id}_${f}`, { id: `${id}_${f}`, base: id, facing: f, cells: cells.map(([x, y], i) => [x, y, typeof stack === 'function' ? stack(i) : stack]), cover, surfaces, w, run: f === 'n' || f === 's' ? 'x' : 'y', hazard, decor }]));

const WALK = ['sidewalk', 'paving', 'concrete', 'yard'], GREEN = ['lawn', 'yard'], LOTS = ['asphalt', 'concrete', 'gravel', 'yard'];
export const BAY_PIECES = Object.freeze({
    open: { id: 'open', base: 'open', cells: [], cover: null, surfaces: null, w: 1 },
    ...line('planter', ['planter'], { surfaces: [...WALK, 'gravel'], w: 1.2, decor: 'flowers' }),
    ...line('bench', ['bench'], { surfaces: [...WALK, ...GREEN], w: 0.8 }),
    ...line('bins', ['bin'], { surfaces: [...WALK, 'asphalt'], w: 0.7 }),
    ...line('jersey', ['jersey'], { surfaces: ['asphalt', 'concrete', 'gravel', 'sidewalk', 'paving'], w: 1 }),
    ...line('low_wall', ['brick'], { surfaces: [...GREEN, 'paving'], w: 1 }),
    ...line('hedge', ['hedge'], { surfaces: GREEN, w: 1, cover: 'half' }),
    ...line('fence', ['privacy_fence', 'privacy_fence'], { surfaces: GREEN, w: 0.8, cover: 'full' }),
    ...line('sandbags', ['sandbag'], { surfaces: ['gravel', 'concrete', 'asphalt'], w: 0.6 }),
    ...line('crates', ['crate', 'crate'], { surfaces: LOTS, w: 1, cover: 'full' }),
    ...line('pallets', ['pallet'], { surfaces: LOTS, w: 1 }),
    ...line('drums', i => [i ? 'barrel_water' : 'barrel_powder'], { surfaces: LOTS, w: 0.6, hazard: 'explodes' }),
    ...line('vending', ['appliance', 'appliance'], { surfaces: ['sidewalk', 'paving', 'concrete'], w: 0.5, cover: 'full' }),
    ...line('chainlink', ['chainlink', 'chainlink'], { surfaces: ['gravel', 'concrete'], w: 0.6, cover: null }),
    dumpster_x: { id: 'dumpster_x', base: 'dumpster', cells: [[0, 0, ['dumpster']], [1, 0, ['dumpster']]], make: 'dumpster', axis: 'x', cover: 'half', surfaces: [...LOTS, 'paving', 'sidewalk'], w: 0.9, run: null },
    dumpster_y: { id: 'dumpster_y', base: 'dumpster', cells: [[0, 0, ['dumpster']], [0, 1, ['dumpster']]], make: 'dumpster', axis: 'y', cover: 'half', surfaces: [...LOTS, 'paving', 'sidewalk'], w: 0.9, run: null },
    tree: { id: 'tree', base: 'tree', cells: [[0, 0, ['trunk']]], make: 'tree', cover: 'full', surfaces: [...GREEN, 'paving', 'sidewalk'], w: 1, run: null },
    lamp: { id: 'lamp', base: 'lamp', cells: [], decor: 'streetlight', cover: null, surfaces: ['sidewalk', 'paving', 'concrete', 'asphalt'], w: 0.5 },
    bus_stop: { id: 'bus_stop', base: 'bus_stop', cells: [[0, 0, ['bench']], [1, 0, ['bench']]], decor: 'bus_stop', cover: 'half', surfaces: ['sidewalk'], w: 0.4, run: null },
    rubble: { id: 'rubble', base: 'rubble', cells: [[0, 0, ['rubble']], [1, 1, ['rubble']]], cover: null, surfaces: ['gravel', 'concrete'], w: 0.5, run: null },
    // Multi-bay vehicles: two bays per car (4 × 2), three per container (5 × 2 + a cell of air).
    car_x_a: { id: 'car_x_a', base: 'car', part: 0, parts: 2, axis: 'x', make: 'car', cells: [[0, 0, ['car_body']], [1, 0, ['car_body']], [0, 1, ['car_body']], [1, 1, ['car_body']]], cover: 'full', surfaces: ['asphalt', 'lane'], w: 1 },
    car_x_b: { id: 'car_x_b', base: 'car', part: 1, parts: 2, axis: 'x', cells: [[0, 0, ['car_body']], [1, 0, ['car_body']], [0, 1, ['car_body']], [1, 1, ['car_body']]], cover: 'full', surfaces: ['asphalt', 'lane'], w: 1 },
    car_y_a: { id: 'car_y_a', base: 'car', part: 0, parts: 2, axis: 'y', make: 'car', cells: [[0, 0, ['car_body']], [1, 0, ['car_body']], [0, 1, ['car_body']], [1, 1, ['car_body']]], cover: 'full', surfaces: ['asphalt', 'lane'], w: 1 },
    car_y_b: { id: 'car_y_b', base: 'car', part: 1, parts: 2, axis: 'y', cells: [[0, 0, ['car_body']], [1, 0, ['car_body']], [0, 1, ['car_body']], [1, 1, ['car_body']]], cover: 'full', surfaces: ['asphalt', 'lane'], w: 1 },
    container_x_a: { id: 'container_x_a', base: 'container', part: 0, parts: 3, axis: 'x', make: 'container', cells: [[0, 0, ['container']], [1, 0, ['container']], [0, 1, ['container']], [1, 1, ['container']]], cover: 'full', surfaces: ['concrete'], w: 1 },
    container_x_b: { id: 'container_x_b', base: 'container', part: 1, parts: 3, axis: 'x', cells: [[0, 0, ['container']], [1, 0, ['container']], [0, 1, ['container']], [1, 1, ['container']]], cover: 'full', surfaces: ['concrete'], w: 1 },
    container_x_c: { id: 'container_x_c', base: 'container', part: 2, parts: 3, axis: 'x', cells: [[0, 0, ['container']], [0, 1, ['container']]], cover: 'full', surfaces: ['concrete'], w: 1 }
});

/** Bay piece pools per lot kind (or road part): piece base → weight. Facing variants share their base's weight. */
export const PIECE_POOLS = Object.freeze({
    sidewalk: { open: 9, planter: 1.1, bench: 0.6, bins: 0.6, lamp: 0.9, vending: 0.35, bus_stop: 0.25, tree: 0.5 },
    lane: { open: 8, car: 1.3, jersey: 0.35 },
    parking: { open: 4, car: 2.4, planter: 0.4, lamp: 0.3, jersey: 0.3 },
    plaza: { open: 6, planter: 1.4, bench: 1, tree: 0.9, lamp: 0.5, vending: 0.4, low_wall: 0.6 },
    park: { open: 5, tree: 1.6, hedge: 1.3, bench: 0.9, low_wall: 0.6 },
    vacant: { open: 6, rubble: 1, chainlink: 0.7, drums: 0.5, pallets: 0.6, dumpster: 0.4, jersey: 0.5 },
    containers: { open: 4, container: 1.6, crates: 1.2, pallets: 0.8, drums: 0.5 },
    depot: { open: 5, pallets: 1.6, crates: 1.6, drums: 0.7, dumpster: 0.5, jersey: 0.25 },
    construction: { open: 5, jersey: 1.4, sandbags: 0.7, pallets: 1, chainlink: 0.8, crates: 0.6 },
    garden: { open: 5, hedge: 1.2, fence: 1, tree: 0.9, low_wall: 0.6, bench: 0.3 },
    alley: { open: 5, dumpster: 1.4, bins: 1.2, crates: 0.6, pallets: 0.5 },
    yard_paved: { open: 7, planter: 0.9, bins: 0.6, dumpster: 0.5, bench: 0.4, low_wall: 0.4 },
    yard_industrial: { open: 6, pallets: 1.3, crates: 1.3, drums: 0.6, dumpster: 0.4, jersey: 0.25 },
    yard_garden: { open: 5, hedge: 1, fence: 0.8, tree: 0.8, low_wall: 0.5 }
});

/** Lot kinds a family may use (objective kinds excluded). */
export function lotKindsFor(family) {
    return Object.entries(LOT_KINDS).filter(([, k]) => !k.objective && (!k.families || k.families.includes(family))).map(([id]) => id);
}
export const objectiveKindFor = family => Object.entries(LOT_KINDS).find(([, k]) => k.objective && k.families.includes(family))[0];

/** Group extent in lots for a kind facing `front` (n/s: along runs x; e/w: along runs y). */
export function groupSize(kind, front) {
    const [along, deep] = LOT_KINDS[kind].size;
    return front === 'n' || front === 's' ? [along, deep] : [deep, along];
}

/**
 * The building rect (cells) for a parcel template placed on a lot group, plus its side sockets. Footprints are
 * n bays + shell (odd lengths) and never resize; the rest of the group is apron, yard and margins.
 */
export function buildingRect(kind, group, front, shift = 0) {
    const t = LOT_KINDS[kind].building; if (!t) return null;
    const { x0: gx, y0: gy, w: gw, d: gd } = group;
    const ns = front === 'n' || front === 's';
    const w = ns ? t.along : t.deep, d = ns ? t.deep : t.along;
    const slackAlong = (ns ? gw : gd) - t.along, offAlong = Math.max(0, Math.min(slackAlong, (slackAlong >> 1) + shift));
    let x0, y0;
    if (front === 's') { y0 = gy + gd - t.front - d; x0 = gx + offAlong; }
    else if (front === 'n') { y0 = gy + t.front; x0 = gx + offAlong; }
    else if (front === 'e') { x0 = gx + gw - t.front - w; y0 = gy + offAlong; }
    else { x0 = gx + t.front; y0 = gy + offAlong; }
    const margins = { n: y0 - gy, s: gy + gd - (y0 + d), w: x0 - gx, e: gx + gw - (x0 + w) };
    const sockets = Object.fromEntries(Object.entries(margins).map(([side, m]) => [side, side === front ? 'S' : m <= 0 ? 'W' : 'O']));
    return { x0, y0, w, d, margins, sockets };
}
