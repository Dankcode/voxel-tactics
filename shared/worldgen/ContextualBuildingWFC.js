import {
    solveWaveFunctionCollapse,
    validateWaveAssignment,
    WaveFunctionCollapseError,
    hashWaveSeed
} from './WaveFunctionCollapse.js';

// Parcel-scale modules let one WFC solve decide between terrain, public space and complete,
// enterable buildings. A building module is never a single wall cell: it carries a validated
// footprint with a one-cell wall ring and a contiguous interior. The smallest cabin therefore
// has a 4x5 exterior and a 2x3 interior.

export const MINIMUM_BUILDING_INTERIOR = Object.freeze({ width: 2, height: 3 });
export const BUILDING_DOOR_EDGES = Object.freeze(['north', 'east', 'south', 'west']);

export const CONTEXTUAL_WFC_MODULES = Object.freeze([
    moduleSpec('terrain-meadow', 'terrain', 1.7, ['land', 'soft']),
    moduleSpec('terrain-grove', 'terrain', 0.9, ['land', 'soft', 'trees']),
    moduleSpec('terrain-path', 'terrain', 1.15, ['land', 'access']),
    moduleSpec('terrain-water', 'terrain', 0.72, ['water']),
    moduleSpec('terrain-relief', 'terrain', 0.62, ['land', 'relief']),
    moduleSpec('settlement-square', 'terrain', 0.82, ['land', 'access', 'settlement']),
    buildingSpec('building-cabin', 2, 3, 2.2, ['home']),
    buildingSpec('building-cottage', 2, 3, 1.92, ['home', 'garden']),
    buildingSpec('building-shop', 2, 3, 1.76, ['craft', 'merchant']),
    buildingSpec('building-house', 3, 4, 1.55, ['home']),
    buildingSpec('building-workshop', 4, 4, 1.0, ['craft']),
    buildingSpec('building-hall', 5, 6, 0.42, ['civic', 'landmark'])
]);

export const CONTEXTUAL_WFC_MODULE_BY_ID = new Map(
    CONTEXTUAL_WFC_MODULES.map((module) => [module.id, module])
);

export class ContextualBuildingWFCError extends Error {
    constructor(message, code = 'CONTEXTUAL_WFC_ERROR', details = {}, cause) {
        super(message, cause ? { cause } : undefined);
        this.name = 'ContextualBuildingWFCError';
        this.code = code;
        this.details = details;
    }
}

/**
 * Keep only numeric, geography-scale signals from an FMG/global-map cell. This function does
 * not import, enumerate or inspect town/building payloads. Unknown keys are intentionally
 * ignored so global JSON acts only as a coherence/entropy inhibitor.
 */
export function normalizeGeographicPrior(value = {}, defaultInhibitor = 0.55) {
    const source = value && typeof value === 'object' ? value : {};
    return Object.freeze({
        land: unit(source.land, 1),
        height: unitHeight(source.height),
        riverInfluence: unit(source.riverInfluence ?? source.river, 0),
        routeInfluence: unit(source.routeInfluence ?? source.route, 0),
        settlementInfluence: unit(source.settlementInfluence ?? source.settlement, 0),
        treeCover: unit(source.treeCover ?? source.forestInfluence, 0.35),
        inhibitor: unit(source.inhibitor ?? source.confidence, defaultInhibitor)
    });
}

/**
 * Normalize the parcel-level entrance contract. `allowedDoorEdges` restricts the facade, while
 * `reservedExteriorApproach` (singular or plural) reserves the traversable cell immediately
 * outside the door. A reservation may be an edge string or `{ edge, x, y }` in world cells.
 * When no reservation is supplied, every allowed edge receives an implicit reservation.
 */
export function normalizeSiteDoorContract(site = {}) {
    const allowedProvided = Object.prototype.hasOwnProperty.call(site, 'allowedDoorEdges');
    const allowedEdges = normalizeDoorEdges(
        allowedProvided ? site.allowedDoorEdges : BUILDING_DOOR_EDGES,
        'allowedDoorEdges'
    );
    const reservationKeys = ['reservedExteriorApproaches', 'reservedExteriorApproach', 'reservedApproachEdges'];
    const reservationKey = reservationKeys.find((key) => Object.prototype.hasOwnProperty.call(site, key));
    const explicitReservations = reservationKey !== undefined;
    const approaches = explicitReservations
        ? normalizeApproachReservations(site[reservationKey], reservationKey)
        : allowedEdges.map((edge) => Object.freeze({ edge, x: null, y: null, explicit: false }));
    const allowed = new Set(allowedEdges);
    const seenApproaches = new Set();
    const reservedExteriorApproaches = approaches
        .filter((approach) => allowed.has(approach.edge))
        .filter((approach) => {
            const key = `${approach.edge}:${String(approach.x)}:${String(approach.y)}`;
            if (seenApproaches.has(key)) return false;
            seenApproaches.add(key);
            return true;
        })
        .sort((left, right) => edgeIndex(left.edge) - edgeIndex(right.edge)
            || finite(left.x, -Infinity) - finite(right.x, -Infinity)
            || finite(left.y, -Infinity) - finite(right.y, -Infinity));
    return Object.freeze({
        allowedDoorEdges: Object.freeze([...allowedEdges]),
        reservedExteriorApproaches: Object.freeze(reservedExteriorApproaches),
        legalDoorEdges: Object.freeze([...new Set(reservedExteriorApproaches.map((approach) => approach.edge))]),
        explicitReservations
    });
}

/**
 * Construct deterministic cardinal/near adjacency for parcel sites. Callers may provide their
 * own neighbors; otherwise sites are linked when their rectangles face one another within the
 * configured gap. Input order never affects the graph.
 */
export function buildContextualSiteGraph(sites = [], { neighborGap = 2 } = {}) {
    const normalized = normalizeSites(sites);
    const siteIds = new Set(normalized.map((site) => site.id));
    const explicit = normalized.some((site) => Array.isArray(site.neighbors));
    if (explicit) {
        return normalized.map((site) => ({
            id: site.id,
            neighbors: (site.neighbors || [])
                .map((neighbor) => typeof neighbor === 'object' ? neighbor : { id: neighbor })
                .filter((neighbor) => siteIds.has(neighbor.id) && neighbor.id !== site.id)
                .sort((a, b) => compareIds(a.id, b.id))
                .map((neighbor) => ({
                    id: neighbor.id,
                    direction: neighbor.direction || directionBetween(site, normalized.find((entry) => entry.id === neighbor.id))
                }))
        }));
    }

    const links = new Map(normalized.map((site) => [site.id, new Map()]));
    const gap = Math.max(0, finite(neighborGap, 2));
    for (let leftIndex = 0; leftIndex < normalized.length; leftIndex++) {
        const left = normalized[leftIndex];
        for (let rightIndex = leftIndex + 1; rightIndex < normalized.length; rightIndex++) {
            const right = normalized[rightIndex];
            if (!rectanglesAreNeighbors(left, right, gap)) continue;
            const leftDirection = directionBetween(left, right);
            links.get(left.id).set(right.id, leftDirection);
            links.get(right.id).set(left.id, oppositeDirection(leftDirection));
        }
    }
    return normalized.map((site) => ({
        id: site.id,
        neighbors: [...links.get(site.id)]
            .sort(([a], [b]) => compareIds(a, b))
            .map(([id, direction]) => ({ id, direction }))
    }));
}

/**
 * Solve terrain and building parcels in a shared WFC. Walled areas constrain parcels to
 * buildings plus access/civic modules, while exterior parcels remain terrain-only. Each area
 * reserves `minimumBuildings` deterministic anchors (two by default) when it has capacity.
 */
export function solveContextualBuildingWFC({
    sites = [],
    areas = [],
    seed = 'contextual-building-wave',
    modules = CONTEXTUAL_WFC_MODULES,
    fixed = new Map(),
    minimumBuildingsPerArea = 2,
    geographicInhibitor = 0.55,
    neighborGap = 2
} = {}) {
    const contract = createContextualContract({
        sites,
        areas,
        seed,
        modules,
        fixed,
        minimumBuildingsPerArea,
        geographicInhibitor,
        neighborGap
    });

    let assignment;
    try {
        assignment = solveWaveFunctionCollapse({
            nodes: contract.nodes,
            tiles: contract.modules,
            domains: contract.domains,
            fixed: contract.fixed,
            seed: `${seed}:parcels`,
            compatible: (leftId, rightId) => contextualModulesCompatible(leftId, rightId, contract.moduleById),
            nodeWeights: (siteId, moduleId) => contract.weights.get(siteId).get(moduleId) || 0
        });
    } catch (error) {
        if (!(error instanceof WaveFunctionCollapseError)) throw error;
        throw new ContextualBuildingWFCError(
            'Contextual building WFC could not satisfy the parcel constraints.',
            error.code,
            { ...error.details, seed: String(seed) },
            error
        );
    }

    const buildings = bakeContextualBuildings({
        assignment,
        sites: contract.sites,
        modules: contract.modules,
        nodes: contract.nodes,
        seed
    });
    const result = {
        assignment,
        buildings,
        diagnostics: buildDiagnostics(contract, assignment, buildings)
    };
    validateContextualBuildingWFC({
        result,
        sites,
        areas,
        seed,
        modules,
        fixed,
        minimumBuildingsPerArea,
        geographicInhibitor,
        neighborGap
    });
    return result;
}

/** Validate an assignment against confinement, capacity, geography and adjacency constraints. */
export function validateContextualAssignment({
    assignment,
    sites = [],
    areas = [],
    seed = 'contextual-building-wave',
    modules = CONTEXTUAL_WFC_MODULES,
    fixed = new Map(),
    minimumBuildingsPerArea = 2,
    geographicInhibitor = 0.55,
    neighborGap = 2
} = {}) {
    const contract = createContextualContract({
        sites,
        areas,
        seed,
        modules,
        fixed,
        minimumBuildingsPerArea,
        geographicInhibitor,
        neighborGap
    });
    try {
        validateWaveAssignment({
            assignment,
            nodes: contract.nodes,
            tiles: contract.modules,
            domains: contract.domains,
            fixed: contract.fixed,
            compatible: (leftId, rightId) => contextualModulesCompatible(leftId, rightId, contract.moduleById)
        });
    } catch (error) {
        if (!(error instanceof WaveFunctionCollapseError)) throw error;
        throw new ContextualBuildingWFCError(
            'Contextual assignment violates its WFC contract.',
            error.code,
            error.details,
            error
        );
    }
    validateAreaMinimums(assignment, contract);
    return true;
}

/** Validate a complete solve result, including non-overlap and enterable interiors. */
export function validateContextualBuildingWFC(options = {}) {
    const { result } = options;
    if (!result || !(result.assignment instanceof Map) || !Array.isArray(result.buildings)) {
        throw new ContextualBuildingWFCError(
            'A contextual WFC result requires an assignment Map and a buildings array.',
            'CONTEXTUAL_WFC_INVALID_RESULT'
        );
    }
    validateContextualAssignment({ ...options, assignment: result.assignment });
    const occupied = new Set();
    const buildingSites = new Set();
    const normalizedSites = normalizeSites(options.sites || []);
    const siteById = new Map(normalizedSites.map((site) => [site.id, site]));
    const expectedBuildings = bakeContextualBuildings({
        assignment: result.assignment,
        sites: normalizedSites,
        modules: options.modules || CONTEXTUAL_WFC_MODULES,
        nodes: buildContextualSiteGraph(normalizedSites, { neighborGap: options.neighborGap ?? 2 }),
        seed: options.seed
    });
    const expectedBySite = new Map(expectedBuildings.map((building) => [building.siteId, building]));
    for (const building of result.buildings) {
        validateBakedBuilding(building, { site: siteById.get(building.siteId) });
        const expected = expectedBySite.get(building.siteId);
        if (!expected
            || building.x !== expected.x
            || building.y !== expected.y
            || building.width !== expected.width
            || building.height !== expected.height
            || building.door?.edge !== expected.door.edge
            || building.door?.x !== expected.door.x
            || building.door?.y !== expected.door.y
            || building.exteriorApproach?.x !== expected.exteriorApproach.x
            || building.exteriorApproach?.y !== expected.exteriorApproach.y) {
            throw new ContextualBuildingWFCError(
                'A baked building does not match its deterministic parcel placement.',
                'CONTEXTUAL_WFC_NONDETERMINISTIC_BUILDING',
                { buildingId: building.id, siteId: building.siteId }
            );
        }
        if (buildingSites.has(building.siteId)) {
            throw new ContextualBuildingWFCError(
                'More than one baked building occupies a parcel.',
                'CONTEXTUAL_WFC_BUILDING_OVERLAP',
                { siteId: building.siteId }
            );
        }
        buildingSites.add(building.siteId);
        for (const cell of building.footprintCells) {
            const key = `${building.x + cell.x},${building.y + cell.y}`;
            if (occupied.has(key)) {
                throw new ContextualBuildingWFCError(
                    'Baked building footprints overlap.',
                    'CONTEXTUAL_WFC_BUILDING_OVERLAP',
                    { buildingId: building.id, cell: key }
                );
            }
            occupied.add(key);
        }
    }
    const expectedSites = [...result.assignment]
        .filter(([, moduleId]) => moduleById(options.modules || CONTEXTUAL_WFC_MODULES).get(moduleId)?.kind === 'building')
        .map(([siteId]) => siteId);
    if (expectedSites.length !== buildingSites.size || expectedSites.some((siteId) => !buildingSites.has(siteId))) {
        throw new ContextualBuildingWFCError(
            'Baked buildings do not match the building-module assignment.',
            'CONTEXTUAL_WFC_INVALID_RESULT'
        );
    }
    return true;
}

/** Convert building-module parcels into runtime-ready building records. */
export function bakeContextualBuildings({
    assignment,
    sites = [],
    modules = CONTEXTUAL_WFC_MODULES,
    nodes = null,
    seed = 'contextual-building-wave'
} = {}) {
    if (!(assignment instanceof Map)) {
        throw new ContextualBuildingWFCError('assignment must be a Map.', 'CONTEXTUAL_WFC_INVALID_ASSIGNMENT');
    }
    const normalizedSites = normalizeSites(sites);
    const siteById = new Map(normalizedSites.map((site) => [site.id, site]));
    const specs = moduleById(modules);
    const graph = nodes || buildContextualSiteGraph(normalizedSites);
    const nodeById = new Map(graph.map((node) => [node.id, node]));
    const buildings = [];
    for (const [siteId, moduleId] of [...assignment].sort(([a], [b]) => compareIds(a, b))) {
        const spec = specs.get(moduleId);
        if (spec?.kind !== 'building') continue;
        const site = siteById.get(siteId);
        if (!site) {
            throw new ContextualBuildingWFCError(
                'A building assignment references an unknown site.',
                'CONTEXTUAL_WFC_UNKNOWN_SITE',
                { siteId }
            );
        }
        const geometricOrientation = chooseBuildingOrientation(site, spec, `${seed}:${String(siteId)}:${moduleId}:geometry`);
        if (!geometricOrientation) {
            throw new ContextualBuildingWFCError(
                'A building module does not fit its parcel.',
                'CONTEXTUAL_WFC_BUILDING_CAPACITY',
                { siteId, moduleId, siteWidth: site.width, siteHeight: site.height }
            );
        }
        const neighborNodes = nodeById.get(siteId)?.neighbors || [];
        const preferredEdges = neighborNodes
            .filter((neighbor) => specs.get(assignment.get(neighbor.id))?.tags.includes('access'))
            .sort((a, b) => compareIds(a.id, b.id))
            .map((neighbor) => neighbor.direction)
            .filter((edge) => BUILDING_DOOR_EDGES.includes(edge));
        const placement = chooseBuildingPlacement(
            site,
            spec,
            `${seed}:${String(siteId)}:${moduleId}:placement`,
            preferredEdges
        );
        if (!placement) {
            throw new ContextualBuildingWFCError(
                'A building parcel has no legal door edge with a reserved exterior approach.',
                'CONTEXTUAL_WFC_NO_LEGAL_DOOR_EDGE',
                {
                    siteId,
                    moduleId,
                    allowedDoorEdges: normalizeSiteDoorContract(site).allowedDoorEdges,
                    reservedExteriorApproaches: normalizeSiteDoorContract(site).reservedExteriorApproaches
                }
            );
        }
        const { x, y, door } = placement;
        const footprintCells = rectangleCells(placement.width, placement.height);
        const interiorCells = rectangleCells(placement.interiorWidth, placement.interiorHeight, 1, 1);
        const interiorSet = new Set(interiorCells.map(cellKey));
        const wallCells = footprintCells.filter((cell) => !interiorSet.has(cellKey(cell)));
        const areaId = site.areaId ?? null;
        const exteriorApproach = Object.freeze({
            x: placement.approach.x,
            y: placement.approach.y,
            edge: door.edge,
            reserved: true,
            source: placement.reservation.explicit ? 'site-contract' : 'generated'
        });
        const building = {
            id: `baked-${String(areaId ?? 'world')}-${String(siteId)}-${hashWaveSeed(`${seed}:${String(siteId)}:${moduleId}`).toString(16)}`,
            name: spec.label,
            x,
            y,
            width: placement.width,
            height: placement.height,
            interior: Object.freeze({ x: 1, y: 1, width: placement.interiorWidth, height: placement.interiorHeight }),
            footprintCells,
            interiorCells,
            wallCells,
            door,
            entrance: Object.freeze({ x: exteriorApproach.x, y: exteriorApproach.y }),
            exteriorApproach,
            enterable: true,
            baked: true,
            proceduralGenerated: true,
            sourceType: 'contextual-wfc',
            wfcModuleId: moduleId,
            areaId,
            siteId,
            district: site.district || null,
            wfcPriors: site.wfcPriors || null,
            stories: spec.tags.includes('civic') ? 2 : 1,
            style: spec.tags.includes('craft') ? 'timber' : 'storybook'
        };
        validateBakedBuilding(building, { site });
        buildings.push(building);
    }
    return buildings;
}

/** Validate minimum space, wall ring and a door that reaches the contiguous interior. */
export function validateBakedBuilding(building, { site = null } = {}) {
    if (!building || !Number.isInteger(building.width) || !Number.isInteger(building.height)) {
        throw new ContextualBuildingWFCError('Invalid baked building dimensions.', 'CONTEXTUAL_WFC_INVALID_BUILDING');
    }
    const interior = building.interior || {};
    const interiorSides = [Number(interior.width), Number(interior.height)].sort((a, b) => a - b);
    if (interiorSides[0] < MINIMUM_BUILDING_INTERIOR.width || interiorSides[1] < MINIMUM_BUILDING_INTERIOR.height) {
        throw new ContextualBuildingWFCError(
            'An enterable building interior must be at least 2x3.',
            'CONTEXTUAL_WFC_INTERIOR_TOO_SMALL',
            { buildingId: building.id, interiorWidth: interior.width, interiorHeight: interior.height }
        );
    }
    if (building.width !== Number(interior.width) + 2 || building.height !== Number(interior.height) + 2) {
        throw new ContextualBuildingWFCError(
            'The building must have a one-cell wall ring around its interior.',
            'CONTEXTUAL_WFC_INVALID_WALL_RING',
            { buildingId: building.id }
        );
    }
    const footprint = new Set((building.footprintCells || []).map(cellKey));
    const interiorCells = new Set((building.interiorCells || []).map(cellKey));
    if (footprint.size !== building.width * building.height
        || interiorCells.size !== Number(interior.width) * Number(interior.height)) {
        throw new ContextualBuildingWFCError(
            'The baked footprint or interior is incomplete.',
            'CONTEXTUAL_WFC_INVALID_BUILDING',
            { buildingId: building.id }
        );
    }
    const door = building.door;
    if (!door || !footprint.has(cellKey(door)) || !isBoundaryCell(door, building.width, building.height)) {
        throw new ContextualBuildingWFCError(
            'The building door must occupy an exterior wall cell.',
            'CONTEXTUAL_WFC_INVALID_DOOR',
            { buildingId: building.id }
        );
    }
    const inward = inwardDoorPoint(door);
    if (!interiorCells.has(cellKey(inward))) {
        throw new ContextualBuildingWFCError(
            'The building door must open directly into its interior.',
            'CONTEXTUAL_WFC_INVALID_DOOR',
            { buildingId: building.id }
        );
    }
    const expectedApproach = outsideDoorPoint(building.x, building.y, door);
    const approach = building.exteriorApproach;
    if (!approach || approach.reserved !== true
        || approach.edge !== door.edge
        || approach.x !== expectedApproach.x
        || approach.y !== expectedApproach.y
        || building.entrance?.x !== expectedApproach.x
        || building.entrance?.y !== expectedApproach.y) {
        throw new ContextualBuildingWFCError(
            'The building requires a reserved exterior approach immediately outside its door.',
            'CONTEXTUAL_WFC_INVALID_EXTERIOR_APPROACH',
            { buildingId: building.id, expectedApproach }
        );
    }
    const localApproach = { x: approach.x - building.x, y: approach.y - building.y };
    if (footprint.has(cellKey(localApproach))) {
        throw new ContextualBuildingWFCError(
            'The reserved exterior approach cannot overlap the building footprint.',
            'CONTEXTUAL_WFC_INVALID_EXTERIOR_APPROACH',
            { buildingId: building.id }
        );
    }
    if (site) validateApproachAgainstSiteContract(building, site, approach);
    return true;
}

export function contextualModulesCompatible(leftId, rightId, modules = CONTEXTUAL_WFC_MODULE_BY_ID) {
    const specs = modules instanceof Map ? modules : CONTEXTUAL_WFC_MODULE_BY_ID;
    const left = specs.get(leftId);
    const right = specs.get(rightId);
    if (!left || !right) return false;
    if (left.tags.includes('water') || right.tags.includes('water')) {
        const other = left.tags.includes('water') ? right : left;
        return other.kind === 'terrain' && !other.tags.includes('relief') && !other.tags.includes('settlement');
    }
    if (left.tags.includes('relief') || right.tags.includes('relief')) {
        return left.kind === 'terrain' && right.kind === 'terrain';
    }
    if (left.tags.includes('landmark') && right.tags.includes('landmark')) return false;
    return true;
}

function createContextualContract({
    sites,
    areas,
    seed,
    modules,
    fixed,
    minimumBuildingsPerArea,
    geographicInhibitor,
    neighborGap
}) {
    const normalizedSites = normalizeSites(sites);
    const normalizedAreas = normalizeAreas(areas, minimumBuildingsPerArea);
    const normalizedModules = normalizeModules(modules);
    const specs = moduleById(normalizedModules);
    const siteContexts = resolveSiteContexts(normalizedSites, normalizedAreas, geographicInhibitor);
    const resolvedSites = normalizedSites.map((site) => ({ ...site, areaId: siteContexts.get(site.id).areaId }));
    const nodes = buildContextualSiteGraph(resolvedSites, { neighborGap });
    const domains = new Map();
    const weights = new Map();
    for (const site of resolvedSites) {
        const context = siteContexts.get(site.id);
        const weighted = normalizedModules
            .filter((module) => moduleAllowedAtSite(module, site, context))
            .map((module) => ({ id: module.id, weight: contextualModuleWeight(module, context) }))
            .sort((a, b) => b.weight - a.weight || compareIds(a.id, b.id));
        if (weighted.length === 0) {
            throw new ContextualBuildingWFCError(
                'A parcel has no modules after applying confinement and capacity constraints.',
                'CONTEXTUAL_WFC_EMPTY_DOMAIN',
                { siteId: site.id }
            );
        }
        const keepCount = Math.max(1, Math.ceil(weighted.length * (1 - context.geography.inhibitor * 0.68)));
        const limited = weighted.slice(0, keepCount);
        domains.set(site.id, limited.map((entry) => entry.id));
        weights.set(site.id, new Map(limited.map((entry) => [entry.id, entry.weight])));
    }
    const siteById = new Map(resolvedSites.map((site) => [site.id, site]));
    for (const [siteId, moduleId] of fixed?.entries ? fixed.entries() : []) {
        const site = siteById.get(siteId);
        const module = specs.get(moduleId);
        if (!site || module?.kind !== 'building') continue;
        const placement = chooseBuildingPlacement(site, module, `fixed-approach:${String(siteId)}:${moduleId}`);
        if (!placement) {
            throw new ContextualBuildingWFCError(
                'A fixed building assignment has no legal door edge with a reserved exterior approach.',
                'CONTEXTUAL_WFC_NO_LEGAL_DOOR_EDGE',
                {
                    siteId,
                    moduleId,
                    site: { x: site.x, y: site.y, width: site.width, height: site.height },
                    module: {
                        footprintWidth: module.footprintWidth,
                        footprintHeight: module.footprintHeight
                    },
                    entrance: normalizeSiteDoorContract(site)
                }
            );
        }
        // Explicit fixed nodes are pre-collapsed constraints, so confidence-based domain
        // pruning may not remove them after their geometry/entrance contract has validated.
        if (!domains.get(siteId)?.includes(moduleId)) {
            domains.set(siteId, [...(domains.get(siteId) || []), moduleId]);
            weights.get(siteId)?.set(moduleId, contextualModuleWeight(module, siteContexts.get(siteId)));
        }
    }
    const resolvedFixed = reserveAreaBuildingAnchors({
        sites: resolvedSites,
        areas: normalizedAreas,
        contexts: siteContexts,
        domains,
        modules: specs,
        fixed,
        seed
    });
    return {
        sites: resolvedSites,
        areas: normalizedAreas,
        modules: normalizedModules,
        nodes,
        contexts: siteContexts,
        domains,
        weights,
        fixed: resolvedFixed,
        moduleById: specs
    };
}

function reserveAreaBuildingAnchors({ sites, areas, contexts, domains, modules, fixed, seed }) {
    const resolved = new Map(fixed?.entries ? [...fixed.entries()] : []);
    for (const area of areas) {
        const members = sites.filter((site) => contexts.get(site.id).areaId === area.id);
        const existingBuildingSites = members.filter((site) => modules.get(resolved.get(site.id))?.kind === 'building');
        let remaining = Math.max(0, area.minimumBuildings - existingBuildingSites.length);
        if (remaining === 0) continue;
        const candidates = members
            .filter((site) => !resolved.has(site.id))
            .map((site) => ({
                site,
                buildingModules: domains.get(site.id).filter((moduleId) => modules.get(moduleId)?.kind === 'building'),
                distance: distanceToAreaCenter(site, area),
                salt: keyedUnit(`${seed}:anchor:${String(area.id)}:${String(site.id)}`)
            }))
            .filter((candidate) => candidate.buildingModules.length > 0)
            .sort((a, b) => a.distance - b.distance || a.salt - b.salt || compareIds(a.site.id, b.site.id));
        if (candidates.length < remaining) {
            const doorlessSites = members
                .filter((site) => !resolved.has(site.id))
                .filter((site) => [...modules.values()].some((module) =>
                    module.kind === 'building'
                    && chooseBuildingOrientation(site, module, `geometry:${String(site.id)}:${module.id}`)
                    && !chooseBuildingPlacement(site, module, `approach:${String(site.id)}:${module.id}`)))
                .map((site) => site.id);
            if (doorlessSites.length > 0) {
                throw new ContextualBuildingWFCError(
                    'A walled area has building parcels without a legal reserved exterior approach.',
                    'CONTEXTUAL_WFC_NO_LEGAL_DOOR_EDGE',
                    { areaId: area.id, siteIds: doorlessSites, required: remaining, available: candidates.length }
                );
            }
            throw new ContextualBuildingWFCError(
                'A walled area cannot fit its required number of enterable buildings.',
                'CONTEXTUAL_WFC_AREA_CAPACITY',
                { areaId: area.id, minimumBuildings: area.minimumBuildings, capacity: candidates.length + existingBuildingSites.length }
            );
        }
        const selected = [];
        while (remaining > 0) {
            const choice = candidates
                .filter((candidate) => !selected.includes(candidate))
                .sort((a, b) => {
                    const spacingA = selected.length ? Math.min(...selected.map((entry) => siteDistance(a.site, entry.site))) : 0;
                    const spacingB = selected.length ? Math.min(...selected.map((entry) => siteDistance(b.site, entry.site))) : 0;
                    return spacingB - spacingA || a.distance - b.distance || a.salt - b.salt || compareIds(a.site.id, b.site.id);
                })[0];
            selected.push(choice);
            const moduleIndex = Math.min(
                choice.buildingModules.length - 1,
                Math.floor(keyedUnit(`${seed}:anchor-module:${String(area.id)}:${String(choice.site.id)}`)
                    * choice.buildingModules.length)
            );
            const preferred = choice.buildingModules[moduleIndex];
            resolved.set(choice.site.id, preferred);
            remaining--;
        }
    }
    return resolved;
}

function resolveSiteContexts(sites, areas, geographicInhibitor) {
    const contexts = new Map();
    for (const site of sites) {
        const matchingAreas = areas
            .filter((area) => areaContainsSite(area, site))
            .sort((a, b) => b.priority - a.priority || compareIds(a.id, b.id));
        const area = matchingAreas[0];
        const explicitConfinement = site.withinWalls === true ? 1 : site.withinWalls === false ? 0 : site.confinement;
        const confinement = unit(explicitConfinement, area?.walled === false ? 0 : area ? 1 : 0);
        contexts.set(site.id, Object.freeze({
            areaId: area?.id ?? site.areaId ?? null,
            district: String(area?.district ?? site.district ?? 'residential'),
            wfcPriors: normalizeWardPriors(area?.wfcPriors ?? site.wfcPriors),
            confinement,
            geography: normalizeGeographicPrior(site.geography, geographicInhibitor),
            reservedForAccess: site.reservedForAccess === true,
            blocked: site.blocked === true
        }));
    }
    return contexts;
}

function moduleAllowedAtSite(module, site, context) {
    if (context.blocked) return false;
    if (context.reservedForAccess) return module.tags.includes('access');
    if (module.kind === 'building') {
        if (context.confinement < 0.5 || context.geography.land < 0.5) return false;
        return Boolean(chooseBuildingPlacement(site, module, `capacity:${String(site.id)}:${module.id}`));
    }
    if (context.confinement >= 0.78) {
        return module.tags.includes('access') || module.tags.includes('settlement');
    }
    if (context.confinement >= 0.5) {
        return module.tags.includes('access') || module.id === 'terrain-meadow' || module.id === 'terrain-grove';
    }
    if (module.tags.includes('settlement')) return false;
    if (context.geography.land < 0.32) return module.tags.includes('water') || module.id === 'terrain-path';
    if (context.geography.land < 0.5) return module.tags.includes('water') || module.id === 'terrain-meadow';
    return !module.tags.includes('water') || context.geography.riverInfluence >= 0.45;
}

function contextualModuleWeight(module, context) {
    const geography = context.geography;
    const priors = context.wfcPriors || normalizeWardPriors();
    let weight = module.weight;
    if (module.kind === 'building') {
        weight *= (0.42 + priors.buildingDensity * 2.4) *
            (1 + context.confinement * 5.5 + geography.settlementInfluence * 4);
        // Dense, walled wards should use the legal capacity of larger parcels instead of
        // resolving every lot to the minimum 4x5 cabin. The JSON-derived density prior controls
        // this footprint preference, so sparse/open settlements still favor small buildings.
        const footprintArea = Number(module.footprintWidth) * Number(module.footprintHeight);
        const extraFootprint = Math.max(0, footprintArea - 20);
        weight *= 1 + extraFootprint / 12 * priors.buildingDensity * context.confinement;
        if (module.tags.includes('landmark')) weight *= 0.32 + geography.settlementInfluence;
    } else if (module.tags.includes('water')) {
        weight *= 0.1 + (1 - geography.land) * 7 + geography.riverInfluence * 4;
    } else if (module.tags.includes('relief')) {
        weight *= 0.2 + geography.height * 3.5;
    } else if (module.tags.includes('access')) {
        weight *= 0.65 + geography.routeInfluence * 5 + context.confinement * 1.5;
    } else if (module.tags.includes('trees')) {
        weight *= 0.45 + geography.treeCover * 3;
    } else {
        weight *= 0.8 + geography.land * 2.2;
    }
    weight *= districtModuleBias(module, context.district);
    weight *= archetypePriorBias(module, priors.archetypeWeights);
    if (module.kind !== 'building' && !module.tags.includes('access')) {
        weight *= Math.max(0.2, 1.35 - priors.buildingDensity);
    }
    // Confidence sharpens the preferred weights in addition to reducing domain size. This is
    // how geography inhibits local chaos without becoming hand-authored building data.
    return Math.max(0.0001, Math.pow(weight, 1 + geography.inhibitor * 1.6));
}

function validateAreaMinimums(assignment, contract) {
    for (const area of contract.areas) {
        const count = contract.sites.filter((site) =>
            contract.contexts.get(site.id).areaId === area.id
            && contract.moduleById.get(assignment.get(site.id))?.kind === 'building').length;
        if (count < area.minimumBuildings) {
            throw new ContextualBuildingWFCError(
                'A solved area contains fewer buildings than its required minimum.',
                'CONTEXTUAL_WFC_AREA_MINIMUM',
                { areaId: area.id, minimumBuildings: area.minimumBuildings, actual: count }
            );
        }
    }
}

function buildDiagnostics(contract, assignment, buildings) {
    const moduleHistogram = {};
    const districtHistogram = {};
    let insideBuildings = 0;
    let outsideBuildings = 0;
    for (const [siteId, moduleId] of assignment) {
        moduleHistogram[moduleId] = (moduleHistogram[moduleId] || 0) + 1;
        const district = contract.contexts.get(siteId)?.district || 'residential';
        districtHistogram[district] = (districtHistogram[district] || 0) + 1;
        if (contract.moduleById.get(moduleId)?.kind !== 'building') continue;
        if (contract.contexts.get(siteId).confinement >= 0.5) insideBuildings++;
        else outsideBuildings++;
    }
    const domainSizes = [...contract.domains.values()].map((domain) => domain.length);
    return Object.freeze({
        sites: contract.sites.length,
        areas: contract.areas.length,
        buildings: buildings.length,
        insideBuildings,
        outsideBuildings,
        forcedBuildingAnchors: [...contract.fixed].filter(([, moduleId]) => contract.moduleById.get(moduleId)?.kind === 'building').length,
        meanDomainSize: domainSizes.length ? domainSizes.reduce((sum, value) => sum + value, 0) / domainSizes.length : 0,
        moduleHistogram: Object.freeze(moduleHistogram),
        districtHistogram: Object.freeze(districtHistogram),
        contradictions: 0,
        fallbacks: 0
    });
}

function normalizeSites(sites) {
    if (!Array.isArray(sites)) {
        throw new ContextualBuildingWFCError('sites must be an array.', 'CONTEXTUAL_WFC_INVALID_INPUT');
    }
    const ids = new Set();
    return [...sites]
        .map((site) => {
            if (!site || site.id === undefined || site.id === null) {
                throw new ContextualBuildingWFCError('Every parcel site requires an id.', 'CONTEXTUAL_WFC_INVALID_SITE');
            }
            if (ids.has(site.id)) {
                throw new ContextualBuildingWFCError('Parcel site ids must be unique.', 'CONTEXTUAL_WFC_DUPLICATE_SITE', { siteId: site.id });
            }
            ids.add(site.id);
            const width = integer(site.width, 1);
            const height = integer(site.height, 1);
            if (width < 1 || height < 1) {
                throw new ContextualBuildingWFCError('Parcel dimensions must be positive.', 'CONTEXTUAL_WFC_INVALID_SITE', { siteId: site.id });
            }
            return { ...site, x: finite(site.x, 0), y: finite(site.y, 0), width, height };
        })
        .sort((a, b) => compareIds(a.id, b.id));
}

function normalizeAreas(areas, defaultMinimum) {
    if (!Array.isArray(areas)) {
        throw new ContextualBuildingWFCError('areas must be an array.', 'CONTEXTUAL_WFC_INVALID_INPUT');
    }
    const ids = new Set();
    return [...areas].map((area, index) => {
        const id = area?.id ?? `area-${index}`;
        if (ids.has(id)) {
            throw new ContextualBuildingWFCError('Area ids must be unique.', 'CONTEXTUAL_WFC_DUPLICATE_AREA', { areaId: id });
        }
        ids.add(id);
        return {
            ...area,
            id,
            siteIds: new Set(area?.siteIds || []),
            minimumBuildings: Math.max(0, integer(area?.minimumBuildings, defaultMinimum)),
            priority: finite(area?.priority, 0),
            walled: area?.walled !== false,
            district: String(area?.district || 'residential'),
            wfcPriors: normalizeWardPriors(area?.wfcPriors)
        };
    }).sort((a, b) => compareIds(a.id, b.id));
}

function normalizeWardPriors(value = {}) {
    const source = value && typeof value === 'object' ? value : {};
    const archetypeWeights = {};
    for (const [key, raw] of Object.entries(source.archetypeWeights || {})) {
        const weight = Number(raw);
        if (Number.isFinite(weight) && weight > 0) archetypeWeights[String(key)] = weight;
    }
    return Object.freeze({
        buildingDensity: unit(source.buildingDensity, 0.58),
        elevationVariance: unit(source.elevationVariance, 0.35),
        archetypeWeights: Object.freeze(archetypeWeights)
    });
}

function districtModuleBias(module, district) {
    const tags = new Set(module.tags || []);
    const kind = String(district || 'residential');
    if (kind === 'castle') {
        if (tags.has('civic') || tags.has('landmark')) return 3.2;
        if (module.kind === 'building') return 0.72;
        return tags.has('access') ? 1.8 : 0.28;
    }
    if (kind === 'civic') {
        if (tags.has('civic') || tags.has('landmark')) return 2.8;
        if (tags.has('access') || tags.has('settlement')) return 1.45;
    }
    if (kind === 'market') {
        if (tags.has('merchant') || tags.has('craft')) return 2.45;
        if (module.id === 'settlement-square' || tags.has('access')) return 1.8;
    }
    if (kind === 'harbor') {
        if (tags.has('merchant') || tags.has('craft')) return 2.05;
        if (tags.has('water') || tags.has('access')) return 1.65;
    }
    if (kind === 'artisan' && (tags.has('craft') || tags.has('merchant'))) return 2.3;
    if (kind === 'residential' && tags.has('home')) return 2.15;
    if (kind === 'garden' && (tags.has('home') || tags.has('trees'))) return 1.65;
    return 1;
}

function archetypePriorBias(module, weights) {
    if (!weights || typeof weights !== 'object') return 1;
    const aliases = [
        module.id,
        module.id.replace(/^building-/, ''),
        ...(module.id === 'building-hall' ? ['hall', 'market', 'keep', 'garrison', 'manor'] : []),
        ...(module.id === 'building-house' ? ['house', 'home'] : []),
        ...(module.id === 'building-shop' ? ['shop', 'inn', 'market'] : []),
        ...(module.id === 'building-workshop' ? ['workshop', 'warehouse'] : [])
    ];
    let multiplier;
    for (const alias of aliases) {
        const value = Number(weights[alias]);
        if (Number.isFinite(value)) multiplier = Number.isFinite(multiplier) ? Math.max(multiplier, value) : value;
    }
    for (const tag of module.tags || []) {
        const value = Number(weights[tag]);
        if (Number.isFinite(value)) multiplier = Number.isFinite(multiplier)
            ? Math.max(multiplier, value)
            : value;
    }
    return Number.isFinite(multiplier) && multiplier > 0 ? multiplier : 1;
}

function normalizeModules(modules) {
    if (!Array.isArray(modules) || modules.length === 0) {
        throw new ContextualBuildingWFCError('modules must be a non-empty array.', 'CONTEXTUAL_WFC_INVALID_MODULES');
    }
    return modules.map((module) => ({ ...module, tags: [...(module.tags || [])] }));
}

function moduleSpec(id, kind, weight, tags, extra = {}) {
    return Object.freeze({ id, label: labelFromId(id), kind, weight, tags: Object.freeze(tags), ...extra });
}

function buildingSpec(id, interiorWidth, interiorHeight, weight, tags) {
    return moduleSpec(id, 'building', weight, Object.freeze(['land', 'settlement', ...tags]), {
        interiorWidth,
        interiorHeight,
        footprintWidth: interiorWidth + 2,
        footprintHeight: interiorHeight + 2
    });
}

function moduleById(modules) {
    return new Map(modules.map((module) => [module.id, module]));
}

function chooseBuildingOrientation(site, module, salt) {
    if (module.kind !== 'building') return null;
    const fitting = buildingOrientations(module)
        .filter((variant) => variant.width <= site.width && variant.height <= site.height);
    if (!fitting.length) return null;
    return fitting[hashWaveSeed(salt) % fitting.length];
}

function buildingOrientations(module) {
    const variants = [
        {
            width: module.footprintWidth,
            height: module.footprintHeight,
            interiorWidth: module.interiorWidth,
            interiorHeight: module.interiorHeight
        }
    ];
    if (module.footprintWidth !== module.footprintHeight) {
        variants.push({
            width: module.footprintHeight,
            height: module.footprintWidth,
            interiorWidth: module.interiorHeight,
            interiorHeight: module.interiorWidth
        });
    }
    return variants;
}

function chooseBuildingPlacement(site, module, salt, preferredEdges = []) {
    if (module.kind !== 'building') return null;
    const contract = normalizeSiteDoorContract(site);
    if (contract.legalDoorEdges.length === 0) return null;
    const candidates = [];
    for (const orientation of buildingOrientations(module)) {
        if (orientation.width > site.width || orientation.height > site.height) continue;
        const x = Math.round(site.x + Math.floor((site.width - orientation.width) / 2));
        const y = Math.round(site.y + Math.floor((site.height - orientation.height) / 2));
        for (const reservation of contract.reservedExteriorApproaches) {
            const door = doorForEdge(orientation.width, orientation.height, reservation.edge);
            const approach = outsideDoorPoint(x, y, door);
            // An explicit reservation may sit immediately outside the parcel footprint. This is
            // the normal integration contract: the parcel owns the building cells and separately
            // reserves the one walkable road/apron cell beyond its door.
            if (!reservation.explicit && !pointInsideSite(approach, site)) continue;
            if (reservation.x !== null && (reservation.x !== approach.x || reservation.y !== approach.y)) continue;
            candidates.push({ ...orientation, x, y, door, approach, reservation });
        }
    }
    if (candidates.length === 0) return null;
    candidates.sort((left, right) =>
        edgeIndex(left.door.edge) - edgeIndex(right.door.edge)
        || left.width - right.width
        || left.height - right.height
        || left.x - right.x
        || left.y - right.y);
    const preferred = new Set(preferredEdges.filter((edge) => BUILDING_DOOR_EDGES.includes(edge)));
    const preferredCandidates = candidates.filter((candidate) => preferred.has(candidate.door.edge));
    const pool = preferredCandidates.length ? preferredCandidates : candidates;
    return pool[hashWaveSeed(salt) % pool.length];
}

function areaContainsSite(area, site) {
    if (area.siteIds.has(site.id) || site.areaId === area.id) return true;
    const bounds = areaBounds(area);
    if (!bounds) return false;
    const centerX = site.x + site.width / 2;
    const centerY = site.y + site.height / 2;
    return centerX >= bounds.left && centerX <= bounds.right && centerY >= bounds.top && centerY <= bounds.bottom;
}

function areaBounds(area) {
    const left = finite(area.left ?? area.x, NaN);
    const top = finite(area.top ?? area.y, NaN);
    const width = finite(area.width, NaN);
    const height = finite(area.height, NaN);
    const right = finite(area.right, Number.isFinite(left) && Number.isFinite(width) ? left + width : NaN);
    const bottom = finite(area.bottom, Number.isFinite(top) && Number.isFinite(height) ? top + height : NaN);
    return [left, top, right, bottom].every(Number.isFinite) ? { left, top, right, bottom } : null;
}

function distanceToAreaCenter(site, area) {
    const bounds = areaBounds(area);
    if (!bounds) return keyedUnit(`area-distance:${String(area.id)}:${String(site.id)}`);
    return Math.hypot(
        site.x + site.width / 2 - (bounds.left + bounds.right) / 2,
        site.y + site.height / 2 - (bounds.top + bounds.bottom) / 2
    );
}

function rectanglesAreNeighbors(left, right, gap) {
    const leftRight = left.x + left.width;
    const rightRight = right.x + right.width;
    const leftBottom = left.y + left.height;
    const rightBottom = right.y + right.height;
    const horizontalGap = Math.max(0, Math.max(left.x, right.x) - Math.min(leftRight, rightRight));
    const verticalGap = Math.max(0, Math.max(left.y, right.y) - Math.min(leftBottom, rightBottom));
    const verticalOverlap = Math.min(leftBottom, rightBottom) - Math.max(left.y, right.y);
    const horizontalOverlap = Math.min(leftRight, rightRight) - Math.max(left.x, right.x);
    return (horizontalGap <= gap && verticalOverlap > 0) || (verticalGap <= gap && horizontalOverlap > 0);
}

function directionBetween(source, target) {
    if (!target) return 'near';
    const dx = target.x + target.width / 2 - (source.x + source.width / 2);
    const dy = target.y + target.height / 2 - (source.y + source.height / 2);
    if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? 'east' : 'west';
    return dy >= 0 ? 'south' : 'north';
}

function oppositeDirection(direction) {
    return ({ north: 'south', south: 'north', east: 'west', west: 'east' })[direction] || 'near';
}

function normalizeDoorEdges(value, fieldName) {
    if (!Array.isArray(value)) {
        throw new ContextualBuildingWFCError(
            `${fieldName} must be an array of cardinal edges.`,
            'CONTEXTUAL_WFC_INVALID_DOOR_CONTRACT',
            { fieldName }
        );
    }
    const edges = [];
    for (const raw of value) {
        const edge = typeof raw === 'string' ? raw.toLowerCase() : '';
        if (!BUILDING_DOOR_EDGES.includes(edge)) {
            throw new ContextualBuildingWFCError(
                `${fieldName} contains a non-cardinal edge.`,
                'CONTEXTUAL_WFC_INVALID_DOOR_CONTRACT',
                { fieldName, edge: raw }
            );
        }
        if (!edges.includes(edge)) edges.push(edge);
    }
    return edges.sort((left, right) => edgeIndex(left) - edgeIndex(right));
}

function normalizeApproachReservations(value, fieldName) {
    let entries;
    if (value === true) entries = BUILDING_DOOR_EDGES;
    else if (value === false) entries = [];
    else if (typeof value === 'string') entries = [value];
    else if (Array.isArray(value)) entries = value;
    else if (value && typeof value === 'object' && Object.prototype.hasOwnProperty.call(value, 'edge')) entries = [value];
    else if (value && typeof value === 'object') {
        entries = BUILDING_DOOR_EDGES.flatMap((edge) => {
            const setting = value[edge];
            if (setting === undefined || setting === null || setting === false) return [];
            if (setting === true) return [{ edge }];
            if (typeof setting !== 'object') {
                throw new ContextualBuildingWFCError(
                    `${fieldName}.${edge} must be a boolean or approach object.`,
                    'CONTEXTUAL_WFC_INVALID_DOOR_CONTRACT',
                    { fieldName, edge }
                );
            }
            return [{ ...setting, edge }];
        });
    } else if (value === null || value === undefined) entries = [];
    else {
        throw new ContextualBuildingWFCError(
            `${fieldName} has an invalid reservation value.`,
            'CONTEXTUAL_WFC_INVALID_DOOR_CONTRACT',
            { fieldName }
        );
    }
    return entries.map((entry) => {
        const record = typeof entry === 'string' ? { edge: entry } : entry;
        const edge = typeof record?.edge === 'string' ? record.edge.toLowerCase() : '';
        if (!BUILDING_DOOR_EDGES.includes(edge)) {
            throw new ContextualBuildingWFCError(
                `${fieldName} contains a non-cardinal approach edge.`,
                'CONTEXTUAL_WFC_INVALID_DOOR_CONTRACT',
                { fieldName, edge: record?.edge }
            );
        }
        const rawX = record.x ?? record.cell?.x;
        const rawY = record.y ?? record.cell?.y;
        const hasX = rawX !== undefined && rawX !== null;
        const hasY = rawY !== undefined && rawY !== null;
        if (hasX !== hasY || (hasX && (!Number.isFinite(Number(rawX)) || !Number.isFinite(Number(rawY))))) {
            throw new ContextualBuildingWFCError(
                `${fieldName} coordinates must include finite x and y values together.`,
                'CONTEXTUAL_WFC_INVALID_DOOR_CONTRACT',
                { fieldName, edge }
            );
        }
        return Object.freeze({
            edge,
            x: hasX ? Number(rawX) : null,
            y: hasY ? Number(rawY) : null,
            explicit: true
        });
    });
}

function validateApproachAgainstSiteContract(building, site, approach) {
    const contract = normalizeSiteDoorContract(site);
    const matching = contract.reservedExteriorApproaches.filter((reservation) =>
        reservation.edge === building.door.edge
        && (reservation.x === null || (reservation.x === approach.x && reservation.y === approach.y)));
    if (matching.length === 0 || (!matching.some((reservation) => reservation.explicit) && !pointInsideSite(approach, site))) {
        throw new ContextualBuildingWFCError(
            'The building door violates its parcel entrance contract.',
            'CONTEXTUAL_WFC_NO_LEGAL_DOOR_EDGE',
            {
                buildingId: building.id,
                siteId: site.id,
                edge: building.door.edge,
                approach: { x: approach.x, y: approach.y }
            }
        );
    }
}

function pointInsideSite(point, site) {
    return point.x >= site.x
        && point.y >= site.y
        && point.x < site.x + site.width
        && point.y < site.y + site.height;
}

function edgeIndex(edge) {
    const index = BUILDING_DOOR_EDGES.indexOf(edge);
    return index < 0 ? BUILDING_DOOR_EDGES.length : index;
}

function doorForEdge(width, height, edge) {
    if (edge === 'north') return Object.freeze({ x: Math.floor(width / 2), y: 0, edge });
    if (edge === 'east') return Object.freeze({ x: width - 1, y: Math.floor(height / 2), edge });
    if (edge === 'west') return Object.freeze({ x: 0, y: Math.floor(height / 2), edge });
    return Object.freeze({ x: Math.floor(width / 2), y: height - 1, edge: 'south' });
}

function inwardDoorPoint(door) {
    const delta = ({ north: [0, 1], east: [-1, 0], south: [0, -1], west: [1, 0] })[door.edge] || [0, -1];
    return { x: door.x + delta[0], y: door.y + delta[1] };
}

function outsideDoorPoint(x, y, door) {
    const delta = ({ north: [0, -1], east: [1, 0], south: [0, 1], west: [-1, 0] })[door.edge] || [0, 1];
    return { x: x + door.x + delta[0], y: y + door.y + delta[1] };
}

function isBoundaryCell(cell, width, height) {
    return cell.x === 0 || cell.y === 0 || cell.x === width - 1 || cell.y === height - 1;
}

function rectangleCells(width, height, offsetX = 0, offsetY = 0) {
    return Array.from({ length: height }, (_, y) =>
        Array.from({ length: width }, (_, x) => ({ x: x + offsetX, y: y + offsetY }))).flat();
}

function cellKey(cell) {
    return `${cell.x},${cell.y}`;
}

function siteDistance(left, right) {
    return Math.hypot(
        left.x + left.width / 2 - (right.x + right.width / 2),
        left.y + left.height / 2 - (right.y + right.height / 2)
    );
}

function labelFromId(id) {
    return id.split('-').map((part) => part[0].toUpperCase() + part.slice(1)).join(' ');
}

function integer(value, fallback) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.floor(number) : fallback;
}

function finite(value, fallback) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
}

function unit(value, fallback) {
    return Math.max(0, Math.min(1, finite(value, fallback)));
}

function unitHeight(value) {
    const number = finite(value, 0);
    return unit(number > 1 ? number / 100 : number, 0);
}

function keyedUnit(value) {
    return (hashWaveSeed(value) + 0.5) / 4294967296;
}

function compareIds(left, right) {
    return `${typeof left}:${String(left)}`.localeCompare(`${typeof right}:${String(right)}`);
}
