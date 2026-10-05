import { BUILDING_PARTS, DOOR_STYLE_TEXTURES, TEXTURE_IDS } from './TileLibrary.js';
import {
    BUILDING_FLOOR_HEIGHT,
    BUILDING_PART_TAGS,
    BUILDING_PLACEMENT_TAGS,
    createBuildingLevelReferences,
    createDoorClearanceLevels,
    enforceStructuralShellClosure,
    getBuildingLevelReferenceForZ,
    validateStaircaseRouting
} from './StructuralMatrixRules.js';

export const BUILDING_SYMBOLS = {
    stoneWall: 'A',
    timberWall: 'C',
    stoneWindowNorth: 'N',
    stoneWindowSouth: 'O',
    stoneWindowWest: 'J',
    stoneWindowEast: 'K',
    timberWindowNorth: 'Q',
    timberWindowSouth: 'V',
    timberWindowWest: 'Y',
    timberWindowEast: 'Z',
    door: 'D',
    floor: 'E',
    stairs: 'U',
    stairsNorth: '1',
    stairsSouth: '2',
    stairsWest: '3',
    stairsEast: '4',
    timberStairsNorth: '5',
    timberStairsSouth: '6',
    timberStairsWest: '7',
    timberStairsEast: '8',
    approach: 'R'
};

export const DEFAULT_BUILDINGS = [
    {
        id: 'guild-hall',
        obstructionTag: 'building:default:guild-hall',
        name: 'Guild Hall',
        x: -11,
        y: -8,
        width: 8,
        height: 6,
        stories: 3,
        style: 'timber',
        doorStyle: 'oak',
        door: { x: 4, y: 5 },
        stairs: [{ x: 1, y: 1, direction: 'north' }]
    },
    {
        id: 'village-inn',
        obstructionTag: 'building:default:village-inn',
        name: 'Village Inn',
        x: 3,
        y: -8,
        width: 8,
        height: 6,
        stories: 1,
        style: 'stone',
        doorStyle: 'iron',
        door: { x: 4, y: 5 },
        stairs: [{ x: 6, y: 1, direction: 'north' }]
    },
    {
        id: 'craft-house',
        obstructionTag: 'building:default:craft-house',
        name: 'Craft House',
        x: -10,
        y: 3,
        width: 7,
        height: 6,
        stories: 1,
        style: 'timber',
        doorStyle: 'painted',
        door: { x: 3, y: 0 },
        stairs: [{ x: 5, y: 4, direction: 'south' }]
    },
    {
        id: 'general-store',
        obstructionTag: 'building:default:general-store',
        name: 'General Store',
        x: 3,
        y: 3,
        width: 7,
        height: 6,
        stories: 1,
        style: 'stone',
        doorStyle: 'oak',
        door: { x: 3, y: 0 },
        stairs: [{ x: 1, y: 4, direction: 'south' }]
    },
    {
        id: 'watch-house',
        obstructionTag: 'building:default:watch-house',
        name: 'Watch House',
        x: 12,
        y: -2,
        width: 5,
        height: 5,
        stories: 2,
        style: 'stone',
        doorStyle: 'iron',
        door: { x: 0, y: 2 },
        stairs: [{ x: 3, y: 3, direction: 'east' }]
    }
];

export function createGeneratedBuildings(width, height, seed, villageCenter) {
    const random = seededBuildingRandom(seed);
    const centerX = villageCenter.x - Math.floor(width / 2);
    const centerY = villageCenter.y - Math.floor(height / 2);
    const templates = [
        { id: 'hall', name: 'Guild Hall', dx: -11, dy: -8, width: 8, height: 6, doorEdge: 'south', stories: 3 },
        { id: 'inn', name: 'Village Inn', dx: 3, dy: -8, width: 8, height: 6, doorEdge: 'south' },
        { id: 'house', name: 'Craft House', dx: -10, dy: 3, width: 7, height: 6, doorEdge: 'north' },
        { id: 'store', name: 'General Store', dx: 3, dy: 3, width: 7, height: 6, doorEdge: 'north' },
        { id: 'tower', name: 'Watch House', dx: 12, dy: -2, width: 5, height: 5, doorEdge: 'west' }
    ];

    return templates.map((template, index) => {
        const style = random() > 0.48 ? 'stone' : 'timber';
        const stories = template.stories || (random() > 0.78 ? 3 : random() > 0.48 ? 2 : 1);
        const door = getCenteredDoor(template.width, template.height, template.doorEdge);
        const stairs = getInteriorStairs(template.width, template.height, template.doorEdge, random);
        const id = `${template.id}-${Math.abs(Math.floor(seed))}-${index}`;
        return {
            id,
            obstructionTag: `building:generated:${id}`,
            name: template.name,
            x: clamp(template.dx + centerX, -Math.floor(width / 2) + 2, Math.floor(width / 2) - template.width - 2),
            y: clamp(template.dy + centerY, -Math.floor(height / 2) + 2, Math.floor(height / 2) - template.height - 2),
            width: template.width,
            height: template.height,
            stories,
            style,
            doorStyle: ['oak', 'iron', 'painted'][index % 3],
            door,
            stairs: [stairs]
        };
    });
}

export function applyBuildingStoriesToTileRows(tileRows, buildings = []) {
    if (!Array.isArray(tileRows) || tileRows.length === 0) return tileRows;
    const height = tileRows.length;
    const width = tileRows[0]?.length || 0;
    const offsetX = Math.floor(width / 2);
    const offsetY = Math.floor(height / 2);

    for (const building of buildings) {
        const stories = Math.max(1, Math.min(3, Math.floor(building.stories || 1)));
        const baseElevation = Math.max(0, Math.floor(building.baseElevation || 0));
        const wallHeight = baseElevation + stories * 2;
        const upperFloorLevels = createUpperFloorLevels(baseElevation, stories);
        const buildingFloorLevels = createBuildingFloorLevels(baseElevation, stories);
        const buildingFloorRefs = createBuildingLevelReferences(baseElevation, stories);
        const stairCellMap = getBuildingStairCellMap(building);
        const stairHeadroom = createStairHeadroomCutoutMap(building, baseElevation, stories);
        const footprint = getBuildingFootprint(building);
        for (const { x: localX, y: localY } of footprint.cells) {
                const isEdge = isBuildingEdgeCell(footprint.set, localX, localY);
                const isDoor = building.door?.x === localX && building.door?.y === localY;
                const stairCell = stairCellMap.get(`${localX},${localY}`);
                const row = building.y + localY + offsetY;
                const col = building.x + localX + offsetX;
                const cell = tileRows[row]?.[col];
                if (!cell) continue;
                delete cell.structuralFloorLevels;
                delete cell.buildingBaseElevation;
                delete cell.buildingGroundElevation;
                delete cell.buildingGroundFloorZ;
                delete cell.buildingFloorHeight;
                delete cell.buildingFloorLevels;
                delete cell.buildingFloorRefs;
                delete cell.buildingMatrixTag;
                delete cell.buildingLevelIndex;
                delete cell.buildingLevelTag;
                delete cell.buildingLevelKind;
                delete cell.buildingPartTag;
                delete cell.buildingAnchorZ;
                delete cell.buildingPlacementZ;
                delete cell.buildingPlacementTag;
                delete cell.stairRole;
                delete cell.stairLevel;
                delete cell.stairBaseElevation;
                delete cell.stairDestinationElevation;
                delete cell.doorWallTexture;
                delete cell.doorBaseElevation;
                delete cell.doorClearanceLevels;
                cell.height = baseElevation;
                cell.buildingBaseElevation = baseElevation;
                cell.buildingGroundElevation = baseElevation;
                cell.buildingGroundFloorZ = baseElevation;
                cell.buildingFloorHeight = BUILDING_FLOOR_HEIGHT;
                cell.buildingFloorLevels = buildingFloorLevels;
                cell.buildingMatrixTag = isEdge ? 'building-shell' : 'building-interior';
                applyBuildingPartReference(cell, {
                    levelRefs: buildingFloorRefs,
                    groundFloorZ: baseElevation,
                    levelZ: baseElevation,
                    partTag: isEdge ? BUILDING_PART_TAGS.WALL : BUILDING_PART_TAGS.GROUND_FLOOR,
                    placementTag: isEdge ? BUILDING_PLACEMENT_TAGS.NONE : BUILDING_PLACEMENT_TAGS.FLOOR_SURFACE
                });
                if (isDoor) {
                    cell.height = wallHeight;
                    cell.buildingMatrixTag = 'building-door';
                    applyBuildingPartReference(cell, {
                        levelRefs: buildingFloorRefs,
                        groundFloorZ: baseElevation,
                        levelZ: baseElevation,
                        partTag: BUILDING_PART_TAGS.DOOR,
                        placementTag: BUILDING_PLACEMENT_TAGS.NONE
                    });
                    cell.doorBaseElevation = baseElevation;
                    cell.doorClearanceLevels = createDoorClearanceLevels(baseElevation, stories);
                    cell.doorWallTexture = building.style === 'stone'
                        ? TEXTURE_IDS.STONE_BUILDING_WALL
                        : TEXTURE_IDS.TIMBER_BUILDING_WALL;
                    continue;
                }
                if (stairCell) {
                    const stairLevel = Math.max(0, Math.floor(stairCell.level || 0));
                    const stairOrigin = baseElevation + stairLevel * 2;
                    const stairSurfaceZ = stairOrigin + Math.max(0, Math.floor(stairCell.height || 0));
                    cell.stairRole = stairCell.role;
                    cell.stairLevel = stairLevel;
                    cell.stairBaseElevation = stairOrigin;
                    cell.stairDestinationElevation = Math.min(baseElevation + stories * 2, stairOrigin + 2);
                    cell.buildingMatrixTag = `building-stair-${stairCell.role}`;
                    applyBuildingPartReference(cell, {
                        levelRefs: buildingFloorRefs,
                        groundFloorZ: baseElevation,
                        levelZ: stairCell.role === 'upper-stair' ? cell.stairDestinationElevation : stairOrigin,
                        partTag: getStairRolePartTag(stairCell.role),
                        anchorZ: stairOrigin,
                        placementZ: isWalkableStairRole(stairCell.role) ? stairSurfaceZ : stairOrigin,
                        placementTag: isWalkableStairRole(stairCell.role)
                            ? BUILDING_PLACEMENT_TAGS.STAIR_SURFACE
                            : BUILDING_PLACEMENT_TAGS.NONE
                    });
                    if (stairCell.role === 'support') {
                        cell.height = wallHeight;
                        continue;
                    }
                    if (stairCell.role === 'air') {
                        // Destination pass-through shaft: keep the origin floor walkable, leave this
                        // column open through the destination floor slab, keep floors above it.
                        cell.height = baseElevation;
                        cell.buildingFloorLevels = buildingFloorLevels
                            .filter((level) => level <= stairOrigin || level > stairOrigin + 2);
                        applyBuildingPartReference(cell, {
                            levelRefs: buildingFloorRefs,
                            groundFloorZ: baseElevation,
                            levelZ: stairOrigin,
                            partTag: BUILDING_PART_TAGS.STAIR_AIR_SHAFT,
                            placementTag: BUILDING_PLACEMENT_TAGS.VERTICAL_CLEARANCE
                        });
                        cell.structuralFloorLevels = createStructuralFloorLevels(baseElevation, stories)
                            .filter((level) => level <= stairOrigin || level > stairOrigin + 2)
                            .filter((level) => !hasStairHeadroomCutout(stairHeadroom, localX, localY, level));
                        continue;
                    }
                    cell.height = stairSurfaceZ;
                    if (!isEdge) {
                        cell.structuralFloorLevels = createStructuralFloorLevels(baseElevation, stories)
                            .filter((level) => level >= cell.height)
                            .filter((level) => !hasStairHeadroomCutout(stairHeadroom, localX, localY, level));
                    }
                    continue;
                }
                if (isEdge) {
                    cell.height = wallHeight;
                    applyBuildingPartReference(cell, {
                        levelRefs: buildingFloorRefs,
                        groundFloorZ: baseElevation,
                        levelZ: baseElevation,
                        partTag: BUILDING_PART_TAGS.WALL,
                        placementTag: BUILDING_PLACEMENT_TAGS.NONE
                    });
                    continue;
                }
                if (stories > 1) {
                    cell.structuralFloorLevels = createStructuralFloorLevels(baseElevation, stories)
                        .filter((level) => !hasStairHeadroomCutout(stairHeadroom, localX, localY, level));
                    cell.height = Math.max(cell.height, upperFloorLevels[upperFloorLevels.length - 1] || baseElevation);
                    applyBuildingPartReference(cell, {
                        levelRefs: buildingFloorRefs,
                        groundFloorZ: baseElevation,
                        levelZ: baseElevation,
                        partTag: BUILDING_PART_TAGS.GROUND_FLOOR,
                        placementTag: BUILDING_PLACEMENT_TAGS.FLOOR_SURFACE
                    });
                }
        }
    }
    return tileRows;
}

function applyBuildingPartReference(cell, {
    levelRefs = [],
    groundFloorZ = 0,
    levelZ = groundFloorZ,
    partTag = BUILDING_PART_TAGS.GROUND_FLOOR,
    placementTag = BUILDING_PLACEMENT_TAGS.NONE,
    anchorZ = levelZ,
    placementZ = levelZ
} = {}) {
    const level = getBuildingLevelReferenceForZ(levelRefs, levelZ, groundFloorZ);
    cell.buildingGroundFloorZ = Math.max(0, Math.floor(groundFloorZ || 0));
    cell.buildingFloorHeight = BUILDING_FLOOR_HEIGHT;
    cell.buildingLevelIndex = level.index;
    cell.buildingLevelTag = level.tag;
    cell.buildingLevelKind = level.kind;
    cell.buildingPartTag = partTag;
    cell.buildingAnchorZ = Math.max(0, Math.floor(anchorZ || 0));
    cell.buildingPlacementZ = Math.max(0, Math.floor(placementZ || 0));
    cell.buildingPlacementTag = placementTag;
}

function getStairRolePartTag(role) {
    if (role === 'lower-stair') return BUILDING_PART_TAGS.STAIR_LOWER;
    if (role === 'upper-stair') return BUILDING_PART_TAGS.STAIR_UPPER;
    if (role === 'support') return BUILDING_PART_TAGS.STAIR_SUPPORT;
    if (role === 'air' || role === 'pass-through-air') return BUILDING_PART_TAGS.STAIR_AIR_SHAFT;
    return BUILDING_PART_TAGS.STAIR_LOWER;
}

export function applyBuildingDoorTexturesToTileRows(tileRows, buildings = []) {
    if (!Array.isArray(tileRows) || tileRows.length === 0) return tileRows;
    const offsetX = Math.floor((tileRows[0]?.length || 0) / 2);
    const offsetY = Math.floor(tileRows.length / 2);

    for (const building of buildings) {
        if (!building.door) continue;
        const row = building.y + building.door.y + offsetY;
        const col = building.x + building.door.x + offsetX;
        const doorCell = tileRows[row]?.[col];
        if (!doorCell) continue;
        if ([
            BUILDING_PARTS.STAIRS,
            BUILDING_PARTS.STAIRS_NORTH,
            BUILDING_PARTS.STAIRS_SOUTH,
            BUILDING_PARTS.STAIRS_WEST,
            BUILDING_PARTS.STAIRS_EAST
        ].includes(doorCell.building)) continue;
        doorCell.texture = DOOR_STYLE_TEXTURES[building.doorStyle] || DOOR_STYLE_TEXTURES.oak;
        doorCell.doorStyleTexture = doorCell.texture;
        doorCell.texture = 2;
    }

    return tileRows;
}

export function applyBuildingFloorTexturesToTileRows(tileRows, buildings = []) {
    if (!Array.isArray(tileRows) || tileRows.length === 0) return tileRows;
    const offsetX = Math.floor((tileRows[0]?.length || 0) / 2);
    const offsetY = Math.floor(tileRows.length / 2);

    for (const building of buildings) {
        const floorTexture = building.style === 'stone'
            ? TEXTURE_IDS.STONE_FLOOR
            : TEXTURE_IDS.WOOD_FLOOR;
        const stairTexture = building.style === 'stone'
            ? TEXTURE_IDS.STONE_STAIRS
            : TEXTURE_IDS.TIMBER_STAIRS;
        for (const { x: localX, y: localY } of getBuildingFootprint(building).cells) {
                const row = building.y + localY + offsetY;
                const col = building.x + localX + offsetX;
                const cell = tileRows[row]?.[col];
                if (!cell) continue;
                if (cell.building === BUILDING_PARTS.FLOOR) {
                    cell.texture = floorTexture;
                } else if ([
                    BUILDING_PARTS.STAIRS,
                    BUILDING_PARTS.STAIRS_NORTH,
                    BUILDING_PARTS.STAIRS_SOUTH,
                    BUILDING_PARTS.STAIRS_WEST,
                    BUILDING_PARTS.STAIRS_EAST
                ].includes(cell.building)) {
                    cell.texture = stairTexture;
                }
        }
    }

    return tileRows;
}

export function stampBuildingsOnRows(rows, buildings = DEFAULT_BUILDINGS, options = {}) {
    if (!Array.isArray(rows) || rows.length === 0) return rows;

    const mutable = rows.map((row) => row.split(''));
    const height = mutable.length;
    const width = mutable[0].length;
    const offsetX = Math.floor(width / 2);
    const offsetY = Math.floor(height / 2);

    if (options.normalizeDoors !== false) {
        normalizeBuildingEntrances(mutable, buildings, offsetX, offsetY);
    }
    prepareTownLots(mutable, buildings, offsetX, offsetY, options);
    for (const building of buildings) {
        stampBuilding(mutable, building, offsetX, offsetY);
        stampDoorApproach(mutable, building, offsetX, offsetY);
    }

    return mutable.map((row) => row.join(''));
}

function normalizeBuildingEntrances(mutable, buildings, offsetX, offsetY) {
    for (const building of buildings) {
        if (building.preserveEntrance === true) continue;
        const safeDoor = findSafeDoor(building, mutable, offsetX, offsetY);
        if (safeDoor) building.door = safeDoor;
    }
}

function findSafeDoor(building, mutable, offsetX, offsetY) {
    const candidates = [];
    for (let x = 1; x < building.width - 1; x++) {
        candidates.push({ x, y: 0, edge: 'north' });
        candidates.push({ x, y: building.height - 1, edge: 'south' });
    }
    for (let y = 1; y < building.height - 1; y++) {
        candidates.push({ x: 0, y, edge: 'west' });
        candidates.push({ x: building.width - 1, y, edge: 'east' });
    }

    let best = null;
    for (const candidate of candidates) {
        const direction = getEdgeDirection(candidate.edge);
        const outsideRow = building.y + candidate.y + direction.y + offsetY;
        const outsideCol = building.x + candidate.x + direction.x + offsetX;
        const outsideSymbol = mutable[outsideRow]?.[outsideCol];
        const outsidePassable = canStampDoorApproach(outsideSymbol);
        const roadScore = getRoadAdjacencyScore(mutable, outsideCol, outsideRow);
        const originalDistance = building.door
            ? Math.abs(candidate.x - building.door.x) + Math.abs(candidate.y - building.door.y)
            : 0;
        const centerDistance = Math.abs(candidate.x - (building.width - 1) / 2) +
            Math.abs(candidate.y - (building.height - 1) / 2);
        const score = (outsidePassable ? 120 : -120) +
            roadScore * 18 -
            originalDistance * 2 -
            centerDistance;

        if (!best || score > best.score) best = { ...candidate, score };
    }

    if (!best) return getCenteredDoor(building.width, building.height, getDoorEdge(building));
    return { x: best.x, y: best.y };
}

function getRoadAdjacencyScore(mutable, col, row) {
    let score = isRoadLike(mutable[row]?.[col]) ? 2 : 0;
    for (const offset of [
        { x: 1, y: 0 },
        { x: -1, y: 0 },
        { x: 0, y: 1 },
        { x: 0, y: -1 }
    ]) {
        if (isRoadLike(mutable[row + offset.y]?.[col + offset.x])) score++;
    }
    return score;
}

function isRoadLike(symbol) {
    return ['R', '.', ':', ';'].includes(symbol);
}

function prepareTownLots(mutable, buildings, offsetX, offsetY, options) {
    for (const building of buildings) {
        for (const { x: localX, y: localY } of getBuildingLotCells(building)) {
            const row = building.y + localY + offsetY;
            const col = building.x + localX + offsetX;
            if (!mutable[row]?.[col]) continue;
            // Lot aprons are cosmetic ground preparation. Never let them carve city walls,
            // water, or another structure; placement validation must move the building instead.
            if (!canStampDoorApproach(mutable[row][col])) continue;
            mutable[row][col] = BUILDING_SYMBOLS.approach;
        }

        const approach = getDoorApproachPosition(building);
        if (approach && options.villageCenter && options.connectDoors !== false) {
            stampRoadPath(mutable, approach, {
                x: options.villageCenter.x - offsetX,
                y: options.villageCenter.y - offsetY
            }, offsetX, offsetY);
        }
    }
}

function getBuildingLotCells(building) {
    const footprint = getBuildingFootprint(building);
    if (!building.footprintCells?.length) {
        return expandRectCells(-1, -1, building.width + 1, building.height + 1);
    }

    const cells = new Map();
    for (const cell of footprint.cells) {
        for (let localY = cell.y - 1; localY <= cell.y + 1; localY++) {
            for (let localX = cell.x - 1; localX <= cell.x + 1; localX++) {
                cells.set(`${localX},${localY}`, { x: localX, y: localY });
            }
        }
    }
    return [...cells.values()];
}

function expandRectCells(minX, minY, maxX, maxY) {
    const cells = [];
    for (let y = minY; y <= maxY; y++) {
        for (let x = minX; x <= maxX; x++) {
            cells.push({ x, y });
        }
    }
    return cells;
}

function stampRoadPath(mutable, from, to, offsetX, offsetY) {
    let x = from.x;
    let y = from.y;
    while (x !== to.x) {
        stampRoadCell(mutable, x, y, offsetX, offsetY);
        x += Math.sign(to.x - x);
    }
    while (y !== to.y) {
        stampRoadCell(mutable, x, y, offsetX, offsetY);
        y += Math.sign(to.y - y);
    }
    stampRoadCell(mutable, x, y, offsetX, offsetY);
}

function stampRoadCell(mutable, x, y, offsetX, offsetY) {
    const row = y + offsetY;
    const col = x + offsetX;
    if (!mutable[row]?.[col]) return;
    if (!canStampDoorApproach(mutable[row][col])) return;
    mutable[row][col] = BUILDING_SYMBOLS.approach;
}

function getDoorApproachPosition(building) {
    if (!building.door) return null;
    const edge = getEdge(building, building.door.x, building.door.y);
    const direction = getEdgeDirection(edge);
    if (!direction) return null;
    return {
        x: building.x + building.door.x + direction.x,
        y: building.y + building.door.y + direction.y
    };
}

function stampBuilding(mutable, building, offsetX, offsetY) {
    const wallSymbol = building.style === 'stone'
        ? BUILDING_SYMBOLS.stoneWall
        : BUILDING_SYMBOLS.timberWall;
    const stairCellMap = getBuildingStairCellMap(building);
    const footprint = getBuildingFootprint(building);

    for (const { x: localX, y: localY } of footprint.cells) {
            const row = building.y + localY + offsetY;
            const col = building.x + localX + offsetX;
            if (!mutable[row]?.[col]) continue;
            // Explicit footprints are not permission to overwrite protected world constraints.
            if (!canStampOver(mutable[row][col])) continue;

            const isEdge = isBuildingEdgeCell(footprint.set, localX, localY);
            const isDoor = building.door?.x === localX && building.door?.y === localY;
            const stairCell = stairCellMap.get(`${localX},${localY}`);

            const edge = getEdge(building, localX, localY, footprint.set);

            if (isWalkableStairRole(stairCell?.role)) {
                mutable[row][col] = getStairSymbol(stairCell.direction, building.style);
            } else if (stairCell?.role === 'support') {
                mutable[row][col] = wallSymbol;
            } else if (stairCell?.role === 'landing' || stairCell?.role === 'air') {
                mutable[row][col] = BUILDING_SYMBOLS.floor;
            } else if (isDoor) {
                mutable[row][col] = BUILDING_SYMBOLS.door;
            } else if (isWindowCandidate(building, localX, localY, edge)) {
                mutable[row][col] = getWindowSymbol(building.style, edge);
            } else {
                mutable[row][col] = isEdge ? wallSymbol : BUILDING_SYMBOLS.floor;
            }
    }
    enforceStructuralShellClosure(mutable, building, {
        offsetX,
        offsetY,
        wallSymbol,
        doorSymbol: BUILDING_SYMBOLS.door
    });
}

function createUpperFloorLevels(baseElevation, stories) {
    return Array.from({ length: Math.max(0, stories - 1) }, (_, index) => baseElevation + (index + 1) * 2);
}

function createBuildingFloorLevels(baseElevation, stories) {
    return [
        baseElevation,
        ...createUpperFloorLevels(baseElevation, stories)
    ];
}

function createStructuralFloorLevels(baseElevation, stories) {
    return createBuildingFloorLevels(baseElevation, stories).filter((level) => level > 0);
}

function createStairHeadroomCutoutMap(building, baseElevation, stories) {
    const validation = validateStaircaseRouting(building.stairs || [], {
        baseElevation,
        stories
    });
    const map = new Map();
    for (const cutout of validation.headroomCutouts || []) {
        map.set(`${cutout.x},${cutout.y}`, new Set(cutout.levels || []));
    }
    return map;
}

function hasStairHeadroomCutout(map, x, y, level) {
    return map.get(`${x},${y}`)?.has(level) || false;
}

function getBuildingStairCellMap(building) {
    const map = new Map();
    for (const cell of getBuildingStairCells(building)) {
        const key = `${cell.x},${cell.y}`;
        const existing = map.get(key);
        if (!existing || getStairCellPriority(cell) > getStairCellPriority(existing)) {
            map.set(key, cell);
        }
    }
    return map;
}

function getBuildingStairCells(building) {
    if (Array.isArray(building.stairCells) && building.stairCells.length > 0) {
        return building.stairCells
            .map((cell) => ({
                x: Math.floor(cell.x),
                y: Math.floor(cell.y),
                direction: cell.direction || 'north',
                role: normalizeStairCellRole(cell.role),
                sector: cell.sector,
                module: Math.max(0, Math.floor(cell.module || 0)),
                height: Math.max(0, Math.floor(cell.height || 0)),
                level: Math.max(0, Math.floor(cell.level || 0))
            }))
            .filter((cell) => cell.x >= 0 && cell.y >= 0 && cell.x < building.width && cell.y < building.height);
    }
    return (building.stairs || []).map((stair) => ({
        x: Math.floor(stair.x),
        y: Math.floor(stair.y),
        direction: stair.direction || 'north',
        role: 'stair',
        height: 2,
        level: Math.max(0, Math.floor(stair.level || 0))
    }));
}

function normalizeStairCellRole(role) {
    if (role === 'support') return 'support';
    if (role === 'air') return 'air';
    if (role === 'lower-stair') return 'lower-stair';
    if (role === 'upper-stair') return 'upper-stair';
    return 'stair';
}

function isWalkableStairRole(role) {
    return role === 'stair' || role === 'lower-stair' || role === 'upper-stair';
}

function getStairCellPriority(cell) {
    const level = Math.max(0, Math.floor(cell?.level || 0));
    const height = Math.max(0, Math.floor(cell?.height || 0));
    const rolePriority = {
        air: 0,
        support: 1,
        stair: 2,
        'lower-stair': 3,
        'upper-stair': 4
    }[cell?.role] || 0;
    return level * 100 + height * 10 + rolePriority;
}

function getStoryStairs(building, stories) {
    const baseStair = building.stairs?.[0] || getInteriorStairs(building.width, building.height, getDoorEdge(building), () => 0.25);
    if ((building.stairs || []).length >= stories - 1) {
        const minX = building.width > 2 ? 1 : 0;
        const maxX = building.width > 2 ? building.width - 2 : building.width - 1;
        const minY = building.height > 2 ? 1 : 0;
        const maxY = building.height > 2 ? building.height - 2 : building.height - 1;
        return building.stairs.slice(0, stories - 1).map((stair, level) => ({
            ...stair,
            x: clamp(stair.x, minX, maxX),
            y: clamp(stair.y, minY, maxY),
            level
        }));
    }

    const stairs = [];
    const doorEdge = getDoorEdge(building);
    const landingBias = getLandingBias(doorEdge);
    for (let level = 0; level < stories - 1; level++) {
        const offset = level * 3;
        stairs.push({
            ...baseStair,
            x: clamp(
                baseStair.x + landingBias.x * offset,
                building.width > 2 ? 1 : 0,
                building.width > 2 ? building.width - 2 : building.width - 1
            ),
            y: clamp(
                baseStair.y + landingBias.y * offset,
                building.height > 2 ? 1 : 0,
                building.height > 2 ? building.height - 2 : building.height - 1
            ),
            level
        });
    }
    return stairs;
}

function getLandingBias(doorEdge) {
    return {
        north: { x: 0, y: 1 },
        south: { x: 0, y: -1 },
        west: { x: 1, y: 0 },
        east: { x: -1, y: 0 }
    }[doorEdge] || { x: 0, y: -1 };
}

function getDoorEdge(building) {
    if (!building?.door) return 'south';
    return building.door.edge || getEdge(building, building.door.x, building.door.y, getBuildingFootprint(building).set) || 'south';
}

function stampDoorApproach(mutable, building, offsetX, offsetY) {
    if (!building.door) return;

    const edge = getEdge(building, building.door.x, building.door.y);
    const direction = getEdgeDirection(edge);
    if (!direction) return;

    const doorRow = building.y + building.door.y + offsetY;
    const doorCol = building.x + building.door.x + offsetX;
    const approachRow = doorRow + direction.y;
    const approachCol = doorCol + direction.x;
    if (!mutable[approachRow]?.[approachCol]) return;
    if (!canStampDoorApproach(mutable[approachRow][approachCol])) return;
    mutable[approachRow][approachCol] = BUILDING_SYMBOLS.approach;
}

function isWindowCandidate(building, localX, localY, edge) {
    if (!edge) return false;

    // Preferred path: the wave-function-collapsed facade plan baked at import time
    // (tools/import_world_map_package.mjs resolveFacadeWindows). It is derived purely from the
    // map-data seed, so every client stamps the identical persistent facades.
    if (Array.isArray(building.facadeWindows)) {
        return building.facadeWindows.some((cell) =>
            Math.floor(cell?.[0]) === localX && Math.floor(cell?.[1]) === localY);
    }

    // Legacy fallback for buildings without a baked facade plan: hashed rhythm pattern.
    const isCorner = (localX === 0 || localX === building.width - 1) &&
        (localY === 0 || localY === building.height - 1);
    if (isCorner) return false;
    const along = edge === 'north' || edge === 'south' ? localX : localY;
    const span = edge === 'north' || edge === 'south' ? building.width : building.height;
    if (along <= 0 || along >= span - 1) return false;

    const architecture = building.architectureStyle || building.sourceType || building.style || 'building';
    const hash = hashString(`${building.id}:${architecture}:${building.facadeVariant || 0}:${edge}`);
    const rhythms = architecture === 'tower'
        ? [3, 4, 4]
        : architecture === 'warehouse'
            ? [3, 4, 5]
            : [2, 3, 3, 4];
    const period = rhythms[hash % rhythms.length];
    const offset = Math.floor(hash / 11) % period;
    return (along + offset) % period === 0;
}

function getBuildingFootprint(building) {
    const cells = Array.isArray(building.footprintCells) && building.footprintCells.length > 0
        ? building.footprintCells
            .map((cell) => ({ x: Math.floor(cell.x), y: Math.floor(cell.y) }))
            .filter((cell) => cell.x >= 0 && cell.y >= 0 && cell.x < building.width && cell.y < building.height)
        : Array.from({ length: building.height }, (_, y) =>
            Array.from({ length: building.width }, (_, x) => ({ x, y }))
        ).flat();
    const set = new Set(cells.map((cell) => `${cell.x},${cell.y}`));
    return { cells, set };
}

function isBuildingEdgeCell(cellSet, localX, localY) {
    return !cellSet.has(`${localX},${localY - 1}`) ||
        !cellSet.has(`${localX + 1},${localY}`) ||
        !cellSet.has(`${localX},${localY + 1}`) ||
        !cellSet.has(`${localX - 1},${localY}`);
}

function getEdge(building, localX, localY, footprintSet = null) {
    if (building?.door?.x === localX && building?.door?.y === localY && building.door.edge) return building.door.edge;
    if (footprintSet) {
        const candidates = [
            ['north', `${localX},${localY - 1}`],
            ['east', `${localX + 1},${localY}`],
            ['south', `${localX},${localY + 1}`],
            ['west', `${localX - 1},${localY}`]
        ];
        const exposed = candidates.find(([, key]) => !footprintSet.has(key));
        if (exposed) return exposed[0];
    }
    if (localY === 0) return 'north';
    if (localY === building.height - 1) return 'south';
    if (localX === 0) return 'west';
    if (localX === building.width - 1) return 'east';
    return null;
}

function getEdgeDirection(edge) {
    return {
        north: { x: 0, y: -1 },
        south: { x: 0, y: 1 },
        west: { x: -1, y: 0 },
        east: { x: 1, y: 0 }
    }[edge] || null;
}

function getWindowSymbol(style, edge) {
    const prefix = style === 'stone' ? 'stone' : 'timber';
    const suffix = edge.charAt(0).toUpperCase() + edge.slice(1);
    return BUILDING_SYMBOLS[`${prefix}Window${suffix}`] || BUILDING_SYMBOLS[`${prefix}Wall`];
}

function getStairSymbol(direction = 'north', style = 'stone') {
    const suffix = direction.charAt(0).toUpperCase() + direction.slice(1);
    if (style === 'timber') {
        return BUILDING_SYMBOLS[`timberStairs${suffix}`] || BUILDING_SYMBOLS.stairs;
    }
    return BUILDING_SYMBOLS[`stairs${suffix}`] || BUILDING_SYMBOLS.stairs;
}

function getCenteredDoor(width, height, edge) {
    if (edge === 'north') return { x: Math.floor(width / 2), y: 0 };
    if (edge === 'south') return { x: Math.floor(width / 2), y: height - 1 };
    if (edge === 'west') return { x: 0, y: Math.floor(height / 2) };
    return { x: width - 1, y: Math.floor(height / 2) };
}

function getInteriorStairs(width, height, doorEdge, random) {
    const direction = doorEdge === 'north' ? 'south'
        : doorEdge === 'south' ? 'north'
            : doorEdge === 'west' ? 'east'
                : 'west';
    const x = doorEdge === 'west' ? width - 2
        : doorEdge === 'east' ? 1
            : random() > 0.5 ? 1 : width - 2;
    const y = doorEdge === 'north' ? height - 2
        : doorEdge === 'south' ? 1
            : random() > 0.5 ? 1 : height - 2;
    return { x, y, direction };
}

function seededBuildingRandom(seed) {
    let state = Math.abs(Math.floor(seed)) || 1;
    return () => {
        state = (state * 1103515245 + 12345) % 2147483648;
        return state / 2147483648;
    };
}

function hashString(value) {
    let hash = 2166136261;
    const text = String(value || '');
    for (let i = 0; i < text.length; i++) {
        hash ^= text.charCodeAt(i);
        hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
}

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

function canStampOver(symbol) {
    return ['G', 'F', 'S', 'H', 'R', '.', ':', ';', ',', BUILDING_SYMBOLS.floor].includes(symbol);
}

function canStampDoorApproach(symbol) {
    return ['G', 'F', 'S', 'H', 'R', '.', ':', ';', ','].includes(symbol);
}
