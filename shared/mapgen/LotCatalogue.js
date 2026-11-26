// PLAN-04 §5.3 step 3 — lots (parcels) and bay pieces. A lot is 8 × 8 cells; lot kinds are parcel templates with
// sockets on their sides (street frontage S, building wall W, open margin O, internal P between the parts of a multi-lot
// parcel); building parcels carry a footprint rule in the kit metric (n bays + shell, so facades always tile). Bay
// pieces are the 2 × 2-cell outdoor modules the bay-level WFC places inside lots: cover that represents real objects,
// vehicles, trees and street furniture, with sockets so cars sit on roads, benches face streets and barrier runs join.
//
// Size [along, deep] is in lots relative to the frontage: a 2 × 1 shop row fronting south is 2 lots wide, 1 deep.

export const LOT_KINDS = Object.freeze({
    // ---------------------------------------------------------------- buildings
    office_block: { size: [2, 2], districts: ['commercial', 'transit', 'canal', 'hillside'], w: 1.6, building: { program: 'office', along: 13, deep: 9, front: 1, storeys: [3, 4], variants: [[13, 9], [11, 9], [13, 7], [9, 9]] }, ground: 'concrete', pool: 'yard_paved' },
    apartment: { size: [2, 2], districts: ['residential', 'commercial', 'transit', 'historic', 'canal', 'highland', 'hillside'], w: 1.3, building: { program: 'apartment', along: 11, deep: 9, front: 2, storeys: [2, 4], variants: [[11, 9], [9, 9], [11, 7]] }, ground: 'paving', pool: 'yard_paved' },
    warehouse: { size: [2, 2], districts: ['industrial', 'dock', 'desert', 'canal', 'basin'], w: 2, building: { program: 'warehouse', along: 15, deep: 11, front: 1, storeys: [1, 2], variants: [[15, 11], [13, 11], [15, 9], [11, 9]] }, ground: 'concrete', pool: 'yard_industrial' },
    house: { size: [2, 2], districts: ['residential', 'alpine', 'historic', 'highland', 'canal', 'hillside'], w: 2.2, building: { program: 'house', along: 13, deep: 9, front: 3, storeys: [1, 2], variants: [[13, 9], [11, 9], [11, 7], [9, 9]] }, ground: 'lawn', pool: 'yard_garden' },
    shop_row: { size: [2, 1], districts: ['commercial', 'residential', 'historic', 'transit', 'dock', 'canal', 'basin', 'hillside'], w: 1.8, building: { program: 'shop', along: 15, deep: 7, front: 1, storeys: [1, 2], variants: [[15, 7], [13, 7], [11, 7]] }, ground: 'paving', pool: 'yard_paved' },
    diner: { size: [2, 1], districts: ['commercial', 'residential', 'yard', 'historic', 'alpine', 'desert', 'highland', 'basin', 'hillside'], w: 0.7, building: { program: 'diner', along: 13, deep: 7, front: 1, storeys: [1, 1] }, ground: 'paving', pool: 'yard_paved' },
    garage_row: { size: [2, 1], districts: ['industrial', 'yard', 'dock', 'desert', 'highland', 'basin'], w: 1.4, building: { program: 'garage', along: 13, deep: 7, front: 1, storeys: [1, 1] }, ground: 'concrete', pool: 'yard_industrial' },
    bungalow: { size: [2, 1], districts: ['residential', 'alpine', 'highland', 'hillside'], w: 1.2, building: { program: 'house', along: 13, deep: 7, front: 1, storeys: [1, 1], variants: [[13, 7], [11, 7], [9, 7]] }, ground: 'lawn', pool: 'yard_garden' },
    tenement: { size: [2, 2], districts: ['residential', 'commercial', 'historic', 'transit', 'canal', 'hillside'], w: 1.1, building: { program: 'apartment', along: 13, deep: 11, front: 1, storeys: [3, 4], variants: [[13, 11], [11, 11], [13, 9]] }, ground: 'paving', pool: 'yard_paved' },
    townhouses: { size: [2, 1], districts: ['residential', 'historic', 'canal', 'highland', 'hillside'], w: 1.0, building: { program: 'house', along: 15, deep: 7, front: 1, storeys: [2, 3] }, ground: 'lawn', pool: 'yard_garden' },
    motel: { size: [2, 1], districts: ['commercial', 'yard', 'desert', 'transit'], w: 0.5, building: { program: 'motel', along: 15, deep: 7, front: 1, storeys: [1, 2] }, ground: 'concrete', pool: 'yard_paved' },
    bar: { size: [2, 1], districts: ['commercial', 'residential', 'dock', 'historic', 'canal', 'hillside'], w: 0.5, building: { program: 'bar', along: 11, deep: 7, front: 1, storeys: [1, 2], variants: [[11, 7], [9, 7]] }, ground: 'paving', pool: 'yard_paved' },
    duplex: { size: [2, 1], districts: ['residential', 'alpine', 'highland', 'hillside'], w: 0.8, building: { program: 'duplex', along: 15, deep: 7, front: 1, storeys: [1, 2], variants: [[15, 7], [13, 7]] }, ground: 'lawn', pool: 'yard_garden' },
    walkup: { size: [2, 2], districts: ['residential', 'historic', 'canal', 'highland', 'hillside'], w: 0.7, building: { program: 'walkup', along: 13, deep: 11, front: 2, storeys: [2, 3], variants: [[13, 11], [13, 9], [11, 11]] }, ground: 'lawn', pool: 'yard_garden' },
    trailer: { size: [2, 1], districts: ['residential', 'yard', 'desert', 'alpine'], w: 0.35, building: { program: 'trailer', along: 13, deep: 5, front: 2, storeys: [1, 1], variants: [[13, 5], [11, 5]] }, ground: 'gravel', pool: 'yard_garden' },
    corner_store: { size: [2, 1], districts: ['commercial', 'residential', 'historic', 'transit', 'canal', 'hillside'], w: 0.6, building: { program: 'corner_store', along: 11, deep: 7, front: 1, storeys: [1, 2], variants: [[11, 7], [9, 7]] }, ground: 'paving', pool: 'yard_paved' },
    laundromat: { size: [2, 1], districts: ['commercial', 'residential', 'transit', 'hillside'], w: 0.45, building: { program: 'laundromat', along: 13, deep: 7, front: 1, storeys: [1, 1], variants: [[13, 7], [11, 7]] }, ground: 'paving', pool: 'yard_paved' },
    lockups: { size: [2, 1], districts: ['industrial', 'yard', 'residential', 'dock', 'desert', 'alpine', 'canal', 'highland', 'basin'], w: 0.5, building: { program: 'lockup', along: 13, deep: 7, front: 1, storeys: [1, 1], variants: [[13, 7], [11, 7]] }, ground: 'concrete', pool: 'yard_industrial' },
    clinic: { size: [2, 2], districts: ['commercial', 'residential', 'alpine', 'transit', 'highland', 'hillside'], w: 1.4, building: { program: 'clinic', along: 15, deep: 9, front: 1, storeys: [1, 2], variants: [[15, 9], [13, 9], [15, 7]] }, ground: 'paving', pool: 'yard_paved' },
    library: { size: [2, 2], districts: ['commercial', 'plaza', 'historic', 'canal', 'hillside'], w: 0.85, building: { program: 'library', along: 13, deep: 11, front: 2, storeys: [1, 2], variants: [[13, 11], [11, 11], [13, 9]] }, ground: 'paving', pool: 'yard_paved' },
    fire_station: { size: [2, 2], districts: ['commercial', 'industrial', 'transit', 'hillside'], w: 0.35, building: { program: 'fire_station', along: 13, deep: 9, front: 1, storeys: [2, 2], variants: [[13, 9], [11, 9]] }, ground: 'concrete', pool: 'yard_paved' },
    police_precinct: { size: [2, 2], districts: ['commercial', 'transit', 'historic', 'hillside'], w: 0.35, building: { program: 'police_precinct', along: 13, deep: 9, front: 1, storeys: [2, 3], variants: [[13, 9], [11, 9]] }, ground: 'concrete', pool: 'yard_paved' },
    pharmacy: { size: [2, 1], districts: ['commercial', 'residential', 'transit', 'hillside', 'canal'], w: 0.55, building: { program: 'pharmacy', along: 13, deep: 7, front: 1, storeys: [1, 2], variants: [[13, 7], [11, 7]] }, ground: 'paving', pool: 'yard_paved' },
    // ---------------------------------------------------------------- objective parcels (a separate pool, as in XCOM 2)
    objective_office: { size: [2, 2], objective: true, families: ['downtown'], building: { program: 'office', along: 13, deep: 9, front: 1, storeys: [4, 4] }, ground: 'concrete', pool: 'yard_paved' },
    objective_depot: { size: [2, 2], objective: true, families: ['industrial'], building: { program: 'office', along: 13, deep: 9, front: 1, storeys: [3, 3] }, ground: 'concrete', pool: 'yard_industrial' },
    objective_safehouse: { size: [2, 2], objective: true, families: ['suburb'], building: { program: 'house', along: 13, deep: 9, front: 2, storeys: [2, 2] }, ground: 'lawn', pool: 'yard_garden' },
    objective_harbor_control: { size: [2, 2], objective: true, families: ['harbor'], building: { program: 'office', along: 13, deep: 9, front: 1, storeys: [3, 3] }, ground: 'concrete', pool: 'yard_paved' },
    objective_research_station: { size: [2, 2], objective: true, families: ['winter_outpost'], building: { program: 'clinic', along: 13, deep: 9, front: 1, storeys: [2, 2] }, ground: 'snow', pool: 'yard_paved' },
    objective_civic_hall: { size: [2, 2], objective: true, families: ['old_quarter'], building: { program: 'library', along: 13, deep: 11, front: 2, storeys: [3, 3] }, ground: 'cobble', pool: 'yard_paved' },
    objective_transit_hq: { size: [2, 2], objective: true, families: ['metro_hub'], building: { program: 'office', along: 13, deep: 9, front: 1, storeys: [3, 3] }, ground: 'paving', pool: 'yard_paved' },
    objective_command_bunker: { size: [2, 2], objective: true, families: ['arid_compound'], building: { program: 'office', along: 13, deep: 9, front: 1, storeys: [2, 2] }, ground: 'sand', pool: 'yard_industrial' },
    objective_lockhouse: { size: [2, 2], objective: true, families: ['canal_district'], building: { program: 'office', along: 13, deep: 9, front: 1, storeys: [3, 3] }, ground: 'cobble', pool: 'yard_paved' },
    objective_ridge_relay: { size: [2, 2], objective: true, families: ['hillside_ridge'], building: { program: 'clinic', along: 13, deep: 9, front: 1, storeys: [3, 3] }, ground: 'gravel', pool: 'yard_industrial' },
    objective_basin_control: { size: [2, 2], objective: true, families: ['sunken_basin'], building: { program: 'office', along: 13, deep: 9, front: 1, storeys: [3, 3] }, ground: 'concrete', pool: 'yard_industrial' },
    objective_hilltop_tower: { size: [2, 2], objective: true, families: ['hillside_avenue'], building: { program: 'office', along: 13, deep: 9, front: 1, storeys: [3, 3] }, ground: 'paving', pool: 'yard_paved' },
    // ---------------------------------------------------------------- open lots (1 × 1 & multi-lot setpieces)
    parking_lot: { size: [1, 1], roadFront: true, districts: ['commercial', 'industrial', 'yard', 'residential', 'transit', 'dock', 'canal', 'basin', 'hillside'], w: 1.4, ground: 'asphalt', pool: 'parking', marks: true },
    plaza: { size: [1, 1], districts: ['commercial', 'plaza', 'historic', 'transit', 'canal', 'highland', 'hillside'], w: 1.4, ground: 'paving', pool: 'plaza' },
    pocket_park: { size: [1, 1], districts: ['residential', 'park', 'plaza', 'alpine', 'historic', 'canal', 'highland', 'hillside'], w: 1.2, ground: 'lawn', pool: 'park' },
    vacant_lot: { size: [1, 1], districts: ['commercial', 'industrial', 'residential', 'yard', 'dock', 'alpine', 'historic', 'transit', 'desert', 'canal', 'highland', 'basin', 'hillside'], w: 0.6, ground: 'gravel', pool: 'vacant' },
    container_yard: { size: [1, 1], districts: ['industrial', 'yard', 'dock', 'canal', 'basin'], w: 1.6, ground: 'concrete', pool: 'containers' },
    depot_yard: { size: [1, 1], roadFront: true, districts: ['industrial', 'yard', 'dock', 'desert', 'basin', 'highland'], w: 1.5, ground: 'concrete', pool: 'depot' },
    construction_site: { size: [1, 1], roadFront: true, districts: ['commercial', 'industrial', 'transit', 'desert', 'hillside'], w: 0.6, ground: 'gravel', pool: 'construction' },
    backyard: { size: [1, 1], districts: ['residential', 'park', 'alpine', 'highland', 'hillside'], w: 1.3, ground: 'lawn', pool: 'garden' },
    community_garden: { size: [1, 1], districts: ['residential', 'park', 'commercial', 'historic', 'hillside'], w: 0.55, ground: 'lawn', pool: 'garden' },
    civic_green: { size: [1, 1], districts: ['commercial', 'plaza', 'park', 'residential', 'historic', 'hillside'], w: 0.65, ground: 'lawn', pool: 'park' },
    alley: { size: [1, 1], districts: ['commercial', 'residential', 'industrial', 'historic', 'dock', 'transit', 'desert', 'canal', 'highland', 'basin', 'hillside'], w: 0.8, ground: 'paving', pool: 'alley' },
    subway_plaza: { size: [1, 1], districts: ['commercial', 'plaza', 'transit'], families: ['downtown', 'metro_hub'], w: 0.8, ground: 'paving', pool: 'plaza', underground: true },
    market_square: { size: [2, 1], districts: ['historic', 'commercial', 'plaza', 'hillside'], families: ['old_quarter', 'downtown', 'hillside_avenue'], w: 1.5, ground: 'cobble', pool: 'market' },
    civic_plaza: { size: [2, 2], districts: ['plaza', 'commercial', 'historic', 'transit', 'hillside'], families: ['downtown', 'old_quarter', 'metro_hub', 'hillside_avenue'], w: 1.1, ground: 'paving', pool: 'plaza' },
    transit_bay: { size: [2, 1], districts: ['transit', 'commercial', 'dock', 'hillside'], families: ['metro_hub', 'downtown', 'harbor', 'hillside_avenue'], w: 1.5, ground: 'asphalt', pool: 'parking' },
    container_depot: { size: [2, 1], districts: ['dock', 'industrial', 'yard'], families: ['harbor', 'industrial'], w: 1.6, ground: 'concrete', pool: 'containers' },
    fuel_forecourt: { size: [2, 1], districts: ['yard', 'industrial', 'desert', 'commercial'], families: ['industrial', 'arid_compound', 'downtown'], w: 1.2, ground: 'concrete', pool: 'forecourt' },
    checkpoint_yard: { size: [2, 1], districts: ['desert', 'alpine', 'transit', 'yard', 'basin', 'highland'], families: ['arid_compound', 'winter_outpost', 'metro_hub', 'industrial', 'sunken_basin', 'hillside_ridge'], w: 1.4, ground: 'gravel', pool: 'checkpoint' },
    canal_dock: { size: [2, 1], districts: ['dock', 'yard', 'canal'], families: ['harbor', 'canal_district'], w: 1.7, ground: 'deck', pool: 'dock_open' },
    frozen_pond: { size: [2, 1], districts: ['alpine', 'park'], families: ['winter_outpost'], w: 1.5, ground: 'snow', pool: 'pond' },
    canal_quay: { size: [2, 1], districts: ['canal', 'dock'], families: ['canal_district', 'harbor'], w: 1.8, ground: 'cobble', pool: 'dock_open' },
    canal_promenade: { size: [1, 1], districts: ['canal', 'plaza'], families: ['canal_district'], w: 1.5, ground: 'paving', pool: 'plaza' },
    hill_terrace: { size: [1, 1], districts: ['highland', 'park', 'hillside'], families: ['hillside_ridge', 'hillside_avenue'], w: 1.6, ground: 'lawn', pool: 'park' },
    lower_field: { size: [2, 1], districts: ['basin', 'highland', 'yard'], families: ['sunken_basin', 'hillside_ridge'], w: 1.6, ground: 'concrete', pool: 'vacant' },
    courtyard_park: { size: [2, 1], districts: ['residential', 'park', 'plaza', 'historic', 'hillside', 'canal'], w: 1.1, ground: 'lawn', pool: 'park' },
    amphitheater_steps: { size: [2, 1], districts: ['plaza', 'park', 'hillside', 'highland', 'historic'], w: 0.9, ground: 'paving', pool: 'plaza' },
    loading_yard: { size: [2, 1], roadFront: true, districts: ['industrial', 'yard', 'dock', 'basin'], w: 1.2, ground: 'concrete', pool: 'depot' },
    motor_pool: { size: [2, 1], roadFront: true, districts: ['industrial', 'yard', 'desert', 'transit', 'basin'], w: 1.1, ground: 'asphalt', pool: 'parking' },
    overlook_plaza: { size: [1, 1], districts: ['hillside', 'highland', 'plaza', 'canal'], w: 1.2, ground: 'paving', pool: 'plaza' }
});

/** PLAN-14: what the attached lower wing of a merged parcel houses, by the main block's programme. */
export const WING_PROGRAM = Object.freeze({ office: 'shop', apartment: 'shop', house: 'garage', warehouse: 'garage', shop: 'diner', motel: 'diner', bar: 'shop',
    duplex: 'lockup', walkup: 'laundromat', trailer: 'lockup', corner_store: 'lockup', laundromat: 'corner_store', lockup: 'lockup', clinic: 'office', library: 'office',
    fire_station: 'garage', police_precinct: 'office', pharmacy: 'corner_store' });

/** Which district kinds a plot family can field, and which lots may stand in them. */
export const DISTRICT_KINDS = Object.freeze(['commercial', 'residential', 'industrial', 'yard', 'plaza', 'park', 'dock', 'alpine', 'historic', 'transit', 'desert', 'canal', 'highland', 'basin', 'hillside']);
export const DISTRICT_WALLS = Object.freeze({
    commercial: ['concrete_wall', 'brick'], residential: ['brick', 'stucco', 'siding'], industrial: ['siding', 'concrete_wall', 'brick'],
    yard: ['siding', 'concrete_wall'], plaza: ['concrete_wall', 'brick'], park: ['brick', 'stucco'],
    dock: ['siding', 'concrete_wall', 'brick'], alpine: ['timber', 'stone', 'brick'], historic: ['stone', 'brick', 'city_wall'],
    transit: ['concrete_wall', 'brick', 'siding'], desert: ['drystone', 'concrete_wall', 'timber'],
    canal: ['stone', 'brick', 'city_wall'], highland: ['stone', 'timber', 'drystone'], basin: ['concrete_wall', 'siding', 'stone'],
    hillside: ['brick', 'siding', 'concrete_wall']
});
export const DISTRICT_PALETTE = Object.freeze({
    commercial: [[0.62, 0.18, 0.16], [0.16, 0.36, 0.52], [0.86, 0.62, 0.2], [0.2, 0.46, 0.38]],
    residential: [[0.36, 0.42, 0.3], [0.58, 0.32, 0.24], [0.3, 0.38, 0.5], [0.74, 0.7, 0.6]],
    industrial: [[0.86, 0.62, 0.16], [0.3, 0.42, 0.56], [0.6, 0.22, 0.16], [0.4, 0.44, 0.4]],
    yard: [[0.86, 0.62, 0.16], [0.6, 0.22, 0.16]], plaza: [[0.16, 0.36, 0.52], [0.2, 0.46, 0.38]], park: [[0.36, 0.42, 0.3], [0.2, 0.46, 0.38]],
    dock: [[0.16, 0.36, 0.52], [0.86, 0.52, 0.16], [0.22, 0.45, 0.45]],
    alpine: [[0.58, 0.28, 0.2], [0.22, 0.42, 0.36], [0.25, 0.38, 0.54]],
    historic: [[0.64, 0.26, 0.2], [0.26, 0.42, 0.36], [0.74, 0.58, 0.28]],
    transit: [[0.16, 0.42, 0.58], [0.86, 0.64, 0.18], [0.22, 0.48, 0.4]],
    desert: [[0.76, 0.42, 0.24], [0.56, 0.52, 0.32], [0.68, 0.3, 0.22]],
    canal: [[0.2, 0.44, 0.56], [0.68, 0.34, 0.24], [0.28, 0.48, 0.4]],
    highland: [[0.46, 0.52, 0.34], [0.58, 0.38, 0.26], [0.32, 0.44, 0.5]],
    basin: [[0.34, 0.42, 0.48], [0.76, 0.54, 0.22], [0.42, 0.48, 0.42]],
    hillside: [[0.74, 0.52, 0.32], [0.24, 0.46, 0.54], [0.62, 0.26, 0.22], [0.34, 0.5, 0.4]]
});

// ------------------------------------------------------------------------------------------------ bay pieces
// A bay is 2 × 2 cells. `cells` are [dx, dy, stack] in bay coordinates (stack: material keys bottom-up); `make` builds
// a multi-cell object through MapKit instead (cars, containers, dumpsters, trees). `solid` cells are what the
// no-touch socket rule looks at; `cover` is what XCOM's shields will read; `surfaces` are where the piece may stand.
// Line pieces come in four facings: the line sits on that side of the bay, so the other row is the firing position.
const FACING_CELLS = { n: [[0, 0], [1, 0]], s: [[0, 1], [1, 1]], w: [[0, 0], [0, 1]], e: [[1, 0], [1, 1]] };
const line = (id, stack, { cover = 'half', surfaces, w = 1, hazard = null, decor = null } = {}) => Object.fromEntries(Object.entries(FACING_CELLS).map(([f, cells]) =>
    [`${id}_${f}`, { id: `${id}_${f}`, base: id, facing: f, cells: cells.map(([x, y], i) => [x, y, typeof stack === 'function' ? stack(i) : stack]), cover, surfaces, w, run: f === 'n' || f === 's' ? 'x' : 'y', hazard, decor }]));

const WALK = ['sidewalk', 'paving', 'concrete', 'yard', 'cobble', 'deck'], GREEN = ['lawn', 'yard', 'snow'], LOTS = ['asphalt', 'concrete', 'gravel', 'yard', 'sand', 'snow', 'cobble', 'deck'];
export const BAY_PIECES = Object.freeze({
    open: { id: 'open', base: 'open', cells: [], cover: null, surfaces: null, w: 1 },
    ...line('planter', ['planter'], { surfaces: [...WALK, 'gravel', 'sand', 'snow'], w: 1.2, decor: 'flowers' }),
    ...line('bench', ['bench'], { surfaces: [...WALK, ...GREEN], w: 0.8 }),
    ...line('bins', ['bin'], { surfaces: [...WALK, 'asphalt'], w: 0.7 }),
    ...line('jersey', ['jersey'], { surfaces: ['asphalt', 'concrete', 'gravel', 'sidewalk', 'paving', 'cobble', 'deck', 'sand', 'snow'], w: 1 }),
    ...line('low_wall', ['brick'], { surfaces: [...GREEN, 'paving', 'cobble', 'sand'], w: 1 }),
    ...line('hedge', ['hedge'], { surfaces: GREEN, w: 1, cover: 'half' }),
    ...line('fence', ['privacy_fence', 'privacy_fence'], { surfaces: GREEN, w: 0.8, cover: 'full' }),
    ...line('sandbags', ['sandbag'], { surfaces: ['gravel', 'concrete', 'asphalt', 'sand', 'snow', 'cobble', 'deck'], w: 0.6 }),
    ...line('crates', ['crate', 'crate'], { surfaces: LOTS, w: 1, cover: 'full' }),
    ...line('pallets', ['pallet'], { surfaces: LOTS, w: 1 }),
    ...line('drums', i => [i ? 'barrel_water' : 'barrel_powder'], { surfaces: LOTS, w: 0.6, hazard: 'explodes' }),
    ...line('vending', ['appliance', 'appliance'], { surfaces: ['sidewalk', 'paving', 'concrete'], w: 0.5, cover: 'full' }),
    // PLAN-13: the full cover a paved place really has — a raised, planted concrete planter, two cells high.
    ...line('tall_planter', ['planter', 'planter'], { surfaces: ['sidewalk', 'paving', 'concrete', 'yard', 'cobble', 'deck', 'sand', 'snow'], w: 0.5, cover: 'full' }),
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
    container_x_a: { id: 'container_x_a', base: 'container', part: 0, parts: 3, axis: 'x', make: 'container', cells: [[0, 0, ['container']], [1, 0, ['container']], [0, 1, ['container']], [1, 1, ['container']]], cover: 'full', surfaces: ['concrete', 'gravel', 'asphalt'], w: 1 },
    container_x_b: { id: 'container_x_b', base: 'container', part: 1, parts: 3, axis: 'x', cells: [[0, 0, ['container']], [1, 0, ['container']], [0, 1, ['container']], [1, 1, ['container']]], cover: 'full', surfaces: ['concrete', 'gravel', 'asphalt'], w: 1 },
    container_x_c: { id: 'container_x_c', base: 'container', part: 2, parts: 3, axis: 'x', cells: [[0, 0, ['container']], [0, 1, ['container']]], cover: 'full', surfaces: ['concrete', 'gravel', 'asphalt'], w: 1 },
    container_y_a: { id: 'container_y_a', base: 'container', part: 0, parts: 3, axis: 'y', make: 'container', cells: [[0, 0, ['container']], [1, 0, ['container']], [0, 1, ['container']], [1, 1, ['container']]], cover: 'full', surfaces: ['concrete', 'gravel', 'asphalt'], w: 1 },
    container_y_b: { id: 'container_y_b', base: 'container', part: 1, parts: 3, axis: 'y', cells: [[0, 0, ['container']], [1, 0, ['container']], [0, 1, ['container']], [1, 1, ['container']]], cover: 'full', surfaces: ['concrete', 'gravel', 'asphalt'], w: 1 },
    container_y_c: { id: 'container_y_c', base: 'container', part: 2, parts: 3, axis: 'y', cells: [[0, 0, ['container']], [1, 0, ['container']]], cover: 'full', surfaces: ['concrete', 'gravel', 'asphalt'], w: 1 },
    truck_x_a: { id: 'truck_x_a', base: 'truck', part: 0, parts: 3, axis: 'x', make: 'truck', cells: [[0, 0, ['car_body']], [1, 0, ['car_body']], [0, 1, ['car_body']], [1, 1, ['car_body']]], cover: 'full', surfaces: ['asphalt', 'concrete', 'gravel', 'deck'], w: 0.7 },
    truck_x_b: { id: 'truck_x_b', base: 'truck', part: 1, parts: 3, axis: 'x', cells: [[0, 0, ['car_body']], [1, 0, ['car_body']], [0, 1, ['car_body']], [1, 1, ['car_body']]], cover: 'full', surfaces: ['asphalt', 'concrete', 'gravel', 'deck'], w: 0.7 },
    truck_x_c: { id: 'truck_x_c', base: 'truck', part: 2, parts: 3, axis: 'x', cells: [[0, 0, ['car_body']], [1, 0, ['car_body']], [0, 1, ['car_body']], [1, 1, ['car_body']]], cover: 'full', surfaces: ['asphalt', 'concrete', 'gravel', 'deck'], w: 0.7 },
    truck_y_a: { id: 'truck_y_a', base: 'truck', part: 0, parts: 3, axis: 'y', make: 'truck', cells: [[0, 0, ['car_body']], [1, 0, ['car_body']], [0, 1, ['car_body']], [1, 1, ['car_body']]], cover: 'full', surfaces: ['asphalt', 'concrete', 'gravel', 'deck'], w: 0.7 },
    truck_y_b: { id: 'truck_y_b', base: 'truck', part: 1, parts: 3, axis: 'y', cells: [[0, 0, ['car_body']], [1, 0, ['car_body']], [0, 1, ['car_body']], [1, 1, ['car_body']]], cover: 'full', surfaces: ['asphalt', 'concrete', 'gravel', 'deck'], w: 0.7 },
    truck_y_c: { id: 'truck_y_c', base: 'truck', part: 2, parts: 3, axis: 'y', cells: [[0, 0, ['car_body']], [1, 0, ['car_body']], [0, 1, ['car_body']], [1, 1, ['car_body']]], cover: 'full', surfaces: ['asphalt', 'concrete', 'gravel', 'deck'], w: 0.7 },
    bus_x_a: { id: 'bus_x_a', base: 'bus', part: 0, parts: 4, axis: 'x', make: 'bus', cells: [[0, 0, ['car_body']], [1, 0, ['car_body']], [0, 1, ['car_body']], [1, 1, ['car_body']]], cover: 'full', surfaces: ['asphalt', 'concrete'], w: 0.5 },
    bus_x_b: { id: 'bus_x_b', base: 'bus', part: 1, parts: 4, axis: 'x', cells: [[0, 0, ['car_body']], [1, 0, ['car_body']], [0, 1, ['car_body']], [1, 1, ['car_body']]], cover: 'full', surfaces: ['asphalt', 'concrete'], w: 0.5 },
    bus_x_c: { id: 'bus_x_c', base: 'bus', part: 2, parts: 4, axis: 'x', cells: [[0, 0, ['car_body']], [1, 0, ['car_body']], [0, 1, ['car_body']], [1, 1, ['car_body']]], cover: 'full', surfaces: ['asphalt', 'concrete'], w: 0.5 },
    bus_x_d: { id: 'bus_x_d', base: 'bus', part: 3, parts: 4, axis: 'x', cells: [[0, 0, ['car_body']], [1, 0, ['car_body']], [0, 1, ['car_body']], [1, 1, ['car_body']]], cover: 'full', surfaces: ['asphalt', 'concrete'], w: 0.5 },
    bus_y_a: { id: 'bus_y_a', base: 'bus', part: 0, parts: 4, axis: 'y', make: 'bus', cells: [[0, 0, ['car_body']], [1, 0, ['car_body']], [0, 1, ['car_body']], [1, 1, ['car_body']]], cover: 'full', surfaces: ['asphalt', 'concrete'], w: 0.5 },
    bus_y_b: { id: 'bus_y_b', base: 'bus', part: 1, parts: 4, axis: 'y', cells: [[0, 0, ['car_body']], [1, 0, ['car_body']], [0, 1, ['car_body']], [1, 1, ['car_body']]], cover: 'full', surfaces: ['asphalt', 'concrete'], w: 0.5 },
    bus_y_c: { id: 'bus_y_c', base: 'bus', part: 2, parts: 4, axis: 'y', cells: [[0, 0, ['car_body']], [1, 0, ['car_body']], [0, 1, ['car_body']], [1, 1, ['car_body']]], cover: 'full', surfaces: ['asphalt', 'concrete'], w: 0.5 },
    bus_y_d: { id: 'bus_y_d', base: 'bus', part: 3, parts: 4, axis: 'y', cells: [[0, 0, ['car_body']], [1, 0, ['car_body']], [0, 1, ['car_body']], [1, 1, ['car_body']]], cover: 'full', surfaces: ['asphalt', 'concrete'], w: 0.5 },
    abandoned_car_x_a: { id: 'abandoned_car_x_a', base: 'abandoned_car', part: 0, parts: 2, axis: 'x', make: 'abandoned_car', cells: [[0, 0, ['car_body']], [1, 0, ['car_body']], [0, 1, ['car_body']], [1, 1, ['car_body']]], cover: 'full', surfaces: ['asphalt', 'concrete', 'gravel', 'sand', 'cobble'], w: 0.6 },
    abandoned_car_x_b: { id: 'abandoned_car_x_b', base: 'abandoned_car', part: 1, parts: 2, axis: 'x', cells: [[0, 0, ['car_body']], [1, 0, ['car_body']], [0, 1, ['car_body']], [1, 1, ['car_body']]], cover: 'full', surfaces: ['asphalt', 'concrete', 'gravel', 'sand', 'cobble'], w: 0.6 },
    abandoned_car_y_a: { id: 'abandoned_car_y_a', base: 'abandoned_car', part: 0, parts: 2, axis: 'y', make: 'abandoned_car', cells: [[0, 0, ['car_body']], [1, 0, ['car_body']], [0, 1, ['car_body']], [1, 1, ['car_body']]], cover: 'full', surfaces: ['asphalt', 'concrete', 'gravel', 'sand', 'cobble'], w: 0.6 },
    abandoned_car_y_b: { id: 'abandoned_car_y_b', base: 'abandoned_car', part: 1, parts: 2, axis: 'y', cells: [[0, 0, ['car_body']], [1, 0, ['car_body']], [0, 1, ['car_body']], [1, 1, ['car_body']]], cover: 'full', surfaces: ['asphalt', 'concrete', 'gravel', 'sand', 'cobble'], w: 0.6 },
    boulder: { id: 'boulder', base: 'boulder', cells: [[0, 0, ['rock']], [1, 0, ['rock']]], cover: 'half', surfaces: ['lawn', 'gravel', 'sand', 'snow', 'yard', 'cobble'], w: 0.7, run: null },
    fountain: { id: 'fountain', base: 'fountain', cells: [[0, 0, ['stone']], [1, 0, ['water']], [0, 1, ['water']], [1, 1, ['stone']]], cover: 'half', surfaces: ['paving', 'cobble', 'concrete', 'lawn'], w: 0.5, run: null },
    ...line('drystone', ['drystone'], { surfaces: ['sand', 'gravel', 'lawn', 'snow', 'cobble', 'yard'], w: 0.9 }),
    ...line('bollard', ['steel_post'], { surfaces: [...WALK, 'asphalt', 'gravel', 'sand', 'snow'], cover: 'half', w: 0.9 }),
    ...line('checkpoint', i => [i ? 'jersey' : 'sandbag'], { surfaces: ['gravel', 'concrete', 'asphalt', 'sand', 'snow'], cover: 'half', w: 0.8 }),
    ...line('market_stall', ['stall', 'cloth'], { surfaces: ['cobble', 'paving', 'concrete', 'sidewalk'], cover: 'full', w: 0.8 }),
    ...line('cafe_patio', ['bench'], { surfaces: ['paving', 'cobble', 'sidewalk', 'concrete'], cover: 'half', w: 0.7 }),
    ...line('fuel_pump', ['pump'], { surfaces: ['concrete', 'asphalt', 'gravel'], cover: 'full', w: 0.7 })
});

/** Bay piece pools per lot kind (or road part): piece base → weight. Facing variants share their base's weight. */
export const PIECE_POOLS = Object.freeze({
    // PLAN-10: no crates, pallets or drums outdoors, and nothing standing in the carriageway but parked cars.
    // PLAN-13: no random scatter either. Open lots and yards are laid out by ParcelTemplates (designed parcels);
    // the solver only fills what is left with open ground. Sidewalks get street trees on a rhythm and bus stops;
    // cover along the line of play comes from the pockets and the repair loop.
    sidewalk: { open: 9, bus_stop: 0.25 },
    lane: { open: 8, car: 1.3 },
    parking: { open: 4, car: 2.4 },
    plaza: { open: 1 }, park: { open: 1 }, vacant: { open: 1 }, depot: { open: 1 }, construction: { open: 1 },
    garden: { open: 1 }, alley: { open: 1 }, yard_paved: { open: 1 }, yard_industrial: { open: 1 }, yard_garden: { open: 1 },
    market: { open: 1 }, forecourt: { open: 1 }, checkpoint: { open: 1 }, dock_open: { open: 1 }, pond: { open: 1 },
    containers: { open: 1, container: 0.001 }
});
/** PLAN-10: piece bases never placed outdoors (random clutter). Gates.noClutter checks generated layouts for them. */
export const CLUTTER_BASES = Object.freeze(['crates', 'pallets', 'drums', 'vending']);   // PLAN-13: vending boxes too

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
export function buildingRect(kind, group, front, shift = 0, dims = null) {
    const t0 = LOT_KINDS[kind].building; if (!t0) return null;
    const t = dims ? { ...t0, along: dims[0], deep: dims[1] } : t0;   // PLAN-14: footprint variant
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
