import { ELEMENTS, getTileDefinition } from './TileRegistry.js';
import { normalizeBurgThemeId } from './BurgThemeCatalog.js';
import {
    BUILDING_FLOOR_HEIGHT,
    BUILDING_LEVEL_KINDS,
    BUILDING_PART_TAGS,
    BUILDING_PLACEMENT_TAGS,
    createVoxelCollisionBox,
    getBuildingLevelReferenceForZ,
    getBuildingLevelTag
} from './StructuralMatrixRules.js';

export const TILE_EFFECTS = {
    NONE: 0,
    EARTH: ELEMENTS.GEO,
    WATER: ELEMENTS.HYDRO,
    WIND: ELEMENTS.ANEMO,
    ICE: ELEMENTS.CRYO,
    FIRE: ELEMENTS.PYRO,
    STRUCTURE: ELEMENTS.STRUCTURE
};

export const TEXTURE_IDS = {
    DEFAULT: 0,
    FOREST: 1,
    ROAD: 2,
    HILL: 3,
    MOUNTAIN: 4,
    VILLAGE_GROUND: 5,
    CITY_COBBLE: 6,
    CITY_PLAZA: 7,
    GARDEN_GROUND: 8,
    ICE: 1,
    SHALLOW_WATER: 1,
    DEEP_WATER: 2,
    COASTAL_WATER: 3,
    MARSH_WATER: 4,
    TOWN_WALL: 1,
    BUILDING_FLOOR: 2,
    STONE_BUILDING_WALL: 3,
    TIMBER_BUILDING_WALL: 4,
    DOOR: 5,
    OAK_DOOR: 5,
    STAIRS: 6,
    IRON_DOOR: 7,
    PAINTED_DOOR: 8,
    STONE_STAIRS: 9,
    TIMBER_STAIRS: 10,
    WOOD_FLOOR: 11,
    STONE_FLOOR: 12,
    CITY_WALL_WALKWAY: 13,
    CITY_WALL_STAIRS: 14
};

export const DOOR_STYLE_TEXTURES = {
    oak: TEXTURE_IDS.OAK_DOOR,
    iron: TEXTURE_IDS.IRON_DOOR,
    painted: TEXTURE_IDS.PAINTED_DOOR
};

export const BUILDING_PARTS = {
    NONE: 0,
    WALL: 1,
    DOOR: 2,
    FLOOR: 3,
    STAIRS: 4,
    ROOF: 5,
    WINDOW_LOWER_NORTH: 6,
    WINDOW_LOWER_SOUTH: 7,
    WINDOW_LOWER_WEST: 8,
    WINDOW_LOWER_EAST: 9,
    STAIRS_NORTH: 10,
    STAIRS_SOUTH: 11,
    STAIRS_WEST: 12,
    STAIRS_EAST: 13,
    WINDOW_UPPER_NORTH: 14,
    WINDOW_UPPER_SOUTH: 15,
    WINDOW_UPPER_WEST: 16,
    WINDOW_UPPER_EAST: 17,
    CITY_WALL_WALKWAY: 18,
    CITY_WALL_STAIRS_NORTH: 19,
    CITY_WALL_STAIRS_SOUTH: 20,
    CITY_WALL_STAIRS_WEST: 21,
    CITY_WALL_STAIRS_EAST: 22,
    GROUND_FLOOR: 23
};

export const TILE_SYMBOL_LIBRARY = {
    W: { element: ELEMENTS.HYDRO, texture: TEXTURE_IDS.DEEP_WATER, effect: TILE_EFFECTS.WATER, building: BUILDING_PARTS.NONE, height: 0 },
    '~': { element: ELEMENTS.HYDRO, texture: TEXTURE_IDS.SHALLOW_WATER, effect: TILE_EFFECTS.WATER, building: BUILDING_PARTS.NONE, height: 0 },
    B: { element: ELEMENTS.HYDRO, texture: TEXTURE_IDS.MARSH_WATER, effect: TILE_EFFECTS.WATER, building: BUILDING_PARTS.NONE, height: 0 },
    S: { element: ELEMENTS.ANEMO, texture: TEXTURE_IDS.DEFAULT, effect: TILE_EFFECTS.WIND, building: BUILDING_PARTS.NONE, height: 0 },
    G: { element: ELEMENTS.GEO, texture: TEXTURE_IDS.DEFAULT, effect: TILE_EFFECTS.EARTH, building: BUILDING_PARTS.NONE, height: 0 },
    F: { element: ELEMENTS.GEO, texture: TEXTURE_IDS.FOREST, effect: TILE_EFFECTS.EARTH, building: BUILDING_PARTS.NONE, height: 0 },
    H: { element: ELEMENTS.GEO, texture: TEXTURE_IDS.HILL, effect: TILE_EFFECTS.EARTH, building: BUILDING_PARTS.NONE, height: 1 },
    M: { element: ELEMENTS.GEO, texture: TEXTURE_IDS.MOUNTAIN, effect: TILE_EFFECTS.EARTH, building: BUILDING_PARTS.NONE, height: 2 },
    '.': { element: ELEMENTS.GEO, texture: TEXTURE_IDS.VILLAGE_GROUND, effect: TILE_EFFECTS.EARTH, building: BUILDING_PARTS.NONE, height: 0 },
    ':': { element: ELEMENTS.GEO, texture: TEXTURE_IDS.CITY_COBBLE, effect: TILE_EFFECTS.EARTH, building: BUILDING_PARTS.NONE, height: 0 },
    ';': { element: ELEMENTS.GEO, texture: TEXTURE_IDS.CITY_PLAZA, effect: TILE_EFFECTS.EARTH, building: BUILDING_PARTS.NONE, height: 0 },
    ',': { element: ELEMENTS.GEO, texture: TEXTURE_IDS.GARDEN_GROUND, effect: TILE_EFFECTS.EARTH, building: BUILDING_PARTS.NONE, height: 0 },
    P: { element: ELEMENTS.CRYO, texture: TEXTURE_IDS.DEFAULT, effect: TILE_EFFECTS.ICE, building: BUILDING_PARTS.NONE, height: 2 },
    I: { element: ELEMENTS.CRYO, texture: TEXTURE_IDS.ICE, effect: TILE_EFFECTS.ICE, building: BUILDING_PARTS.NONE, height: 0 },
    L: { element: ELEMENTS.PYRO, texture: TEXTURE_IDS.DEFAULT, effect: TILE_EFFECTS.FIRE, building: BUILDING_PARTS.NONE, height: 2 },
    R: { element: ELEMENTS.GEO, texture: TEXTURE_IDS.ROAD, effect: TILE_EFFECTS.EARTH, building: BUILDING_PARTS.NONE, height: 0 },
    '=': { element: ELEMENTS.GEO, texture: TEXTURE_IDS.CITY_COBBLE, effect: TILE_EFFECTS.EARTH, building: BUILDING_PARTS.NONE, height: 0 },
    T: { element: ELEMENTS.STRUCTURE, texture: TEXTURE_IDS.TOWN_WALL, effect: TILE_EFFECTS.STRUCTURE, building: BUILDING_PARTS.WALL, height: 2 },
    X: { element: ELEMENTS.STRUCTURE, texture: TEXTURE_IDS.DEFAULT, effect: TILE_EFFECTS.STRUCTURE, building: BUILDING_PARTS.WALL, height: 1 },
    A: { element: ELEMENTS.STRUCTURE, texture: TEXTURE_IDS.STONE_BUILDING_WALL, effect: TILE_EFFECTS.STRUCTURE, building: BUILDING_PARTS.WALL, height: 2 },
    C: { element: ELEMENTS.STRUCTURE, texture: TEXTURE_IDS.TIMBER_BUILDING_WALL, effect: TILE_EFFECTS.STRUCTURE, building: BUILDING_PARTS.WALL, height: 2 },
    N: { element: ELEMENTS.STRUCTURE, texture: TEXTURE_IDS.STONE_BUILDING_WALL, effect: TILE_EFFECTS.STRUCTURE, building: BUILDING_PARTS.WINDOW_LOWER_NORTH, height: 2 },
    O: { element: ELEMENTS.STRUCTURE, texture: TEXTURE_IDS.STONE_BUILDING_WALL, effect: TILE_EFFECTS.STRUCTURE, building: BUILDING_PARTS.WINDOW_LOWER_SOUTH, height: 2 },
    J: { element: ELEMENTS.STRUCTURE, texture: TEXTURE_IDS.STONE_BUILDING_WALL, effect: TILE_EFFECTS.STRUCTURE, building: BUILDING_PARTS.WINDOW_LOWER_WEST, height: 2 },
    K: { element: ELEMENTS.STRUCTURE, texture: TEXTURE_IDS.STONE_BUILDING_WALL, effect: TILE_EFFECTS.STRUCTURE, building: BUILDING_PARTS.WINDOW_LOWER_EAST, height: 2 },
    Q: { element: ELEMENTS.STRUCTURE, texture: TEXTURE_IDS.TIMBER_BUILDING_WALL, effect: TILE_EFFECTS.STRUCTURE, building: BUILDING_PARTS.WINDOW_LOWER_NORTH, height: 2 },
    V: { element: ELEMENTS.STRUCTURE, texture: TEXTURE_IDS.TIMBER_BUILDING_WALL, effect: TILE_EFFECTS.STRUCTURE, building: BUILDING_PARTS.WINDOW_LOWER_SOUTH, height: 2 },
    Y: { element: ELEMENTS.STRUCTURE, texture: TEXTURE_IDS.TIMBER_BUILDING_WALL, effect: TILE_EFFECTS.STRUCTURE, building: BUILDING_PARTS.WINDOW_LOWER_WEST, height: 2 },
    Z: { element: ELEMENTS.STRUCTURE, texture: TEXTURE_IDS.TIMBER_BUILDING_WALL, effect: TILE_EFFECTS.STRUCTURE, building: BUILDING_PARTS.WINDOW_LOWER_EAST, height: 2 },
    D: { element: ELEMENTS.STRUCTURE, texture: TEXTURE_IDS.BUILDING_FLOOR, effect: TILE_EFFECTS.STRUCTURE, building: BUILDING_PARTS.DOOR, height: 0 },
    E: { element: ELEMENTS.STRUCTURE, texture: TEXTURE_IDS.BUILDING_FLOOR, effect: TILE_EFFECTS.STRUCTURE, building: BUILDING_PARTS.FLOOR, height: 0 },
    U: { element: ELEMENTS.STRUCTURE, texture: TEXTURE_IDS.STAIRS, effect: TILE_EFFECTS.STRUCTURE, building: BUILDING_PARTS.STAIRS, height: 0 },
    1: { element: ELEMENTS.STRUCTURE, texture: TEXTURE_IDS.STONE_STAIRS, effect: TILE_EFFECTS.STRUCTURE, building: BUILDING_PARTS.STAIRS_NORTH, height: 0 },
    2: { element: ELEMENTS.STRUCTURE, texture: TEXTURE_IDS.STONE_STAIRS, effect: TILE_EFFECTS.STRUCTURE, building: BUILDING_PARTS.STAIRS_SOUTH, height: 0 },
    3: { element: ELEMENTS.STRUCTURE, texture: TEXTURE_IDS.STONE_STAIRS, effect: TILE_EFFECTS.STRUCTURE, building: BUILDING_PARTS.STAIRS_WEST, height: 0 },
    4: { element: ELEMENTS.STRUCTURE, texture: TEXTURE_IDS.STONE_STAIRS, effect: TILE_EFFECTS.STRUCTURE, building: BUILDING_PARTS.STAIRS_EAST, height: 0 },
    5: { element: ELEMENTS.STRUCTURE, texture: TEXTURE_IDS.TIMBER_STAIRS, effect: TILE_EFFECTS.STRUCTURE, building: BUILDING_PARTS.STAIRS_NORTH, height: 0 },
    6: { element: ELEMENTS.STRUCTURE, texture: TEXTURE_IDS.TIMBER_STAIRS, effect: TILE_EFFECTS.STRUCTURE, building: BUILDING_PARTS.STAIRS_SOUTH, height: 0 },
    7: { element: ELEMENTS.STRUCTURE, texture: TEXTURE_IDS.TIMBER_STAIRS, effect: TILE_EFFECTS.STRUCTURE, building: BUILDING_PARTS.STAIRS_WEST, height: 0 },
    8: { element: ELEMENTS.STRUCTURE, texture: TEXTURE_IDS.TIMBER_STAIRS, effect: TILE_EFFECTS.STRUCTURE, building: BUILDING_PARTS.STAIRS_EAST, height: 0 },
    9: { element: ELEMENTS.STRUCTURE, texture: TEXTURE_IDS.CITY_WALL_WALKWAY, effect: TILE_EFFECTS.STRUCTURE, building: BUILDING_PARTS.CITY_WALL_WALKWAY, height: 2 },
    '!': { element: ELEMENTS.STRUCTURE, texture: TEXTURE_IDS.CITY_WALL_STAIRS, effect: TILE_EFFECTS.STRUCTURE, building: BUILDING_PARTS.CITY_WALL_STAIRS_NORTH, height: 2 },
    '@': { element: ELEMENTS.STRUCTURE, texture: TEXTURE_IDS.CITY_WALL_STAIRS, effect: TILE_EFFECTS.STRUCTURE, building: BUILDING_PARTS.CITY_WALL_STAIRS_SOUTH, height: 2 },
    '#': { element: ELEMENTS.STRUCTURE, texture: TEXTURE_IDS.CITY_WALL_STAIRS, effect: TILE_EFFECTS.STRUCTURE, building: BUILDING_PARTS.CITY_WALL_STAIRS_WEST, height: 2 },
    '$': { element: ELEMENTS.STRUCTURE, texture: TEXTURE_IDS.CITY_WALL_STAIRS, effect: TILE_EFFECTS.STRUCTURE, building: BUILDING_PARTS.CITY_WALL_STAIRS_EAST, height: 2 }
};

export const TILE_SYMBOLS = Object.keys(TILE_SYMBOL_LIBRARY);

export function createTileCell({
    element = ELEMENTS.VOID,
    texture = 0,
    effect = TILE_EFFECTS.NONE,
    building = BUILDING_PARTS.NONE,
    height = 0,
    visualVariant = 0,
    paletteId = 'meadow',
    architectureThemeId = null
} = {}) {
    return {
        element: clampInteger(element, ELEMENTS.VOID),
        texture: clampInteger(texture, 0),
        effect: clampInteger(effect, TILE_EFFECTS.NONE),
        building: clampInteger(building, BUILDING_PARTS.NONE),
        height: clampInteger(height, 0),
        visualVariant: Math.max(0, Math.min(35, clampInteger(visualVariant, 0))),
        paletteId: normalizePaletteId(paletteId),
        architectureThemeId: normalizeBurgThemeId(architectureThemeId, null)
    };
}

export function createVoxelBlock({
    element = ELEMENTS.VOID,
    texture = 0,
    effect = TILE_EFFECTS.NONE,
    building = BUILDING_PARTS.NONE,
    z = 0,
    buildingGroundFloorZ,
    buildingFloorHeight,
    buildingLevelIndex,
    buildingLevelTag,
    buildingLevelKind,
    buildingPartTag,
    buildingAnchorZ,
    buildingPlacementZ,
    buildingPlacementTag,
    visualVariant = 0,
    paletteId = 'meadow',
    architectureThemeId = null
} = {}) {
    const textureValue = clampInteger(texture, 0);
    const blockElement = clampInteger(element, ELEMENTS.VOID);
    // Voxel construction is the final shared choke point for runtime maps and compiled chunks.
    // Never allow stale wall/window/door metadata to turn an environmental block into structure.
    const buildingPart = blockElement === ELEMENTS.STRUCTURE
        ? clampInteger(building, BUILDING_PARTS.NONE)
        : BUILDING_PARTS.NONE;
    const normalizedPaletteId = normalizePaletteId(paletteId);
    const normalizedArchitectureThemeId = normalizeBurgThemeId(architectureThemeId, null);
    const definition = getTileDefinition(
        blockElement,
        textureValue,
        normalizedPaletteId,
        normalizedArchitectureThemeId
    );
    const walkable = isBlockWalkable(blockElement, textureValue, buildingPart);
    const buildingReference = blockElement === ELEMENTS.STRUCTURE
        ? normalizeVoxelBuildingReference({
            buildingGroundFloorZ,
            buildingFloorHeight,
            buildingLevelIndex,
            buildingLevelTag,
            buildingLevelKind,
            buildingPartTag,
            buildingAnchorZ,
            buildingPlacementZ,
            buildingPlacementTag
        })
        : {};
    const block = {
        z: clampInteger(z, 0),
        element: blockElement,
        texture: textureValue,
        textureValue,
        effect: clampInteger(effect, TILE_EFFECTS.NONE),
        building: buildingPart,
        visualVariant: Math.max(0, Math.min(35, clampInteger(visualVariant, 0))),
        paletteId: normalizedPaletteId,
        architectureThemeId: normalizedArchitectureThemeId,
        walkable,
        definition: {
            ...definition,
            walkable
        },
        ...buildingReference
    };
    return {
        ...block,
        collision: createVoxelCollisionBox(block)
    };
}

export function createTileCellFromSymbol(symbol) {
    return createTileCell(TILE_SYMBOL_LIBRARY[String(symbol).toUpperCase()] || TILE_SYMBOL_LIBRARY.W);
}

export function normalizeTileCell(rawCell) {
    if (typeof rawCell === 'string') return createTileCellFromSymbol(rawCell);
    if (Array.isArray(rawCell)) {
        return createTileCell({
            element: rawCell[0],
            texture: rawCell[1],
            effect: rawCell[2],
            building: rawCell[3],
            height: rawCell[4],
            visualVariant: rawCell[5],
            paletteId: rawCell[6],
            architectureThemeId: rawCell[7]
        });
    }
    if (rawCell && typeof rawCell === 'object') {
        const element = rawCell.element ?? rawCell.e;
        const texture = rawCell.texture ?? rawCell.textureValue ?? rawCell.t;
        const effect = rawCell.effect ?? rawCell.fx;
        const building = rawCell.building ?? rawCell.b;
        const height = rawCell.height ?? rawCell.maxZ ?? rawCell.h;
        const visualVariant = rawCell.visualVariant ?? rawCell.variantCode ?? rawCell.v;
        const paletteId = rawCell.paletteId ?? rawCell.palette ?? rawCell.p;
        const architectureThemeId = rawCell.architectureThemeId;
        const cell = createTileCell({
            element,
            texture,
            effect,
            building,
            height,
            visualVariant,
            paletteId,
            architectureThemeId
        });
        if (Array.isArray(rawCell.structuralFloorLevels)) {
            cell.structuralFloorLevels = normalizeStructuralLevels(rawCell.structuralFloorLevels);
        }
        if (Array.isArray(rawCell.doorClearanceLevels)) {
            cell.doorClearanceLevels = [...new Set(rawCell.doorClearanceLevels
                .map((level) => clampInteger(level, 0)))]
                .sort((a, b) => a - b);
        }
        if (Number.isFinite(rawCell.buildingBaseElevation)) cell.buildingBaseElevation = clampInteger(rawCell.buildingBaseElevation, 0);
        if (Number.isFinite(rawCell.buildingGroundElevation)) cell.buildingGroundElevation = clampInteger(rawCell.buildingGroundElevation, 0);
        if (Number.isFinite(rawCell.buildingGroundFloorZ)) cell.buildingGroundFloorZ = clampInteger(rawCell.buildingGroundFloorZ, 0);
        if (Number.isFinite(rawCell.buildingFloorHeight)) cell.buildingFloorHeight = Math.max(1, clampInteger(rawCell.buildingFloorHeight, BUILDING_FLOOR_HEIGHT));
        if (Array.isArray(rawCell.buildingFloorLevels)) {
            cell.buildingFloorLevels = normalizeFloorLevels(rawCell.buildingFloorLevels);
        }
        if (Array.isArray(rawCell.buildingFloorRefs)) cell.buildingFloorRefs = normalizeBuildingFloorRefs(rawCell.buildingFloorRefs);
        if (typeof rawCell.buildingMatrixTag === 'string') cell.buildingMatrixTag = rawCell.buildingMatrixTag;
        if (Number.isFinite(rawCell.buildingLevelIndex)) cell.buildingLevelIndex = Math.floor(rawCell.buildingLevelIndex);
        if (typeof rawCell.buildingLevelTag === 'string') cell.buildingLevelTag = rawCell.buildingLevelTag;
        if (typeof rawCell.buildingLevelKind === 'string') cell.buildingLevelKind = rawCell.buildingLevelKind;
        if (typeof rawCell.buildingPartTag === 'string') cell.buildingPartTag = rawCell.buildingPartTag;
        if (Number.isFinite(rawCell.buildingAnchorZ)) cell.buildingAnchorZ = clampInteger(rawCell.buildingAnchorZ, 0);
        if (Number.isFinite(rawCell.buildingPlacementZ)) cell.buildingPlacementZ = clampInteger(rawCell.buildingPlacementZ, 0);
        if (typeof rawCell.buildingPlacementTag === 'string') cell.buildingPlacementTag = rawCell.buildingPlacementTag;
        if (typeof rawCell.stairRole === 'string') cell.stairRole = rawCell.stairRole;
        if (Number.isFinite(rawCell.stairLevel)) cell.stairLevel = clampInteger(rawCell.stairLevel, 0);
        if (Number.isFinite(rawCell.stairBaseElevation)) cell.stairBaseElevation = clampInteger(rawCell.stairBaseElevation, 0);
        if (Number.isFinite(rawCell.stairDestinationElevation)) cell.stairDestinationElevation = clampInteger(rawCell.stairDestinationElevation, 0);
        if (Number.isFinite(rawCell.doorWallTexture)) cell.doorWallTexture = clampInteger(rawCell.doorWallTexture, texture);
        if (Number.isFinite(rawCell.doorBaseElevation)) cell.doorBaseElevation = clampInteger(rawCell.doorBaseElevation, 0);
        return cell;
    }
    return createTileCellFromSymbol('W');
}

export function tileCellToBlockInfo(rawCell) {
    const cell = normalizeTileCell(rawCell);
    const definition = getTileDefinition(
        cell.element,
        cell.texture,
        cell.paletteId,
        cell.architectureThemeId
    );
    const walkable = isBlockWalkable(cell.element, cell.texture, cell.building);
    return {
        element: cell.element,
        textureValue: cell.texture,
        effect: cell.effect,
        building: cell.building,
        visualVariant: cell.visualVariant,
        paletteId: cell.paletteId,
        architectureThemeId: cell.architectureThemeId,
        maxZ: cell.height,
        walkable,
        definition: { ...definition, walkable }
    };
}

export function tileCellToVoxelColumn(rawCell) {
    const cell = normalizeTileCell(rawCell);
    const maxZ = Math.max(0, cell.height);
    const column = [];
    const pushBlock = (block) => mergeVoxelBlock(column, createVoxelBlock({
        visualVariant: cell.visualVariant,
        paletteId: cell.paletteId,
        ...block,
        architectureThemeId: cell.architectureThemeId,
        ...createVoxelBuildingReference(cell, block)
    }));

    if (cell.element === ELEMENTS.STRUCTURE && cell.building === BUILDING_PARTS.DOOR) {
        const doorBaseElevation = clampInteger(cell.doorBaseElevation, 0);
        const clearanceLevels = normalizeDoorClearanceLevels(cell.doorClearanceLevels, doorBaseElevation);
        for (let z = 0; z <= maxZ; z++) {
            if (z < doorBaseElevation) {
                pushBlock({
                    z,
                    element: ELEMENTS.GEO,
                    texture: TEXTURE_IDS.DEFAULT,
                    effect: TILE_EFFECTS.EARTH,
                    building: BUILDING_PARTS.NONE
                });
                continue;
            }
            if (clearanceLevels.has(z)) {
                pushBlock({
                    z,
                    element: ELEMENTS.STRUCTURE,
                    texture: TEXTURE_IDS.BUILDING_FLOOR,
                    effect: TILE_EFFECTS.STRUCTURE,
                    building: z === doorBaseElevation ? BUILDING_PARTS.GROUND_FLOOR : BUILDING_PARTS.FLOOR
                });
                continue;
            }
            if (isDoorAirClearance(z, clearanceLevels)) continue;
            pushBlock({
                z,
                element: ELEMENTS.STRUCTURE,
                texture: cell.doorWallTexture ?? TEXTURE_IDS.STONE_BUILDING_WALL,
                effect: TILE_EFFECTS.STRUCTURE,
                building: BUILDING_PARTS.WALL
            });
        }
        return column.sort((a, b) => a.z - b.z);
    }

    if (isStackedBuildingWall(cell)) {
        const baseElevation = getBuildingGroundElevation(cell);
        for (let z = 0; z <= maxZ; z++) {
            if (z < baseElevation) {
                pushBlock({
                    z,
                    element: ELEMENTS.GEO,
                    texture: TEXTURE_IDS.DEFAULT,
                    effect: TILE_EFFECTS.EARTH,
                    building: BUILDING_PARTS.NONE
                });
                continue;
            }
            if (z === baseElevation) {
                pushBlock({
                    z,
                    element: ELEMENTS.STRUCTURE,
                    texture: cell.texture,
                    effect: TILE_EFFECTS.STRUCTURE,
                    building: BUILDING_PARTS.GROUND_FLOOR
                });
                continue;
            }
            pushBlock({
                z,
                element: cell.element,
                texture: cell.texture,
                effect: cell.effect,
                building: getBuildingPartAtElevation(cell.building, z, baseElevation)
            });
        }
        return column.sort((a, b) => a.z - b.z);
    }

    if (isStairPart(cell.building) && maxZ > 0) {
        const groundElevation = getBuildingGroundElevation(cell);
        const stairBaseElevation = getStairBaseElevation(cell, groundElevation);
        const isCityWallStair = isCityWallStairPart(cell.building);
        const floorLevels = Number(cell.stairLevel || 0) > 0
            ? new Set(getBuildingFloorLevels(cell, groundElevation, maxZ)
                .filter((level) => level < maxZ && (isCityWallStair || level !== stairBaseElevation)))
            : new Set();
        for (let z = 0; z < Math.min(groundElevation, maxZ); z++) {
            pushBlock({
                z,
                element: ELEMENTS.GEO,
                texture: TEXTURE_IDS.DEFAULT,
                effect: TILE_EFFECTS.EARTH,
                building: BUILDING_PARTS.NONE
            });
        }
        for (let z = groundElevation; z < maxZ; z++) {
            if (floorLevels.has(z)) {
                pushBlock({
                    z,
                    element: ELEMENTS.STRUCTURE,
                    texture: cell.texture,
                    effect: TILE_EFFECTS.STRUCTURE,
                    building: z === groundElevation ? BUILDING_PARTS.GROUND_FLOOR : BUILDING_PARTS.FLOOR
                });
                continue;
            }
                pushBlock({
                    z,
                    element: ELEMENTS.STRUCTURE,
                    texture: isCityWallStair ? TEXTURE_IDS.TOWN_WALL : TEXTURE_IDS.DEFAULT,
                    effect: TILE_EFFECTS.STRUCTURE,
                    building: BUILDING_PARTS.WALL,
                    partTag: isCityWallStair ? undefined : BUILDING_PART_TAGS.STAIR_SUPPORT,
                anchorZ: stairBaseElevation,
                placementZ: stairBaseElevation,
                placementTag: BUILDING_PLACEMENT_TAGS.NONE,
                levelZ: stairBaseElevation
            });
        }
        pushBlock({
            z: maxZ,
            element: cell.element,
            texture: cell.texture,
            effect: cell.effect,
            building: cell.building
        });
        addStructuralFloorLevels(column, cell);
        return column.sort((a, b) => a.z - b.z);
    }

    if (isBuildingFloorPart(cell.building)) {
        const baseElevation = getBuildingGroundElevation(cell);
        for (let z = 0; z < baseElevation; z++) {
            pushBlock({
                z,
                element: ELEMENTS.GEO,
                texture: TEXTURE_IDS.DEFAULT,
                effect: TILE_EFFECTS.EARTH,
                building: BUILDING_PARTS.NONE
            });
        }
        for (const level of getBuildingFloorLevels(cell, baseElevation, maxZ)) {
            pushBlock({
                z: level,
                element: ELEMENTS.STRUCTURE,
                texture: cell.texture,
                effect: TILE_EFFECTS.STRUCTURE,
                building: level === baseElevation ? BUILDING_PARTS.GROUND_FLOOR : BUILDING_PARTS.FLOOR
            });
        }
        return column.sort((a, b) => a.z - b.z);
    }

    if (isStackedWalkableStructure(cell)) {
        pushBlock({
            z: 0,
            element: cell.element,
            texture: cell.texture,
            effect: cell.effect,
            building: cell.building
        });
        if (maxZ > 0) {
            pushBlock({
                z: maxZ,
                element: cell.element,
                texture: cell.texture,
                effect: cell.effect,
                building: cell.building
            });
        }
        addStructuralFloorLevels(column, cell);
        return column.sort((a, b) => a.z - b.z);
    }

    for (let z = 0; z <= maxZ; z++) {
        const isSurface = z === maxZ;
        pushBlock({
            z,
            element: isSurface ? cell.element : ELEMENTS.GEO,
            texture: isSurface ? cell.texture : TEXTURE_IDS.DEFAULT,
            effect: isSurface ? cell.effect : TILE_EFFECTS.EARTH,
            building: isSurface ? cell.building : BUILDING_PARTS.NONE
        });
    }

    addStructuralFloorLevels(column, cell);
    return column.sort((a, b) => a.z - b.z);
}

export function createVoxelMatrix(rows, legend = {}) {
    if (rows?.voxelMatrix) return structuredClone(rows.voxelMatrix);
    const normalizedRows = normalizeTileRowsWithLegend(rows, legend);
    const height = normalizedRows.length;
    const width = normalizedRows[0]?.length || 0;
    const matrix = {
        encoding: 'voxel-matrix-v1',
        width,
        height,
        offsetX: Math.floor(width / 2),
        offsetY: Math.floor(height / 2),
        columns: normalizedRows.map((row) => row.map((cell) => tileCellToVoxelColumn(cell)))
    };
    for (const key of ['seed', 'variant', 'townName', 'townCenter', 'spawn', 'generator', 'generationVersion', 'contentHash', 'theme', 'generation', 'waterFlowRows']) {
        if (rows?.[key] !== undefined) matrix[key] = rows[key];
    }
    if (Array.isArray(rows?.visualVariantRows)) {
        matrix.visualVariantRows = rows.visualVariantRows.slice();
    }
    if (Array.isArray(rows?.paletteRows)) {
        matrix.paletteRows = rows.paletteRows.map((row) => row.slice());
    }
    if (Array.isArray(rows?.architectureThemeRows)) {
        matrix.architectureThemeRows = rows.architectureThemeRows.map((row) =>
            Array.isArray(row) ? row.slice() : row
        );
    }
    if (rows?.sourceTown) matrix.sourceTown = { ...rows.sourceTown };
    if (rows?.world) matrix.world = { ...rows.world };
    return matrix;
}

export function getVoxelColumn(matrix, gridX, gridY) {
    if (!matrix?.columns) return null;
    const x = gridX + matrix.offsetX;
    const y = gridY + matrix.offsetY;
    return matrix.columns[y]?.[x] || null;
}

export function getTopVoxel(column) {
    if (!Array.isArray(column) || column.length === 0) return null;
    return column.reduce((top, block) => block.z > top.z ? block : top, column[0]);
}

export function symbolRowsToTileCells(rows) {
    return rows.map((row) => [...String(row)].map((symbol) => createTileCellFromSymbol(symbol)));
}

export function normalizeTileRows(rows) {
    if (!Array.isArray(rows)) return [];
    return rows
        .filter((row) => Array.isArray(row) || typeof row === 'string')
        .map((row) => {
            if (typeof row === 'string') return [...row.trim().toUpperCase()].map((symbol) => createTileCellFromSymbol(symbol));
            return row.map((cell) => normalizeTileCell(cell));
        })
        .filter((row) => row.length > 0);
}

export function normalizeTileRowsWithLegend(rows, legend = {}) {
    if (!Array.isArray(rows)) return [];
    return rows
        .filter((row) => Array.isArray(row) || typeof row === 'string')
        .map((row) => {
            if (typeof row === 'string') {
                return [...row.trim().toUpperCase()].map((symbol) => {
                    const legendCell = legend[symbol] || legend[symbol.toUpperCase?.()];
                    return normalizeTileCell(legendCell || symbol);
                });
            }
            return row.map((cell) => normalizeTileCell(cell));
        })
        .filter((row) => row.length > 0);
}

export function serializeTileRowsForAdmin(rows) {
    const normalized = normalizeTileRows(rows);
    return JSON.stringify(normalized, null, 2);
}

export function tileCellToSymbol(rawCell) {
    const cell = normalizeTileCell(rawCell);
    let fallback = 'W';
    for (const [symbol, candidate] of Object.entries(TILE_SYMBOL_LIBRARY)) {
        if (candidate.element !== cell.element) continue;
        if (fallback === 'W') fallback = symbol;
        if (candidate.texture === cell.texture && candidate.building === cell.building && candidate.height === cell.height) {
            return symbol;
        }
    }
    return fallback;
}

export function tileRowsToSymbolRows(rows) {
    return normalizeTileRows(rows).map((row) => row.map((cell) => tileCellToSymbol(cell)).join(''));
}

export const MAP_LEGEND = Object.fromEntries(
    Object.entries(TILE_SYMBOL_LIBRARY).map(([symbol, cell]) => [symbol, tileCellToBlockInfo(cell)])
);

function isStackedBuildingWall(cell) {
    return cell.element === ELEMENTS.STRUCTURE &&
        cell.height >= 2 &&
        (cell.building === BUILDING_PARTS.WALL || isWindowWallPart(cell.building));
}

function isStackedWalkableStructure(cell) {
    return cell.element === ELEMENTS.STRUCTURE &&
        cell.height > 0 &&
        [
            BUILDING_PARTS.FLOOR,
            BUILDING_PARTS.GROUND_FLOOR,
            BUILDING_PARTS.STAIRS,
            BUILDING_PARTS.STAIRS_NORTH,
            BUILDING_PARTS.STAIRS_SOUTH,
            BUILDING_PARTS.STAIRS_WEST,
            BUILDING_PARTS.STAIRS_EAST,
            BUILDING_PARTS.CITY_WALL_WALKWAY,
            BUILDING_PARTS.CITY_WALL_STAIRS_NORTH,
            BUILDING_PARTS.CITY_WALL_STAIRS_SOUTH,
            BUILDING_PARTS.CITY_WALL_STAIRS_WEST,
            BUILDING_PARTS.CITY_WALL_STAIRS_EAST
        ].includes(cell.building);
}

function isCityWallStairPart(buildingPart) {
    return [
        BUILDING_PARTS.CITY_WALL_STAIRS_NORTH,
        BUILDING_PARTS.CITY_WALL_STAIRS_SOUTH,
        BUILDING_PARTS.CITY_WALL_STAIRS_WEST,
        BUILDING_PARTS.CITY_WALL_STAIRS_EAST
    ].includes(buildingPart);
}

function isStairPart(buildingPart) {
    return [
        BUILDING_PARTS.STAIRS,
        BUILDING_PARTS.STAIRS_NORTH,
        BUILDING_PARTS.STAIRS_SOUTH,
        BUILDING_PARTS.STAIRS_WEST,
        BUILDING_PARTS.STAIRS_EAST,
        BUILDING_PARTS.CITY_WALL_STAIRS_NORTH,
        BUILDING_PARTS.CITY_WALL_STAIRS_SOUTH,
        BUILDING_PARTS.CITY_WALL_STAIRS_WEST,
        BUILDING_PARTS.CITY_WALL_STAIRS_EAST
    ].includes(buildingPart);
}

function isBuildingFloorPart(buildingPart) {
    return buildingPart === BUILDING_PARTS.FLOOR || buildingPart === BUILDING_PARTS.GROUND_FLOOR;
}

function isLowerWindowPart(buildingPart) {
    return [
        BUILDING_PARTS.WINDOW_LOWER_NORTH,
        BUILDING_PARTS.WINDOW_LOWER_SOUTH,
        BUILDING_PARTS.WINDOW_LOWER_WEST,
        BUILDING_PARTS.WINDOW_LOWER_EAST
    ].includes(buildingPart);
}

function isUpperWindowPart(buildingPart) {
    return [
        BUILDING_PARTS.WINDOW_UPPER_NORTH,
        BUILDING_PARTS.WINDOW_UPPER_SOUTH,
        BUILDING_PARTS.WINDOW_UPPER_WEST,
        BUILDING_PARTS.WINDOW_UPPER_EAST
    ].includes(buildingPart);
}

function isWindowWallPart(buildingPart) {
    return isLowerWindowPart(buildingPart) || isUpperWindowPart(buildingPart);
}

function getUpperWindowPart(buildingPart) {
    return {
        [BUILDING_PARTS.WINDOW_LOWER_NORTH]: BUILDING_PARTS.WINDOW_UPPER_NORTH,
        [BUILDING_PARTS.WINDOW_LOWER_SOUTH]: BUILDING_PARTS.WINDOW_UPPER_SOUTH,
        [BUILDING_PARTS.WINDOW_LOWER_WEST]: BUILDING_PARTS.WINDOW_UPPER_WEST,
        [BUILDING_PARTS.WINDOW_LOWER_EAST]: BUILDING_PARTS.WINDOW_UPPER_EAST
    }[buildingPart] || buildingPart;
}

function getBuildingPartAtElevation(buildingPart, elevation, baseElevation = 0) {
    if (!isLowerWindowPart(buildingPart)) return buildingPart;
    const groundFloor = clampInteger(baseElevation, 0);
    if (elevation <= groundFloor) return BUILDING_PARTS.GROUND_FLOOR;
    const windowOffset = elevation - groundFloor - 1;
    return windowOffset % 2 === 0 ? buildingPart : getUpperWindowPart(buildingPart);
}

function addStructuralFloorLevels(column, cell) {
    const baseElevation = getBuildingGroundElevation(cell);
    for (const z of normalizeStructuralLevels(cell.structuralFloorLevels)) {
        mergeVoxelBlock(column, createVoxelBlock({
            z,
            element: ELEMENTS.STRUCTURE,
            texture: cell.texture,
            effect: TILE_EFFECTS.STRUCTURE,
            building: z === baseElevation ? BUILDING_PARTS.GROUND_FLOOR : BUILDING_PARTS.FLOOR,
            visualVariant: cell.visualVariant,
            paletteId: cell.paletteId,
            architectureThemeId: cell.architectureThemeId,
            ...createVoxelBuildingReference(cell, {
                z,
                element: ELEMENTS.STRUCTURE,
                building: z === baseElevation ? BUILDING_PARTS.GROUND_FLOOR : BUILDING_PARTS.FLOOR,
                partTag: z === baseElevation ? BUILDING_PART_TAGS.GROUND_FLOOR : BUILDING_PART_TAGS.UPPER_FLOOR,
                placementTag: BUILDING_PLACEMENT_TAGS.FLOOR_SURFACE,
                placementZ: z,
                levelZ: z
            })
        }));
    }
}

function createVoxelBuildingReference(cell, block = {}) {
    if (!hasBuildingReference(cell)) return {};
    const z = clampInteger(block.z, 0);
    const groundFloorZ = getBuildingGroundFloorZ(cell);
    const floorHeight = getBuildingFloorHeight(cell);
    const levelRefs = getCellBuildingFloorRefs(cell, groundFloorZ, floorHeight);
    const buildingPart = clampInteger(block.building ?? cell.building, BUILDING_PARTS.NONE);
    const partTag = block.partTag || inferBuildingPartTag(cell, buildingPart, z);
    const placementTag = block.placementTag || inferBuildingPlacementTag(cell, buildingPart, partTag);
    const levelZ = Number.isFinite(block.levelZ)
        ? clampInteger(block.levelZ, groundFloorZ)
        : inferBuildingLevelZ(cell, buildingPart, z, groundFloorZ);
    const level = getBuildingLevelReferenceForZ(levelRefs, levelZ, groundFloorZ);
    const anchorZ = Number.isFinite(block.anchorZ)
        ? block.anchorZ
        : Number.isFinite(cell.buildingAnchorZ)
            ? cell.buildingAnchorZ
            : level.z;
    const placementZ = Number.isFinite(block.placementZ)
        ? block.placementZ
        : Number.isFinite(cell.buildingPlacementZ)
            ? cell.buildingPlacementZ
            : level.placementZ;
    return normalizeVoxelBuildingReference({
        buildingGroundFloorZ: groundFloorZ,
        buildingFloorHeight: floorHeight,
        buildingLevelIndex: level.index,
        buildingLevelTag: level.tag,
        buildingLevelKind: level.kind,
        buildingPartTag: partTag,
        buildingAnchorZ: anchorZ,
        buildingPlacementZ: placementZ,
        buildingPlacementTag: placementTag
    });
}

function normalizeVoxelBuildingReference(reference = {}) {
    const normalized = {};
    if (Number.isFinite(reference.buildingGroundFloorZ)) {
        normalized.buildingGroundFloorZ = clampInteger(reference.buildingGroundFloorZ, 0);
    }
    if (Number.isFinite(reference.buildingFloorHeight)) {
        normalized.buildingFloorHeight = Math.max(1, clampInteger(reference.buildingFloorHeight, BUILDING_FLOOR_HEIGHT));
    }
    if (Number.isFinite(reference.buildingLevelIndex)) normalized.buildingLevelIndex = Math.floor(reference.buildingLevelIndex);
    if (typeof reference.buildingLevelTag === 'string') normalized.buildingLevelTag = reference.buildingLevelTag;
    if (typeof reference.buildingLevelKind === 'string') normalized.buildingLevelKind = reference.buildingLevelKind;
    if (typeof reference.buildingPartTag === 'string') normalized.buildingPartTag = reference.buildingPartTag;
    if (Number.isFinite(reference.buildingAnchorZ)) normalized.buildingAnchorZ = clampInteger(reference.buildingAnchorZ, 0);
    if (Number.isFinite(reference.buildingPlacementZ)) normalized.buildingPlacementZ = clampInteger(reference.buildingPlacementZ, 0);
    if (typeof reference.buildingPlacementTag === 'string') normalized.buildingPlacementTag = reference.buildingPlacementTag;
    return normalized;
}

function hasBuildingReference(cell) {
    return Number.isFinite(cell.buildingGroundFloorZ) ||
        Number.isFinite(cell.buildingGroundElevation) ||
        Number.isFinite(cell.buildingBaseElevation) ||
        Array.isArray(cell.buildingFloorRefs) ||
        Array.isArray(cell.buildingFloorLevels) ||
        typeof cell.buildingMatrixTag === 'string';
}

function getBuildingGroundFloorZ(cell) {
    if (Number.isFinite(cell.buildingGroundFloorZ)) return clampInteger(cell.buildingGroundFloorZ, 0);
    return getBuildingGroundElevation(cell);
}

function getBuildingFloorHeight(cell) {
    return Number.isFinite(cell.buildingFloorHeight)
        ? Math.max(1, clampInteger(cell.buildingFloorHeight, BUILDING_FLOOR_HEIGHT))
        : BUILDING_FLOOR_HEIGHT;
}

function getCellBuildingFloorRefs(cell, groundFloorZ, floorHeight) {
    if (Array.isArray(cell.buildingFloorRefs) && cell.buildingFloorRefs.length > 0) {
        return normalizeBuildingFloorRefs(cell.buildingFloorRefs);
    }
    return getBuildingFloorLevels(cell, groundFloorZ, cell.height)
        .map((z) => {
            const index = Math.round((z - groundFloorZ) / floorHeight);
            return {
                index,
                story: index,
                tag: getBuildingLevelTag(index),
                kind: index === 0 ? BUILDING_LEVEL_KINDS.GROUND : BUILDING_LEVEL_KINDS.UPPER,
                z,
                surfaceZ: z,
                placementZ: z,
                part: index === 0 ? BUILDING_PARTS.GROUND_FLOOR : BUILDING_PARTS.FLOOR
            };
        });
}

function normalizeBuildingFloorRefs(refs = []) {
    return [...new Map((Array.isArray(refs) ? refs : [])
        .map((ref) => {
            const z = Math.floor(Number(ref?.z ?? ref?.surfaceZ ?? 0) || 0);
            const index = Math.floor(Number(ref?.index ?? ref?.story ?? 0) || 0);
            return [ref?.tag || getBuildingLevelTag(index), {
                index,
                story: Math.floor(Number(ref?.story ?? index) || 0),
                tag: String(ref?.tag || getBuildingLevelTag(index)),
                kind: String(ref?.kind || (index === 0 ? BUILDING_LEVEL_KINDS.GROUND : BUILDING_LEVEL_KINDS.UPPER)),
                z,
                surfaceZ: Math.floor(Number(ref?.surfaceZ ?? z) || 0),
                placementZ: Math.floor(Number(ref?.placementZ ?? z) || 0),
                part: clampInteger(ref?.part, index === 0 ? BUILDING_PARTS.GROUND_FLOOR : BUILDING_PARTS.FLOOR)
            }];
        })).values()]
        .sort((a, b) => a.z - b.z || a.index - b.index);
}

function inferBuildingLevelZ(cell, buildingPart, z, groundFloorZ) {
    if (Number.isFinite(cell.stairDestinationElevation) && cell.stairRole === 'upper-stair') {
        return clampInteger(cell.stairDestinationElevation, z);
    }
    if (Number.isFinite(cell.stairBaseElevation) && ['lower-stair', 'support', 'air', 'pass-through-air'].includes(cell.stairRole)) {
        return clampInteger(cell.stairBaseElevation, groundFloorZ);
    }
    if (isBuildingFloorPart(buildingPart)) return z;
    if (Number.isFinite(cell.buildingAnchorZ)) return clampInteger(cell.buildingAnchorZ, groundFloorZ);
    return groundFloorZ;
}

function inferBuildingPartTag(cell, buildingPart, z) {
    if (z < getBuildingGroundFloorZ(cell)) return BUILDING_PART_TAGS.FOUNDATION;
    if (typeof cell.buildingPartTag === 'string') return cell.buildingPartTag;
    if (buildingPart === BUILDING_PARTS.GROUND_FLOOR) return BUILDING_PART_TAGS.GROUND_FLOOR;
    if (buildingPart === BUILDING_PARTS.FLOOR) return BUILDING_PART_TAGS.UPPER_FLOOR;
    if (buildingPart === BUILDING_PARTS.DOOR) return BUILDING_PART_TAGS.DOOR;
    if (isStairPart(buildingPart)) return inferStairPartTag(cell.stairRole);
    if (isWindowWallPart(buildingPart)) return BUILDING_PART_TAGS.WINDOW;
    if (buildingPart === BUILDING_PARTS.WALL) return BUILDING_PART_TAGS.WALL;
    if (buildingPart === BUILDING_PARTS.ROOF) return BUILDING_PART_TAGS.ROOF;
    return BUILDING_PART_TAGS.FOUNDATION;
}

function inferStairPartTag(role) {
    if (role === 'upper-stair') return BUILDING_PART_TAGS.STAIR_UPPER;
    if (role === 'support') return BUILDING_PART_TAGS.STAIR_SUPPORT;
    if (role === 'air' || role === 'pass-through-air') return BUILDING_PART_TAGS.STAIR_AIR_SHAFT;
    return BUILDING_PART_TAGS.STAIR_LOWER;
}

function inferBuildingPlacementTag(cell, buildingPart, partTag) {
    if (typeof cell.buildingPlacementTag === 'string') return cell.buildingPlacementTag;
    if (partTag === BUILDING_PART_TAGS.STAIR_LOWER || partTag === BUILDING_PART_TAGS.STAIR_UPPER) {
        return BUILDING_PLACEMENT_TAGS.STAIR_SURFACE;
    }
    if (buildingPart === BUILDING_PARTS.GROUND_FLOOR || buildingPart === BUILDING_PARTS.FLOOR) {
        return BUILDING_PLACEMENT_TAGS.FLOOR_SURFACE;
    }
    return BUILDING_PLACEMENT_TAGS.NONE;
}

function mergeVoxelBlock(column, block) {
    const index = column.findIndex((candidate) => candidate.z === block.z);
    if (index < 0) {
        column.push(block);
        return;
    }
    const existing = column[index];
    if (isStairPart(existing.building) || existing.building === BUILDING_PARTS.WALL || isWindowWallPart(existing.building)) return;
    column[index] = block;
}

function normalizeStructuralLevels(levels = []) {
    return [...new Set(levels
        .map((level) => clampInteger(level, 0))
        .filter((level) => level > 0))]
        .sort((a, b) => a - b);
}

function normalizeFloorLevels(levels = []) {
    return [...new Set((Array.isArray(levels) ? levels : [])
        .map((level) => clampInteger(level, 0)))]
        .sort((a, b) => a - b);
}

function getBuildingGroundElevation(cell) {
    if (Number.isFinite(cell.buildingGroundElevation)) return clampInteger(cell.buildingGroundElevation, 0);
    return clampInteger(cell.buildingBaseElevation, 0);
}

function getStairBaseElevation(cell, fallback = 0) {
    return Number.isFinite(cell.stairBaseElevation)
        ? clampInteger(cell.stairBaseElevation, fallback)
        : fallback;
}

function getBuildingFloorLevels(cell, baseElevation, maxZ) {
    const levels = new Set([baseElevation]);
    if (maxZ >= baseElevation) levels.add(maxZ);
    for (const level of normalizeFloorLevels(cell.buildingFloorLevels)) {
        if (level >= baseElevation) levels.add(level);
    }
    for (const level of normalizeStructuralLevels(cell.structuralFloorLevels)) {
        if (level >= baseElevation) levels.add(level);
    }
    return [...levels].sort((a, b) => a - b);
}

function normalizeDoorClearanceLevels(levels = [], fallbackBase = 0) {
    const normalized = [...new Set((Array.isArray(levels) ? levels : [])
        .map((level) => clampInteger(level, 0)))]
        .sort((a, b) => a - b);
    if (normalized.length === 0) normalized.push(clampInteger(fallbackBase, 0));
    return new Set(normalized);
}

function isDoorAirClearance(z, clearanceLevels) {
    for (const level of clearanceLevels) {
        if (z > level && z <= level + 2) return true;
    }
    return false;
}

export function isBlockWalkable(element, texture, buildingPart = BUILDING_PARTS.NONE) {
    if (isWindowWallPart(buildingPart) || buildingPart === BUILDING_PARTS.WALL) return false;
    if (buildingPart === BUILDING_PARTS.GROUND_FLOOR) return true;
    return Boolean(getTileDefinition(element, texture).walkable);
}

function normalizePaletteId(value) {
    const normalized = String(value || 'meadow')
        .toLowerCase()
        .replace(/[^a-z0-9-]+/g, '-');
    return normalized || 'meadow';
}

function clampInteger(value, fallback) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.max(0, Math.floor(number)) : fallback;
}
