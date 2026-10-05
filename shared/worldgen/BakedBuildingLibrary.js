import { hashWaveSeed } from './WaveFunctionCollapse.js';
import {
    STAIR_CONFIGURATION,
    createStairFlight,
    validateStaircaseRouting
} from './StructuralMatrixRules.js';
import { BAKED_BUILDING_CATALOG_SPECS } from './BakedBuildingCatalog.js';
import {
    normalizeBurgThemeId,
    resolveBurgThemeBuildingStyle
} from './BurgThemeCatalog.js';

// Fixed landmark silhouettes placed by deterministic constraints. These are deliberately code
// authored rather than imported town payloads: FMG-derived area, district, terrain and inhibitor
// fields decide where a blueprint may appear, while the blueprint guarantees an enterable shell.

const BUILDABLE_SYMBOLS = new Set(['G', 'F', 'H', 'S', 'P', '.', ',']);
const APPROACH_SYMBOLS = new Set([...BUILDABLE_SYMBOLS, 'R', ';', ':']);
const WATER_SYMBOLS = new Set(['W', '~', 'B']);
const ROAD_SYMBOLS = new Set(['R', ';', ':']);
const CARDINALS = Object.freeze({
    north: Object.freeze({ x: 0, y: -1 }),
    east: Object.freeze({ x: 1, y: 0 }),
    south: Object.freeze({ x: 0, y: 1 }),
    west: Object.freeze({ x: -1, y: 0 })
});

const DISTRICT_STYLE = Object.freeze({
    castle: Object.freeze({ accent: 0x2f6fce, roofs: Object.freeze(['tower', 'slate', 'copper']), activity: 'guard' }),
    civic: Object.freeze({ accent: 0xf2c35a, roofs: Object.freeze(['copper', 'slate', 'tower']), activity: 'gather' }),
    market: Object.freeze({ accent: 0xf07b4f, roofs: Object.freeze(['market', 'clay', 'copper']), activity: 'trade' }),
    residential: Object.freeze({ accent: 0x4fb7a7, roofs: Object.freeze(['gabled', 'clay', 'slate']), activity: 'home' }),
    artisan: Object.freeze({ accent: 0xb56d43, roofs: Object.freeze(['timber', 'slate', 'thatch']), activity: 'craft' }),
    garden: Object.freeze({ accent: 0x77b84e, roofs: Object.freeze(['thatch', 'gabled', 'copper']), activity: 'grow' }),
    harbor: Object.freeze({ accent: 0x2fa7c4, roofs: Object.freeze(['copper', 'slate', 'clay']), activity: 'dock' })
});

const LEGACY_BLUEPRINTS = [
    blueprint({
        id: 'castle-keep',
        name: 'Crownward Keep',
        layout: [
            '####D####',
            '#.......#',
            '#.......#',
            '#.......#',
            '#.......#',
            '#.......#',
            '#.......#',
            '#.......#',
            '#########'
        ],
        districts: ['castle', 'civic'],
        style: 'stone', stories: 3, archetype: 'manor', architectureStyle: 'keep', roofStyle: 'tower',
        roomType: 'hall', priority: 12, roadRange: 8, terrain: 'settlement'
    }),
    blueprint({
        id: 'market-hall',
        name: 'Festival Market Hall',
        layout: [
            '####D###',
            '#......#',
            '#......#',
            '#......#',
            '#......#',
            '#......#',
            '########'
        ],
        districts: ['market', 'civic'],
        style: 'timber', stories: 2, archetype: 'hall', architectureStyle: 'market', roofStyle: 'market',
        roomType: 'hall', priority: 9.4, roadRange: 5, terrain: 'settlement'
    }),
    blueprint({
        id: 'clocktower',
        name: 'Sunclock Civic Tower',
        layout: [
            '##D##',
            '#...#',
            '#...#',
            '#...#',
            '#...#',
            '#...#',
            '#####'
        ],
        districts: ['civic', 'market'],
        style: 'stone', stories: 3, archetype: 'tower', architectureStyle: 'tower', roofStyle: 'tower',
        roomType: 'hall', priority: 9.1, roadRange: 6, terrain: 'settlement'
    }),
    blueprint({
        id: 'civic-hall',
        name: 'Storybook Civic Hall',
        layout: [
            '###D###',
            '#.....#',
            '#.....#',
            '#.....#',
            '#.....#',
            '#.....#',
            '#######'
        ],
        districts: ['civic', 'garden'],
        style: 'stone', stories: 2, archetype: 'hall', architectureStyle: 'courtyard', roofStyle: 'copper',
        roomType: 'hall', priority: 8.7, roadRange: 6, terrain: 'settlement'
    }),
    blueprint({
        id: 'inn',
        name: 'Wayfarer Inn',
        layout: [
            '###D###',
            '#.....#',
            '#.....#',
            '#.....#',
            '#.....#',
            '#######'
        ],
        districts: ['market', 'residential', 'harbor'],
        style: 'timber', stories: 2, archetype: 'bayfront', architectureStyle: 'bayfront', roofStyle: 'gabled',
        roomType: 'common', priority: 8.5, roadRange: 6, terrain: 'settlement'
    }),
    blueprint({
        id: 'lighthouse',
        name: 'Starwater Lighthouse',
        layout: [
            '##D##',
            '#...#',
            '#...#',
            '#...#',
            '#...#',
            '#...#',
            '#####'
        ],
        districts: ['harbor'],
        style: 'stone', stories: 3, archetype: 'tower', architectureStyle: 'tower', roofStyle: 'copper',
        roomType: 'hall', priority: 10.5, waterRange: 7, terrain: 'coast'
    }),
    blueprint({
        id: 'chapel',
        name: 'Sunpetal Chapel',
        layout: [
            '##D###',
            '#....#',
            '#....#',
            '#....#',
            '#....#',
            '#....#',
            '#....#',
            '######'
        ],
        districts: ['civic', 'garden', 'residential'],
        style: 'stone', stories: 2, archetype: 'manor', architectureStyle: 'gabled', roofStyle: 'copper',
        roomType: 'hall', priority: 8.3, roadRange: 8, terrain: 'highland'
    }),
    blueprint({
        id: 'cabin',
        name: 'Explorer Cabin',
        layout: [
            '##D#',
            '#..#',
            '#..#',
            '#..#',
            '####'
        ],
        districts: ['residential', 'artisan', 'garden'],
        style: 'timber', stories: 1, archetype: 'cottage', architectureStyle: 'gabled', roofStyle: 'thatch',
        roomType: 'common', priority: 6.4, roadRange: 8, terrain: 'settlement'
    })
];

const LEGACY_BLUEPRINT_IDS = new Set(LEGACY_BLUEPRINTS.map((entry) => entry.id));
const RAW_BLUEPRINTS = Object.freeze([
    ...LEGACY_BLUEPRINTS,
    ...BAKED_BUILDING_CATALOG_SPECS
        .filter((spec) => !LEGACY_BLUEPRINT_IDS.has(spec.id))
        .map(blueprint)
]);
const MAX_BLUEPRINT_SHORTLIST = 16;
const DEFAULT_RELIEF_FORMULA_VERSION = 'fmg-burg-relief-v2';

export const BAKED_BUILDING_BLUEPRINTS = Object.freeze(Object.fromEntries(
    RAW_BLUEPRINTS.map((entry) => [entry.id, entry])
));

export const BAKED_BUILDING_BLUEPRINT_IDS = Object.freeze(RAW_BLUEPRINTS.map((entry) => entry.id));

export class BakedBuildingPlacementError extends Error {
    constructor(message, diagnostics, partialPlan) {
        super(message);
        this.name = 'BakedBuildingPlacementError';
        this.code = 'BAKED_MINIMUM_NOT_MET';
        this.diagnostics = diagnostics;
        this.partialPlan = partialPlan;
    }
}

/**
 * Select and place two or three landmark blueprints inside a supplied grid area.
 *
 * `area` accepts `{ col, row, width, height }`, `{ minCol, minRow, maxCol, maxRow }`,
 * or `{ cells: [{ col, row, district? }] }`. Output building x/y coordinates use the
 * centered world convention already consumed by MapData and WorldGenerator. By default an
 * undersupplied plan is returned with an explicit diagnostic shortfall; `requireMinimum: true`
 * promotes that shortfall to a typed `BakedBuildingPlacementError`.
 */
export function createBakedBuildingPlan({
    rows = [],
    elevationRows = [],
    inhibitorRows = [],
    districtRows = [],
    area = null,
    districts = null,
    occupied = [],
    replaceableRoadCells = [],
    seed = 'baked-buildings',
    townId = 'town',
    minBuildings = 2,
    maxBuildings = 3,
    buffer = 1,
    maxInhibitor = 0.68,
    requireMinimum = false,
    compactFirst = false,
    relaxRoadAffinity = false,
    architectureThemeId = null,
    reliefProfile = null,
    maxElevationSpan = 1,
    globalOriginCol = 0,
    globalOriginRow = 0
} = {}) {
    const height = rows.length;
    const width = rows[0]?.length || 0;
    const requestedMin = clampInteger(minBuildings, 0, 4);
    const requestedMax = clampInteger(maxBuildings, requestedMin, 4);
    if (width === 0 || height === 0) {
        return finalizePlan(emptyPlan('empty-grid', requestedMin, requestedMax), requireMinimum);
    }

    const region = normalizeArea(area, width, height);
    if (!region.cells.size) {
        return finalizePlan(emptyPlan('empty-area', requestedMin, requestedMax), requireMinimum);
    }

    const districtSet = normalizeDistricts(districts ?? area?.districts ?? area?.district);
    const occupiedCells = normalizeOccupied(occupied, width, height);
    const safeBuffer = clampInteger(buffer, 0, 3);
    const safeMaxInhibitor = clamp(Number(maxInhibitor), 0, 1);
    const context = {
        rows,
        elevationRows,
        inhibitorRows,
        districtRows,
        region,
        districtSet,
        replaceableRoadCells: normalizeCellKeySet(replaceableRoadCells),
        width,
        height,
        maxInhibitor: safeMaxInhibitor,
        relaxRoadAffinity: relaxRoadAffinity === true,
        architectureThemeId: normalizeBurgThemeId(architectureThemeId, null),
        reliefProfile: normalizeBuildingReliefProfile(reliefProfile),
        maxElevationSpan: clampInteger(maxElevationSpan, 0, 2),
        elevationRejections: { illegalCliff: 0, elevationSpan: 0 },
        seed: String(seed),
        townId: String(townId),
        offsetX: Math.floor(width / 2),
        offsetY: Math.floor(height / 2),
        globalOriginCol: Math.round(Number(globalOriginCol) || 0),
        globalOriginRow: Math.round(Number(globalOriginRow) || 0)
    };

    const rankedBlueprints = RAW_BLUEPRINTS
        .filter((entry) => blueprintMatchesDistrictContext(entry, districtSet))
        .map((entry) => ({
            blueprint: entry,
            score: entry.priority
                + contextTerrainPriority(entry, context)
                // Burg seed has enough influence to keep equal-purpose districts from selecting
                // the same facade family in every town. Fixed keeps and coast/highland affinity
                // still dominate because their explicit priority bonuses are larger.
                + seededUnit(`${seed}:blueprint:${entry.id}`) * 2.8
                - (compactFirst ? entry.width * entry.height * 0.32 : 0)
        }))
        .sort((a, b) => b.score - a.score || a.blueprint.id.localeCompare(b.blueprint.id));
    const blueprintOrder = createBlueprintShortlist(rankedBlueprints, {
        compactFirst,
        districts: districtSet,
        preferCabin: region.cells.size <= 24
    });

    const buildings = [];
    const rejected = {};
    for (const { blueprint: entry } of blueprintOrder) {
        if (buildings.length >= requestedMax) break;
        const candidates = createCandidates(entry, context, occupiedCells, safeBuffer);
        if (!candidates.length) {
            rejected[entry.id] = 'no-valid-placement';
            continue;
        }
        const selected = candidates[0];
        const building = materializeBuilding(entry, selected, context, buildings.length);
        buildings.push(building);
        reserveCandidate(occupiedCells, selected, safeBuffer, width, height);
    }

    // If restrictive districts leave too few choices, re-run compatible non-coastal forms. The
    // area/inhibitor/occupancy rules remain hard constraints; only district affinity is relaxed.
    if (buildings.length < requestedMin) {
        const used = new Set(buildings.map((building) => building.blueprintId));
        const fallbackBlueprints = createBlueprintShortlist(RAW_BLUEPRINTS
            .filter((candidate) => candidate.terrain !== 'coast' && candidate.id !== 'castle-keep')
            .map((blueprint) => ({
                blueprint,
                score: blueprint.priority + seededUnit(`${seed}:fallback:${blueprint.id}`) * 2.8 -
                    (compactFirst ? blueprint.width * blueprint.height * 0.32 : 0)
            }))
            .sort((left, right) => compactFirst
                ? left.blueprint.width * left.blueprint.height - right.blueprint.width * right.blueprint.height ||
                    right.score - left.score
                : right.score - left.score || left.blueprint.id.localeCompare(right.blueprint.id)), {
            compactFirst,
            districts: new Set()
        }).map((entry) => entry.blueprint);
        for (const entry of fallbackBlueprints) {
            if (buildings.length >= Math.min(requestedMin, requestedMax)) break;
            if (used.has(entry.id)) continue;
            const candidates = createCandidates(entry, { ...context, districtSet: new Set() }, occupiedCells, safeBuffer);
            if (!candidates.length) continue;
            const selected = candidates[0];
            buildings.push(materializeBuilding(entry, selected, context, buildings.length));
            reserveCandidate(occupiedCells, selected, safeBuffer, width, height);
            used.add(entry.id);
        }
    }

    // Very small or fragmented settlement areas may only support the minimum 4x5 cabin form.
    // Compact mode permits repeated cabin instances; placement/approach/inhibitor checks remain
    // identical, so this increases count without weakening any spatial constraint.
    if (compactFirst && buildings.length < requestedMin) {
        const cabin = RAW_BLUEPRINTS.find((entry) => entry.id === 'cabin');
        while (cabin && buildings.length < Math.min(requestedMin, requestedMax)) {
            const candidates = createCandidates(cabin, { ...context, districtSet: new Set() }, occupiedCells, safeBuffer);
            if (!candidates.length) break;
            const selected = candidates[0];
            buildings.push(materializeBuilding(cabin, selected, context, buildings.length));
            reserveCandidate(occupiedCells, selected, safeBuffer, width, height);
        }
    }

    const plan = {
        buildings,
        occupied: occupiedCells,
        diagnostics: {
            requested: { min: requestedMin, max: requestedMax },
            placed: buildings.length,
            complete: buildings.length >= requestedMin,
            blueprintIds: buildings.map((building) => building.blueprintId),
            reservedApproachCells: buildings.map((building) => building.entrance.approachGrid.join(',')),
            rejected,
            catalogSize: RAW_BLUEPRINTS.length,
            shortlistSize: blueprintOrder.length,
            areaCells: region.cells.size,
            maxInhibitor: safeMaxInhibitor,
            architectureThemeId: context.architectureThemeId,
            reliefFormulaVersion: context.reliefProfile.formulaVersion,
            reliefScore: context.reliefProfile.reliefScore,
            reliefClass: context.reliefProfile.reliefClass,
            targetTierSpan: context.reliefProfile.targetTierSpan,
            maxElevationSpan: context.maxElevationSpan,
            illegalCliffCandidates: context.elevationRejections.illegalCliff,
            elevationSpanCandidates: context.elevationRejections.elevationSpan,
            buildingBaseElevationMinimum: buildings.length
                ? Math.min(...buildings.map((building) => building.baseElevation))
                : null,
            buildingBaseElevationMaximum: buildings.length
                ? Math.max(...buildings.map((building) => building.baseElevation))
                : null,
            strategy: compactFirst ? 'compact-first' : 'landmark-first'
        }
    };
    return finalizePlan(plan, requireMinimum);
}

export function placeBakedBuildingsInArea(options = {}) {
    return createBakedBuildingPlan(options).buildings;
}

/**
 * Materialize a named code-authored blueprint at an exact parser-reserved plot. This is used for
 * fixed skeleton landmarks such as a seat's keep: variant seeds may restyle its facade, but may
 * never move its footprint, door approach or stair routing.
 */
export function createFixedBakedBuilding({
    blueprintId,
    centerCol,
    centerRow,
    rotation = 0,
    width,
    height,
    elevationRows = [],
    seed = 'fixed-baked-building',
    townId = 'town',
    district = 'castle',
    architectureThemeId = null,
    reliefProfile = null,
    maxElevationSpan = 1,
    index = 0
} = {}) {
    const entry = BAKED_BUILDING_BLUEPRINTS[blueprintId];
    if (!entry) throw new Error(`Unknown baked building blueprint ${String(blueprintId)}.`);
    const safeWidth = Math.max(1, Math.floor(Number(width) || elevationRows[0]?.length || 1));
    const safeHeight = Math.max(1, Math.floor(Number(height) || elevationRows.length || 1));
    const shape = rotateBlueprint(entry, clampInteger(rotation, 0, 3));
    const col = Math.round(Number(centerCol) || 0) - Math.floor(shape.width / 2);
    const row = Math.round(Number(centerRow) || 0) - Math.floor(shape.height / 2);
    const direction = CARDINALS[shape.door.edge];
    const approach = {
        col: col + shape.door.x + direction.x,
        row: row + shape.door.y + direction.y
    };
    if (col < 0 || row < 0 || col + shape.width > safeWidth || row + shape.height > safeHeight ||
        approach.col < 0 || approach.row < 0 || approach.col >= safeWidth || approach.row >= safeHeight) {
        throw new Error(`Fixed baked blueprint ${entry.id} does not fit its reserved plot.`);
    }
    const elevations = shape.footprintCells.map((cell) =>
        Number(elevationRows[row + cell.y]?.[col + cell.x]) || 0);
    const elevationSafety = analyzeFootprintElevation(
        shape.footprintCells.map((cell) => ({ col: col + cell.x, row: row + cell.y })),
        elevationRows
    );
    const safeMaximumSpan = clampInteger(maxElevationSpan, 0, 2);
    if (elevationSafety.maxAdjacentDelta > 1 || elevationSafety.span > safeMaximumSpan) {
        throw new Error(
            `Fixed baked blueprint ${entry.id} crosses an illegal elevation cliff ` +
            `(span ${elevationSafety.span}, edge ${elevationSafety.maxAdjacentDelta}).`
        );
    }
    const baseElevation = mode(elevations);
    const candidate = {
        col,
        row,
        rotation: shape.rotation,
        shape,
        approach,
        district,
        baseElevation,
        inhibitor: 0,
        approachInhibitor: 0,
        elevationSpan: elevationSafety.span,
        maxAdjacentElevationDelta: elevationSafety.maxAdjacentDelta,
        waterDistance: Infinity,
        roadDistance: 0
    };
    const context = {
        seed: String(seed),
        townId: String(townId),
        districtSet: new Set([district]),
        architectureThemeId: normalizeBurgThemeId(architectureThemeId, null),
        reliefProfile: normalizeBuildingReliefProfile(reliefProfile),
        offsetX: Math.floor(safeWidth / 2),
        offsetY: Math.floor(safeHeight / 2),
        globalOriginCol: 0,
        globalOriginRow: 0
    };
    const building = materializeBuilding(entry, candidate, context, index);
    return {
        ...building,
        fixedSkeleton: true,
        sourceType: 'fixed-baked-blueprint',
        placementConstraints: {
            ...building.placementConstraints,
            parserReserved: true
        }
    };
}

export function validateBakedBuilding(building) {
    const errors = [];
    const width = Math.max(0, Math.floor(Number(building?.width) || 0));
    const height = Math.max(0, Math.floor(Number(building?.height) || 0));
    const cells = normalizeLocalCells(building?.footprintCells, width, height);
    const footprint = new Set(cells.map(cellKey));
    const door = normalizeLocalCell(building?.door);
    if (!width || !height || !cells.length) errors.push('empty-footprint');
    if (!door || !footprint.has(cellKey(door))) errors.push('missing-door');
    if (door && !isBoundaryCell(door, footprint)) errors.push('door-not-on-boundary');

    const stairCells = collectStructuralStairCells(building);
    const blocked = new Set(stairCells.map(cellKey));
    const interiors = cells.filter((cell) => !isBoundaryCell(cell, footprint));
    const enterableSpace = findOpenRectangle(
        interiors.filter((cell) => !blocked.has(cellKey(cell))),
        width,
        height
    );
    if (Math.min(enterableSpace.width, enterableSpace.height) < 2 ||
        Math.max(enterableSpace.width, enterableSpace.height) < 3) {
        errors.push('interior-smaller-than-2x3');
    }
    if (door && !hasInteriorDoorLanding(door, building?.door?.edge, new Set(interiors.map(cellKey)))) {
        errors.push('door-has-no-interior-landing');
    }
    const stories = Math.max(1, Math.floor(Number(building?.stories) || 1));
    if ((building?.bakedGenerated || building?.sourceType === 'baked-blueprint') && stories > 1) {
        if (!Array.isArray(building?.stairCells) || building.stairCells.length < (stories - 1) * 3) {
            errors.push('missing-explicit-stair-cells');
        }
        const stairLevels = new Set((building?.stairs || []).map((stair) => Math.floor(Number(stair?.level) || 0)));
        for (let level = 0; level < stories - 1; level++) {
            if (!stairLevels.has(level)) errors.push(`missing-stair-level-${level}`);
        }
        const routing = validateStaircaseRouting(building?.stairs || [], {
            baseElevation: Math.max(0, Math.floor(Number(building?.baseElevation) || 0)),
            stories
        });
        if (!routing.valid) errors.push(...routing.issues.map((issue) => `invalid-stair-routing:${issue}`));
    }
    return { valid: errors.length === 0, errors, enterableSpace };
}

export function analyzeBuildingFootprintElevation(worldCells = [], elevationRows = []) {
    return analyzeFootprintElevation(worldCells, elevationRows);
}

function collectStructuralStairCells(building) {
    const cells = [];
    for (const cell of building?.stairCells || []) {
        const normalized = normalizeLocalCell(cell);
        if (normalized) cells.push(normalized);
    }
    for (const stair of building?.stairs || []) {
        const nested = Array.isArray(stair?.cells) && stair.cells.length ? stair.cells : [stair];
        for (const cell of nested) {
            const normalized = normalizeLocalCell(cell);
            if (normalized) cells.push(normalized);
        }
    }
    return [...new Map(cells.map((cell) => [cellKey(cell), cell])).values()];
}

function blueprint(spec) {
    const parsed = parseLayout(spec.layout);
    const catalogFloorPlans = BAKED_BUILDING_CATALOG_SPECS.find((candidate) => candidate.id === spec.id)?.floorPlans;
    const floorPlans = normalizeFloorPlans(spec.floorPlans || catalogFloorPlans, spec.stories, spec.roomType);
    const entry = Object.freeze({
        ...spec,
        layout: Object.freeze([...spec.layout]),
        districts: Object.freeze([...spec.districts]),
        floorPlans,
        width: parsed.width,
        height: parsed.height,
        footprintCells: Object.freeze(parsed.footprintCells.map(Object.freeze)),
        interiorCells: Object.freeze(parsed.interiorCells.map(Object.freeze)),
        door: Object.freeze(parsed.door),
        enterableSpace: Object.freeze(findOpenRectangle(parsed.interiorCells, parsed.width, parsed.height))
    });
    const validation = validateBakedBuilding(entry);
    if (!validation.valid) throw new Error(`Invalid baked building blueprint ${spec.id}: ${validation.errors.join(', ')}`);
    return entry;
}

function parseLayout(layout) {
    if (!Array.isArray(layout) || !layout.length) throw new Error('A baked blueprint requires layout rows.');
    const width = layout[0].length;
    if (width < 4 || layout.some((row) => typeof row !== 'string' || row.length !== width)) {
        throw new Error('Baked blueprint layouts must be rectangular and at least four cells wide.');
    }
    const footprintCells = [];
    const interiorCells = [];
    let door = null;
    for (let y = 0; y < layout.length; y++) {
        for (let x = 0; x < width; x++) {
            const symbol = layout[y][x];
            if (symbol === ' ') continue;
            footprintCells.push({ x, y });
            if (symbol === '.') interiorCells.push({ x, y });
            if (symbol === 'D') {
                if (door) throw new Error('A baked blueprint must have exactly one entrance.');
                door = { x, y, edge: edgeForCell(x, y, width, layout.length) };
            }
        }
    }
    if (!door) throw new Error('A baked blueprint must have exactly one entrance.');
    return { width, height: layout.length, footprintCells, interiorCells, door };
}

function createCandidates(entry, context, occupiedCells, buffer) {
    const candidates = [];
    for (let rotation = 0; rotation < 4; rotation++) {
        const shape = rotateBlueprint(entry, rotation);
        const bounds = context.region.bounds;
        for (let row = bounds.minRow; row <= bounds.maxRow - shape.height + 1; row++) {
            for (let col = bounds.minCol; col <= bounds.maxCol - shape.width + 1; col++) {
                const candidate = evaluateCandidate(entry, shape, col, row, context, occupiedCells, buffer);
                if (candidate) candidates.push(candidate);
            }
        }
    }
    return candidates.sort((a, b) => b.score - a.score || a.row - b.row || a.col - b.col || a.rotation - b.rotation);
}

function evaluateCandidate(entry, shape, col, row, context, occupiedCells, buffer) {
    const worldCells = shape.footprintCells.map((cell) => ({ col: col + cell.x, row: row + cell.y }));
    if (worldCells.some((cell) => !context.region.cells.has(gridKey(cell.col, cell.row)))) return null;
    if (worldCells.some((cell) => {
        const symbol = context.rows[cell.row]?.[cell.col];
        return !BUILDABLE_SYMBOLS.has(symbol) && !(
            symbol === 'R' && context.replaceableRoadCells.has(gridKey(cell.col, cell.row))
        );
    })) return null;
    if (worldCells.some((cell) => neighborhoodOccupied(cell.col, cell.row, occupiedCells, buffer))) return null;

    const inhibitors = worldCells.map((cell) => clamp(Number(context.inhibitorRows[cell.row]?.[cell.col]) || 0, 0, 1));
    if (inhibitors.some((value) => value > context.maxInhibitor)) return null;
    const inhibitor = average(inhibitors);
    const elevations = worldCells.map((cell) => Number(context.elevationRows[cell.row]?.[cell.col]) || 0);
    const elevationSafety = analyzeFootprintElevation(worldCells, context.elevationRows);
    const elevationSpan = elevationSafety.span;
    if (elevationSafety.maxAdjacentDelta > 1) {
        context.elevationRejections.illegalCliff++;
        return null;
    }
    if (elevationSpan > context.maxElevationSpan) {
        context.elevationRejections.elevationSpan++;
        return null;
    }

    const doorDirection = CARDINALS[shape.door.edge];
    const approach = {
        col: col + shape.door.x + doorDirection.x,
        row: row + shape.door.y + doorDirection.y
    };
    if (!context.region.cells.has(gridKey(approach.col, approach.row))) return null;
    if (!APPROACH_SYMBOLS.has(context.rows[approach.row]?.[approach.col])) return null;
    if (occupiedCells.has(gridKey(approach.col, approach.row))) return null;
    const approachInhibitor = clamp(Number(context.inhibitorRows[approach.row]?.[approach.col]) || 0, 0, 1);
    if (approachInhibitor > context.maxInhibitor) return null;

    const center = { col: col + (shape.width - 1) / 2, row: row + (shape.height - 1) / 2 };
    const waterDistance = nearestSymbolDistance(context.rows, center.col, center.row, WATER_SYMBOLS, 10);
    const roadDistance = nearestSymbolDistance(context.rows, approach.col, approach.row, ROAD_SYMBOLS, 10);
    if (entry.terrain === 'coast' && waterDistance > entry.waterRange) return null;
    if (!context.relaxRoadAffinity && entry.roadRange && roadDistance > entry.roadRange) return null;

    const district = resolveCandidateDistrict(center, context);
    if (context.districtSet.size && district && !context.districtSet.has(district)) return null;
    if (district && !entry.districts.includes(district) && context.districtSet.size) return null;
    const areaCenter = context.region.center;
    const centrality = 1 - clamp(Math.hypot(center.col - areaCenter.col, center.row - areaCenter.row) /
        Math.max(1, Math.hypot(context.region.bounds.width, context.region.bounds.height) / 2), 0, 1);
    const elevation = mode(elevations);
    const elevationBias = entry.terrain === 'highland' ? elevation * 0.16 : -elevationSpan * 0.5;
    const reliefScore = context.reliefProfile.reliefScore;
    const terraceScore = reliefScore * (
        elevation * 0.12 - elevationSpan * 0.9 +
        Math.max(0, 2 - Math.abs(elevation - context.reliefProfile.baseElevationTier)) * 0.18
    );
    const terrainScore = entry.terrain === 'coast' ? Math.max(0, entry.waterRange - waterDistance) * 0.72 : 0;
    const roadScore = Number.isFinite(roadDistance) ? Math.max(0, 7 - roadDistance) * 0.22 : 0;
    const doorFacingScore = ROAD_SYMBOLS.has(context.rows[approach.row]?.[approach.col]) ? 1.2 : 0;
    const districtScore = district && entry.districts.includes(district) ? 1.5 : 0;
    const globalCol = col + context.globalOriginCol;
    const globalRow = row + context.globalOriginRow;
    const jitter = seededUnit(`${context.seed}:${entry.id}:${globalCol}:${globalRow}:${shape.rotation}`) * 0.48;
    const score = terrainScore + roadScore + doorFacingScore + districtScore + centrality * 0.9 + elevationBias + terraceScore -
        inhibitor * 4 - approachInhibitor * 2 + jitter;

    return {
        col, row, rotation: shape.rotation, shape, score, approach, district,
        baseElevation: elevation,
        inhibitor,
        approachInhibitor,
        elevationSpan,
        maxAdjacentElevationDelta: elevationSafety.maxAdjacentDelta,
        waterDistance,
        roadDistance
    };
}

function materializeBuilding(entry, candidate, context, index) {
    const shape = candidate.shape;
    const district = candidate.district && entry.districts.includes(candidate.district)
        ? candidate.district
        : entry.districts.find((value) => context.districtSet.has(value)) || entry.districts[0];
    const palette = DISTRICT_STYLE[district] || DISTRICT_STYLE.residential;
    const globalCol = candidate.col + context.globalOriginCol;
    const globalRow = candidate.row + context.globalOriginRow;
    const idHash = hashWaveSeed(`${context.seed}:${context.townId}:${entry.id}:${globalCol}:${globalRow}`);
    const id = `baked-${context.townId}-${entry.id}-${idHash.toString(16).slice(0, 7)}`;
    const themedStyle = context.architectureThemeId
        ? resolveBurgThemeBuildingStyle(context.architectureThemeId, {
            district,
            seed: `${context.seed}:${entry.id}:${idHash}`,
            baseStyle: entry.style,
            baseRoofStyle: entry.roofStyle,
            baseArchitectureStyle: entry.architectureStyle
        })
        : null;
    const themePalette = themedStyle?.themePalette
        ? cloneThemePalette(themedStyle.themePalette)
        : null;
    const stairSystem = createStructuralStairSystem(shape, entry.stories);
    if (!stairSystem) {
        throw new Error(`Baked blueprint ${entry.id} cannot fit a valid structural stair system.`);
    }
    const stairKeys = new Set(stairSystem.stairCells.map(cellKey));
    const interiorRect = findOpenRectangle(
        shape.interiorCells.filter((cell) => !stairKeys.has(cellKey(cell))),
        shape.width,
        shape.height
    );
    return {
        id,
        obstructionTag: `building:baked:${context.townId}:${entry.id}:${index}`,
        name: context.townId === 'town' ? entry.name : `${context.townId} ${entry.name}`,
        x: candidate.col - context.offsetX,
        y: candidate.row - context.offsetY,
        width: shape.width,
        height: shape.height,
        footprintCells: shape.footprintCells.map((cell) => ({ ...cell })),
        stories: entry.stories,
        style: themedStyle?.style || entry.style,
        doorStyle: ['painted', 'oak', 'iron'][idHash % 3],
        door: { ...shape.door },
        stairs: stairSystem.stairs,
        stairCells: stairSystem.stairCells,
        baseElevation: candidate.baseElevation,
        proceduralGenerated: true,
        bakedGenerated: true,
        enterable: true,
        preserveEntrance: true,
        sourceType: 'baked-blueprint',
        blueprintId: entry.id,
        visualProfile: 'rustic-diorama-v2',
        facadeVariant: idHash % 17,
        rotation: candidate.rotation,
        district,
        districtPalette: {
            ...palette,
            accent: Number.isFinite(Number(themePalette?.accentColor))
                ? Number(themePalette.accentColor)
                : palette.accent,
            roofs: themedStyle?.roofStyle ? [themedStyle.roofStyle] : [...palette.roofs]
        },
        activity: palette.activity,
        archetype: entry.archetype,
        architectureStyle: themedStyle?.architectureStyle || entry.architectureStyle,
        roofStyle: themedStyle?.roofStyle || entry.roofStyle,
        ...(themedStyle ? {
            architectureThemeId: themedStyle.architectureThemeId,
            themeLabel: themedStyle.themeLabel,
            roofGeometry: themedStyle.roofGeometry,
            facadeKit: themedStyle.facadeKit,
            castleKit: themedStyle.castleKit,
            themePalette
        } : {}),
        entrance: {
            grid: [shape.door.x, shape.door.y],
            edge: shape.door.edge,
            approach: [candidate.approach.col - context.offsetX, candidate.approach.row - context.offsetY],
            approachGrid: [candidate.approach.col, candidate.approach.row],
            approachReserved: true
        },
        interior: {
            minimumOpenSpan: [Math.min(interiorRect.width, interiorRect.height), Math.max(interiorRect.width, interiorRect.height)],
            openCells: shape.interiorCells.filter((cell) => !stairKeys.has(cellKey(cell))).map((cell) => ({ ...cell })),
            floorHeightVoxels: 2
        },
        floors: createInteriorFloors(entry, interiorRect, shape.door, stairSystem),
        placementConstraints: {
            inhibitor: candidate.inhibitor,
            approachInhibitor: candidate.approachInhibitor,
            elevationSpan: candidate.elevationSpan,
            maxAdjacentElevationDelta: candidate.maxAdjacentElevationDelta ?? 0,
            reliefFormulaVersion: context.reliefProfile?.formulaVersion ?? DEFAULT_RELIEF_FORMULA_VERSION,
            reliefScore: context.reliefProfile?.reliefScore ?? 0,
            reliefClass: context.reliefProfile?.reliefClass ?? 'none',
            targetTierSpan: context.reliefProfile?.targetTierSpan ?? 0,
            waterDistance: candidate.waterDistance,
            roadDistance: candidate.roadDistance
        }
    };
}

function cloneThemePalette(value) {
    return Object.fromEntries(Object.entries(value || {}).map(([key, entry]) => [
        key,
        Array.isArray(entry) ? [...entry] : entry
    ]));
}

function createBlueprintShortlist(ranked, {
    compactFirst = false,
    districts = new Set(),
    preferCabin = false
} = {}) {
    const selected = ranked.slice(0, MAX_BLUEPRINT_SHORTLIST);
    const selectedIds = new Set(selected.map((entry) => entry.blueprint.id));
    const essentialIds = [
        'cabin',
        ...(districts.has('castle') ? ['castle-keep'] : []),
        ...(districts.has('harbor') ? ['lighthouse'] : []),
        ...(districts.has('garden') ? ['chapel'] : [])
    ];
    for (const id of essentialIds) {
        if (selectedIds.has(id)) continue;
        const entry = ranked.find((candidate) => candidate.blueprint.id === id);
        if (!entry) continue;
        selected.push(entry);
        selectedIds.add(id);
    }
    const priorityIds = [
        ...(districts.has('castle') ? ['castle-keep'] : []),
        ...(districts.has('harbor') ? ['lighthouse'] : []),
        ...(districts.has('garden') ? ['chapel'] : []),
        ...(preferCabin ? ['cabin'] : [])
    ];
    const priority = priorityIds
        .map((id) => selected.find((entry) => entry.blueprint.id === id))
        .filter(Boolean);
    if (priority.length) {
        const prioritySet = new Set(priority.map((entry) => entry.blueprint.id));
        selected.splice(0, selected.length, ...priority, ...selected.filter((entry) =>
            !prioritySet.has(entry.blueprint.id)));
    }
    if (compactFirst) {
        selected.sort((left, right) =>
            left.blueprint.width * left.blueprint.height - right.blueprint.width * right.blueprint.height ||
            right.score - left.score || left.blueprint.id.localeCompare(right.blueprint.id));
    }
    return selected;
}

function normalizeFloorPlans(value, stories, roomType = 'common') {
    const count = Math.max(1, Math.floor(Number(stories) || 1));
    const supplied = Array.isArray(value) ? value : [];
    const plans = Array.from({ length: count }, (_, level) => {
        const source = supplied[level] || supplied.at(-1) || [roomType];
        const roomTypes = (Array.isArray(source) ? source : [source])
            .map(String)
            .filter(Boolean);
        return Object.freeze(roomTypes.length ? roomTypes : [String(roomType || 'common')]);
    });
    return Object.freeze(plans);
}

function createInteriorFloors(entry, interiorRect, door, stairSystem) {
    return Array.from({ length: entry.stories }, (_, level) => {
        const requestedTypes = entry.floorPlans?.[level] || [entry.roomType];
        const maximumRooms = Math.max(1, Math.max(interiorRect.width, interiorRect.height));
        const roomTypes = requestedTypes.slice(0, maximumRooms);
        const roomRects = splitInteriorRect(interiorRect, roomTypes.length);
        const rooms = roomRects.map((gridRect, index) => {
            const doors = [];
            if (level === 0 && index === 0) doors.push({ grid: [door.x, door.y], kind: 'exterior' });
            if (index > 0) doors.push({ grid: sharedRoomDoor(roomRects[index - 1], gridRect), kind: 'interior' });
            return {
                id: `floor-${level}-room-${index}`,
                type: roomTypes[index] || entry.roomType,
                gridRect,
                doors
            };
        });
        return {
            level,
            rooms,
            verticalConnections: (stairSystem.stairs || [])
                .filter((stair) => Number(stair.level) === level || Number(stair.level) === level - 1)
                .map((stair) => ({
                    level: stair.level,
                    grid: [stair.x, stair.y],
                    direction: stair.direction
                }))
        };
    });
}

function splitInteriorRect(rect, requestedCount) {
    const horizontal = rect.width >= rect.height;
    const span = horizontal ? rect.width : rect.height;
    const count = clampInteger(requestedCount, 1, Math.max(1, span));
    const base = Math.floor(span / count);
    let remainder = span % count;
    let offset = 0;
    return Array.from({ length: count }, () => {
        const extent = base + (remainder-- > 0 ? 1 : 0);
        const room = horizontal
            ? { x: rect.x + offset, y: rect.y, width: extent, height: rect.height }
            : { x: rect.x, y: rect.y + offset, width: rect.width, height: extent };
        offset += extent;
        return room;
    });
}

function sharedRoomDoor(previous, current) {
    if (previous.x + previous.width === current.x) {
        return [current.x, current.y + Math.floor(current.height / 2)];
    }
    return [current.x + Math.floor(current.width / 2), current.y];
}

function rotateBlueprint(entry, turns) {
    let width = entry.width;
    let height = entry.height;
    let footprintCells = entry.footprintCells.map((cell) => ({ ...cell }));
    let interiorCells = entry.interiorCells.map((cell) => ({ ...cell }));
    let door = { ...entry.door };
    for (let turn = 0; turn < turns; turn++) {
        footprintCells = footprintCells.map((cell) => ({ x: height - 1 - cell.y, y: cell.x }));
        interiorCells = interiorCells.map((cell) => ({ x: height - 1 - cell.y, y: cell.x }));
        door = { x: height - 1 - door.y, y: door.x, edge: rotateEdge(door.edge) };
        [width, height] = [height, width];
    }
    return { rotation: turns, width, height, footprintCells, interiorCells, door };
}

function normalizeArea(area, width, height) {
    const cells = new Set();
    const cellDistricts = new Map();
    if (Array.isArray(area?.cells) && area.cells.length) {
        for (const raw of area.cells) {
            const col = Math.floor(Number(raw?.col ?? raw?.x));
            const row = Math.floor(Number(raw?.row ?? raw?.y));
            if (!Number.isFinite(col) || !Number.isFinite(row) || col < 0 || row < 0 || col >= width || row >= height) continue;
            cells.add(gridKey(col, row));
            if (raw?.district) cellDistricts.set(gridKey(col, row), String(raw.district));
        }
    } else {
        const minCol = clampInteger(area?.minCol ?? area?.col ?? 0, 0, width - 1);
        const minRow = clampInteger(area?.minRow ?? area?.row ?? 0, 0, height - 1);
        const maxCol = clampInteger(area?.maxCol ?? (minCol + Math.max(1, Number(area?.width) || width) - 1), minCol, width - 1);
        const maxRow = clampInteger(area?.maxRow ?? (minRow + Math.max(1, Number(area?.height) || height) - 1), minRow, height - 1);
        for (let row = minRow; row <= maxRow; row++) {
            for (let col = minCol; col <= maxCol; col++) cells.add(gridKey(col, row));
        }
    }
    const points = [...cells].map(parseGridKey);
    if (!points.length) return { cells, cellDistricts, bounds: emptyBounds(), center: { col: 0, row: 0 } };
    const minCol = Math.min(...points.map((point) => point.col));
    const maxCol = Math.max(...points.map((point) => point.col));
    const minRow = Math.min(...points.map((point) => point.row));
    const maxRow = Math.max(...points.map((point) => point.row));
    return {
        cells,
        cellDistricts,
        bounds: { minCol, maxCol, minRow, maxRow, width: maxCol - minCol + 1, height: maxRow - minRow + 1 },
        center: { col: (minCol + maxCol) / 2, row: (minRow + maxRow) / 2 }
    };
}

function normalizeDistricts(values) {
    const list = Array.isArray(values) ? values : values ? [values] : [];
    return new Set(list.map(String).filter(Boolean));
}

function normalizeOccupied(occupied, width, height) {
    if (occupied instanceof Set) return new Set([...occupied].map(String));
    const set = new Set();
    const offsetX = Math.floor(width / 2);
    const offsetY = Math.floor(height / 2);
    for (const value of occupied || []) {
        if (typeof value === 'string') {
            set.add(value);
            continue;
        }
        if (!value || typeof value !== 'object') continue;
        if (Number.isFinite(Number(value.col)) && Number.isFinite(Number(value.row)) && !value.width) {
            set.add(gridKey(Math.floor(value.col), Math.floor(value.row)));
            continue;
        }
        const buildingWidth = Math.max(1, Math.floor(Number(value.width) || 1));
        const buildingHeight = Math.max(1, Math.floor(Number(value.height) || 1));
        const originCol = Math.floor(Number(value.col ?? (Number(value.x) + offsetX)) || 0);
        const originRow = Math.floor(Number(value.row ?? (Number(value.y) + offsetY)) || 0);
        const footprint = normalizeLocalCells(value.footprintCells, buildingWidth, buildingHeight);
        for (const cell of footprint) set.add(gridKey(originCol + cell.x, originRow + cell.y));
    }
    return set;
}

function normalizeCellKeySet(values) {
    const source = values instanceof Set ? [...values] : Array.isArray(values) ? values : [];
    const cells = new Set();
    for (const value of source) {
        if (typeof value === 'string') {
            cells.add(value);
            continue;
        }
        const col = Math.floor(Number(value?.col ?? value?.x));
        const row = Math.floor(Number(value?.row ?? value?.y));
        if (Number.isFinite(col) && Number.isFinite(row)) cells.add(gridKey(col, row));
    }
    return cells;
}

function normalizeBuildingReliefProfile(value) {
    if (!value || typeof value !== 'object') {
        return Object.freeze({
            formulaVersion: DEFAULT_RELIEF_FORMULA_VERSION,
            reliefScore: 0,
            reliefClass: 'none',
            targetTierSpan: 0,
            baseElevationTier: 0
        });
    }
    const reliefScore = clamp(Number(value.reliefScore), 0, 1);
    return Object.freeze({
        formulaVersion: String(value.formulaVersion || DEFAULT_RELIEF_FORMULA_VERSION),
        reliefScore,
        reliefClass: String(value.reliefClass || (reliefScore >= 0.68 ? 'high' : reliefScore >= 0.38 ? 'moderate' : 'low')),
        targetTierSpan: clampInteger(value.targetTierSpan ?? Math.round(1 + reliefScore * 5), 1, 6),
        baseElevationTier: clampInteger(value.baseElevationTier ?? 0, 0, 6)
    });
}

function analyzeFootprintElevation(worldCells, elevationRows) {
    if (!Array.isArray(worldCells) || !worldCells.length) {
        return { minimum: 0, maximum: 0, span: 0, maxAdjacentDelta: 0 };
    }
    const elevations = new Map();
    for (const cell of worldCells) {
        const col = Math.floor(Number(cell?.col));
        const row = Math.floor(Number(cell?.row));
        if (!Number.isFinite(col) || !Number.isFinite(row)) continue;
        elevations.set(gridKey(col, row), Number(elevationRows[row]?.[col]) || 0);
    }
    const values = [...elevations.values()];
    if (!values.length) return { minimum: 0, maximum: 0, span: 0, maxAdjacentDelta: 0 };
    let maxAdjacentDelta = 0;
    for (const [key, value] of elevations) {
        const { col, row } = parseGridKey(key);
        for (const [dx, dy] of [[1, 0], [0, 1]]) {
            const neighbor = elevations.get(gridKey(col + dx, row + dy));
            if (!Number.isFinite(neighbor)) continue;
            maxAdjacentDelta = Math.max(maxAdjacentDelta, Math.abs(value - neighbor));
        }
    }
    const minimum = Math.min(...values);
    const maximum = Math.max(...values);
    return { minimum, maximum, span: maximum - minimum, maxAdjacentDelta };
}

function resolveCandidateDistrict(center, context) {
    const col = Math.round(center.col);
    const row = Math.round(center.row);
    return context.region.cellDistricts.get(gridKey(col, row)) ||
        context.districtRows[row]?.[col] ||
        (context.districtSet.size === 1 ? [...context.districtSet][0] : null);
}

function blueprintMatchesDistrictContext(entry, districts) {
    if (entry.id === 'castle-keep' && !districts.has('castle')) return false;
    return !districts.size || entry.districts.some((district) => districts.has(district));
}

function contextTerrainPriority(entry, context) {
    if (entry.terrain === 'coast') {
        const distance = nearestSymbolDistance(context.rows, context.region.center.col, context.region.center.row, WATER_SYMBOLS, 14);
        return distance <= entry.waterRange + Math.max(context.region.bounds.width, context.region.bounds.height) / 2 ? 5.5 : -20;
    }
    if (entry.terrain === 'highland') {
        const elevations = [...context.region.cells]
            .map(parseGridKey)
            .map((point) => Number(context.elevationRows[point.row]?.[point.col]) || 0);
        return average(elevations) >= 4 ? 3.8 : 0;
    }
    return 0;
}

function reserveCandidate(occupied, candidate, buffer, width, height) {
    // The exterior landing is part of the building's traversal contract. Reserve it even when
    // callers request no footprint buffer so later landmarks can neither cover nor face into it.
    occupied.add(gridKey(candidate.approach.col, candidate.approach.row));
    for (const cell of candidate.shape.footprintCells) {
        const col = candidate.col + cell.x;
        const row = candidate.row + cell.y;
        for (let dy = -buffer; dy <= buffer; dy++) {
            for (let dx = -buffer; dx <= buffer; dx++) {
                const x = col + dx;
                const y = row + dy;
                if (x >= 0 && y >= 0 && x < width && y < height) occupied.add(gridKey(x, y));
            }
        }
    }
}

function neighborhoodOccupied(col, row, occupied, buffer) {
    for (let dy = -buffer; dy <= buffer; dy++) {
        for (let dx = -buffer; dx <= buffer; dx++) {
            if (occupied.has(gridKey(col + dx, row + dy))) return true;
        }
    }
    return false;
}

function createStructuralStairSystem(shape, stories) {
    const transitions = Math.max(0, Math.floor(Number(stories) || 1) - 1);
    if (transitions === 0) return { stairs: [], stairCells: [] };

    const footprintSet = new Set(shape.footprintCells.map(cellKey));
    const variants = [];
    const seenVariants = new Set();
    for (const origin of shape.interiorCells) {
        for (const direction of Object.keys(CARDINALS)) {
            const cells = createStairFlight({
                origin,
                direction,
                climbVoxels: 2,
                footprintSet,
                door: shape.door,
                configuration: STAIR_CONFIGURATION.SOLID_TRIANGULAR,
                level: 0
            });
            if (!cells) continue;
            const keys = cells.map(cellKey).sort();
            const variantKey = `${direction}:${keys.join('|')}`;
            if (seenVariants.has(variantKey)) continue;
            seenVariants.add(variantKey);
            variants.push({
                direction,
                origin: { ...origin },
                cells,
                keys: new Set(keys),
                score: Math.hypot(origin.x - shape.door.x, origin.y - shape.door.y)
            });
        }
    }
    variants.sort((a, b) => b.score - a.score || a.origin.y - b.origin.y || a.origin.x - b.origin.x ||
        a.direction.localeCompare(b.direction));

    let best = null;
    searchStairSystems(0, transitions, variants, [], new Set(), shape, (selection, freeSpace) => {
        const score = freeSpace.area * 100 + selection.reduce((sum, variant) => sum + variant.score, 0);
        if (!best || score > best.score) best = { selection: [...selection], freeSpace, score };
    });
    if (!best) return null;

    const stairs = best.selection.map((variant, level) => {
        const cells = createStairFlight({
            origin: variant.origin,
            direction: variant.direction,
            climbVoxels: 2,
            footprintSet,
            door: shape.door,
            configuration: STAIR_CONFIGURATION.SOLID_TRIANGULAR,
            level
        });
        const lower = cells.find((cell) => cell.role === 'lower-stair');
        return {
            x: lower.x,
            y: lower.y,
            direction: variant.direction,
            level,
            configuration: STAIR_CONFIGURATION.SOLID_TRIANGULAR,
            cells
        };
    });
    const routing = validateStaircaseRouting(stairs, { baseElevation: 0, stories });
    if (!routing.valid) return null;
    return {
        stairs,
        stairCells: stairs.flatMap((stair) => stair.cells.map((cell) => ({ ...cell })))
    };
}

function searchStairSystems(level, transitions, variants, selected, used, shape, accept) {
    if (level >= transitions) {
        const freeSpace = findOpenRectangle(
            shape.interiorCells.filter((cell) => !used.has(cellKey(cell))),
            shape.width,
            shape.height
        );
        if (Math.min(freeSpace.width, freeSpace.height) >= 2 && Math.max(freeSpace.width, freeSpace.height) >= 3) {
            accept(selected, freeSpace);
        }
        return;
    }
    for (const variant of variants) {
        if ([...variant.keys].some((key) => used.has(key))) continue;
        const nextUsed = new Set(used);
        for (const key of variant.keys) nextUsed.add(key);
        selected.push(variant);
        searchStairSystems(level + 1, transitions, variants, selected, nextUsed, shape, accept);
        selected.pop();
    }
}

function findOpenRectangle(cells, width, height) {
    const open = new Set((cells || []).map(cellKey));
    let best = { x: 0, y: 0, width: 0, height: 0, area: 0 };
    for (let top = 0; top < height; top++) {
        for (let left = 0; left < width; left++) {
            if (!open.has(`${left},${top}`)) continue;
            for (let bottom = top; bottom < height; bottom++) {
                for (let right = left; right < width; right++) {
                    const rectWidth = right - left + 1;
                    const rectHeight = bottom - top + 1;
                    const area = rectWidth * rectHeight;
                    if (area <= best.area || !rectangleIsOpen(open, left, top, right, bottom)) continue;
                    best = { x: left, y: top, width: rectWidth, height: rectHeight, area };
                }
            }
        }
    }
    return best;
}

function rectangleIsOpen(open, left, top, right, bottom) {
    for (let y = top; y <= bottom; y++) {
        for (let x = left; x <= right; x++) if (!open.has(`${x},${y}`)) return false;
    }
    return true;
}

function normalizeLocalCells(cells, width, height) {
    if (Array.isArray(cells) && cells.length) {
        return cells
            .map(normalizeLocalCell)
            .filter((cell) => cell && cell.x >= 0 && cell.y >= 0 && cell.x < width && cell.y < height);
    }
    return Array.from({ length: height }, (_, y) => Array.from({ length: width }, (_, x) => ({ x, y }))).flat();
}

function normalizeLocalCell(value) {
    if (!value) return null;
    const x = Math.floor(Number(value.x ?? value[0]));
    const y = Math.floor(Number(value.y ?? value[1]));
    return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
}

function isBoundaryCell(cell, footprint) {
    return Object.values(CARDINALS).some((direction) => !footprint.has(`${cell.x + direction.x},${cell.y + direction.y}`));
}

function hasInteriorDoorLanding(door, edge, interiors) {
    const outside = CARDINALS[edge] || CARDINALS.north;
    return interiors.has(`${door.x - outside.x},${door.y - outside.y}`);
}

function edgeForCell(x, y, width, height) {
    if (y === 0) return 'north';
    if (x === width - 1) return 'east';
    if (y === height - 1) return 'south';
    if (x === 0) return 'west';
    throw new Error('A baked blueprint entrance must be on its boundary.');
}

function rotateEdge(edge) {
    return ({ north: 'east', east: 'south', south: 'west', west: 'north' })[edge] || 'north';
}

function nearestSymbolDistance(rows, centerCol, centerRow, symbols, radius) {
    let nearest = Infinity;
    const startCol = Math.round(centerCol);
    const startRow = Math.round(centerRow);
    for (let row = Math.max(0, startRow - radius); row <= Math.min(rows.length - 1, startRow + radius); row++) {
        for (let col = Math.max(0, startCol - radius); col <= Math.min((rows[row]?.length || 1) - 1, startCol + radius); col++) {
            if (!symbols.has(rows[row]?.[col])) continue;
            nearest = Math.min(nearest, Math.hypot(col - centerCol, row - centerRow));
        }
    }
    return nearest;
}

function mode(values) {
    const counts = new Map();
    for (const value of values) counts.set(value, (counts.get(value) || 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]?.[0] || 0;
}

function average(values) {
    return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function seededUnit(value) {
    return (hashWaveSeed(value) + 0.5) / 4294967296;
}

function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, Number.isFinite(value) ? value : minimum));
}

function clampInteger(value, minimum, maximum) {
    return Math.floor(clamp(Number(value), minimum, maximum));
}

function gridKey(col, row) {
    return `${col},${row}`;
}

function parseGridKey(value) {
    const [col, row] = String(value).split(',').map(Number);
    return { col, row };
}

function cellKey(cell) {
    return `${cell.x},${cell.y}`;
}

function emptyBounds() {
    return { minCol: 0, maxCol: -1, minRow: 0, maxRow: -1, width: 0, height: 0 };
}

function finalizePlan(plan, requireMinimum) {
    const minimum = Math.max(0, Math.floor(Number(plan?.diagnostics?.requested?.min) || 0));
    const placed = Math.max(0, Math.floor(Number(plan?.diagnostics?.placed) || 0));
    const shortfall = Math.max(0, minimum - placed);
    plan.diagnostics.complete = shortfall === 0;
    plan.diagnostics.shortfall = shortfall;
    plan.diagnostics.status = shortfall === 0 ? 'complete' : 'partial';
    if (shortfall > 0 && !plan.diagnostics.reason) plan.diagnostics.reason = 'minimum-not-met';
    if (requireMinimum && shortfall > 0) {
        throw new BakedBuildingPlacementError(
            `Required ${minimum} baked buildings, but only ${placed} valid placements were found.`,
            plan.diagnostics,
            plan
        );
    }
    return plan;
}

function emptyPlan(reason, minimum = 0, maximum = 0) {
    return {
        buildings: [],
        occupied: new Set(),
        diagnostics: {
            requested: { min: minimum, max: maximum },
            placed: 0,
            complete: minimum === 0,
            blueprintIds: [],
            rejected: {},
            areaCells: 0,
            reliefFormulaVersion: DEFAULT_RELIEF_FORMULA_VERSION,
            reliefScore: 0,
            reliefClass: 'none',
            targetTierSpan: 0,
            maxElevationSpan: 1,
            illegalCliffCandidates: 0,
            elevationSpanCandidates: 0,
            reason
        }
    };
}
