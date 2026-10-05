// Deterministic elevation macro-patches for the geographic terrain WFC.
//
// Primary patches cover 5x5 cells. Transition patches cover 3x3 cells and bridge
// neighboring primary decisions. Every edge exposes both its complete elevation
// signature and a three-anchor connector signature, allowing exact same-size WFC
// matching and deterministic 5x5-to-3x3 transition matching without sampling noise.

import { solveWaveFunctionCollapse } from './WaveFunctionCollapse.js';

export const TERRAIN_MACRO_TILE_LIBRARY_VERSION = 'terrain-macro-wfc-v1';
export const TERRAIN_PRIMARY_MACRO_SIZE = 5;
export const TERRAIN_TRANSITION_MACRO_SIZE = 3;

export const TERRAIN_MACRO_DIRECTIONS = Object.freeze([
    'north',
    'east',
    'south',
    'west'
]);

const DIRECTION_OPPOSITE = Object.freeze({
    north: 'south',
    east: 'west',
    south: 'north',
    west: 'east'
});

const CARDINAL_GRADIENTS = Object.freeze([
    Object.freeze({ suffix: 'east-up', axis: 'east-west', sign: 1 }),
    Object.freeze({ suffix: 'west-up', axis: 'east-west', sign: -1 }),
    Object.freeze({ suffix: 'south-up', axis: 'north-south', sign: 1 }),
    Object.freeze({ suffix: 'north-up', axis: 'north-south', sign: -1 })
]);

const PRIMARY_DIRECTIONAL_PROFILES = Object.freeze([
    Object.freeze({ family: 'terraced', variant: 'split', levels: Object.freeze([0, 0, 1, 1, 1]), baseWeight: 1 }),
    Object.freeze({ family: 'ramp', variant: 'graded', levels: Object.freeze([0, 0, 1, 1, 2]), baseWeight: 1 }),
    Object.freeze({ family: 'stair', variant: 'landings', levels: Object.freeze([0, 1, 1, 2, 2]), baseWeight: 0.9 }),
    Object.freeze({ family: 'stair', variant: 'high-relief', levels: Object.freeze([0, 1, 2, 3, 4]), baseWeight: 0.62 })
]);

const TRANSITION_DIRECTIONAL_PROFILES = Object.freeze([
    Object.freeze({ family: 'terraced', variant: 'landing', levels: Object.freeze([0, 1, 1]), baseWeight: 1 }),
    Object.freeze({ family: 'ramp', variant: 'lip', levels: Object.freeze([0, 0, 1]), baseWeight: 1 }),
    Object.freeze({ family: 'stair', variant: 'three-step', levels: Object.freeze([0, 1, 2]), baseWeight: 0.78 })
]);

const PRIMARY_UNIFORM = createMacroTile({
    id: 'terrain-primary-uniform',
    role: 'primary',
    family: 'uniform',
    variant: 'flat',
    rows: filledRows(TERRAIN_PRIMARY_MACRO_SIZE, 0),
    baseWeight: 1
});

const PRIMARY_PLATEAU = createMacroTile({
    id: 'terrain-primary-terraced-plateau',
    role: 'primary',
    family: 'terraced',
    variant: 'plateau',
    rows: insetRows(TERRAIN_PRIMARY_MACRO_SIZE, 0, 1),
    baseWeight: 0.86
});

const PRIMARY_BASIN = createMacroTile({
    id: 'terrain-primary-terraced-basin',
    role: 'primary',
    family: 'terraced',
    variant: 'basin',
    rows: insetRows(TERRAIN_PRIMARY_MACRO_SIZE, 1, 0),
    baseWeight: 0.6
});

const PRIMARY_DIRECTIONAL = PRIMARY_DIRECTIONAL_PROFILES.flatMap((profile) =>
    CARDINAL_GRADIENTS.map((gradient) => createDirectionalMacroTile({
        id: `terrain-primary-${profile.family}-${profile.variant}-${gradient.suffix}`,
        role: 'primary',
        profile,
        gradient
    }))
);

const TRANSITION_UNIFORM = createMacroTile({
    id: 'terrain-transition-uniform',
    role: 'transition',
    family: 'uniform',
    variant: 'flat',
    rows: filledRows(TERRAIN_TRANSITION_MACRO_SIZE, 0),
    baseWeight: 1
});

const TRANSITION_DIRECTIONAL = TRANSITION_DIRECTIONAL_PROFILES.flatMap((profile) =>
    CARDINAL_GRADIENTS.map((gradient) => createDirectionalMacroTile({
        id: `terrain-transition-${profile.family}-${profile.variant}-${gradient.suffix}`,
        role: 'transition',
        profile,
        gradient
    }))
);

export const TERRAIN_PRIMARY_MACRO_TILES = Object.freeze([
    PRIMARY_UNIFORM,
    PRIMARY_PLATEAU,
    PRIMARY_BASIN,
    ...PRIMARY_DIRECTIONAL
]);

export const TERRAIN_TRANSITION_MACRO_TILES = Object.freeze([
    TRANSITION_UNIFORM,
    ...TRANSITION_DIRECTIONAL
]);

export const TERRAIN_MACRO_TILES = Object.freeze([
    ...TERRAIN_PRIMARY_MACRO_TILES,
    ...TERRAIN_TRANSITION_MACRO_TILES
]);

export const TERRAIN_MACRO_TILE_BY_ID = new Map(
    TERRAIN_MACRO_TILES.map((tile) => [tile.id, tile])
);

/** Resolve a catalog id or pass through a catalog-compatible tile object. */
export function resolveTerrainMacroTile(tileOrId) {
    if (typeof tileOrId === 'string') return TERRAIN_MACRO_TILE_BY_ID.get(tileOrId) || null;
    if (!tileOrId || !Array.isArray(tileOrId.relativeElevationRows)) return null;
    return tileOrId;
}

/**
 * Validate shape, adjacent elevation continuity, edge metadata and the no-spike
 * invariant. The catalog itself is validated during module initialization.
 */
export function validateTerrainMacroTile(tileOrId, { throwOnError = false } = {}) {
    const tile = resolveTerrainMacroTile(tileOrId);
    const errors = [];
    if (!tile) {
        errors.push('unknown terrain macro tile');
    } else {
        const expectedSize = tile.role === 'primary'
            ? TERRAIN_PRIMARY_MACRO_SIZE
            : tile.role === 'transition'
                ? TERRAIN_TRANSITION_MACRO_SIZE
                : null;
        if (!expectedSize) errors.push(`invalid role: ${tile.role}`);
        if (tile.size !== expectedSize) errors.push(`invalid ${tile.role} size: ${tile.size}`);
        if (tile.relativeElevationRows.length !== tile.size ||
            tile.relativeElevationRows.some((row) => !Array.isArray(row) || row.length !== tile.size)) {
            errors.push('relativeElevationRows must be a square matching tile.size');
        }
        if (tile.relativeElevationRows.some((row) => row.some((value) => !Number.isInteger(value)))) {
            errors.push('relative elevation tiers must be integers');
        }
        const maximumAdjacentDelta = maximumCardinalDelta(tile.relativeElevationRows);
        if (maximumAdjacentDelta > 1) errors.push(`adjacent tier delta ${maximumAdjacentDelta} exceeds 1`);
        const spikes = findIsolatedElevationSpikes(tile.relativeElevationRows);
        if (spikes.length) errors.push(`contains ${spikes.length} isolated elevation spike(s)`);
        for (const direction of TERRAIN_MACRO_DIRECTIONS) {
            const expected = describeEdge(readEdge(tile.relativeElevationRows, direction));
            const actual = tile.edgeSignatures?.[direction];
            if (!actual || actual.elevationSignature !== expected.elevationSignature ||
                actual.connectorSignature !== expected.connectorSignature) {
                errors.push(`stale or missing ${direction} edge signature`);
            }
        }
    }

    const result = Object.freeze({
        valid: errors.length === 0,
        errors: Object.freeze(errors),
        isolatedSpikes: tile ? Object.freeze(findIsolatedElevationSpikes(tile.relativeElevationRows)) : Object.freeze([]),
        maximumAdjacentDelta: tile ? maximumCardinalDelta(tile.relativeElevationRows) : null
    });
    if (throwOnError && !result.valid) {
        throw new Error(`Invalid terrain macro tile: ${result.errors.join('; ')}`);
    }
    return result;
}

/**
 * Return the absolute edge tiers for one tile/base combination. `connectorTiers`
 * are always three ordered anchors (west-to-east or north-to-south), while
 * `tiers` preserve every edge cell.
 */
export function getTerrainMacroEdgeSignature(tileOrId, direction, {
    baseElevation = 0,
    minimumElevation = Number.NEGATIVE_INFINITY,
    maximumElevation = Number.POSITIVE_INFINITY
} = {}) {
    const tile = requireTerrainMacroTile(tileOrId);
    const safeDirection = normalizeDirection(direction);
    const safeBase = finiteNumber(baseElevation, 0);
    const relativeTiers = readEdge(tile.relativeElevationRows, safeDirection);
    const tiers = relativeTiers
        .map((tier) => clampNumber(safeBase + tier, minimumElevation, maximumElevation));
    return describeEdge(tiers, { relativeTiers });
}

/**
 * Compare the touching edges of two macro tiles. `auto` performs exact matching
 * for equal edge lengths and three-anchor connector matching across 5x5/3x3.
 */
export function terrainMacroTilesCompatible(leftTileOrId, rightTileOrId, direction, {
    leftBaseElevation = 0,
    rightBaseElevation = 0,
    minimumElevation = Number.NEGATIVE_INFINITY,
    maximumElevation = Number.POSITIVE_INFINITY,
    mode = 'auto'
} = {}) {
    const safeDirection = normalizeDirection(direction);
    const opposite = DIRECTION_OPPOSITE[safeDirection];
    const left = getTerrainMacroEdgeSignature(leftTileOrId, safeDirection, {
        baseElevation: leftBaseElevation,
        minimumElevation,
        maximumElevation
    });
    const right = getTerrainMacroEdgeSignature(rightTileOrId, opposite, {
        baseElevation: rightBaseElevation,
        minimumElevation,
        maximumElevation
    });
    const safeMode = mode === 'exact' || mode === 'connector' ? mode : 'auto';
    if (safeMode === 'exact' || (safeMode === 'auto' && left.tiers.length === right.tiers.length)) {
        return left.elevationSignature === right.elevationSignature;
    }
    return left.connectorSignature === right.connectorSignature;
}

/**
 * Deterministically select a catalog tile. FMG relief controls family, tier-span
 * and gradient weights; seed hashing supplies stable variety. Edge constraints
 * may be a signature object returned by getTerrainMacroEdgeSignature, an absolute
 * tier array/string/number, or an object with relativeTiers/relativeSignature.
 */
export function selectTerrainMacroTile({
    seed = 'terrain-macro',
    reliefProfile = null,
    role = 'primary',
    size = null,
    baseElevation = null,
    minimumElevation = 0,
    maximumElevation = 6,
    allowedFamilies = null,
    edgeConstraints = null,
    candidates = null
} = {}) {
    const safeRole = normalizeRole(role, size);
    const safeRelief = normalizeReliefProfile(reliefProfile);
    const safeBase = optionalFiniteInteger(baseElevation, safeRelief.baseElevationTier);
    const familySet = Array.isArray(allowedFamilies) || allowedFamilies instanceof Set
        ? new Set([...allowedFamilies].map((family) => normalizeFamily(family)))
        : null;
    const source = Array.isArray(candidates)
        ? candidates.map(resolveTerrainMacroTile).filter(Boolean)
        : safeRole === 'transition'
            ? TERRAIN_TRANSITION_MACRO_TILES
            : TERRAIN_PRIMARY_MACRO_TILES;
    const eligible = source
        .filter((tile) => tile.role === safeRole)
        .filter((tile) => !familySet || familySet.has(tile.family))
        .filter((tile) => safeBase + tile.minimumRelativeTier >= minimumElevation &&
            safeBase + tile.maximumRelativeTier <= maximumElevation)
        .filter((tile) => matchesEdgeConstraints(tile, edgeConstraints, {
            baseElevation: safeBase,
            minimumElevation,
            maximumElevation
        }))
        .sort((left, right) => left.id.localeCompare(right.id));
    if (!eligible.length) return null;

    const familyCounts = countFamilies(eligible);
    const weighted = eligible.map((tile) => ({
        tile,
        weight: terrainMacroTileWeight(tile, safeRelief, familyCounts.get(tile.family) || 1)
    }));
    const totalWeight = weighted.reduce((sum, entry) => sum + entry.weight, 0);
    const reliefFingerprint = [
        safeRelief.formulaVersion,
        safeRelief.reliefScore,
        safeRelief.targetTierSpan,
        safeRelief.gradientAxis,
        safeRelief.gradientSign,
        safeBase,
        safeRole,
        serializeEdgeConstraints(edgeConstraints)
    ].join(':');
    let cursor = hashUnit(`${seed}:${reliefFingerprint}`) * totalWeight;
    for (const entry of weighted) {
        cursor -= entry.weight;
        if (cursor < 0) return entry.tile;
    }
    return weighted[weighted.length - 1].tile;
}

/** Return the deterministic relief weight used by selectTerrainMacroTile. */
export function terrainMacroTileWeight(tileOrId, reliefProfile = null, familyCount = 1) {
    const tile = requireTerrainMacroTile(tileOrId);
    const relief = normalizeReliefProfile(reliefProfile);
    const score = relief.reliefScore;
    const familyWeight = tile.family === 'uniform'
        ? 0.16 + 5.2 * ((1 - score) ** 2)
        : tile.family === 'terraced'
            ? 0.7 + 1.7 * (1 - Math.abs(score - 0.42))
            : tile.family === 'ramp'
                ? 0.12 + 2.65 * score
                : 0.03 + 4.8 * (score ** 2);
    const maximumSpan = tile.role === 'primary' ? 4 : 2;
    const desiredSpan = clampNumber(
        Math.round(relief.targetTierSpan * (tile.role === 'primary' ? 0.72 : 0.4)),
        0,
        maximumSpan
    );
    const spanWeight = 1 / (1 + Math.abs(tile.tierSpan - desiredSpan) * 0.82);
    const axisWeight = tile.gradientAxis
        ? tile.gradientAxis === relief.gradientAxis ? 1.72 : 0.64
        : 1;
    const signWeight = tile.gradientAxis && tile.gradientAxis === relief.gradientAxis
        ? tile.gradientSign === relief.gradientSign ? 1.28 : 0.78
        : 1;
    return Math.max(
        0.000001,
        (familyWeight / Math.max(1, Number(familyCount) || 1)) *
        spanWeight * axisWeight * signWeight * tile.baseWeight
    );
}

/**
 * Instantiate absolute, clamped elevation rows for a selected tile. Callers can
 * retain this immutable patch as their WFC assignment before applying it.
 */
export function createTerrainMacroElevationPatch({
    tile,
    baseElevation = 0,
    minimumElevation = 0,
    maximumElevation = 6
} = {}) {
    const resolved = requireTerrainMacroTile(tile);
    const safeMinimum = finiteNumber(minimumElevation, 0);
    const safeMaximum = Math.max(safeMinimum, finiteNumber(maximumElevation, 6));
    const safeBase = finiteInteger(baseElevation, 0);
    let clampedCells = 0;
    const elevationRows = resolved.relativeElevationRows.map((row) => Object.freeze(row.map((relativeTier) => {
        const unclamped = safeBase + relativeTier;
        const elevation = clampNumber(unclamped, safeMinimum, safeMaximum);
        if (elevation !== unclamped) clampedCells++;
        return elevation;
    })));
    const edgeSignatures = Object.freeze(Object.fromEntries(
        TERRAIN_MACRO_DIRECTIONS.map((direction) => [
            direction,
            describeEdge(readEdge(elevationRows, direction), {
                relativeTiers: readEdge(resolved.relativeElevationRows, direction)
            })
        ])
    ));
    const tiers = elevationRows.flat();
    return Object.freeze({
        schema: 'terrain-macro-elevation-patch-v1',
        libraryVersion: TERRAIN_MACRO_TILE_LIBRARY_VERSION,
        visualProfile: 'rustic-diorama-v2',
        tileId: resolved.id,
        tile: resolved,
        role: resolved.role,
        family: resolved.family,
        size: resolved.size,
        baseElevation: safeBase,
        minimumElevation: Math.min(...tiers),
        maximumElevation: Math.max(...tiers),
        tierSpan: Math.max(...tiers) - Math.min(...tiers),
        clampedCells,
        elevationRows: Object.freeze(elevationRows),
        edgeSignatures
    });
}

/** Select and instantiate a patch in one deterministic integration call. */
export function createDeterministicTerrainMacroPatch(options = {}) {
    const relief = normalizeReliefProfile(options.reliefProfile);
    const baseElevation = optionalFiniteInteger(options.baseElevation, relief.baseElevationTier);
    const tile = selectTerrainMacroTile({ ...options, baseElevation });
    if (!tile) return null;
    return createTerrainMacroElevationPatch({
        tile,
        baseElevation,
        minimumElevation: options.minimumElevation,
        maximumElevation: options.maximumElevation
    });
}

/**
 * Collapse an absolute-coordinate macro grid with real edge propagation.
 *
 * The preferred integration form is `nodes`, where each entry supplies
 * `{ macroCol, macroRow, role, baseElevation, reliefProfile, allowedFamilies }`.
 * A rectangular shorthand is also available through gridWidth/gridHeight and
 * worldOriginMacroCol/worldOriginMacroRow. Node order and local view origin do not
 * enter entropy decisions: absolute macro coordinates are the solver ids.
 *
 * Each returned assignment contains an immutable elevation patch ready for
 * applyTerrainMacroTileToElevationRows. If requested domains contradict, the
 * helper first retries with all families, then (when hard boundary/base constraints
 * allow it) emits a connector-safe uniform component fallback with explicit
 * diagnostics. Set allowFallback=false to receive an unsolved result instead.
 */
export function collapseTerrainMacroTileGrid({
    nodes = null,
    gridWidth = 0,
    gridHeight = 0,
    worldOriginMacroCol = 0,
    worldOriginMacroRow = 0,
    seed = 'terrain-macro-collapse',
    role = 'primary',
    reliefProfile = null,
    baseElevation = null,
    allowedFamilies = null,
    minimumElevation = 0,
    maximumElevation = 6,
    allowFallback = true
} = {}) {
    const safeMinimum = finiteInteger(minimumElevation, 0);
    const safeMaximum = Math.max(safeMinimum, finiteInteger(maximumElevation, 6));
    const normalizedNodes = normalizeMacroCollapseNodes({
        nodes,
        gridWidth,
        gridHeight,
        worldOriginMacroCol,
        worldOriginMacroRow,
        role,
        reliefProfile,
        baseElevation,
        allowedFamilies,
        minimumElevation: safeMinimum,
        maximumElevation: safeMaximum
    });
    const edges = createMacroCollapseEdges(normalizedNodes);
    if (!normalizedNodes.length) {
        return createMacroCollapseResult({
            solved: true,
            reason: 'empty-grid',
            normalizedNodes,
            edges,
            stateAssignment: new Map(),
            stateById: new Map(),
            minimumElevation: safeMinimum,
            maximumElevation: safeMaximum,
            compatibilityChecks: 0,
            rejectedCompatibilityChecks: 0,
            initialIncompatibleEdges: [],
            incompatibleEdges: [],
            contradictions: [],
            fallbacks: [],
            fallbackAssignments: 0
        });
    }

    let compatibilityChecks = 0;
    let rejectedCompatibilityChecks = 0;
    const compatibilityCache = new Map();
    const compatibleStates = (leftState, rightState, direction) => {
        if (!leftState || !rightState) return false;
        const cacheKey = `${leftState.id}>${rightState.id}:${direction}`;
        if (compatibilityCache.has(cacheKey)) return compatibilityCache.get(cacheKey);
        compatibilityChecks++;
        const compatible = terrainMacroTilesCompatible(leftState.tile, rightState.tile, direction, {
            leftBaseElevation: leftState.baseElevation,
            rightBaseElevation: rightState.baseElevation,
            minimumElevation: safeMinimum,
            maximumElevation: safeMaximum,
            mode: 'auto'
        });
        if (!compatible) rejectedCompatibilityChecks++;
        compatibilityCache.set(cacheKey, compatible);
        return compatible;
    };
    const contradictions = [];
    const fallbacks = [];

    const requestedModel = createMacroCollapseDomainModel(normalizedNodes, {
        minimumElevation: safeMinimum,
        maximumElevation: safeMaximum,
        expandedFamilies: false
    });
    const initialIncompatibleEdges = findDomainIncompatibleEdges(
        edges,
        requestedModel.domains,
        requestedModel.stateById,
        compatibleStates
    );
    let solvedPass = solveMacroCollapsePass({
        normalizedNodes,
        edges,
        model: requestedModel,
        seed,
        compatibleStates
    });
    if (!solvedPass.solved) contradictions.push(solvedPass.contradiction);

    if (!solvedPass.solved && allowFallback) {
        const expandedModel = createMacroCollapseDomainModel(normalizedNodes, {
            minimumElevation: safeMinimum,
            maximumElevation: safeMaximum,
            expandedFamilies: true
        });
        const expandedIncompatibleEdges = findDomainIncompatibleEdges(
            edges,
            expandedModel.domains,
            expandedModel.stateById,
            compatibleStates
        );
        const expandedPass = solveMacroCollapsePass({
            normalizedNodes,
            edges,
            model: expandedModel,
            seed: `${seed}:expanded-families`,
            compatibleStates,
            stage: 'expanded-families'
        });
        fallbacks.push(Object.freeze({
            stage: 'expanded-families',
            used: expandedPass.solved,
            incompatibleEdges: expandedIncompatibleEdges.length,
            code: expandedPass.contradiction?.code ?? null
        }));
        if (expandedPass.solved) {
            solvedPass = expandedPass;
        } else {
            contradictions.push(expandedPass.contradiction);
            const uniformFallback = createUniformMacroComponentFallback({
                normalizedNodes,
                edges,
                minimumElevation: safeMinimum,
                maximumElevation: safeMaximum,
                compatibleStates
            });
            fallbacks.push(Object.freeze({
                stage: 'uniform-components',
                used: uniformFallback.solved,
                incompatibleEdges: uniformFallback.incompatibleEdges.length,
                overriddenAssignments: uniformFallback.fallbackAssignments,
                code: uniformFallback.reason
            }));
            if (uniformFallback.solved) solvedPass = uniformFallback;
        }
    }

    const finalIncompatibleEdges = solvedPass.solved
        ? findAssignmentIncompatibleEdges(edges, solvedPass.assignment, solvedPass.stateById, compatibleStates)
        : initialIncompatibleEdges;
    return createMacroCollapseResult({
        solved: solvedPass.solved && finalIncompatibleEdges.length === 0,
        reason: solvedPass.solved
            ? fallbacks.some((fallback) => fallback.used) ? 'solved-with-fallback' : 'solved'
            : 'contradiction',
        normalizedNodes,
        edges,
        stateAssignment: solvedPass.assignment || new Map(),
        stateById: solvedPass.stateById || requestedModel.stateById,
        minimumElevation: safeMinimum,
        maximumElevation: safeMaximum,
        compatibilityChecks,
        rejectedCompatibilityChecks,
        initialIncompatibleEdges,
        incompatibleEdges: finalIncompatibleEdges,
        contradictions,
        fallbacks,
        fallbackAssignments: solvedPass.fallbackAssignments || 0
    });
}

/**
 * Apply one macro patch in place. Hard-authoritative cells are accepted as a Set
 * or Map of `"col,row"` keys or row-major numeric ids, a boolean row mask, and/or
 * a predicate. Preserved cells are never touched, including by the optional
 * generated-spike repair.
 */
export function applyTerrainMacroTileToElevationRows({
    elevationRows,
    tile = null,
    patch = null,
    originCol = 0,
    originRow = 0,
    baseElevation = 0,
    minimumElevation = 0,
    maximumElevation = 6,
    hardAuthoritativeCells = null,
    hardAuthoritativeRows = null,
    isHardAuthoritative = null,
    repairIsolatedSpikes = true
} = {}) {
    if (!Array.isArray(elevationRows) || !elevationRows.length) {
        throw new TypeError('elevationRows must be a non-empty two-dimensional array');
    }
    const resolvedPatch = normalizeElevationPatch(patch) || createTerrainMacroElevationPatch({
        tile,
        baseElevation,
        minimumElevation,
        maximumElevation
    });
    const safeOriginCol = finiteInteger(originCol, 0);
    const safeOriginRow = finiteInteger(originRow, 0);
    const worldWidth = elevationRows.reduce((maximum, row) =>
        Math.max(maximum, Array.isArray(row) ? row.length : 0), 0);
    const appliedByKey = new Map();
    const protectedKeys = new Set();
    let attemptedCells = 0;
    let preservedCells = 0;
    let outOfBoundsCells = 0;

    for (let localRow = 0; localRow < resolvedPatch.size; localRow++) {
        for (let localCol = 0; localCol < resolvedPatch.size; localCol++) {
            attemptedCells++;
            const col = safeOriginCol + localCol;
            const row = safeOriginRow + localRow;
            if (!Array.isArray(elevationRows[row]) || elevationRows[row][col] === undefined) {
                outOfBoundsCells++;
                continue;
            }
            const key = gridKey(col, row);
            if (cellIsHardAuthoritative({
                col,
                row,
                key,
                currentElevation: elevationRows[row][col],
                worldWidth,
                hardAuthoritativeCells,
                hardAuthoritativeRows,
                isHardAuthoritative
            })) {
                protectedKeys.add(key);
                preservedCells++;
                continue;
            }
            const previousElevation = elevationRows[row][col];
            const nextElevation = resolvedPatch.elevationRows[localRow][localCol];
            elevationRows[row][col] = nextElevation;
            appliedByKey.set(key, {
                col,
                row,
                localCol,
                localRow,
                previousElevation,
                elevation: nextElevation,
                repaired: false
            });
        }
    }

    const repairedSpikes = repairIsolatedSpikes
        ? repairGeneratedSpikes(elevationRows, appliedByKey, protectedKeys)
        : 0;
    const appliedCells = [...appliedByKey.values()]
        .sort((left, right) => left.row - right.row || left.col - right.col)
        .map((cell) => Object.freeze({ ...cell }));
    return Object.freeze({
        libraryVersion: TERRAIN_MACRO_TILE_LIBRARY_VERSION,
        visualProfile: 'rustic-diorama-v2',
        tileId: resolvedPatch.tileId,
        role: resolvedPatch.role,
        family: resolvedPatch.family,
        originCol: safeOriginCol,
        originRow: safeOriginRow,
        attemptedCells,
        appliedCells: appliedCells.length,
        preservedCells,
        outOfBoundsCells,
        repairedSpikes,
        cells: Object.freeze(appliedCells)
    });
}

/** Find cardinal single-cell peaks and pits in any numeric elevation matrix. */
export function findIsolatedElevationSpikes(rows = []) {
    const spikes = [];
    for (let row = 0; row < rows.length; row++) {
        if (!Array.isArray(rows[row])) continue;
        for (let col = 0; col < rows[row].length; col++) {
            const elevation = Number(rows[row][col]);
            if (!Number.isFinite(elevation)) continue;
            const neighbors = cardinalNeighborValues(rows, col, row);
            if (neighbors.length < 2 || neighbors.some((value) => value === elevation)) continue;
            const peak = neighbors.every((value) => value < elevation);
            const pit = neighbors.every((value) => value > elevation);
            if (peak || pit) spikes.push(Object.freeze({ col, row, elevation, kind: peak ? 'peak' : 'pit' }));
        }
    }
    return spikes;
}

function normalizeMacroCollapseNodes({
    nodes,
    gridWidth,
    gridHeight,
    worldOriginMacroCol,
    worldOriginMacroRow,
    role,
    reliefProfile,
    baseElevation,
    allowedFamilies,
    minimumElevation,
    maximumElevation
}) {
    const fallbackRelief = normalizeReliefProfile(reliefProfile);
    const fallbackBase = optionalFiniteInteger(baseElevation, fallbackRelief.baseElevationTier);
    const explicitNodeList = Array.isArray(nodes);
    const source = explicitNodeList
        ? nodes
        : Array.from({ length: Math.max(0, finiteInteger(gridHeight, 0)) }, (_, localRow) =>
            Array.from({ length: Math.max(0, finiteInteger(gridWidth, 0)) }, (_, localCol) => ({
                macroCol: finiteInteger(worldOriginMacroCol, 0) + localCol,
                macroRow: finiteInteger(worldOriginMacroRow, 0) + localRow
            }))).flat();
    const seen = new Set();
    const normalized = source.map((node, index) => {
        const safeNode = node && typeof node === 'object' ? node : {};
        const rawMacroCol = firstDefined(
            safeNode.macroCol,
            safeNode.worldMacroCol,
            safeNode.worldCol,
            safeNode.col
        );
        const rawMacroRow = firstDefined(
            safeNode.macroRow,
            safeNode.worldMacroRow,
            safeNode.worldRow,
            safeNode.row
        );
        if (explicitNodeList && (rawMacroCol === undefined || rawMacroRow === undefined)) {
            throw new TypeError(`Terrain macro node ${index} requires absolute macroCol and macroRow coordinates.`);
        }
        const macroCol = finiteInteger(rawMacroCol, finiteInteger(worldOriginMacroCol, 0) + index);
        const macroRow = finiteInteger(rawMacroRow, finiteInteger(worldOriginMacroRow, 0));
        const key = macroGridKey(macroCol, macroRow);
        if (seen.has(key)) throw new RangeError(`Duplicate terrain macro coordinate: ${key}`);
        seen.add(key);
        const nodeRelief = normalizeReliefProfile(safeNode.reliefProfile ?? reliefProfile);
        const targetBaseElevation = optionalFiniteInteger(
            firstDefined(safeNode.baseElevation, safeNode.targetBaseElevation, baseElevation),
            nodeRelief.baseElevationTier ?? fallbackBase
        );
        const fixedBase = safeNode.fixedBase === true || safeNode.hardBase === true;
        const rawBaseCandidates = fixedBase
            ? [targetBaseElevation]
            : iterableValues(safeNode.baseElevationCandidates, [targetBaseElevation]);
        const baseElevationCandidates = Object.freeze([...new Set(rawBaseCandidates
            .map((value) => finiteInteger(value, targetBaseElevation))
            .filter((value) => value >= minimumElevation && value <= maximumElevation))]
            .sort((left, right) => left - right));
        return Object.freeze({
            key,
            sourceId: safeNode.id ?? key,
            macroCol,
            macroRow,
            role: normalizeRole(safeNode.role ?? role, safeNode.size),
            reliefProfile: nodeRelief,
            baseElevation: targetBaseElevation,
            baseElevationCandidates,
            fixedBase,
            fixedTileId: safeNode.fixedTileId ? String(safeNode.fixedTileId) : null,
            allowedFamilies: normalizeAllowedFamilies(safeNode.allowedFamilies ?? allowedFamilies),
            edgeConstraints: safeNode.edgeConstraints && typeof safeNode.edgeConstraints === 'object'
                ? safeNode.edgeConstraints
                : null
        });
    });
    return normalized.sort((left, right) =>
        left.macroRow - right.macroRow || left.macroCol - right.macroCol);
}

function createMacroCollapseEdges(nodes) {
    const nodeByCoordinate = new Map(nodes.map((node) => [macroGridKey(node.macroCol, node.macroRow), node]));
    const edges = [];
    for (const node of nodes) {
        for (const direction of [
            { name: 'east', col: 1, row: 0 },
            { name: 'south', col: 0, row: 1 }
        ]) {
            const neighbor = nodeByCoordinate.get(macroGridKey(
                node.macroCol + direction.col,
                node.macroRow + direction.row
            ));
            if (!neighbor) continue;
            edges.push(Object.freeze({
                source: node.key,
                target: neighbor.key,
                direction: direction.name
            }));
        }
    }
    return Object.freeze(edges.sort((left, right) =>
        left.source.localeCompare(right.source) ||
        left.target.localeCompare(right.target) ||
        left.direction.localeCompare(right.direction)));
}

function createMacroCollapseDomainModel(nodes, {
    minimumElevation,
    maximumElevation,
    expandedFamilies
}) {
    const stateById = new Map();
    const domains = new Map();
    for (const node of nodes) {
        const catalog = node.role === 'transition'
            ? TERRAIN_TRANSITION_MACRO_TILES
            : TERRAIN_PRIMARY_MACRO_TILES;
        const domain = new Set();
        for (const candidateBase of node.baseElevationCandidates) {
            for (const tile of catalog) {
                if (!expandedFamilies && node.allowedFamilies && !node.allowedFamilies.has(tile.family)) continue;
                if (node.fixedTileId && node.fixedTileId !== tile.id) continue;
                if (candidateBase + tile.minimumRelativeTier < minimumElevation ||
                    candidateBase + tile.maximumRelativeTier > maximumElevation) continue;
                if (!matchesEdgeConstraints(tile, node.edgeConstraints, {
                    baseElevation: candidateBase,
                    minimumElevation,
                    maximumElevation
                })) continue;
                const state = createMacroCollapseState(tile, candidateBase);
                if (!stateById.has(state.id)) stateById.set(state.id, state);
                domain.add(state.id);
            }
        }
        domains.set(node.key, domain);
    }
    return { stateById, domains };
}

function createMacroCollapseState(tile, baseElevation) {
    return Object.freeze({
        id: `${tile.id}@${baseElevation}`,
        tile,
        tileId: tile.id,
        role: tile.role,
        family: tile.family,
        baseElevation
    });
}

function solveMacroCollapsePass({
    normalizedNodes,
    edges,
    model,
    seed,
    compatibleStates,
    stage = 'requested'
}) {
    const emptyNodes = normalizedNodes.filter((node) => (model.domains.get(node.key)?.size || 0) === 0);
    if (emptyNodes.length) {
        return {
            solved: false,
            assignment: new Map(),
            stateById: model.stateById,
            contradiction: freezeMacroContradiction({
                stage,
                code: 'TERRAIN_MACRO_EMPTY_DOMAIN',
                message: 'At least one terrain macro node has no legal tile/base state.',
                nodeKeys: emptyNodes.map((node) => node.key)
            })
        };
    }
    const outgoing = new Map(normalizedNodes.map((node) => [node.key, []]));
    for (const edge of edges) {
        outgoing.get(edge.source)?.push(Object.freeze({ id: edge.target, direction: edge.direction }));
    }
    const solverNodes = normalizedNodes.map((node) => ({
        id: node.key,
        neighbors: outgoing.get(node.key) || []
    }));
    const solverTiles = [...model.stateById.values()].map((state) => ({ id: state.id, weight: 1 }));
    const nodeByKey = new Map(normalizedNodes.map((node) => [node.key, node]));
    const familyCountsByNode = new Map(normalizedNodes.map((node) => {
        const counts = new Map();
        for (const stateId of model.domains.get(node.key) || []) {
            const family = model.stateById.get(stateId)?.family;
            if (family) counts.set(family, (counts.get(family) || 0) + 1);
        }
        return [node.key, counts];
    }));
    try {
        const assignment = solveWaveFunctionCollapse({
            nodes: solverNodes,
            tiles: solverTiles,
            domains: model.domains,
            seed: `${seed}:terrain-macro-grid`,
            compatible: (leftStateId, rightStateId, direction) => compatibleStates(
                model.stateById.get(leftStateId),
                model.stateById.get(rightStateId),
                direction
            ),
            nodeWeights: (nodeKey, stateId) => {
                const node = nodeByKey.get(nodeKey);
                const state = model.stateById.get(stateId);
                const familyCount = familyCountsByNode.get(nodeKey)?.get(state.family) || 1;
                const reliefWeight = terrainMacroTileWeight(state.tile, node.reliefProfile, familyCount);
                const baseDistance = Math.abs(state.baseElevation - node.baseElevation);
                return reliefWeight / (1 + baseDistance * 1.4);
            }
        });
        return { solved: true, assignment, stateById: model.stateById, fallbackAssignments: 0 };
    } catch (error) {
        if (error?.name !== 'WaveFunctionCollapseError') throw error;
        return {
            solved: false,
            assignment: new Map(),
            stateById: model.stateById,
            contradiction: freezeMacroContradiction({
                stage,
                code: error.code || 'TERRAIN_MACRO_CONTRADICTION',
                message: error.message,
                details: error.details || null
            })
        };
    }
}

function findDomainIncompatibleEdges(edges, domains, stateById, compatibleStates) {
    return Object.freeze(edges.filter((edge) => {
        const sourceDomain = [...(domains.get(edge.source) || [])];
        const targetDomain = [...(domains.get(edge.target) || [])];
        return !sourceDomain.some((sourceStateId) => targetDomain.some((targetStateId) =>
            compatibleStates(stateById.get(sourceStateId), stateById.get(targetStateId), edge.direction)));
    }).map((edge) => {
        const sourceStates = [...(domains.get(edge.source) || [])].map((id) => stateById.get(id)).filter(Boolean);
        const targetStates = [...(domains.get(edge.target) || [])].map((id) => stateById.get(id)).filter(Boolean);
        return Object.freeze({
            ...edge,
            reason: 'no-compatible-state-pair',
            sourceDomainSize: sourceStates.length,
            targetDomainSize: targetStates.length,
            sourceBaseElevations: Object.freeze(uniqueSortedNumbers(sourceStates.map((state) => state.baseElevation))),
            targetBaseElevations: Object.freeze(uniqueSortedNumbers(targetStates.map((state) => state.baseElevation)))
        });
    }));
}

function findAssignmentIncompatibleEdges(edges, assignment, stateById, compatibleStates) {
    const incompatible = [];
    for (const edge of edges) {
        const source = stateById.get(assignment.get(edge.source));
        const target = stateById.get(assignment.get(edge.target));
        if (!source || !target || !compatibleStates(source, target, edge.direction)) {
            incompatible.push(describeAssignedIncompatibleEdge(edge, source, target));
        }
    }
    return Object.freeze(incompatible);
}

function describeAssignedIncompatibleEdge(edge, source, target) {
    const sourceSignature = source
        ? getTerrainMacroEdgeSignature(source.tile, edge.direction, { baseElevation: source.baseElevation })
        : null;
    const targetSignature = target
        ? getTerrainMacroEdgeSignature(target.tile, DIRECTION_OPPOSITE[edge.direction], { baseElevation: target.baseElevation })
        : null;
    return Object.freeze({
        ...edge,
        reason: !source || !target ? 'missing-assignment' : 'incompatible-edge-signature',
        sourceTileId: source?.tileId ?? null,
        targetTileId: target?.tileId ?? null,
        sourceBaseElevation: source?.baseElevation ?? null,
        targetBaseElevation: target?.baseElevation ?? null,
        sourceElevationSignature: sourceSignature?.elevationSignature ?? null,
        targetElevationSignature: targetSignature?.elevationSignature ?? null,
        sourceConnectorSignature: sourceSignature?.connectorSignature ?? null,
        targetConnectorSignature: targetSignature?.connectorSignature ?? null
    });
}

function createUniformMacroComponentFallback({
    normalizedNodes,
    edges,
    minimumElevation,
    maximumElevation,
    compatibleStates
}) {
    const components = createMacroConnectedComponents(normalizedNodes, edges);
    const assignment = new Map();
    const stateById = new Map();
    let fallbackAssignments = 0;
    for (const component of components) {
        const fixedBases = uniqueSortedNumbers(component
            .filter((node) => node.fixedBase)
            .map((node) => node.baseElevation));
        if (fixedBases.length > 1) {
            return {
                solved: false,
                assignment: new Map(),
                stateById,
                incompatibleEdges: Object.freeze([]),
                fallbackAssignments: 0,
                reason: 'conflicting-fixed-bases'
            };
        }
        const componentBase = clampNumber(
            fixedBases[0] ?? medianInteger(component.map((node) => node.baseElevation), minimumElevation),
            minimumElevation,
            maximumElevation
        );
        for (const node of component) {
            const tile = node.role === 'transition' ? TRANSITION_UNIFORM : PRIMARY_UNIFORM;
            if (!matchesEdgeConstraints(tile, node.edgeConstraints, {
                baseElevation: componentBase,
                minimumElevation,
                maximumElevation
            })) {
                return {
                    solved: false,
                    assignment: new Map(),
                    stateById,
                    incompatibleEdges: Object.freeze([]),
                    fallbackAssignments: 0,
                    reason: 'boundary-edge-constraint'
                };
            }
            const state = createMacroCollapseState(tile, componentBase);
            if (!stateById.has(state.id)) stateById.set(state.id, state);
            assignment.set(node.key, state.id);
            if (node.baseElevation !== componentBase ||
                (node.fixedTileId && node.fixedTileId !== tile.id) ||
                (node.allowedFamilies && !node.allowedFamilies.has('uniform'))) {
                fallbackAssignments++;
            }
        }
    }
    const incompatibleEdges = findAssignmentIncompatibleEdges(edges, assignment, stateById, compatibleStates);
    return {
        solved: incompatibleEdges.length === 0,
        assignment,
        stateById,
        incompatibleEdges,
        fallbackAssignments,
        reason: incompatibleEdges.length ? 'uniform-edge-contradiction' : 'uniform-component-fallback'
    };
}

function createMacroConnectedComponents(nodes, edges) {
    const nodeByKey = new Map(nodes.map((node) => [node.key, node]));
    const neighbors = new Map(nodes.map((node) => [node.key, new Set()]));
    for (const edge of edges) {
        neighbors.get(edge.source)?.add(edge.target);
        neighbors.get(edge.target)?.add(edge.source);
    }
    const visited = new Set();
    const components = [];
    for (const node of nodes) {
        if (visited.has(node.key)) continue;
        const queue = [node.key];
        const component = [];
        visited.add(node.key);
        while (queue.length) {
            const key = queue.shift();
            component.push(nodeByKey.get(key));
            for (const neighbor of [...(neighbors.get(key) || [])].sort()) {
                if (visited.has(neighbor)) continue;
                visited.add(neighbor);
                queue.push(neighbor);
            }
        }
        components.push(component.sort((left, right) =>
            left.macroRow - right.macroRow || left.macroCol - right.macroCol));
    }
    return components;
}

function createMacroCollapseResult({
    solved,
    reason,
    normalizedNodes,
    edges,
    stateAssignment,
    stateById,
    minimumElevation,
    maximumElevation,
    compatibilityChecks,
    rejectedCompatibilityChecks,
    initialIncompatibleEdges,
    incompatibleEdges,
    contradictions,
    fallbacks,
    fallbackAssignments
}) {
    const assignments = [];
    const assignmentByWorldKey = new Map();
    const tileAssignment = new Map();
    const moduleHistogram = {};
    const familyHistogram = {};
    for (const node of normalizedNodes) {
        const state = stateById.get(stateAssignment.get(node.key));
        if (!state) continue;
        const record = Object.freeze({
            id: node.sourceId,
            worldKey: node.key,
            macroCol: node.macroCol,
            macroRow: node.macroRow,
            role: state.role,
            tileId: state.tileId,
            tile: state.tile,
            family: state.family,
            baseElevation: state.baseElevation,
            patch: createTerrainMacroElevationPatch({
                tile: state.tile,
                baseElevation: state.baseElevation,
                minimumElevation,
                maximumElevation
            })
        });
        assignments.push(record);
        assignmentByWorldKey.set(node.key, record);
        tileAssignment.set(node.key, state.tileId);
        moduleHistogram[state.tileId] = (moduleHistogram[state.tileId] || 0) + 1;
        familyHistogram[state.family] = (familyHistogram[state.family] || 0) + 1;
    }
    const assignmentSignature = assignments
        .map((entry) => `${entry.worldKey}:${entry.tileId}@${entry.baseElevation}`)
        .join('|');
    const roleHistogram = normalizedNodes.reduce((histogram, node) => {
        histogram[node.role] = (histogram[node.role] || 0) + 1;
        return histogram;
    }, {});
    const diagnostics = Object.freeze({
        libraryVersion: TERRAIN_MACRO_TILE_LIBRARY_VERSION,
        visualProfile: 'rustic-diorama-v2',
        reason,
        solved,
        worldCoordinateDeterministic: true,
        nodes: normalizedNodes.length,
        edges: edges.length,
        assignedNodes: assignments.length,
        compatibilityChecks,
        rejectedCompatibilityChecks,
        initialIncompatibleEdges: Object.freeze([...initialIncompatibleEdges]),
        incompatibleEdges: Object.freeze([...incompatibleEdges]),
        incompatibleEdgeCount: incompatibleEdges.length,
        contradictions: Object.freeze(contradictions.filter(Boolean).map(Object.freeze)),
        fallbacks: Object.freeze(fallbacks.map(Object.freeze)),
        fallbackCount: fallbacks.filter((fallback) => fallback.used).length,
        fallbackAttempts: fallbacks.length,
        fallbackAssignments,
        roleHistogram: Object.freeze(roleHistogram),
        moduleHistogram: Object.freeze(moduleHistogram),
        familyHistogram: Object.freeze(familyHistogram),
        assignmentHash: hashStringHex(assignmentSignature)
    });
    return Object.freeze({
        solved,
        assignments: Object.freeze(assignments),
        assignment: assignmentByWorldKey,
        assignmentByWorldKey,
        tileAssignment,
        diagnostics
    });
}

function freezeMacroContradiction({ stage, code, message, nodeKeys = [], details = null }) {
    return Object.freeze({
        stage,
        code,
        message,
        nodeKeys: Object.freeze([...nodeKeys]),
        details
    });
}

function createDirectionalMacroTile({ id, role, profile, gradient }) {
    const size = role === 'transition' ? TERRAIN_TRANSITION_MACRO_SIZE : TERRAIN_PRIMARY_MACRO_SIZE;
    return createMacroTile({
        id,
        role,
        family: profile.family,
        variant: profile.variant,
        rows: directionalRows(profile.levels, gradient.axis, gradient.sign),
        gradientAxis: gradient.axis,
        gradientSign: gradient.sign,
        baseWeight: profile.baseWeight,
        size
    });
}

function createMacroTile({
    id,
    role,
    family,
    variant,
    rows,
    gradientAxis = null,
    gradientSign = 0,
    baseWeight = 1
}) {
    const relativeElevationRows = Object.freeze(rows.map((row) => Object.freeze([...row])));
    const tiers = relativeElevationRows.flat();
    const minimumRelativeTier = Math.min(...tiers);
    const maximumRelativeTier = Math.max(...tiers);
    const edgeSignatures = Object.freeze(Object.fromEntries(
        TERRAIN_MACRO_DIRECTIONS.map((direction) => [
            direction,
            describeEdge(readEdge(relativeElevationRows, direction))
        ])
    ));
    return Object.freeze({
        id,
        libraryVersion: TERRAIN_MACRO_TILE_LIBRARY_VERSION,
        visualProfile: 'rustic-diorama-v2',
        role,
        family,
        variant,
        size: relativeElevationRows.length,
        baseWeight,
        gradientAxis,
        gradientSign,
        minimumRelativeTier,
        maximumRelativeTier,
        tierSpan: maximumRelativeTier - minimumRelativeTier,
        relativeElevationRows,
        edgeSignatures
    });
}

function describeEdge(sourceTiers, { relativeTiers: sourceRelativeTiers = sourceTiers } = {}) {
    const tiers = Object.freeze(sourceTiers.map((tier) => Number(tier)));
    const connectorTiers = Object.freeze(sampleThreeAnchors(tiers));
    const relativeTiers = Object.freeze(sourceRelativeTiers.map((tier) => Number(tier)));
    const relativeConnectorTiers = Object.freeze(sampleThreeAnchors(relativeTiers));
    const minimum = Math.min(...tiers);
    const maximum = Math.max(...tiers);
    const normalizedTiers = Object.freeze(tiers.map((tier) => tier - minimum));
    const normalizedConnectorTiers = Object.freeze(connectorTiers.map((tier) => tier - minimum));
    const elevationSignature = tiers.join(',');
    return Object.freeze({
        tiers,
        connectorTiers,
        elevationSignature,
        signature: elevationSignature,
        connectorSignature: connectorTiers.join(','),
        relativeTiers,
        relativeConnectorTiers,
        relativeSignature: relativeTiers.join(','),
        relativeConnectorSignature: relativeConnectorTiers.join(','),
        normalizedTiers,
        normalizedConnectorTiers,
        normalizedSignature: normalizedTiers.join(','),
        normalizedConnectorSignature: normalizedConnectorTiers.join(','),
        minimum,
        maximum,
        tierSpan: maximum - minimum,
        level: minimum === maximum
    });
}

function readEdge(rows, direction) {
    const lastRow = rows.length - 1;
    const lastCol = Math.max(0, (rows[0]?.length || 1) - 1);
    if (direction === 'north') return [...rows[0]];
    if (direction === 'south') return [...rows[lastRow]];
    if (direction === 'east') return rows.map((row) => row[lastCol]);
    return rows.map((row) => row[0]);
}

function sampleThreeAnchors(tiers) {
    if (tiers.length === 3) return [...tiers];
    if (tiers.length === 1) return [tiers[0], tiers[0], tiers[0]];
    return [tiers[0], tiers[Math.floor((tiers.length - 1) / 2)], tiers[tiers.length - 1]];
}

function matchesEdgeConstraints(tile, constraints, options) {
    if (!constraints || typeof constraints !== 'object') return true;
    return TERRAIN_MACRO_DIRECTIONS.every((direction) => {
        const constraint = constraints[direction];
        if (constraint === undefined || constraint === null) return true;
        const edge = getTerrainMacroEdgeSignature(tile, direction, options);
        const relativeEdge = tile.edgeSignatures[direction];
        if (typeof constraint === 'number') return edge.tiers.every((tier) => tier === constraint);
        if (typeof constraint === 'string') return edge.elevationSignature === constraint;
        if (Array.isArray(constraint)) return arraysEqual(edge.tiers, constraint.map(Number));
        if (typeof constraint !== 'object') return false;
        if (Array.isArray(constraint.tiers) && !arraysEqual(edge.tiers, constraint.tiers.map(Number))) return false;
        if (constraint.elevationSignature !== undefined && edge.elevationSignature !== String(constraint.elevationSignature)) return false;
        if (constraint.signature !== undefined && edge.elevationSignature !== String(constraint.signature)) return false;
        if (Array.isArray(constraint.connectorTiers) && !arraysEqual(edge.connectorTiers, constraint.connectorTiers.map(Number))) return false;
        if (constraint.connectorSignature !== undefined && edge.connectorSignature !== String(constraint.connectorSignature)) return false;
        if (Array.isArray(constraint.relativeTiers) && !arraysEqual(relativeEdge.relativeTiers, constraint.relativeTiers.map(Number))) return false;
        if (constraint.relativeSignature !== undefined && relativeEdge.relativeSignature !== String(constraint.relativeSignature)) return false;
        if (constraint.relativeConnectorSignature !== undefined &&
            relativeEdge.relativeConnectorSignature !== String(constraint.relativeConnectorSignature)) return false;
        return true;
    });
}

function repairGeneratedSpikes(elevationRows, appliedByKey, protectedKeys) {
    let repairs = 0;
    const maximumPasses = Math.max(1, appliedByKey.size);
    for (let pass = 0; pass < maximumPasses; pass++) {
        let changed = false;
        for (const [key, cell] of appliedByKey) {
            if (protectedKeys.has(key) || cell.previousElevation === elevationRows[cell.row][cell.col]) continue;
            const elevation = Number(elevationRows[cell.row][cell.col]);
            const neighbors = cardinalNeighborValues(elevationRows, cell.col, cell.row);
            if (neighbors.length < 2 || neighbors.some((value) => value === elevation)) continue;
            const peak = neighbors.every((value) => value < elevation);
            const pit = neighbors.every((value) => value > elevation);
            if (!peak && !pit) continue;
            const replacement = peak ? Math.max(...neighbors) : Math.min(...neighbors);
            elevationRows[cell.row][cell.col] = replacement;
            cell.elevation = replacement;
            cell.repaired = true;
            repairs++;
            changed = true;
        }
        if (!changed) break;
    }
    return repairs;
}

function cellIsHardAuthoritative({
    col,
    row,
    key,
    currentElevation,
    worldWidth,
    hardAuthoritativeCells,
    hardAuthoritativeRows,
    isHardAuthoritative
}) {
    const hasKey = hardAuthoritativeCells && typeof hardAuthoritativeCells.has === 'function' && (
        hardAuthoritativeCells.has(key) ||
        hardAuthoritativeCells.has(`${col}:${row}`) ||
        hardAuthoritativeCells.has(row * worldWidth + col)
    );
    if (hasKey || Boolean(hardAuthoritativeRows?.[row]?.[col])) return true;
    return typeof isHardAuthoritative === 'function' && Boolean(isHardAuthoritative({
        col,
        row,
        elevation: currentElevation,
        key
    }));
}

function normalizeElevationPatch(patch) {
    if (!patch || patch.schema !== 'terrain-macro-elevation-patch-v1' ||
        !Array.isArray(patch.elevationRows) || !Number.isInteger(patch.size)) return null;
    return patch;
}

function normalizeReliefProfile(profile) {
    const reliefScore = clampNumber(finiteNumber(profile?.reliefScore, 0.35), 0, 1);
    const targetTierSpan = clampNumber(finiteInteger(profile?.targetTierSpan, Math.round(1 + reliefScore * 5)), 0, 6);
    const axis = String(profile?.gradientAxis || '').toLowerCase();
    const gradientAxis = axis === 'north-south' || axis === 'y' ? 'north-south' : 'east-west';
    return Object.freeze({
        normalized: true,
        formulaVersion: String(profile?.formulaVersion || 'fmg-burg-relief-v2'),
        reliefScore,
        targetTierSpan,
        baseElevationTier: clampNumber(finiteInteger(profile?.baseElevationTier, 0), 0, 6),
        gradientAxis,
        gradientSign: Number(profile?.gradientSign) < 0 ? -1 : 1
    });
}

function normalizeRole(role, size) {
    if (Number(size) === TERRAIN_TRANSITION_MACRO_SIZE || role === 'transition') return 'transition';
    return 'primary';
}

function normalizeFamily(family) {
    const normalized = String(family || '').toLowerCase();
    return normalized === 'terrace' ? 'terraced' : normalized;
}

function normalizeAllowedFamilies(families) {
    if (families === null || families === undefined) return null;
    const values = typeof families === 'string' ? [families] : iterableValues(families, []);
    return Object.freeze(new Set(values.map(normalizeFamily).filter(Boolean)));
}

function normalizeDirection(direction) {
    const normalized = String(direction || '').toLowerCase();
    if (!TERRAIN_MACRO_DIRECTIONS.includes(normalized)) {
        throw new RangeError(`Unknown terrain macro direction: ${direction}`);
    }
    return normalized;
}

function requireTerrainMacroTile(tileOrId) {
    const tile = resolveTerrainMacroTile(tileOrId);
    if (!tile) throw new RangeError(`Unknown terrain macro tile: ${String(tileOrId)}`);
    return tile;
}

function countFamilies(tiles) {
    const counts = new Map();
    for (const tile of tiles) counts.set(tile.family, (counts.get(tile.family) || 0) + 1);
    return counts;
}

function serializeEdgeConstraints(constraints) {
    if (!constraints || typeof constraints !== 'object') return '';
    return TERRAIN_MACRO_DIRECTIONS.map((direction) => {
        const value = constraints[direction];
        if (Array.isArray(value)) return `${direction}=${value.join(',')}`;
        if (value && typeof value === 'object') {
            return `${direction}=${value.elevationSignature || value.signature || value.connectorSignature ||
                value.relativeSignature || value.relativeConnectorSignature ||
                value.tiers?.join(',') || value.connectorTiers?.join(',') ||
                value.relativeTiers?.join(',') || value.relativeConnectorTiers?.join(',') || ''}`;
        }
        return `${direction}=${value ?? ''}`;
    }).join('|');
}

function directionalRows(levels, axis, sign) {
    const source = sign < 0 ? [...levels].reverse() : [...levels];
    if (axis === 'north-south') return source.map((level) => Array(levels.length).fill(level));
    return Array.from({ length: levels.length }, () => [...source]);
}

function filledRows(size, value) {
    return Array.from({ length: size }, () => Array(size).fill(value));
}

function insetRows(size, edgeValue, insetValue) {
    return Array.from({ length: size }, (_, row) =>
        Array.from({ length: size }, (_, col) =>
            row > 0 && row < size - 1 && col > 0 && col < size - 1 ? insetValue : edgeValue));
}

function maximumCardinalDelta(rows) {
    let maximum = 0;
    for (let row = 0; row < rows.length; row++) {
        for (let col = 0; col < (rows[row]?.length || 0); col++) {
            const value = Number(rows[row][col]);
            if (col + 1 < rows[row].length) maximum = Math.max(maximum, Math.abs(value - Number(rows[row][col + 1])));
            if (row + 1 < rows.length && rows[row + 1]?.[col] !== undefined) {
                maximum = Math.max(maximum, Math.abs(value - Number(rows[row + 1][col])));
            }
        }
    }
    return maximum;
}

function cardinalNeighborValues(rows, col, row) {
    return [
        rows[row - 1]?.[col],
        rows[row]?.[col + 1],
        rows[row + 1]?.[col],
        rows[row]?.[col - 1]
    ].map(Number).filter(Number.isFinite);
}

function arraysEqual(left, right) {
    return left.length === right.length && left.every((value, index) => value === right[index]);
}

function gridKey(col, row) {
    return `${col},${row}`;
}

function macroGridKey(col, row) {
    return `${col},${row}`;
}

function firstDefined(...values) {
    return values.find((value) => value !== undefined && value !== null);
}

function iterableValues(value, fallback = []) {
    return value !== null && value !== undefined && typeof value[Symbol.iterator] === 'function'
        ? [...value]
        : [...fallback];
}

function uniqueSortedNumbers(values) {
    return [...new Set(values.map(Number).filter(Number.isFinite))].sort((left, right) => left - right);
}

function medianInteger(values, fallback = 0) {
    const sorted = values.map(Number).filter(Number.isFinite).sort((left, right) => left - right);
    if (!sorted.length) return finiteInteger(fallback, 0);
    const middle = Math.floor(sorted.length / 2);
    const median = sorted.length % 2 === 0
        ? (sorted[middle - 1] + sorted[middle]) / 2
        : sorted[middle];
    return Math.round(median);
}

function hashUnit(value) {
    return hashString(value) / 4294967296;
}

function hashStringHex(value) {
    return hashString(value).toString(16).padStart(8, '0');
}

function hashString(value) {
    let hash = 2166136261;
    const text = String(value);
    for (let index = 0; index < text.length; index++) {
        hash ^= text.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
}

function finiteNumber(value, fallback) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
}

function finiteInteger(value, fallback) {
    return Math.round(finiteNumber(value, fallback));
}

function optionalFiniteInteger(value, fallback) {
    return value === null || value === undefined ? Math.round(fallback) : finiteInteger(value, fallback);
}

function clampNumber(value, minimum, maximum) {
    return Math.min(maximum, Math.max(minimum, value));
}

for (const tile of TERRAIN_MACRO_TILES) validateTerrainMacroTile(tile, { throwOnError: true });
