import { ACTIVE_TOWN_VECTORS } from './ActiveTownVectorData.js';
import {
    BURG_THEME_CATALOG,
    BURG_THEME_IDS,
    isBurgThemeId
} from './BurgThemeCatalog.js';

export const TOWN_VECTOR_SCHEMA = 'vibe-game-burg-vectors';
export const TOWN_VECTOR_SCHEMA_VERSION = 3;

const STREET_KINDS = new Set(['dirt', 'main', 'dock']);
const STREET_KIND_PRIORITY = Object.freeze({ dirt: 1, dock: 2, main: 3 });
const STREET_SEGMENT_FORMAT = Object.freeze([
    'y',
    'startX',
    'endX',
    'kind',
    'elevationTier',
    'cellCount'
]);

const VECTOR_BY_BURG_ID = new Map(
    (ACTIVE_TOWN_VECTORS.towns || []).map((town) => [Number(town.burgId), town])
);

export function getActiveTownVector(burgId) {
    return VECTOR_BY_BURG_ID.get(Number(burgId)) || null;
}

export function getActiveTownVectorHash() {
    return String(ACTIVE_TOWN_VECTORS.contentHash || '');
}

export function getActiveTownVectorSummary() {
    return Object.freeze({
        schema: ACTIVE_TOWN_VECTORS.schema,
        schemaVersion: ACTIVE_TOWN_VECTORS.schemaVersion,
        generationVersion: ACTIVE_TOWN_VECTORS.generationVersion,
        contentHash: ACTIVE_TOWN_VECTORS.contentHash,
        themeCatalog: Object.freeze([...(ACTIVE_TOWN_VECTORS.themeCatalog || [])]),
        towns: ACTIVE_TOWN_VECTORS.coverage?.towns || VECTOR_BY_BURG_ID.size,
        themedTowns: (ACTIVE_TOWN_VECTORS.towns || []).filter((town) => isBurgThemeId(town.themeId)).length,
        walls: ACTIVE_TOWN_VECTORS.coverage?.walls || 0,
        streetCells: ACTIVE_TOWN_VECTORS.coverage?.streetCells || 0,
        streetSegments: ACTIVE_TOWN_VECTORS.coverage?.streetSegments || 0,
        buildings: ACTIVE_TOWN_VECTORS.coverage?.buildings || 0
    });
}

export function validateActiveTownVectorSet(payload = ACTIVE_TOWN_VECTORS) {
    const errors = [];
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        return { valid: false, errors: ['townVectors must be an object.'] };
    }
    if (payload.schema !== TOWN_VECTOR_SCHEMA) {
        errors.push(`townVectors.schema must be ${TOWN_VECTOR_SCHEMA}.`);
    }
    if (payload.schemaVersion !== TOWN_VECTOR_SCHEMA_VERSION) {
        errors.push(`townVectors.schemaVersion must be ${TOWN_VECTOR_SCHEMA_VERSION}.`);
    }
    if (!/^[0-9a-f]{64}$/.test(String(payload.contentHash || ''))) {
        errors.push('townVectors.contentHash must be a lowercase SHA-256 hash.');
    }
    validateThemeCatalog(payload.themeCatalog, 'townVectors.themeCatalog', errors);
    if (!Array.isArray(payload.towns)) {
        errors.push('townVectors.towns must be an array.');
    } else {
        const ids = new Set();
        const hashes = new Set();
        for (const [index, town] of payload.towns.entries()) {
            const path = `townVectors.towns[${index}]`;
            if (!Number.isInteger(town?.burgId) || town.burgId < 1) {
                errors.push(`${path}.burgId must be a positive integer.`);
            } else if (ids.has(town.burgId)) {
                errors.push(`${path}.burgId is duplicated.`);
            } else {
                ids.add(town.burgId);
            }
            if (!isBurgThemeId(town?.themeId)) {
                errors.push(`${path}.themeId must be a canonical burg theme ID.`);
            }
            if (!/^[0-9a-f]{64}$/.test(String(town?.vectorHash || ''))) {
                errors.push(`${path}.vectorHash must be a lowercase SHA-256 hash.`);
            } else {
                hashes.add(town.vectorHash);
            }
            if (!Number.isInteger(town?.grid?.width) || !Number.isInteger(town?.grid?.height)) {
                errors.push(`${path}.grid must have integer width and height.`);
            }
            if (!Array.isArray(town?.walls?.contours) || !Array.isArray(town?.walls?.gates)) {
                errors.push(`${path}.walls must contain contours and gates.`);
            }
            validateStreetVectors(town?.streetVectors, town?.grid, `${path}.streetVectors`, errors);
            if (!Array.isArray(town?.buildings)) errors.push(`${path}.buildings must be an array.`);
        }
        if (hashes.size !== payload.towns.length) {
            errors.push('townVectors must use a unique vectorHash for every burg.');
        }
    }
    return { valid: errors.length === 0, errors };
}

export function projectTownVector(town, {
    centerCol = 0,
    centerRow = 0,
    width = 0,
    height = 0,
    margin = 2,
    maximumScale = 1
} = {}) {
    if (!town || width <= 0 || height <= 0) return null;
    const sourceBounds = normalizeBounds(town.bounds, town.grid);
    const sourceWidth = Math.max(1, sourceBounds.maxX - sourceBounds.minX);
    const sourceHeight = Math.max(1, sourceBounds.maxY - sourceBounds.minY);
    const safeMargin = clampInteger(margin, 1, Math.max(1, Math.floor(Math.min(width, height) / 4)));
    const scale = Math.max(0.25, Math.min(
        Math.max(0.25, Number(maximumScale) || 1),
        Math.max(1, width - safeMargin * 2) / sourceWidth,
        Math.max(1, height - safeMargin * 2) / sourceHeight
    ));
    const sourceCenterX = (sourceBounds.minX + sourceBounds.maxX) / 2;
    const sourceCenterY = (sourceBounds.minY + sourceBounds.maxY) / 2;
    // At 1:1 the source grid must land on whole cells. An odd-sized bounds box would otherwise
    // shift everything by half a cell, and wall contours rasterised at cell centres would then
    // disagree with gate and street cells (dropping wall cells beside gates, losing the gates).
    const offsetX = scale === 1 ? Math.round(centerCol - sourceCenterX) : centerCol - sourceCenterX * scale;
    const offsetY = scale === 1 ? Math.round(centerRow - sourceCenterY) : centerRow - sourceCenterY * scale;
    const transformPoint = ([x, y]) => [
        offsetX + Number(x) * scale,
        offsetY + Number(y) * scale
    ];
    const projectedContours = (town.walls?.contours || [])
        .map((contour) => contour.map(transformPoint))
        .filter((contour) => contour.length >= 4);
    const projectedBounds = clipBounds({
        minCol: Math.floor(centerCol - sourceWidth * scale / 2),
        minRow: Math.floor(centerRow - sourceHeight * scale / 2),
        maxCol: Math.ceil(centerCol + sourceWidth * scale / 2) - 1,
        maxRow: Math.ceil(centerRow + sourceHeight * scale / 2) - 1
    }, width, height);
    const wallCells = rasterizeEvenOddContours(projectedContours, projectedBounds);
    const gateCells = dedupeCells((town.walls?.gates || []).map((gate) => {
        const [x, y] = transformPoint(gate);
        return {
            col: clampInteger(Math.floor(x), 0, width - 1),
            row: clampInteger(Math.floor(y), 0, height - 1)
        };
    }));
    const gateKeys = new Set(gateCells.map((cell) => gridKey(cell.col, cell.row)));
    const visibleWallCells = wallCells.filter((cell) => !gateKeys.has(gridKey(cell.col, cell.row)));
    const barrierKeys = new Set([
        ...visibleWallCells.map((cell) => gridKey(cell.col, cell.row)),
        ...gateKeys
    ]);
    const insideCellKeys = fillVectorInterior(projectedBounds, barrierKeys);
    const streetCells = projectStreetVectors(town.streetVectors, {
        transformPoint,
        width,
        height
    });
    const buildings = (town.buildings || [])
        .map((building) => projectBuildingVector(building, {
            transformPoint,
            bounds: projectedBounds,
            width,
            height,
            scale
        }))
        .filter(Boolean)
        .sort((left, right) => left.id.localeCompare(right.id));

    return Object.freeze({
        burgId: town.burgId,
        themeId: town.themeId,
        vectorHash: town.vectorHash,
        scale,
        bounds: Object.freeze(projectedBounds),
        wallHeightVoxels: clampInteger(town.walls?.heightVoxels, 1, 16),
        walkwayWidth: clampInteger(town.walls?.walkwayWidth, 1, 6),
        wallCells: Object.freeze(visibleWallCells.map(Object.freeze)),
        wallCellKeys: new Set(visibleWallCells.map((cell) => gridKey(cell.col, cell.row))),
        gateCells: Object.freeze(gateCells.map(Object.freeze)),
        gateCellKeys: gateKeys,
        insideCellKeys,
        streetCells: Object.freeze(streetCells.map(Object.freeze)),
        streetCellKeys: new Set(streetCells.map((cell) => gridKey(cell.col, cell.row))),
        buildings: Object.freeze(buildings)
    });
}

function validateThemeCatalog(catalog, path, errors) {
    if (!Array.isArray(catalog)) {
        errors.push(`${path} must be an array.`);
        return;
    }
    const ids = new Set();
    for (const [index, entry] of catalog.entries()) {
        const entryPath = `${path}[${index}]`;
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
            errors.push(`${entryPath} must be an object.`);
            continue;
        }
        if (!isBurgThemeId(entry.id)) errors.push(`${entryPath}.id must be a canonical burg theme ID.`);
        if (ids.has(entry.id)) errors.push(`${entryPath}.id is duplicated.`);
        ids.add(entry.id);
        const expected = BURG_THEME_CATALOG[entry.id];
        if (entry.label !== expected?.label) errors.push(`${entryPath}.label must match the shared burg theme catalog.`);
        if (entry.streetPaletteId !== expected?.streetPaletteId) {
            errors.push(`${entryPath}.streetPaletteId must match the shared burg theme catalog.`);
        }
        if (entry.wallTextureId !== expected?.wallTextureId) {
            errors.push(`${entryPath}.wallTextureId must match the shared burg theme catalog.`);
        }
    }
    for (const themeId of BURG_THEME_IDS) {
        if (!ids.has(themeId)) errors.push(`${path} is missing ${themeId}.`);
    }
}

function validateStreetVectors(streetVectors, grid, path, errors) {
    if (!streetVectors || typeof streetVectors !== 'object' || Array.isArray(streetVectors)) {
        errors.push(`${path} must be an object.`);
        return;
    }
    if (!Array.isArray(streetVectors.segments)) {
        errors.push(`${path}.segments must be an array.`);
        return;
    }
    if (!Array.isArray(streetVectors.segmentFormat) ||
        streetVectors.segmentFormat.join(',') !== STREET_SEGMENT_FORMAT.join(',')) {
        errors.push(`${path}.segmentFormat must describe the compact horizontal segment tuple.`);
    }
    if (!Number.isInteger(streetVectors.sourceCellCount) || streetVectors.sourceCellCount < 0) {
        errors.push(`${path}.sourceCellCount must be a non-negative integer.`);
    }
    if (streetVectors.sourceCellCount > 0) {
        if (!Number.isFinite(streetVectors.elevationMin) || !Number.isFinite(streetVectors.elevationMax) ||
            streetVectors.elevationMin > streetVectors.elevationMax) {
            errors.push(`${path} must have ordered finite elevationMin/elevationMax values.`);
        }
    } else if (streetVectors.elevationMin !== null || streetVectors.elevationMax !== null) {
        errors.push(`${path} must use null elevation bounds when it has no source cells.`);
    }

    const cellKeys = new Set();
    let segmentCellCount = 0;
    for (const [index, segment] of streetVectors.segments.entries()) {
        const segmentPath = `${path}.segments[${index}]`;
        if (!Array.isArray(segment) || segment.length !== STREET_SEGMENT_FORMAT.length) {
            errors.push(`${segmentPath} must follow streetVectors.segmentFormat.`);
            continue;
        }
        const [y, startX, endX, kind, elevationTier, cellCount] = segment;
        if (!Number.isInteger(y) || !Number.isInteger(startX) ||
            !Number.isInteger(endX) || startX > endX ||
            y < 0 || y >= Number(grid?.height || 0) ||
            startX < 0 || endX >= Number(grid?.width || 0)) {
            errors.push(`${segmentPath} must define an in-bounds horizontal run.`);
            continue;
        }
        if (!STREET_KINDS.has(kind)) {
            errors.push(`${segmentPath}.kind must be dirt, main, or dock.`);
        }
        if (!Number.isInteger(elevationTier) || elevationTier < 0 || elevationTier > 6) {
            errors.push(`${segmentPath}.elevationTier must be an integer from 0 to 6.`);
        }
        const expectedCount = endX - startX + 1;
        if (cellCount !== expectedCount) {
            errors.push(`${segmentPath}.cellCount must equal ${expectedCount}.`);
        }
        segmentCellCount += expectedCount;
        for (let x = startX; x <= endX; x++) {
            const key = gridKey(x, y);
            if (cellKeys.has(key)) errors.push(`${segmentPath} overlaps another street segment at ${key}.`);
            cellKeys.add(key);
        }
    }
    if (segmentCellCount !== streetVectors.sourceCellCount ||
        cellKeys.size !== streetVectors.sourceCellCount) {
        errors.push(`${path}.sourceCellCount must match its unique segment cells.`);
    }
}

function projectStreetVectors(streetVectors, { transformPoint, width, height }) {
    const cells = new Map();
    for (const segment of Array.isArray(streetVectors?.segments) ? streetVectors.segments : []) {
        if (!Array.isArray(segment) || segment.length < 5) continue;
        const [sourceY, startX, endX, sourceKind, sourceElevationTier] = segment;
        for (let sourceX = startX; sourceX <= endX; sourceX++) {
            const [projectedX, projectedY] = transformPoint([sourceX + 0.5, sourceY + 0.5]);
            const col = Math.floor(projectedX);
            const row = Math.floor(projectedY);
            if (col < 0 || row < 0 || col >= width || row >= height) continue;
            const candidate = {
                col,
                row,
                kind: STREET_KINDS.has(sourceKind) ? sourceKind : 'dirt',
                elevationTier: clampInteger(sourceElevationTier, 0, 6),
                source: 'town-vector'
            };
            const key = gridKey(col, row);
            const current = cells.get(key);
            if (!current || compareProjectedStreetCells(candidate, current) > 0) cells.set(key, candidate);
        }
    }
    return [...cells.values()].sort((left, right) =>
        left.row - right.row || left.col - right.col ||
        right.elevationTier - left.elevationTier || left.kind.localeCompare(right.kind));
}

function compareProjectedStreetCells(left, right) {
    return Number(STREET_KIND_PRIORITY[left.kind] || 0) - Number(STREET_KIND_PRIORITY[right.kind] || 0) ||
        left.elevationTier - right.elevationTier || right.kind.localeCompare(left.kind);
}

function projectBuildingVector(building, context) {
    if (!Array.isArray(building?.polygon) || building.polygon.length < 4) return null;
    const polygon = building.polygon.map(context.transformPoint);
    const sourceRect = building.gridRect || {
        x: Math.min(...building.polygon.map((point) => point[0])),
        y: Math.min(...building.polygon.map((point) => point[1])),
        width: Math.max(...building.polygon.map((point) => point[0])) -
            Math.min(...building.polygon.map((point) => point[0])),
        height: Math.max(...building.polygon.map((point) => point[1])) -
            Math.min(...building.polygon.map((point) => point[1]))
    };
    const center = context.transformPoint([
        sourceRect.x + sourceRect.width / 2,
        sourceRect.y + sourceRect.height / 2
    ]);
    let footprintWidth = Math.max(4, Math.round(sourceRect.width * context.scale));
    let footprintHeight = Math.max(4, Math.round(sourceRect.height * context.scale));
    if (Math.min(footprintWidth - 2, footprintHeight - 2) < 2 ||
        Math.max(footprintWidth - 2, footprintHeight - 2) < 3) {
        if (footprintWidth >= footprintHeight) footprintWidth = Math.max(footprintWidth, 5);
        else footprintHeight = Math.max(footprintHeight, 5);
    }
    footprintWidth = Math.min(13, footprintWidth);
    footprintHeight = Math.min(13, footprintHeight);
    const rect = fitRectInsideBounds({
        minCol: Math.round(center[0] - footprintWidth / 2),
        minRow: Math.round(center[1] - footprintHeight / 2),
        width: footprintWidth,
        height: footprintHeight
    }, context.bounds);
    if (!rect || rect.width < 4 || rect.height < 4 ||
        Math.min(rect.width - 2, rect.height - 2) < 2 ||
        Math.max(rect.width - 2, rect.height - 2) < 3) return null;
    const sourceDoorEdge = getSourceDoorEdge(building.door, sourceRect);
    const projectedDoor = context.transformPoint([
        Number(building.door?.[0] ?? sourceRect.x + sourceRect.width / 2) + 0.5,
        Number(building.door?.[1] ?? sourceRect.y + sourceRect.height - 1) + 0.5
    ]);
    const door = snapDoorToRect(projectedDoor, rect, sourceDoorEdge);
    const stairs = (building.stairs || []).map((point, index) => {
        const projected = context.transformPoint([Number(point[0]) + 0.5, Number(point[1]) + 0.5]);
        return {
            x: clampInteger(Math.floor(projected[0]) - rect.minCol, 1, Math.max(1, rect.width - 2)),
            y: clampInteger(Math.floor(projected[1]) - rect.minRow, 1, Math.max(1, rect.height - 2)),
            direction: oppositeEdge(sourceDoorEdge),
            level: index
        };
    }).slice(0, Math.max(0, Number(building.floors || 1) - 1));
    const footprintCells = [];
    for (let y = 0; y < rect.height; y++) {
        for (let x = 0; x < rect.width; x++) footprintCells.push(Object.freeze({ x, y }));
    }
    return Object.freeze({
        ...building,
        sourcePolygon: Object.freeze(polygon.map((point) => Object.freeze(point))),
        minCol: rect.minCol,
        minRow: rect.minRow,
        width: rect.width,
        height: rect.height,
        footprintCells: Object.freeze(footprintCells),
        door: Object.freeze(door),
        stairs: Object.freeze(stairs.map(Object.freeze))
    });
}

function rasterizeEvenOddContours(contours, bounds) {
    const cells = [];
    for (let row = bounds.minRow; row <= bounds.maxRow; row++) {
        for (let col = bounds.minCol; col <= bounds.maxCol; col++) {
            const point = [col + 0.5, row + 0.5];
            const crossings = contours.reduce((count, polygon) =>
                count + Number(pointInPolygon(point, polygon)), 0);
            if (crossings % 2 === 1) cells.push({ col, row });
        }
    }
    return cells;
}

function fillVectorInterior(bounds, barrierKeys) {
    if (!barrierKeys.size) return new Set();
    const exterior = new Set();
    const queue = [];
    const enqueue = (col, row) => {
        if (col < bounds.minCol || row < bounds.minRow || col > bounds.maxCol || row > bounds.maxRow) return;
        const key = gridKey(col, row);
        if (barrierKeys.has(key) || exterior.has(key)) return;
        exterior.add(key);
        queue.push({ col, row });
    };
    for (let col = bounds.minCol; col <= bounds.maxCol; col++) {
        enqueue(col, bounds.minRow);
        enqueue(col, bounds.maxRow);
    }
    for (let row = bounds.minRow; row <= bounds.maxRow; row++) {
        enqueue(bounds.minCol, row);
        enqueue(bounds.maxCol, row);
    }
    while (queue.length) {
        const cell = queue.shift();
        enqueue(cell.col + 1, cell.row);
        enqueue(cell.col - 1, cell.row);
        enqueue(cell.col, cell.row + 1);
        enqueue(cell.col, cell.row - 1);
    }
    const inside = new Set();
    for (let row = bounds.minRow; row <= bounds.maxRow; row++) {
        for (let col = bounds.minCol; col <= bounds.maxCol; col++) {
            const key = gridKey(col, row);
            if (!barrierKeys.has(key) && !exterior.has(key)) inside.add(key);
        }
    }
    return inside;
}

function snapDoorToRect([projectedX, projectedY], rect, edge) {
    const localX = clampInteger(Math.floor(projectedX) - rect.minCol, 0, rect.width - 1);
    const localY = clampInteger(Math.floor(projectedY) - rect.minRow, 0, rect.height - 1);
    if (edge === 'north') return { x: clampInteger(localX, 1, rect.width - 2), y: 0, edge };
    if (edge === 'east') return { x: rect.width - 1, y: clampInteger(localY, 1, rect.height - 2), edge };
    if (edge === 'west') return { x: 0, y: clampInteger(localY, 1, rect.height - 2), edge };
    return { x: clampInteger(localX, 1, rect.width - 2), y: rect.height - 1, edge: 'south' };
}

function getSourceDoorEdge(door, rect) {
    const x = Number(door?.[0]);
    const y = Number(door?.[1]);
    const distances = [
        { edge: 'north', value: Math.abs(y - rect.y) },
        { edge: 'east', value: Math.abs(x - (rect.x + rect.width - 1)) },
        { edge: 'south', value: Math.abs(y - (rect.y + rect.height - 1)) },
        { edge: 'west', value: Math.abs(x - rect.x) }
    ];
    return distances.sort((left, right) => left.value - right.value ||
        ['north', 'east', 'south', 'west'].indexOf(left.edge) -
        ['north', 'east', 'south', 'west'].indexOf(right.edge))[0].edge;
}

function oppositeEdge(edge) {
    return ({ north: 'south', east: 'west', south: 'north', west: 'east' })[edge] || 'north';
}

function pointInPolygon([x, y], polygon) {
    let inside = false;
    for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index++) {
        const [xi, yi] = polygon[index];
        const [xj, yj] = polygon[previous];
        const intersects = ((yi > y) !== (yj > y)) &&
            (x < (xj - xi) * (y - yi) / ((yj - yi) || Number.EPSILON) + xi);
        if (intersects) inside = !inside;
    }
    return inside;
}

function fitRectInsideBounds(rect, bounds) {
    const width = Math.min(rect.width, bounds.maxCol - bounds.minCol + 1);
    const height = Math.min(rect.height, bounds.maxRow - bounds.minRow + 1);
    if (width <= 0 || height <= 0) return null;
    return {
        minCol: clampInteger(rect.minCol, bounds.minCol, bounds.maxCol - width + 1),
        minRow: clampInteger(rect.minRow, bounds.minRow, bounds.maxRow - height + 1),
        width,
        height
    };
}

function normalizeBounds(bounds, grid) {
    return {
        minX: clampNumber(bounds?.minX, 0, grid?.width || 1),
        minY: clampNumber(bounds?.minY, 0, grid?.height || 1),
        maxX: clampNumber(bounds?.maxX, 0, grid?.width || 1),
        maxY: clampNumber(bounds?.maxY, 0, grid?.height || 1)
    };
}

function clipBounds(bounds, width, height) {
    const minCol = clampInteger(bounds.minCol, 0, width - 1);
    const minRow = clampInteger(bounds.minRow, 0, height - 1);
    const maxCol = clampInteger(bounds.maxCol, minCol, width - 1);
    const maxRow = clampInteger(bounds.maxRow, minRow, height - 1);
    return {
        minCol,
        minRow,
        maxCol,
        maxRow,
        width: maxCol - minCol + 1,
        height: maxRow - minRow + 1
    };
}

function dedupeCells(cells) {
    return [...new Map(cells.map((cell) => [gridKey(cell.col, cell.row), cell])).values()]
        .sort((left, right) => left.row - right.row || left.col - right.col);
}

function gridKey(col, row) {
    return `${col},${row}`;
}

function clampInteger(value, minimum, maximum) {
    const number = Number(value);
    return Math.min(maximum, Math.max(minimum, Number.isFinite(number) ? Math.floor(number) : minimum));
}

function clampNumber(value, minimum, maximum) {
    const number = Number(value);
    return Math.min(maximum, Math.max(minimum, Number.isFinite(number) ? number : minimum));
}
