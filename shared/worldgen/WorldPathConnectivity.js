import { ELEMENTS } from './TileRegistry.js';
import {
    BUILDING_PARTS,
    TEXTURE_IDS,
    isBlockWalkable,
    normalizeTileCell,
    tileCellToSymbol
} from './TileLibrary.js';

export const WORLD_PATH_CONNECTIVITY_VERSION = 'logical-world-connectivity-v2';

const CARDINALS = Object.freeze([
    Object.freeze({ x: 0, y: -1, edge: 'north' }),
    Object.freeze({ x: 1, y: 0, edge: 'east' }),
    Object.freeze({ x: 0, y: 1, edge: 'south' }),
    Object.freeze({ x: -1, y: 0, edge: 'west' })
]);
const DIAGONALS = Object.freeze([
    Object.freeze({ x: -1, y: -1 }),
    Object.freeze({ x: 1, y: -1 }),
    Object.freeze({ x: 1, y: 1 }),
    Object.freeze({ x: -1, y: 1 })
]);
const EDGE_DIRECTIONS = Object.freeze(Object.fromEntries(CARDINALS.map((entry) => [entry.edge, entry])));
// Generic village ground (.) is deliberately not a road. It remains player-walkable, but cannot
// satisfy an authored door, gate, or required-route road connection by itself.
const DEFAULT_ROAD_SYMBOLS = Object.freeze(['R', ':', ';', '=', '1', '2', '3', '4']);
const DEFAULT_WATER_SYMBOLS = Object.freeze(['W', '~', 'B']);
const DEFAULT_DOOR_SYMBOLS = Object.freeze(['D']);

/**
 * Validates the logical data returned by a world-plan generator. The function deliberately
 * consumes rows, elevations, building records, and optional topology declarations rather than
 * Three.js objects or runtime collision maps.
 *
 * Optional topology can live at `plan.pathConnectivity`, `plan.logicalConnectivity`, or in the
 * options argument. Supported fields are `rivers`, `riverComponents`, `riverConnectors`,
 * `gates`, `requiredPaths`, and `movementConnectors`.
 */
export function validateWorldPathConnectivity(plan = {}, options = {}) {
    const settings = normalizeOptions(options);
    const grid = createLogicalGrid(plan, settings);
    const issues = [...grid.issues];
    const issue = createIssueCollector(issues);
    const topology = getLogicalTopology(plan, options);
    const riverSystems = normalizeRiverSystems(topology);
    const gates = normalizeGates(topology, plan);
    const requiredPaths = normalizeRequiredPaths(topology);
    const movementConnectors = normalizeMovementConnectors(topology);
    const movementContext = createMovementContext(grid, movementConnectors, settings);

    const riverStats = validateRiverSystems(riverSystems, grid, settings, issue);
    const roadStats = analyzeRoadNetwork(grid, movementContext, settings, issue);
    const buildingStats = validateBuildings(plan.buildings, grid, movementContext, roadStats, settings, issue);
    const gateStats = validateGates(gates, grid, movementContext, roadStats, settings, issue);
    const sharedRoadStats = validateSharedRoadConnections(
        buildingStats,
        gateStats,
        grid,
        movementContext,
        settings,
        issue
    );
    const requiredPathStats = validateRequiredPaths(
        requiredPaths,
        grid,
        movementContext,
        roadStats,
        settings,
        issue
    );

    issues.sort(compareIssues);
    const frozenIssues = Object.freeze(issues.map(freezeIssue));
    const errorCount = frozenIssues.filter((entry) => entry.severity === 'error').length;
    const warningCount = frozenIssues.length - errorCount;
    const valid = errorCount === 0;
    const generationMetadata = createGenerationMetadata({
        valid,
        errorCount,
        warningCount,
        issues: frozenIssues,
        grid,
        riverStats,
        roadStats,
        buildingStats,
        gateStats,
        sharedRoadStats,
        requiredPathStats,
        settings
    });

    return Object.freeze({
        version: WORLD_PATH_CONNECTIVITY_VERSION,
        valid,
        errorCount,
        warningCount,
        issues: frozenIssues,
        generationMetadata
    });
}

/**
 * Finds a logical path using the same core elevation rule as PlayerAvatar/WorldGenerator:
 * adjacent walkable cells may differ by at most one elevation tier. Diagonal movement also
 * requires both orthogonal lanes to be clear. Explicit paired stair connectors may bridge a
 * larger elevation delta.
 */
export function findLogicalWorldPath(plan = {}, from, to, options = {}) {
    const settings = normalizeOptions(options);
    const grid = createLogicalGrid(plan, settings);
    if (grid.issues.some((entry) => entry.severity === 'error')) return null;
    const topology = getLogicalTopology(plan, options);
    const movementContext = createMovementContext(
        grid,
        normalizeMovementConnectors(topology),
        settings
    );
    const start = normalizeGridCell(from);
    const end = normalizeGridCell(to);
    if (!start || !end) return null;
    return findPath(grid, start, end, movementContext, settings);
}

export function isLogicalWorldStepTraversable(plan = {}, from, to, options = {}) {
    const settings = normalizeOptions(options);
    const grid = createLogicalGrid(plan, settings);
    if (grid.issues.some((entry) => entry.severity === 'error')) return false;
    const start = normalizeGridCell(from);
    const end = normalizeGridCell(to);
    if (!start || !end) return false;
    const movementContext = createMovementContext(
        grid,
        normalizeMovementConnectors(getLogicalTopology(plan, options)),
        settings
    );
    return canTraverseStep(grid, start, end, movementContext, settings);
}

/** Returns the JSON-safe summary intended for `plan.generation.pathConnectivity`. */
export function getWorldPathConnectivityGenerationMetadata(validation) {
    return validation?.generationMetadata || null;
}

function normalizeOptions(options) {
    const maxStep = finiteNonNegative(options.maxStep, 1);
    return Object.freeze({
        maxStep,
        maxBuildingElevationSpan: finiteNonNegative(options.maxBuildingElevationSpan, 0),
        allowDiagonal: options.allowDiagonal !== false,
        buildingCoordinates: options.buildingCoordinates === 'absolute' ? 'absolute' : 'relative',
        requireDoorRoadConnection: options.requireDoorRoadConnection !== false,
        requireGateRoadConnection: options.requireGateRoadConnection !== false,
        requireDoorGateConnection: options.requireDoorGateConnection !== false,
        requireConnectedRoadNetwork: options.requireConnectedRoadNetwork !== false,
        requireRequiredPathRoadComponent: options.requireRequiredPathRoadComponent !== false,
        requireStampedDoorSymbols: options.requireStampedDoorSymbols === true,
        requireRiverSymbols: options.requireRiverSymbols !== false,
        maxRoadConnectionDistance: Math.max(0, Math.floor(finiteNonNegative(
            options.maxRoadConnectionDistance,
            12
        ))),
        roadSymbols: new Set(normalizeSymbolList(options.roadSymbols, DEFAULT_ROAD_SYMBOLS)),
        waterSymbols: new Set(normalizeSymbolList(options.waterSymbols, DEFAULT_WATER_SYMBOLS)),
        doorSymbols: new Set(normalizeSymbolList(options.doorSymbols, DEFAULT_DOOR_SYMBOLS))
    });
}

function createLogicalGrid(plan, settings) {
    const issues = [];
    const issue = createIssueCollector(issues);
    if (!Array.isArray(plan?.rows) || plan.rows.length === 0) {
        issue('plan-rows-missing', 'plan', 'Generated plan rows must be a non-empty array.');
        return emptyGrid(issues);
    }

    const rows = plan.rows.map((row) => {
        if (typeof row === 'string') return [...row];
        if (Array.isArray(row)) return [...row];
        return [];
    });
    const height = rows.length;
    const width = rows[0]?.length || 0;
    if (width === 0) issue('plan-rows-missing', 'plan', 'Generated plan rows cannot be empty.');
    rows.forEach((row, rowIndex) => {
        if (row.length !== width) {
            issue(
                'plan-row-width-mismatch',
                `row-${rowIndex}`,
                `Row ${rowIndex} has width ${row.length}; expected ${width}.`,
                row.map((_, col) => ({ col, row: rowIndex }))
            );
        }
    });

    const elevationRows = Array.isArray(plan.elevationRows)
        ? plan.elevationRows.map((row) => Array.isArray(row) ? [...row] : [])
        : [];
    if (elevationRows.length !== height || elevationRows.some((row) => row.length !== width)) {
        issue(
            'plan-elevation-shape-mismatch',
            'plan',
            `Elevation rows must match the ${width}x${height} logical grid.`
        );
    }

    const center = {
        col: finiteInteger(plan.center?.x ?? plan.center?.col, Math.floor(width / 2)),
        row: finiteInteger(plan.center?.y ?? plan.center?.row, Math.floor(height / 2))
    };
    const buildingMasks = collectBuildingMasks(plan.buildings, center, settings);
    return {
        width,
        height,
        rows,
        elevationRows,
        center,
        buildingFootprintKeys: buildingMasks.footprintKeys,
        buildingPortalKeys: buildingMasks.portalKeys,
        settings,
        issues
    };
}

function collectBuildingMasks(rawBuildings, center, settings) {
    const footprintKeys = new Set();
    const portalKeys = new Set();
    const maskGrid = { center };
    for (const [index, rawBuilding] of asArray(rawBuildings).entries()) {
        const building = normalizeBuilding(rawBuilding, index, maskGrid, settings);
        for (const cell of building.footprint) footprintKeys.add(cellKey(cell.world));
        if (!building.door?.world) continue;
        portalKeys.add(cellKey(building.door.world));
        const boundaryDirections = CARDINALS.filter((direction) =>
            !building.footprintLocalKeys.has(localCellKey({
                x: building.door.local.x + direction.x,
                y: building.door.local.y + direction.y
            })));
        const outsideDirection = EDGE_DIRECTIONS[building.door.edge] || boundaryDirections[0];
        if (!outsideDirection) continue;
        // The threshold and its first authored interior landing remain traversable portals. Every
        // other footprint cell is treated as occupied world geometry, so roads hidden below a
        // building cannot connect components or become a player shortcut.
        portalKeys.add(cellKey({
            col: building.door.world.col - outsideDirection.x,
            row: building.door.world.row - outsideDirection.y
        }));
    }
    return { footprintKeys, portalKeys };
}

function emptyGrid(issues) {
    return {
        width: 0,
        height: 0,
        rows: [],
        elevationRows: [],
        center: { col: 0, row: 0 },
        buildingFootprintKeys: new Set(),
        buildingPortalKeys: new Set(),
        issues
    };
}

function getLogicalTopology(plan, options) {
    const embedded = plan.pathConnectivity || plan.logicalConnectivity || plan.connectivity || {};
    return {
        rivers: options.rivers ?? embedded.rivers ?? plan.rivers ?? [],
        riverComponents: options.riverComponents ?? embedded.riverComponents ?? plan.riverComponents ?? [],
        riverConnectors: options.riverConnectors ?? embedded.riverConnectors ?? plan.riverConnectors ?? [],
        gates: options.gates ?? embedded.gates ?? plan.gates ?? [],
        requiredPaths: options.requiredPaths ?? embedded.requiredPaths ?? plan.requiredPaths ?? [],
        movementConnectors: options.movementConnectors ?? embedded.movementConnectors ?? plan.movementConnectors ?? []
    };
}

function normalizeRiverSystems(topology) {
    const systems = new Map();
    const ensureSystem = (id) => {
        const key = stableId(id, `river-${systems.size}`);
        if (!systems.has(key)) systems.set(key, { id: key, components: [], connectors: [] });
        return systems.get(key);
    };

    for (const [index, river] of asArray(topology.rivers).entries()) {
        const id = stableId(river?.id ?? river?.riverId, `river-${index}`);
        const system = ensureSystem(id);
        const nestedComponents = asArray(river?.components);
        if (nestedComponents.length) {
            nestedComponents.forEach((component, componentIndex) => {
                system.components.push(normalizeRiverComponent(component, id, componentIndex));
            });
        } else {
            system.components.push(normalizeRiverComponent(river, id, 0));
        }
        asArray(river?.connectors).forEach((connector, connectorIndex) => {
            system.connectors.push(normalizeRiverConnector(connector, id, connectorIndex));
        });
    }

    for (const [index, component] of asArray(topology.riverComponents).entries()) {
        const riverId = stableId(component?.riverId, component?.id ? `${component.id}-river` : `river-${index}`);
        ensureSystem(riverId).components.push(normalizeRiverComponent(component, riverId, index));
    }
    for (const [index, connector] of asArray(topology.riverConnectors).entries()) {
        const riverId = stableId(connector?.riverId, 'river-0');
        ensureSystem(riverId).connectors.push(normalizeRiverConnector(connector, riverId, index));
    }

    return [...systems.values()]
        .map((system) => ({
            ...system,
            components: system.components.sort((left, right) => left.id.localeCompare(right.id)),
            connectors: system.connectors.sort((left, right) => left.id.localeCompare(right.id))
        }))
        .sort((left, right) => left.id.localeCompare(right.id));
}

function normalizeRiverComponent(component, riverId, index) {
    return {
        id: stableId(component?.id ?? component?.componentId, `${riverId}:component-${index}`),
        cells: normalizeCellList(component?.cells ?? component?.points)
    };
}

function normalizeRiverConnector(connector, riverId, index) {
    const from = normalizeGridCell(connector?.from ?? connector?.start);
    const to = normalizeGridCell(connector?.to ?? connector?.end);
    const cells = normalizeCellList(connector?.cells ?? connector?.points);
    if (cells.length === 0 && from) cells.push(from);
    if (cells.length === 0 && to) cells.push(to);
    else if (to && !sameCell(cells.at(-1), to)) cells.push(to);
    return {
        id: stableId(connector?.id, `${riverId}:connector-${index}`),
        cells,
        virtual: connector?.virtual === true,
        allowNonWater: connector?.allowNonWater === true || connector?.kind === 'bridge-underpass'
    };
}

function validateRiverSystems(systems, grid, settings, issue) {
    let componentCount = 0;
    let connectorCount = 0;
    let continuousSystems = 0;
    let riverCellCount = 0;

    for (const system of systems) {
        const baseKeys = new Set();
        const allKeys = new Set();
        for (const component of system.components) {
            componentCount++;
            if (component.cells.length === 0) {
                issue('river-component-empty', component.id, `River component ${component.id} has no cells.`);
            }
            for (const cell of component.cells) {
                if (!inBounds(grid, cell)) {
                    issue(
                        'river-cell-out-of-bounds',
                        component.id,
                        `River component ${component.id} references an out-of-bounds cell.`,
                        [cell]
                    );
                    continue;
                }
                if (settings.requireRiverSymbols && !isWaterCell(grid, cell, settings)) {
                    issue(
                        'river-cell-not-water',
                        component.id,
                        `River component ${component.id} contains a non-water plan cell.`,
                        [cell]
                    );
                }
                baseKeys.add(cellKey(cell));
                allKeys.add(cellKey(cell));
            }
        }
        riverCellCount += baseKeys.size;

        for (const connector of system.connectors) {
            connectorCount++;
            if (connector.cells.length < 2 && !connector.virtual) {
                issue(
                    'river-connector-empty',
                    connector.id,
                    `River connector ${connector.id} must contain at least two cells.`
                );
                continue;
            }
            for (const cell of connector.cells) {
                if (!inBounds(grid, cell)) {
                    issue(
                        'river-connector-out-of-bounds',
                        connector.id,
                        `River connector ${connector.id} references an out-of-bounds cell.`,
                        [cell]
                    );
                    continue;
                }
                if (settings.requireRiverSymbols && !connector.allowNonWater && !isWaterCell(grid, cell, settings)) {
                    issue(
                        'river-connector-not-water',
                        connector.id,
                        `River connector ${connector.id} contains a non-water plan cell.`,
                        [cell]
                    );
                }
                allKeys.add(cellKey(cell));
            }
            if (!connector.virtual) {
                for (let index = 1; index < connector.cells.length; index++) {
                    if (manhattan(connector.cells[index - 1], connector.cells[index]) !== 1) {
                        issue(
                            'river-connector-gap',
                            connector.id,
                            `River connector ${connector.id} is not cardinally continuous.`,
                            [connector.cells[index - 1], connector.cells[index]]
                        );
                    }
                }
            }
            const first = connector.cells[0];
            const last = connector.cells.at(-1);
            if (first && !touchesKeySet(first, baseKeys) && !baseKeys.has(cellKey(first))) {
                issue(
                    'river-connector-hanging',
                    connector.id,
                    `River connector ${connector.id} does not attach to a river component at its start.`,
                    [first]
                );
            }
            if (last && !touchesKeySet(last, baseKeys) && !baseKeys.has(cellKey(last))) {
                issue(
                    'river-connector-hanging',
                    connector.id,
                    `River connector ${connector.id} does not attach to a river component at its end.`,
                    [last]
                );
            }
        }

        const effectiveComponents = countEffectiveRiverComponents(system, allKeys);
        if (allKeys.size > 0 && effectiveComponents > 1) {
            issue(
                'river-disconnected',
                system.id,
                `River ${system.id} resolves to ${effectiveComponents} disconnected logical components.`
            );
        } else if (allKeys.size > 0) {
            continuousSystems++;
        }
    }

    return Object.freeze({
        systems: systems.length,
        continuousSystems,
        components: componentCount,
        connectors: connectorCount,
        cells: riverCellCount
    });
}

function countEffectiveRiverComponents(system, allKeys) {
    if (allKeys.size === 0) return 0;
    const componentByKey = labelKeyComponents(allKeys);
    const componentIds = [...new Set(componentByKey.values())].sort(numberCompare);
    const parents = new Map(componentIds.map((id) => [id, id]));
    const find = (id) => {
        let root = id;
        while (parents.get(root) !== root) root = parents.get(root);
        let cursor = id;
        while (parents.get(cursor) !== cursor) {
            const next = parents.get(cursor);
            parents.set(cursor, root);
            cursor = next;
        }
        return root;
    };
    const union = (left, right) => {
        const leftRoot = find(left);
        const rightRoot = find(right);
        if (leftRoot === rightRoot) return;
        parents.set(Math.max(leftRoot, rightRoot), Math.min(leftRoot, rightRoot));
    };
    for (const connector of system.connectors.filter((entry) => entry.virtual)) {
        const first = connector.cells[0];
        const last = connector.cells.at(-1);
        const firstComponent = first ? nearestComponentId(first, componentByKey) : null;
        const lastComponent = last ? nearestComponentId(last, componentByKey) : null;
        if (firstComponent !== null && lastComponent !== null && firstComponent !== lastComponent) {
            union(firstComponent, lastComponent);
        }
    }
    return new Set(componentIds.map(find)).size;
}

function normalizeGates(topology, plan) {
    const gates = asArray(topology.gates).map((gate, index) => normalizeGate(gate, index));
    for (const [settlementIndex, settlement] of asArray(plan.settlements).entries()) {
        for (const [ringIndex, ring] of asArray(settlement?.wallRings).entries()) {
            for (const [gateIndex, gate] of asArray(ring?.gates).entries()) {
                gates.push(normalizeGate({
                    ...gate,
                    id: gate.id || `settlement-${settlementIndex}:ring-${ringIndex}:gate-${gateIndex}`
                }, gates.length));
            }
        }
    }
    return gates
        .filter((entry) => entry.grid)
        .sort((left, right) => left.id.localeCompare(right.id));
}

function normalizeGate(gate, index) {
    return {
        id: stableId(gate?.id, `gate-${index}`),
        grid: normalizeGridCell(gate?.grid ?? gate?.cell ?? gate),
        edge: normalizeEdge(gate?.edge),
        inside: normalizeGridCell(gate?.insideGrid ?? gate?.inside),
        outside: normalizeGridCell(gate?.outsideGrid ?? gate?.outside),
        road: normalizeGridCell(gate?.roadGrid ?? gate?.road)
    };
}

function validateGates(gates, grid, movementContext, roadStats, settings, issue) {
    let connected = 0;
    const connections = [];
    for (const gate of gates) {
        if (!inBounds(grid, gate.grid)) {
            issue('gate-out-of-bounds', gate.id, `Gate ${gate.id} is outside the logical grid.`, [gate.grid]);
            continue;
        }
        let gateValid = true;
        if (!isWalkableCell(grid, gate.grid)) {
            issue('gate-blocked', gate.id, `Gate ${gate.id} occupies a blocked plan cell.`, [gate.grid]);
            gateValid = false;
        }
        const lane = resolveGateLane(gate, grid, movementContext, settings);
        if (!lane) {
            issue(
                'gate-hanging',
                gate.id,
                `Gate ${gate.id} has no traversable inside/outside lane.`,
                [gate.grid]
            );
            continue;
        }
        if (sameCell(lane.inside, lane.outside)) {
            issue(
                'gate-lanes-not-distinct',
                gate.id,
                `Gate ${gate.id} uses the same cell for its inside and outside road lanes.`,
                [lane.inside]
            );
            gateValid = false;
        }
        if (manhattan(gate.grid, lane.inside) !== 1 || manhattan(gate.grid, lane.outside) !== 1) {
            issue(
                'gate-lane-not-adjacent',
                gate.id,
                `Gate ${gate.id} inside and outside lanes must both be cardinally adjacent.`,
                [gate.grid, lane.inside, lane.outside]
            );
            gateValid = false;
        }
        if (!lanesAreOpposite(gate.grid, lane.inside, lane.outside)) {
            issue(
                'gate-lanes-not-opposite',
                gate.id,
                `Gate ${gate.id} inside and outside lanes must cross opposite sides of the gate.`,
                [gate.grid, lane.inside, lane.outside]
            );
            gateValid = false;
        }
        for (const [side, cell] of [['inside', lane.inside], ['outside', lane.outside]]) {
            if (!isRoadCell(grid, cell, settings)) {
                issue(
                    'gate-lane-not-road',
                    `${gate.id}:${side}`,
                    `Gate ${gate.id} ${side} lane is not an authored road cell.`,
                    [cell]
                );
                gateValid = false;
            }
            if (!canTraverseStep(grid, gate.grid, cell, movementContext, settings)) {
                issue(
                    'gate-threshold-step',
                    `${gate.id}:${side}`,
                    `Gate ${gate.id} cannot reach its ${side} landing within one player elevation step.`,
                    [gate.grid, cell],
                    elevationDetails(grid, gate.grid, cell)
                );
                gateValid = false;
            }
        }
        const insideComponent = roadStats.componentByKey.get(cellKey(lane.inside)) ?? null;
        const outsideComponent = roadStats.componentByKey.get(cellKey(lane.outside)) ?? null;
        const sharedComponent = insideComponent && insideComponent === outsideComponent
            ? insideComponent
            : null;
        if (settings.requireGateRoadConnection && !sharedComponent) {
            issue(
                'gate-road-component-mismatch',
                gate.id,
                `Gate ${gate.id} inside and outside lanes do not share one traversable road component.`,
                [lane.inside, gate.grid, lane.outside],
                { insideComponent, outsideComponent }
            );
            gateValid = false;
        }
        connections.push(Object.freeze({
            id: gate.id,
            grid: Object.freeze({ ...gate.grid }),
            inside: Object.freeze({ ...lane.inside }),
            outside: Object.freeze({ ...lane.outside }),
            roadComponentId: sharedComponent,
            valid: gateValid
        }));
        if (gateValid) connected++;
    }
    return Object.freeze({ gates: gates.length, connected, connections: Object.freeze(connections) });
}

function resolveGateLane(gate, grid, movementContext, settings) {
    if (gate.inside && gate.outside) return { inside: gate.inside, outside: gate.outside };
    if (gate.edge) {
        const outside = gate.outside || addCell(gate.grid, EDGE_DIRECTIONS[gate.edge]);
        const inside = gate.inside || addCell(gate.grid, invertDirection(EDGE_DIRECTIONS[gate.edge]));
        return { inside, outside };
    }
    for (const direction of [EDGE_DIRECTIONS.north, EDGE_DIRECTIONS.east]) {
        const first = addCell(gate.grid, direction);
        const second = addCell(gate.grid, invertDirection(direction));
        if (isRoadCell(grid, first, settings) &&
            isRoadCell(grid, second, settings) &&
            canTraverseStep(grid, gate.grid, first, movementContext, settings) &&
            canTraverseStep(grid, gate.grid, second, movementContext, settings)) {
            return { inside: first, outside: second };
        }
    }
    return null;
}

function validateSharedRoadConnections(
    buildingStats,
    gateStats,
    grid,
    movementContext,
    settings,
    issue
) {
    const gateConnections = gateStats.connections
        .filter((connection) => connection.valid && connection.roadComponentId)
        .sort((left, right) => left.id.localeCompare(right.id));
    const sharedComponents = new Set(gateConnections.map((connection) => connection.roadComponentId));
    const required = settings.requireDoorGateConnection && gateStats.gates > 0;
    let doorsChecked = 0;
    let doorsConnectedToGate = 0;
    if (required) {
        for (const door of buildingStats.connections) {
            doorsChecked++;
            if (!door.approach || !door.roadComponentId) continue;
            const candidates = gateConnections.filter((gate) =>
                gate.roadComponentId === door.roadComponentId);
            if (candidates.length === 0) {
                issue(
                    'door-gate-road-component-mismatch',
                    door.id,
                    `Building ${door.id} reaches a road component that is not shared by any valid gate.`,
                    [door.approach],
                    { roadComponentId: door.roadComponentId }
                );
                continue;
            }
            const gatePath = candidates
                .map((gate) => ({ gate, path: findPath(grid, door.approach, gate.grid, movementContext, settings) }))
                .find((entry) => entry.path);
            if (!gatePath) {
                issue(
                    'door-gate-path-unreachable',
                    door.id,
                    `Building ${door.id} cannot traverse from its approach to a gate on the shared road component.`,
                    [door.approach, ...candidates.map((gate) => gate.grid)]
                );
                continue;
            }
            doorsConnectedToGate++;
        }
    }
    return Object.freeze({
        required,
        doorsChecked,
        doorsConnectedToGate,
        sharedRoadComponents: sharedComponents.size
    });
}

function validateBuildings(rawBuildings, grid, movementContext, roadStats, settings, issue) {
    const buildings = asArray(rawBuildings)
        .map((building, index) => normalizeBuilding(building, index, grid, settings))
        .sort((left, right) => left.id.localeCompare(right.id));
    const claimedDoors = new Map();
    let levelFootprints = 0;
    let connectedDoors = 0;
    let doorCount = 0;
    const connections = [];

    for (const building of buildings) {
        if (building.footprint.length === 0) {
            issue(
                'building-footprint-empty',
                building.id,
                `Building ${building.id} has no logical footprint cells.`
            );
            continue;
        }
        const footprintKeys = new Set();
        const elevations = [];
        for (const cell of building.footprint) {
            const key = cellKey(cell.world);
            if (footprintKeys.has(key)) {
                issue(
                    'building-footprint-duplicate',
                    building.id,
                    `Building ${building.id} repeats a footprint cell.`,
                    [cell.world]
                );
                continue;
            }
            footprintKeys.add(key);
            if (!inBounds(grid, cell.world)) {
                issue(
                    'building-footprint-out-of-bounds',
                    building.id,
                    `Building ${building.id} has an out-of-bounds footprint cell.`,
                    [cell.world]
                );
                continue;
            }
            const elevation = getElevation(grid, cell.world);
            if (!Number.isFinite(elevation)) {
                issue(
                    'building-footprint-elevation-missing',
                    building.id,
                    `Building ${building.id} has a footprint cell without a finite elevation.`,
                    [cell.world]
                );
            } else {
                elevations.push(elevation);
            }
        }
        const span = elevations.length ? Math.max(...elevations) - Math.min(...elevations) : Infinity;
        if (span > settings.maxBuildingElevationSpan) {
            issue(
                'building-footprint-not-level',
                building.id,
                `Building ${building.id} footprint spans ${span} elevation tiers; maximum is ${settings.maxBuildingElevationSpan}.`,
                building.footprint.map((entry) => entry.world),
                { span, maximumSpan: settings.maxBuildingElevationSpan }
            );
        } else if (Number.isFinite(span)) {
            levelFootprints++;
        }
        if (Number.isFinite(building.baseElevation) && elevations.some((value) => value !== building.baseElevation)) {
            issue(
                'building-base-elevation-mismatch',
                building.id,
                `Building ${building.id} footprint does not consistently match base elevation ${building.baseElevation}.`,
                building.footprint.map((entry) => entry.world),
                { baseElevation: building.baseElevation, elevations: [...new Set(elevations)].sort(numberCompare) }
            );
        }
        validateBuildingFloorLevels(building, issue);

        if (!building.door) {
            issue('building-door-missing', building.id, `Building ${building.id} has no exterior door metadata.`);
            continue;
        }
        doorCount++;
        const doorKey = cellKey(building.door.world);
        if (claimedDoors.has(doorKey)) {
            issue(
                'door-shared',
                building.id,
                `Building ${building.id} shares its door cell with ${claimedDoors.get(doorKey)}.`,
                [building.door.world]
            );
        } else {
            claimedDoors.set(doorKey, building.id);
        }
        const connection = validateBuildingDoor(
            building,
            footprintKeys,
            grid,
            movementContext,
            roadStats,
            settings,
            issue
        );
        connections.push(connection);
        if (connection.valid) connectedDoors++;
    }

    for (let row = 0; row < grid.height; row++) {
        for (let col = 0; col < grid.width; col++) {
            const cell = { col, row };
            if (!isDoorCell(grid, cell, settings)) continue;
            if (!claimedDoors.has(cellKey(cell))) {
                issue(
                    'door-hanging',
                    `door-${col}-${row}`,
                    'A door tile is not owned by any generated building entrance.',
                    [cell]
                );
            }
        }
    }

    return Object.freeze({
        buildings: buildings.length,
        levelFootprints,
        doors: doorCount,
        connectedDoors,
        connections: Object.freeze(connections)
    });
}

function normalizeBuilding(building, index, grid, settings) {
    const id = stableId(building?.id, `building-${index}`);
    const absoluteOrigin = settings.buildingCoordinates === 'absolute' ||
        building?.coordinateSpace === 'grid' ||
        Array.isArray(building?.originGrid);
    const origin = normalizeGridCell(building?.originGrid) || {
        col: finiteInteger(building?.x, 0) + (absoluteOrigin ? 0 : grid.center.col),
        row: finiteInteger(building?.y, 0) + (absoluteOrigin ? 0 : grid.center.row)
    };
    const localFootprint = asArray(building?.footprintCells).length
        ? normalizeLocalCellList(building.footprintCells)
        : createRectCells(building?.width, building?.height);
    const footprint = localFootprint.map((local) => ({
        local,
        world: { col: origin.col + local.x, row: origin.row + local.y }
    }));
    const localDoor = normalizeLocalCell(
        building?.door ?? building?.entrance?.grid ?? building?.entrance?.door
    );
    const edge = normalizeEdge(building?.door?.edge ?? building?.entrance?.edge);
    const worldDoor = localDoor
        ? { col: origin.col + localDoor.x, row: origin.row + localDoor.y }
        : normalizeGridCell(building?.doorGrid ?? building?.entrance?.doorGrid);
    const approach = normalizeGridCell(building?.entrance?.approachGrid) || (() => {
        const relative = normalizeLocalCell(building?.entrance?.approach);
        return relative ? { col: grid.center.col + relative.x, row: grid.center.row + relative.y } : null;
    })();
    return {
        raw: building || {},
        id,
        origin,
        footprint,
        footprintLocalKeys: new Set(localFootprint.map(localCellKey)),
        baseElevation: finiteNumberOrNull(building?.baseElevation),
        stories: Math.max(0, finiteInteger(building?.stories, 0)),
        floors: asArray(building?.floors),
        interiorKeys: new Set(asArray(building?.interior?.openCells).map((cell) => {
            const local = normalizeLocalCell(cell);
            return local ? localCellKey(local) : '';
        }).filter(Boolean)),
        stairKeys: new Set(getBuildingStairCells(building).map((cell) => {
            const local = normalizeLocalCell(cell);
            return local ? localCellKey(local) : '';
        }).filter(Boolean)),
        door: localDoor && worldDoor ? { local: localDoor, world: worldDoor, edge, approach } : null
    };
}

function getBuildingStairCells(building) {
    const cells = [...asArray(building?.stairCells)];
    for (const stair of asArray(building?.stairs)) {
        cells.push(stair);
        cells.push(...asArray(stair?.cells));
    }
    return cells;
}

function validateBuildingFloorLevels(building, issue) {
    if (building.stories <= 0 || building.floors.length === 0) return;
    const levels = new Set(building.floors
        .map((floor) => finiteInteger(floor?.level, -1))
        .filter((level) => level >= 0));
    for (let level = 0; level < building.stories; level++) {
        if (levels.has(level)) continue;
        issue(
            'building-floor-level-missing',
            `${building.id}:floor-${level}`,
            `Building ${building.id} is missing logical floor level ${level}.`
        );
    }
}

function validateBuildingDoor(building, footprintKeys, grid, movementContext, roadStats, settings, issue) {
    const door = building.door;
    if (!inBounds(grid, door.world)) {
        issue('door-out-of-bounds', building.id, `Building ${building.id} door is out of bounds.`, [door.world]);
        return createDoorConnection(building, null, null, null, false);
    }
    if (!footprintKeys.has(cellKey(door.world))) {
        issue(
            'door-off-footprint',
            building.id,
            `Building ${building.id} door is not part of its footprint.`,
            [door.world]
        );
    }
    const boundaryEdges = CARDINALS.filter((direction) =>
        !building.footprintLocalKeys.has(localCellKey({
            x: door.local.x + direction.x,
            y: door.local.y + direction.y
        })));
    if (boundaryEdges.length === 0) {
        issue(
            'door-not-on-boundary',
            building.id,
            `Building ${building.id} door is not on its footprint boundary.`,
            [door.world]
        );
    }
    if (!door.edge || !boundaryEdges.some((direction) => direction.edge === door.edge)) {
        issue(
            'door-edge-mismatch',
            building.id,
            `Building ${building.id} door edge does not face outside its footprint.`,
            [door.world],
            { edge: door.edge }
        );
    }
    if (settings.requireStampedDoorSymbols && !isDoorCell(grid, door.world, settings)) {
        issue(
            'door-symbol-missing',
            building.id,
            `Building ${building.id} entrance is not stamped as a door tile.`,
            [door.world]
        );
    }

    const outsideDirection = EDGE_DIRECTIONS[door.edge] || boundaryEdges[0];
    const expectedApproach = outsideDirection ? addCell(door.world, outsideDirection) : null;
    const approach = door.approach || expectedApproach;
    if (!approach) {
        issue('door-approach-missing', building.id, `Building ${building.id} has no exterior door approach.`);
        return createDoorConnection(building, null, null, null, false);
    }
    if (!expectedApproach || !sameCell(approach, expectedApproach)) {
        issue(
            'door-approach-not-adjacent',
            building.id,
            `Building ${building.id} approach is not the cardinal exterior landing of its door.`,
            [door.world, approach]
        );
    }
    if (footprintKeys.has(cellKey(approach))) {
        issue(
            'door-approach-inside-footprint',
            building.id,
            `Building ${building.id} exterior approach lies inside its footprint.`,
            [approach]
        );
    }
    const interiorLocal = outsideDirection ? {
        x: door.local.x - outsideDirection.x,
        y: door.local.y - outsideDirection.y
    } : null;
    const interior = interiorLocal ? {
        col: building.origin.col + interiorLocal.x,
        row: building.origin.row + interiorLocal.y
    } : null;
    if (!interior || !footprintKeys.has(cellKey(interior)) ||
        (building.interiorKeys.size > 0 &&
            !building.interiorKeys.has(localCellKey(interiorLocal)) &&
            !building.stairKeys.has(localCellKey(interiorLocal)))) {
        issue(
            'door-interior-landing-missing',
            building.id,
            `Building ${building.id} door has no authored interior landing.`,
            interior ? [door.world, interior] : [door.world]
        );
        return createDoorConnection(building, approach, null, null, false);
    }

    let directStepsValid = true;
    for (const [side, cell] of [['exterior', approach], ['interior', interior]]) {
        if (!inBounds(grid, cell) || !isWalkableCell(grid, cell)) {
            issue(
                'door-landing-blocked',
                `${building.id}:${side}`,
                `Building ${building.id} ${side} door landing is blocked.`,
                [cell]
            );
            directStepsValid = false;
            continue;
        }
        if (!canTraverseStep(grid, door.world, cell, movementContext, settings)) {
            issue(
                'door-threshold-step',
                `${building.id}:${side}`,
                `Building ${building.id} ${side} threshold exceeds one player elevation step.`,
                [door.world, cell],
                elevationDetails(grid, door.world, cell)
            );
            directStepsValid = false;
        }
    }

    const roadConnection = resolveRoadConnectionForCell(
        grid,
        approach,
        movementContext,
        roadStats,
        settings
    );
    if (settings.requireDoorRoadConnection && !roadConnection) {
        issue(
            'door-road-disconnected',
            building.id,
            `Building ${building.id} exterior approach cannot reach a road within ${settings.maxRoadConnectionDistance} steps.`,
            [approach]
        );
        return createDoorConnection(building, approach, null, null, false);
    }
    return createDoorConnection(
        building,
        approach,
        roadConnection?.roadCell || null,
        roadConnection?.roadComponentId || null,
        directStepsValid && (!settings.requireDoorRoadConnection || Boolean(roadConnection))
    );
}

function createDoorConnection(building, approach, roadCell, roadComponentId, valid) {
    return Object.freeze({
        id: building.id,
        door: building.door?.world ? Object.freeze({ ...building.door.world }) : null,
        approach: approach ? Object.freeze({ ...approach }) : null,
        roadCell: roadCell ? Object.freeze({ ...roadCell }) : null,
        roadComponentId,
        valid: Boolean(valid)
    });
}

function analyzeRoadNetwork(grid, movementContext, settings, issue) {
    const roadKeys = new Set();
    for (let row = 0; row < grid.height; row++) {
        for (let col = 0; col < grid.width; col++) {
            const cell = { col, row };
            if (isRoadCell(grid, cell, settings)) roadKeys.add(cellKey(cell));
        }
    }
    const forwardAdjacencies = [
        { x: 1, y: 0 },
        { x: 0, y: 1 },
        { x: 1, y: 1 },
        { x: -1, y: 1 }
    ];
    for (const key of [...roadKeys].sort(compareCellKeys)) {
        const cell = parseCellKey(key);
        for (const direction of forwardAdjacencies) {
            const neighbor = addCell(cell, direction);
            if (!roadKeys.has(cellKey(neighbor))) continue;
            const fromElevation = getElevation(grid, cell);
            const toElevation = getElevation(grid, neighbor);
            if (!Number.isFinite(fromElevation) || !Number.isFinite(toElevation) ||
                Math.abs(toElevation - fromElevation) <= settings.maxStep) continue;
            issue(
                'road-elevation-discontinuity',
                `road-${cell.col}-${cell.row}-to-${neighbor.col}-${neighbor.row}`,
                'Adjacent authored road cells exceed the player elevation step.',
                [cell, neighbor],
                elevationDetails(grid, cell, neighbor)
            );
        }
    }

    const unseen = new Set(roadKeys);
    const components = [];
    const componentByKey = new Map();
    while (unseen.size) {
        const first = parseCellKey([...unseen].sort(compareCellKeys)[0]);
        const queue = [first];
        unseen.delete(cellKey(first));
        const cells = [];
        while (queue.length) {
            const current = queue.shift();
            cells.push(current);
            for (const next of movementNeighbors(grid, current, movementContext, settings)) {
                const key = cellKey(next);
                if (!roadKeys.has(key) || !unseen.has(key)) continue;
                unseen.delete(key);
                queue.push(next);
            }
        }
        cells.sort(compareCells);
        const component = Object.freeze({
            id: `road-component-${cells[0].col}-${cells[0].row}`,
            size: cells.length,
            cells: Object.freeze(cells.map((cell) => Object.freeze({ ...cell })))
        });
        components.push(component);
        for (const cell of cells) componentByKey.set(cellKey(cell), component.id);
    }
    components.sort((left, right) => compareCells(left.cells[0], right.cells[0]));
    const nontrivial = components.filter((component) => component.size > 1);
    const primaryComponent = [...nontrivial].sort((left, right) =>
        right.size - left.size || left.id.localeCompare(right.id))[0] || null;
    const boundaryMargin = grid.width >= 20 && grid.height >= 20 ? 3 : 0;
    const disconnectedInternal = nontrivial.filter((component) =>
        component !== primaryComponent && !(boundaryMargin > 0 && component.cells.some((cell) =>
            cell.col <= boundaryMargin || cell.row <= boundaryMargin ||
            cell.col >= grid.width - 1 - boundaryMargin ||
            cell.row >= grid.height - 1 - boundaryMargin)));
    if (settings.requireConnectedRoadNetwork && disconnectedInternal.length > 0) {
        issue(
            'road-components-disconnected',
            'road-network',
            `Authored roads contain ${disconnectedInternal.length} disconnected internal component(s).`,
            [primaryComponent, ...disconnectedInternal]
                .filter(Boolean)
                .map((component) => component.cells[0]),
            {
                primaryComponentSize: primaryComponent?.size || 0,
                disconnectedComponentSizes: disconnectedInternal.map((component) => component.size)
            }
        );
    }
    return Object.freeze({
        roadKeys,
        componentByKey,
        componentRecords: Object.freeze(components),
        cells: roadKeys.size,
        components: components.length,
        nontrivialComponents: nontrivial.length,
        disconnectedInternalComponents: disconnectedInternal.length,
        componentSizes: Object.freeze(components.map((component) => component.size).sort(numberCompare))
    });
}

function normalizeRequiredPaths(topology) {
    return asArray(topology.requiredPaths)
        .map((path, index) => {
            const points = normalizeCellList(path?.points ?? path?.waypoints);
            const from = normalizeGridCell(path?.from ?? path?.start) || points.shift() || null;
            const to = normalizeGridCell(path?.to ?? path?.end) || points.pop() || null;
            return {
                id: stableId(path?.id, `required-path-${index}`),
                from,
                to,
                via: normalizeCellList(path?.via ?? points),
                requireSharedRoadComponent: path?.requireSharedRoadComponent !== false
            };
        })
        .sort((left, right) => left.id.localeCompare(right.id));
}

function validateRequiredPaths(paths, grid, movementContext, roadStats, settings, issue) {
    let traversable = 0;
    let sharedRoadComponent = 0;
    for (const required of paths) {
        if (!required.from || !required.to) {
            issue(
                'required-path-endpoint-missing',
                required.id,
                `Required path ${required.id} must define from and to cells.`
            );
            continue;
        }
        const checkpoints = [required.from, ...required.via, required.to];
        let valid = true;
        for (const [index, endpoint] of checkpoints.entries()) {
            if (!inBounds(grid, endpoint)) {
                issue(
                    'required-path-endpoint-out-of-bounds',
                    `${required.id}:${index}`,
                    `Required path ${required.id} has an out-of-bounds checkpoint.`,
                    [endpoint]
                );
                valid = false;
            } else if (!isWalkableCell(grid, endpoint)) {
                issue(
                    'required-path-endpoint-blocked',
                    `${required.id}:${index}`,
                    `Required path ${required.id} has a blocked checkpoint.`,
                    [endpoint]
                );
                valid = false;
            }
        }
        if (!valid) continue;
        for (let index = 1; index < checkpoints.length; index++) {
            const path = findPath(grid, checkpoints[index - 1], checkpoints[index], movementContext, settings);
            if (path) continue;
            issue(
                'required-path-unreachable',
                `${required.id}:segment-${index - 1}`,
                `Required path ${required.id} has no player-traversable route between checkpoints ${index - 1} and ${index}.`,
                [checkpoints[index - 1], checkpoints[index]]
            );
            valid = false;
        }
        if (required.requireSharedRoadComponent && settings.requireRequiredPathRoadComponent) {
            const componentIds = [];
            for (const [index, checkpoint] of checkpoints.entries()) {
                const connection = resolveRoadConnectionForCell(
                    grid,
                    checkpoint,
                    movementContext,
                    roadStats,
                    settings
                );
                if (connection) {
                    componentIds.push(connection.roadComponentId);
                    continue;
                }
                issue(
                    'required-path-road-disconnected',
                    `${required.id}:${index}`,
                    `Required path ${required.id} checkpoint ${index} cannot reach an authored road.`,
                    [checkpoint]
                );
                valid = false;
            }
            const distinctComponents = [...new Set(componentIds.filter(Boolean))].sort();
            if (distinctComponents.length > 1) {
                issue(
                    'required-path-road-component-mismatch',
                    required.id,
                    `Required path ${required.id} checkpoints attach to different road components.`,
                    checkpoints,
                    { roadComponentIds: distinctComponents }
                );
                valid = false;
            } else if (componentIds.length === checkpoints.length && distinctComponents.length === 1) {
                sharedRoadComponent++;
            }
        }
        if (valid) traversable++;
    }
    return Object.freeze({ paths: paths.length, traversable, sharedRoadComponent });
}

function normalizeMovementConnectors(topology) {
    return asArray(topology.movementConnectors)
        .map((connector, index) => ({
            id: stableId(connector?.id, `movement-connector-${index}`),
            from: normalizeGridCell(connector?.from ?? connector?.start),
            to: normalizeGridCell(connector?.to ?? connector?.end),
            pairedStair: connector?.pairedStair === true || connector?.kind === 'stairs' || connector?.type === 'stairs',
            bidirectional: connector?.bidirectional !== false
        }))
        .filter((entry) => entry.from && entry.to)
        .sort((left, right) => left.id.localeCompare(right.id));
}

function createMovementContext(grid, connectors, settings) {
    const connectorTargets = new Map();
    for (const connector of connectors) {
        if (!connector.pairedStair) continue;
        if (!inBounds(grid, connector.from) || !inBounds(grid, connector.to)) continue;
        addConnectorTarget(connectorTargets, connector.from, connector.to);
        if (connector.bidirectional) addConnectorTarget(connectorTargets, connector.to, connector.from);
    }
    return { connectorTargets, settings };
}

function addConnectorTarget(targets, from, to) {
    const key = cellKey(from);
    if (!targets.has(key)) targets.set(key, []);
    targets.get(key).push(to);
    targets.get(key).sort(compareCells);
}

function findPath(grid, start, end, movementContext, settings) {
    if (!inBounds(grid, start) || !inBounds(grid, end)) return null;
    if (!isWalkableCell(grid, start) || !isWalkableCell(grid, end)) return null;
    const startKey = cellKey(start);
    const endKey = cellKey(end);
    const queue = [start];
    const previous = new Map([[startKey, null]]);
    let cursor = 0;
    while (cursor < queue.length) {
        const current = queue[cursor++];
        if (cellKey(current) === endKey) return reconstructPath(previous, endKey);
        for (const next of movementNeighbors(grid, current, movementContext, settings)) {
            const key = cellKey(next);
            if (previous.has(key)) continue;
            previous.set(key, cellKey(current));
            queue.push(next);
        }
    }
    return null;
}

function movementNeighbors(grid, current, movementContext, settings) {
    const candidates = CARDINALS.map((direction) => addCell(current, direction));
    if (settings.allowDiagonal) candidates.push(...DIAGONALS.map((direction) => addCell(current, direction)));
    candidates.push(...(movementContext.connectorTargets.get(cellKey(current)) || []));
    return candidates
        .filter((next, index, all) => all.findIndex((candidate) => sameCell(candidate, next)) === index)
        .filter((next) => canTraverseStep(grid, current, next, movementContext, settings))
        .sort(compareCells);
}

function canTraverseStep(grid, from, to, movementContext, settings) {
    if (!inBounds(grid, from) || !inBounds(grid, to)) return false;
    if (!isWalkableCell(grid, from) || !isWalkableCell(grid, to)) return false;
    const dx = to.col - from.col;
    const dy = to.row - from.row;
    const isExplicitConnector = (movementContext.connectorTargets.get(cellKey(from)) || [])
        .some((target) => sameCell(target, to));
    if (isExplicitConnector) return true;
    if (Math.abs(dx) > 1 || Math.abs(dy) > 1 || (dx === 0 && dy === 0)) return false;
    const fromElevation = getElevation(grid, from);
    const toElevation = getElevation(grid, to);
    if (!Number.isFinite(fromElevation) || !Number.isFinite(toElevation)) return false;
    if (Math.abs(toElevation - fromElevation) > settings.maxStep) return false;
    if (dx === 0 || dy === 0) return true;

    // PlayerAvatar/WorldGenerator diagonal movement requires both orthogonal clearance lanes.
    const horizontal = { col: from.col + dx, row: from.row };
    const vertical = { col: from.col, row: from.row + dy };
    return canTraverseCardinalClearance(grid, from, horizontal, settings) &&
        canTraverseCardinalClearance(grid, from, vertical, settings);
}

function canTraverseCardinalClearance(grid, from, to, settings) {
    if (!inBounds(grid, to) || !isWalkableCell(grid, to)) return false;
    const fromElevation = getElevation(grid, from);
    const toElevation = getElevation(grid, to);
    return Number.isFinite(fromElevation) && Number.isFinite(toElevation) &&
        Math.abs(toElevation - fromElevation) <= settings.maxStep;
}

function findNearestRoadPath(grid, start, movementContext, settings, roadKeys) {
    if (!inBounds(grid, start) || !isWalkableCell(grid, start)) return null;
    if (roadKeys.has(cellKey(start))) return [start];
    const queue = [{ cell: start, distance: 0 }];
    const previous = new Map([[cellKey(start), null]]);
    let cursor = 0;
    while (cursor < queue.length) {
        const { cell, distance } = queue[cursor++];
        if (distance >= settings.maxRoadConnectionDistance) continue;
        for (const next of movementNeighbors(grid, cell, movementContext, settings)) {
            const key = cellKey(next);
            if (previous.has(key)) continue;
            previous.set(key, cellKey(cell));
            if (roadKeys.has(key)) return reconstructPath(previous, key);
            queue.push({ cell: next, distance: distance + 1 });
        }
    }
    return null;
}

function resolveRoadConnectionForCell(grid, start, movementContext, roadStats, settings) {
    const path = findNearestRoadPath(
        grid,
        start,
        movementContext,
        settings,
        roadStats.roadKeys
    );
    const roadCell = path?.at(-1) || null;
    const roadComponentId = roadCell
        ? roadStats.componentByKey.get(cellKey(roadCell)) ?? null
        : null;
    return roadCell && roadComponentId
        ? { path, roadCell, roadComponentId }
        : null;
}

function reconstructPath(previous, endKey) {
    const path = [];
    let key = endKey;
    while (key !== null) {
        path.push(parseCellKey(key));
        key = previous.get(key) ?? null;
    }
    return path.reverse();
}

function createGenerationMetadata({
    valid,
    errorCount,
    warningCount,
    issues,
    grid,
    riverStats,
    roadStats,
    buildingStats,
    gateStats,
    sharedRoadStats,
    requiredPathStats,
    settings
}) {
    return Object.freeze({
        formulaVersion: WORLD_PATH_CONNECTIVITY_VERSION,
        valid,
        errors: errorCount,
        warnings: warningCount,
        issueCodes: Object.freeze([...new Set(issues.map((entry) => entry.code))].sort()),
        grid: Object.freeze({ width: grid.width, height: grid.height }),
        rivers: riverStats,
        roads: Object.freeze({
            cells: roadStats.cells,
            components: roadStats.components,
            nontrivialComponents: roadStats.nontrivialComponents,
            componentSizes: Object.freeze([...roadStats.componentSizes])
        }),
        buildings: Object.freeze({
            buildings: buildingStats.buildings,
            levelFootprints: buildingStats.levelFootprints,
            doors: buildingStats.doors,
            connectedDoors: buildingStats.connectedDoors
        }),
        gates: Object.freeze({ gates: gateStats.gates, connected: gateStats.connected }),
        sharedRoadAccess: sharedRoadStats,
        requiredPaths: requiredPathStats,
        movementRules: Object.freeze({
            maximumElevationStep: settings.maxStep,
            diagonalCornerClearance: settings.allowDiagonal ? 'both-orthogonal-lanes' : 'disabled',
            pairedStairConnectors: true,
            maximumBuildingElevationSpan: settings.maxBuildingElevationSpan
        })
    });
}

function isWalkableCell(grid, cell) {
    const key = cellKey(cell);
    if (grid.buildingFootprintKeys?.has(key) && !grid.buildingPortalKeys?.has(key)) return false;
    const raw = getRawCell(grid, cell);
    if (raw === undefined) return false;
    if (typeof raw === 'string' && raw === '=') return true;
    const normalized = normalizeTileCell(raw);
    return isBlockWalkable(normalized.element, normalized.texture, normalized.building);
}

function isRoadCell(grid, cell, settings) {
    if (!inBounds(grid, cell)) return false;
    if (grid.buildingFootprintKeys?.has(cellKey(cell))) return false;
    const raw = getRawCell(grid, cell);
    const symbol = getCellSymbol(raw);
    if (settings.roadSymbols.has(symbol)) return true;
    if (typeof raw === 'object' && raw) {
        const normalized = normalizeTileCell(raw);
        return normalized.element === ELEMENTS.GEO && normalized.texture === TEXTURE_IDS.ROAD;
    }
    return false;
}

function isWaterCell(grid, cell, settings) {
    if (!inBounds(grid, cell)) return false;
    const raw = getRawCell(grid, cell);
    if (settings.waterSymbols.has(getCellSymbol(raw))) return true;
    return typeof raw === 'object' && raw && normalizeTileCell(raw).element === ELEMENTS.HYDRO;
}

function isDoorCell(grid, cell, settings) {
    if (!inBounds(grid, cell)) return false;
    const raw = getRawCell(grid, cell);
    if (settings.doorSymbols.has(getCellSymbol(raw))) return true;
    return typeof raw === 'object' && raw && normalizeTileCell(raw).building === BUILDING_PARTS.DOOR;
}

function getCellSymbol(raw) {
    if (typeof raw === 'string') return raw.length === 1 ? raw.toUpperCase() : raw;
    try {
        return tileCellToSymbol(raw);
    } catch {
        return '';
    }
}

function getRawCell(grid, cell) {
    return grid.rows[cell.row]?.[cell.col];
}

function getElevation(grid, cell) {
    const raw = grid.elevationRows[cell.row]?.[cell.col];
    if (raw === null || raw === undefined || raw === '') return null;
    const value = Number(raw);
    return Number.isFinite(value) ? value : null;
}

function elevationDetails(grid, from, to) {
    const fromElevation = getElevation(grid, from);
    const toElevation = getElevation(grid, to);
    return {
        fromElevation,
        toElevation,
        delta: Number.isFinite(fromElevation) && Number.isFinite(toElevation)
            ? toElevation - fromElevation
            : null
    };
}

function createIssueCollector(target) {
    return (code, subject, message, cells = [], details = {}) => {
        target.push({
            code: String(code),
            severity: 'error',
            subject: stableId(subject, 'plan'),
            message: String(message),
            cells: normalizeCellList(cells).sort(compareCells),
            details: sortObject(details)
        });
    };
}

function freezeIssue(issue) {
    return Object.freeze({
        ...issue,
        cells: Object.freeze(issue.cells.map((cell) => Object.freeze({ ...cell }))),
        details: Object.freeze({ ...issue.details })
    });
}

function compareIssues(left, right) {
    return left.severity.localeCompare(right.severity) ||
        left.code.localeCompare(right.code) ||
        left.subject.localeCompare(right.subject) ||
        serializeCells(left.cells).localeCompare(serializeCells(right.cells)) ||
        left.message.localeCompare(right.message);
}

function normalizeGridCell(value) {
    if (!value) return null;
    if (Array.isArray(value)) {
        const col = Number(value[0]);
        const row = Number(value[1]);
        return Number.isFinite(col) && Number.isFinite(row)
            ? { col: Math.floor(col), row: Math.floor(row) }
            : null;
    }
    if (Array.isArray(value.grid)) return normalizeGridCell(value.grid);
    const col = Number(value.col ?? value.x);
    const row = Number(value.row ?? value.y);
    return Number.isFinite(col) && Number.isFinite(row)
        ? { col: Math.floor(col), row: Math.floor(row) }
        : null;
}

function normalizeLocalCell(value) {
    if (!value) return null;
    if (Array.isArray(value)) {
        const x = Number(value[0]);
        const y = Number(value[1]);
        return Number.isFinite(x) && Number.isFinite(y)
            ? { x: Math.floor(x), y: Math.floor(y) }
            : null;
    }
    const x = Number(value.x ?? value.col);
    const y = Number(value.y ?? value.row);
    return Number.isFinite(x) && Number.isFinite(y)
        ? { x: Math.floor(x), y: Math.floor(y) }
        : null;
}

function normalizeCellList(values) {
    return asArray(values).map(normalizeGridCell).filter(Boolean);
}

function normalizeLocalCellList(values) {
    return asArray(values).map(normalizeLocalCell).filter(Boolean);
}

function createRectCells(rawWidth, rawHeight) {
    const width = Math.max(0, finiteInteger(rawWidth, 0));
    const height = Math.max(0, finiteInteger(rawHeight, 0));
    return Array.from({ length: width * height }, (_, index) => ({
        x: index % width,
        y: Math.floor(index / width)
    }));
}

function labelKeyComponents(keys) {
    const unseen = new Set(keys);
    const labels = new Map();
    let component = 0;
    while (unseen.size) {
        const startKey = [...unseen].sort()[0];
        const queue = [parseCellKey(startKey)];
        unseen.delete(startKey);
        while (queue.length) {
            const current = queue.shift();
            labels.set(cellKey(current), component);
            for (const direction of CARDINALS) {
                const nextKey = cellKey(addCell(current, direction));
                if (!unseen.has(nextKey)) continue;
                unseen.delete(nextKey);
                queue.push(parseCellKey(nextKey));
            }
        }
        component++;
    }
    return labels;
}

function nearestComponentId(cell, labels) {
    const own = labels.get(cellKey(cell));
    if (own !== undefined) return own;
    for (const direction of CARDINALS) {
        const value = labels.get(cellKey(addCell(cell, direction)));
        if (value !== undefined) return value;
    }
    return null;
}

function touchesKeySet(cell, keys) {
    return CARDINALS.some((direction) => keys.has(cellKey(addCell(cell, direction))));
}

function inBounds(grid, cell) {
    return Boolean(cell) && cell.col >= 0 && cell.row >= 0 && cell.col < grid.width && cell.row < grid.height;
}

function addCell(cell, direction) {
    return { col: cell.col + direction.x, row: cell.row + direction.y };
}

function invertDirection(direction) {
    return { x: -direction.x, y: -direction.y, edge: oppositeEdge(direction.edge) };
}

function oppositeEdge(edge) {
    return ({ north: 'south', east: 'west', south: 'north', west: 'east' })[edge] || null;
}

function normalizeEdge(edge) {
    const normalized = String(edge || '').toLowerCase();
    return EDGE_DIRECTIONS[normalized] ? normalized : null;
}

function cellKey(cell) {
    return `${cell.col},${cell.row}`;
}

function localCellKey(cell) {
    return `${cell.x},${cell.y}`;
}

function parseCellKey(key) {
    const [col, row] = String(key).split(',').map(Number);
    return { col, row };
}

function sameCell(left, right) {
    return Boolean(left && right) && left.col === right.col && left.row === right.row;
}

function manhattan(left, right) {
    return Math.abs(left.col - right.col) + Math.abs(left.row - right.row);
}

function lanesAreOpposite(gate, inside, outside) {
    return inside.col + outside.col === gate.col * 2 &&
        inside.row + outside.row === gate.row * 2 &&
        manhattan(gate, inside) === 1 &&
        manhattan(gate, outside) === 1;
}

function compareCells(left, right) {
    return left.row - right.row || left.col - right.col;
}

function compareCellKeys(left, right) {
    return compareCells(parseCellKey(left), parseCellKey(right));
}

function serializeCells(cells) {
    return cells.map(cellKey).join('|');
}

function normalizeSymbolList(value, fallback) {
    return (Array.isArray(value) ? value : fallback).map((entry) => String(entry).toUpperCase());
}

function stableId(value, fallback) {
    const normalized = String(value ?? '').trim();
    return normalized || String(fallback);
}

function asArray(value) {
    return Array.isArray(value) ? value : [];
}

function finiteInteger(value, fallback) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.floor(number) : fallback;
}

function finiteNonNegative(value, fallback) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.max(0, number) : fallback;
}

function finiteNumberOrNull(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
}

function numberCompare(left, right) {
    return left - right;
}

function sortObject(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)));
}
