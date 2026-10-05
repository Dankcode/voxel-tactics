import {
    hashWaveSeed,
    solveWaveFunctionCollapse,
    validateWaveAssignment
} from './WaveFunctionCollapse.js';
import { normalizeBurgThemeId } from './BurgThemeCatalog.js';

const DEFAULT_RELIEF_FORMULA_VERSION = 'fmg-burg-relief-v2';

// Street WFC uses one fixed lattice everywhere: authored 5x5 modules provide the broad town
// rhythm, while a complete 3x3 transition patch forms the short ramp/step apron shared by two
// reciprocal portals. Keeping these values explicit prevents walled and unwalled burgs from
// drifting onto the former, incompatible six- and seven-cell grids.
export const BAKED_STREET_MODULE_SIZE = 5;
export const BAKED_STREET_TRANSITION_SIZE = 3;

// Coarse, reusable town-map modules. Each mask is a complete street block with explicit
// north/east/south/west portals; WFC may only place neighboring blocks whose portals agree.
// The rasterizer then expands the solved block graph into narrow roads, stepped lanes and
// civic plazas. FMG street vectors are passed in as higher-priority anchors and are never
// replaced by these infill modules.

const DIRECTIONS = Object.freeze([
    Object.freeze({ name: 'north', opposite: 'south', bit: 1, x: 0, y: -1 }),
    Object.freeze({ name: 'east', opposite: 'west', bit: 2, x: 1, y: 0 }),
    Object.freeze({ name: 'south', opposite: 'north', bit: 4, x: 0, y: 1 }),
    Object.freeze({ name: 'west', opposite: 'east', bit: 8, x: -1, y: 0 })
]);
const DIRECTION_BY_NAME = new Map(DIRECTIONS.map((direction) => [direction.name, direction]));

const MODULE_NAMES = Object.freeze([
    'courtyard',
    'north-landing',
    'east-landing',
    'north-east-corner',
    'south-landing',
    'north-south-avenue',
    'east-south-corner',
    'east-facing-junction',
    'west-landing',
    'north-west-corner',
    'east-west-avenue',
    'north-facing-junction',
    'south-west-corner',
    'west-facing-junction',
    'south-facing-junction',
    'four-way-square'
]);

const BASE_MODULES = MODULE_NAMES.map((name, mask) => streetModule({
    id: `street-${name}`,
    name: titleCase(name),
    mask,
    weight: moduleWeight(mask),
    spaceType: mask === 0 ? 'pocket-plaza'
        : mask === 15 ? 'plaza'
            : bitCount(mask) === 1 ? 'landing'
                : bitCount(mask) >= 3 ? 'junction'
                    : isStraightMask(mask) ? 'avenue' : 'lane',
    elevationMode: isStraightMask(mask) ? 'graded' : bitCount(mask) === 1 ? 'steps' : 'terraced',
    featureKind: mask === 0 ? 'rest-court'
        : bitCount(mask) === 1 ? 'building-approach'
            : bitCount(mask) >= 3 ? 'intersection' : 'street',
    patternStyle: mask === 0 ? 'pocket-plaza' : bitCount(mask) === 1 ? 'approach' : 'standard',
    utilityTags: mask === 0 ? ['rest-area', 'civic-space']
        : bitCount(mask) === 1 ? ['road', 'door-landing', 'gate-approach']
            : bitCount(mask) >= 3 ? ['road', 'intersection'] : ['road'],
    fmgAnchorKinds: mask === 0 ? ['center']
        : bitCount(mask) === 1 ? ['door', 'gate', 'main', 'dirt', 'road']
            : ['main', 'dirt', 'road']
}));

const FEATURE_MODULES = Object.freeze([
    streetModule({
        id: 'street-market-square', name: 'Market Square', mask: 15, weight: 0.72,
        spaceType: 'market-square', elevationMode: 'level', featureKind: 'market',
        patternStyle: 'square', utilityTags: ['road', 'market', 'civic-space'],
        fmgAnchorKinds: ['main', 'market', 'center']
    }),
    streetModule({
        id: 'street-fountain-square', name: 'Fountain Square', mask: 15, weight: 0.46,
        spaceType: 'fountain-square', elevationMode: 'level', featureKind: 'fountain',
        patternStyle: 'square', utilityTags: ['road', 'rest-area', 'civic-space'],
        fmgAnchorKinds: ['main', 'center']
    }),
    streetModule({
        id: 'street-north-south-steps', name: 'North South Steps', mask: 5, weight: 0.58,
        spaceType: 'stair-street', elevationMode: 'steps', featureKind: 'stairs',
        patternStyle: 'stair-landing', utilityTags: ['road', 'stairs', 'elevation-transition'],
        fmgAnchorKinds: ['main', 'dirt', 'road']
    }),
    streetModule({
        id: 'street-east-west-steps', name: 'East West Steps', mask: 10, weight: 0.58,
        spaceType: 'stair-street', elevationMode: 'steps', featureKind: 'stairs',
        patternStyle: 'stair-landing', utilityTags: ['road', 'stairs', 'elevation-transition'],
        fmgAnchorKinds: ['main', 'dirt', 'road']
    }),
    ...pairedStraightModules('alley', 'Alley', {
        weight: 0.76,
        spaceType: 'alley',
        elevationMode: 'graded',
        featureKind: 'alley-access',
        patternStyle: 'alley',
        utilityTags: ['road', 'alley', 'building-access'],
        fmgAnchorKinds: ['door', 'dirt', 'road']
    }),
    ...pairedStraightModules('boulevard', 'Boulevard', {
        weight: 0.62,
        spaceType: 'avenue',
        elevationMode: 'graded',
        featureKind: 'boulevard',
        patternStyle: 'boulevard',
        utilityTags: ['road', 'main-route', 'processional-route'],
        fmgAnchorKinds: ['main', 'road']
    }),
    ...pairedStraightModules('bridge', 'Bridge Street', {
        weight: 0.16,
        spaceType: 'bridge-street',
        elevationMode: 'level',
        featureKind: 'bridge-approach',
        patternStyle: 'bridge',
        utilityTags: ['road', 'bridge', 'river-crossing'],
        fmgAnchorKinds: ['bridge', 'ford', 'dock']
    }),
    ...directionalLandingModules('gate-approach', 'Gate Approach', {
        weight: 0.54,
        spaceType: 'gate-approach',
        elevationMode: 'level',
        featureKind: 'gate-approach',
        patternStyle: 'approach',
        utilityTags: ['road', 'gate-approach', 'door-landing'],
        fmgAnchorKinds: ['door', 'gate', 'main', 'road']
    }),
    ...directionalLandingModules('dock-approach', 'Dock Approach', {
        weight: 0.12,
        spaceType: 'dock-approach',
        elevationMode: 'level',
        featureKind: 'dock-approach',
        patternStyle: 'approach',
        utilityTags: ['road', 'dock', 'river-access'],
        fmgAnchorKinds: ['dock', 'ford']
    }),
    ...cornerModules('terraced-corner', 'Terraced Corner', {
        weight: 0.48,
        spaceType: 'terraced-lane',
        elevationMode: 'steps',
        featureKind: 'switchback-stairs',
        patternStyle: 'stair-landing',
        utilityTags: ['road', 'stairs', 'elevation-transition'],
        fmgAnchorKinds: ['dirt', 'road']
    }),
    ...junctionModules('civic-junction', 'Civic Junction', {
        weight: 0.4,
        spaceType: 'civic-junction',
        elevationMode: 'level',
        featureKind: 'neighborhood-plaza',
        patternStyle: 'square',
        utilityTags: ['road', 'intersection', 'civic-space'],
        fmgAnchorKinds: ['main', 'center', 'road']
    })
]);

export const BAKED_STREET_MODULES = Object.freeze([...BASE_MODULES, ...FEATURE_MODULES]);
export const BAKED_STREET_MODULE_IDS = Object.freeze(BAKED_STREET_MODULES.map((module) => module.id));
export const BAKED_STREET_MODULE_BY_ID = new Map(
    BAKED_STREET_MODULES.map((module) => [module.id, module])
);

/**
 * Solve a small block graph and rasterize it into an organized street infill plan.
 *
 * `sourceStreetCells` are compact FMG-vector projection cells. They influence module weights
 * and provide absolute elevation tiers, but remain outside this plan so the caller can stamp
 * them first and protect them from every later WFC pass.
 */
export function createBakedStreetPlan({
    bounds = null,
    insideCellKeys = null,
    reservedCellKeys = null,
    sourceStreetCells = [],
    seed = 'baked-street-plan',
    district = 'residential',
    spacing = BAKED_STREET_MODULE_SIZE,
    walled = true,
    architectureThemeId = null,
    reliefProfile = null,
    gridOriginCol = 0,
    gridOriginRow = 0
} = {}) {
    const safeBounds = normalizeBounds(bounds);
    if (!safeBounds) return emptyPlan('empty-bounds');
    // `spacing` remains accepted for saved callers, but every current plan intentionally resolves
    // to the common 5-cell lattice. This makes neighboring module edges cardinally adjacent.
    const requestedSpacing = clampInteger(spacing, 3, 9);
    const safeSpacing = BAKED_STREET_MODULE_SIZE;
    const inside = insideCellKeys instanceof Set ? insideCellKeys : null;
    const reserved = reservedCellKeys instanceof Set ? reservedCellKeys : null;
    const nodes = createStreetNodes(safeBounds, inside, reserved, safeSpacing, {
        col: Math.floor(Number(gridOriginCol) || 0),
        row: Math.floor(Number(gridOriginRow) || 0)
    });
    if (!nodes.length) return emptyPlan('empty-graph');

    const source = normalizeSourceStreetCells(sourceStreetCells, safeBounds);
    const sourceKindHistogram = {};
    for (const cell of source) {
        sourceKindHistogram[cell.kind] = (sourceKindHistogram[cell.kind] || 0) + 1;
    }
    const relief = normalizeReliefProfile(reliefProfile);
    const sourceByNode = applyReliefNodeElevations(
        nodes,
        createSourceNodePriors(nodes, source, safeSpacing),
        safeBounds,
        relief
    );
    // Every usable node participates in a deterministic spanning network. WFC still chooses the
    // shape and feature variant, but it may no longer solve a locally compatible patchwork of
    // isolated courtyards. FMG vector bearings are added to the same requirement set so authored
    // streets win first and the generated graph completes the routes between them.
    const connectivity = createStreetConnectivityRequirements(nodes, sourceByNode);
    const domains = createStreetDomains(nodes, connectivity.requiredByNode);
    const fixed = createComponentAnchors(nodes, domains);
    const assignment = solveWaveFunctionCollapse({
        nodes,
        tiles: BAKED_STREET_MODULES,
        domains,
        fixed,
        seed: `${seed}:street-blocks`,
        compatible: streetModulesCompatible,
        nodeWeights: (nodeId, moduleId) => streetModuleWeight({
            module: BAKED_STREET_MODULE_BY_ID.get(moduleId),
            node: nodes.find((candidate) => candidate.id === nodeId),
            sourcePrior: sourceByNode.get(nodeId),
            district,
            walled,
            reliefProfile: relief
        })
    });
    validateWaveAssignment({
        assignment,
        nodes,
        tiles: BAKED_STREET_MODULES,
        domains,
        fixed,
        compatible: streetModulesCompatible
    });

    const resolvedThemeId = normalizeBurgThemeId(architectureThemeId, null);
    const cells = rasterizeStreetAssignment({
        assignment,
        nodes,
        sourceByNode,
        inside,
        reserved,
        bounds: safeBounds,
        architectureThemeId: resolvedThemeId,
        reliefProfile: relief
    });
    const histogram = {};
    for (const moduleId of assignment.values()) histogram[moduleId] = (histogram[moduleId] || 0) + 1;
    const utilityHistogram = {};
    for (const moduleId of assignment.values()) {
        const featureKind = BAKED_STREET_MODULE_BY_ID.get(moduleId)?.featureKind || 'street';
        utilityHistogram[featureKind] = (utilityHistogram[featureKind] || 0) + 1;
    }
    const network = analyzeStreetAssignmentNetwork(nodes, assignment);
    const elevationTiers = cells.map((cell) => cell.elevationTier).filter(Number.isFinite);
    return Object.freeze({
        assignment,
        nodes: Object.freeze(nodes),
        cells: Object.freeze(cells.map(Object.freeze)),
        architectureThemeId: resolvedThemeId,
        diagnostics: Object.freeze({
            reason: 'solved',
            nodes: nodes.length,
            cells: cells.length,
            moduleSize: BAKED_STREET_MODULE_SIZE,
            transitionSize: BAKED_STREET_TRANSITION_SIZE,
            requestedSpacing,
            gridOriginCol: Math.floor(Number(gridOriginCol) || 0),
            gridOriginRow: Math.floor(Number(gridOriginRow) || 0),
            reservedCells: reserved?.size || 0,
            fixedAnchors: fixed.size,
            sourceAnchors: [...sourceByNode.values()].filter((value) => value.sourceCount > 0).length,
            sourceInputCells: source.length,
            sourceKindHistogram: Object.freeze(sourceKindHistogram),
            sourceConnectorAnchors: connectivity.sourceConnectorAnchors,
            requiredConnectorEdges: connectivity.requiredConnectorEdges,
            topologyComponents: connectivity.componentCount,
            networkComponents: network.componentCount,
            networkReachableNodes: network.reachableNodes,
            roadBearingCoverage: network.reachableNodes / Math.max(1, nodes.length),
            elevatedCells: cells.filter((cell) => Number.isFinite(cell.elevationTier)).length,
            steppedCells: cells.filter((cell) => cell.elevationMode === 'steps').length,
            elevationMinimum: elevationTiers.length ? Math.min(...elevationTiers) : null,
            elevationMaximum: elevationTiers.length ? Math.max(...elevationTiers) : null,
            elevationRange: elevationTiers.length ? Math.max(...elevationTiers) - Math.min(...elevationTiers) : 0,
            reliefFormulaVersion: relief.formulaVersion,
            reliefScore: relief.reliefScore,
            reliefClass: relief.reliefClass,
            targetTierSpan: relief.targetTierSpan,
            modules: Object.freeze(histogram),
            utilities: Object.freeze(utilityHistogram),
            architectureThemeId: resolvedThemeId,
            planHash: hashStreetPlan(assignment, cells, resolvedThemeId, relief)
        })
    });
}

export function streetModulesCompatible(leftId, rightId, direction) {
    const left = BAKED_STREET_MODULE_BY_ID.get(leftId);
    const right = BAKED_STREET_MODULE_BY_ID.get(rightId);
    const edge = DIRECTION_BY_NAME.get(direction);
    if (!left || !right || !edge) return false;
    return left.connectors.includes(edge.name) === right.connectors.includes(edge.opposite);
}

function pairedStraightModules(idPrefix, namePrefix, options) {
    return [
        streetModule({ id: `street-${idPrefix}-north-south`, name: `${namePrefix} North South`, mask: 5, ...options }),
        streetModule({ id: `street-${idPrefix}-east-west`, name: `${namePrefix} East West`, mask: 10, ...options })
    ];
}

function directionalLandingModules(idPrefix, namePrefix, options) {
    return DIRECTIONS.map((direction) => streetModule({
        id: `street-${idPrefix}-${direction.name}`,
        name: `${namePrefix} ${titleCase(direction.name)}`,
        mask: direction.bit,
        ...options
    }));
}

function cornerModules(idPrefix, namePrefix, options) {
    return [
        ['north-east', 3],
        ['east-south', 6],
        ['south-west', 12],
        ['west-north', 9]
    ].map(([suffix, mask]) => streetModule({
        id: `street-${idPrefix}-${suffix}`,
        name: `${namePrefix} ${titleCase(suffix)}`,
        mask,
        ...options
    }));
}

function junctionModules(idPrefix, namePrefix, options) {
    return [
        ['north-east-south', 7],
        ['east-south-west', 14],
        ['south-west-north', 13],
        ['west-north-east', 11]
    ].map(([suffix, mask]) => streetModule({
        id: `street-${idPrefix}-${suffix}`,
        name: `${namePrefix} ${titleCase(suffix)}`,
        mask,
        ...options
    }));
}

function streetModule({
    id,
    name,
    mask,
    weight,
    spaceType,
    elevationMode,
    featureKind = 'street',
    patternStyle = 'standard',
    utilityTags = ['road'],
    fmgAnchorKinds = ['road']
}) {
    const connectors = DIRECTIONS.filter((direction) => (mask & direction.bit) !== 0)
        .map((direction) => direction.name);
    const edgeConnectors = connectors.map((direction) => Object.freeze({
        direction,
        network: 'road',
        pathable: true,
        width: 1
    }));
    return Object.freeze({
        id,
        name,
        mask,
        connectors: Object.freeze(connectors),
        edgeConnectors: Object.freeze(edgeConnectors),
        visualProfile: 'rustic-diorama-v2',
        weight,
        spaceType,
        elevationMode,
        featureKind,
        patternStyle,
        utilityTags: Object.freeze([...new Set(utilityTags)]),
        fmgAnchorKinds: Object.freeze([...new Set(fmgAnchorKinds.map(normalizeSourceKind))]),
        pattern: Object.freeze(createPattern(mask, spaceType, patternStyle))
    });
}

function createPattern(mask, spaceType, patternStyle = 'standard') {
    const rows = Array.from({ length: 5 }, () => Array(5).fill(' '));
    if (mask === 0) {
        // A zero-edge module is legal only for a one-node component. Make it a usable 3x3 civic
        // court instead of the former single decorative dot.
        for (let y = 1; y <= 3; y++) for (let x = 1; x <= 3; x++) rows[y][x] = 'P';
    } else {
        rows[2][2] = patternStyle === 'square' || spaceType.includes('square') || spaceType === 'plaza'
            ? 'P' : 'R';
        if (mask & 1) for (let y = 0; y <= 2; y++) rows[y][2] = 'R';
        if (mask & 2) for (let x = 2; x < 5; x++) rows[2][x] = 'R';
        if (mask & 4) for (let y = 2; y < 5; y++) rows[y][2] = 'R';
        if (mask & 8) for (let x = 0; x <= 2; x++) rows[2][x] = 'R';
        if (patternStyle === 'square' || spaceType.includes('square') || spaceType === 'plaza') {
            for (let y = 1; y <= 3; y++) for (let x = 1; x <= 3; x++) rows[y][x] = 'P';
            if (spaceType === 'market-square') rows[2][2] = 'M';
            if (spaceType === 'fountain-square') rows[2][2] = 'F';
        } else if (patternStyle === 'approach') {
            for (let y = 1; y <= 3; y++) for (let x = 1; x <= 3; x++) rows[y][x] = 'R';
            if (spaceType === 'gate-approach') rows[2][2] = 'G';
            if (spaceType === 'dock-approach') rows[2][2] = 'D';
        } else if (patternStyle === 'stair-landing') {
            for (let y = 1; y <= 3; y++) for (let x = 1; x <= 3; x++) rows[y][x] = 'S';
        } else if (patternStyle === 'boulevard') {
            if (mask === 5) {
                for (let y = 1; y <= 3; y++) for (let x = 1; x <= 3; x++) rows[y][x] = 'A';
            } else if (mask === 10) {
                for (let y = 1; y <= 3; y++) for (let x = 1; x <= 3; x++) rows[y][x] = 'A';
            }
        } else if (patternStyle === 'alley') {
            if (mask === 5) {
                rows[1][1] = rows[1][3] = rows[3][1] = rows[3][3] = ':';
            } else if (mask === 10) {
                rows[1][1] = rows[3][1] = rows[1][3] = rows[3][3] = ':';
            }
        } else if (patternStyle === 'bridge') {
            // The deck remains one cell wide at every module edge, so it can safely sit on an
            // FMG river crossing without inventing side portals. Interior shoulders make the
            // crossing visibly authored while retaining the canonical path centerline.
            if (mask === 5) {
                for (let y = 1; y <= 3; y++) rows[y][2] = 'B';
                rows[2][1] = rows[2][3] = 'B';
            }
            if (mask === 10) {
                for (let x = 1; x <= 3; x++) rows[2][x] = 'B';
                rows[1][2] = rows[3][2] = 'B';
            }
        }
    }
    if (patternStyle === 'standard' && mask) {
        const centerline = rows.map(row => [...row]);
        for (let y=1; y<4; y++) for (let x=1; x<4; x++) {
            if (rows[y][x] === ' ' && [[1,0],[-1,0],[0,1],[0,-1]].some(([dx,dy]) => centerline[y+dy]?.[x+dx] === 'R')) rows[y][x] = 'P';
        }
    }
    return rows.map((row) => row.join(''));
}

function createStreetNodes(bounds, inside, reserved, spacing, gridOrigin) {
    const padding = Math.max(2, Math.floor(spacing / 2));
    const cols = axisPositions(
        bounds.minCol + padding,
        bounds.maxCol - padding,
        spacing,
        gridOrigin.col
    );
    const rows = axisPositions(
        bounds.minRow + padding,
        bounds.maxRow - padding,
        spacing,
        gridOrigin.row
    );
    const provisional = [];
    for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
        for (let colIndex = 0; colIndex < cols.length; colIndex++) {
            const col = cols[colIndex];
            const row = rows[rowIndex];
            if (inside && !inside.has(gridKey(col, row))) continue;
            if (reserved && moduleSquareTouchesReservedCell(col, row, reserved)) continue;
            provisional.push({ id: `${rowIndex}:${colIndex}`, rowIndex, colIndex, col, row });
        }
    }
    const byGrid = new Map(provisional.map((node) => [`${node.rowIndex}:${node.colIndex}`, node]));
    return provisional.map((node) => Object.freeze({
        ...node,
        neighbors: Object.freeze(DIRECTIONS.map((direction) => {
            const neighbor = byGrid.get(`${node.rowIndex + direction.y}:${node.colIndex + direction.x}`);
            return neighbor ? Object.freeze({ id: neighbor.id, direction: direction.name }) : null;
        }).filter(Boolean))
    }));
}

function createStreetDomains(nodes, requiredByNode = new Map()) {
    const domains = new Map();
    for (const node of nodes) {
        const neighborDirections = new Set(node.neighbors.map((neighbor) => neighbor.direction));
        const requiredDirections = requiredByNode.get(node.id) || new Set();
        const allowed = BAKED_STREET_MODULES.filter((module) =>
            module.connectors.every((direction) => neighborDirections.has(direction)) &&
            [...requiredDirections].every((direction) => module.connectors.includes(direction)) &&
            (node.neighbors.length === 0 || module.connectors.length > 0)
        ).map((module) => module.id);
        if (!allowed.length) {
            throw new Error(`Street node ${node.id} has no utility-bearing module domain.`);
        }
        domains.set(node.id, allowed);
    }
    return domains;
}

function createStreetConnectivityRequirements(nodes, sourceByNode) {
    const nodeById = new Map(nodes.map((node) => [node.id, node]));
    const requiredByNode = new Map(nodes.map((node) => [node.id, new Set()]));
    const remaining = new Set(nodes.map((node) => node.id));
    let componentCount = 0;

    // First build one spanning tree per physically available lattice component. Nodes bordering
    // a reserved building parcel therefore receive an approach, while open cells cannot collapse
    // to isolated visual filler.
    while (remaining.size) {
        componentCount++;
        const candidates = [...remaining].map((id) => nodeById.get(id));
        const root = candidates.sort((left, right) =>
            (sourceByNode.get(right.id)?.sourceCount || 0) - (sourceByNode.get(left.id)?.sourceCount || 0) ||
            right.neighbors.length - left.neighbors.length ||
            left.row - right.row || left.col - right.col || left.id.localeCompare(right.id))[0];
        const queue = [root];
        remaining.delete(root.id);
        while (queue.length) {
            const node = queue.shift();
            const neighbors = node.neighbors.map((neighbor) => ({
                ...neighbor,
                node: nodeById.get(neighbor.id)
            })).sort((left, right) =>
                (sourceByNode.get(right.id)?.sourceCount || 0) - (sourceByNode.get(left.id)?.sourceCount || 0) ||
                left.node.row - right.node.row || left.node.col - right.node.col ||
                left.id.localeCompare(right.id));
            for (const neighbor of neighbors) {
                if (!remaining.delete(neighbor.id)) continue;
                requiredByNode.get(node.id).add(neighbor.direction);
                requiredByNode.get(neighbor.id).add(DIRECTION_BY_NAME.get(neighbor.direction).opposite);
                queue.push(neighbor.node);
            }
        }
    }

    // Treat directionality recovered from compact FMG street cells as a hard connector priority
    // whenever that neighbor exists. The spanning tree is retained, so sparse or truncated JSON
    // anchors inhibit chaos without becoming single disconnected road fragments.
    let sourceConnectorAnchors = 0;
    for (const node of nodes) {
        const priorMask = sourceByNode.get(node.id)?.connectorMask || 0;
        let anchored = false;
        for (const neighbor of node.neighbors) {
            const edge = DIRECTION_BY_NAME.get(neighbor.direction);
            if ((priorMask & edge.bit) === 0) continue;
            requiredByNode.get(node.id).add(edge.name);
            requiredByNode.get(neighbor.id).add(edge.opposite);
            anchored = true;
        }
        if (anchored) sourceConnectorAnchors++;
    }

    const edgeIds = new Set();
    for (const node of nodes) {
        for (const neighbor of node.neighbors) {
            if (!requiredByNode.get(node.id).has(neighbor.direction)) continue;
            edgeIds.add(streetPortalId(node.id, neighbor.id));
        }
    }
    return Object.freeze({
        requiredByNode,
        componentCount,
        sourceConnectorAnchors,
        requiredConnectorEdges: edgeIds.size
    });
}

function createComponentAnchors(nodes, domains) {
    const nodeById = new Map(nodes.map((node) => [node.id, node]));
    const remaining = new Set(nodes.map((node) => node.id));
    const fixed = new Map();
    while (remaining.size) {
        const first = [...remaining].sort()[0];
        const component = [];
        const queue = [first];
        remaining.delete(first);
        while (queue.length) {
            const id = queue.shift();
            const node = nodeById.get(id);
            component.push(node);
            for (const neighbor of node.neighbors) {
                if (!remaining.delete(neighbor.id)) continue;
                queue.push(neighbor.id);
            }
        }
        const centerCol = average(component.map((node) => node.col));
        const centerRow = average(component.map((node) => node.row));
        const anchor = component.sort((left, right) =>
            Math.hypot(left.col - centerCol, left.row - centerRow) -
            Math.hypot(right.col - centerCol, right.row - centerRow) ||
            left.id.localeCompare(right.id))[0];
        const mask = anchor.neighbors.reduce((value, neighbor) =>
            value | DIRECTION_BY_NAME.get(neighbor.direction).bit, 0);
        const preferred = `street-${MODULE_NAMES[mask]}`;
        if (domains.get(anchor.id).includes(preferred)) fixed.set(anchor.id, preferred);
    }
    return fixed;
}

function analyzeStreetAssignmentNetwork(nodes, assignment) {
    const nodeById = new Map(nodes.map((node) => [node.id, node]));
    const remaining = new Set(nodes.map((node) => node.id));
    let componentCount = 0;
    let reachableNodes = 0;
    while (remaining.size) {
        componentCount++;
        const first = [...remaining].sort()[0];
        const queue = [first];
        remaining.delete(first);
        while (queue.length) {
            const id = queue.shift();
            reachableNodes++;
            const node = nodeById.get(id);
            const module = BAKED_STREET_MODULE_BY_ID.get(assignment.get(id));
            for (const neighbor of node.neighbors) {
                if (!module?.connectors.includes(neighbor.direction)) continue;
                const target = BAKED_STREET_MODULE_BY_ID.get(assignment.get(neighbor.id));
                const opposite = DIRECTION_BY_NAME.get(neighbor.direction).opposite;
                if (!target?.connectors.includes(opposite) || !remaining.delete(neighbor.id)) continue;
                queue.push(neighbor.id);
            }
        }
    }
    return Object.freeze({ componentCount, reachableNodes });
}

function createSourceNodePriors(nodes, source, spacing) {
    const sourceByKey = new Map(source.map((cell) => [gridKey(cell.col, cell.row), cell]));
    const priors = new Map();
    for (const node of nodes) {
        const nearby = source.filter((cell) =>
            Math.abs(cell.col - node.col) <= spacing && Math.abs(cell.row - node.row) <= spacing);
        const weighted = nearby.map((cell) => ({
            cell,
            distance: Math.hypot(cell.col - node.col, cell.row - node.row)
        })).sort((left, right) => left.distance - right.distance ||
            left.cell.row - right.cell.row || left.cell.col - right.cell.col);
        const elevations = weighted.map((entry) => entry.cell.elevationTier).filter(Number.isFinite);
        let connectorMask = 0;
        const sourceKinds = new Set();
        for (const { cell, distance } of weighted) {
            sourceKinds.add(cell.kind);
            connectorMask |= cell.roadConnections;
            for (const direction of DIRECTIONS) {
                if (sourceByKey.has(gridKey(cell.col + direction.x, cell.row + direction.y))) {
                    connectorMask |= direction.bit;
                }
            }
            if (distance > 0) {
                const dx = cell.col - node.col;
                const dy = cell.row - node.row;
                if (Math.abs(dx) >= Math.abs(dy)) connectorMask |= dx >= 0 ? 2 : 8;
                if (Math.abs(dy) >= Math.abs(dx)) connectorMask |= dy >= 0 ? 4 : 1;
            }
        }
        priors.set(node.id, Object.freeze({
            sourceCount: nearby.length,
            sourceDistance: weighted[0]?.distance ?? Infinity,
            elevationTier: elevations.length ? median(elevations) : null,
            elevationSpan: elevations.length ? Math.max(...elevations) - Math.min(...elevations) : 0,
            connectorMask: connectorMask & 15,
            sourceKinds: Object.freeze([...sourceKinds].sort())
        }));
    }
    return priors;
}

function applyReliefNodeElevations(nodes, priors, bounds, reliefProfile) {
    if (!reliefProfile.enabled) return priors;
    const axisMinimum = reliefProfile.gradientAxis === 'north-south' ? bounds.minRow : bounds.minCol;
    const axisMaximum = reliefProfile.gradientAxis === 'north-south' ? bounds.maxRow : bounds.maxCol;
    const axisSpan = Math.max(1, axisMaximum - axisMinimum);
    const targetSpan = clampInteger(reliefProfile.targetTierSpan, 1, 6);
    let minimumTier = reliefProfile.baseElevationTier - Math.floor(targetSpan / 2);
    let maximumTier = minimumTier + targetSpan;
    if (minimumTier < 0) {
        maximumTier -= minimumTier;
        minimumTier = 0;
    }
    if (maximumTier > 6) {
        minimumTier -= maximumTier - 6;
        maximumTier = 6;
    }
    minimumTier = clampInteger(minimumTier, 0, 6);
    maximumTier = clampInteger(maximumTier, minimumTier, 6);

    return new Map(nodes.map((node) => {
        const prior = priors.get(node.id) || { sourceCount: 0, sourceDistance: Infinity, elevationSpan: 0 };
        if (prior.sourceCount > 0 && Number.isFinite(prior.elevationTier)) return [node.id, prior];
        const axisValue = reliefProfile.gradientAxis === 'north-south' ? node.row : node.col;
        let progress = clampNumber((axisValue - axisMinimum) / axisSpan, 0, 1);
        if (reliefProfile.gradientSign < 0) progress = 1 - progress;
        const elevationTier = clampInteger(
            Math.round(minimumTier + (maximumTier - minimumTier) * progress),
            0,
            6
        );
        return [node.id, Object.freeze({ ...prior, elevationTier, reliefDerived: true })];
    }));
}

function normalizeReliefProfile(value) {
    if (!value || typeof value !== 'object') {
        return Object.freeze({
            enabled: false,
            formulaVersion: DEFAULT_RELIEF_FORMULA_VERSION,
            reliefScore: 0,
            reliefClass: 'none',
            targetTierSpan: 0,
            baseElevationTier: 0,
            gradientAxis: 'north-south',
            gradientSign: 1
        });
    }
    const reliefScore = clampNumber(value.reliefScore, 0, 1);
    return Object.freeze({
        enabled: true,
        formulaVersion: String(value.formulaVersion || DEFAULT_RELIEF_FORMULA_VERSION),
        reliefScore,
        reliefClass: String(value.reliefClass || (reliefScore >= 0.68 ? 'high' : reliefScore >= 0.38 ? 'moderate' : 'low')),
        targetTierSpan: clampInteger(value.targetTierSpan ?? Math.round(1 + reliefScore * 5), 1, 6),
        baseElevationTier: clampInteger(value.baseElevationTier ?? 0, 0, 6),
        gradientAxis: value.gradientAxis === 'east-west' ? 'east-west' : 'north-south',
        gradientSign: Number(value.gradientSign) < 0 ? -1 : 1
    });
}

function streetModuleWeight({ module, sourcePrior, district, walled, reliefProfile }) {
    if (!module) return 0;
    const connectorCount = module.connectors.length;
    const sourceKinds = sourcePrior?.sourceKinds || [];
    const anchorMatches = sourceKinds.filter((kind) => module.fmgAnchorKinds.includes(kind)).length;
    const needsWaterAnchor = module.utilityTags.includes('bridge') || module.utilityTags.includes('dock');
    let weight = module.weight;
    if (needsWaterAnchor && anchorMatches === 0) weight = 0;
    if (walled && connectorCount > 0) weight *= 1.45;
    if (sourcePrior?.sourceCount > 0) {
        weight *= connectorCount > 0 ? 1.8 + Math.min(1.2, sourcePrior.sourceCount / 6) : 0.28;
        if (sourcePrior.elevationSpan > 0 && module.elevationMode === 'steps') weight *= 2.1;
        const desiredMask = sourcePrior.connectorMask || 0;
        if (desiredMask) {
            const covered = bitCount(module.mask & desiredMask);
            const missing = bitCount(desiredMask & ~module.mask);
            weight *= Math.pow(2.15, covered) * Math.pow(0.12, missing);
        }
        if (anchorMatches > 0) weight *= 1.8 + Math.min(1.2, anchorMatches * 0.35);
    }
    const reliefScore = clampNumber(reliefProfile?.reliefScore, 0, 1);
    if (reliefProfile?.enabled && module.elevationMode === 'steps') {
        weight *= 0.52 + reliefScore * 3.48;
    } else if (reliefProfile?.enabled && module.elevationMode === 'graded') {
        weight *= 0.9 + reliefScore * 0.95;
    } else if (reliefProfile?.enabled && module.elevationMode === 'level') {
        weight *= 1.12 - reliefScore * 0.32;
    }
    if (['market', 'civic'].includes(district) && module.spaceType.includes('square')) weight *= 2.4;
    if (district === 'castle' && ['plaza', 'avenue', 'stair-street'].includes(module.spaceType)) weight *= 1.7;
    if (district === 'residential' && connectorCount >= 3) weight *= 0.72;
    return weight;
}

function rasterizeStreetAssignment({
    assignment,
    nodes,
    sourceByNode,
    inside,
    reserved,
    bounds,
    architectureThemeId = null,
    reliefProfile = null
}) {
    const byId = new Map(nodes.map((node) => [node.id, node]));
    const cells = new Map();
    const put = (col, row, value) => {
        if (col < bounds.minCol || row < bounds.minRow || col > bounds.maxCol || row > bounds.maxRow) return;
        if (inside && !inside.has(gridKey(col, row))) return;
        if (reserved?.has(gridKey(col, row))) return;
        const key = gridKey(col, row);
        const current = cells.get(key);
        const elevationTier = Number.isFinite(value.elevationTier)
            ? clampInteger(value.elevationTier, 0, 6)
            : current?.elevationTier ?? null;
        cells.set(key, {
            col,
            row,
            ...current,
            ...value,
            elevationTier,
            ...(architectureThemeId ? { architectureThemeId } : {})
        });
    };

    // Rasterize the authored mask itself. With centers exactly five cells apart, the edge cell of
    // one module sits directly beside the reciprocal edge cell of its neighbor (there is no
    // formula-filled gap and therefore no opportunity for a hanging road end).
    for (const node of nodes) {
        const module = BAKED_STREET_MODULE_BY_ID.get(assignment.get(node.id));
        if (!module) continue;
        const elevationTier = sourceByNode.get(node.id)?.elevationTier;
        for (let localRow = 0; localRow < BAKED_STREET_MODULE_SIZE; localRow++) {
            for (let localCol = 0; localCol < BAKED_STREET_MODULE_SIZE; localCol++) {
                const patternSymbol = module.pattern[localRow]?.[localCol] || ' ';
                if (patternSymbol === ' ') continue;
                const portalDirection = modulePortalDirection(module, localCol, localRow);
                const neighbor = portalDirection
                    ? node.neighbors.find((candidate) => candidate.direction === portalDirection)
                    : null;
                const targetModuleId = neighbor ? assignment.get(neighbor.id) : null;
                const portalId = neighbor ? streetPortalId(node.id, neighbor.id) : null;
                put(
                    node.col + localCol - Math.floor(BAKED_STREET_MODULE_SIZE / 2),
                    node.row + localRow - Math.floor(BAKED_STREET_MODULE_SIZE / 2),
                    {
                        moduleId: module.id,
                        moduleSize: BAKED_STREET_MODULE_SIZE,
                        moduleLocalCol: localCol,
                        moduleLocalRow: localRow,
                        patternSymbol,
                        roadKind: module.spaceType,
                        featureKind: module.featureKind,
                        patternStyle: module.patternStyle,
                        utilityTags: module.utilityTags,
                        fmgAnchorKinds: module.fmgAnchorKinds,
                        elevationMode: patternSymbol === 'P'
                            ? 'level'
                            : module.elevationMode,
                        elevationTier,
                        reliefScore: reliefProfile?.reliefScore ?? 0,
                        ...(portalDirection ? {
                            portal: true,
                            portalDirection,
                            portalId,
                            connectorNetwork: 'road',
                            connectorPathable: true,
                            connectorWidth: 1,
                            reciprocalModuleId: targetModuleId
                        } : {})
                    }
                );
            }
        }
    }

    // Revisit reciprocal connectors as complete center-to-center paths. Their elevations are
    // interpolated over all six occupied centerline cells. When the edge changes elevation, the
    // three cells around its shared portal are widened perpendicular to travel, producing a real
    // 3x3 logical transition patch rather than metadata on the center lane alone. Every cross-lane
    // cell receives its centerline tier, while `transitionCenterline` keeps the canonical route
    // explicit for pathing and downstream validation.
    const handledEdges = new Set();
    for (const node of nodes) {
        const module = BAKED_STREET_MODULE_BY_ID.get(assignment.get(node.id));
        if (!module) continue;
        const elevationTier = sourceByNode.get(node.id)?.elevationTier;
        for (const neighbor of node.neighbors) {
            if (!module.connectors.includes(neighbor.direction)) continue;
            const portalId = streetPortalId(node.id, neighbor.id);
            if (handledEdges.has(portalId)) continue;
            handledEdges.add(portalId);
            const target = byId.get(neighbor.id);
            const targetModule = BAKED_STREET_MODULE_BY_ID.get(assignment.get(neighbor.id));
            if (!target || !targetModule) continue;
            const targetElevation = sourceByNode.get(neighbor.id)?.elevationTier;
            const elevationChanges = Number.isFinite(elevationTier) && Number.isFinite(targetElevation) &&
                elevationTier !== targetElevation;
            const transitionAxis = node.row === target.row ? 'east-west' : 'north-south';
            const transitionDirection = elevationChanges
                ? directionTowardHigherElevation(node, target, elevationTier, targetElevation)
                : null;
            const transitionCells = [];
            stampGridLine(node.col, node.row, target.col, target.row, (col, row, progress, step, steps) => {
                const tier = Number.isFinite(elevationTier) && Number.isFinite(targetElevation)
                    ? Math.round(elevationTier + (targetElevation - elevationTier) * progress)
                    : Number.isFinite(elevationTier) ? elevationTier : targetElevation;
                const transitionStart = Math.max(0, Math.ceil(steps / 2) - 1);
                const transitionIndex = step - transitionStart;
                const isTransitionCell = elevationChanges && transitionIndex >= 0 &&
                    transitionIndex < BAKED_STREET_TRANSITION_SIZE;
                const horizontal = node.row === target.row;
                put(col, row, {
                    roadKind: elevationChanges
                        ? 'stair-street' : 'wfc-street',
                    elevationMode: elevationChanges
                        ? 'steps' : 'graded',
                    elevationTier: tier,
                    reliefScore: reliefProfile?.reliefScore ?? 0,
                    portalId,
                    connectedModuleIds: Object.freeze([module.id, targetModule.id])
                });
                if (isTransitionCell) transitionCells.push({ col, row, tier, transitionIndex, horizontal });
            });

            if (!canStampTransitionPatch(transitionCells, bounds, inside, reserved, cells)) continue;
            const transitionId = `transition:${portalId}`;
            for (const transitionCell of transitionCells) {
                for (let crossIndex = 0; crossIndex < BAKED_STREET_TRANSITION_SIZE; crossIndex++) {
                    const crossOffset = crossIndex - Math.floor(BAKED_STREET_TRANSITION_SIZE / 2);
                    const col = transitionCell.col + (transitionCell.horizontal ? 0 : crossOffset);
                    const row = transitionCell.row + (transitionCell.horizontal ? crossOffset : 0);
                    const transitionLocalCol = transitionCell.horizontal
                        ? transitionCell.transitionIndex : crossIndex;
                    const transitionLocalRow = transitionCell.horizontal
                        ? crossIndex : transitionCell.transitionIndex;
                    put(col, row, {
                        roadKind: 'stair-street',
                        elevationMode: 'steps',
                        elevationTier: transitionCell.tier,
                        reliefScore: reliefProfile?.reliefScore ?? 0,
                        portalId,
                        connectedModuleIds: Object.freeze([module.id, targetModule.id]),
                        transition: true,
                        transitionId,
                        transitionSize: BAKED_STREET_TRANSITION_SIZE,
                        transitionLocalCol,
                        transitionLocalRow,
                        transitionCenterline: crossIndex === Math.floor(BAKED_STREET_TRANSITION_SIZE / 2),
                        transitionPatternSymbol: elevationChanges ? 'S' : 'R',
                        transitionAxis,
                        transitionDirection
                    });
                }
            }
        }
    }
    return [...cells.values()].sort((left, right) => left.row - right.row || left.col - right.col);
}

function directionTowardHigherElevation(node, target, sourceElevation, targetElevation) {
    const higher = targetElevation > sourceElevation ? target : node;
    const lower = targetElevation > sourceElevation ? node : target;
    const dx = higher.col - lower.col;
    const dy = higher.row - lower.row;
    if (Math.abs(dx) >= Math.abs(dy)) return dx < 0 ? 'west' : 'east';
    return dy < 0 ? 'north' : 'south';
}

function canStampTransitionPatch(centerlineCells, bounds, inside, reserved, stampedCells = null) {
    if (centerlineCells.length !== BAKED_STREET_TRANSITION_SIZE) return false;
    for (const cell of centerlineCells) {
        for (let crossIndex = 0; crossIndex < BAKED_STREET_TRANSITION_SIZE; crossIndex++) {
            const crossOffset = crossIndex - Math.floor(BAKED_STREET_TRANSITION_SIZE / 2);
            const col = cell.col + (cell.horizontal ? 0 : crossOffset);
            const row = cell.row + (cell.horizontal ? crossOffset : 0);
            if (col < bounds.minCol || row < bounds.minRow || col > bounds.maxCol || row > bounds.maxRow) {
                return false;
            }
            const key = gridKey(col, row);
            if (inside && !inside.has(key)) return false;
            if (reserved?.has(key)) return false;
            // Transition aprons are atomic authored 3x3 modules. If two grade changes cross, keep
            // the first complete apron and retain the second route's interpolated centerline;
            // overwriting one logical cell would leave both modules incomplete.
            if (stampedCells?.get(key)?.transition) return false;
        }
    }
    return true;
}

function normalizeSourceStreetCells(values, bounds) {
    return (Array.isArray(values) ? values : []).map((cell) => ({
        col: Math.floor(Number(cell?.col)),
        row: Math.floor(Number(cell?.row)),
        elevationTier: Number.isFinite(Number(cell?.elevationTier))
            ? clampInteger(cell.elevationTier, 0, 6) : null,
        kind: normalizeSourceKind(cell?.kind || cell?.streetKind || cell?.roadKind || 'road'),
        roadConnections: Number.isFinite(Number(cell?.roadConnections))
            ? clampInteger(cell.roadConnections, 0, 15) : 0
    })).filter((cell) => Number.isFinite(cell.col) && Number.isFinite(cell.row) &&
        cell.col >= bounds.minCol && cell.col <= bounds.maxCol &&
        cell.row >= bounds.minRow && cell.row <= bounds.maxRow);
}

function normalizeSourceKind(value) {
    const normalized = String(value || 'road').trim().toLowerCase()
        .replace(/^town-vector-/, '')
        .replace(/[^a-z0-9]+/g, '-');
    if (normalized.includes('dock')) return 'dock';
    if (normalized.includes('bridge')) return 'bridge';
    if (normalized.includes('ford')) return 'ford';
    if (normalized.includes('gate')) return 'gate';
    if (normalized.includes('door') || normalized.includes('building-access')) return 'door';
    if (normalized.includes('main')) return 'main';
    if (normalized.includes('dirt')) return 'dirt';
    if (normalized.includes('market')) return 'market';
    if (normalized.includes('center')) return 'center';
    return 'road';
}

function normalizeBounds(bounds) {
    const minCol = Math.floor(Number(bounds?.minCol));
    const minRow = Math.floor(Number(bounds?.minRow));
    const maxCol = Math.floor(Number(bounds?.maxCol));
    const maxRow = Math.floor(Number(bounds?.maxRow));
    if (![minCol, minRow, maxCol, maxRow].every(Number.isFinite) || minCol > maxCol || minRow > maxRow) return null;
    return { minCol, minRow, maxCol, maxRow };
}

function axisPositions(minimum, maximum, spacing, origin = 0) {
    if (minimum > maximum) return [];
    const values = [];
    const first = minimum + positiveModulo(origin - minimum, spacing);
    for (let value = first; value <= maximum; value += spacing) values.push(value);
    return values;
}

function stampGridLine(startCol, startRow, endCol, endRow, visit) {
    const distance = Math.abs(endCol - startCol) + Math.abs(endRow - startRow);
    const steps = Math.max(1, distance);
    for (let step = 0; step <= steps; step++) {
        const amount = step / steps;
        visit(
            Math.round(startCol + (endCol - startCol) * amount),
            Math.round(startRow + (endRow - startRow) * amount),
            amount,
            step,
            steps
        );
    }
}

function modulePortalDirection(module, localCol, localRow) {
    const center = Math.floor(BAKED_STREET_MODULE_SIZE / 2);
    const maximum = BAKED_STREET_MODULE_SIZE - 1;
    if (localCol === center && localRow === 0 && module.connectors.includes('north')) return 'north';
    if (localCol === maximum && localRow === center && module.connectors.includes('east')) return 'east';
    if (localCol === center && localRow === maximum && module.connectors.includes('south')) return 'south';
    if (localCol === 0 && localRow === center && module.connectors.includes('west')) return 'west';
    return null;
}

function streetPortalId(leftNodeId, rightNodeId) {
    return [String(leftNodeId), String(rightNodeId)].sort().join('<->');
}

function moduleSquareTouchesReservedCell(col, row, reserved) {
    const radius = Math.floor(BAKED_STREET_MODULE_SIZE / 2);
    for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
            if (reserved.has(gridKey(col + dx, row + dy))) return true;
        }
    }
    return false;
}

function positiveModulo(value, divisor) {
    return ((value % divisor) + divisor) % divisor;
}

function emptyPlan(reason) {
    return Object.freeze({
        assignment: new Map(),
        nodes: Object.freeze([]),
        cells: Object.freeze([]),
        architectureThemeId: null,
        diagnostics: Object.freeze({
            reason,
            nodes: 0,
            cells: 0,
            moduleSize: BAKED_STREET_MODULE_SIZE,
            transitionSize: BAKED_STREET_TRANSITION_SIZE,
            requestedSpacing: BAKED_STREET_MODULE_SIZE,
            gridOriginCol: 0,
            gridOriginRow: 0,
            reservedCells: 0,
            fixedAnchors: 0,
            sourceAnchors: 0,
            sourceConnectorAnchors: 0,
            requiredConnectorEdges: 0,
            topologyComponents: 0,
            networkComponents: 0,
            networkReachableNodes: 0,
            roadBearingCoverage: 0,
            elevatedCells: 0,
            steppedCells: 0,
            elevationMinimum: null,
            elevationMaximum: null,
            elevationRange: 0,
            reliefFormulaVersion: DEFAULT_RELIEF_FORMULA_VERSION,
            reliefScore: 0,
            reliefClass: 'none',
            targetTierSpan: 0,
            architectureThemeId: null,
            modules: Object.freeze({}),
            utilities: Object.freeze({}),
            planHash: '00000000'
        })
    });
}

function hashStreetPlan(assignment, cells, architectureThemeId = null, reliefProfile = null) {
    const signature = [
        `theme:${architectureThemeId || 'neutral'}`,
        `relief:${reliefProfile?.formulaVersion || DEFAULT_RELIEF_FORMULA_VERSION}:${reliefProfile?.reliefScore || 0}:${reliefProfile?.targetTierSpan || 0}`,
        ...[...assignment].sort(([left], [right]) => String(left).localeCompare(String(right)))
            .map(([nodeId, moduleId]) => `${nodeId}:${moduleId}`),
        ...cells.map((cell) => [
            `${cell.col},${cell.row}`,
            cell.moduleId || '-',
            cell.patternSymbol || '-',
            cell.portalId || '-',
            cell.transitionId || '-',
            cell.transition
                ? `${cell.transitionLocalCol},${cell.transitionLocalRow},${cell.transitionCenterline ? 1 : 0}`
                : '-',
            cell.roadKind,
            cell.elevationTier ?? '-'
        ].join(':'))
    ].join('|');
    return hashWaveSeed(signature).toString(16).padStart(8, '0');
}

function moduleWeight(mask) {
    const count = bitCount(mask);
    if (count === 0) return 0.44;
    if (count === 1) return 0.72;
    if (count === 2) return isStraightMask(mask) ? 1.5 : 1.18;
    if (count === 3) return 0.88;
    return 0.42;
}

function isStraightMask(mask) {
    return mask === 5 || mask === 10;
}

function bitCount(value) {
    let count = 0;
    for (let mask = value; mask > 0; mask >>>= 1) count += mask & 1;
    return count;
}

function median(values) {
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)] ?? null;
}

function average(values) {
    return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function titleCase(value) {
    return String(value).split('-').map((part) => part ? `${part[0].toUpperCase()}${part.slice(1)}` : '').join(' ');
}

function gridKey(col, row) {
    return `${col},${row}`;
}

function clampInteger(value, minimum, maximum) {
    const number = Number(value);
    return Math.min(maximum, Math.max(minimum, Number.isFinite(number) ? Math.round(number) : minimum));
}

function clampNumber(value, minimum, maximum) {
    const number = Number(value);
    return Math.min(maximum, Math.max(minimum, Number.isFinite(number) ? number : minimum));
}
