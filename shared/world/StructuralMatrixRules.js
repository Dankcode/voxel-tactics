const ELEMENTS = Object.freeze({
    VOID: 0,
    GEO: 1,
    HYDRO: 2,
    ANEMO: 3,
    CRYO: 4,
    PYRO: 5,
    STRUCTURE: 6
});

const BUILDING_PARTS = Object.freeze({
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
});

const STRUCTURAL_WALL_SYMBOLS = new Set(['T', 'A', 'C', 'N', 'O', 'J', 'K', 'Q', 'V', 'Y', 'Z']);
const STRUCTURAL_WINDOW_PARTS = new Set([
    BUILDING_PARTS.WINDOW_LOWER_NORTH,
    BUILDING_PARTS.WINDOW_LOWER_SOUTH,
    BUILDING_PARTS.WINDOW_LOWER_WEST,
    BUILDING_PARTS.WINDOW_LOWER_EAST,
    BUILDING_PARTS.WINDOW_UPPER_NORTH,
    BUILDING_PARTS.WINDOW_UPPER_SOUTH,
    BUILDING_PARTS.WINDOW_UPPER_WEST,
    BUILDING_PARTS.WINDOW_UPPER_EAST
]);
const STAIR_PARTS = new Set([
    BUILDING_PARTS.STAIRS,
    BUILDING_PARTS.STAIRS_NORTH,
    BUILDING_PARTS.STAIRS_SOUTH,
    BUILDING_PARTS.STAIRS_WEST,
    BUILDING_PARTS.STAIRS_EAST,
    BUILDING_PARTS.CITY_WALL_STAIRS_NORTH,
    BUILDING_PARTS.CITY_WALL_STAIRS_SOUTH,
    BUILDING_PARTS.CITY_WALL_STAIRS_WEST,
    BUILDING_PARTS.CITY_WALL_STAIRS_EAST
]);
const CITY_WALL_STAIR_PARTS = new Set([
    BUILDING_PARTS.CITY_WALL_STAIRS_NORTH,
    BUILDING_PARTS.CITY_WALL_STAIRS_SOUTH,
    BUILDING_PARTS.CITY_WALL_STAIRS_WEST,
    BUILDING_PARTS.CITY_WALL_STAIRS_EAST
]);
const STAIR_FLOOR_HEIGHT = 2;
const STAIR_HEADROOM_VOXELS = 2;
export const BUILDING_FLOOR_HEIGHT = STAIR_FLOOR_HEIGHT;

export const BUILDING_LEVEL_KINDS = Object.freeze({
    BASEMENT: 'basement',
    GROUND: 'ground',
    UPPER: 'upper',
    ROOF: 'roof'
});

export const BUILDING_PART_TAGS = Object.freeze({
    FOUNDATION: 'building:foundation',
    GROUND_FLOOR: 'building:floor:ground',
    UPPER_FLOOR: 'building:floor:upper',
    WALL: 'building:wall',
    WINDOW: 'building:window',
    DOOR: 'building:door',
    DOOR_CLEARANCE: 'building:door:clearance',
    STAIR_LOWER: 'building:stair:lower',
    STAIR_UPPER: 'building:stair:upper',
    STAIR_SUPPORT: 'building:stair:support',
    STAIR_AIR_SHAFT: 'building:stair:air-shaft',
    ROOF: 'building:roof'
});

export const BUILDING_PLACEMENT_TAGS = Object.freeze({
    NONE: 'none',
    FLOOR_SURFACE: 'floor-surface',
    STAIR_SURFACE: 'stair-surface',
    ROOF_SURFACE: 'roof-surface',
    VERTICAL_CLEARANCE: 'vertical-clearance'
});

export const STAIR_CONFIGURATION = Object.freeze({
    SOLID_TRIANGULAR: 'solid-triangular',
    FLOATING_SLOPE: 'floating-slope'
});

export function createBuildingLevelReferences(baseElevation = 0, stories = 1, options = {}) {
    const floorHeight = Math.max(1, Math.floor(options.floorHeight || BUILDING_FLOOR_HEIGHT));
    const groundFloorZ = Math.max(0, Math.floor(baseElevation || 0));
    const normalizedStories = Math.max(1, Math.floor(stories || 1));
    const basementCount = Math.max(0, Math.floor(options.basementCount || 0));
    const levels = [];

    for (let index = basementCount; index > 0; index--) {
        const z = groundFloorZ - index * floorHeight;
        levels.push({
            index: -index,
            story: -index,
            tag: `basement-${index}`,
            kind: BUILDING_LEVEL_KINDS.BASEMENT,
            z,
            surfaceZ: z,
            placementZ: z,
            part: BUILDING_PARTS.FLOOR
        });
    }

    for (let story = 0; story < normalizedStories; story++) {
        const z = groundFloorZ + story * floorHeight;
        const isGround = story === 0;
        levels.push({
            index: story,
            story,
            tag: getBuildingLevelTag(story),
            kind: isGround ? BUILDING_LEVEL_KINDS.GROUND : BUILDING_LEVEL_KINDS.UPPER,
            z,
            surfaceZ: z,
            placementZ: z,
            part: isGround ? BUILDING_PARTS.GROUND_FLOOR : BUILDING_PARTS.FLOOR
        });
    }

    return levels;
}

export function createRoofLevelReference(baseElevation = 0, stories = 1, options = {}) {
    const floorHeight = Math.max(1, Math.floor(options.floorHeight || BUILDING_FLOOR_HEIGHT));
    const groundFloorZ = Math.max(0, Math.floor(baseElevation || 0));
    const normalizedStories = Math.max(1, Math.floor(stories || 1));
    const z = groundFloorZ + normalizedStories * floorHeight;
    return {
        index: normalizedStories,
        story: normalizedStories,
        tag: 'roof',
        kind: BUILDING_LEVEL_KINDS.ROOF,
        z,
        surfaceZ: z,
        placementZ: z,
        part: BUILDING_PARTS.ROOF
    };
}

export function getBuildingLevelTag(story = 0) {
    const index = Math.floor(Number(story) || 0);
    if (index < 0) return `basement-${Math.abs(index)}`;
    return index === 0 ? 'ground-floor' : `floor-${index + 1}`;
}

export function getBuildingLevelReferenceForZ(levels = [], z = 0, fallbackGroundZ = 0) {
    const targetZ = Math.floor(Number(z) || 0);
    const match = (Array.isArray(levels) ? levels : [])
        .find((level) => Math.floor(Number(level?.z) || 0) === targetZ);
    if (match) return match;
    const groundFloorZ = Math.max(0, Math.floor(fallbackGroundZ || 0));
    return {
        index: 0,
        story: 0,
        tag: getBuildingLevelTag(0),
        kind: BUILDING_LEVEL_KINDS.GROUND,
        z: groundFloorZ,
        surfaceZ: groundFloorZ,
        placementZ: groundFloorZ,
        part: BUILDING_PARTS.GROUND_FLOOR
    };
}

const BASE_SOLID_TRIANGULAR_SECTORS = Object.freeze([
    { x: 0, y: 0, sector: 'bottom-start', role: 'lower-stair', voxel: 'lower-tier-half-stair', heightTier: 0 },
    { x: 0, y: 1, sector: 'upper-supported', role: 'upper-stair', voxel: 'upper-tier-half-stair', heightTier: STAIR_FLOOR_HEIGHT },
    { x: 1, y: 1, sector: 'upper-pass-through', role: 'air', voxel: 0, heightTier: 0 }
]);

const BASE_FLOATING_SLOPE_SECTORS = Object.freeze([
    { x: 0, y: 0, sector: 'bottom-start', role: 'lower-stair', voxel: 'lower-tier-half-stair', heightTier: 0 },
    { x: 0, y: 1, sector: 'upper-supported', role: 'upper-stair', voxel: 'upper-tier-half-stair', heightTier: STAIR_FLOOR_HEIGHT },
    { x: 1, y: 1, sector: 'upper-pass-through', role: 'pass-through-air', voxel: 0, heightTier: 0 }
]);

export function getBuildingFootprintCells(building) {
    const width = Math.max(0, Math.floor(building?.width || 0));
    const height = Math.max(0, Math.floor(building?.height || 0));
    const cells = Array.isArray(building?.footprintCells) && building.footprintCells.length > 0
        ? building.footprintCells
            .map((cell) => ({ x: Math.floor(cell.x), y: Math.floor(cell.y) }))
            .filter((cell) => cell.x >= 0 && cell.y >= 0 && cell.x < width && cell.y < height)
        : Array.from({ length: height }, (_, y) =>
            Array.from({ length: width }, (_, x) => ({ x, y }))
        ).flat();
    return {
        cells,
        set: new Set(cells.map((cell) => `${cell.x},${cell.y}`))
    };
}

export function isFootprintEdgeCell(footprintSet, x, y) {
    return !footprintSet.has(`${x},${y - 1}`) ||
        !footprintSet.has(`${x + 1},${y}`) ||
        !footprintSet.has(`${x},${y + 1}`) ||
        !footprintSet.has(`${x - 1},${y}`);
}

export function enforceStructuralShellClosure(mutableRows, building, options = {}) {
    const {
        offsetX = 0,
        offsetY = 0,
        wallSymbol = 'A',
        doorSymbol = 'D'
    } = options;
    const footprint = getBuildingFootprintCells(building);
    for (const { x: localX, y: localY } of footprint.cells) {
        if (!isFootprintEdgeCell(footprint.set, localX, localY)) continue;
        const row = building.y + localY + offsetY;
        const col = building.x + localX + offsetX;
        const current = mutableRows[row]?.[col];
        if (current === undefined || current === doorSymbol) continue;
        if (isClosedShellSymbol(current)) continue;
        mutableRows[row][col] = wallSymbol;
    }
}

export function isClosedShellSymbol(symbol) {
    return STRUCTURAL_WALL_SYMBOLS.has(String(symbol).toUpperCase());
}

export function isClosedShellBuildingPart(buildingPart) {
    return buildingPart === BUILDING_PARTS.WALL || STRUCTURAL_WINDOW_PARTS.has(buildingPart);
}

export function stabilizeBuildingElevation(tileRows, elevationRows = [], buildings = [], options = {}) {
    if (!Array.isArray(tileRows) || tileRows.length === 0) return tileRows;
    const width = tileRows[0]?.length || 0;
    const height = tileRows.length;
    const offsetX = Math.floor(width / 2);
    const offsetY = Math.floor(height / 2);
    const apron = Math.max(0, Math.floor(options.apron ?? 1));
    const owners = new Map();
    for (const building of buildings || []) {
        for (const cell of getBuildingFootprintCells(building).cells) {
            owners.set(`${building.x + cell.x},${building.y + cell.y}`, building);
        }
    }

    for (const building of buildings || []) {
        const footprint = getBuildingFootprintCells(building);
        const worldCells = footprint.cells
            .map((cell) => ({
                localX: cell.x,
                localY: cell.y,
                col: building.x + cell.x + offsetX,
                row: building.y + cell.y + offsetY
            }))
            .filter((cell) => tileRows[cell.row]?.[cell.col]);
        if (worldCells.length === 0) continue;

        const sampledElevations = worldCells.map((cell) =>
            clampElevation(elevationRows[cell.row]?.[cell.col] ?? tileRows[cell.row]?.[cell.col]?.height ?? 0)
        );
        const plateauElevation = Math.max(
            clampElevation(building.baseElevation),
            Math.max(0, ...sampledElevations)
        );
        building.baseElevation = plateauElevation;

        const plateauCells = expandFootprintCells(footprint, apron);
        for (const cell of plateauCells) {
            const row = building.y + cell.y + offsetY;
            const col = building.x + cell.x + offsetX;
            const tile = tileRows[row]?.[col];
            if (!tile || tile.element === ELEMENTS.HYDRO || tile.element === ELEMENTS.PYRO) continue;
            const owner = owners.get(`${building.x + cell.x},${building.y + cell.y}`);
            if (owner && owner !== building) continue;
            const inside = footprint.set.has(`${cell.x},${cell.y}`);
            // The apron extends beyond the bounding box, but may never erase a
            // neighbor's foundation or a compiled wall/gate/bridge.
            if (!inside && tile.element === ELEMENTS.STRUCTURE) continue;
            const height = inside ? plateauElevation : Math.max(tile.height || 0, plateauElevation - 1);
            tile.height = height;
            if (elevationRows[row]?.[col] !== undefined) elevationRows[row][col] = height;
        }
    }
    return tileRows;
}

function expandFootprintCells(footprint, apron) {
    const cells = new Map();
    for (const cell of footprint.cells) {
        for (let y = cell.y - apron; y <= cell.y + apron; y++) {
            for (let x = cell.x - apron; x <= cell.x + apron; x++) {
                cells.set(`${x},${y}`, { x, y });
            }
        }
    }
    return [...cells.values()];
}

export function createStaircaseModule({
    configuration = STAIR_CONFIGURATION.SOLID_TRIANGULAR,
    rotation = 0,
    origin = { x: 0, y: 0 },
    level = 0,
    direction = 'east'
} = {}) {
    const sectors = configuration === STAIR_CONFIGURATION.FLOATING_SLOPE
        ? BASE_FLOATING_SLOPE_SECTORS
        : BASE_SOLID_TRIANGULAR_SECTORS;
    return sectors.map((sector) => {
        const rotated = rotateSector(sector.x, sector.y, rotation);
        return {
            x: origin.x + rotated.x,
            y: origin.y + rotated.y,
            sector: sector.sector,
            role: sector.role,
            voxel: sector.voxel,
            height: sector.heightTier,
            level,
            direction,
            configuration
        };
    });
}

// One stair set = one 2x2 module per storey climb:
//   0,0,0 = lower stair surface on the building ground-floor plane
//   0,1,1 = upper stair surface at the destination floor
//   0,1,0 = implicit support wall below the upper stair surface
//   1,1,1 = open shaft that lets the player pass through the next floor slab
// All stair cells are composed strictly from createStaircaseModule; multi-voxel climbs chain
// modules along the climb direction, each offset +2 tiers. Validation is all-or-nothing.
export function createStairFlight({
    origin,
    direction = 'east',
    climbVoxels = STAIR_FLOOR_HEIGHT,
    footprintSet = null,
    door = null,
    configuration = STAIR_CONFIGURATION.SOLID_TRIANGULAR,
    level = 0
} = {}) {
    if (!origin) return null;
    const rotation = directionToRotation(direction);
    const tangent = directionToTangent(direction);
    const moduleCount = Math.max(1, Math.ceil(Math.max(1, Math.floor(climbVoxels)) / STAIR_FLOOR_HEIGHT));
    const lowerLocal = rotateSector(0, 0, rotation);

    const cells = [];
    for (let moduleIndex = 0; moduleIndex < moduleCount; moduleIndex++) {
        const moduleOrigin = {
            x: origin.x - lowerLocal.x + tangent.x * moduleIndex * 2,
            y: origin.y - lowerLocal.y + tangent.y * moduleIndex * 2
        };
        const moduleCells = createStaircaseModule({
            configuration,
            rotation,
            origin: moduleOrigin,
            level,
            direction
        });
        for (const cell of moduleCells) {
            const isAirCell = cell.role === 'air' || cell.role === 'pass-through-air';
            cells.push({
                ...cell,
                height: isAirCell ? 0 : cell.height + moduleIndex * STAIR_FLOOR_HEIGHT,
                module: moduleIndex
            });
        }
    }

    const verdict = assertStairFlightInvariants(cells, {
        footprintSet,
        door,
        configuration,
        moduleCount,
        direction
    });
    return verdict.valid ? cells : null;
}

// Strict flight validation (replaces the old allow-list filter that let partial modules pass).
// A flight is valid only when every module invariant holds; any violation rejects the whole flight.
export function assertStairFlightInvariants(cells = [], options = {}) {
    const {
        footprintSet = null,
        door = null,
        configuration = STAIR_CONFIGURATION.SOLID_TRIANGULAR,
        moduleCount = 1,
        direction = 'east'
    } = options;
    const issues = [];
    const coordinates = new Set();
    const walkHeights = new Set();
    const expectedCellsPerModule = configuration === STAIR_CONFIGURATION.FLOATING_SLOPE ? 3 : 3;
    if (cells.length !== moduleCount * expectedCellsPerModule) {
        issues.push(`flight needs ${moduleCount * expectedCellsPerModule} cells, received ${cells.length}`);
    }

    for (const cell of cells) {
        const key = `${cell.x},${cell.y}`;
        if (coordinates.has(key)) issues.push(`duplicate cell coordinate ${key}`);
        coordinates.add(key);
        if (door && cell.x === door.x && cell.y === door.y) issues.push(`cell ${key} collides with the door`);
        if (footprintSet) {
            if (!footprintSet.has(key)) issues.push(`cell ${key} (${cell.role}) leaves the footprint`);
            else if (cell.role !== 'support' && cell.role !== 'pass-through-air' &&
                isFootprintEdgeCell(footprintSet, cell.x, cell.y)) {
                issues.push(`cell ${key} (${cell.role}) touches a footprint edge cell`);
            }
        }
    }

    for (let moduleIndex = 0; moduleIndex < moduleCount; moduleIndex++) {
        const moduleCells = cells.filter((cell) => (cell.module || 0) === moduleIndex);
        const lower = moduleCells.filter((cell) => cell.role === 'lower-stair');
        const upper = moduleCells.filter((cell) => cell.role === 'upper-stair');
        const support = moduleCells.filter((cell) => cell.role === 'support');
        const air = moduleCells.filter((cell) => cell.role === 'air');
        if (lower.length !== 1) issues.push(`module ${moduleIndex} needs exactly one lower half-stair`);
        if (upper.length !== 1) issues.push(`module ${moduleIndex} needs exactly one upper half-stair`);
        if (air.length !== 1) issues.push(`module ${moduleIndex} needs exactly one air shaft cell`);
        if (support.length > 0) {
            issues.push(`module ${moduleIndex} must use implicit support below the upper stair`);
        }
        if (configuration === STAIR_CONFIGURATION.FLOATING_SLOPE && support.length !== 0) {
            issues.push(`module ${moduleIndex} must not emit support cells in floating configuration`);
        }
        const expectedLower = moduleIndex * STAIR_FLOOR_HEIGHT;
        const expectedUpper = moduleIndex * STAIR_FLOOR_HEIGHT + STAIR_FLOOR_HEIGHT;
        if (lower[0] && lower[0].height !== expectedLower) {
            issues.push(`module ${moduleIndex} lower half-stair must be tier ${expectedLower}`);
        }
        if (upper[0] && upper[0].height !== expectedUpper) {
            issues.push(`module ${moduleIndex} upper half-stair must be tier ${expectedUpper}`);
        }
    }

    const walkCells = cells
        .filter((cell) => cell.role === 'lower-stair' || cell.role === 'upper-stair')
        .sort((a, b) => getStairProgress(a, direction) - getStairProgress(b, direction));
    let previousHeight = 0;
    for (const cell of walkCells) {
        if (walkHeights.has(cell.height)) {
            issues.push(`two stair cells share height tier ${cell.height} in one flight`);
        }
        walkHeights.add(cell.height);
        if (cell.height <= previousHeight && previousHeight !== 0) {
            issues.push(`stair tiers do not strictly increase along ${direction}`);
        }
        previousHeight = cell.height;
    }
    if (walkCells.length === 0) issues.push('flight has no walkable stair cells');

    return { valid: issues.length === 0, issues };
}

function directionToTangent(direction) {
    if (direction === 'south') return { x: 0, y: 1 };
    if (direction === 'west') return { x: -1, y: 0 };
    if (direction === 'north') return { x: 0, y: -1 };
    return { x: 1, y: 0 };
}

export function validateStaircaseRouting(stairs = [], options = {}) {
    const {
        baseElevation = 0,
        stories = 1,
        floorHeight = STAIR_FLOOR_HEIGHT,
        headroom = STAIR_HEADROOM_VOXELS
    } = options;
    const normalizedBase = Math.max(0, Math.floor(baseElevation || 0));
    const normalizedStories = Math.max(1, Math.floor(stories || 1));
    const issues = [];
    const headroomCutouts = new Map();

    for (const stair of stairs || []) {
        const level = Math.max(0, Math.floor(stair?.level || 0));
        const originZ = normalizedBase + level * floorHeight;
        const destinationZ = getStairDestinationZ({
            baseElevation: normalizedBase,
            stories: normalizedStories,
            level,
            floorHeight,
            destination: stair?.destination
        });
        const walkCells = (stair?.cells || [])
            .filter((cell) => !['support', 'air', 'pass-through-air'].includes(cell.role))
            .map((cell) => ({
                ...cell,
                absoluteZ: originZ + Math.max(0, Math.floor(cell.height || 0))
            }))
            .sort((a, b) => getStairProgress(a, stair.direction) - getStairProgress(b, stair.direction));

        if (walkCells.length === 0) {
            issues.push(`stair level ${level} has no walkable cells`);
            continue;
        }

        let previousZ = originZ;
        for (const cell of walkCells) {
            if (cell.absoluteZ < previousZ || cell.absoluteZ - previousZ > floorHeight) {
                issues.push(`stair level ${level} has invalid height step at ${cell.x},${cell.y}`);
            }
            previousZ = cell.absoluteZ;
            addHeadroomCutouts(headroomCutouts, cell.x, cell.y, cell.absoluteZ, headroom);
        }

        const terminalZ = Math.max(...walkCells.map((cell) => cell.absoluteZ));
        const expectedTerminalZ = Math.max(originZ, destinationZ);
        if (terminalZ !== expectedTerminalZ) {
            issues.push(`stair level ${level} terminates at z${terminalZ}, expected z${expectedTerminalZ}`);
        }

        // The destination pass-through shaft must stay open through the floor slab so the player
        // can pass between floor levels; carve the shaft column from origin to destination.
        for (const cell of (stair?.cells || [])) {
            if (cell.role !== 'air') continue;
            addShaftCutouts(headroomCutouts, cell.x, cell.y, originZ, destinationZ + headroom);
        }
    }

    return {
        valid: issues.length === 0,
        issues,
        headroomCutouts: [...headroomCutouts.entries()].map(([key, levels]) => {
            const [x, y] = key.split(',').map(Number);
            return { x, y, levels: [...levels].sort((a, b) => a - b) };
        })
    };
}

export function getStairDestinationZ({
    baseElevation = 0,
    stories = 1,
    level = 0,
    floorHeight = STAIR_FLOOR_HEIGHT,
    destination = null
} = {}) {
    const normalizedBase = Math.max(0, Math.floor(baseElevation || 0));
    const normalizedStories = Math.max(1, Math.floor(stories || 1));
    const normalizedLevel = Math.max(0, Math.floor(level || 0));
    if (destination === 'roof' || normalizedLevel >= normalizedStories - 1) {
        return normalizedBase + normalizedStories * floorHeight;
    }
    return normalizedBase + (normalizedLevel + 1) * floorHeight;
}

export function createDoorClearanceLevels(baseElevation = 0, stories = 1, options = {}) {
    const base = Math.max(0, Math.floor(baseElevation || 0));
    return [base];
}

function addHeadroomCutouts(map, x, y, surfaceZ, headroom) {
    const key = `${Math.floor(x)},${Math.floor(y)}`;
    if (!map.has(key)) map.set(key, new Set());
    for (let offset = 1; offset <= headroom; offset++) {
        map.get(key).add(surfaceZ + offset);
    }
}

function addShaftCutouts(map, x, y, fromZ, toZ) {
    const key = `${Math.floor(x)},${Math.floor(y)}`;
    if (!map.has(key)) map.set(key, new Set());
    for (let z = fromZ + 1; z <= toZ; z++) {
        map.get(key).add(z);
    }
}

function getStairProgress(cell, direction = 'east') {
    if (direction === 'west') return -cell.x;
    if (direction === 'north') return -cell.y;
    if (direction === 'south') return cell.y;
    return cell.x;
}

export function createVoxelCollisionBox(block = {}) {
    const element = Math.max(0, Math.floor(block.element ?? ELEMENTS.VOID));
    if (element === ELEMENTS.VOID) {
        return {
            active: false,
            type: 'none',
            bounds: null
        };
    }

    const building = Math.max(0, Math.floor(block.building ?? BUILDING_PARTS.NONE));
    const texture = Math.max(0, Math.floor(block.textureValue ?? block.texture ?? 0));
    const z = Math.max(0, Math.floor(block.z ?? 0));
    const isStair = STAIR_PARTS.has(building);
    const stairLowerTier = 0;
    const stairUpperTier = 1;
    const isClosedShell = isClosedShellBuildingPart(building);
    const walkable = Boolean(block.walkable);
    return {
        active: true,
        type: isStair ? 'slope-aabb' : 'aabb',
        solid: true,
        walkableSurface: walkable,
        bounds: {
            min: [0, z, 0],
            max: [1, z + 1, 1]
        },
        slope: isStair
            ? {
                direction: getStairDirection(building),
                lowerTier: stairLowerTier,
                upperTier: stairUpperTier,
                passThrough: false
            }
            : null,
        material: { element, texture, building }
    };
}

export function createBlockRegistryCollision(entry = {}) {
    return createVoxelCollisionBox({
        element: entry.element,
        texture: entry.texture,
        textureValue: entry.texture,
        building: entry.building,
        z: 0,
        walkable: entry.walkable
    });
}

function rotateSector(x, y, rotation) {
    const normalized = ((Math.round(rotation / 90) % 4) + 4) % 4;
    if (normalized === 1) return { x: 1 - y, y: x };
    if (normalized === 2) return { x: 1 - x, y: 1 - y };
    if (normalized === 3) return { x: y, y: 1 - x };
    return { x, y };
}

function directionToRotation(direction) {
    if (direction === 'south') return 90;
    if (direction === 'west') return 180;
    if (direction === 'north') return 270;
    return 0;
}

function getStairDirection(building) {
    return {
        [BUILDING_PARTS.STAIRS_NORTH]: 'north',
        [BUILDING_PARTS.STAIRS_SOUTH]: 'south',
        [BUILDING_PARTS.STAIRS_WEST]: 'west',
        [BUILDING_PARTS.STAIRS_EAST]: 'east',
        [BUILDING_PARTS.CITY_WALL_STAIRS_NORTH]: 'north',
        [BUILDING_PARTS.CITY_WALL_STAIRS_SOUTH]: 'south',
        [BUILDING_PARTS.CITY_WALL_STAIRS_WEST]: 'west',
        [BUILDING_PARTS.CITY_WALL_STAIRS_EAST]: 'east'
    }[building] || 'north';
}

function clampElevation(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return 0;
    return Math.max(0, Math.min(6, Math.floor(number)));
}
