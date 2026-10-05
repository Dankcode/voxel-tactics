import { ACTIVE_GEOGRAPHY, ACTIVE_SETTLEMENT_BLUEPRINTS, ACTIVE_WORLD } from './ActiveWorldData.js';
import {
    hashWaveSeed,
    solveWaveFunctionCollapse,
    WaveFunctionCollapseError
} from './WaveFunctionCollapse.js';
import {
    GEOGRAPHIC_TILES,
    GEOGRAPHIC_TILE_BY_ID,
    getBiomeName,
    getTerrainDomain,
    getTerrainWeight,
    terrainWaveCompatible
} from './WorldTileSet.js';
import { planTownWave } from './TownWavePlanner.js';
import {
    createSettlementConstraintAnchors,
    createBlueprintSkeleton,
    createWorldConstraintField,
    FMG_BURG_RELIEF_FORMULA_VERSION,
    getSettlementWardAt,
    isInsideWallBounds
} from './WorldConstraintField.js';
import {
    CONTEXTUAL_WFC_MODULES,
    solveContextualBuildingWFC
} from './ContextualBuildingWFC.js';
import {
    createBakedBuildingPlan,
    createFixedBakedBuilding,
    analyzeBuildingFootprintElevation,
    validateBakedBuilding
} from './BakedBuildingLibrary.js';
import { BAKED_PARTIAL_CHUNKS } from './BakedChunkData.js';
import {
    ENVIRONMENT_DESIGN_HASH,
    getCaveDefinitions,
    getEnvironmentProfile,
    resolveEnvironmentId,
    resolveRegionalResource
} from './EnvironmentProfiles.js';
import {
    getPartialChunkCell,
    validatePartialChunkRegistry
} from './PartialChunkRegistry.js';
import {
    getActiveTownVectorHash,
    getActiveTownVectorSummary
} from './TownVectorData.js';
import {
    getBurgTheme,
    normalizeBurgThemeId,
    resolveBurgThemeBuildingStyle
} from './BurgThemeCatalog.js';
import {
    TERRAIN_MACRO_TILE_LIBRARY_VERSION,
    TERRAIN_PRIMARY_MACRO_SIZE,
    TERRAIN_TRANSITION_MACRO_SIZE,
    applyTerrainMacroTileToElevationRows,
    collapseTerrainMacroTileGrid,
    createDeterministicTerrainMacroPatch,
    findIsolatedElevationSpikes
} from './TerrainMacroTileLibrary.js';
import {
    WORLD_PATH_CONNECTIVITY_VERSION,
    getWorldPathConnectivityGenerationMetadata,
    validateWorldPathConnectivity
} from './WorldPathConnectivity.js';
import {
    WFC_NOISE_MASK_VERSION,
    getEnvironmentFacies,
    getTerrainNoiseWeightMultiplier,
    sampleWfcNoiseMask,
    summarizeWfcNoiseMask
} from './WfcNoiseMask.js';

// Compact view window (was 80x60): ~19% fewer generated columns per view, directly cutting the
// tile/mesh count that made LOD heavy. The smaller window pairs with steeper elevation macro
// scaling below so views feel dense and vertical instead of wide and flat. (64x48 was probed but
// triggers a pathological clipped-settlement solve at burg-9 — do not shrink further without
// profiling that case.)
export const GEOGRAPHIC_WORLD_VIEW_WIDTH = 72;
export const GEOGRAPHIC_WORLD_VIEW_HEIGHT = 54;
export const WORLD_SAMPLE_SCALE = 0.64;
export const TERRAIN_WFC_CHUNK_SIZE = 8;
const TERRAIN_WFC_HALO_CHUNKS = 1;

const PARTIAL_CHUNK_REGISTRY_STATUS = validatePartialChunkRegistry(BAKED_PARTIAL_CHUNKS, {
    generationVersion: ACTIVE_WORLD.generationVersion,
    worldContentHash: ACTIVE_WORLD.contentHash,
    sampleScale: WORLD_SAMPLE_SCALE,
    chunkSize: TERRAIN_WFC_CHUNK_SIZE,
    allowedTileIds: new Set(GEOGRAPHIC_TILES.map((tile) => tile.id))
});
const ACTIVE_PARTIAL_CHUNK_REGISTRY = PARTIAL_CHUNK_REGISTRY_STATUS.compatible
    ? BAKED_PARTIAL_CHUNKS
    : null;

const CELL_BUCKET_SIZE = 18;
const PATH_BUCKET_SIZE = 12;
const MAX_DECORATIONS = 150;
const SETTLEMENT_ARCHETYPES = Object.freeze({
    cottage: Object.freeze({ weight: 2.2, minSpan: 3, maxSpan: 7 }),
    townhouse: Object.freeze({ weight: 1.7, minSpan: 4, maxSpan: 9 }),
    workshop: Object.freeze({ weight: 1.15, minSpan: 4, maxSpan: 9 }),
    bayfront: Object.freeze({ weight: 0.9, minSpan: 4, maxSpan: 9 }),
    hall: Object.freeze({ weight: 0.55, minSpan: 5, maxSpan: 11 }),
    manor: Object.freeze({ weight: 0.42, minSpan: 6, maxSpan: 12 }),
    tower: Object.freeze({ weight: 0.36, minSpan: 4, maxSpan: 7 })
});
const LANDMARK_ARCHETYPES = new Set(['hall', 'manor', 'tower']);
const CARDINALS = Object.freeze([
    Object.freeze({ x: 1, y: 0, name: 'east' }),
    Object.freeze({ x: -1, y: 0, name: 'west' }),
    Object.freeze({ x: 0, y: 1, name: 'south' }),
    Object.freeze({ x: 0, y: -1, name: 'north' })
]);
const WORLD_ROAD_SYMBOLS = new Set(['R', ':', ';', '=', '1', '2', '3', '4']);
const STAIR_SYMBOL_BY_DIRECTION = Object.freeze({
    north: '1',
    south: '2',
    west: '3',
    east: '4'
});

let geographyIndex = null;

export function createGeographicWorldPlan({
    worldX,
    worldY,
    width = GEOGRAPHIC_WORLD_VIEW_WIDTH,
    height = GEOGRAPHIC_WORLD_VIEW_HEIGHT,
    variant = 0,
    includeTerrainSnapshot = false,
    useBakedPartialChunks = true
} = {}) {
    const safeWidth = clampInteger(width, 32, 112);
    const safeHeight = clampInteger(height, 24, 84);
    const centerX = clampNumber(worldX, 0, ACTIVE_WORLD.width, ACTIVE_WORLD.width / 2);
    const centerY = clampNumber(worldY, 0, ACTIVE_WORLD.height, ACTIVE_WORLD.height / 2);
    // Every view samples the same world-anchored lattice. Without this snap, two overlapping
    // views centered a fraction of a tile apart would address different cells and could shift a
    // partial baked core. The requested center is still retained for map/UI navigation below.
    const sampleCenterX = snapWorldSampleCoordinate(centerX);
    const sampleCenterY = snapWorldSampleCoordinate(centerY);
    const safeVariant = Math.max(0, Math.floor(Number(variant) || 0));
    // Variant randomness is world-anchored. A center-dependent seed made every overlapping
    // viewport a different universe even when both addressed the same global sample cells.
    const seed = hashWaveSeed(`${ACTIVE_WORLD.seed}:variant:${safeVariant}`);
    const viewSeed = hashWaveSeed(
        `${seed}:view:${round(sampleCenterX, 3)}:${round(sampleCenterY, 3)}`
    );
    const index = getGeographyIndex();
    const fields = sampleRegionFields(index, {
        centerX: sampleCenterX,
        centerY: sampleCenterY,
        width: safeWidth,
        height: safeHeight,
        seed
    });
    const rawSettlementAnchors = createSettlementConstraintAnchors({
        blueprints: ACTIVE_SETTLEMENT_BLUEPRINTS,
        burgs: index.burgs,
        centerX: sampleCenterX,
        centerY: sampleCenterY,
        width: safeWidth,
        height: safeHeight,
        sampleScale: WORLD_SAMPLE_SCALE
    });
    // Blueprint anchors, wall rings and roads are parser-authored fixed nodes. They deliberately
    // bypass the old variant-dependent inland stabilization pass.
    const settlementAnchors = rawSettlementAnchors;
    const fixedSkeleton = createBlueprintSkeleton({
        settlements: settlementAnchors,
        fields,
        width: safeWidth,
        height: safeHeight,
        sampleScale: WORLD_SAMPLE_SCALE
    });
    const constraints = createWorldConstraintField({
        fields,
        width: safeWidth,
        height: safeHeight,
        settlements: settlementAnchors,
        skeleton: fixedSkeleton
    });
    const noiseMaskDiagnostics = summarizeWfcNoiseMask(fields);
    // Terrain is solved in a canonical chunk-aligned halo, then cropped. Full global chunks and
    // the extra seam margin mean the same sample cell sees the same WFC graph even when it sits
    // on two different viewport edges.
    const terrainFrame = createTerrainGenerationFrame({
        index,
        centerX: sampleCenterX,
        centerY: sampleCenterY,
        width: safeWidth,
        height: safeHeight,
        seed
    });
    const frameCollapse = collapseTerrain(
        terrainFrame.fields,
        terrainFrame.width,
        terrainFrame.height,
        seed,
        terrainFrame.constraints,
        useBakedPartialChunks
    );
    const frameElevationRows = createElevationRows(
        terrainFrame.fields,
        frameCollapse.tileIds,
        terrainFrame.width,
        terrainFrame.height,
        seed,
        terrainFrame.constraints,
        frameCollapse.bakedCellIds
    );
    const initialTerrainMacroDiagnostics = frameElevationRows.macroDiagnostics;
    const frameMacroTerrainElevationRows = frameElevationRows.map((row) => row.slice());
    // Natural water and route overlays are resolved inside the same canonical halo as terrain
    // collapse. Applying them only after cropping made river elevations depend on which side of
    // a viewport boundary happened to be visible, so overlapping clients could disagree about
    // the same global cell.
    const frameRows = createTerrainRows(
        frameCollapse.tileIds,
        terrainFrame.width,
        terrainFrame.height
    );
    const framePaletteRows = createPaletteRows(
        frameCollapse.tileIds,
        terrainFrame.fields,
        terrainFrame.width,
        terrainFrame.height,
        terrainFrame.constraints
    );
    overlayGeographicWaterAndRoutes(
        frameRows,
        framePaletteRows,
        frameElevationRows,
        terrainFrame.fields,
        terrainFrame.width,
        terrainFrame.height,
        terrainFrame.constraints
    );
    const collapse = cropTerrainCollapse(
        frameCollapse,
        terrainFrame,
        safeWidth,
        safeHeight,
        constraints,
        fields,
        useBakedPartialChunks
    );
    const elevationRows = cropTerrainRows(frameElevationRows, terrainFrame, safeWidth, safeHeight);
    const macroTerrainElevationRows = cropTerrainRows(
        frameMacroTerrainElevationRows,
        terrainFrame,
        safeWidth,
        safeHeight
    );
    const rows = cropTerrainRows(frameRows, terrainFrame, safeWidth, safeHeight);
    const paletteRows = cropTerrainRows(framePaletteRows, terrainFrame, safeWidth, safeHeight);
    repairCroppedFmgRiverContinuity({
        rows,
        paletteRows,
        elevationRows,
        fields,
        width: safeWidth,
        height: safeHeight,
        constraintField: constraints
    });
    const settlement = synthesizeSettlements({
        rows,
        paletteRows,
        elevationRows,
        fields,
        centerX: sampleCenterX,
        centerY: sampleCenterY,
        width: safeWidth,
        height: safeHeight,
        seed,
        variant: safeVariant,
        index,
        anchors: settlementAnchors,
        constraintField: constraints,
        skeleton: fixedSkeleton
    });
    const buildingInfrastructureAnchors = prepareBuildingInfrastructureAnchors({
        rows,
        paletteRows,
        buildings: settlement.buildings,
        fields,
        width: safeWidth,
        height: safeHeight
    });
    enforceRequestedVectorElevations(rows, elevationRows, fixedSkeleton, settlement.buildings);
    repairCroppedFmgRiverContinuity({
        rows,
        paletteRows,
        elevationRows,
        fields,
        width: safeWidth,
        height: safeHeight,
        constraintField: constraints,
        buildings: settlement.buildings
    });
    const roadNetworkRepair = connectWorldRoadNetwork({
        rows,
        paletteRows,
        buildings: settlement.buildings,
        fields,
        width: safeWidth,
        height: safeHeight
    });
    stabilizeWorldInfrastructureElevations({
        rows,
        elevationRows,
        macroTerrainElevationRows,
        fields,
        skeleton: fixedSkeleton,
        buildings: settlement.buildings,
        width: safeWidth,
        height: safeHeight
    });
    const finalElevationRepair = repairFinalWorldElevationSpikes({
        rows,
        elevationRows,
        buildings: settlement.buildings,
        width: safeWidth,
        height: safeHeight
    });
    const finalBuildingFootprints = collectBuildingFootprintKeys(
        settlement.buildings,
        safeWidth,
        safeHeight
    );
    const finalElevationSpikes = findIsolatedElevationSpikes(elevationRows).filter((cell) =>
        !finalBuildingFootprints.has(elevationCellKey(cell.col, cell.row)));
    const terrainMacroDiagnostics = Object.freeze({
        ...initialTerrainMacroDiagnostics,
        finalRepairedCells: finalElevationRepair.repairedCells,
        finalRepairedBySymbol: finalElevationRepair.repairedBySymbol,
        isolatedElevationCells: finalElevationSpikes.length,
        isolatedElevationSamples: Object.freeze(finalElevationSpikes.slice(0, 12))
    });
    const architectureThemeRows = createArchitectureThemeRows({
        rows,
        buildings: settlement.buildings,
        settlements: settlement.settlements,
        skeleton: fixedSkeleton,
        width: safeWidth,
        height: safeHeight
    });
    const decorations = synthesizeDecorations({
        rows,
        paletteRows,
        elevationRows,
        fields,
        buildings: settlement.buildings,
        settlements: settlement.settlements,
        skeleton: fixedSkeleton,
        constraintField: constraints,
        seed,
        width: safeWidth,
        height: safeHeight
    });
    const environmentDiagnostics = summarizeViewEnvironments(fields, decorations);
    const visualVariantRows = createVisualVariantRows({
        rows,
        paletteRows,
        seed,
        centerX: sampleCenterX,
        centerY: sampleCenterY,
        width: safeWidth,
        height: safeHeight
    });
    const wallHeightRows = createBlueprintWallHeightRows(fixedSkeleton, safeWidth, safeHeight);
    const dominantBiome = getDominantBiome(fields);
    const dominantPalette = getDominantPalette(paletteRows, rows);
    const nearestBurg = findNearestBurg(index, sampleCenterX, sampleCenterY);
    const regionName = getRegionName(nearestBurg, dominantBiome, sampleCenterX, sampleCenterY);
    const stateColor = index.stateById.get(dominantBiome.state)?.color || '#65d58d';
    const cultureColor = index.cultureById.get(dominantBiome.culture)?.color || '#7d76e8';
    const activeTownVectorHash = getActiveTownVectorHash();
    const contentHash = [
        ACTIVE_WORLD.contentHash,
        activeTownVectorHash,
        TERRAIN_MACRO_TILE_LIBRARY_VERSION,
        WFC_NOISE_MASK_VERSION,
        ENVIRONMENT_DESIGN_HASH.slice(0, 12),
        terrainMacroDiagnostics?.assignmentHash || 'no-macro-plan',
        viewSeed.toString(16).padStart(8, '0')
    ].join(':');
    const sourceAnchor = nearestBurg && nearestBurg.distance <= Math.max(safeWidth, safeHeight) * WORLD_SAMPLE_SCALE * 0.58
        ? nearestBurg.burg
        : null;
    const primaryArchitectureThemeId = normalizeBurgThemeId(
        sourceAnchor?.themeId ??
        settlement.settlements[0]?.architectureThemeId ??
        settlement.settlements[0]?.burg?.themeId ??
        settlementAnchors[0]?.architectureThemeId ??
        settlementAnchors[0]?.burg?.themeId,
        null
    );
    const primaryArchitectureTheme = getBurgTheme(primaryArchitectureThemeId);
    const elevationDiagnostics = createWorldElevationDiagnostics({
        rows,
        elevationRows,
        settlements: settlement.settlements,
        buildings: settlement.buildings,
        skeleton: fixedSkeleton,
        terrainMacroDiagnostics
    });
    const logicalConnectivity = createWorldLogicalConnectivity({
        rows,
        elevationRows,
        fields,
        skeleton: fixedSkeleton,
        settlements: settlement.settlements,
        buildings: settlement.buildings,
        width: safeWidth,
        height: safeHeight
    });
    const waterFlowRows = createWaterFlowRows(fields, safeWidth, safeHeight);

    const plan = {
        rows,
        elevationRows,
        wallHeightRows,
        paletteRows,
        architectureThemeRows,
        visualVariantRows,
        waterFlowRows,
        // Pre-overlay terrain snapshot for the partial-chunk bake tool: the raw collapsed tile ids
        // (no water/route overlay, no settlement stamping) so baked cells can be re-fixed into the
        // terrain WFC without freezing structure symbols as terrain.
        terrainTileIds: includeTerrainSnapshot ? collapse.tileIds.slice() : undefined,
        buildings: settlement.buildings,
        decorations,
        resources: decorations.filter((decoration) => decoration.type === 'resource_node'),
        caveEntrances: decorations.filter((decoration) => decoration.type === 'cave_mouth'),
        logicalConnectivity,
        connectDoors: false,
        procedural: true,
        width: safeWidth,
        height: safeHeight,
        center: { x: Math.floor(safeWidth / 2), y: Math.floor(safeHeight / 2) },
        townName: regionName,
        seed,
        variant: safeVariant,
        generationVersion: ACTIVE_WORLD.generationVersion,
        contentHash,
        townVectorSchemaVersion: getActiveTownVectorSummary().schemaVersion,
        townVectorHash: activeTownVectorHash,
        sourceTown: {
            id: sourceAnchor ? `burg-${sourceAnchor.id}` : `region-${Math.round(centerX)}-${Math.round(centerY)}`,
            name: regionName,
            biome: dominantBiome.name,
            architectureThemeId: primaryArchitectureThemeId,
            architectureThemeLabel: primaryArchitectureTheme?.label ?? null,
            generated: true,
            requestedWorldX: centerX,
            requestedWorldY: centerY,
            stats: {
                buildings: settlement.buildings.length,
                bakedBuildings: settlement.diagnostics.bakedBuildings,
                decorations: decorations.length,
                wfcChunks: collapse.diagnostics.chunks,
                wfcFallbacks: collapse.diagnostics.fallbacks
            }
        },
        theme: {
            id: dominantPalette,
            paletteId: dominantPalette,
            biome: dominantBiome.name,
            primaryArchitectureThemeId,
            primaryArchitectureThemeLabel: primaryArchitectureTheme?.label ?? null,
            stateColor,
            cultureColor,
            skyColor: getThemeSkyColor(dominantPalette),
            fogColor: getThemeFogColor(dominantPalette)
        },
        world: {
            id: ACTIVE_WORLD.id,
            name: ACTIVE_WORLD.name,
            seed: ACTIVE_WORLD.seed,
            variant: safeVariant,
            variantSeed: seed,
            generationVersion: ACTIVE_WORLD.generationVersion,
            contentHash,
            townVectorSchemaVersion: getActiveTownVectorSummary().schemaVersion,
            townVectorHash: activeTownVectorHash,
            centerX,
            centerY,
            sampleCenterX,
            sampleCenterY,
            originX: sampleCenterX - safeWidth * WORLD_SAMPLE_SCALE / 2,
            originY: sampleCenterY - safeHeight * WORLD_SAMPLE_SCALE / 2,
            locations: settlement.settlements.map((entry) => `burg-${entry.burg.id}`),
            source: ACTIVE_WORLD.source,
            image: ACTIVE_WORLD.image,
            sampleScale: WORLD_SAMPLE_SCALE
        },
        generation: {
            mode: 'blueprint-first-geographic-wfc',
            macroReference: 'offline FMG settlement blueprints + compact burg vectors + global cell graph',
            townPayloadsRead: false,
            townVectors: getActiveTownVectorSummary(),
            terrainWfc: collapse.diagnostics,
            terrainMacroWfc: terrainMacroDiagnostics,
            partialBake: collapse.diagnostics.partialBake,
            buildingWfc: settlement.diagnostics,
            constraintField: constraints.diagnostics,
            noiseMask: noiseMaskDiagnostics,
            environments: environmentDiagnostics,
            elevation: elevationDiagnostics,
            buildingInfrastructureAnchors,
            roadNetworkRepair,
            settlements: settlement.settlements.length,
            coupledTerrainAndBuildings: true,
            couplingMode: 'shared-constraint-sequential-wfc',
            placementOrder: Object.freeze([
                'fmg-water',
                'fmg-roads-and-gates',
                'fmg-building-plots',
                'static-noise-mask-priors',
                'terrain-wfc-fill',
                'building-wfc-materialization',
                'road-network-completion'
            ]),
            worldAnchoredChunks: true,
            worldAnchoredMacroTiles: true,
            minimumInterior: '2x3',
            blueprintFirst: true,
            activeClusterId: settlementAnchors[0]?.clusterId ?? null,
            fixedSkeletonHash: fixedSkeleton.hash,
            fixedSkeleton: fixedSkeleton.diagnostics,
            vectorStreets: Object.freeze({
                cells: fixedSkeleton.diagnostics.vectorStreetCells || 0,
                fixedElevationCells: fixedSkeleton.diagnostics.vectorStreetElevationCells || 0,
                elevationTiers: Object.freeze([
                    ...(fixedSkeleton.diagnostics.vectorStreetElevationTiers || [])
                ]),
                streetMapCells: fixedSkeleton.diagnostics.streetMapCells || 0,
                streetMapModules: Object.freeze({
                    ...(fixedSkeleton.diagnostics.streetMapModules || {})
                }),
                utilityCells: fixedSkeleton.diagnostics.streetMapUtilityCells || 0,
                utilityModules: Object.freeze({
                    ...(fixedSkeleton.diagnostics.streetMapUtilityModules || {})
                }),
                utilityDecorations: decorations.filter((decoration) => decoration.moduleUtility === true).length,
                steppedStreetCells: fixedSkeleton.diagnostics.streetMapSteppedCells || 0,
                generatedElevationRange: fixedSkeleton.diagnostics.streetMapElevationRange || 0,
                reliefFormulaVersion: FMG_BURG_RELIEF_FORMULA_VERSION
            }),
            architectureThemes: Object.freeze({
                primary: primaryArchitectureThemeId,
                bySettlement: Object.freeze(Object.fromEntries(
                    settlementAnchors.map((entry) => [
                        `burg-${entry.burg.id}`,
                        normalizeBurgThemeId(entry.architectureThemeId ?? entry.burg?.themeId, null)
                    ])
                )),
                histogram: Object.freeze(createArchitectureThemeHistogram(settlementAnchors))
            })
        }
    };
    const pathConnectivity = validateWorldPathConnectivity(plan);
    plan.generation.pathConnectivity = getWorldPathConnectivityGenerationMetadata(pathConnectivity);
    plan.generation.pathConnectivityIssues = pathConnectivity.issues.slice(0, 24);
    return plan;
}

function createBlueprintWallHeightRows(skeleton, width, height) {
    const rows = Array.from({ length: height }, () => Array(width).fill(0));
    for (const cell of skeleton?.cells?.values?.() || []) {
        if (cell.kind !== 'wall' || rows[cell.row]?.[cell.col] === undefined) continue;
        rows[cell.row][cell.col] = clampInteger(cell.heightVoxels ?? 4, 3, 9);
    }
    return rows;
}

function createWorldElevationDiagnostics({
    rows,
    elevationRows,
    settlements,
    buildings,
    skeleton,
    terrainMacroDiagnostics = null
}) {
    const tiers = elevationRows.flat().map(Number).filter(Number.isFinite);
    const buildingTiers = (buildings || [])
        .map((building) => Number(building.baseElevation))
        .filter(Number.isFinite);
    const sourceElevationCells = [...(skeleton?.cells?.values?.() || [])].filter((cell) =>
        (cell.source === 'town-vector' || cell.elevationSource === 'town-vector') &&
        Number.isFinite(Number(cell.elevationTier)));
    const sourceElevationMismatches = sourceElevationCells.filter((cell) =>
        Number(elevationRows[cell.row]?.[cell.col]) !== Number(cell.elevationTier));
    const sourceElevationDeviations = sourceElevationCells.map((cell) => Math.abs(
        Number(elevationRows[cell.row]?.[cell.col]) - Number(cell.elevationTier)
    )).filter(Number.isFinite);
    const settlementProfiles = [...(skeleton?.reliefByBurgId?.values?.() || [])]
        .sort((left, right) => left.burgId - right.burgId);
    const width = elevationRows[0]?.length || 0;
    const height = elevationRows.length;
    const buildingElevationSafety = (buildings || []).map((building) => {
        const originCol = Number(building.x) + Math.floor(width / 2);
        const originRow = Number(building.y) + Math.floor(height / 2);
        const footprint = (building.footprintCells || []).map((cell) => ({
            col: originCol + cell.x,
            row: originRow + cell.y
        }));
        return analyzeBuildingFootprintElevation(footprint, elevationRows);
    });
    const illegalBuildingCliffs = buildingElevationSafety.filter((safety) =>
        safety.maxAdjacentDelta > 1 || safety.span > 1);
    const roadElevationSafety = analyzeRoadElevationSafety(rows, elevationRows, buildings);
    return Object.freeze({
        formulaVersion: FMG_BURG_RELIEF_FORMULA_VERSION,
        terrainTierMinimum: tiers.length ? Math.min(...tiers) : 0,
        terrainTierMaximum: tiers.length ? Math.max(...tiers) : 0,
        terrainTierRange: tiers.length ? Math.max(...tiers) - Math.min(...tiers) : 0,
        settlementProfiles: Object.freeze(settlementProfiles),
        highReliefSettlements: settlementProfiles.filter((profile) => profile.reliefClass === 'high').length,
        meanReliefScore: settlementProfiles.length
            ? round(settlementProfiles.reduce((sum, profile) => sum + profile.reliefScore, 0) / settlementProfiles.length, 4)
            : 0,
        vectorElevationCells: sourceElevationCells.length,
        vectorElevationMismatches: sourceElevationMismatches.length,
        exactVectorElevationsPreserved: sourceElevationMismatches.length === 0,
        vectorElevationMode: 'soft-macro-inhibitor',
        vectorElevationConstraintsApplied: sourceElevationCells.length > 0,
        vectorElevationMeanDeviation: sourceElevationDeviations.length
            ? round(sourceElevationDeviations.reduce((sum, value) => sum + value, 0) /
                sourceElevationDeviations.length, 4)
            : 0,
        vectorElevationMaximumDeviation: sourceElevationDeviations.length
            ? Math.max(...sourceElevationDeviations)
            : 0,
        steppedStreetCells: skeleton?.diagnostics?.streetMapSteppedCells || 0,
        generatedStreetElevationRange: skeleton?.diagnostics?.streetMapElevationRange || 0,
        macroTiles: terrainMacroDiagnostics,
        buildingBaseElevationMinimum: buildingTiers.length ? Math.min(...buildingTiers) : null,
        buildingBaseElevationMaximum: buildingTiers.length ? Math.max(...buildingTiers) : null,
        buildingBaseElevationTiers: Object.freeze([...new Set(buildingTiers)].sort((left, right) => left - right)),
        illegalBuildingCliffs: illegalBuildingCliffs.length,
        maximumBuildingElevationSpan: buildingElevationSafety.length
            ? Math.max(...buildingElevationSafety.map((safety) => safety.span))
            : 0,
        illegalRoadCliffs: roadElevationSafety.illegalEdges,
        maximumRoadElevationDelta: roadElevationSafety.maximumDelta
    });
}

function analyzeRoadElevationSafety(rows, elevationRows, buildings = []) {
    const roadSymbols = WORLD_ROAD_SYMBOLS;
    const footprintKeys = collectBuildingFootprintKeys(
        buildings,
        rows[0]?.length || 0,
        rows.length
    );
    let illegalEdges = 0;
    let maximumDelta = 0;
    for (let row = 0; row < rows.length; row++) {
        for (let col = 0; col < (rows[row]?.length || 0); col++) {
            if (!roadSymbols.has(rows[row]?.[col]) ||
                footprintKeys.has(elevationCellKey(col, row))) continue;
            for (const [dx, dy] of [[1, 0], [0, 1], [1, 1], [-1, 1]]) {
                const neighborCol = col + dx;
                const neighborRow = row + dy;
                if (!roadSymbols.has(rows[neighborRow]?.[neighborCol]) ||
                    footprintKeys.has(elevationCellKey(neighborCol, neighborRow))) continue;
                const delta = Math.abs(
                    Number(elevationRows[row]?.[col]) - Number(elevationRows[neighborRow]?.[neighborCol])
                );
                if (!Number.isFinite(delta)) continue;
                maximumDelta = Math.max(maximumDelta, delta);
                if (delta > 1) illegalEdges++;
            }
        }
    }
    return Object.freeze({ illegalEdges, maximumDelta });
}

function createWorldLogicalConnectivity({
    rows,
    elevationRows,
    fields,
    skeleton,
    settlements,
    buildings,
    width,
    height
}) {
    const waterSymbols = new Set(['W', '~', 'B']);
    const riverCellsBySourceId = new Map();
    for (let row = 0; row < height; row++) {
        for (let col = 0; col < width; col++) {
            const id = row * width + col;
            const field = fields[id];
            if (!waterSymbols.has(rows[row]?.[col]) || field?.riverId === null ||
                field?.riverId === undefined || Number(field.riverPathInfluence) < 0.35) continue;
            const sourceId = String(field.riverId);
            if (!riverCellsBySourceId.has(sourceId)) riverCellsBySourceId.set(sourceId, new Map());
            riverCellsBySourceId.get(sourceId).set(elevationCellKey(col, row), {
                col,
                row,
                fmgRiverId: sourceId
            });
        }
    }
    // FMG identity is the river-system authority. Splitting the visible water first made every
    // disconnected fragment look like a separate valid river; grouping by source id exposes
    // actual sampling gaps and lets the validator reject them.
    const rivers = [...riverCellsBySourceId.entries()]
        .sort(([left], [right]) => left.localeCompare(right, undefined, { numeric: true }))
        .map(([sourceId, cells]) => {
            const components = splitLogicalCellComponents(cells);
            const connectors = [];
            for (const bridge of skeleton?.cells?.values?.() || []) {
                if (bridge.kind !== 'bridge') continue;
                for (const [[leftX, leftY], [rightX, rightY]] of [
                    [[-1, 0], [1, 0]],
                    [[0, -1], [0, 1]]
                ]) {
                    const left = { col: bridge.col + leftX, row: bridge.row + leftY };
                    const right = { col: bridge.col + rightX, row: bridge.row + rightY };
                    if (!cells.has(elevationCellKey(left.col, left.row)) ||
                        !cells.has(elevationCellKey(right.col, right.row))) continue;
                    connectors.push({
                        id: `fmg-river-${sourceId}-bridge-${bridge.col}-${bridge.row}`,
                        kind: 'bridge-underpass',
                        allowNonWater: true,
                        cells: [left, { col: bridge.col, row: bridge.row }, right]
                    });
                    break;
                }
            }
            const riverComponentByKey = new Map();
            components.forEach((component, componentIndex) => {
                for (const cell of component) {
                    riverComponentByKey.set(elevationCellKey(cell.col, cell.row), componentIndex);
                }
            });
            const generatedBridgeDeckCells = new Map();
            for (let row = 0; row < height; row++) {
                for (let col = 0; col < width; col++) {
                    const id = row * width + col;
                    if (!WORLD_ROAD_SYMBOLS.has(rows[row]?.[col]) ||
                        String(fields[id]?.riverId) !== sourceId ||
                        Number(fields[id]?.riverPathInfluence) < 0.35) continue;
                    generatedBridgeDeckCells.set(elevationCellKey(col, row), { col, row });
                }
            }
            for (const [deckIndex, deck] of splitLogicalCellComponents(generatedBridgeDeckCells).entries()) {
                const deckKeys = new Set(deck.map((cell) => elevationCellKey(cell.col, cell.row)));
                const attachments = [];
                for (const deckCell of deck) {
                    for (const { x, y } of CARDINALS) {
                        const water = { col: deckCell.col + x, row: deckCell.row + y };
                        const waterKey = elevationCellKey(water.col, water.row);
                        if (!cells.has(waterKey) || !riverComponentByKey.has(waterKey)) continue;
                        attachments.push({
                            water,
                            deckCell,
                            componentIndex: riverComponentByKey.get(waterKey)
                        });
                    }
                }
                let pair = null;
                for (let leftIndex = 0; leftIndex < attachments.length && !pair; leftIndex++) {
                    for (let rightIndex = leftIndex + 1; rightIndex < attachments.length; rightIndex++) {
                        if (attachments[leftIndex].componentIndex === attachments[rightIndex].componentIndex) continue;
                        pair = [attachments[leftIndex], attachments[rightIndex]];
                        break;
                    }
                }
                if (!pair) continue;
                const deckPath = findCardinalPathWithinKeys(
                    pair[0].deckCell,
                    pair[1].deckCell,
                    deckKeys
                );
                if (!deckPath) continue;
                connectors.push({
                    id: `fmg-river-${sourceId}-generated-bridge-${deckIndex}`,
                    kind: 'bridge-underpass',
                    allowNonWater: true,
                    cells: [pair[0].water, ...deckPath, pair[1].water]
                });
            }
            const boundaryComponentIndex = components.findIndex((component) =>
                component.some((cell) => cell.col <= 2 || cell.row <= 2 ||
                    cell.col >= width - 3 || cell.row >= height - 3));
            if (boundaryComponentIndex >= 0 && components.length > 1) {
                const boundaryComponent = components[boundaryComponentIndex];
                for (let componentIndex = 0; componentIndex < components.length; componentIndex++) {
                    if (componentIndex === boundaryComponentIndex) continue;
                    const pair = findClosestLogicalComponentPair([
                        boundaryComponent,
                        components[componentIndex]
                    ]);
                    if (!pair) continue;
                    // The FMG polyline leaves this LOD and re-enters it. A virtual connector
                    // records the offscreen continuation without painting a fake chord across
                    // the visible world.
                    connectors.push({
                        id: `fmg-river-${sourceId}-offscreen-${componentIndex}`,
                        virtual: true,
                        cells: [
                            { col: pair.left.col, row: pair.left.row },
                            { col: pair.right.col, row: pair.right.row }
                        ]
                    });
                }
            }
            // Finish the declared FMG river graph after visible bridges and boundary continuations
            // are known. A remaining split of one source river means its short middle section is
            // hidden beneath a wall/building or outside the sampled LOD; encode that continuation
            // explicitly instead of pretending the two pieces are unrelated rivers.
            const componentParents = components.map((_, index) => index);
            const findComponentRoot = (index) => {
                let root = index;
                while (componentParents[root] !== root) root = componentParents[root];
                while (componentParents[index] !== index) {
                    const next = componentParents[index];
                    componentParents[index] = root;
                    index = next;
                }
                return root;
            };
            const unionComponents = (left, right) => {
                const leftRoot = findComponentRoot(left);
                const rightRoot = findComponentRoot(right);
                if (leftRoot !== rightRoot) componentParents[rightRoot] = leftRoot;
            };
            for (const connector of connectors) {
                const first = connector.cells?.[0];
                const last = connector.cells?.at?.(-1);
                const firstIndex = first
                    ? riverComponentByKey.get(elevationCellKey(first.col, first.row))
                    : null;
                const lastIndex = last
                    ? riverComponentByKey.get(elevationCellKey(last.col, last.row))
                    : null;
                if (Number.isInteger(firstIndex) && Number.isInteger(lastIndex)) {
                    unionComponents(firstIndex, lastIndex);
                }
            }
            let inferredContinuationIndex = 0;
            while (new Set(components.map((_, index) => findComponentRoot(index))).size > 1) {
                let closest = null;
                for (let leftIndex = 0; leftIndex < components.length; leftIndex++) {
                    for (let rightIndex = leftIndex + 1; rightIndex < components.length; rightIndex++) {
                        if (findComponentRoot(leftIndex) === findComponentRoot(rightIndex)) continue;
                        const pair = findClosestLogicalComponentPair([
                            components[leftIndex],
                            components[rightIndex]
                        ]);
                        if (!pair || (closest && pair.distance >= closest.pair.distance)) continue;
                        closest = { leftIndex, rightIndex, pair };
                    }
                }
                if (!closest) break;
                connectors.push({
                    id: `fmg-river-${sourceId}-inferred-continuation-${inferredContinuationIndex++}`,
                    kind: 'urban-culvert-or-lod-continuation',
                    virtual: true,
                    allowNonWater: true,
                    cells: [
                        { col: closest.pair.left.col, row: closest.pair.left.row },
                        { col: closest.pair.right.col, row: closest.pair.right.row }
                    ]
                });
                unionComponents(closest.leftIndex, closest.rightIndex);
            }
            return {
                id: `fmg-river-${sourceId}`,
                fmgRiverIds: [sourceId],
                components: components.map((component, componentIndex) => ({
                    id: `fmg-river-${sourceId}:component-${componentIndex}`,
                    cells: component.map(({ col, row }) => ({ col, row }))
                })),
                connectors
            };
        });

    const settlementByTownId = new Map((settlements || []).map((settlement) => [
        Number(settlement.burg?.id),
        settlement
    ]));
    const gates = deriveLogicalGates({ rows, skeleton, settlementByTownId, width, height });
    const requiredPaths = deriveBuildingGateRequiredPaths({
        buildings,
        gates,
        settlements,
        width,
        height
    });
    return Object.freeze({
        version: WORLD_PATH_CONNECTIVITY_VERSION,
        rivers: Object.freeze(rivers),
        gates: Object.freeze(gates),
        movementConnectors: Object.freeze(deriveElevationMovementConnectors({
            rows,
            elevationRows,
            width,
            height
        })),
        requiredPaths: Object.freeze(requiredPaths)
    });
}

function deriveBuildingGateRequiredPaths({ buildings, gates, settlements, width, height }) {
    const offsetX = Math.floor(width / 2);
    const offsetY = Math.floor(height / 2);
    const burgIdByName = new Map((settlements || []).map((settlement) => [
        String(settlement.burg?.name || ''),
        Number(settlement.burg?.id)
    ]));
    const paths = [];
    for (const building of buildings || []) {
        const from = resolveBuildingApproachCell(building, offsetX, offsetY);
        if (!from) continue;
        const burgId = burgIdByName.get(String(building.townId || ''));
        const candidates = (gates || []).filter((gate) =>
            !Number.isFinite(burgId) || gate.id.startsWith(`burg-${burgId}-`));
        if (!candidates.length) continue;
        const gate = [...candidates].sort((left, right) =>
            manhattanGridDistance(from, left.grid) - manhattanGridDistance(from, right.grid) ||
            left.id.localeCompare(right.id))[0];
        paths.push(Object.freeze({
            id: `building-${building.id || building.blueprintId || paths.length}-to-${gate.id}`,
            from,
            to: gate.grid,
            requireSharedRoadComponent: true
        }));
    }
    return paths.sort((left, right) => left.id.localeCompare(right.id));
}

function deriveElevationMovementConnectors({ rows, elevationRows, width, height }) {
    const connectors = [];
    const stairSymbols = new Set([':', ';', '1', '2', '3', '4']);
    for (let row = 0; row < height; row++) {
        for (let col = 0; col < width; col++) {
            if (!stairSymbols.has(rows[row]?.[col])) continue;
            for (const [dx, dy] of [[1, 0], [0, 1]]) {
                const neighbor = { col: col + dx, row: row + dy };
                if (!stairSymbols.has(rows[neighbor.row]?.[neighbor.col])) continue;
                const delta = Math.abs(
                    Number(elevationRows[row]?.[col]) - Number(elevationRows[neighbor.row]?.[neighbor.col])
                );
                if (!Number.isFinite(delta) || delta <= 1 || delta > 2) continue;
                connectors.push(Object.freeze({
                    id: `macro-stairs-${col}-${row}-${neighbor.col}-${neighbor.row}`,
                    kind: 'stairs',
                    pairedStair: true,
                    bidirectional: true,
                    from: { col, row },
                    to: neighbor
                }));
            }
        }
    }
    return connectors;
}

function manhattanGridDistance(left, right) {
    return Math.abs(Number(left?.col) - Number(right?.col)) +
        Math.abs(Number(left?.row) - Number(right?.row));
}

function deriveLogicalGates({ rows, skeleton, settlementByTownId, width, height }) {
    const gateCellByKey = new Map(
        [...(skeleton?.cells?.values?.() || [])]
            .filter((cell) => cell.kind === 'gate')
            .map((cell) => [elevationCellKey(cell.col, cell.row), cell])
    );
    const candidates = [];
    // A real gate is the cross-section where a gate corridor cuts through wall blocks. Formula
    // rings may encode the whole approach lane as `gate`; validating every lane cell would turn a
    // single opening into dozens of false hanging gates (especially at a clipped view edge).
    for (let row = 0; row < height; row++) {
        let col = 0;
        while (col < width) {
            if (!gateCellByKey.has(elevationCellKey(col, row))) {
                col++;
                continue;
            }
            const start = col;
            while (col + 1 < width && gateCellByKey.has(elevationCellKey(col + 1, row))) col++;
            const end = col;
            if (rows[row]?.[start - 1] === 'T' && rows[row]?.[end + 1] === 'T') {
                const centerCol = Math.floor((start + end) / 2);
                const source = gateCellByKey.get(elevationCellKey(centerCol, row)) ||
                    gateCellByKey.get(elevationCellKey(start, row));
                const settlement = settlementByTownId.get(Number(source?.townId));
                candidates.push({
                    ...source,
                    col: centerCol,
                    row,
                    edge: row < Number(settlement?.row) ? 'north' : 'south'
                });
            }
            col++;
        }
    }
    for (let col = 0; col < width; col++) {
        let row = 0;
        while (row < height) {
            if (!gateCellByKey.has(elevationCellKey(col, row))) {
                row++;
                continue;
            }
            const start = row;
            while (row + 1 < height && gateCellByKey.has(elevationCellKey(col, row + 1))) row++;
            const end = row;
            if (rows[start - 1]?.[col] === 'T' && rows[end + 1]?.[col] === 'T') {
                const centerRow = Math.floor((start + end) / 2);
                const source = gateCellByKey.get(elevationCellKey(col, centerRow)) ||
                    gateCellByKey.get(elevationCellKey(col, start));
                const settlement = settlementByTownId.get(Number(source?.townId));
                candidates.push({
                    ...source,
                    col,
                    row: centerRow,
                    edge: col < Number(settlement?.col) ? 'west' : 'east'
                });
            }
            row++;
        }
    }
    const visibleCandidates = candidates.filter((candidate) => {
        if (candidate.edge === 'north') return candidate.row > 0;
        if (candidate.edge === 'south') return candidate.row < height - 1;
        if (candidate.edge === 'west') return candidate.col > 0;
        return candidate.col < width - 1;
    });
    const clustered = [];
    for (const candidate of visibleCandidates.sort((left, right) =>
        Number(left.townId) - Number(right.townId) || left.edge.localeCompare(right.edge) ||
        left.row - right.row || left.col - right.col)) {
        const existing = clustered.find((entry) => Number(entry.townId) === Number(candidate.townId) &&
            entry.edge === candidate.edge && Math.abs(entry.col - candidate.col) <= 2 &&
            Math.abs(entry.row - candidate.row) <= 2);
        if (!existing) clustered.push(candidate);
    }
    return clustered
        .map((cell, index) => createLogicalGate(
            { ...cell, id: `burg-${cell.townId}-gate-${index}` },
            settlementByTownId.get(Number(cell.townId)),
            index
        ))
        .filter(Boolean)
        .sort((left, right) => left.id.localeCompare(right.id));
}

function splitLogicalCellComponents(cells) {
    const remaining = new Map(cells);
    const components = [];
    while (remaining.size) {
        const start = remaining.values().next().value;
        const queue = [start];
        const component = [];
        remaining.delete(elevationCellKey(start.col, start.row));
        while (queue.length) {
            const current = queue.shift();
            component.push(current);
            for (const { x, y } of CARDINALS) {
                const key = elevationCellKey(current.col + x, current.row + y);
                const neighbor = remaining.get(key);
                if (!neighbor) continue;
                remaining.delete(key);
                queue.push(neighbor);
            }
        }
        components.push(component.sort((left, right) => left.row - right.row || left.col - right.col));
    }
    return components.sort((left, right) =>
        left[0].row - right[0].row || left[0].col - right[0].col);
}

function findCardinalPathWithinKeys(start, end, allowedKeys) {
    const startKey = elevationCellKey(start.col, start.row);
    const endKey = elevationCellKey(end.col, end.row);
    const queue = [start];
    const previous = new Map([[startKey, null]]);
    for (let index = 0; index < queue.length; index++) {
        const current = queue[index];
        const currentKey = elevationCellKey(current.col, current.row);
        if (currentKey === endKey) break;
        for (const { x, y } of CARDINALS) {
            const next = { col: current.col + x, row: current.row + y };
            const nextKey = elevationCellKey(next.col, next.row);
            if (!allowedKeys.has(nextKey) || previous.has(nextKey)) continue;
            previous.set(nextKey, currentKey);
            queue.push(next);
        }
    }
    if (!previous.has(endKey)) return null;
    const path = [];
    let cursor = endKey;
    while (cursor) {
        const [col, row] = cursor.split(',').map(Number);
        path.push({ col, row });
        cursor = previous.get(cursor);
    }
    return path.reverse();
}

function createLogicalGate(cell, settlement, index) {
    const grid = { col: cell.col, row: cell.row };
    const directions = {
        north: { x: 0, y: -1 },
        east: { x: 1, y: 0 },
        south: { x: 0, y: 1 },
        west: { x: -1, y: 0 }
    };
    let edge = directions[cell.edge] ? cell.edge : null;
    if (!edge && settlement) {
        const dx = cell.col - settlement.col;
        const dy = cell.row - settlement.row;
        edge = Math.abs(dx) >= Math.abs(dy)
            ? dx < 0 ? 'west' : 'east'
            : dy < 0 ? 'north' : 'south';
    }
    if (!edge) return null;
    const outsideDirection = directions[edge];
    return Object.freeze({
        id: String(cell.id ?? `burg-${cell.townId || 'world'}-gate-${index}`),
        grid,
        edge,
        inside: {
            col: cell.col - outsideDirection.x,
            row: cell.row - outsideDirection.y
        },
        outside: {
            col: cell.col + outsideDirection.x,
            row: cell.row + outsideDirection.y
        },
        road: grid
    });
}

function createArchitectureThemeRows({ rows, buildings, settlements, skeleton, width, height }) {
    const themeRows = Array.from({ length: height }, () => Array(width).fill(null));
    const settlementThemeById = new Map();
    for (const settlement of settlements || []) {
        const themeId = normalizeBurgThemeId(
            settlement.architectureThemeId ?? settlement.burg?.themeId,
            null
        );
        if (!themeId) continue;
        settlementThemeById.set(Number(settlement.burg.id), themeId);
        const bounds = settlement.wallBounds;
        if (!bounds) continue;
        for (let row = Math.max(0, bounds.minRow); row <= Math.min(height - 1, bounds.maxRow); row++) {
            for (let col = Math.max(0, bounds.minCol); col <= Math.min(width - 1, bounds.maxCol); col++) {
                if (bounds.insideCellKeys instanceof Set && !isInsideWallBounds(col, row, bounds)) continue;
                // Theme only authored town fabric. Natural terrain inside a loose rectangular
                // projection remains biome-driven and cannot leak a burg's architecture beyond
                // its roads, plazas, walls, and developed ground.
                if (!['T', 'R', ';', ':', '=', '.', ','].includes(rows[row]?.[col])) continue;
                themeRows[row][col] = themeId;
            }
        }
    }

    // Parser-authored vector streets, gates, walls, docks, and castle plots are authoritative.
    // Stamp them after the broad town fabric so adjacent burg projections cannot overwrite them.
    for (const cell of skeleton?.cells?.values?.() || []) {
        if (!themeRows[cell.row] || themeRows[cell.row][cell.col] === undefined) continue;
        const themeId = normalizeBurgThemeId(
            cell.architectureThemeId ?? settlementThemeById.get(Number(cell.townId)),
            null
        );
        if (themeId) themeRows[cell.row][cell.col] = themeId;
    }

    const offsetX = Math.floor(width / 2);
    const offsetY = Math.floor(height / 2);
    for (const building of buildings || []) {
        const themeId = normalizeBurgThemeId(building.architectureThemeId, null);
        if (!themeId) continue;
        const cells = building.footprintCells?.length
            ? building.footprintCells
            : Array.from({ length: building.width * building.height }, (_, index) => ({
                x: index % building.width,
                y: Math.floor(index / building.width)
            }));
        for (const cell of cells) {
            const col = building.x + offsetX + cell.x;
            const row = building.y + offsetY + cell.y;
            if (themeRows[row]?.[col] !== undefined) themeRows[row][col] = themeId;
        }
        const [approachCol, approachRow] = building.entrance?.approachGrid || [];
        if (themeRows[approachRow]?.[approachCol] !== undefined) {
            themeRows[approachRow][approachCol] = themeId;
        }
    }
    return themeRows;
}

function createArchitectureThemeHistogram(settlements) {
    const histogram = {};
    for (const settlement of settlements || []) {
        const themeId = normalizeBurgThemeId(
            settlement.architectureThemeId ?? settlement.burg?.themeId,
            null
        );
        if (themeId) histogram[themeId] = (histogram[themeId] || 0) + 1;
    }
    return histogram;
}

export function sampleGeographicField(worldX, worldY, options = {}) {
    return sampleField(getGeographyIndex(), Number(worldX), Number(worldY), options.seed || ACTIVE_WORLD.seed);
}

function getGeographyIndex() {
    if (geographyIndex) return geographyIndex;
    const cells = ACTIVE_GEOGRAPHY.cells || [];
    const cellById = new Map(cells.map((cell) => [cell.id, cell]));
    const cellBuckets = createBuckets(cells, CELL_BUCKET_SIZE);
    const routePoints = [];
    for (const route of ACTIVE_GEOGRAPHY.routes || []) {
        if (!/road|trail/i.test(route.kind || '')) continue;
        for (const point of route.points || []) {
            routePoints.push({ x: Number(point[0]), y: Number(point[1]), kind: route.kind, id: route.id });
        }
    }
    const riverPoints = [];
    for (const river of ACTIVE_GEOGRAPHY.rivers || []) {
        let previous = null;
        for (const cellId of river.cells || []) {
            const cell = cellById.get(cellId);
            if (!cell) continue;
            if (previous) {
                const distance = Math.hypot(cell.x - previous.x, cell.y - previous.y);
                const steps = Math.max(1, Math.ceil(distance / 1.4));
                for (let step = 1; step <= steps; step++) {
                    const amount = step / steps;
                    riverPoints.push({
                        x: lerp(previous.x, cell.x, amount),
                        y: lerp(previous.y, cell.y, amount),
                        id: river.id, width: river.width || 0,
                        flowX: (cell.x - previous.x) / distance,
                        flowY: (cell.y - previous.y) / distance,
                        discharge: river.discharge || 0
                    });
                }
            } else {
                riverPoints.push({ x: cell.x, y: cell.y, id: river.id, width: river.width || 0,
                    flowX: 0, flowY: 0, discharge: river.discharge || 0 });
            }
            previous = cell;
        }
    }
    geographyIndex = {
        cells,
        cellById,
        cellBuckets,
        routeBuckets: createBuckets(routePoints, PATH_BUCKET_SIZE),
        riverBuckets: createBuckets(riverPoints, PATH_BUCKET_SIZE),
        burgs: ACTIVE_GEOGRAPHY.burgs || [],
        stateById: new Map((ACTIVE_GEOGRAPHY.states || []).map((record) => [record.id, record])),
        cultureById: new Map((ACTIVE_GEOGRAPHY.cultures || []).map((record) => [record.id, record]))
    };
    return geographyIndex;
}

function createBuckets(records, bucketSize) {
    const buckets = new Map();
    for (const record of records) {
        const key = bucketKey(record.x, record.y, bucketSize);
        if (!buckets.has(key)) buckets.set(key, []);
        buckets.get(key).push(record);
    }
    return { bucketSize, buckets, records };
}

function sampleRegionFields(index, { centerX, centerY, width, height, seed }) {
    const fields = new Array(width * height);
    const offsetX = Math.floor(width / 2);
    const offsetY = Math.floor(height / 2);
    for (let row = 0; row < height; row++) {
        for (let col = 0; col < width; col++) {
            const globalX = centerX + (col - offsetX) * WORLD_SAMPLE_SCALE;
            const globalY = centerY + (row - offsetY) * WORLD_SAMPLE_SCALE;
            const globalCol = Math.round(globalX / WORLD_SAMPLE_SCALE);
            const globalRow = Math.round(globalY / WORLD_SAMPLE_SCALE);
            const sampled = sampleField(index, globalX, globalY, seed);
            const environmentId = resolveEnvironmentId(sampled, ACTIVE_GEOGRAPHY.biomes);
            fields[row * width + col] = {
                ...sampled,
                environmentId,
                globalX,
                globalY,
                globalCol,
                globalRow,
                terrainNoiseMask: sampleWfcNoiseMask({
                    mapId: 'overworld',
                    x: globalCol,
                    y: globalRow,
                    seed,
                    environmentId,
                    stateId: sampled.state
                }),
                row,
                col
            };
        }
    }
    return fields;
}

function createTerrainGenerationFrame({ index, centerX, centerY, width, height, seed }) {
    const centerGlobalCol = Math.round(centerX / WORLD_SAMPLE_SCALE);
    const centerGlobalRow = Math.round(centerY / WORLD_SAMPLE_SCALE);
    const requestedMinCol = centerGlobalCol - Math.floor(width / 2);
    const requestedMinRow = centerGlobalRow - Math.floor(height / 2);
    const requestedMaxColExclusive = requestedMinCol + width;
    const requestedMaxRowExclusive = requestedMinRow + height;
    const halo = TERRAIN_WFC_HALO_CHUNKS * TERRAIN_WFC_CHUNK_SIZE;
    const minCol = Math.floor(requestedMinCol / TERRAIN_WFC_CHUNK_SIZE) * TERRAIN_WFC_CHUNK_SIZE - halo;
    const minRow = Math.floor(requestedMinRow / TERRAIN_WFC_CHUNK_SIZE) * TERRAIN_WFC_CHUNK_SIZE - halo;
    const maxColExclusive = Math.ceil(requestedMaxColExclusive / TERRAIN_WFC_CHUNK_SIZE) *
        TERRAIN_WFC_CHUNK_SIZE + halo;
    const maxRowExclusive = Math.ceil(requestedMaxRowExclusive / TERRAIN_WFC_CHUNK_SIZE) *
        TERRAIN_WFC_CHUNK_SIZE + halo;
    const frameWidth = maxColExclusive - minCol;
    const frameHeight = maxRowExclusive - minRow;
    const frameCenterCol = minCol + Math.floor(frameWidth / 2);
    const frameCenterRow = minRow + Math.floor(frameHeight / 2);
    const frameCenterX = frameCenterCol * WORLD_SAMPLE_SCALE;
    const frameCenterY = frameCenterRow * WORLD_SAMPLE_SCALE;
    const frameFields = sampleRegionFields(index, {
        centerX: frameCenterX,
        centerY: frameCenterY,
        width: frameWidth,
        height: frameHeight,
        seed
    });
    const frameAnchors = createSettlementConstraintAnchors({
        blueprints: ACTIVE_SETTLEMENT_BLUEPRINTS,
        burgs: index.burgs,
        centerX: frameCenterX,
        centerY: frameCenterY,
        width: frameWidth,
        height: frameHeight,
        sampleScale: WORLD_SAMPLE_SCALE
    });
    const frameSkeleton = createBlueprintSkeleton({
        settlements: frameAnchors,
        fields: frameFields,
        width: frameWidth,
        height: frameHeight,
        sampleScale: WORLD_SAMPLE_SCALE
    });
    const frameConstraints = createWorldConstraintField({
        fields: frameFields,
        width: frameWidth,
        height: frameHeight,
        settlements: frameAnchors,
        skeleton: frameSkeleton
    });
    return {
        fields: frameFields,
        constraints: frameConstraints,
        skeleton: frameSkeleton,
        width: frameWidth,
        height: frameHeight,
        minCol,
        minRow,
        cropCol: requestedMinCol - minCol,
        cropRow: requestedMinRow - minRow
    };
}

function cropTerrainCollapse(
    frameCollapse,
    frame,
    width,
    height,
    requestedConstraints,
    requestedFields,
    useBakedPartialChunks
) {
    const tileIds = new Array(width * height);
    const bakedCellIds = new Set();
    for (let row = 0; row < height; row++) {
        for (let col = 0; col < width; col++) {
            const id = row * width + col;
            const frameId = (frame.cropRow + row) * frame.width + frame.cropCol + col;
            tileIds[id] = frameCollapse.tileIds[frameId];
            if (frameCollapse.bakedCellIds.has(frameId)) bakedCellIds.add(id);
        }
    }
    const invalidAdjacencySamples = listTerrainAdjacencyIssues(
        tileIds,
        width,
        height,
        requestedConstraints
    );
    // Diagnostics count by outcome over the requested view: a candidate is applied when the final
    // terrain matches its baked record, whichever pass (frame collapse or seam repair) put it there.
    let candidateCells = 0;
    let appliedCells = 0;
    requestedFields.forEach((field, id) => {
        const baked = getBakedPartialCell(field, useBakedPartialChunks);
        if (!baked) return;
        candidateCells++;
        if (tileIds[id] === baked.tileId) appliedCells++;
    });
    return {
        tileIds,
        bakedCellIds,
        diagnostics: {
            ...frameCollapse.diagnostics,
            frameWidth: frame.width,
            frameHeight: frame.height,
            haloChunks: TERRAIN_WFC_HALO_CHUNKS,
            invalidAdjacencies: invalidAdjacencySamples.length,
            invalidAdjacencySamples: invalidAdjacencySamples.slice(0, 12),
            partialBake: {
                ...frameCollapse.diagnostics.partialBake,
                candidateCells,
                appliedCells,
                constraintConflicts: candidateCells - appliedCells
            }
        }
    };
}

function cropTerrainRows(frameRows, frame, width, height) {
    return Array.from({ length: height }, (_, row) =>
        frameRows[frame.cropRow + row].slice(frame.cropCol, frame.cropCol + width));
}

function sampleField(index, x, y, seed) {
    const candidates = nearestRecords(index.cellBuckets, x, y, 6);
    const weighted = candidates.map((cell) => {
        const distance = Math.hypot(cell.x - x, cell.y - y);
        return { cell, distance, weight: 1 / (5 + distance * distance) };
    });
    const total = weighted.reduce((sum, entry) => sum + entry.weight, 0) || 1;
    const noise = fractalNoise(x, y, seed);
    // Macro values are the FMG interpolation before the variant noise; anything that must stay
    // identical across variants (the fixed town skeleton's relief profile) reads these.
    const macroLand = clamp01(weighted.reduce((sum, entry) => sum + entry.cell.land * entry.weight, 0) / total);
    const macroHeight = clampNumber(weighted.reduce((sum, entry) => sum + entry.cell.height * entry.weight, 0) / total, 0, 100, 20);
    const land = clamp01(macroLand + noise * 0.035);
    const height = clampNumber(
        weighted.reduce((sum, entry) => sum + entry.cell.height * entry.weight, 0) / total + noise * 4.8,
        0,
        100,
        20
    );
    const nearestRiver = nearestPathDistance(index.riverBuckets, x, y, 4);
    const riverPathInfluence = nearestRiver ? Math.max(0, 1 - nearestRiver.distance / 2.2) : 0;
    const cellRiver = weighted.reduce((sum, entry) => {
        if (!entry.cell.river) return sum;
        return sum + entry.weight * (0.38 + Math.min(0.62, (entry.cell.flux || 0) / 180));
    }, 0) / total;
    const riverInfluence = Math.max(cellRiver, riverPathInfluence);
    const route = nearestPathDistance(index.routeBuckets, x, y, 3);
    return {
        land,
        height,
        biome: weightedVote(weighted, 'biome'),
        state: weightedVote(weighted, 'state'),
        province: weightedVote(weighted, 'province'),
        culture: weightedVote(weighted, 'culture'),
        riverInfluence: clamp01(riverInfluence),
        riverPathInfluence: clamp01(riverPathInfluence),
        riverId: nearestRiver?.id ?? null,
        riverFlowX: Number(nearestRiver?.flowX) || 0,
        riverFlowY: Number(nearestRiver?.flowY) || 0,
        riverDischarge: Number(nearestRiver?.discharge) || 0,
        routeInfluence: route ? clamp01(1 - route.distance / 1.35) : 0,
        routeId: route?.id ?? null,
        nearestCell: weighted[0]?.cell?.id ?? 0,
        noise,
        macroLand,
        macroHeight
    };
}

function createWaterFlowRows(fields, width, height) {
    return Array.from({ length: height }, (_, row) => Array.from({ length: width }, (_, col) => {
        const field = fields[row * width + col];
        if (!field || field.riverId === null || field.riverId === undefined || field.riverPathInfluence < 0.35) return null;
        return {
            riverId: field.riverId,
            x: Number(field.riverFlowX) || 0,
            y: Number(field.riverFlowY) || 0,
            // 0..1 is deliberately compact runtime data, not a copy of FMG's field.
            speed: Math.max(0.15, Math.min(1, Math.log1p(Math.max(0, field.riverDischarge || 0)) / 6))
        };
    }));
}

function nearestRecords(index, x, y, count) {
    const records = [];
    const baseX = Math.floor(x / index.bucketSize);
    const baseY = Math.floor(y / index.bucketSize);
    for (let radius = 0; radius <= 4 && records.length < count * 3; radius++) {
        for (let by = baseY - radius; by <= baseY + radius; by++) {
            for (let bx = baseX - radius; bx <= baseX + radius; bx++) {
                if (radius > 0 && bx > baseX - radius && bx < baseX + radius && by > baseY - radius && by < baseY + radius) continue;
                records.push(...(index.buckets.get(`${bx},${by}`) || []));
            }
        }
    }
    const source = records.length ? records : index.records;
    return source
        .map((record) => ({ record, distance: Math.hypot(record.x - x, record.y - y) }))
        .sort((a, b) => a.distance - b.distance || Number(a.record.id || 0) - Number(b.record.id || 0))
        .slice(0, count)
        .map((entry) => entry.record);
}

function nearestPathDistance(index, x, y, count) {
    const nearest = nearestRecords(index, x, y, count)[0];
    return nearest ? { ...nearest, distance: Math.hypot(nearest.x - x, nearest.y - y) } : null;
}

function collapseTerrain(fields, width, height, seed, constraintField, useBakedPartialChunks) {
    const tileIds = new Array(width * height);
    const bakedCellIds = new Set();
    const chunkGroups = createGlobalTerrainChunkGroups(fields);
    let chunks = 0;
    let fallbacks = 0;
    for (const chunk of chunkGroups) {
        chunks++;
        const nodes = [];
        const domains = new Map();
        const fixed = new Map();
        const localIdByGlobalId = new Map(chunk.cells.map((cell) => [cell.globalId, cell.id]));
        for (const cell of chunk.cells) {
            const neighbors = [];
            for (const direction of CARDINALS) {
                const neighborGlobalId = globalSampleGridKey(
                    cell.globalCol + direction.x,
                    cell.globalRow + direction.y
                );
                if (!localIdByGlobalId.has(neighborGlobalId)) continue;
                neighbors.push({ id: neighborGlobalId, direction: direction.name });
            }
            nodes.push({ id: cell.globalId, neighbors });
            const constraint = constraintField?.cells?.[cell.id];
            // Partial baked chunk merge (the 3x3-chunk settlement cores baked by
            // tools/bake_partial_chunks.mjs): a baked cell is authoritative — it enters
            // the chunk solve pre-collapsed and the wave propagates the live world
            // around it, welding baked city cores into generated terrain seamlessly.
            const baked = getBakedPartialCell(fields[cell.id], useBakedPartialChunks);
            if (baked) {
                domains.set(cell.globalId, [baked.tileId]);
                fixed.set(cell.globalId, baked.tileId);
                bakedCellIds.add(cell.id);
                continue;
            }
            const domain = getConstrainedTerrainDomain(fields[cell.id], constraint);
            domains.set(cell.globalId, domain);
            const fixedTerrain = getFixedTerrainModule(
                cell.id,
                fields,
                constraintField,
                width,
                height
            );
            if (fixedTerrain && domain.includes(fixedTerrain)) {
                fixed.set(cell.globalId, fixedTerrain);
            }
        }
        try {
            const assignment = solveWaveFunctionCollapse({
                nodes,
                tiles: GEOGRAPHIC_TILES,
                domains,
                fixed,
                compatible: terrainWaveCompatible,
                seed: `${seed}:terrain:${chunk.chunkCol}:${chunk.chunkRow}`,
                nodeWeights: (globalId, tileId) => {
                    const id = localIdByGlobalId.get(globalId);
                    return getConstrainedTerrainWeight(
                        fields[id],
                        constraintField?.cells?.[id],
                        tileId
                    );
                }
            });
            for (const [globalId, tileId] of assignment) {
                tileIds[localIdByGlobalId.get(globalId)] = tileId;
            }
        } catch (error) {
            if (!(error instanceof WaveFunctionCollapseError)) throw error;
            fallbacks++;
            for (const node of nodes) {
                const id = localIdByGlobalId.get(node.id);
                tileIds[id] = chooseWeightedTerrain(
                    fields[id],
                    domains.get(node.id),
                    `${seed}:terrain-cell:${node.id}`,
                    constraintField?.cells?.[id]
                );
            }
        }
    }
    const repair = repairTerrainTransitions(
        tileIds,
        fields,
        width,
        height,
        seed,
        constraintField,
        bakedCellIds
    );
    const appliedBakedCellIds = new Set([...bakedCellIds].filter((id) => (
        tileIds[id] === getBakedPartialCell(fields[id], useBakedPartialChunks)?.tileId
    )));
    const invalidAdjacencySamples = listTerrainAdjacencyIssues(tileIds, width, height, constraintField);
    return {
        tileIds,
        bakedCellIds: appliedBakedCellIds,
        diagnostics: {
            chunks,
            fallbacks,
            chunkSize: TERRAIN_WFC_CHUNK_SIZE,
            invalidAdjacencies: invalidAdjacencySamples.length,
            invalidAdjacencySamples: invalidAdjacencySamples.slice(0, 12),
            partialBake: {
                requested: useBakedPartialChunks !== false,
                registryValid: PARTIAL_CHUNK_REGISTRY_STATUS.valid,
                registryCompatible: PARTIAL_CHUNK_REGISTRY_STATUS.compatible,
                registryCells: PARTIAL_CHUNK_REGISTRY_STATUS.cellCount || 0,
                candidateCells: bakedCellIds.size + repair.bakedConstraintConflicts,
                appliedCells: appliedBakedCellIds.size,
                constraintConflicts: repair.bakedConstraintConflicts,
                compatibilityErrors: [...PARTIAL_CHUNK_REGISTRY_STATUS.compatibilityErrors]
            }
        }
    };
}

function createGlobalTerrainChunkGroups(fields) {
    const groups = new Map();
    for (let id = 0; id < fields.length; id++) {
        const field = fields[id] || {};
        const globalCol = Number.isFinite(field.globalCol)
            ? field.globalCol
            : Math.round(Number(field.globalX || 0) / WORLD_SAMPLE_SCALE);
        const globalRow = Number.isFinite(field.globalRow)
            ? field.globalRow
            : Math.round(Number(field.globalY || 0) / WORLD_SAMPLE_SCALE);
        const chunkCol = Math.floor(globalCol / TERRAIN_WFC_CHUNK_SIZE);
        const chunkRow = Math.floor(globalRow / TERRAIN_WFC_CHUNK_SIZE);
        const key = `${chunkCol},${chunkRow}`;
        if (!groups.has(key)) groups.set(key, { chunkCol, chunkRow, cells: [] });
        groups.get(key).cells.push({
            id,
            globalCol,
            globalRow,
            globalId: globalSampleGridKey(globalCol, globalRow)
        });
    }
    return [...groups.values()]
        .map((group) => ({
            ...group,
            cells: group.cells.sort((left, right) =>
                left.globalRow - right.globalRow || left.globalCol - right.globalCol)
        }))
        .sort((left, right) => left.chunkRow - right.chunkRow || left.chunkCol - right.chunkCol);
}

function globalSampleGridKey(col, row) {
    return `${col},${row}`;
}

function globalFieldSampleKey(field) {
    return globalSampleGridKey(
        Number.isFinite(field?.globalCol)
            ? field.globalCol
            : Math.round(Number(field?.globalX || 0) / WORLD_SAMPLE_SCALE),
        Number.isFinite(field?.globalRow)
            ? field.globalRow
            : Math.round(Number(field?.globalY || 0) / WORLD_SAMPLE_SCALE)
    );
}

function getConstrainedTerrainDomain(field, constraint) {
    if (constraint?.fixedTerrain) return [constraint.fixedTerrain];
    const base = getTerrainDomain(field, ACTIVE_GEOGRAPHY.biomes);
    if (constraint?.hardWater) {
        return constraint.land <= 0.16
            ? ['deep-water', 'shallow-water']
            : ['shallow-water', 'wetland', 'sand'];
    }

    const candidates = [...new Set([...base, 'meadow', 'savanna', 'sand', 'tundra'])];
    if ((constraint?.urbanization || 0) >= 0.55) {
        const settled = candidates
            .filter((tileId) => {
                const spec = GEOGRAPHIC_TILE_BY_ID.get(tileId);
                return spec?.tags.has('land') &&
                    !spec.tags.has('relief') &&
                    !spec.tags.has('trees') &&
                    !spec.tags.has('ice');
            })
            .sort((left, right) =>
                getTerrainWeight(field, right, ACTIVE_GEOGRAPHY.biomes) -
                getTerrainWeight(field, left, ACTIVE_GEOGRAPHY.biomes));
        return settled.slice(0, Math.max(2, Math.min(3, settled.length)));
    }

    const ranked = candidates.sort((left, right) =>
        getTerrainWeight(field, right, ACTIVE_GEOGRAPHY.biomes) -
        getTerrainWeight(field, left, ACTIVE_GEOGRAPHY.biomes));
    const inhibitor = constraint?.inhibitor || 0;
    const keepCount = Math.max(3, Math.ceil(ranked.length * (1 - inhibitor * 0.45)));
    return ranked.slice(0, keepCount);
}

function getConstrainedTerrainWeight(field, constraint, tileId) {
    const spec = GEOGRAPHIC_TILE_BY_ID.get(tileId);
    let weight = getTerrainWeight(field, tileId, ACTIVE_GEOGRAPHY.biomes);
    const urbanization = constraint?.urbanization || 0;
    if (constraint?.fixedTerrain) {
        weight *= tileId === constraint.fixedTerrain ? 24 : 0.0001;
    } else if (constraint?.hardWater) {
        weight *= spec?.tags.has('water') ? 8 : 0.02;
    } else if (urbanization > 0) {
        if (spec?.tags.has('relief') || spec?.tags.has('trees') || spec?.tags.has('water')) {
            weight *= Math.max(0.025, (1 - urbanization) ** 2);
        } else {
            weight *= 1 + urbanization * 3.8;
        }
    }
    // The static mask is intentionally a soft influence only. Fixed FMG vectors, hard water,
    // urban parcels and pre-baked chunk cells remain authoritative constraints.
    let contrast = 1;
    if (!constraint?.fixedTerrain && !constraint?.hardWater && urbanization < 0.55) {
        weight *= getTerrainNoiseWeightMultiplier(field?.terrainNoiseMask, spec);
        // Wilderness only: sharpen by the environment's contrast so the WFC's weighted pick
        // follows the environment mask as coherent patches rather than per-cell speckle.
        contrast = getEnvironmentProfile(field?.environmentId)?.noise.contrast ?? 1;
    }
    const latitude = Math.abs(Number(constraint?.latitude) || 0);
    if (latitude >= 45) {
        if (['taiga', 'tundra', 'glacier', 'mountain'].includes(tileId)) weight *= 2.3;
        if (['desert', 'savanna', 'jungle'].includes(tileId)) weight *= 0.18;
    } else if (latitude <= 14) {
        if (['savanna', 'jungle', 'desert'].includes(tileId)) weight *= 1.55;
        if (['taiga', 'tundra', 'glacier'].includes(tileId)) weight *= 0.35;
    }
    const sharpen = (1 + (constraint?.inhibitor || 0) * 0.75) * contrast;
    return Math.max(0.0001, Math.pow(weight, sharpen));
}

function getFixedTerrainModule(id, fields, constraintField, width, height) {
    const constraint = constraintField?.cells?.[id];
    if (constraint?.fixedTerrain) return constraint.fixedTerrain;
    if (!constraint?.hardWater) return null;
    if (constraint.land > 0.16) return 'shallow-water';
    const row = Math.floor(id / width);
    const col = id % width;
    const surrounded = CARDINALS.every(({ x, y }) => {
        const neighborCol = col + x;
        const neighborRow = row + y;
        if (neighborCol < 0 || neighborRow < 0 || neighborCol >= width || neighborRow >= height) return false;
        const neighbor = constraintField.cells[neighborRow * width + neighborCol];
        return neighbor && neighbor.hardWater && neighbor.land <= 0.22;
    });
    return surrounded ? 'deep-water' : 'shallow-water';
}

function chooseWeightedTerrain(field, domain, seed, constraint = null) {
    return [...domain]
        .map((tileId) => ({
            tileId,
            score: getConstrainedTerrainWeight(field, constraint, tileId) * (0.92 + keyedUnit(`${seed}:${tileId}`) * 0.16)
        }))
        .sort((a, b) => b.score - a.score || a.tileId.localeCompare(b.tileId))[0]?.tileId || 'meadow';
}

function repairTerrainTransitions(tileIds, fields, width, height, seed, constraintField, bakedCellIds = new Set()) {
    let bakedConstraintConflicts = 0;
    for (let id = 0; id < tileIds.length; id++) {
        const fixed = getFixedTerrainModule(id, fields, constraintField, width, height);
        if (!fixed) continue;
        if (bakedCellIds.has(id) && tileIds[id] !== fixed) {
            bakedCellIds.delete(id);
            bakedConstraintConflicts++;
        }
        tileIds[id] = fixed;
    }
    // Chunk WFC intentionally runs in small windows, so this deterministic seam pass reconciles
    // chunk boundaries and fixed blueprint nodes. Physical skeleton nodes are stamped later;
    // their semantic underlay may become coast/hill here without moving or deleting the node.
    for (let pass = 0; pass < 16; pass++) {
        let changes = 0;
        for (let row = 0; row < height; row++) {
            for (let col = 0; col < width; col++) {
                const id = row * width + col;
                for (const [dx, dy] of [[1, 0], [0, 1]]) {
                    const nx = col + dx;
                    const ny = row + dy;
                    if (nx >= width || ny >= height) continue;
                    const neighborId = ny * width + nx;
                    if (terrainWaveCompatible(tileIds[id], tileIds[neighborId])) continue;
                    changes += reconcileTerrainPair(
                        tileIds,
                        id,
                        neighborId,
                        fields,
                        constraintField,
                        seed,
                        pass,
                        bakedCellIds
                    );
                }
            }
        }
        if (changes === 0) break;
    }
    return { bakedConstraintConflicts };
}

function reconcileTerrainPair(tileIds, id, neighborId, fields, constraintField, seed, pass, bakedCellIds) {
    const left = GEOGRAPHIC_TILE_BY_ID.get(tileIds[id]);
    const right = GEOGRAPHIC_TILE_BY_ID.get(tileIds[neighborId]);
    if (!left || !right) return 0;
    const leftBaked = bakedCellIds?.has(id) === true;
    const rightBaked = bakedCellIds?.has(neighborId) === true;
    if (leftBaked && rightBaked) return 0;
    if (leftBaked || rightBaked) {
        const bakedId = leftBaked ? id : neighborId;
        const liveId = leftBaked ? neighborId : id;
        const bridge = findBridgeTerrain(tileIds[bakedId], fields[liveId]);
        if (!bridge || bridge === tileIds[liveId]) return 0;
        tileIds[liveId] = bridge;
        return 1;
    }
    const leftWater = left.tags.has('water');
    const rightWater = right.tags.has('water');
    const leftHard = constraintField?.cells?.[id]?.hardWater === true;
    const rightHard = constraintField?.cells?.[neighborId]?.hardWater === true;

    if (leftWater !== rightWater) {
        const waterId = leftWater ? id : neighborId;
        const landId = leftWater ? neighborId : id;
        let changes = 0;
        if (tileIds[waterId] !== 'shallow-water') {
            tileIds[waterId] = 'shallow-water';
            changes++;
        }
        if (tileIds[landId] !== 'sand') {
            tileIds[landId] = 'sand';
            changes++;
        }
        return changes;
    }

    if (Math.abs(left.band - right.band) > 1) {
        const highId = left.band > right.band ? id : neighborId;
        if ((highId === id && leftHard) || (highId === neighborId && rightHard)) return 0;
        if (tileIds[highId] === 'hill') return 0;
        tileIds[highId] = 'hill';
        return 1;
    }

    const hotId = left.tags.has('hot') ? id : right.tags.has('hot') ? neighborId : null;
    if (hotId !== null && !constraintField?.cells?.[hotId]?.hardWater) {
        const other = hotId === id ? right : left;
        const replacement = other.band >= 2 ? 'hill' : 'meadow';
        if (tileIds[hotId] !== replacement) {
            tileIds[hotId] = replacement;
            return 1;
        }
    }

    const pairKeys = [globalFieldSampleKey(fields[id]), globalFieldSampleKey(fields[neighborId])].sort();
    const targetId = leftHard && !rightHard
        ? neighborId
        : rightHard && !leftHard
            ? id
            : keyedUnit(`${seed}:seam:${pass}:${pairKeys[0]}:${pairKeys[1]}`) < 0.5 ? id : neighborId;
    const otherId = targetId === id ? neighborId : id;
    const bridge = findBridgeTerrain(tileIds[otherId], fields[targetId]);
    if (!bridge || bridge === tileIds[targetId]) return 0;
    tileIds[targetId] = bridge;
    return 1;
}

function findBridgeTerrain(otherTileId, field) {
    const domain = getTerrainDomain(field, ACTIVE_GEOGRAPHY.biomes);
    return [...domain, 'shallow-water', 'sand', 'wetland', 'meadow', 'hill']
        .filter((tileId, index, list) => list.indexOf(tileId) === index)
        .filter((tileId) => terrainWaveCompatible(tileId, otherTileId))
        .sort((a, b) => getTerrainWeight(field, b, ACTIVE_GEOGRAPHY.biomes) - getTerrainWeight(field, a, ACTIVE_GEOGRAPHY.biomes))[0] || 'meadow';
}

function listTerrainAdjacencyIssues(tileIds, width, height, constraintField = null) {
    const issues = [];
    for (let row = 0; row < height; row++) {
        for (let col = 0; col < width; col++) {
            const id = row * width + col;
            for (const neighborId of [col + 1 < width ? id + 1 : -1, row + 1 < height ? id + width : -1]) {
                if (neighborId < 0 || terrainWaveCompatible(tileIds[id], tileIds[neighborId])) continue;
                const neighborRow = Math.floor(neighborId / width);
                const neighborCol = neighborId % width;
                const constraint = constraintField?.cells?.[id];
                const neighborConstraint = constraintField?.cells?.[neighborId];
                issues.push({
                    from: { col, row, tileId: tileIds[id], fixed: constraint?.fixedTerrain || null, hardWater: constraint?.hardWater === true, kind: constraint?.skeletonKind || null },
                    to: { col: neighborCol, row: neighborRow, tileId: tileIds[neighborId], fixed: neighborConstraint?.fixedTerrain || null, hardWater: neighborConstraint?.hardWater === true, kind: neighborConstraint?.skeletonKind || null }
                });
            }
        }
    }
    return issues;
}

function createTerrainRows(tileIds, width, height) {
    return Array.from({ length: height }, (_, row) => Array.from({ length: width }, (_, col) =>
        GEOGRAPHIC_TILE_BY_ID.get(tileIds[row * width + col])?.symbol || 'G').join(''));
}

function createPaletteRows(tileIds, fields, width, height, constraintField = null) {
    return Array.from({ length: height }, (_, row) => Array.from({ length: width }, (_, col) =>
        getRegionalPalette(
            tileIds[row * width + col],
            fields[row * width + col],
            constraintField?.cells?.[row * width + col]
        )));
}

function getRegionalPalette(tileId, field, constraint = null) {
    if (['deep-water', 'shallow-water'].includes(tileId)) return 'coast';
    if (tileId === 'wetland') return 'wetland';
    if (tileId === 'crystal') return 'crystal';
    if (tileId === 'glacier') return 'tundra';
    const biome = getBiomeName(field?.biome, ACTIVE_GEOGRAPHY.biomes);
    const regional = ({
        Marine: 'coast',
        'Hot desert': 'desert',
        'Cold desert': 'tundra',
        Savanna: 'savanna',
        Grassland: 'meadow',
        'Tropical seasonal forest': 'jungle',
        'Temperate deciduous forest': 'forest',
        'Tropical rainforest': 'jungle',
        'Temperate rainforest': 'forest',
        Taiga: 'taiga',
        Tundra: 'tundra',
        Glacier: 'alpine',
        Wetland: 'wetland'
    })[biome] || GEOGRAPHIC_TILE_BY_ID.get(tileId)?.paletteId || 'meadow';
    if (tileId === 'sand' && Number(field?.land) < 0.7) return 'coast';
    if (tileId === 'mountain' && ['meadow', 'forest', 'taiga', 'tundra'].includes(regional)) return 'alpine';
    const latitude = Math.abs(Number(constraint?.latitude) || 0);
    if (latitude >= 45) {
        if (regional === 'forest' || regional === 'jungle') return 'taiga';
        if (regional === 'meadow' || regional === 'savanna' || regional === 'desert') return 'tundra';
    } else if (latitude >= 42 && regional === 'jungle') {
        return 'forest';
    } else if (latitude <= 14) {
        if (regional === 'forest') return 'jungle';
        if (regional === 'meadow') return 'savanna';
    }
    return regional;
}

function createElevationRows(fields, tileIds, width, height, seed, constraintField, bakedCellIds = new Set()) {
    // Elevation is collapsed on a world-anchored macro lattice instead of adding independent
    // noise to every cell. Primary 5x5 modules create Minecraft-like plateaus and broad ramps;
    // compact 3x3 modules are reserved for connector aprons where a semantic path crosses a tier.
    const macroPlan = createTerrainMacroElevationPlan({
        fields,
        tileIds,
        width,
        height,
        seed,
        constraintField,
        bakedCellIds
    });
    const rows = macroPlan.rows;
    // Baked settlement-core cells keep their baked elevation exactly (applied after smoothing so
    // live smoothing around the core cannot drift the welded city terrain).
    for (let row = 0; row < height; row++) {
        for (let col = 0; col < width; col++) {
            const id = row * width + col;
            const baked = bakedCellIds.has(id) ? getBakedPartialCell(fields[id], true) : null;
            if (baked && Number.isFinite(baked.elevation)) rows[row][col] = baked.elevation;
        }
    }
    // FMG elevation tiers shape each macro block's relief profile, but are intentionally soft at
    // cell level. Adjacent vector samples can jump several source tiers; stamping them literally
    // creates unclimbable street cliffs. The JSON therefore constrains the 5x5 collapse without
    // overriding the selected module's one-step edge contract.
    const protectedElevationIds = new Set(bakedCellIds);
    relaxElevationRamps(rows, tileIds, width, height, protectedElevationIds);
    const protectedMacroElevationIds = new Set([
        ...macroPlan.hardAuthoritativeCells,
        ...protectedElevationIds
    ]);
    const repairedMacroSpikes = repairTerrainMacroSpikes(
        rows,
        tileIds,
        width,
        height,
        protectedMacroElevationIds
    );
    const remainingGeneratedSpikes = findIsolatedElevationSpikes(rows).filter((cell) =>
        !protectedMacroElevationIds.has(cell.row * width + cell.col));
    Object.defineProperty(rows, 'macroDiagnostics', {
        value: Object.freeze({
            ...macroPlan.diagnostics,
            repairedCells: macroPlan.diagnostics.repairedCells + repairedMacroSpikes,
            isolatedElevationCells: remainingGeneratedSpikes.length
        }),
        enumerable: false
    });
    return rows;
}

function createTerrainMacroElevationPlan({
    fields,
    tileIds,
    width,
    height,
    seed,
    constraintField,
    bakedCellIds
}) {
    const rows = Array.from({ length: height }, () => Array(width).fill(0));
    const globalCols = fields.map((field) => Number(field?.globalCol)).filter(Number.isFinite);
    const globalRows = fields.map((field) => Number(field?.globalRow)).filter(Number.isFinite);
    const minimumGlobalCol = globalCols.length ? Math.min(...globalCols) : 0;
    const maximumGlobalCol = globalCols.length ? Math.max(...globalCols) : width - 1;
    const minimumGlobalRow = globalRows.length ? Math.min(...globalRows) : 0;
    const maximumGlobalRow = globalRows.length ? Math.max(...globalRows) : height - 1;
    const firstMacroCol = Math.floor(minimumGlobalCol / TERRAIN_PRIMARY_MACRO_SIZE);
    const lastMacroCol = Math.floor(maximumGlobalCol / TERRAIN_PRIMARY_MACRO_SIZE);
    const firstMacroRow = Math.floor(minimumGlobalRow / TERRAIN_PRIMARY_MACRO_SIZE);
    const lastMacroRow = Math.floor(maximumGlobalRow / TERRAIN_PRIMARY_MACRO_SIZE);
    const macroWidth = lastMacroCol - firstMacroCol + 1;
    const macroHeight = lastMacroRow - firstMacroRow + 1;
    const blocks = [];

    for (let macroRow = firstMacroRow; macroRow <= lastMacroRow; macroRow++) {
        for (let macroCol = firstMacroCol; macroCol <= lastMacroCol; macroCol++) {
            const block = describeTerrainMacroBlock({
                macroCol,
                macroRow,
                minimumGlobalCol,
                minimumGlobalRow,
                fields,
                tileIds,
                width,
                height,
                constraintField
            });
            blocks.push(block);
        }
    }
    stabilizeTerrainMacroBases(blocks);

    const hardAuthoritativeCells = new Set();
    for (let id = 0; id < width * height; id++) {
        const spec = GEOGRAPHIC_TILE_BY_ID.get(tileIds[id]);
        if (spec?.tags.has('water') || bakedCellIds.has(id)) {
            hardAuthoritativeCells.add(id);
        }
    }

    const moduleHistogram = {};
    const familyHistogram = {};
    let appliedCells = 0;
    let protectedCells = 0;
    let repairedCells = 0;
    const assignments = [];
    const createMacroNodes = (expandBaseDomain = false) => blocks.map((block) => {
        const baseElevationRadius = block.insideWallRatio > 0
            ? 1
            : block.reliefProfile.reliefScore >= 0.45
                ? 2
                : 1;
        const baseElevationCandidates = expandBaseDomain || !Number.isFinite(baseElevationRadius)
            ? [0, 1, 2, 3, 4, 5, 6]
            : [...new Set(Array.from(
                { length: baseElevationRadius * 2 + 1 },
                (_, index) => clampInteger(
                    block.baseElevation + index - baseElevationRadius,
                    0,
                    6
                )
            ))];
        return {
                macroCol: block.macroCol,
                macroRow: block.macroRow,
                role: 'primary',
                baseElevation: block.baseElevation,
                fixedBase: false,
                baseElevationCandidates,
                reliefProfile: block.reliefProfile,
                allowedFamilies: block.allowedFamilies
        };
    });
    let expandedBaseDomain = false;
    let macroCollapse = collapseTerrainMacroTileGrid({
        seed: `${seed}:terrain-macro-grid`,
        minimumElevation: 0,
        maximumElevation: 6,
        allowFallback: false,
        nodes: createMacroNodes(false)
    });
    if (!macroCollapse.solved) {
        // Rare dense burgs can have no compatible edge state inside the preferred ±1/±2 FMG
        // range. Retry with all legal bases before invoking any uniform emergency fallback. The
        // target-distance weights still inhibit drift, while preserving a solved macro graph.
        expandedBaseDomain = true;
        macroCollapse = collapseTerrainMacroTileGrid({
            seed: `${seed}:terrain-macro-grid:expanded-base-domain`,
            minimumElevation: 0,
            maximumElevation: 6,
            allowFallback: true,
            nodes: createMacroNodes(true)
        });
    }
    for (const block of blocks) {
        const resolvedAssignment = macroCollapse.assignment.get(`${block.macroCol},${block.macroRow}`);
        const patch = resolvedAssignment?.patch || createDeterministicTerrainMacroPatch({
            seed: `${seed}:terrain-macro-flat:${block.macroCol}:${block.macroRow}`,
            reliefProfile: { ...block.reliefProfile, reliefScore: 0, targetTierSpan: 0 },
            role: 'primary',
            baseElevation: block.baseElevation,
            minimumElevation: 0,
            maximumElevation: 6,
            allowedFamilies: ['uniform']
        });
        if (!patch) continue;
        const result = applyTerrainMacroTileToElevationRows({
            elevationRows: rows,
            patch,
            originCol: block.originCol,
            originRow: block.originRow,
            hardAuthoritativeCells,
            repairIsolatedSpikes: false
        });
        appliedCells += result.appliedCells;
        protectedCells += result.preservedCells;
        repairedCells += result.repairedSpikes;
        moduleHistogram[patch.tileId] = (moduleHistogram[patch.tileId] || 0) + 1;
        familyHistogram[patch.family] = (familyHistogram[patch.family] || 0) + 1;
        assignments.push({
            macroCol: block.macroCol,
            macroRow: block.macroRow,
            tileId: patch.tileId,
            family: patch.family,
            baseElevation: patch.baseElevation,
            reliefScore: round(block.reliefProfile.reliefScore, 4),
            insideWall: block.insideWallRatio > 0
        });
    }

    const transitions = applyTerrainMacroTransitions({
        rows,
        fields,
        width,
        height,
        seed,
        constraintField,
        hardAuthoritativeCells
    });
    appliedCells += transitions.appliedCells;
    protectedCells += transitions.protectedCells;
    repairedCells += transitions.repairedCells;

    const assignmentHash = macroCollapse.diagnostics.assignmentHash || hashWaveSeed(assignments
        .map((entry) => `${entry.macroCol},${entry.macroRow}:${entry.tileId}@${entry.baseElevation}`)
        .join('|'))
        .toString(16)
        .padStart(8, '0');
    const assignedBaseElevations = assignments.map((entry) => entry.baseElevation);
    const targetBaseElevations = blocks.map((block) => block.baseElevation);
    const insideWallBaseElevations = assignments
        .filter((entry) => entry.insideWall)
        .map((entry) => entry.baseElevation);
    return {
        rows,
        hardAuthoritativeCells,
        diagnostics: {
            libraryVersion: TERRAIN_MACRO_TILE_LIBRARY_VERSION,
            primarySize: TERRAIN_PRIMARY_MACRO_SIZE,
            transitionSize: TERRAIN_TRANSITION_MACRO_SIZE,
            globalAnchor: true,
            macroGridWidth: macroWidth,
            macroGridHeight: macroHeight,
            primaryModules: assignments.length,
            transitionModules: transitions.count,
            semanticTransitionModules: transitions.semanticCount,
            seamTransitionModules: transitions.seamCount,
            appliedCells,
            protectedCells,
            repairedCells,
            assignmentHash,
            expandedBaseDomain,
            solved: macroCollapse.solved,
            incompatibleEdges: macroCollapse.diagnostics.incompatibleEdgeCount,
            compatibilityChecks: macroCollapse.diagnostics.compatibilityChecks,
            contradictions: macroCollapse.diagnostics.contradictions,
            fallbacks: macroCollapse.diagnostics.fallbackCount,
            fallbackAssignments: macroCollapse.diagnostics.fallbackAssignments,
            baseElevationMinimum: assignedBaseElevations.length ? Math.min(...assignedBaseElevations) : 0,
            baseElevationMaximum: assignedBaseElevations.length ? Math.max(...assignedBaseElevations) : 0,
            targetBaseElevationMinimum: targetBaseElevations.length ? Math.min(...targetBaseElevations) : 0,
            targetBaseElevationMaximum: targetBaseElevations.length ? Math.max(...targetBaseElevations) : 0,
            insideWallBaseElevationMinimum: insideWallBaseElevations.length
                ? Math.min(...insideWallBaseElevations)
                : null,
            insideWallBaseElevationMaximum: insideWallBaseElevations.length
                ? Math.max(...insideWallBaseElevations)
                : null,
            moduleHistogram: Object.freeze(moduleHistogram),
            familyHistogram: Object.freeze(familyHistogram)
        }
    };
}

function repairTerrainMacroSpikes(rows, tileIds, width, height, protectedIds) {
    let repaired = 0;
    for (let pass = 0; pass < 8; pass++) {
        const spikes = findIsolatedElevationSpikes(rows).filter((cell) => {
            const id = cell.row * width + cell.col;
            return !protectedIds.has(id) && !GEOGRAPHIC_TILE_BY_ID.get(tileIds[id])?.tags.has('water');
        });
        if (!spikes.length) break;
        for (const spike of spikes) {
            const neighbors = CARDINALS
                .map(({ x, y }) => Number(rows[spike.row + y]?.[spike.col + x]))
                .filter(Number.isFinite);
            if (neighbors.length < 2) continue;
            rows[spike.row][spike.col] = spike.kind === 'peak'
                ? Math.max(...neighbors)
                : Math.min(...neighbors);
            repaired++;
        }
    }
    return repaired;
}

function describeTerrainMacroBlock({
    macroCol,
    macroRow,
    minimumGlobalCol,
    minimumGlobalRow,
    fields,
    tileIds,
    width,
    height,
    constraintField
}) {
    const globalOriginCol = macroCol * TERRAIN_PRIMARY_MACRO_SIZE;
    const globalOriginRow = macroRow * TERRAIN_PRIMARY_MACRO_SIZE;
    const originCol = globalOriginCol - minimumGlobalCol;
    const originRow = globalOriginRow - minimumGlobalRow;
    const samples = [];
    for (let localRow = 0; localRow < TERRAIN_PRIMARY_MACRO_SIZE; localRow++) {
        for (let localCol = 0; localCol < TERRAIN_PRIMARY_MACRO_SIZE; localCol++) {
            const col = originCol + localCol;
            const row = originRow + localRow;
            if (col < 0 || row < 0 || col >= width || row >= height) continue;
            const id = row * width + col;
            const field = fields[id] || {};
            const constraint = constraintField?.cells?.[id] || {};
            samples.push({
                localCol,
                localRow,
                field,
                constraint,
                water: GEOGRAPHIC_TILE_BY_ID.get(tileIds[id])?.tags.has('water') === true
            });
        }
    }
    const landSamples = samples.filter((sample) => !sample.water);
    const usefulSamples = landSamples.length ? landSamples : samples;
    const fixedTiers = usefulSamples
        .map((sample) => Number(sample.constraint.fixedElevation))
        .filter(Number.isFinite);
    const authoredBaseTiers = usefulSamples
        .map((sample) => Number(sample.constraint.reliefBaseElevationTier))
        .filter(Number.isFinite);
    const sampledBaseTiers = usefulSamples.map((sample) =>
        clampInteger(Math.floor(((Number(sample.field.height) || 20) - 14) / 10), 0, 6));
    const baseSignals = [
        medianNumber(sampledBaseTiers, 0),
        authoredBaseTiers.length ? medianNumber(authoredBaseTiers, 0) : null,
        fixedTiers.length ? medianNumber(fixedTiers, 0) : null
    ].filter(Number.isFinite);
    const targetBaseElevation = clampInteger(Math.max(...baseSignals, 0), 0, 6);
    const reliefScores = usefulSamples
        .map((sample) => Number(sample.constraint.reliefScore))
        .filter(Number.isFinite);
    const heights = usefulSamples.map((sample) => Number(sample.field.height) || 20);
    const heightSpan = heights.length ? Math.max(...heights) - Math.min(...heights) : 0;
    const reliefScore = clamp01(reliefScores.length
        ? Math.max(...reliefScores)
        : 0.12 + heightSpan / 34);
    const authoredSpans = usefulSamples
        .map((sample) => Number(sample.constraint.reliefTargetTierSpan))
        .filter(Number.isFinite);
    const targetTierSpan = clampInteger(
        authoredSpans.length ? Math.max(...authoredSpans) : Math.round(reliefScore * 4),
        0,
        6
    );
    const profileSamples = usefulSamples.filter((sample) => sample.constraint.reliefGradientAxis);
    const gradient = profileSamples.length
        ? {
            axis: profileSamples[0].constraint.reliefGradientAxis,
            sign: Number(profileSamples[0].constraint.reliefGradientSign) < 0 ? -1 : 1
        }
        : deriveTerrainMacroGradient(usefulSamples);
    const insideWallRatio = usefulSamples.length
        ? usefulSamples.filter((sample) => sample.constraint.insideWall).length / usefulSamples.length
        : 0;
    const connectorRatio = usefulSamples.length
        ? usefulSamples.filter((sample) => isMacroConnectorConstraint(sample.constraint)).length / usefulSamples.length
        : 0;
    const waterRatio = samples.length
        ? samples.filter((sample) => sample.water || sample.constraint.hardWater).length / samples.length
        : 0;
    const allowedFamilies = insideWallRatio > 0 || connectorRatio >= 0.12
        // Roads and buildings are flattened locally after the macro collapse; forcing every
        // touched 5x5 block to `uniform` propagated one elevation across whole towns and erased
        // the FMG slope. Terraced/ramp modules retain broad block-scale relief while the later
        // infrastructure pass still guarantees level foundations and traversable routes.
        ? reliefScore >= 0.45
            ? ['uniform', 'terraced', 'ramp']
            : ['uniform', 'terraced']
        : waterRatio >= 0.28
            ? ['uniform', 'terraced', 'ramp']
            : reliefScore >= 0.68
                ? ['uniform', 'terraced', 'ramp', 'stair']
                : ['uniform', 'terraced', 'ramp'];
    return {
        macroCol,
        macroRow,
        originCol,
        originRow,
        targetBaseElevation,
        baseElevation: targetBaseElevation,
        fixedBase: fixedTiers.length > 0,
        insideWallRatio,
        allowedFamilies,
        reliefProfile: {
            formulaVersion: FMG_BURG_RELIEF_FORMULA_VERSION,
            reliefScore,
            targetTierSpan,
            baseElevationTier: targetBaseElevation,
            gradientAxis: gradient.axis,
            gradientSign: gradient.sign
        }
    };
}

function deriveTerrainMacroGradient(samples) {
    const west = samples.filter((sample) => sample.localCol <= 1);
    const east = samples.filter((sample) => sample.localCol >= 3);
    const north = samples.filter((sample) => sample.localRow <= 1);
    const south = samples.filter((sample) => sample.localRow >= 3);
    const eastWestDelta = meanSampleHeight(east) - meanSampleHeight(west);
    const northSouthDelta = meanSampleHeight(south) - meanSampleHeight(north);
    return Math.abs(eastWestDelta) >= Math.abs(northSouthDelta)
        ? { axis: 'east-west', sign: eastWestDelta < 0 ? -1 : 1 }
        : { axis: 'north-south', sign: northSouthDelta < 0 ? -1 : 1 };
}

function meanSampleHeight(samples) {
    if (!samples.length) return 0;
    return samples.reduce((sum, sample) => sum + (Number(sample.field.height) || 20), 0) / samples.length;
}

function stabilizeTerrainMacroBases(blocks) {
    // Use one synchronous, bounded neighborhood sample. Repeated frame-local relaxation let a
    // viewport edge influence blocks many modules away and caused overlapping clients to disagree
    // at 5x5/8x8 frame boundaries. Actual neighbor compatibility is now solved by the macro WFC.
    const rawBaseByKey = new Map(blocks.map((block) => [
        `${block.macroCol},${block.macroRow}`,
        block.targetBaseElevation
    ]));
    const updates = new Map();
    for (const block of blocks) {
        const neighborhood = [
            block.targetBaseElevation,
            ...CARDINALS.map(({ x, y }) =>
                rawBaseByKey.get(`${block.macroCol + x},${block.macroRow + y}`))
                .filter(Number.isFinite)
        ];
        updates.set(block, clampInteger(medianNumber(neighborhood, block.targetBaseElevation), 0, 6));
    }
    for (const [block, value] of updates) {
        block.baseElevation = value;
        block.reliefProfile.baseElevationTier = block.baseElevation;
    }
}

function applyTerrainMacroTransitions({
    rows,
    fields,
    width,
    height,
    seed,
    constraintField,
    hardAuthoritativeCells
}) {
    const candidates = [];
    const seen = new Set();
    const addCandidate = (col, row, kind) => {
        if (col <= 0 || row <= 0 || col >= width - 1 || row >= height - 1) return;
        const field = fields[row * width + col];
        const globalCol = Number.isFinite(field?.globalCol) ? field.globalCol : col;
        const globalRow = Number.isFinite(field?.globalRow) ? field.globalRow : row;
        const bucket = `${Math.floor(globalCol / TERRAIN_TRANSITION_MACRO_SIZE)},` +
            `${Math.floor(globalRow / TERRAIN_TRANSITION_MACRO_SIZE)}`;
        if (seen.has(bucket)) return;
        seen.add(bucket);
        candidates.push({ col, row, kind });
    };
    for (let row = 0; row < height; row++) {
        for (let col = 0; col < width; col++) {
            const id = row * width + col;
            const constraint = constraintField?.cells?.[id];
            if (isMacroConnectorConstraint(constraint)) addCandidate(col, row, 'semantic');
            const globalCol = fields[id]?.globalCol;
            const globalRow = fields[id]?.globalRow;
            if (Number.isFinite(globalCol) && globalCol % TERRAIN_PRIMARY_MACRO_SIZE === 0 && col > 0 &&
                Math.abs(rows[row][col] - rows[row][col - 1]) > 1) addCandidate(col, row, 'seam');
            if (Number.isFinite(globalRow) && globalRow % TERRAIN_PRIMARY_MACRO_SIZE === 0 && row > 0 &&
                Math.abs(rows[row][col] - rows[row - 1][col]) > 1) addCandidate(col, row, 'seam');
        }
    }

    let appliedCells = 0;
    let protectedCells = 0;
    let repairedCells = 0;
    let semanticCount = 0;
    let seamCount = 0;
    for (const candidate of candidates) {
        const local = [];
        for (let row = candidate.row - 1; row <= candidate.row + 1; row++) {
            for (let col = candidate.col - 1; col <= candidate.col + 1; col++) {
                if (Number.isFinite(rows[row]?.[col])) local.push({ col, row, elevation: rows[row][col] });
            }
        }
        if (!local.length) continue;
        const minimum = Math.min(...local.map((entry) => entry.elevation));
        const maximum = Math.max(...local.map((entry) => entry.elevation));
        if (maximum - minimum <= 1) continue;
        const gradient = deriveElevationGradient(local, candidate.col, candidate.row);
        const patch = createDeterministicTerrainMacroPatch({
            seed: `${seed}:terrain-transition:${candidate.kind}:${fields[candidate.row * width + candidate.col]?.globalCol}:` +
                `${fields[candidate.row * width + candidate.col]?.globalRow}`,
            reliefProfile: {
                formulaVersion: FMG_BURG_RELIEF_FORMULA_VERSION,
                reliefScore: clamp01((maximum - minimum) / 3),
                targetTierSpan: clampInteger(maximum - minimum, 0, 2),
                baseElevationTier: minimum,
                gradientAxis: gradient.axis,
                gradientSign: gradient.sign
            },
            role: 'transition',
            baseElevation: minimum,
            minimumElevation: 0,
            maximumElevation: 6,
            allowedFamilies: maximum === minimum
                ? ['uniform']
                : ['terraced', 'ramp', 'stair', 'uniform']
        });
        if (!patch) continue;
        const result = applyTerrainMacroTileToElevationRows({
            elevationRows: rows,
            patch,
            originCol: candidate.col - 1,
            originRow: candidate.row - 1,
            hardAuthoritativeCells,
            repairIsolatedSpikes: true
        });
        appliedCells += result.appliedCells;
        protectedCells += result.preservedCells;
        repairedCells += result.repairedSpikes;
        if (candidate.kind === 'semantic') semanticCount++;
        else seamCount++;
    }
    return {
        count: semanticCount + seamCount,
        semanticCount,
        seamCount,
        appliedCells,
        protectedCells,
        repairedCells
    };
}

function deriveElevationGradient(samples, centerCol, centerRow) {
    const west = samples.filter((sample) => sample.col < centerCol).map((sample) => sample.elevation);
    const east = samples.filter((sample) => sample.col > centerCol).map((sample) => sample.elevation);
    const north = samples.filter((sample) => sample.row < centerRow).map((sample) => sample.elevation);
    const south = samples.filter((sample) => sample.row > centerRow).map((sample) => sample.elevation);
    const eastWestDelta = medianNumber(east, 0) - medianNumber(west, 0);
    const northSouthDelta = medianNumber(south, 0) - medianNumber(north, 0);
    return Math.abs(eastWestDelta) >= Math.abs(northSouthDelta)
        ? { axis: 'east-west', sign: eastWestDelta < 0 ? -1 : 1 }
        : { axis: 'north-south', sign: northSouthDelta < 0 ? -1 : 1 };
}

function isMacroConnectorConstraint(constraint) {
    if (!constraint) return false;
    const kind = constraint.skeletonKind || constraint.kind;
    return ['road', 'gate', 'bridge', 'ford', 'dock', 'castle-plot', 'waterfall'].includes(kind);
}

function medianNumber(values, fallback = 0) {
    const numeric = values.map(Number).filter(Number.isFinite).sort((left, right) => left - right);
    if (!numeric.length) return fallback;
    const middle = Math.floor(numeric.length / 2);
    return numeric.length % 2 === 0 ? (numeric[middle - 1] + numeric[middle]) / 2 : numeric[middle];
}

function relaxElevationRamps(rows, tileIds, width, height, protectedIds = new Set()) {
    // Six tiers is the full elevation range, so twelve alternating passes are enough for any
    // compatible fixed source ridge to propagate through its required ramp apron.
    for (let pass = 0; pass < 12; pass++) {
        let changes = 0;
        const rowStart = pass % 2 === 0 ? 0 : height - 1;
        const rowEnd = pass % 2 === 0 ? height : -1;
        const rowStep = pass % 2 === 0 ? 1 : -1;
        const colStart = pass % 2 === 0 ? 0 : width - 1;
        const colEnd = pass % 2 === 0 ? width : -1;
        const colStep = pass % 2 === 0 ? 1 : -1;
        for (let row = rowStart; row !== rowEnd; row += rowStep) {
            for (let col = colStart; col !== colEnd; col += colStep) {
                const id = row * width + col;
                const spec = GEOGRAPHIC_TILE_BY_ID.get(tileIds[id]);
                if (spec?.tags.has('water')) continue;
                for (const [dx, dy] of [[1, 0], [0, 1]]) {
                    const neighborCol = col + dx;
                    const neighborRow = row + dy;
                    if (neighborCol >= width || neighborRow >= height) continue;
                    const neighborId = neighborRow * width + neighborCol;
                    const neighborSpec = GEOGRAPHIC_TILE_BY_ID.get(tileIds[neighborId]);
                    if (neighborSpec?.tags.has('water')) continue;
                    const value = Number(rows[row]?.[col]) || 0;
                    const neighborValue = Number(rows[neighborRow]?.[neighborCol]) || 0;
                    if (Math.abs(value - neighborValue) <= 1) continue;
                    const protectedValue = protectedIds.has(id);
                    const protectedNeighbor = protectedIds.has(neighborId);
                    if (protectedValue && protectedNeighbor) continue;
                    if (protectedValue) {
                        rows[neighborRow][neighborCol] = value + Math.sign(neighborValue - value);
                    } else if (protectedNeighbor) {
                        rows[row][col] = neighborValue + Math.sign(value - neighborValue);
                    } else if (value > neighborValue) {
                        rows[row][col] = neighborValue + 1;
                    } else {
                        rows[neighborRow][neighborCol] = value + 1;
                    }
                    changes++;
                }
            }
        }
        if (changes === 0) break;
    }
}

// Lookup into the partial baked chunk registry by global sample-grid coordinates. Baked cores are
// keyed on the same rounded global grid the field sampler uses, so any view window that overlaps a
// settlement core aligns cell-for-cell regardless of where the view is centered.
function getBakedPartialCell(field, enabled = true) {
    if (!enabled || !ACTIVE_PARTIAL_CHUNK_REGISTRY) return null;
    return getPartialChunkCell(ACTIVE_PARTIAL_CHUNK_REGISTRY, field, WORLD_SAMPLE_SCALE);
}

function smoothTerraceClusters(rows, tileIds, width, height) {
    for (let pass = 0; pass < 3; pass++) {
        const next = rows.map((row) => row.slice());
        for (let row = 0; row < height; row++) {
            for (let col = 0; col < width; col++) {
                const spec = GEOGRAPHIC_TILE_BY_ID.get(tileIds[row * width + col]);
                if (spec?.tags.has('water')) continue;
                const neighbors = [];
                for (let oy = -1; oy <= 1; oy++) {
                    for (let ox = -1; ox <= 1; ox++) {
                        const neighborSpec = GEOGRAPHIC_TILE_BY_ID.get(tileIds[(row + oy) * width + col + ox]);
                        const value = rows[row + oy]?.[col + ox];
                        if (Number.isFinite(value) && !neighborSpec?.tags.has('water')) neighbors.push(value);
                    }
                }
                if (neighbors.length < 5) continue;
                neighbors.sort((a, b) => a - b);
                next[row][col] = neighbors[Math.floor(neighbors.length / 2)];
            }
        }
        for (let row = 0; row < height; row++) rows[row] = next[row];
    }
}

function overlayGeographicWaterAndRoutes(rows, paletteRows, elevationRows, fields, width, height, constraintField = null) {
    const mutable = rows.map((row) => row.split(''));
    for (let row = 0; row < height; row++) {
        for (let col = 0; col < width; col++) {
            if (constraintField?.cells?.[row * width + col]?.blueprintFixed) continue;
            const field = fields[row * width + col];
            if (field.riverPathInfluence >= 0.35 && field.land >= 0.42) {
                mutable[row][col] = field.riverPathInfluence > 0.72 ? '~' : 'B';
                paletteRows[row][col] = 'coast';
                // Rivers inherit the macro terrain tier and only cut a shallow channel. Dropping
                // every geographic river cell to sea level produced vertical trenches and broke
                // bridges whenever the FMG path crossed an elevated module.
                elevationRows[row][col] = deriveRiverChannelElevation(elevationRows, col, row);
            } else if (field.routeInfluence >= 0.63 && isLandSymbol(mutable[row][col])) {
                mutable[row][col] = 'R';
                paletteRows[row][col] = 'path';
                // Roads follow the selected macro surface; 3x3 connector aprons and the road
                // smoother handle tier changes without an arbitrary global height cap.
                elevationRows[row][col] = clampInteger(elevationRows[row][col], 0, 6);
            }
        }
    }
    repairFmgRiverOverlayContinuity({
        mutable,
        paletteRows,
        elevationRows,
        fields,
        width,
        height,
        constraintField
    });
    smoothRoadElevations(mutable, elevationRows);
    for (let row = 0; row < height; row++) rows[row] = mutable[row].join('');
}

function repairCroppedFmgRiverContinuity({
    rows,
    paletteRows,
    elevationRows,
    fields,
    width,
    height,
    constraintField,
    buildings = []
}) {
    const mutable = rows.map((row) => typeof row === 'string' ? row.split('') : [...row]);
    const blockedCells = new Set();
    const offsetX = Math.floor(width / 2);
    const offsetY = Math.floor(height / 2);
    for (const building of buildings || []) {
        for (const cell of building.footprintCells || []) {
            blockedCells.add(elevationCellKey(
                Number(building.x) + offsetX + cell.x,
                Number(building.y) + offsetY + cell.y
            ));
        }
    }
    repairFmgRiverOverlayContinuity({
        mutable,
        paletteRows,
        elevationRows,
        fields,
        width,
        height,
        constraintField,
        blockedCells
    });
    for (let row = 0; row < height; row++) rows[row] = mutable[row].join('');
}

function repairFmgRiverOverlayContinuity({
    mutable,
    paletteRows,
    elevationRows,
    fields,
    width,
    height,
    constraintField,
    blockedCells = new Set()
}) {
    const waterSymbols = new Set(['W', '~', 'B']);
    const riverCellsById = new Map();
    for (let row = 0; row < height; row++) {
        for (let col = 0; col < width; col++) {
            const field = fields[row * width + col];
            if (!waterSymbols.has(mutable[row]?.[col]) || field?.riverId === null ||
                field?.riverId === undefined || Number(field.riverPathInfluence) < 0.35) continue;
            const riverId = String(field.riverId);
            if (!riverCellsById.has(riverId)) riverCellsById.set(riverId, new Map());
            riverCellsById.get(riverId).set(elevationCellKey(col, row), { col, row });
        }
    }

    for (const [riverId, riverCells] of riverCellsById) {
        let components = splitLogicalCellComponents(riverCells);
        for (let repair = 0; repair < 8 && components.length > 1; repair++) {
            const pair = findClosestLogicalComponentPair(components);
            // Compact FMG sampling can leave two legitimate pieces of the same source river more
            // than one 5x5 module apart after roads/buildings are reserved. Reconnect within a
            // bounded four-module span; farther boundary fragments remain virtual/offscreen.
            if (!pair || pair.distance > 20) break;
            const touchesBoundary = [pair.leftComponentIndex, pair.rightComponentIndex].some((index) =>
                components[index]?.some((cell) => cell.col <= 2 || cell.row <= 2 ||
                    cell.col >= width - 3 || cell.row >= height - 3));
            if (touchesBoundary) break;
            const path = findRiverCarvePath({
                start: pair.left,
                end: pair.right,
                riverId,
                mutable,
                fields,
                width,
                height,
                constraintField,
                blockedCells,
                maximumDistance: pair.distance + 12
            });
            if (!path) break;
            for (const cell of path) {
                const id = cell.row * width + cell.col;
                const constraint = constraintField?.cells?.[id];
                if (['road', 'gate', 'bridge', 'ford', 'dock', 'waterfall'].includes(
                    constraint?.skeletonKind || constraint?.kind
                )) continue;
                const numericRiverId = Number(riverId);
                fields[id].riverId = Number.isFinite(numericRiverId) ? numericRiverId : riverId;
                fields[id].riverPathInfluence = Math.max(0.36, Number(fields[id].riverPathInfluence) || 0);
                fields[id].riverInfluence = Math.max(
                    fields[id].riverPathInfluence,
                    Number(fields[id].riverInfluence) || 0
                );
                mutable[cell.row][cell.col] = Number(fields[id]?.riverPathInfluence) > 0.72 ? '~' : 'B';
                paletteRows[cell.row][cell.col] = 'coast';
                elevationRows[cell.row][cell.col] = deriveRiverChannelElevation(
                    elevationRows,
                    cell.col,
                    cell.row
                );
                riverCells.set(elevationCellKey(cell.col, cell.row), { col: cell.col, row: cell.row });
            }
            components = splitLogicalCellComponents(riverCells);
        }
    }
}

function findClosestLogicalComponentPair(components) {
    let closest = null;
    for (let leftIndex = 0; leftIndex < components.length; leftIndex++) {
        for (let rightIndex = leftIndex + 1; rightIndex < components.length; rightIndex++) {
            for (const left of components[leftIndex]) {
                for (const right of components[rightIndex]) {
                    const distance = manhattanGridDistance(left, right);
                    if (!closest || distance < closest.distance || (
                        distance === closest.distance && (
                            left.row < closest.left.row ||
                            (left.row === closest.left.row && left.col < closest.left.col)
                        )
                    )) closest = {
                        left,
                        right,
                        distance,
                        leftComponentIndex: leftIndex,
                        rightComponentIndex: rightIndex
                    };
                }
            }
        }
    }
    return closest;
}

function findRiverCarvePath({
    start,
    end,
    riverId,
    mutable,
    fields,
    width,
    height,
    constraintField,
    blockedCells,
    maximumDistance
}) {
    const queue = [start];
    const startKey = elevationCellKey(start.col, start.row);
    const endKey = elevationCellKey(end.col, end.row);
    const previous = new Map([[startKey, null]]);
    const distance = new Map([[startKey, 0]]);
    for (let index = 0; index < queue.length; index++) {
        const current = queue[index];
        const currentKey = elevationCellKey(current.col, current.row);
        if (currentKey === endKey) break;
        const nextDistance = distance.get(currentKey) + 1;
        if (nextDistance > maximumDistance) continue;
        const candidates = CARDINALS
            .map(({ x, y }) => ({ col: current.col + x, row: current.row + y }))
            .filter((cell) => cell.col >= 0 && cell.row >= 0 && cell.col < width && cell.row < height)
            .sort((left, right) => {
                const leftField = fields[left.row * width + left.col];
                const rightField = fields[right.row * width + right.col];
                const leftAffinity = String(leftField?.riverId) === riverId ? 2 :
                    Number(leftField?.riverPathInfluence) >= 0.18 ? 1 : 0;
                const rightAffinity = String(rightField?.riverId) === riverId ? 2 :
                    Number(rightField?.riverPathInfluence) >= 0.18 ? 1 : 0;
                return rightAffinity - leftAffinity ||
                    manhattanGridDistance(left, end) - manhattanGridDistance(right, end) ||
                    left.row - right.row || left.col - right.col;
            });
        for (const next of candidates) {
            const key = elevationCellKey(next.col, next.row);
            if (previous.has(key) || blockedCells?.has(key)) continue;
            const id = next.row * width + next.col;
            const constraint = constraintField?.cells?.[id];
            const kind = constraint?.skeletonKind || constraint?.kind;
            if (['wall', 'castle-plot'].includes(kind) || mutable[next.row]?.[next.col] === 'T') continue;
            previous.set(key, currentKey);
            distance.set(key, nextDistance);
            queue.push(next);
        }
    }
    if (!previous.has(endKey)) return null;
    const path = [];
    let cursor = endKey;
    while (cursor) {
        const [col, row] = cursor.split(',').map(Number);
        path.push({ col, row });
        cursor = previous.get(cursor);
    }
    return path.reverse();
}

function deriveRiverChannelElevation(elevationRows, col, row) {
    const current = clampInteger(elevationRows[row]?.[col], 0, 6);
    const neighbors = CARDINALS
        .map(({ x, y }) => Number(elevationRows[row + y]?.[col + x]))
        .filter(Number.isFinite);
    if (!neighbors.length) return current;
    return clampInteger(Math.min(current, medianNumber(neighbors, current)), 0, 6);
}

function enforceRequestedVectorElevations(rows, elevationRows, skeleton, buildings = []) {
    const protectedCells = new Set();
    const sourceElevationCells = [...(skeleton?.cells?.values?.() || [])].filter((cell) =>
        (cell.source === 'town-vector' || cell.elevationSource === 'town-vector') &&
        Number.isFinite(Number(cell.elevationTier)) &&
        elevationRows[cell.row]?.[cell.col] !== undefined);
    // The source tier is a relief target, not a literal per-cell override. Use the already
    // collapsed macro surface at vector cells when fitting foundations so a building inherits
    // the playable street rather than resurrecting a cliff from adjacent raw FMG samples.
    const sourceElevationByKey = new Map(sourceElevationCells.map((cell) => [
        elevationCellKey(cell.col, cell.row),
        clampInteger(elevationRows[cell.row]?.[cell.col], 0, 6)
    ]));
    const offsetX = Math.floor((rows[0]?.length || 0) / 2);
    const offsetY = Math.floor(rows.length / 2);
    for (const building of buildings || []) {
        const footprintCells = (building.footprintCells || []).map((cell) => ({
            col: Number(building.x) + offsetX + cell.x,
            row: Number(building.y) + offsetY + cell.y
        }));
        const neighboringVectorTiers = [];
        const overlappingVectorTiers = [];
        const footprintKeys = new Set(footprintCells.map((cell) => elevationCellKey(cell.col, cell.row)));
        for (const cell of footprintCells) {
            const overlappingTier = sourceElevationByKey.get(elevationCellKey(cell.col, cell.row));
            if (Number.isFinite(overlappingTier)) {
                neighboringVectorTiers.push(overlappingTier);
                overlappingVectorTiers.push(overlappingTier);
            }
            for (const { x, y } of CARDINALS) {
                const key = elevationCellKey(cell.col + x, cell.row + y);
                if (footprintKeys.has(key)) continue;
                const tier = sourceElevationByKey.get(key);
                if (Number.isFinite(tier)) neighboringVectorTiers.push(tier);
            }
        }
        let baseElevation = clampInteger(building.baseElevation, 0, 6);
        const uniqueOverlappingVectorTiers = [...new Set(overlappingVectorTiers)];
        if (uniqueOverlappingVectorTiers.length === 1) {
            baseElevation = uniqueOverlappingVectorTiers[0];
            building.baseElevation = baseElevation;
        } else if (neighboringVectorTiers.length) {
            const legalMinimum = Math.max(0, ...neighboringVectorTiers.map((tier) => tier - 1));
            const legalMaximum = Math.min(6, ...neighboringVectorTiers.map((tier) => tier + 1));
            if (legalMinimum <= legalMaximum) {
                const originalBaseElevation = baseElevation;
                baseElevation = clampInteger(baseElevation, legalMinimum, legalMaximum);
                building.baseElevation = baseElevation;
                building.placementConstraints = {
                    ...(building.placementConstraints || {}),
                    foundationAdjustedToVectorStreet: baseElevation !== originalBaseElevation,
                    neighboringVectorElevationMinimum: Math.min(...neighboringVectorTiers),
                    neighboringVectorElevationMaximum: Math.max(...neighboringVectorTiers)
                };
            }
        }
        for (const { col, row } of footprintCells) {
            if (elevationRows[row]?.[col] === undefined) continue;
            // The selected base tier is a real terrace foundation, not merely render metadata.
            // Re-leveling the accepted footprint here prevents a later overlapping settlement or
            // ramp pass from leaving a building straddling otherwise walkable one-tier changes.
            elevationRows[row][col] = baseElevation;
            protectedCells.add(elevationCellKey(col, row));
        }
        stabilizeBuildingDoorLanding({
            building,
            baseElevation,
            footprintKeys,
            rows,
            elevationRows,
            offsetX,
            offsetY,
            sourceElevationByKey,
            protectedCells
        });
    }
    if (protectedCells.size) {
        // Foundations and their 3x3 door landings are the only hard values here. FMG vectors have
        // already influenced the macro profile and remain free to settle onto a walkable ramp.
        relaxSymbolElevationRamps(rows, elevationRows, protectedCells);
    }
}

function stabilizeBuildingDoorLanding({
    building,
    baseElevation,
    footprintKeys,
    rows,
    elevationRows,
    offsetX,
    offsetY,
    sourceElevationByKey,
    protectedCells
}) {
    const approach = resolveBuildingApproachCell(building, offsetX, offsetY);
    if (!approach || elevationRows[approach.row]?.[approach.col] === undefined) return;
    const approachKey = elevationCellKey(approach.col, approach.row);
    const approachSymbol = rows[approach.row]?.[approach.col];
    if (!approachSymbol || approachSymbol === 'T' || isWaterSymbol(approachSymbol) ||
        footprintKeys.has(approachKey)) return;
    const fixedApproachTier = sourceElevationByKey.get(approachKey);
    if (Number.isFinite(fixedApproachTier)) {
        elevationRows[approach.row][approach.col] = fixedApproachTier;
    } else {
        // The cell immediately outside the door is a dedicated 3x3 transition-module landing.
        // Its center shares the foundation tier; apron cells may differ by one for stairs/ramps.
        elevationRows[approach.row][approach.col] = baseElevation;
    }
    protectedCells.add(approachKey);
    let apronCells = 0;
    for (let row = approach.row - 1; row <= approach.row + 1; row++) {
        for (let col = approach.col - 1; col <= approach.col + 1; col++) {
            const key = elevationCellKey(col, row);
            const symbol = rows[row]?.[col];
            if (!symbol || symbol === 'T' || isWaterSymbol(symbol) || footprintKeys.has(key) ||
                protectedCells.has(key)) continue;
            if (sourceElevationByKey.has(key)) continue;
            elevationRows[row][col] = clampInteger(elevationRows[row][col], baseElevation - 1, baseElevation + 1);
            protectedCells.add(key);
            apronCells++;
        }
    }
    const finalApproachElevation = Number(elevationRows[approach.row][approach.col]);
    building.doorBaseElevation = baseElevation;
    building.placementConstraints = {
        ...(building.placementConstraints || {}),
        macroDoorLanding: true,
        macroDoorLandingSize: `${TERRAIN_TRANSITION_MACRO_SIZE}x${TERRAIN_TRANSITION_MACRO_SIZE}`,
        macroDoorLandingCells: apronCells,
        exteriorApproachElevation: finalApproachElevation,
        exteriorApproachElevationDelta: Math.abs(finalApproachElevation - baseElevation)
    };
}

function resolveBuildingApproachCell(building, offsetX, offsetY) {
    const [gridCol, gridRow] = building.entrance?.approachGrid || [];
    if (Number.isFinite(gridCol) && Number.isFinite(gridRow)) {
        return { col: Number(gridCol), row: Number(gridRow) };
    }
    const local = building.exteriorApproach || (
        Number.isFinite(building.entrance?.x) && Number.isFinite(building.entrance?.y)
            ? building.entrance
            : null
    );
    if (local && Number.isFinite(local.x) && Number.isFinite(local.y)) {
        return { col: Number(local.x) + offsetX, row: Number(local.y) + offsetY };
    }
    if (!building.door?.edge) return null;
    const rect = {
        col: Number(building.x) + offsetX,
        row: Number(building.y) + offsetY,
        width: Number(building.width),
        height: Number(building.height)
    };
    return getRectDoorApproach(rect, building.door.edge);
}

function prepareBuildingInfrastructureAnchors({ rows, paletteRows, buildings, fields = [], width, height }) {
    const mutable = rows.map((row) => typeof row === 'string' ? row.split('') : [...row]);
    const roadSymbols = WORLD_ROAD_SYMBOLS;
    const offsetX = Math.floor(width / 2);
    const offsetY = Math.floor(height / 2);
    let footprintCells = 0;
    let buriedRoadCellsCleared = 0;
    let waterConflicts = 0;
    let doorRoadLandings = 0;
    let existingDoorRoadLandings = 0;
    let bridgeDoorLandings = 0;
    let blockedDoorLandings = 0;

    for (const building of buildings || []) {
        for (const cell of getBuildingFootprintCells(building)) {
            const col = Number(building.x) + offsetX + cell.x;
            const row = Number(building.y) + offsetY + cell.y;
            const symbol = mutable[row]?.[col];
            if (symbol === undefined) continue;
            footprintCells++;
            if (roadSymbols.has(symbol)) {
                // A road under a roof is neither visible nor traversable. Remove it before the
                // network completion pass so the solver must route around the occupied parcel.
                mutable[row][col] = '.';
                buriedRoadCellsCleared++;
            } else if (isWaterSymbol(symbol)) {
                waterConflicts++;
            }
        }
    }

    for (const building of buildings || []) {
        const approach = resolveBuildingApproachCell(building, offsetX, offsetY);
        if (!approach || approach.col < 0 || approach.row < 0 ||
            approach.col >= width || approach.row >= height) {
            blockedDoorLandings++;
            continue;
        }
        const symbol = mutable[approach.row]?.[approach.col];
        if (roadSymbols.has(symbol)) {
            existingDoorRoadLandings++;
            continue;
        }
        const id = approach.row * width + approach.col;
        const canUseBridgeLanding = ['~', 'B'].includes(symbol) &&
            fields[id]?.riverId !== null && fields[id]?.riverId !== undefined;
        if (canUseBridgeLanding) {
            mutable[approach.row][approach.col] = '=';
            if (paletteRows[approach.row]?.[approach.col] !== undefined) {
                paletteRows[approach.row][approach.col] = 'path';
            }
            bridgeDoorLandings++;
            continue;
        }
        if (!symbol || symbol === 'T' || isWaterSymbol(symbol)) {
            blockedDoorLandings++;
            continue;
        }
        mutable[approach.row][approach.col] = 'R';
        if (paletteRows[approach.row]?.[approach.col] !== undefined) {
            paletteRows[approach.row][approach.col] = 'path';
        }
        doorRoadLandings++;
    }

    for (let row = 0; row < height; row++) rows[row] = mutable[row].join('');
    return Object.freeze({
        footprintCells,
        buriedRoadCellsCleared,
        waterConflicts,
        doorRoadLandings,
        existingDoorRoadLandings,
        bridgeDoorLandings,
        blockedDoorLandings,
        reservedBeforeTerrainWfc: true
    });
}

function collectBuildingFootprintKeys(buildings, width, height) {
    const keys = new Set();
    const offsetX = Math.floor(width / 2);
    const offsetY = Math.floor(height / 2);
    for (const building of buildings || []) {
        for (const cell of getBuildingFootprintCells(building)) {
            const col = Number(building.x) + offsetX + cell.x;
            const row = Number(building.y) + offsetY + cell.y;
            if (col < 0 || row < 0 || col >= width || row >= height) continue;
            keys.add(elevationCellKey(col, row));
        }
    }
    return keys;
}

function getBuildingFootprintCells(building) {
    if (Array.isArray(building?.footprintCells) && building.footprintCells.length) {
        return building.footprintCells;
    }
    const width = Math.max(0, Math.floor(Number(building?.width) || 0));
    const height = Math.max(0, Math.floor(Number(building?.height) || 0));
    return Array.from({ length: width * height }, (_, index) => ({
        x: index % width,
        y: Math.floor(index / width)
    }));
}

function connectWorldRoadNetwork({ rows, paletteRows, buildings, fields = [], width, height }) {
    const roadSymbols = WORLD_ROAD_SYMBOLS;
    const blocked = new Set();
    const offsetX = Math.floor(width / 2);
    const offsetY = Math.floor(height / 2);
    for (const building of buildings || []) {
        for (const cell of building.footprintCells || []) {
            blocked.add(elevationCellKey(
                Number(building.x) + offsetX + cell.x,
                Number(building.y) + offsetY + cell.y
            ));
        }
    }
    const mutable = rows.map((row) => typeof row === 'string' ? row.split('') : [...row]);
    const components = collectRoadSymbolComponents(mutable, roadSymbols, width, height);
    if (components.length < 2) return Object.freeze({ connectedComponents: 0, carvedCells: 0 });
    const main = components[0];
    const mainKeys = new Set(main.map((cell) => elevationCellKey(cell.col, cell.row)));
    const approachKeys = new Set((buildings || [])
        .map((building) => resolveBuildingApproachCell(building, offsetX, offsetY))
        .filter(Boolean)
        .map((cell) => elevationCellKey(cell.col, cell.row)));
    let connectedComponents = 0;
    let carvedCells = 0;
    let bridgeDeckCells = 0;
    let clearedOrphanCells = 0;

    for (const component of components.slice(1)) {
        const touchesViewportEdge = component.some((cell) =>
            cell.col <= 2 || cell.row <= 2 || cell.col >= width - 3 || cell.row >= height - 3);
        const servesDoor = component.some((cell) => approachKeys.has(elevationCellKey(cell.col, cell.row)));
        if (touchesViewportEdge && !servesDoor) continue;
        let path = findRoadCarvePath({
            mutable,
            starts: component,
            goalKeys: mainKeys,
            blocked,
            width,
            height,
            maximumDistance: width + height
        });
        if (!path) {
            path = findBridgeRoadCarvePath({
                mutable,
                starts: component,
                goalKeys: mainKeys,
                blocked,
                fields,
                width,
                height,
                maximumDistance: width + height,
                maximumRiverCells: 3
            });
        }
        if (!path) {
            // A tiny internal road island has no navigational or visual utility. Remove it rather
            // than leaving a prefab stair/landing fragment stranded between water and buildings.
            if (!touchesViewportEdge && !servesDoor && component.length <= 8) {
                for (const cell of component) {
                    mutable[cell.row][cell.col] = '.';
                    clearedOrphanCells++;
                }
            }
            continue;
        }
        for (const cell of path) {
            const key = elevationCellKey(cell.col, cell.row);
            if (!roadSymbols.has(mutable[cell.row]?.[cell.col])) {
                const id = cell.row * width + cell.col;
                const crossesFmgRiver = ['~', 'B'].includes(mutable[cell.row]?.[cell.col]) &&
                    fields[id]?.riverId !== null && fields[id]?.riverId !== undefined &&
                    Number(fields[id]?.riverPathInfluence) >= 0.35;
                mutable[cell.row][cell.col] = crossesFmgRiver ? '=' : 'R';
                if (paletteRows[cell.row]?.[cell.col] !== undefined) paletteRows[cell.row][cell.col] = 'path';
                carvedCells++;
                if (crossesFmgRiver) bridgeDeckCells++;
            }
            mainKeys.add(key);
        }
        for (const cell of component) mainKeys.add(elevationCellKey(cell.col, cell.row));
        connectedComponents++;
    }
    for (let row = 0; row < height; row++) rows[row] = mutable[row].join('');
    return Object.freeze({ connectedComponents, carvedCells, bridgeDeckCells, clearedOrphanCells });
}

function collectRoadSymbolComponents(rows, roadSymbols, width, height) {
    const remaining = new Set();
    for (let row = 0; row < height; row++) {
        for (let col = 0; col < width; col++) {
            if (roadSymbols.has(rows[row]?.[col])) remaining.add(elevationCellKey(col, row));
        }
    }
    const components = [];
    while (remaining.size) {
        const startKey = [...remaining].sort(compareElevationCellKeys)[0];
        const [startCol, startRow] = startKey.split(',').map(Number);
        const queue = [{ col: startCol, row: startRow }];
        const component = [];
        remaining.delete(startKey);
        for (let index = 0; index < queue.length; index++) {
            const current = queue[index];
            component.push(current);
            for (const { x, y } of CARDINALS) {
                const neighbor = { col: current.col + x, row: current.row + y };
                const key = elevationCellKey(neighbor.col, neighbor.row);
                if (!remaining.has(key)) continue;
                remaining.delete(key);
                queue.push(neighbor);
            }
        }
        components.push(component.sort((left, right) => left.row - right.row || left.col - right.col));
    }
    return components.sort((left, right) => right.length - left.length ||
        left[0].row - right[0].row || left[0].col - right[0].col);
}

function findRoadCarvePath({ mutable, starts, goalKeys, blocked, width, height, maximumDistance }) {
    const queue = [];
    const previous = new Map();
    const distance = new Map();
    for (const start of starts) {
        const key = elevationCellKey(start.col, start.row);
        queue.push(start);
        previous.set(key, null);
        distance.set(key, 0);
    }
    let goalKey = null;
    for (let index = 0; index < queue.length; index++) {
        const current = queue[index];
        const currentKey = elevationCellKey(current.col, current.row);
        if (goalKeys.has(currentKey)) {
            goalKey = currentKey;
            break;
        }
        const nextDistance = distance.get(currentKey) + 1;
        if (nextDistance > maximumDistance) continue;
        for (const { x, y } of CARDINALS) {
            const next = { col: current.col + x, row: current.row + y };
            if (next.col < 0 || next.row < 0 || next.col >= width || next.row >= height) continue;
            const key = elevationCellKey(next.col, next.row);
            if (previous.has(key) || blocked.has(key)) continue;
            const symbol = mutable[next.row]?.[next.col];
            if (!symbol || symbol === 'T' || isWaterSymbol(symbol)) continue;
            previous.set(key, currentKey);
            distance.set(key, nextDistance);
            queue.push(next);
        }
    }
    if (!goalKey) return null;
    const path = [];
    let cursor = goalKey;
    while (cursor) {
        const [col, row] = cursor.split(',').map(Number);
        path.push({ col, row });
        cursor = previous.get(cursor);
    }
    return path.reverse();
}

function findBridgeRoadCarvePath({
    mutable,
    starts,
    goalKeys,
    blocked,
    fields,
    width,
    height,
    maximumDistance,
    maximumRiverCells
}) {
    const queue = [];
    const previous = new Map();
    const stateByKey = new Map();
    for (const start of starts) {
        const state = { col: start.col, row: start.row, distance: 0, riverCells: 0 };
        const stateKey = `${elevationCellKey(start.col, start.row)}|0`;
        queue.push(stateKey);
        stateByKey.set(stateKey, state);
        previous.set(stateKey, null);
    }
    let goalStateKey = null;
    for (let index = 0; index < queue.length; index++) {
        const stateKey = queue[index];
        const current = stateByKey.get(stateKey);
        const currentCellKey = elevationCellKey(current.col, current.row);
        if (goalKeys.has(currentCellKey)) {
            goalStateKey = stateKey;
            break;
        }
        if (current.distance >= maximumDistance) continue;
        for (const { x, y } of CARDINALS) {
            const col = current.col + x;
            const row = current.row + y;
            const cellKey = elevationCellKey(col, row);
            if (col < 0 || row < 0 || col >= width || row >= height || blocked.has(cellKey)) continue;
            const symbol = mutable[row]?.[col];
            if (!symbol || symbol === 'T' || ['W', 'I'].includes(symbol)) continue;
            const id = row * width + col;
            const crossesRiver = ['~', 'B'].includes(symbol);
            if (crossesRiver && (fields[id]?.riverId === null || fields[id]?.riverId === undefined ||
                Number(fields[id]?.riverPathInfluence) < 0.35)) continue;
            const riverCells = current.riverCells + Number(crossesRiver);
            if (riverCells > maximumRiverCells) continue;
            const nextStateKey = `${cellKey}|${riverCells}`;
            if (previous.has(nextStateKey)) continue;
            previous.set(nextStateKey, stateKey);
            stateByKey.set(nextStateKey, {
                col,
                row,
                distance: current.distance + 1,
                riverCells
            });
            queue.push(nextStateKey);
        }
    }
    if (!goalStateKey) return null;
    const path = [];
    let cursor = goalStateKey;
    while (cursor) {
        const state = stateByKey.get(cursor);
        path.push({ col: state.col, row: state.row });
        cursor = previous.get(cursor);
    }
    return path.reverse();
}

function compareElevationCellKeys(left, right) {
    const [leftCol, leftRow] = left.split(',').map(Number);
    const [rightCol, rightRow] = right.split(',').map(Number);
    return leftRow - rightRow || leftCol - rightCol;
}

function stabilizeWorldInfrastructureElevations({
    rows,
    elevationRows,
    macroTerrainElevationRows,
    fields,
    skeleton,
    buildings,
    width,
    height
}) {
    const offsetX = Math.floor(width / 2);
    const offsetY = Math.floor(height / 2);
    const roadSymbols = WORLD_ROAD_SYMBOLS;
    const footprintKeys = new Set();
    const footprintCellsByBuilding = new Map();
    for (const building of buildings || []) {
        const cells = [];
        for (const cell of building.footprintCells || []) {
            const footprintCell = {
                col: Number(building.x) + offsetX + cell.x,
                row: Number(building.y) + offsetY + cell.y
            };
            cells.push(footprintCell);
            footprintKeys.add(elevationCellKey(
                footprintCell.col,
                footprintCell.row
            ));
        }
        footprintCellsByBuilding.set(building, cells);
    }

    // Every road, plaza street, gate lane, and bridge deck samples the same pre-overlay macro
    // surface. Raw FMG tiers still determine that surface at block scale, but cannot create a
    // literal one-cell cliff along a path.
    for (let row = 0; row < height; row++) {
        for (let col = 0; col < width; col++) {
            if (!roadSymbols.has(rows[row]?.[col]) || footprintKeys.has(elevationCellKey(col, row))) continue;
            elevationRows[row][col] = clampInteger(macroTerrainElevationRows[row]?.[col], 0, 6);
        }
    }

    smoothRoadElevations(rows, elevationRows);

    const protectedCells = new Set();
    for (let row = 0; row < height; row++) {
        for (let col = 0; col < width; col++) {
            if (roadSymbols.has(rows[row]?.[col])) protectedCells.add(elevationCellKey(col, row));
        }
    }

    // A door landing chooses the building foundation tier, never the other way around. That
    // keeps a door attached to its street even when a baked footprint overlaps a different raw
    // vector tier, and guarantees the complete footprint remains level.
    for (const building of buildings || []) {
        const footprintCells = footprintCellsByBuilding.get(building) || [];
        if (!footprintCells.length) continue;
        const approach = resolveBuildingApproachCell(building, offsetX, offsetY);
        const approachElevation = approach && elevationRows[approach.row]?.[approach.col] !== undefined
            ? clampInteger(elevationRows[approach.row][approach.col], 0, 6)
            : null;
        const footprintElevations = footprintCells
            .map((cell) => Number(elevationRows[cell.row]?.[cell.col]))
            .filter(Number.isFinite);
        const baseElevation = Number.isFinite(approachElevation)
            ? approachElevation
            : clampInteger(medianNumber(footprintElevations, building.baseElevation), 0, 6);
        building.baseElevation = baseElevation;
        building.doorBaseElevation = baseElevation;
        for (const cell of footprintCells) {
            if (elevationRows[cell.row]?.[cell.col] === undefined) continue;
            elevationRows[cell.row][cell.col] = baseElevation;
            protectedCells.add(elevationCellKey(cell.col, cell.row));
        }
        stabilizeBuildingDoorLanding({
            building,
            baseElevation,
            footprintKeys: new Set(footprintCells.map((cell) => elevationCellKey(cell.col, cell.row))),
            rows,
            elevationRows,
            offsetX,
            offsetY,
            sourceElevationByKey: new Map(),
            protectedCells
        });
        building.placementConstraints = {
            ...(building.placementConstraints || {}),
            foundationAdjustedToMacroRoad: true,
            exteriorApproachElevation: approachElevation,
            exteriorApproachElevationDelta: Number.isFinite(approachElevation)
                ? Math.abs(approachElevation - baseElevation)
                : null
        };
    }

    relaxSymbolElevationRamps(rows, elevationRows, protectedCells);
    smoothRoadElevations(rows, elevationRows, protectedCells);
}

function repairFinalWorldElevationSpikes({ rows, elevationRows, buildings, width, height }) {
    const protectedFootprints = new Set();
    const offsetX = Math.floor(width / 2);
    const offsetY = Math.floor(height / 2);
    for (const building of buildings || []) {
        for (const cell of building.footprintCells || []) {
            protectedFootprints.add(elevationCellKey(
                Number(building.x) + offsetX + cell.x,
                Number(building.y) + offsetY + cell.y
            ));
        }
    }
    let repairedCells = 0;
    const repairedBySymbol = {};
    for (let pass = 0; pass < 8; pass++) {
        const spikes = findIsolatedElevationSpikes(elevationRows).filter((cell) =>
            !protectedFootprints.has(elevationCellKey(cell.col, cell.row)));
        if (!spikes.length) break;
        let changed = 0;
        for (const spike of spikes) {
            const neighbors = CARDINALS
                .map(({ x, y }) => Number(elevationRows[spike.row + y]?.[spike.col + x]))
                .filter(Number.isFinite);
            if (neighbors.length < 2) continue;
            const replacement = spike.kind === 'peak'
                ? Math.max(...neighbors)
                : Math.min(...neighbors);
            if (replacement === elevationRows[spike.row][spike.col]) continue;
            const symbol = rows[spike.row]?.[spike.col] || '?';
            elevationRows[spike.row][spike.col] = clampInteger(replacement, 0, 6);
            repairedBySymbol[symbol] = (repairedBySymbol[symbol] || 0) + 1;
            repairedCells++;
            changed++;
        }
        if (!changed) break;
    }
    smoothRoadElevations(rows, elevationRows, protectedFootprints);
    return Object.freeze({
        repairedCells,
        repairedBySymbol: Object.freeze(repairedBySymbol)
    });
}

function synthesizeSettlements({
    rows,
    paletteRows,
    elevationRows,
    fields,
    centerX,
    centerY,
    width,
    height,
    seed,
    index,
    anchors = [],
    constraintField,
    skeleton
}) {
    const mutable = rows.map((row) => row.split(''));
    const offsetX = Math.floor(width / 2);
    const offsetY = Math.floor(height / 2);
    const occupied = new Set();
    const buildings = [];
    const settlements = [];
    const aggregate = {
        sites: 0,
        assignedBuildings: 0,
        bakedBuildings: 0,
        vectorBuildings: 0,
        rejectedVectorBuildings: 0,
        vectorRejectionReasons: {},
        fixedBakedAssignments: 0,
        compactAdjacencyFallbacks: 0,
        forcedBuildingAnchors: 0,
        walledAreas: 0,
        wallCells: 0,
        wallRings: 0,
        vectorWallSystems: 0,
        keeps: 0,
        wardWaves: 0,
        urbanAreaCells: 0,
        buildingFootprintCells: 0,
        fallbacks: 0
    };

    for (const sourceEntry of anchors) {
        const entry = { ...sourceEntry };
        const radius = entry.radius;
        if (entry.col < 3 || entry.row < 3 || entry.col >= width - 3 || entry.row >= height - 3) continue;
        const settlement = {
            ...entry,
            radius,
            reliefProfile: skeleton?.reliefByBurgId?.get?.(Number(entry.burg?.id)) ||
                constraintField?.reliefByBurgId?.get?.(Number(entry.burg?.id)) || null,
            architectureThemeId: normalizeBurgThemeId(
                entry.architectureThemeId ??
                entry.themeId ??
                entry.burg?.themeId ??
                entry.blueprint?.identity?.architectureThemeId,
                null
            ),
            walled: entry.walled === true,
            wallBounds: entry.wallBounds,
            wallRings: entry.wallRings || [],
            wards: entry.wards || [],
            castle: entry.castle || null,
            accent: mixRegionalAccent(
                index.stateById.get(entry.burg.state)?.color,
                index.cultureById.get(entry.burg.culture)?.color
            )
        };
        const envelope = stampSettlementEnvelope({
            mutable,
            paletteRows,
            elevationRows,
            settlement,
            occupied,
            constraintField,
            skeleton,
            width,
            height
        });
        const districtRows = createSettlementDistrictRows({ mutable, settlement, width, height });
        const inhibitorRows = createPlacementInhibitorRows({
            mutable,
            elevationRows,
            settlement,
            plateau: envelope.plateau,
            constraintField,
            width,
            height
        });
        const bakedPlan = createWardBakedBuildingPlan({
            mutable,
            elevationRows,
            inhibitorRows,
            districtRows,
            settlement,
            occupied,
            skeleton,
            width,
            height,
            fixedSeed: `${ACTIVE_WORLD.seed}:fixed-landmarks:${settlement.burg.id}`
        });
        const parcelSites = createContextualParcelSites({
            mutable,
            elevationRows,
            fields,
            constraintField,
            settlement,
            occupied: bakedPlan.occupied,
            offsetX,
            offsetY,
            width,
            height,
            seed
        });
        const bakedWave = createBakedWaveAnchors({
            buildings: bakedPlan.buildings,
            settlement,
            fields,
            constraintField,
            offsetX,
            offsetY,
            width
        });
        const sites = [...bakedWave.sites, ...parcelSites];
        let contextual = {
            assignment: new Map(),
            buildings: [],
            diagnostics: {
                sites: sites.length,
                buildings: 0,
                forcedBuildingAnchors: 0,
                fallbacks: 0,
                moduleHistogram: {}
            }
        };
        if (sites.length) {
            const generatedMinimum = parcelSites.length && bakedPlan.diagnostics.vectorBuildings === 0
                ? Math.min(parcelSites.length, Math.max(1, Math.ceil(parcelSites.length * (settlement.walled ? 0.72 : 0.48))))
                : 0;
            const minimumBuildings = bakedWave.sites.length + generatedMinimum;
            const areas = createWardWaveAreas({
                settlement,
                sites,
                bakedSiteIds: bakedWave.siteIds,
                totalMinimum: minimumBuildings
            });
            contextual = solveContextualBuildingWFC({
                sites,
                areas,
                seed: `${seed}:building-wave:${settlement.burg.id}`,
                minimumBuildingsPerArea: minimumBuildings,
                modules: [...CONTEXTUAL_WFC_MODULES, ...bakedWave.modules],
                fixed: bakedWave.fixed
            });
        }
        applyContextualTerrainAssignments({
            assignment: contextual.assignment,
            sites: parcelSites,
            mutable,
            paletteRows,
            elevationRows,
            constraintField,
            settlement,
            occupied: bakedPlan.occupied,
            offsetX,
            offsetY
        });
        const generatedBuildings = contextual.buildings
            .filter((building) => !bakedWave.siteIds.has(building.siteId))
            .map((building, indexInTown) =>
            finalizeContextualBuilding({
                building,
                settlement,
                indexInTown,
                elevationRows,
                offsetX,
                offsetY,
                seed
            }));
        applySettlementWave(generatedBuildings, mutable.map((row) => row.join('')), elevationRows, settlement, seed);
        const bakedBuildings = bakedPlan.buildings.map((building) => ({
            ...building,
            preserveEntrance: true,
            enterable: true
        }));
        const localBuildings = [...bakedBuildings, ...generatedBuildings];
        applySettlementArchitectureThemeToBuildings(localBuildings, settlement, seed);
        applySettlementClimateToBuildings(localBuildings, settlement);
        for (const building of localBuildings) {
            reserveBuilding(occupied, building, offsetX, offsetY, 1);
            buildings.push(building);
        }
        const footprintCells = localBuildings.reduce((sum, building) =>
            sum + (building.footprintCells?.length || building.width * building.height), 0);
        const siteBuildingRatio = sites.length
            ? (generatedBuildings.length + bakedBuildings.length) / sites.length
            : 0;
        settlement.gates = envelope.gates;
        settlement.diagnostics = {
            sites: sites.length,
            generatedBuildings: generatedBuildings.length,
            bakedBuildings: bakedBuildings.length,
            vectorBuildings: bakedPlan.diagnostics.vectorBuildings,
            rejectedVectorBuildings: bakedPlan.diagnostics.rejectedVectorBuildings,
            fixedBakedAssignments: bakedWave.fixed.size,
            compactAdjacencyFallbacks: bakedPlan.diagnostics.compactAdjacencyFallbacks,
            forcedBuildingAnchors: contextual.diagnostics.forcedBuildingAnchors || 0,
            siteBuildingRatio,
            wallCells: envelope.wallCells,
            urbanAreaCells: envelope.urbanCells,
            constrainedInteriorCells: envelope.constrainedInteriorCells,
            buildingFootprintCells: footprintCells,
            moduleHistogram: contextual.diagnostics.moduleHistogram || {},
            reliefFormulaVersion: settlement.reliefProfile?.formulaVersion ?? FMG_BURG_RELIEF_FORMULA_VERSION,
            reliefScore: settlement.reliefProfile?.reliefScore ?? 0,
            reliefClass: settlement.reliefProfile?.reliefClass ?? 'none',
            targetElevationSpan: settlement.reliefProfile?.targetTierSpan ?? 1,
            buildingBaseElevationTiers: [...new Set(localBuildings
                .map((building) => Number(building.baseElevation))
                .filter(Number.isFinite))].sort((left, right) => left - right)
        };
        settlements.push(settlement);
        aggregate.sites += sites.length;
        aggregate.assignedBuildings += generatedBuildings.length + bakedBuildings.length;
        aggregate.bakedBuildings += bakedBuildings.length;
        aggregate.vectorBuildings += bakedPlan.diagnostics.vectorBuildings;
        aggregate.rejectedVectorBuildings += bakedPlan.diagnostics.rejectedVectorBuildings;
        for (const [reason, count] of Object.entries(bakedPlan.diagnostics.vectorRejectionReasons || {})) {
            aggregate.vectorRejectionReasons[reason] = (aggregate.vectorRejectionReasons[reason] || 0) + count;
        }
        aggregate.fixedBakedAssignments += bakedWave.fixed.size;
        aggregate.compactAdjacencyFallbacks += bakedPlan.diagnostics.compactAdjacencyFallbacks;
        aggregate.forcedBuildingAnchors += contextual.diagnostics.forcedBuildingAnchors || 0;
        aggregate.walledAreas += settlement.walled ? 1 : 0;
        aggregate.wallCells += envelope.wallCells;
        aggregate.wallRings += settlement.townVector?.wallCells?.length ? 0 : settlement.wallRings.length;
        aggregate.vectorWallSystems += settlement.townVector?.wallCells?.length ? 1 : 0;
        aggregate.keeps += bakedBuildings.filter((building) =>
            building.blueprintId === 'castle-keep' || building.vectorCastle).length;
        aggregate.wardWaves += new Set(sites.map((site) => site.areaId)).size;
        aggregate.urbanAreaCells += envelope.urbanCells;
        aggregate.buildingFootprintCells += footprintCells;
        aggregate.fallbacks += contextual.diagnostics.fallbacks || 0;
    }

    for (let row = 0; row < height; row++) rows[row] = mutable[row].join('');
    return {
        buildings,
        settlements,
        diagnostics: Object.freeze({
            ...aggregate,
            vectorRejectionReasons: Object.freeze({ ...aggregate.vectorRejectionReasons }),
            insideSiteBuildingRatio: aggregate.sites
                ? aggregate.assignedBuildings / aggregate.sites
                : 0,
            urbanFootprintRatio: aggregate.urbanAreaCells
                ? aggregate.buildingFootprintCells / aggregate.urbanAreaCells
                : 0,
            minimumInterior: '2x3',
            contradictions: 0
        })
    };
}

function applySettlementClimateToBuildings(buildings, settlement) {
    const latitude = Number(settlement.blueprint?.climate?.latitude) || 0;
    const snowline = Number(settlement.blueprint?.climate?.snowline) || 100;
    const cold = Math.abs(latitude) >= 45;
    const tropical = Math.abs(latitude) <= 14;
    for (const building of buildings) {
        building.climate = { latitude, snowline };
        building.roofTreatment = cold ? 'snow-capped' : tropical ? 'sun-bleached' : 'temperate';
        if (!building.architectureThemeId && cold && building.blueprintId !== 'castle-keep' && ['clay', 'market', 'thatch'].includes(building.roofStyle)) {
            building.roofStyle = hashWaveSeed(`${building.id}:cold-roof`) % 2 ? 'slate' : 'copper';
        }
    }
}

function applySettlementArchitectureThemeToBuildings(buildings, settlement, seed) {
    const architectureThemeId = normalizeBurgThemeId(
        settlement.architectureThemeId ??
        settlement.burg?.themeId ??
        settlement.blueprint?.identity?.architectureThemeId,
        null
    );
    if (!architectureThemeId) return;
    const theme = getBurgTheme(architectureThemeId);
    if (!theme) return;
    settlement.architectureThemeId = architectureThemeId;
    settlement.themeLabel = theme.label;
    settlement.streetPaletteId = theme.streetPaletteId;
    settlement.wallTextureId = theme.wallTextureId;
    for (const building of buildings) {
        const resolved = resolveBurgThemeBuildingStyle(architectureThemeId, {
            district: building.district,
            seed: `${seed}:burg-theme:${settlement.burg.id}:${building.id}`,
            baseStyle: building.style,
            baseRoofStyle: building.roofStyle,
            baseArchitectureStyle: building.architectureStyle
        });
        building.burgId = Number(settlement.burg.id);
        building.architectureThemeId = resolved.architectureThemeId;
        building.themeLabel = resolved.themeLabel;
        building.style = resolved.style;
        building.architectureStyle = resolved.facadeKit;
        building.roofStyle = resolved.roofStyle;
        building.roofGeometry = resolved.roofGeometry;
        building.facadeKit = resolved.facadeKit;
        building.castleKit = resolved.castleKit;
        building.streetPaletteId = resolved.streetPaletteId;
        building.wallTextureId = resolved.wallTextureId;
        building.themePalette = cloneArchitectureThemePalette(resolved.themePalette);
        building.districtPalette = {
            ...(building.districtPalette || {}),
            accent: parseHexColor(resolved.themePalette.accentColor),
            roofs: [...resolved.themePalette.roofColors]
        };
    }
}

function cloneArchitectureThemePalette(themePalette) {
    return {
        ...themePalette,
        roofColors: [...(themePalette?.roofColors || [])]
    };
}

/**
 * The side of the town a vector gate faces, read from the wall it sits in: wall on its left and
 * right means the wall runs east–west and the gate faces north or south, and so on. Falls back
 * to the direction from the town centre.
 */
function edgeAlongVectorWall(cell, wallKeys, settlement) {
    const horizontal = wallKeys.has(`${cell.col - 1},${cell.row}`) && wallKeys.has(`${cell.col + 1},${cell.row}`);
    const vertical = wallKeys.has(`${cell.col},${cell.row - 1}`) && wallKeys.has(`${cell.col},${cell.row + 1}`);
    const dx = Number(cell.col) - Number(settlement.col);
    const dy = Number(cell.row) - Number(settlement.row);
    if (horizontal && !vertical) return dy >= 0 ? 'south' : 'north';
    if (vertical && !horizontal) return dx >= 0 ? 'east' : 'west';
    if (Math.abs(dx) > Math.abs(dy)) return dx >= 0 ? 'east' : 'west';
    return dy >= 0 ? 'south' : 'north';
}

function stampSettlementEnvelope({
    mutable,
    paletteRows,
    elevationRows,
    settlement,
    occupied = new Set(),
    constraintField,
    skeleton,
    width,
    height
}) {
    const bounds = settlement.wallBounds;
    const elevations = [];
    let urbanCells = 0;
    for (let row = bounds.minRow + 1; row < bounds.maxRow; row++) {
        for (let col = bounds.minCol + 1; col < bounds.maxCol; col++) {
            if (bounds.insideCellKeys instanceof Set && !isInsideWallBounds(col, row, bounds)) continue;
            const constraint = constraintField?.cells?.[row * width + col];
            if ((!constraint?.hardWater || constraint?.blueprintFixed) && !isWaterSymbol(mutable[row]?.[col])) {
                elevations.push(Number(elevationRows[row]?.[col]) || 0);
            }
        }
    }
    elevations.sort((a, b) => a - b);
    const plateau = elevations[Math.floor(elevations.length / 2)] || 0;
    for (let row = bounds.minRow + 1; row < bounds.maxRow; row++) {
        for (let col = bounds.minCol + 1; col < bounds.maxCol; col++) {
            if (bounds.insideCellKeys instanceof Set && !isInsideWallBounds(col, row, bounds)) continue;
            const constraint = constraintField?.cells?.[row * width + col];
            const foreignFixed = skeleton?.cells?.get?.(row * width + col);
            // The numeric FMG envelope remains authoritative even inside a settlement. Only
            // non-hard marsh/shore noise may be stabilized into urban ground.
            if ((constraint?.hardWater && !constraint?.blueprintFixed) ||
                (!constraint?.blueprintFixed && (mutable[row]?.[col] === 'W' || mutable[row]?.[col] === 'I'))) continue;
            // A previous overlapping settlement may already own this exact building pad. Terrain
            // synthesis is sequential, so its later neighbor must not re-terrace the occupied
            // footprint after the building's legal base elevation was chosen.
            if (occupied.has(`${col},${row}`)) continue;
            if (foreignFixed && Number(foreignFixed.townId) !== Number(settlement.burg.id)) {
                stampForeignSettlementConstraint({
                    mutable,
                    paletteRows,
                    elevationRows,
                    fixed: foreignFixed,
                    plateau
                });
                continue;
            }
            urbanCells++;
            const localCol = col - settlement.col;
            const localRow = row - settlement.row;
            mutable[row][col] = (localCol + localRow) % 11 === 0 ? ',' : '.';
            const currentElevation = Number(elevationRows[row]?.[col]) || 0;
            const fixedElevation = constraint?.fixedElevation;
            elevationRows[row][col] = Number.isFinite(fixedElevation)
                ? clampInteger(fixedElevation, 0, 6)
                : deriveSettlementTerraceElevation({
                    col,
                    row,
                    currentElevation,
                    plateau,
                    settlement
                });
        }
    }

    const center = { col: settlement.col, row: settlement.row };
    // A town with its own (vector) wall has its gates in that wall: the gatehouses stand there,
    // turned to the wall's run, not at the FMG ring's nominal bearings (where no wall stands).
    const vectorWallKeys = new Set((settlement.townVector?.wallCells || []).map((cell) => `${cell.col},${cell.row}`));
    const gates = vectorWallKeys.size && settlement.townVector?.gateCells?.length
        ? settlement.townVector.gateCells.map((cell) => ({
            col: cell.col,
            row: cell.row,
            edge: edgeAlongVectorWall(cell, vectorWallKeys, settlement),
            widthTiles: 1,
            grand: false
        }))
        : settlement.wallRings?.[0]?.gates || [];
    // Every visible FMG vector tier is immutable, including a neighboring burg whose envelope
    // overlaps this one. Protecting only the current town allowed a later settlement pass to
    // smooth an earlier town's authored road elevations.
    const protectedRoadElevations = new Set([
        ...occupied,
        ...[...(skeleton?.cells?.values?.() || [])]
            .filter((cell) => (cell.source === 'town-vector' || cell.elevationSource === 'town-vector') &&
                Number.isFinite(Number(cell.elevationTier)))
            .map((cell) => elevationCellKey(cell.col, cell.row))
    ]);
    let wallCells = 0;
    for (const fixed of skeleton?.cells?.values?.() || []) {
        if (Number(fixed.townId) !== Number(settlement.burg.id)) continue;
        if (!mutable[fixed.row]?.[fixed.col]) continue;
        const fixedElevation = Number.isFinite(Number(fixed.elevationTier))
            ? clampInteger(fixed.elevationTier, 0, 6)
            : null;
        if (fixedElevation !== null &&
            (fixed.source === 'town-vector' || fixed.elevationSource === 'town-vector')) {
            protectedRoadElevations.add(elevationCellKey(fixed.col, fixed.row));
        }
        if (fixed.kind === 'wall') {
            mutable[fixed.row][fixed.col] = 'T';
            paletteRows[fixed.row][fixed.col] = 'path';
            elevationRows[fixed.row][fixed.col] = fixedElevation ??
                deriveSettlementTerraceElevation({
                    col: fixed.col,
                    row: fixed.row,
                    currentElevation: elevationRows[fixed.row][fixed.col],
                    plateau,
                    settlement
                });
            wallCells++;
        } else if (fixed.kind === 'gate' || fixed.kind === 'road') {
            mutable[fixed.row][fixed.col] = fixed.kind === 'gate'
                ? ';'
                : resolveBakedStreetWorldSymbol(fixed);
            paletteRows[fixed.row][fixed.col] = 'path';
            elevationRows[fixed.row][fixed.col] = fixedElevation ??
                deriveSettlementTerraceElevation({
                    col: fixed.col,
                    row: fixed.row,
                    currentElevation: elevationRows[fixed.row][fixed.col],
                    plateau,
                    settlement
                });
        } else if (fixed.kind === 'castle-plot') {
            mutable[fixed.row][fixed.col] = '.';
            paletteRows[fixed.row][fixed.col] = 'path';
            elevationRows[fixed.row][fixed.col] = fixedElevation ??
                deriveSettlementTerraceElevation({
                    col: fixed.col,
                    row: fixed.row,
                    currentElevation: elevationRows[fixed.row][fixed.col],
                    plateau,
                    settlement
                });
        } else if (fixed.kind === 'building-plot') {
            mutable[fixed.row][fixed.col] = '.';
            elevationRows[fixed.row][fixed.col] = fixedElevation ??
                deriveSettlementTerraceElevation({
                    col: fixed.col,
                    row: fixed.row,
                    currentElevation: elevationRows[fixed.row][fixed.col],
                    plateau,
                    settlement
                });
        } else if (fixed.kind === 'dock') {
            mutable[fixed.row][fixed.col] = 'R';
            paletteRows[fixed.row][fixed.col] = 'path';
            elevationRows[fixed.row][fixed.col] = fixedElevation ?? Math.max(0, plateau - 1);
        } else if (fixed.kind === 'bridge' || fixed.kind === 'ford') {
            mutable[fixed.row][fixed.col] = fixed.kind === 'ford' ? '~' : 'R';
            paletteRows[fixed.row][fixed.col] = 'path';
            elevationRows[fixed.row][fixed.col] = Math.max(0, plateau - 1);
        } else if (fixed.kind === 'waterfall') {
            mutable[fixed.row][fixed.col] = '~';
            paletteRows[fixed.row][fixed.col] = 'coast';
            elevationRows[fixed.row][fixed.col] = clampInteger(
                plateau + Math.max(0, (fixed.dropTiers || 1) - (fixed.tier || 0) - 1),
                0,
                6
            );
        } else if (fixed.kind === 'plunge-pool') {
            mutable[fixed.row][fixed.col] = 'B';
            paletteRows[fixed.row][fixed.col] = 'coast';
            elevationRows[fixed.row][fixed.col] = Math.max(0, plateau - 1);
        }
    }
    // Open fiefs have no ring gates, but still receive the parser-compiled fealty road. Give a
    // tiny civic landing at the anchor without inventing additional road arms.
    if (!settlement.walled) {
        for (let row = center.row - 1; row <= center.row + 1; row++) {
            for (let col = center.col - 1; col <= center.col + 1; col++) {
                const constraint = constraintField?.cells?.[row * width + col];
                if (!mutable[row]?.[col] || (constraint?.hardWater && !constraint?.blueprintFixed)) continue;
                if (Number.isFinite(constraint?.fixedElevation)) {
                    elevationRows[row][col] = clampInteger(constraint.fixedElevation, 0, 6);
                    continue;
                }
                mutable[row][col] = ';';
                paletteRows[row][col] = 'path';
                elevationRows[row][col] = plateau;
            }
        }
    }
    smoothRoadElevations(mutable, elevationRows, protectedRoadElevations);
    relaxSymbolElevationRamps(mutable, elevationRows, protectedRoadElevations);
    let developableUrbanCells = 0;
    for (let row = bounds.minRow + 1; row < bounds.maxRow; row++) {
        for (let col = bounds.minCol + 1; col < bounds.maxCol; col++) {
            if (bounds.insideCellKeys instanceof Set && !isInsideWallBounds(col, row, bounds)) continue;
            if (!isBuildableSymbol(mutable[row]?.[col])) continue;
            if (nearestSymbolDistance(mutable, col, row, WORLD_ROAD_SYMBOLS, 2) <= 2) developableUrbanCells++;
        }
    }
    return {
        plateau,
        gates,
        wallCells,
        urbanCells: Math.max(1, developableUrbanCells),
        constrainedInteriorCells: urbanCells
    };
}

function resolveBakedStreetWorldSymbol(fixed) {
    if (fixed?.source !== 'baked-street-wfc') return 'R';
    if (fixed.transition === true && fixed.transitionPatternSymbol === 'S') {
        return STAIR_SYMBOL_BY_DIRECTION[fixed.transitionDirection] || ':';
    }
    const pattern = String(fixed.patternSymbol || 'R');
    if (pattern === ':') return ':';
    if (['P', 'M', 'F', 'G'].includes(pattern)) return ';';
    if (pattern === 'S') return ':';
    // Boulevard, bridge-deck and dock semantic symbols remain path surfaces. Their distinct
    // geometry and props are driven by preserved module metadata, not by colliding map glyphs.
    return 'R';
}

function stampForeignSettlementConstraint({ mutable, paletteRows, elevationRows, fixed, plateau }) {
    const fixedElevation = Number.isFinite(Number(fixed.elevationTier))
        ? clampInteger(fixed.elevationTier, 0, 6)
        : null;
    if (fixed.kind === 'wall') {
        mutable[fixed.row][fixed.col] = 'T';
        paletteRows[fixed.row][fixed.col] = 'path';
    } else if (fixed.kind === 'gate') {
        mutable[fixed.row][fixed.col] = ';';
        paletteRows[fixed.row][fixed.col] = 'path';
    } else if (fixed.kind === 'road' || fixed.kind === 'dock' || fixed.kind === 'bridge') {
        mutable[fixed.row][fixed.col] = fixed.kind === 'road'
            ? resolveBakedStreetWorldSymbol(fixed)
            : 'R';
        paletteRows[fixed.row][fixed.col] = 'path';
    } else if (fixed.kind === 'castle-plot') {
        // Keep the foreign burg's reserved landmark plot out of this settlement's parcel wave.
        mutable[fixed.row][fixed.col] = ';';
        paletteRows[fixed.row][fixed.col] = 'path';
    } else if (fixed.kind === 'building-plot') {
        // Keep a neighboring vector building foundation as buildable ground, but never turn it
        // into a foreign road that can cut through the reserved footprint.
        mutable[fixed.row][fixed.col] = '.';
    } else if (fixed.kind === 'ford' || fixed.kind === 'waterfall') {
        mutable[fixed.row][fixed.col] = '~';
        paletteRows[fixed.row][fixed.col] = 'coast';
    } else if (fixed.kind === 'plunge-pool') {
        mutable[fixed.row][fixed.col] = 'B';
        paletteRows[fixed.row][fixed.col] = 'coast';
    }
    elevationRows[fixed.row][fixed.col] = fixedElevation ?? clampInteger(plateau, 0, 6);
}

function deriveSettlementTerraceElevation({ col, row, currentElevation, plateau, settlement }) {
    const profile = settlement?.reliefProfile;
    if (!profile) {
        return clampInteger(Math.max(plateau - 1, Math.min(plateau + 1, Number(currentElevation) || 0)), 0, 6);
    }
    const targetSpan = clampInteger(profile.targetTierSpan ?? 1, 1, 6);
    const centerTier = clampInteger(profile.baseElevationTier ?? plateau, 0, 6);
    let minimumTier = centerTier - Math.floor(targetSpan / 2);
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

    // The macro WFC already chose a coherent 5x5 terrace. Settlement stamping may clamp that
    // choice to the FMG relief envelope, but must not replace it with a second per-cell gradient.
    // Keeping the incoming tier intact is what lets buildings, streets, and door landings share
    // one logical block surface.
    return clampInteger(currentElevation, minimumTier, maximumTier);
}

function createSettlementDistrictRows({ mutable, settlement, width, height }) {
    const rows = Array.from({ length: height }, () => Array(width).fill(null));
    const bounds = settlement.wallBounds;
    for (let row = bounds.minRow + 1; row < bounds.maxRow; row++) {
        for (let col = bounds.minCol + 1; col < bounds.maxCol; col++) {
            if (bounds.insideCellKeys instanceof Set && !isInsideWallBounds(col, row, bounds)) continue;
            if (isWaterSymbol(mutable[row]?.[col]) || mutable[row]?.[col] === 'T') continue;
            const ward = getSettlementWardAt(settlement, col, row);
            const compiledDistrict = ward?.district || 'residential';
            const roadDistance = nearestSymbolDistance(mutable, col, row, WORLD_ROAD_SYMBOLS, 3);
            const waterDistance = nearestSymbolDistance(mutable, col, row, new Set(['W', '~', 'B']), 7);
            if (compiledDistrict === 'harbor' && waterDistance > 6) rows[row][col] = 'artisan';
            else if (compiledDistrict === 'market' && roadDistance > 2) rows[row][col] = 'residential';
            else rows[row][col] = compiledDistrict;
        }
    }
    return rows;
}

function createPlacementInhibitorRows({ mutable, elevationRows, settlement, plateau, constraintField, width, height }) {
    return Array.from({ length: height }, (_, row) => Array.from({ length: width }, (_, col) => {
        const symbol = mutable[row]?.[col];
        const constraint = constraintField?.cells?.[row * width + col];
        if (constraint?.hardWater || isWaterSymbol(symbol) || symbol === 'T') return 1;
        if (!isInsideWallBounds(col, row, settlement.wallBounds)) {
            return clamp01(0.22 + (constraint?.inhibitor || 0) * 0.42);
        }
        const local = WORLD_ROAD_SYMBOLS.has(symbol)
            ? 0.42
            : clamp01(0.1 + Math.abs((Number(elevationRows[row]?.[col]) || 0) - plateau) * 0.12);
        // High FMG confidence is an inhibitor, but urbanization makes already-safe town ground
        // easier to build on. This keeps the same numeric field in both WFC layers.
        const global = clamp01((constraint?.inhibitor || 0) * (1 - (constraint?.urbanization || 0) * 0.72));
        return Math.max(local, global);
    }));
}

function createWardBakedBuildingPlan({
    mutable,
    elevationRows,
    inhibitorRows,
    districtRows,
    settlement,
    occupied,
    skeleton,
    width,
    height,
    fixedSeed
}) {
    const buildings = [];
    const globalOriginCol = Math.round(Number(settlement.burg?.x ?? settlement.blueprint?.x) / WORLD_SAMPLE_SCALE) -
        Number(settlement.col);
    const globalOriginRow = Math.round(Number(settlement.burg?.y ?? settlement.blueprint?.y) / WORLD_SAMPLE_SCALE) -
        Number(settlement.row);
    const inheritedOccupiedCells = new Set(occupied instanceof Set ? occupied : []);
    let occupiedCells = new Set(inheritedOccupiedCells);
    let compactAdjacencyFallbacks = 0;
    const replaceableRoadCells = collectReplaceableFormulaRoadCells(skeleton, settlement);
    const vectorPlan = createTownVectorBuildingPlan({
        mutable,
        elevationRows,
        settlement,
        occupied: occupiedCells,
        skeleton,
        width,
        height,
        fixedSeed
    });
    buildings.push(...vectorPlan.buildings);
    occupiedCells = vectorPlan.occupied;
    const vectorCastle = buildings.some((building) => building.vectorGenerated && building.district === 'castle');

    if (settlement.castle && !vectorCastle) {
        const keepCandidates = [];
        for (const center of getFixedKeepCenters(settlement, width, height)) {
            for (const rotation of getFixedKeepRotations(settlement)) {
                try {
                    keepCandidates.push(createFixedBakedBuilding({
                        blueprintId: 'castle-keep',
                        centerCol: center.col,
                        centerRow: center.row,
                        rotation,
                        width,
                        height,
                        elevationRows,
                        seed: `${fixedSeed}:castle:${center.col + globalOriginCol}:${center.row + globalOriginRow}`,
                        townId: settlement.burg.name,
                        district: 'castle',
                        architectureThemeId: settlement.architectureThemeId,
                        reliefProfile: settlement.reliefProfile,
                        maxElevationSpan: 1
                    }));
                } catch {
                    // A clipped or steep candidate may fail while another burg-constrained
                    // center/orientation still fits.
                }
            }
        }
        if (keepCandidates.length) {
            const keep = keepCandidates.find((candidate) =>
                fixedBuildingHasOpenApproach(candidate, mutable) &&
                fixedBuildingAvoidsOccupiedCells(candidate, occupiedCells, width, height));
            if (keep) {
                buildings.push(keep);
                reserveBuilding(occupiedCells, keep, Math.floor(width / 2), Math.floor(height / 2), 1);
            }
        } else {
            // A clipped edge view may contain only part of a parser-reserved castle plot. The
            // fixed skeleton remains present; the full keep appears when the seat is centered.
        }
    }

    // FMG-authored building polygons are the primary town silhouette. A single formula landmark
    // can still accent the district mix, while towns with no vector coverage retain the original
    // two-landmark fallback.
    const desiredWardLandmarks = vectorPlan.buildings.length
        ? 1
        : settlement.walled ? 2 : 1;
    const wardOrder = [...(settlement.wards || [])]
        .filter((ward) => ward.district !== 'castle')
        .sort((left, right) => wardLandmarkPriority(right.district) - wardLandmarkPriority(left.district) ||
            left.ring - right.ring);
    let placedWardLandmarks = 0;
    for (const ward of wardOrder) {
        if (placedWardLandmarks >= desiredWardLandmarks) break;
        const areaCells = [];
        for (let row = settlement.wallBounds.minRow + 1; row < settlement.wallBounds.maxRow; row++) {
            for (let col = settlement.wallBounds.minCol + 1; col < settlement.wallBounds.maxCol; col++) {
                if (districtRows[row]?.[col] !== ward.district) continue;
                if (mutable[row]?.[col] === 'T' || isWaterSymbol(mutable[row]?.[col])) continue;
                areaCells.push({ col, row, district: ward.district });
            }
        }
        if (!areaCells.length) continue;
        const options = {
            rows: mutable.map((row) => row.join('')),
            elevationRows,
            inhibitorRows,
            districtRows,
            area: { cells: areaCells },
            districts: [ward.district],
            occupied: occupiedCells,
            replaceableRoadCells,
            seed: `${fixedSeed}:ward:${ward.ring}:${ward.district}`,
            townId: settlement.burg.name,
            architectureThemeId: settlement.architectureThemeId,
            reliefProfile: settlement.reliefProfile,
            globalOriginCol,
            globalOriginRow,
            maxElevationSpan: 1,
            minBuildings: 1,
            maxBuildings: 1,
            buffer: 0,
            maxInhibitor: 0.9
        };
        let plan = createBakedBuildingPlan(options);
        if (!plan.diagnostics.complete) {
            plan = createBakedBuildingPlan({
                ...options,
                compactFirst: true,
                relaxRoadAffinity: true
            });
        }
        if (!plan.buildings.length) continue;
        buildings.push(...plan.buildings);
        occupiedCells = plan.occupied;
        placedWardLandmarks++;
    }

    const minimumBakedBuildings = settlement.walled ? 2 : 1;
    if (buildings.length < minimumBakedBuildings) {
        const fallbackCells = [];
        for (let row = settlement.wallBounds.minRow + 1; row < settlement.wallBounds.maxRow; row++) {
            for (let col = settlement.wallBounds.minCol + 1; col < settlement.wallBounds.maxCol; col++) {
                if (!isBuildableSymbol(mutable[row]?.[col]) && !(
                    mutable[row]?.[col] === 'R' && replaceableRoadCells.has(`${col},${row}`)
                )) continue;
                fallbackCells.push({ col, row, district: districtRows[row]?.[col] || 'residential' });
            }
        }
        const remaining = minimumBakedBuildings - buildings.length;
        const fallback = createBakedBuildingPlan({
            rows: mutable.map((row) => row.join('')),
            elevationRows,
            inhibitorRows,
            districtRows,
            area: { cells: fallbackCells },
            occupied: occupiedCells,
            replaceableRoadCells,
            seed: `${fixedSeed}:compact-fallback`,
            townId: settlement.burg.name,
            architectureThemeId: settlement.architectureThemeId,
            reliefProfile: settlement.reliefProfile,
            globalOriginCol,
            globalOriginRow,
            maxElevationSpan: 1,
            minBuildings: remaining,
            maxBuildings: remaining,
            buffer: 0,
            maxInhibitor: 1,
            compactFirst: true,
            relaxRoadAffinity: true
        });
        if (fallback.buildings.length) {
            buildings.push(...fallback.buildings);
            occupiedCells = fallback.occupied;
            placedWardLandmarks += fallback.buildings.length;
        }
    }

    // Clipped coastal views can leave a legal cabin only in the keep's one-cell aesthetic
    // buffer. The buffer is not a structural constraint: rebuild occupancy from exact existing
    // footprints and reserved door landings, then run the same 4x5 minimum blueprint solver.
    // Walls, water, elevations, inhibitors and approaches are still validated by the library.
    if (buildings.length < minimumBakedBuildings) {
        const compactOccupied = new Set(inheritedOccupiedCells);
        const offsetX = Math.floor(width / 2);
        const offsetY = Math.floor(height / 2);
        for (const building of buildings) {
            reserveBuilding(compactOccupied, building, offsetX, offsetY, 0);
            const [approachCol, approachRow] = building.entrance?.approachGrid || [];
            if (Number.isFinite(approachCol) && Number.isFinite(approachRow)) {
                compactOccupied.add(`${approachCol},${approachRow}`);
            }
        }
        const fallbackCells = [];
        for (let row = settlement.wallBounds.minRow + 1; row < settlement.wallBounds.maxRow; row++) {
            for (let col = settlement.wallBounds.minCol + 1; col < settlement.wallBounds.maxCol; col++) {
                if (!isBuildableSymbol(mutable[row]?.[col]) && !(
                    mutable[row]?.[col] === 'R' && replaceableRoadCells.has(`${col},${row}`)
                )) continue;
                fallbackCells.push({ col, row, district: districtRows[row]?.[col] || 'residential' });
            }
        }
        const remaining = minimumBakedBuildings - buildings.length;
        const compactFallback = createBakedBuildingPlan({
            rows: mutable.map((row) => row.join('')),
            elevationRows,
            inhibitorRows,
            districtRows,
            area: { cells: fallbackCells },
            occupied: compactOccupied,
            replaceableRoadCells,
            seed: `${fixedSeed}:compact-adjacent-fallback`,
            townId: settlement.burg.name,
            architectureThemeId: settlement.architectureThemeId,
            reliefProfile: settlement.reliefProfile,
            globalOriginCol,
            globalOriginRow,
            maxElevationSpan: 1,
            minBuildings: remaining,
            maxBuildings: remaining,
            buffer: 0,
            maxInhibitor: 1,
            compactFirst: true,
            relaxRoadAffinity: true
        });
        if (compactFallback.buildings.length) {
            buildings.push(...compactFallback.buildings);
            occupiedCells = new Set([...occupiedCells, ...compactFallback.occupied]);
            placedWardLandmarks += compactFallback.buildings.length;
            compactAdjacencyFallbacks += compactFallback.buildings.length;
        }
    }

    return {
        buildings,
        occupied: occupiedCells,
        diagnostics: Object.freeze({
            requested: {
                min: vectorPlan.buildings.length + (settlement.castle && !vectorCastle ? 1 : 0) + desiredWardLandmarks,
                max: vectorPlan.buildings.length + (settlement.castle && !vectorCastle ? 1 : 0) + desiredWardLandmarks
            },
            placed: buildings.length,
            complete: buildings.length >= minimumBakedBuildings,
            fixedKeep: buildings.some((building) => building.blueprintId === 'castle-keep' || building.vectorCastle),
            vectorBuildings: vectorPlan.buildings.length,
            rejectedVectorBuildings: vectorPlan.rejected,
            vectorRejectionReasons: Object.freeze({ ...(vectorPlan.rejectionReasons || {}) }),
            wardLandmarks: placedWardLandmarks,
            compactAdjacencyFallbacks,
            blueprintIds: buildings.map((building) => building.blueprintId),
            strategy: compactAdjacencyFallbacks
                ? 'fixed-castle-plus-per-ward-with-compact-adjacency'
                : 'fixed-castle-plus-per-ward'
        })
    };
}

function collectReplaceableFormulaRoadCells(skeleton, settlement) {
    const cells = new Set();
    for (const fixed of skeleton?.cells?.values?.() || []) {
        if (Number(fixed.townId) !== Number(settlement.burg.id) || fixed.kind !== 'road') continue;
        // FMG vectors and the reusable street-map WFC are earlier authored layers. Only the old
        // formula lattice may yield a cell when wall confinement otherwise cannot fit a 2x3
        // cabin. The exterior landing remains reserved, so replacing a redundant lane never
        // disconnects the building from the surviving network.
        if (fixed.source === 'town-vector' || fixed.source === 'baked-street-wfc') continue;
        cells.add(`${fixed.col},${fixed.row}`);
    }
    return cells;
}

function createTownVectorBuildingPlan({
    mutable,
    elevationRows,
    settlement,
    occupied,
    skeleton,
    width,
    height,
    fixedSeed
}) {
    const projected = settlement.townVector;
    if (!projected?.buildings?.length) {
        return { buildings: [], occupied: new Set(occupied || []), rejected: 0 };
    }
    const offsetX = Math.floor(width / 2);
    const offsetY = Math.floor(height / 2);
    const occupiedCells = new Set(occupied || []);
    const buildings = [];
    const sourceElevationByKey = new Map(
        [...(skeleton?.cells?.values?.() || [])]
            .filter((cell) => (cell.source === 'town-vector' || cell.elevationSource === 'town-vector') &&
                Number.isFinite(Number(cell.elevationTier)))
            .map((cell) => [elevationCellKey(cell.col, cell.row), clampInteger(cell.elevationTier, 0, 6)])
    );
    let rejected = 0;
    const rejectionReasons = {};
    const reject = (reason) => {
        rejected++;
        rejectionReasons[reason] = (rejectionReasons[reason] || 0) + 1;
    };
    const sources = [...projected.buildings].sort((left, right) => {
        const leftCastle = left.type === 'MANOR' && settlement.castle ? 1 : 0;
        const rightCastle = right.type === 'MANOR' && settlement.castle ? 1 : 0;
        return rightCastle - leftCastle ||
            right.width * right.height - left.width * left.height ||
            left.id.localeCompare(right.id);
    });

    for (const source of sources) {
        const rect = {
            col: source.minCol,
            row: source.minRow,
            width: source.width,
            height: source.height
        };
        const footprintCells = source.footprintCells.map((cell) => ({ x: cell.x, y: cell.y }));
        const worldCells = footprintCells.map((cell) => ({
            col: rect.col + cell.x,
            row: rect.row + cell.y
        }));
        if (worldCells.some((cell) => (
            cell.col < 0 || cell.row < 0 || cell.col >= width || cell.row >= height ||
            occupiedCells.has(`${cell.col},${cell.row}`) ||
            mutable[cell.row]?.[cell.col] === 'T' ||
            isWaterSymbol(mutable[cell.row]?.[cell.col]) ||
            !isLandSymbol(mutable[cell.row]?.[cell.col])
        ))) {
            reject('footprint-blocked');
            continue;
        }
        const entrance = chooseTownVectorEntrance(source, rect, mutable, occupiedCells);
        if (!entrance) {
            reject('entrance-blocked');
            continue;
        }
        const sampledElevations = worldCells.map((cell) => Number(elevationRows[cell.row]?.[cell.col]) || 0);
        const approachElevation = Number(elevationRows[entrance.approach.row]?.[entrance.approach.col]);
        const overlappingVectorTiers = [...new Set(worldCells
            .map((cell) => sourceElevationByKey.get(elevationCellKey(cell.col, cell.row)))
            .filter(Number.isFinite))];
        const footprintKeys = new Set(worldCells.map((cell) => elevationCellKey(cell.col, cell.row)));
        const neighboringVectorTiers = [...new Set(worldCells.flatMap((cell) => CARDINALS
            .map(({ x, y }) => ({ col: cell.col + x, row: cell.row + y }))
            .filter((neighbor) => !footprintKeys.has(elevationCellKey(neighbor.col, neighbor.row)))
            .map((neighbor) => sourceElevationByKey.get(elevationCellKey(neighbor.col, neighbor.row)))
            .filter(Number.isFinite)))];
        if (overlappingVectorTiers.length > 1) {
            reject('vector-elevation-conflict');
            continue;
        }
        if (overlappingVectorTiers.length === 1 && neighboringVectorTiers.some((tier) =>
            Math.abs(tier - overlappingVectorTiers[0]) > 1)) {
            reject('vector-elevation-conflict');
            continue;
        }
        let foundationElevation = overlappingVectorTiers.length
            ? overlappingVectorTiers[0]
            : clampInteger(medianNumber(sampledElevations, 0), 0, 6);
        if (!overlappingVectorTiers.length && neighboringVectorTiers.length) {
            const legalMinimum = Math.max(0, ...neighboringVectorTiers.map((tier) => tier - 1));
            const legalMaximum = Math.min(6, ...neighboringVectorTiers.map((tier) => tier + 1));
            if (legalMinimum > legalMaximum) {
                reject('vector-elevation-conflict');
                continue;
            }
            foundationElevation = clampInteger(foundationElevation, legalMinimum, legalMaximum);
        }
        if (overlappingVectorTiers.length && Number.isFinite(approachElevation) &&
            Math.abs(approachElevation - foundationElevation) > 1) {
            reject('door-elevation-conflict');
            continue;
        }
        if (!overlappingVectorTiers.length && Number.isFinite(approachElevation)) {
            foundationElevation = clampInteger(
                foundationElevation,
                Math.max(0, approachElevation - 1),
                Math.min(6, approachElevation + 1)
            );
        }
        // FMG building vectors choose the parcel geometry; the macro generator supplies a single
        // level foundation plate beneath it. This is an intentional hard building module, not a
        // reason to discard an authored footprint merely because it crosses two 5x5 terraces.
        for (const cell of worldCells) elevationRows[cell.row][cell.col] = foundationElevation;
        const elevations = worldCells.map(() => foundationElevation);
        const elevationSafety = analyzeBuildingFootprintElevation(worldCells, elevationRows);
        const elevationSpan = elevationSafety.span;
        const type = getTownVectorBuildingType(
            source.type,
            settlement,
            Boolean(settlement.castle && !buildings.some((building) => building.vectorCastle))
        );
        const hash = hashWaveSeed(`${fixedSeed}:burg-vector:${source.id}`);
        const interiorWidth = rect.width - 2;
        const interiorHeight = rect.height - 2;
        let stories = clampInteger(source.floors, 1, 2);
        let stairs = stories > 1
            ? createTownVectorStairs(source, entrance.door, interiorWidth, interiorHeight)
            : [];
        const style = getTownVectorWallStyle(source.wallTexture);
        const districtStyle = getBlueprintDistrictStyle(type.district);
        const makeBuilding = () => {
            const stairKeys = new Set(stairs.map((cell) => `${cell.x},${cell.y}`));
            const openCells = [];
            for (let y = 1; y < rect.height - 1; y++) {
                for (let x = 1; x < rect.width - 1; x++) {
                    if (!stairKeys.has(`${x},${y}`)) openCells.push({ x, y });
                }
            }
            return {
                id: `vector-${settlement.burg.id}-${source.id}`,
                obstructionTag: `building:burg-vector:${settlement.burg.id}:${source.id}`,
                name: `${settlement.burg.name} ${type.name}`,
                x: rect.col - offsetX,
                y: rect.row - offsetY,
                width: rect.width,
                height: rect.height,
                footprintCells,
                stories,
                style,
                doorStyle: ['painted', 'oak', 'iron'][hash % 3],
                door: { ...entrance.door },
                stairs: stairs.map((stair) => ({ ...stair })),
                stairCells: [],
                baseElevation: maxCountKey(
                    elevations.reduce((counts, value) => counts.set(value, (counts.get(value) || 0) + 1), new Map()),
                    0
                ),
                proceduralGenerated: true,
                vectorGenerated: true,
                enterable: true,
                preserveEntrance: true,
                sourceType: 'burg-vector',
                sourceBuildingId: source.id,
                townVectorHash: projected.vectorHash,
                vectorCastle: type.district === 'castle',
                blueprintId: type.district === 'castle' ? 'burg-vector-castle' : `burg-vector-${String(source.type).toLowerCase()}`,
                facadeVariant: hash % 17,
                district: type.district,
                districtPalette: {
                    accent: mixColorNumbers(parseHexColor(source.roofColor), settlement.accent, 0.2),
                    roofs: [...districtStyle.roofs]
                },
                activity: districtStyle.activity,
                archetype: type.archetype,
                architectureStyle: type.architectureStyle,
                roofStyle: getTownVectorRoofStyle(source.roofStyle, type),
                vectorStyle: {
                    wallTexture: source.wallTexture,
                    wallColor: source.color,
                    roofColor: source.roofColor,
                    sourcePolygon: source.sourcePolygon
                },
                entrance: {
                    grid: [entrance.door.x, entrance.door.y],
                    edge: entrance.door.edge,
                    approach: [entrance.approach.col - offsetX, entrance.approach.row - offsetY],
                    approachGrid: [entrance.approach.col, entrance.approach.row],
                    approachReserved: true
                },
                interior: {
                    minimumOpenSpan: [Math.min(interiorWidth, interiorHeight), Math.max(interiorWidth, interiorHeight)],
                    openCells,
                    floorHeightVoxels: 2
                },
                floors: Array.from({ length: stories }, (_, level) => ({
                    level,
                    rooms: [{
                        type: type.roomType,
                        gridRect: { x: 1, y: 1, width: interiorWidth, height: interiorHeight },
                        doors: level === 0 ? [{ grid: [entrance.door.x, entrance.door.y] }] : []
                    }]
                })),
                placementConstraints: {
                    source: 'fmg-burg-vector',
                    elevationSpan,
                    maxAdjacentElevationDelta: elevationSafety.maxAdjacentDelta,
                    reliefFormulaVersion: settlement.reliefProfile?.formulaVersion ?? FMG_BURG_RELIEF_FORMULA_VERSION,
                    reliefScore: settlement.reliefProfile?.reliefScore ?? 0,
                    reliefClass: settlement.reliefProfile?.reliefClass ?? 'none',
                    targetTierSpan: settlement.reliefProfile?.targetTierSpan ?? 1,
                    wallConfinement: projected.insideCellKeys.has(
                        `${rect.col + Math.floor(rect.width / 2)},${rect.row + Math.floor(rect.height / 2)}`
                    )
                }
            };
        };
        let building = makeBuilding();
        // A compact 2x3 cabin cannot surrender an interior cell to stairs. Preserve the authored
        // footprint and entrance, but render it as a single-storey cabin instead.
        if (!validateBakedBuilding(building).valid && stories > 1) {
            stories = 1;
            stairs = [];
            building = makeBuilding();
        }
        if (!validateBakedBuilding(building).valid) {
            reject('interior-invalid');
            continue;
        }
        buildings.push(building);
        for (const cell of worldCells) occupiedCells.add(`${cell.col},${cell.row}`);
        occupiedCells.add(`${entrance.approach.col},${entrance.approach.row}`);
    }

    return { buildings, occupied: occupiedCells, rejected, rejectionReasons };
}

function chooseTownVectorEntrance(source, rect, mutable, occupied) {
    const sourceDoor = {
        x: clampInteger(source.door?.x, 0, rect.width - 1),
        y: clampInteger(source.door?.y, 0, rect.height - 1),
        edge: source.door?.edge || 'south'
    };
    const candidates = [
        sourceDoor,
        { x: Math.floor(rect.width / 2), y: 0, edge: 'north' },
        { x: rect.width - 1, y: Math.floor(rect.height / 2), edge: 'east' },
        { x: Math.floor(rect.width / 2), y: rect.height - 1, edge: 'south' },
        { x: 0, y: Math.floor(rect.height / 2), edge: 'west' }
    ];
    const unique = new Set();
    for (const door of candidates) {
        const key = `${door.x},${door.y},${door.edge}`;
        if (unique.has(key)) continue;
        unique.add(key);
        const approach = getVectorDoorApproach(rect, door);
        const symbol = mutable[approach.row]?.[approach.col];
        if (!symbol || symbol === 'T' || isWaterSymbol(symbol)) continue;
        if (!isLandSymbol(symbol) || occupied.has(`${approach.col},${approach.row}`)) continue;
        return { door, approach };
    }
    return null;
}

function getVectorDoorApproach(rect, door) {
    if (door.edge === 'north') return { col: rect.col + door.x, row: rect.row - 1 };
    if (door.edge === 'east') return { col: rect.col + rect.width, row: rect.row + door.y };
    if (door.edge === 'west') return { col: rect.col - 1, row: rect.row + door.y };
    return { col: rect.col + door.x, row: rect.row + rect.height };
}

function createTownVectorStairs(source, door, interiorWidth, interiorHeight) {
    if (interiorWidth < 2 || interiorHeight < 2) return [];
    const candidates = [
        { x: 1, y: 1 },
        { x: interiorWidth, y: 1 },
        { x: interiorWidth, y: interiorHeight },
        { x: 1, y: interiorHeight }
    ].sort((left, right) => (
        Math.hypot(right.x - door.x, right.y - door.y) -
        Math.hypot(left.x - door.x, left.y - door.y)
    ));
    const authored = source.stairs?.[0];
    const preferred = authored && authored.x >= 1 && authored.y >= 1 &&
        authored.x <= interiorWidth && authored.y <= interiorHeight
        ? { x: authored.x, y: authored.y }
        : candidates[0];
    return [{
        ...preferred,
        direction: ({ north: 'south', east: 'west', south: 'north', west: 'east' })[door.edge] || 'north',
        level: 0
    }];
}

function getTownVectorBuildingType(type, settlement, useAsCastle = false) {
    if (useAsCastle) {
        return { name: 'Burg Keep', district: 'castle', archetype: 'manor', architectureStyle: 'keep', roomType: 'hall' };
    }
    if (type === 'MANOR') {
        return { name: 'Manor', district: 'civic', archetype: 'manor', architectureStyle: 'courtyard', roomType: 'hall' };
    }
    return ({
        CHURCH: { name: 'Sanctuary', district: 'civic', archetype: 'hall', architectureStyle: 'gabled', roomType: 'hall' },
        TAVERN: { name: 'Tavern', district: 'market', archetype: 'bayfront', architectureStyle: 'market', roomType: 'hall' },
        BLACKSMITH: { name: 'Forge', district: 'artisan', archetype: 'workshop', architectureStyle: 'workshop', roomType: 'workshop' },
        FARM_HOUSE: { name: 'Farmstead', district: 'garden', archetype: 'cottage', architectureStyle: 'cottage', roomType: 'residence' },
        HOUSE_LARGE: { name: 'Townhouse', district: 'residential', archetype: 'townhouse', architectureStyle: 'townhouse', roomType: 'residence' }
    })[type] || { name: 'House', district: 'residential', archetype: 'cottage', architectureStyle: 'cottage', roomType: 'residence' };
}

function getTownVectorWallStyle(texture) {
    if (texture === 'STONE' || texture === 'STUCCO') return 'stone';
    return 'timber';
}

function getTownVectorRoofStyle(roofStyle, type) {
    if (type.district === 'castle') return roofStyle === 'THATCHED' ? 'gabled' : 'slate';
    return ({ SLATE: 'slate', THATCHED: 'thatch', TILED: 'clay' })[roofStyle] || 'gabled';
}

function getFixedKeepRotations(settlement) {
    const edgeRotation = { north: 0, east: 1, south: 2, west: 3 };
    const innermostRing = [...(settlement.wallRings || [])]
        .sort((left, right) => Number(right.ring || 0) - Number(left.ring || 0))[0];
    const aligned = (innermostRing?.gates || [])
        .map((gate) => edgeRotation[gate.edge])
        .filter(Number.isFinite);
    return [...new Set([...aligned, 0, 1, 2, 3])];
}

function getFixedKeepCenters(settlement, width, height) {
    if (settlement.col < 5 || settlement.row < 5 ||
        settlement.col >= width - 5 || settlement.row >= height - 5) return [];
    return [{ col: settlement.col, row: settlement.row }];
}

function fixedBuildingHasOpenApproach(building, mutable) {
    const [approachCol, approachRow] = building.entrance?.approachGrid || [];
    const approachSymbol = mutable[approachRow]?.[approachCol];
    if (!approachSymbol || approachSymbol === 'T' || isWaterSymbol(approachSymbol)) return false;
    const offsetX = Math.floor((mutable[0]?.length || 0) / 2);
    const offsetY = Math.floor(mutable.length / 2);
    return (building.footprintCells || []).every((cell) => {
        const symbol = mutable[building.y + cell.y + offsetY]?.[building.x + cell.x + offsetX];
        return Boolean(symbol) && symbol !== 'T' && !isWaterSymbol(symbol);
    });
}

function fixedBuildingAvoidsOccupiedCells(building, occupied, width, height) {
    const offsetX = Math.floor(width / 2);
    const offsetY = Math.floor(height / 2);
    const footprintBlocked = (building.footprintCells || []).some((cell) =>
        occupied.has(`${building.x + cell.x + offsetX},${building.y + cell.y + offsetY}`));
    if (footprintBlocked) return false;
    const [approachCol, approachRow] = building.entrance?.approachGrid || [];
    return Number.isFinite(approachCol) && Number.isFinite(approachRow) &&
        !occupied.has(`${approachCol},${approachRow}`);
}

function createWardWaveAreas({ settlement, sites, bakedSiteIds = new Set(), totalMinimum }) {
    const groups = new Map();
    for (const site of sites) {
        const areaId = site.areaId || `settlement-${settlement.burg.id}-ward-open`;
        if (!groups.has(areaId)) groups.set(areaId, []);
        groups.get(areaId).push(site);
    }
    const fixedSiteIds = bakedSiteIds instanceof Set ? bakedSiteIds : new Set(bakedSiteIds || []);
    const fixedTotal = sites.filter((site) => fixedSiteIds.has(site.id)).length;
    const generatedMinimum = Math.max(0, Math.min(totalMinimum, sites.length) - fixedTotal);
    const totalOpenSites = Math.max(1, sites.length - fixedTotal);
    let remainingGeneratedMinimum = generatedMinimum;
    const areas = [...groups]
        .sort(([left], [right]) => String(left).localeCompare(String(right)))
        .map(([id, areaSites], index, all) => {
            const ward = settlement.wards.find((candidate) => id === wardAreaId(settlement, candidate)) ||
                getSettlementWardAt(settlement,
                    Math.round(areaSites[0].x + Math.floor(settlement.wallBounds.width / 2)),
                    Math.round(areaSites[0].y + Math.floor(settlement.wallBounds.height / 2)));
            const fixedInArea = areaSites.filter((site) => fixedSiteIds.has(site.id)).length;
            const openSitesInArea = areaSites.length - fixedInArea;
            const proportionalGenerated = index === all.length - 1
                ? remainingGeneratedMinimum
                : Math.min(
                    openSitesInArea,
                    Math.floor(generatedMinimum * openSitesInArea / totalOpenSites)
                );
            const generatedInArea = Math.min(openSitesInArea, proportionalGenerated);
            const minimumBuildings = fixedInArea + generatedInArea;
            remainingGeneratedMinimum -= generatedInArea;
            return {
                id,
                siteIds: areaSites.map((site) => site.id),
                minimumBuildings,
                walled: settlement.walled,
                priority: wardLandmarkPriority(ward?.district),
                district: ward?.district || areaSites[0].district || 'residential',
                wfcPriors: ward?.wfcPriors || {
                    buildingDensity: settlement.walled ? 0.78 : 0.52,
                    elevationVariance: settlement.walled ? 0.2 : 0.55,
                    archetypeWeights: {}
                }
            };
        });
    if (!areas.length) {
        areas.push({
            id: `settlement-${settlement.burg.id}-ward-open`,
            siteIds: [],
            minimumBuildings: 0,
            walled: settlement.walled,
            priority: 0,
            district: 'residential',
            wfcPriors: { buildingDensity: 0.58, elevationVariance: 0.4, archetypeWeights: {} }
        });
    }
    return areas;
}

function wardAreaId(settlement, ward) {
    return `settlement-${settlement.burg.id}-ward-${ward?.ring ?? 0}-${ward?.district || 'residential'}`;
}

function wardLandmarkPriority(district) {
    return ({ castle: 10, civic: 9, market: 8, harbor: 7, artisan: 5, residential: 4, garden: 3 })[district] || 1;
}

function createBakedWaveAnchors({
    buildings,
    settlement,
    fields,
    constraintField,
    offsetX,
    offsetY,
    width
}) {
    const sites = [];
    const modules = [];
    const fixed = new Map();
    const siteIds = new Set();
    for (const [index, building] of buildings.entries()) {
        const siteId = `burg-${settlement.burg.id}-fixed-baked-${index}`;
        const moduleId = `building-baked-${settlement.burg.id}-${index}`;
        const centerCol = building.x + offsetX + Math.floor(building.width / 2);
        const centerRow = building.y + offsetY + Math.floor(building.height / 2);
        const cellId = centerRow * width + centerCol;
        const field = fields[cellId] || {};
        const constraint = constraintField?.cells?.[cellId] || {};
        // The fixed WFC node represents landmark occupancy/adjacency. Its synthetic module uses
        // a centered door, while the actual baked building retains its validated authored edge
        // offset and separately reserved approach.
        const syntheticApproach = getRectDoorApproach({
            col: building.x,
            row: building.y,
            width: building.width,
            height: building.height
        }, building.door.edge);
        const isLandmark = ['castle-keep', 'clocktower', 'lighthouse', 'market-hall', 'civic-hall'].includes(building.blueprintId);
        const ward = settlement.wards.find((candidate) => candidate.district === building.district) ||
            settlement.wards[settlement.wards.length - 1] || null;
        const areaId = wardAreaId(settlement, ward);
        modules.push(Object.freeze({
            id: moduleId,
            label: building.name,
            kind: 'building',
            weight: 0.01,
            tags: Object.freeze([
                'land',
                'settlement',
                'baked',
                building.district || 'civic',
                ...(isLandmark ? ['landmark'] : [])
            ]),
            interiorWidth: Math.max(1, building.width - 2),
            interiorHeight: Math.max(1, building.height - 2),
            footprintWidth: building.width,
            footprintHeight: building.height
        }));
        const insideWalls = settlement.walled && isInsideWallBounds(
            building.x + offsetX + Math.floor(building.width / 2),
            building.y + offsetY + Math.floor(building.height / 2),
            settlement.wallBounds
        );
        sites.push({
            id: siteId,
            x: building.x,
            y: building.y,
            width: building.width,
            height: building.height,
            areaId,
            district: ward?.district || building.district || 'civic',
            wfcPriors: ward?.wfcPriors,
            allowedDoorEdges: [building.door.edge],
            reservedExteriorApproach: {
                edge: building.door.edge,
                x: syntheticApproach.col,
                y: syntheticApproach.row
            },
            ...(insideWalls ? { withinWalls: true } : { confinement: settlement.walled ? 0.58 : 0.66 }),
            geography: {
                land: 1,
                height: field.height,
                riverInfluence: field.riverInfluence,
                routeInfluence: Math.max(0.78, Number(field.routeInfluence) || 0),
                settlementInfluence: Math.max(0.92, Number(constraint.urbanization) || 0),
                treeCover: 0.18,
                inhibitor: Math.max(0.82, Number(constraint.inhibitor) || 0)
            }
        });
        fixed.set(siteId, moduleId);
        siteIds.add(siteId);
    }
    return { sites, modules, fixed, siteIds };
}

function applyContextualTerrainAssignments({
    assignment,
    sites,
    mutable,
    paletteRows,
    elevationRows,
    constraintField,
    settlement,
    occupied = new Set(),
    offsetX,
    offsetY
}) {
    if (!(assignment instanceof Map)) return;
    const width = mutable[0]?.length || 0;
    const moduleById = new Map(CONTEXTUAL_WFC_MODULES.map((module) => [module.id, module]));
    for (const site of sites) {
        const moduleId = assignment.get(site.id);
        const module = moduleById.get(moduleId);
        if (!module || module.kind === 'building') continue;
        for (let localY = 0; localY < site.height; localY++) {
            for (let localX = 0; localX < site.width; localX++) {
                const col = site.x + offsetX + localX;
                const row = site.y + offsetY + localY;
                const constraint = constraintField?.cells?.[row * width + col];
                if (!mutable[row]?.[col] || constraint?.hardWater || mutable[row][col] === 'T') continue;
                if (moduleId === 'terrain-path') {
                    mutable[row][col] = 'R';
                    paletteRows[row][col] = 'path';
                } else if (moduleId === 'settlement-square') {
                    mutable[row][col] = ';';
                    paletteRows[row][col] = 'path';
                } else if (moduleId === 'terrain-grove') {
                    mutable[row][col] = 'F';
                    paletteRows[row][col] = paletteRows[row][col] || 'forest';
                } else if (moduleId === 'terrain-relief') {
                    mutable[row][col] = 'H';
                    // Visual relief can change the surface tile, but elevation belongs to the
                    // selected 5x5/3x3 macro module. A one-off +1 here created hanging parcels.
                    elevationRows[row][col] = clampInteger(elevationRows[row][col], 0, 6);
                } else if (moduleId === 'terrain-water') {
                    mutable[row][col] = '~';
                    paletteRows[row][col] = 'coast';
                } else {
                    const localCol = col - settlement.col;
                    const localRow = row - settlement.row;
                    mutable[row][col] = (localCol + localRow) % 7 === 0 ? ',' : '.';
                }
            }
        }
    }
    const protectedElevations = new Set([
        ...collectProtectedElevationKeys(constraintField),
        ...(occupied instanceof Set ? occupied : [])
    ]);
    for (const site of sites) {
        const module = moduleById.get(assignment.get(site.id));
        if (module?.kind !== 'building') continue;
        for (let localY = 0; localY < site.height; localY++) {
            for (let localX = 0; localX < site.width; localX++) {
                protectedElevations.add(elevationCellKey(
                    site.x + offsetX + localX,
                    site.y + offsetY + localY
                ));
            }
        }
    }
    smoothRoadElevations(mutable, elevationRows, protectedElevations);
    relaxSymbolElevationRamps(mutable, elevationRows, protectedElevations);
}

function getLegalParcelDoorEdges({ rect, mutable, elevationRows, occupied, constraintField, width, seed }) {
    const edges = ['north', 'east', 'south', 'west']
        .map((edge) => {
            const approach = getRectDoorApproach(rect, edge);
            const threshold = getRectDoorThreshold(rect, edge);
            const symbol = mutable[approach.row]?.[approach.col];
            const constraint = constraintField?.cells?.[approach.row * width + approach.col];
            if (!symbol || constraint?.hardWater || symbol === 'T' || isWaterSymbol(symbol)) return null;
            if (occupied?.has?.(`${approach.col},${approach.row}`)) return null;
            if (!isLandSymbol(symbol)) return null;
            const roadDistance = nearestReachableSymbolDistance({
                rows: mutable,
                startCol: approach.col,
                startRow: approach.row,
                symbols: WORLD_ROAD_SYMBOLS,
                maximumDistance: 8,
                occupied,
                blockedRect: rect
            });
            if (roadDistance > 8) return null;
            const approachElevation = Number(elevationRows?.[approach.row]?.[approach.col]);
            const thresholdElevation = Number(elevationRows?.[threshold.row]?.[threshold.col]);
            if (Number.isFinite(approachElevation) && Number.isFinite(thresholdElevation) &&
                Math.abs(approachElevation - thresholdElevation) > 1) return null;
            return {
                edge,
                score: (WORLD_ROAD_SYMBOLS.has(symbol) ? 6 : 0)
                    + Math.max(0, 8 - roadDistance) * 0.5
                    + (Number.isFinite(approachElevation) && approachElevation === thresholdElevation ? 1.5 : 0)
                    + keyedUnit(`${seed}:${edge}`) * 0.2
            };
        })
        .filter(Boolean)
        .sort((left, right) => right.score - left.score || left.edge.localeCompare(right.edge));
    return edges.map((entry) => entry.edge);
}

function getRectDoorApproach(rect, edge) {
    if (edge === 'north') return { col: rect.col + Math.floor(rect.width / 2), row: rect.row - 1 };
    if (edge === 'east') return { col: rect.col + rect.width, row: rect.row + Math.floor(rect.height / 2) };
    if (edge === 'west') return { col: rect.col - 1, row: rect.row + Math.floor(rect.height / 2) };
    return { col: rect.col + Math.floor(rect.width / 2), row: rect.row + rect.height };
}

function getRectDoorThreshold(rect, edge) {
    if (edge === 'north') return { col: rect.col + Math.floor(rect.width / 2), row: rect.row };
    if (edge === 'east') return { col: rect.col + rect.width - 1, row: rect.row + Math.floor(rect.height / 2) };
    if (edge === 'west') return { col: rect.col, row: rect.row + Math.floor(rect.height / 2) };
    return { col: rect.col + Math.floor(rect.width / 2), row: rect.row + rect.height - 1 };
}

function createContextualParcelSites({
    mutable,
    elevationRows,
    fields,
    constraintField,
    settlement,
    occupied,
    offsetX,
    offsetY,
    width,
    height,
    seed
}) {
    const candidates = [];
    const bounds = settlement.wallBounds;
    for (let row = bounds.minRow + 1; row <= bounds.maxRow - 4; row++) {
        for (let col = bounds.minCol + 1; col <= bounds.maxCol - 3; col++) {
            const localCol = col - settlement.col;
            const localRow = row - settlement.row;
            const hash = hashWaveSeed(`${seed}:parcel:${settlement.burg.id}:${localCol}:${localRow}`);
            const sizeClass = hash % 12;
            const smallRotated = ((hash >>> 4) % 2 === 1);
            const rectOptions = [{
                col,
                row,
                width: smallRotated ? 5 : 4,
                height: smallRotated ? 4 : 5
            }];
            if (settlement.walled || sizeClass >= 7) {
                const [largeWidth, largeHeight] = sizeClass < 10 ? [5, 6] : [6, 6];
                const largeRotated = largeWidth !== largeHeight && ((hash >>> 7) % 2 === 1);
                rectOptions.push({
                    col,
                    row,
                    width: largeRotated ? largeHeight : largeWidth,
                    height: largeRotated ? largeWidth : largeHeight
                });
            }
            for (const rect of rectOptions) {
                if (rect.col + rect.width >= bounds.maxCol || rect.row + rect.height >= bounds.maxRow) continue;
                if (bounds.insideCellKeys instanceof Set && !isRectInsideWallMask(rect, bounds)) continue;
                if (!canPlaceContextualParcel(rect, mutable, elevationRows, occupied)) continue;
                const allowedDoorEdges = getLegalParcelDoorEdges({
                    rect,
                    mutable,
                    elevationRows,
                    occupied,
                    constraintField,
                    width,
                    seed: `${seed}:parcel-door:${settlement.burg.id}:${localCol}:${localRow}:${rect.width}x${rect.height}`
                });
                if (!allowedDoorEdges.length) continue;
                const centerCol = Math.round(rect.col + (rect.width - 1) / 2);
                const centerRow = Math.round(rect.row + (rect.height - 1) / 2);
                const roadDistance = nearestSymbolDistance(mutable, centerCol, centerRow, WORLD_ROAD_SYMBOLS, 6);
                if (roadDistance > 6) continue;
                candidates.push({
                    rect,
                    allowedDoorEdges,
                    roadDistance,
                    score: roadDistance * (settlement.walled ? 0.18 : 1)
                        // Confinement should read as a town, not scattered cabins. Once slope,
                        // water, walls and a legal door approach all pass, prefer the larger lot
                        // inside walls; open fiefs retain the lighter small-lot bias.
                        + rect.width * rect.height * (settlement.walled ? -0.035 : 0.004)
                        + keyedUnit(
                            `${seed}:parcel-score:${settlement.burg.id}:${localCol}:${localRow}:${rect.width}x${rect.height}`
                        ) * (settlement.walled ? 0.2 : 0.7)
                });
            }
        }
    }
    candidates.sort((a, b) => a.score - b.score || a.rect.row - b.rect.row || a.rect.col - b.rect.col);

    const sites = [];
    const reserved = new Set(occupied instanceof Set ? occupied : []);
    const baseTarget = settlement.walled
        ? clampInteger(14 + Math.sqrt(Math.max(1, settlement.burg.population)) * 0.86, 16, 30)
        : clampInteger(5 + Math.sqrt(Math.max(1, settlement.burg.population)) * 0.48, 6, 14);
    // Source footprints are usually larger than formula cabins, so each displaces about one and
    // a half infill parcels. This keeps a compact burg with many authored buildings from becoming
    // visually overloaded while still leaving enough WFC sites to vary streets between sessions.
    const sourceBuildingCount = settlement.townVector?.buildings?.length || 0;
    const target = Math.max(
        settlement.walled ? 8 : 4,
        baseTarget - Math.ceil(sourceBuildingCount * 1.5)
    );
    for (const candidate of candidates) {
        if (sites.length >= target) break;
        if (!canPlaceContextualParcel(candidate.rect, mutable, elevationRows, reserved)) continue;
        const allowedDoorEdges = getLegalParcelDoorEdges({
            rect: candidate.rect,
            mutable,
            elevationRows,
            occupied: reserved,
            constraintField,
            width,
            seed: `${seed}:selected-door:${settlement.burg.id}:` +
                `${candidate.rect.col - settlement.col}:${candidate.rect.row - settlement.row}`
        });
        if (!allowedDoorEdges.length) continue;
        const allowedDoorEdge = allowedDoorEdges[0];
        const exteriorApproach = getRectDoorApproach(candidate.rect, allowedDoorEdge);
        const centerCol = Math.floor(candidate.rect.col + candidate.rect.width / 2);
        const centerRow = Math.floor(candidate.rect.row + candidate.rect.height / 2);
        const id = centerRow * width + centerCol;
        const field = fields[id] || {};
        const constraint = constraintField?.cells?.[id] || {};
        const siteId = `burg-${settlement.burg.id}-parcel-${sites.length}`;
        const ward = getSettlementWardAt(settlement, centerCol, centerRow) || settlement.wards[0] || null;
        sites.push({
            id: siteId,
            x: candidate.rect.col - offsetX,
            y: candidate.rect.row - offsetY,
            width: candidate.rect.width,
            height: candidate.rect.height,
            areaId: wardAreaId(settlement, ward),
            district: ward?.district || 'residential',
            wfcPriors: ward?.wfcPriors,
            allowedDoorEdges: [allowedDoorEdge],
            reservedExteriorApproach: {
                edge: allowedDoorEdge,
                x: exteriorApproach.col - offsetX,
                y: exteriorApproach.row - offsetY
            },
            ...(settlement.walled ? { withinWalls: true } : { confinement: 0.62 }),
            geography: {
                land: constraint.hardWater ? 0 : Math.max(0.82, Number(field.land) || 0),
                height: field.height,
                riverInfluence: field.riverInfluence,
                routeInfluence: Math.max(field.routeInfluence || 0, Math.max(0, 1 - candidate.roadDistance / 5)),
                settlementInfluence: Math.max(constraint.urbanization || 0, settlement.walled ? 0.94 : 0.66),
                treeCover: mutable[centerRow]?.[centerCol] === 'F' ? 0.82 : 0.24,
                inhibitor: settlement.walled ? Math.max(0.82, constraint.inhibitor || 0) : Math.max(0.58, constraint.inhibitor || 0)
            }
        });
        // Keep a one-cell alley around generated parcels. The source vector may intentionally
        // contain attached rowhouses, but residual WFC buildings must not turn those authored
        // blocks into an unbroken roof carpet or seal their own door landings.
        reserveRect(reserved, candidate.rect, 1);
        reserved.add(`${exteriorApproach.col},${exteriorApproach.row}`);
    }
    return sites;
}

function isRectInsideWallMask(rect, bounds) {
    for (let row = rect.row; row < rect.row + rect.height; row++) {
        for (let col = rect.col; col < rect.col + rect.width; col++) {
            if (!isInsideWallBounds(col, row, bounds)) return false;
        }
    }
    return true;
}

function canPlaceContextualParcel(rect, mutable, elevationRows, occupied) {
    const elevations = [];
    for (let row = rect.row; row < rect.row + rect.height; row++) {
        for (let col = rect.col; col < rect.col + rect.width; col++) {
            if (!isBuildableSymbol(mutable[row]?.[col]) || occupied?.has?.(`${col},${row}`)) return false;
            elevations.push(Number(elevationRows[row]?.[col]) || 0);
        }
    }
    return elevations.length > 0 && Math.max(...elevations) - Math.min(...elevations) <= 1;
}

function finalizeContextualBuilding({ building, settlement, indexInTown, elevationRows, offsetX, offsetY, seed }) {
    const hash = hashWaveSeed(`${seed}:contextual-building:${settlement.burg.id}:${building.siteId}`);
    const interior = building.interior || {
        x: 1,
        y: 1,
        width: Math.max(2, building.width - 2),
        height: Math.max(3, building.height - 2)
    };
    const stories = building.wfcModuleId === 'building-hall' ? 2 : 1;
    const style = hash % 3 === 0 || building.wfcModuleId === 'building-hall'
        ? 'stone'
        : building.wfcModuleId === 'building-cottage'
            ? 'storybook'
            : 'timber';
    const roomType = building.wfcModuleId === 'building-workshop'
        ? 'workshop'
        : building.wfcModuleId === 'building-shop'
            ? 'shop'
            : building.wfcModuleId === 'building-hall'
                ? 'hall'
                : 'common';
    const lot = { col: building.x + offsetX, row: building.y + offsetY };
    const worldFootprintCells = (building.footprintCells || []).map((cell) => ({
        col: lot.col + cell.x,
        row: lot.row + cell.y
    }));
    const elevationSafety = analyzeBuildingFootprintElevation(worldFootprintCells, elevationRows);
    const stairs = stories > 1
        ? [{ x: Math.max(1, building.width - 2), y: Math.max(1, building.height - 2), direction: 'north' }]
        : [];
    return {
        ...building,
        id: `wfc-${settlement.burg.id}-${indexInTown}-${hash.toString(16).slice(0, 6)}`,
        obstructionTag: `building:wfc:${settlement.burg.id}:${indexInTown}`,
        name: `${settlement.burg.name} ${building.name}`,
        stories,
        style,
        doorStyle: ['oak', 'painted', 'iron'][hash % 3],
        stairs,
        stairCells: [],
        baseElevation: dominantFootprintElevation(lot, building.footprintCells, elevationRows),
        proceduralGenerated: true,
        wfcGenerated: true,
        baked: false,
        preserveEntrance: true,
        enterable: true,
        sourceType: 'contextual-building-wfc',
        facadeVariant: hash % 17,
        placementConstraints: {
            ...(building.placementConstraints || {}),
            elevationSpan: elevationSafety.span,
            maxAdjacentElevationDelta: elevationSafety.maxAdjacentDelta,
            reliefFormulaVersion: settlement.reliefProfile?.formulaVersion ?? FMG_BURG_RELIEF_FORMULA_VERSION,
            reliefScore: settlement.reliefProfile?.reliefScore ?? 0,
            reliefClass: settlement.reliefProfile?.reliefClass ?? 'none',
            targetTierSpan: settlement.reliefProfile?.targetTierSpan ?? 1
        },
        interior: {
            ...interior,
            minimumOpenSpan: [Math.min(interior.width, interior.height), Math.max(interior.width, interior.height)],
            openCells: building.interiorCells.map((cell) => ({ ...cell })),
            floorHeightVoxels: 2
        },
        floors: Array.from({ length: stories }, (_, level) => ({
            level,
            rooms: [{
                type: roomType,
                gridRect: { x: interior.x, y: interior.y, width: interior.width, height: interior.height },
                doors: level === 0 ? [{ grid: [building.door.x, building.door.y] }] : []
            }]
        }))
    };
}

function applySettlementWave(buildings, mutableRows, elevationRows, settlement, seed) {
    if (!buildings.length) return;
    try {
        const planned = planTownWave({
            buildings,
            rows: mutableRows,
            elevationRows,
            seed: `${seed}:settlement`,
            townId: settlement.burg.id,
            archetypes: SETTLEMENT_ARCHETYPES,
            landmarkArchetypes: LANDMARK_ARCHETYPES
        });
        for (const building of buildings) {
            const assignment = planned.assignments.get(building.id);
            if (!assignment) continue;
            const district = building.district || assignment.district;
            const districtStyle = getBlueprintDistrictStyle(district);
            building.district = district;
            building.districtPalette = {
                ...assignment.palette,
                roofs: [...districtStyle.roofs],
                accent: mixColorNumbers(districtStyle.accent, settlement.accent, 0.38)
            };
            building.activity = districtStyle.activity || assignment.activity;
            building.archetype = contextualArchetype(building.wfcModuleId, district, assignment.archetype);
            building.architectureStyle = building.archetype;
            const roofs = districtStyle.roofs;
            building.roofStyle = roofs[hashWaveSeed(`${seed}:${building.id}:roof`) % roofs.length];
        }
    } catch (error) {
        if (!(error instanceof WaveFunctionCollapseError)) throw error;
        for (const [index, building] of buildings.entries()) {
            building.district = building.district || (index === 0 ? 'civic' : 'residential');
            const style = getBlueprintDistrictStyle(building.district);
            building.archetype = contextualArchetype(building.wfcModuleId, building.district, index === 0 ? 'hall' : 'cottage');
            building.architectureStyle = building.archetype;
            building.roofStyle = style.roofs[hashWaveSeed(`${seed}:${building.id}`) % style.roofs.length];
            building.districtPalette = { accent: mixColorNumbers(style.accent, settlement.accent, 0.38), roofs: [...style.roofs] };
        }
    }
}

function getBlueprintDistrictStyle(district) {
    return ({
        castle: { accent: 0x2f6fce, roofs: ['slate', 'copper', 'tower'], activity: 'guard' },
        civic: { accent: 0xf2c35a, roofs: ['copper', 'slate', 'tower'], activity: 'gather' },
        market: { accent: 0xf07b4f, roofs: ['market', 'clay', 'copper'], activity: 'trade' },
        residential: { accent: 0x4fb7a7, roofs: ['gabled', 'clay', 'slate'], activity: 'home' },
        artisan: { accent: 0xb56d43, roofs: ['clay', 'slate', 'thatch'], activity: 'craft' },
        garden: { accent: 0x77b84e, roofs: ['thatch', 'gabled', 'copper'], activity: 'grow' },
        harbor: { accent: 0x2fa7c4, roofs: ['copper', 'slate', 'clay'], activity: 'dock' }
    })[district] || { accent: 0x4fb7a7, roofs: ['gabled', 'clay', 'slate'], activity: 'home' };
}

function contextualArchetype(moduleId, district, fallback) {
    if (district === 'castle') return 'manor';
    return ({
        'building-cabin': 'cottage',
        'building-cottage': 'cottage',
        'building-shop': 'bayfront',
        'building-house': 'townhouse',
        'building-workshop': 'workshop',
        'building-hall': 'hall'
    })[moduleId] || fallback || 'cottage';
}

function synthesizeDecorations({ rows, paletteRows, fields, buildings, settlements, skeleton, constraintField = null, seed, width, height }) {
    const decorations = [];
    const blocked = new Set();
    const offsetX = Math.floor(width / 2);
    const offsetY = Math.floor(height / 2);
    for (const building of buildings) reserveBuilding(blocked, building, offsetX, offsetY, 1);
    for (const settlement of settlements) {
        if (settlement.blueprint?.hierarchy === 'seat') {
            const plaza = findWardDecorationCell({ rows, blocked, settlement, district: 'market', width, height, salt: 0 }) ||
                findWardDecorationCell({ rows, blocked, settlement, district: 'civic', width, height, salt: 0 });
            if (plaza) {
                decorations.push({
                    type: 'fountain', x: plaza.col - offsetX, y: plaza.row - offsetY,
                    matrixLandmark: true, district: 'market', accent: 0xf2c35a, blueprintFixed: true
                });
                for (const [index, type] of ['stall', 'stall', 'lantern_cluster'].entries()) {
                    const cell = findWardDecorationCell({
                        rows, blocked, settlement, district: 'market', width, height,
                        salt: index + 2, near: plaza
                    });
                    if (!cell) continue;
                    decorations.push({
                        type, x: cell.col - offsetX, y: cell.row - offsetY,
                        rotation: index % 2 ? -Math.PI / 2 : Math.PI / 2,
                        matrixLandmark: true, district: 'market',
                        accent: [0xf07b4f, 0x4fb7a7, 0xf2c35a][index], blueprintFixed: true
                    });
                }
            }
            for (let index = 0; index < 2; index++) {
                const castleCell = findWardDecorationCell({
                    rows, blocked, settlement, district: 'castle', width, height, salt: 7 + index
                });
                if (!castleCell) continue;
                decorations.push({
                    type: index === 0 ? 'banner' : 'lantern_cluster',
                    x: castleCell.col - offsetX,
                    y: castleCell.row - offsetY,
                    matrixLandmark: true,
                    district: 'castle',
                    accent: index === 0 ? 0x2f6fce : 0xf2c35a,
                    blueprintFixed: true
                });
            }
            for (const gate of settlement.gates || []) {
                decorations.push({
                    type: 'archway',
                    x: gate.col - offsetX,
                    y: gate.row - offsetY,
                    rotation: gate.edge === 'east' || gate.edge === 'west' ? Math.PI / 2 : 0,
                    matrixLandmark: true,
                    district: 'civic',
                    accent: settlement.accent,
                    gatehouse: true,
                    grand: gate.grand === true,
                    widthTiles: gate.widthTiles || 1,
                    blueprintFixed: true
                });
            }
        } else {
            const center = findWardDecorationCell({
                rows, blocked, settlement, district: settlement.wards[0]?.district, width, height, salt: settlement.burg.id
            });
            if (center) {
                const liege = settlement.blueprint?.liegeBurgId;
                decorations.push(
                    {
                        type: 'well', x: center.col - offsetX, y: center.row - offsetY,
                        district: 'residential', accent: settlement.accent, blueprintFixed: true
                    },
                    {
                        type: 'sign', x: center.col + 2 - offsetX, y: center.row - offsetY,
                        district: 'residential', destinations: [settlement.burg.id, liege].filter(Boolean), blueprintFixed: true
                    },
                    {
                        type: hashWaveSeed(`${seed}:fief-kit:${settlement.burg.id}`) % 2 ? 'garden' : 'cart',
                        x: center.col - 2 - offsetX, y: center.row + 1 - offsetY,
                        district: 'garden', blueprintFixed: true
                    }
                );
            }
        }
    }

    appendBakedStreetUtilityDecorations({
        decorations,
        blocked,
        rows,
        skeleton,
        seed,
        offsetX,
        offsetY,
        width,
        height
    });

    const waterfallTops = [...(skeleton?.cells?.values?.() || [])]
        .filter((cell) => cell.kind === 'waterfall' && cell.tier === 0)
        .sort((left, right) => left.id - right.id);
    for (const fixed of waterfallTops) {
        decorations.push({
            type: 'waterfall',
            x: fixed.col - offsetX,
            y: fixed.row - offsetY,
            rotation: edgeRotation(fixed.edge),
            direction: fixed.edge,
            dropTiers: fixed.dropTiers,
            widthTiles: fixed.widthTiles,
            intensity: fixed.intensity,
            plungePool: fixed.plungePool,
            directiveId: fixed.directiveId,
            blueprintFixed: true,
            district: 'wilderness'
        });
    }
    const dockAnchors = [...(skeleton?.cells?.values?.() || [])]
        .filter((cell) => cell.kind === 'dock' && cell.step === 0)
        .sort((left, right) => left.id - right.id);
    for (const fixed of dockAnchors) {
        decorations.push({
            type: 'dock', x: fixed.col - offsetX, y: fixed.row - offsetY,
            rotation: edgeRotation(fixed.edge), direction: fixed.edge, lengthTiles: fixed.length,
            district: 'harbor', blueprintFixed: true
        });
    }
    appendCaveMouthDecorations({ decorations, blocked, rows, fields, width, height, offsetX, offsetY });
    appendRegionalResourceNodes({
        decorations, blocked, rows, fields, constraintField, seed, width, height, offsetX, offsetY
    });
    for (let row = 1; row < height - 1 && decorations.length < MAX_DECORATIONS; row++) {
        for (let col = 1; col < width - 1 && decorations.length < MAX_DECORATIONS; col++) {
            const key = `${col},${row}`;
            if (blocked.has(key) || !isDecorationGround(rows[row]?.[col])) continue;
            const palette = paletteRows[row]?.[col] || 'meadow';
            const field = fields[row * width + col];
            const globalKey = globalFieldSampleKey(field);
            const unit = keyedUnit(`${seed}:decor:${globalKey}`);
            // Outside settlements the environment picks the decoration family and scales density;
            // inside them (urbanization >= 0.55) the palette families keep town dressing tidy.
            const wild = (constraintField?.cells?.[row * width + col]?.urbanization || 0) < 0.55;
            const environment = wild ? getEnvironmentProfile(field?.environmentId) : null;
            const baseDensity = ['forest', 'jungle', 'taiga'].includes(palette) ? 0.082 : palette === 'meadow' ? 0.036 : 0.022;
            const density = baseDensity * (environment?.decor.density ?? 1);
            if (unit >= density) continue;
            if (decorations.some((item) => Math.hypot(item.x - (col - offsetX), item.y - (row - offsetY)) < 1.8)) continue;
            const typeUnit = keyedUnit(`${seed}:decor-type:${globalKey}`);
            const facies = environment ? getEnvironmentFacies(environment, field?.terrainNoiseMask?.faciesId) : null;
            const families = facies?.decor || environment?.decor.families;
            decorations.push({
                type: families?.length
                    ? families[Math.min(families.length - 1, Math.floor(typeUnit * families.length))]
                    : getDecorationType(palette, typeUnit),
                x: col - offsetX,
                y: row - offsetY,
                rotation: (hashWaveSeed(`${seed}:decor-rotation:${globalKey}`) % 4) * Math.PI / 2,
                biome: palette,
                ...(environment ? { environmentId: environment.id } : {}),
                ...(facies ? { faciesId: facies.id } : {})
            });
        }
    }
    return decorations;
}

const MAX_RESOURCE_NODES = 18;
const RESOURCE_NODE_SPACING = 3.5;
const RESOURCE_ZONE_SCALE = 7;

// Regional resources: each state (or province variant) has one signature resource that spawns
// only in its listed environments, in wilderness cells, clustered by a world-anchored zone field
// so nodes come in veins/patches rather than salt-and-pepper.
function appendRegionalResourceNodes({
    decorations, blocked, rows, fields, constraintField, seed, width, height, offsetX, offsetY
}) {
    const candidates = [];
    for (let row = 1; row < height - 1; row++) {
        for (let col = 1; col < width - 1; col++) {
            const id = row * width + col;
            if (blocked.has(`${col},${row}`) || !isDecorationGround(rows[row]?.[col])) continue;
            const constraint = constraintField?.cells?.[id];
            if ((constraint?.urbanization || 0) >= 0.25 || constraint?.insideWall || constraint?.fixedTerrain) continue;
            const field = fields[id];
            const environment = getEnvironmentProfile(field?.environmentId);
            if (!environment?.resourceDensity) continue;
            const resource = resolveRegionalResource({
                stateId: field.state,
                provinceId: field.province,
                environmentId: environment.id
            });
            if (!resource) continue;
            const globalCol = field.globalCol;
            const globalRow = field.globalRow;
            // The zone field is keyed on the world seed, not the variant, so a region's veins stay
            // where players learned them when Regenerate reshuffles the scenery around them.
            const zone = smoothKeyedUnit(globalCol / RESOURCE_ZONE_SCALE, globalRow / RESOURCE_ZONE_SCALE,
                `${ACTIVE_WORLD.seed}:resource-zone:${resource.id}`);
            if (zone < 1 - resource.abundance) continue;
            const unit = mixedUnit(`${ACTIVE_WORLD.seed}:resource-node:${resource.id}:${globalCol},${globalRow}`);
            if (unit >= environment.resourceDensity * 4) continue;
            candidates.push({ col, row, field, resource, environment, zone, unit });
        }
    }
    // Strongest zone cells first (ties broken by the world-anchored unit), so the per-view budget
    // is spent on vein centres instead of whichever rows the scan reaches first.
    // Bilinear zone peaks sit on lattice lines, so rank on a zone + scatter blend to avoid
    // nodes queuing up in straight columns.
    for (const candidate of candidates) {
        candidate.priority = candidate.zone * 0.45 + mixedUnit(
            `${ACTIVE_WORLD.seed}:resource-scatter:${candidate.field.globalCol},${candidate.field.globalRow}`
        ) * 0.55;
    }
    candidates.sort((left, right) => (right.priority - left.priority) || (left.unit - right.unit) ||
        (left.field.globalRow - right.field.globalRow) || (left.field.globalCol - right.field.globalCol));
    const placed = [];
    for (const { col, row, field, resource, environment } of candidates) {
        if (placed.length >= MAX_RESOURCE_NODES) break;
        const globalCol = field.globalCol;
        const globalRow = field.globalRow;
        const x = col - offsetX;
        const y = row - offsetY;
        if (placed.some((node) => Math.hypot(node.x - x, node.y - y) < RESOURCE_NODE_SPACING)) continue;
        if (decorations.some((item) => Math.hypot(item.x - x, item.y - y) < 1.4)) continue;
        const node = {
            type: 'resource_node',
            x,
            y,
            rotation: (hashWaveSeed(`${seed}:resource-rotation:${globalCol},${globalRow}`) % 4) * Math.PI / 2,
            resourceId: resource.id,
            resourceName: resource.name,
            form: resource.form,
            accent: resource.hex,
            stateId: resource.stateId,
            provinceId: resource.provinceId,
            environmentId: environment.id,
            globalCol,
            globalRow,
            district: 'wilderness',
            harvestable: true
        };
        placed.push(node);
        decorations.push(node);
        blocked.add(`${col},${row}`);
    }
}

// World-anchored cave entrances from the environment design. The mouth snaps to the nearest open
// wilderness cell within a few cells of its authored anchor so settlement stamping can't bury it.
function appendCaveMouthDecorations({ decorations, blocked, rows, fields, width, height, offsetX, offsetY }) {
    const caves = getCaveDefinitions();
    if (!caves.length || !fields.length) return;
    const origin = fields[0];
    for (const cave of caves) {
        const anchorCol = Math.round(cave.world.x / WORLD_SAMPLE_SCALE) - origin.globalCol;
        const anchorRow = Math.round(cave.world.y / WORLD_SAMPLE_SCALE) - origin.globalRow;
        if (anchorCol < -3 || anchorRow < -3 || anchorCol > width + 2 || anchorRow > height + 2) continue;
        let best = null;
        for (let radius = 0; radius <= 4 && !best; radius++) {
            for (let dy = -radius; dy <= radius && !best; dy++) {
                for (let dx = -radius; dx <= radius; dx++) {
                    if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius) continue;
                    const col = anchorCol + dx;
                    const row = anchorRow + dy;
                    if (col < 1 || row < 1 || col >= width - 1 || row >= height - 1) continue;
                    if (blocked.has(`${col},${row}`) || !isDecorationGround(rows[row]?.[col])) continue;
                    best = { col, row };
                    break;
                }
            }
        }
        if (!best) continue;
        decorations.push({
            type: 'cave_mouth',
            x: best.col - offsetX,
            y: best.row - offsetY,
            caveId: cave.id,
            caveName: cave.name,
            profile: cave.profile,
            accent: 0x1b120c,
            district: 'wilderness',
            blueprintFixed: true
        });
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) blocked.add(`${best.col + dx},${best.row + dy}`);
    }
}

function summarizeViewEnvironments(fields, decorations) {
    const histogram = {};
    const states = {};
    for (const field of fields) {
        if (!field?.environmentId) continue;
        histogram[field.environmentId] = (histogram[field.environmentId] || 0) + 1;
        if (field.state) states[field.state] = (states[field.state] || 0) + 1;
    }
    const resources = {};
    for (const decoration of decorations) {
        if (decoration.type !== 'resource_node') continue;
        resources[decoration.resourceId] = (resources[decoration.resourceId] || 0) + 1;
    }
    const dominant = Object.entries(histogram).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
    return Object.freeze({
        designHash: ENVIRONMENT_DESIGN_HASH,
        dominant,
        histogram: Object.freeze(histogram),
        states: Object.freeze(states),
        resourceNodes: Object.freeze(resources),
        caveEntrances: decorations.filter((decoration) => decoration.type === 'cave_mouth').map((decoration) => decoration.caveId)
    });
}

// FNV-1a alone barely mixes its last characters into the high bits, so keys that differ only in
// a trailing row number come out correlated (visible as resource nodes queuing in columns).
// A murmur3 finaliser avalanches every input bit. Used only by the resource layer so existing
// keyedUnit consumers keep their outputs.
function mixedUnit(value) {
    let hash = hashWaveSeed(value);
    hash ^= hash >>> 16;
    hash = Math.imul(hash, 0x85ebca6b);
    hash ^= hash >>> 13;
    hash = Math.imul(hash, 0xc2b2ae35);
    hash ^= hash >>> 16;
    return ((hash >>> 0) + 0.5) / 4294967296;
}

function smoothKeyedUnit(fx, fy, seed) {
    const x0 = Math.floor(fx);
    const y0 = Math.floor(fy);
    const tx = smoothStep(fx - x0);
    const ty = smoothStep(fy - y0);
    const at = (x, y) => mixedUnit(`${seed}:${x},${y}`);
    const top = lerp(at(x0, y0), at(x0 + 1, y0), tx);
    const bottom = lerp(at(x0, y0 + 1), at(x0 + 1, y0 + 1), tx);
    return lerp(top, bottom, ty);
}

function appendBakedStreetUtilityDecorations({
    decorations,
    blocked,
    rows,
    skeleton,
    seed,
    offsetX,
    offsetY,
    width,
    height
}) {
    const placements = new Map();
    for (const cell of skeleton?.cells?.values?.() || []) {
        if (cell.source !== 'baked-street-wfc' || !cell.moduleId || !cell.featureKind ||
            !Number.isFinite(Number(cell.moduleLocalCol)) || !Number.isFinite(Number(cell.moduleLocalRow))) continue;
        const originCol = cell.col - Number(cell.moduleLocalCol);
        const originRow = cell.row - Number(cell.moduleLocalRow);
        const key = `${cell.townId}:${originCol},${originRow}`;
        if (!placements.has(key)) placements.set(key, {
            key,
            townId: cell.townId,
            moduleId: cell.moduleId,
            featureKind: cell.featureKind,
            architectureThemeId: cell.architectureThemeId || null,
            originCol,
            originRow
        });
    }
    const decorationByFeature = Object.freeze({
        market: { type: 'stall', local: [1, 1], district: 'market' },
        fountain: { type: 'fountain', local: [2, 2], district: 'civic' },
        'rest-court': { type: 'well', local: [2, 2], district: 'residential' },
        'neighborhood-plaza': { type: 'lantern_cluster', local: [1, 1], district: 'civic' },
        'gate-approach': { type: 'banner', local: [1, 1], district: 'civic' },
        'dock-approach': { type: 'cart', local: [1, 1], district: 'harbor' },
        'bridge-approach': { type: 'lantern_cluster', local: [1, 1], district: 'harbor' }
    });
    for (const placement of [...placements.values()].sort((left, right) =>
        left.originRow - right.originRow || left.originCol - right.originCol ||
        left.moduleId.localeCompare(right.moduleId))) {
        if (decorations.length >= MAX_DECORATIONS) break;
        const spec = decorationByFeature[placement.featureKind];
        if (!spec) continue;
        const col = placement.originCol + spec.local[0];
        const row = placement.originRow + spec.local[1];
        const key = elevationCellKey(col, row);
        if (col < 1 || row < 1 || col >= width - 1 || row >= height - 1 ||
            blocked.has(key) || !WORLD_ROAD_SYMBOLS.has(rows[row]?.[col]) ||
            decorations.some((item) => Math.hypot(
                item.x - (col - offsetX),
                item.y - (row - offsetY)
            ) < 1.5)) continue;
        decorations.push({
            type: spec.type,
            x: col - offsetX,
            y: row - offsetY,
            rotation: (hashWaveSeed(`${seed}:street-utility:${placement.key}`) % 4) * Math.PI / 2,
            district: spec.district,
            architectureThemeId: placement.architectureThemeId,
            moduleId: placement.moduleId,
            featureKind: placement.featureKind,
            moduleUtility: true,
            blueprintFixed: true
        });
    }
}

function findWardDecorationCell({ rows, blocked, settlement, district, width, height, salt = 0, near = null }) {
    const candidates = [];
    for (let row = Math.max(1, settlement.wallBounds.minRow + 1); row < Math.min(height - 1, settlement.wallBounds.maxRow); row++) {
        for (let col = Math.max(1, settlement.wallBounds.minCol + 1); col < Math.min(width - 1, settlement.wallBounds.maxCol); col++) {
            if (blocked.has(`${col},${row}`)) continue;
            if (!['G', 'F', 'H', 'S', 'P', 'R', '.', ',', ';'].includes(rows[row]?.[col])) continue;
            const ward = getSettlementWardAt(settlement, col, row);
            if (district && ward?.district !== district) continue;
            const target = near || { col: settlement.col, row: settlement.row };
            const localCol = col - settlement.col;
            const localRow = row - settlement.row;
            candidates.push({
                col,
                row,
                score: Math.hypot(col - target.col, row - target.row) +
                    keyedUnit(
                        `${settlement.burg.id}:ward-decoration:${district}:${salt}:${localCol}:${localRow}`
                    ) * 3
            });
        }
    }
    return candidates.sort((left, right) => left.score - right.score || left.row - right.row || left.col - right.col)[0] || null;
}

function edgeRotation(edge) {
    return edge === 'east' ? Math.PI / 2 : edge === 'south' ? Math.PI : edge === 'west' ? -Math.PI / 2 : 0;
}

function createVisualVariantRows({ rows, paletteRows, seed, centerX, centerY, width, height }) {
    return Array.from({ length: height }, (_, row) => Array.from({ length: width }, (_, col) => {
        const globalX = centerX + (col - Math.floor(width / 2)) * WORLD_SAMPLE_SCALE;
        const globalY = centerY + (row - Math.floor(height / 2)) * WORLD_SAMPLE_SCALE;
        const paletteSalt = hashWaveSeed(`${paletteRows[row][col]}:${rows[row][col]}`);
        const patchNoise = valueNoise(globalX, globalY, 4.6, seed + paletteSalt);
        const value = Math.max(0, Math.min(5, Math.floor((patchNoise + 1) * 3)));
        return value.toString(36);
    }).join(''));
}

function getDominantBiome(fields) {
    const counts = new Map();
    const stateCounts = new Map();
    const cultureCounts = new Map();
    for (const field of fields) {
        if (field.land < 0.5) continue;
        counts.set(field.biome, (counts.get(field.biome) || 0) + 1);
        stateCounts.set(field.state, (stateCounts.get(field.state) || 0) + 1);
        cultureCounts.set(field.culture, (cultureCounts.get(field.culture) || 0) + 1);
    }
    const biome = maxCountKey(counts, 4);
    return {
        id: biome,
        name: getBiomeName(biome, ACTIVE_GEOGRAPHY.biomes),
        state: maxCountKey(stateCounts, 0),
        culture: maxCountKey(cultureCounts, 0)
    };
}

function getDominantPalette(paletteRows, rows) {
    const counts = new Map();
    for (let y = 0; y < paletteRows.length; y++) {
        for (let x = 0; x < (paletteRows[y]?.length || 0); x++) {
            if (isWaterSymbol(rows[y]?.[x])) continue;
            const palette = paletteRows[y][x];
            counts.set(palette, (counts.get(palette) || 0) + 1);
        }
    }
    return maxCountKey(counts, 'meadow');
}

function findNearestBurg(index, x, y) {
    let best = null;
    for (const burg of index.burgs) {
        const distance = Math.hypot(burg.x - x, burg.y - y);
        if (!best || distance < best.distance) best = { burg, distance };
    }
    return best;
}

function getRegionName(nearest, dominantBiome, x, y) {
    if (nearest && nearest.distance <= 20) return nearest.burg.name;
    const suffixes = ['Reach', 'Wilds', 'Vale', 'Isles', 'Frontier'];
    return `${dominantBiome.name} ${suffixes[hashWaveSeed(`${x}:${y}:${dominantBiome.name}`) % suffixes.length]}`;
}

function getThemeSkyColor(palette) {
    return ({
        desert: '#78d9f4', savanna: '#84dff1', coast: '#75dcff', jungle: '#75d7d1',
        wetland: '#82d9d3', taiga: '#9ad7e8', tundra: '#b7e8ff', alpine: '#a9dcff', crystal: '#b6c8ff'
    })[palette] || '#86dcff';
}

function getThemeFogColor(palette) {
    return ({
        desert: '#e8f2c5', savanna: '#d4efc1', coast: '#c9f4ff', jungle: '#b9ead6',
        wetland: '#c1ebde', taiga: '#d4eef2', tundra: '#e7f7ff', alpine: '#ddecff', crystal: '#ded8ff'
    })[palette] || '#d3f3df';
}

function mixRegionalAccent(stateColor, cultureColor) {
    return mixColorNumbers(parseHexColor(stateColor), parseHexColor(cultureColor), 0.38);
}

function mixColorNumbers(colorA, colorB, amount = 0.5) {
    const a = Number.isFinite(Number(colorA)) ? Number(colorA) : 0x65d58d;
    const b = Number.isFinite(Number(colorB)) ? Number(colorB) : 0x7d76e8;
    const mixChannel = (shift) => Math.round(
        ((a >> shift) & 0xff) * (1 - amount) + ((b >> shift) & 0xff) * amount
    );
    return (mixChannel(16) << 16) | (mixChannel(8) << 8) | mixChannel(0);
}

function parseHexColor(value) {
    const normalized = String(value || '').replace('#', '');
    const parsed = Number.parseInt(normalized, 16);
    return Number.isFinite(parsed) ? parsed : 0x65d58d;
}

function getDecorationType(palette, value) {
    const families = {
        forest: ['tree', 'tree', 'shrub', 'plant'],
        jungle: ['tree', 'plant', 'shrub', 'garden'],
        taiga: ['tree', 'tree', 'boulder', 'shrub'],
        tundra: ['boulder', 'shrub', 'boulder'],
        alpine: ['boulder', 'boulder', 'shrub'],
        crystal: ['boulder', 'boulder', 'plant'],
        coast: ['plant', 'boulder', 'shrub'],
        desert: ['boulder', 'shrub', 'boulder'],
        savanna: ['tree', 'shrub', 'plant'],
        wetland: ['plant', 'shrub', 'tree'],
        meadow: ['plant', 'tree', 'shrub', 'garden']
    };
    const family = families[palette] || families.meadow;
    return family[Math.min(family.length - 1, Math.floor(value * family.length))];
}

function reserveRect(set, rect, padding = 0) {
    for (let row = rect.row - padding; row < rect.row + rect.height + padding; row++) {
        for (let col = rect.col - padding; col < rect.col + rect.width + padding; col++) set.add(`${col},${row}`);
    }
}

function reserveBuilding(set, building, offsetX, offsetY, padding = 0) {
    reserveRect(set, {
        col: building.x + offsetX,
        row: building.y + offsetY,
        width: building.width,
        height: building.height
    }, padding);
}

function dominantFootprintElevation(lot, cells, elevationRows) {
    const counts = new Map();
    for (const cell of cells) {
        const elevation = Number(elevationRows[lot.row + cell.y]?.[lot.col + cell.x]) || 0;
        counts.set(elevation, (counts.get(elevation) || 0) + 1);
    }
    return maxCountKey(counts, 0);
}

function smoothRoadElevations(mutable, elevationRows, protectedCells = new Set()) {
    const height = mutable.length;
    const width = mutable[0]?.length || 0;
    const roadSymbols = WORLD_ROAD_SYMBOLS;
    for (let pass = 0; pass < 12; pass++) {
        let changes = 0;
        for (let row = 0; row < height; row++) {
            for (let col = 0; col < width; col++) {
                if (!roadSymbols.has(mutable[row]?.[col])) continue;
                for (const [dx, dy] of [[1, 0], [0, 1], [1, 1], [-1, 1]]) {
                    const neighborCol = col + dx;
                    const neighborRow = row + dy;
                    if (!roadSymbols.has(mutable[neighborRow]?.[neighborCol])) continue;
                    const value = Number(elevationRows[row]?.[col]) || 0;
                    const neighborValue = Number(elevationRows[neighborRow]?.[neighborCol]) || 0;
                    if (Math.abs(value - neighborValue) <= 1) continue;
                    const currentProtected = protectedCells.has(elevationCellKey(col, row));
                    const neighborProtected = protectedCells.has(elevationCellKey(neighborCol, neighborRow));
                    if (currentProtected && neighborProtected) continue;
                    if (currentProtected) {
                        elevationRows[neighborRow][neighborCol] = clampInteger(
                            value + Math.sign(neighborValue - value),
                            0,
                            6
                        );
                    } else if (neighborProtected) {
                        elevationRows[row][col] = clampInteger(
                            neighborValue + Math.sign(value - neighborValue),
                            0,
                            6
                        );
                    } else if (value > neighborValue) {
                        elevationRows[row][col] = neighborValue + 1;
                    } else {
                        elevationRows[neighborRow][neighborCol] = value + 1;
                    }
                    changes++;
                }
            }
        }
        if (changes === 0) break;
    }
}

function relaxSymbolElevationRamps(mutable, elevationRows, protectedCells = new Set()) {
    const height = mutable.length;
    const width = mutable[0]?.length || 0;
    const sourceDistanceRows = createProtectedElevationDistanceRows(mutable, protectedCells);
    const protectedNeighborRanges = createProtectedNeighborElevationRanges(
        mutable,
        elevationRows,
        protectedCells
    );
    const setRampElevation = (col, row, value) => {
        const range = protectedNeighborRanges[row]?.[col] || { minimum: 0, maximum: 6 };
        const minimum = range.minimum <= range.maximum
            ? range.minimum
            : Math.round((range.minimum + range.maximum) / 2);
        const maximum = range.minimum <= range.maximum ? range.maximum : minimum;
        elevationRows[row][col] = clampInteger(value, minimum, maximum);
    };
    for (let pass = 0; pass < 12; pass++) {
        let changes = 0;
        const reverse = pass % 2 === 1;
        const rowStart = reverse ? height - 1 : 0;
        const rowEnd = reverse ? -1 : height;
        const rowStep = reverse ? -1 : 1;
        const colStart = reverse ? width - 1 : 0;
        const colEnd = reverse ? -1 : width;
        const colStep = reverse ? -1 : 1;
        for (let row = rowStart; row !== rowEnd; row += rowStep) {
            for (let col = colStart; col !== colEnd; col += colStep) {
                if (isWaterSymbol(mutable[row]?.[col])) continue;
                for (const [dx, dy] of [[1, 0], [0, 1]]) {
                    const neighborCol = col + dx;
                    const neighborRow = row + dy;
                    const neighborSymbol = mutable[neighborRow]?.[neighborCol];
                    if (!neighborSymbol || isWaterSymbol(neighborSymbol)) continue;
                    const value = Number(elevationRows[row]?.[col]) || 0;
                    const neighborValue = Number(elevationRows[neighborRow]?.[neighborCol]) || 0;
                    if (Math.abs(value - neighborValue) <= 1) continue;
                    const currentProtected = protectedCells.has(elevationCellKey(col, row));
                    const neighborProtected = protectedCells.has(elevationCellKey(neighborCol, neighborRow));
                    if (currentProtected && neighborProtected) continue;
                    if (currentProtected) {
                        setRampElevation(
                            neighborCol,
                            neighborRow,
                            value + Math.sign(neighborValue - value)
                        );
                    } else if (neighborProtected) {
                        setRampElevation(col, row, neighborValue + Math.sign(value - neighborValue));
                    } else if (sourceDistanceRows[row][col] < sourceDistanceRows[neighborRow][neighborCol]) {
                        setRampElevation(
                            neighborCol,
                            neighborRow,
                            value + Math.sign(neighborValue - value)
                        );
                    } else if (sourceDistanceRows[neighborRow][neighborCol] < sourceDistanceRows[row][col]) {
                        setRampElevation(col, row, neighborValue + Math.sign(value - neighborValue));
                    } else if (value > neighborValue) {
                        setRampElevation(col, row, neighborValue + 1);
                    } else {
                        setRampElevation(neighborCol, neighborRow, value + 1);
                    }
                    changes++;
                }
            }
        }
        if (changes === 0) break;
    }
}

function createProtectedNeighborElevationRanges(mutable, elevationRows, protectedCells) {
    const height = mutable.length;
    const width = mutable[0]?.length || 0;
    const ranges = Array.from({ length: height }, () => Array.from({ length: width }, () => ({
        minimum: 0,
        maximum: 6
    })));
    for (let row = 0; row < height; row++) {
        for (let col = 0; col < width; col++) {
            if (!protectedCells.has(elevationCellKey(col, row))) continue;
            const sourceTier = clampInteger(elevationRows[row]?.[col], 0, 6);
            for (const { x, y } of CARDINALS) {
                const neighborCol = col + x;
                const neighborRow = row + y;
                if (!mutable[neighborRow]?.[neighborCol] || isWaterSymbol(mutable[neighborRow][neighborCol])) continue;
                if (protectedCells.has(elevationCellKey(neighborCol, neighborRow))) continue;
                const range = ranges[neighborRow][neighborCol];
                range.minimum = Math.max(range.minimum, sourceTier - 1);
                range.maximum = Math.min(range.maximum, sourceTier + 1);
            }
        }
    }
    return ranges;
}

function createProtectedElevationDistanceRows(mutable, protectedCells) {
    const height = mutable.length;
    const width = mutable[0]?.length || 0;
    const distances = Array.from({ length: height }, () => Array(width).fill(Infinity));
    const queue = [];
    for (let row = 0; row < height; row++) {
        for (let col = 0; col < width; col++) {
            if (!protectedCells.has(elevationCellKey(col, row)) || isWaterSymbol(mutable[row]?.[col])) continue;
            distances[row][col] = 0;
            queue.push({ col, row });
        }
    }
    for (let index = 0; index < queue.length; index++) {
        const current = queue[index];
        const nextDistance = distances[current.row][current.col] + 1;
        for (const { x, y } of CARDINALS) {
            const col = current.col + x;
            const row = current.row + y;
            if (!mutable[row]?.[col] || isWaterSymbol(mutable[row][col])) continue;
            if (distances[row][col] <= nextDistance) continue;
            distances[row][col] = nextDistance;
            queue.push({ col, row });
        }
    }
    return distances;
}

function collectProtectedElevationKeys(constraintField) {
    const protectedCells = new Set();
    for (const cell of constraintField?.cells || []) {
        if (!Number.isFinite(cell?.fixedElevation) || cell.fixedElevationSource !== 'town-vector') continue;
        protectedCells.add(elevationCellKey(cell.col, cell.row));
    }
    return protectedCells;
}

function elevationCellKey(col, row) {
    return `${col},${row}`;
}

function nearestSymbolDistance(rows, centerCol, centerRow, symbols, radius) {
    let best = radius + 1;
    for (let row = centerRow - radius; row <= centerRow + radius; row++) {
        for (let col = centerCol - radius; col <= centerCol + radius; col++) {
            if (!symbols.has(rows[row]?.[col])) continue;
            best = Math.min(best, Math.abs(col - centerCol) + Math.abs(row - centerRow));
        }
    }
    return best;
}

function nearestReachableSymbolDistance({
    rows,
    startCol,
    startRow,
    symbols,
    maximumDistance,
    occupied = null,
    blockedRect = null
}) {
    if (!rows[startRow]?.[startCol]) return maximumDistance + 1;
    const startKey = elevationCellKey(startCol, startRow);
    const queue = [{ col: startCol, row: startRow, distance: 0 }];
    const visited = new Set([startKey]);
    const isInsideBlockedRect = (col, row) => blockedRect &&
        col >= blockedRect.col && row >= blockedRect.row &&
        col < blockedRect.col + blockedRect.width && row < blockedRect.row + blockedRect.height;
    for (let index = 0; index < queue.length; index++) {
        const current = queue[index];
        if (symbols.has(rows[current.row]?.[current.col])) return current.distance;
        if (current.distance >= maximumDistance) continue;
        for (const { x, y } of CARDINALS) {
            const col = current.col + x;
            const row = current.row + y;
            const key = elevationCellKey(col, row);
            const symbol = rows[row]?.[col];
            if (!symbol || visited.has(key) || occupied?.has?.(key) ||
                isInsideBlockedRect(col, row) || symbol === 'T' || isWaterSymbol(symbol) ||
                !isLandSymbol(symbol)) continue;
            visited.add(key);
            queue.push({ col, row, distance: current.distance + 1 });
        }
    }
    return maximumDistance + 1;
}

function weightedVote(weighted, key) {
    const totals = new Map();
    for (const entry of weighted) {
        const value = Number(entry.cell[key]) || 0;
        totals.set(value, (totals.get(value) || 0) + entry.weight);
    }
    return maxCountKey(totals, 0);
}

function maxCountKey(counts, fallback) {
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])))[0]?.[0] ?? fallback;
}

function fractalNoise(x, y, seed) {
    return valueNoise(x, y, 34, seed) * 0.58 + valueNoise(x, y, 15, seed + 1013) * 0.29 + valueNoise(x, y, 7, seed + 7919) * 0.13;
}

function valueNoise(x, y, scale, seed) {
    const gx = x / scale;
    const gy = y / scale;
    const x0 = Math.floor(gx);
    const y0 = Math.floor(gy);
    const tx = smoothStep(gx - x0);
    const ty = smoothStep(gy - y0);
    const v00 = signedHash(seed, x0, y0);
    const v10 = signedHash(seed, x0 + 1, y0);
    const v01 = signedHash(seed, x0, y0 + 1);
    const v11 = signedHash(seed, x0 + 1, y0 + 1);
    return lerp(lerp(v00, v10, tx), lerp(v01, v11, tx), ty);
}

function signedHash(seed, x, y) {
    return keyedUnit(`${seed}:${x}:${y}`) * 2 - 1;
}

function keyedUnit(value) {
    return (hashWaveSeed(value) + 0.5) / 4294967296;
}

function bucketKey(x, y, bucketSize) {
    return `${Math.floor(Number(x) / bucketSize)},${Math.floor(Number(y) / bucketSize)}`;
}

function smoothStep(value) {
    return value * value * (3 - 2 * value);
}

function lerp(a, b, amount) {
    return a + (b - a) * amount;
}

function isLandSymbol(symbol) {
    return ['G', 'F', 'H', 'M', 'S', 'P', 'R', '.', ':', ';', ',', '=', '1', '2', '3', '4']
        .includes(symbol);
}

function isBuildableSymbol(symbol) {
    return ['G', 'F', 'H', 'S', 'P', '.', ','].includes(symbol);
}

function isDecorationGround(symbol) {
    return ['G', 'F', 'H', 'S', 'P', ',', '.'].includes(symbol);
}

function isWaterSymbol(symbol) {
    return ['W', '~', 'B', 'I'].includes(symbol);
}

function snapWorldSampleCoordinate(value) {
    return round(Math.round(Number(value) / WORLD_SAMPLE_SCALE) * WORLD_SAMPLE_SCALE, 6);
}

function clamp01(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return 0;
    return Math.max(0, Math.min(1, number));
}

function clampInteger(value, minimum, maximum) {
    const number = Number(value);
    if (!Number.isFinite(number)) return minimum;
    return Math.max(minimum, Math.min(maximum, Math.floor(number)));
}

function clampNumber(value, minimum, maximum, fallback = minimum) {
    const number = Number(value);
    if (!Number.isFinite(number)) return fallback;
    return Math.max(minimum, Math.min(maximum, number));
}

function round(value, precision = 2) {
    const factor = 10 ** precision;
    return Math.round(Number(value) * factor) / factor;
}
