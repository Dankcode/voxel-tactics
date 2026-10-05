export const PARTIAL_CHUNK_SCHEMA = 'vibe-game-partial-baked-chunks';
export const PARTIAL_CHUNK_SCHEMA_VERSION = 2;
export const PARTIAL_CHUNK_ELEVATION_MIN = 0;
export const PARTIAL_CHUNK_ELEVATION_MAX = 6;

const REGISTRY_FIELDS = Object.freeze([
    'schema',
    'schemaVersion',
    'generationVersion',
    'worldContentHash',
    'sampleScale',
    'chunkSize',
    'coreChunkWindow',
    'bakedSettlements',
    'anchors',
    'cells'
]);
const ANCHOR_FIELDS = Object.freeze(['key', 'worldX', 'worldY', 'cellCount']);
const CELL_KEY_PATTERN = /^-?\d+:-?\d+$/;

export function createWorldSampleKey(worldX, worldY, sampleScale) {
    const x = Number(worldX);
    const y = Number(worldY);
    const scale = Number(sampleScale);
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(scale) || scale <= 0) {
        return null;
    }
    return `${Math.round(x / scale)}:${Math.round(y / scale)}`;
}

export function validatePartialChunkRegistry(registry, options = {}) {
    const errors = [];
    const compatibilityErrors = [];
    if (!isRecord(registry)) {
        return {
            valid: false,
            compatible: false,
            errors: ['partialChunkRegistry must be an object.'],
            compatibilityErrors
        };
    }

    rejectUnknownKeys(registry, REGISTRY_FIELDS, 'partialChunkRegistry', errors);
    if (registry.schema !== PARTIAL_CHUNK_SCHEMA) {
        errors.push(`partialChunkRegistry.schema must be ${PARTIAL_CHUNK_SCHEMA}.`);
    }
    if (registry.schemaVersion !== PARTIAL_CHUNK_SCHEMA_VERSION) {
        errors.push(`partialChunkRegistry.schemaVersion must be ${PARTIAL_CHUNK_SCHEMA_VERSION}.`);
    }
    requireString(registry.generationVersion, 'partialChunkRegistry.generationVersion', errors);
    if (!/^[a-f0-9]{64}$/.test(String(registry.worldContentHash || ''))) {
        errors.push('partialChunkRegistry.worldContentHash must be a 64-character lowercase hex digest.');
    }
    requirePositive(registry.sampleScale, 'partialChunkRegistry.sampleScale', errors);
    requirePositiveInteger(registry.chunkSize, 'partialChunkRegistry.chunkSize', errors);
    requirePositiveInteger(registry.coreChunkWindow, 'partialChunkRegistry.coreChunkWindow', errors);
    requireNonNegativeInteger(registry.bakedSettlements, 'partialChunkRegistry.bakedSettlements', errors);

    const anchorKeys = new Set();
    if (!Array.isArray(registry.anchors)) {
        errors.push('partialChunkRegistry.anchors must be an array.');
    } else {
        registry.anchors.forEach((anchor, index) => {
            const path = `partialChunkRegistry.anchors[${index}]`;
            if (!isRecord(anchor)) {
                errors.push(`${path} must be an object.`);
                return;
            }
            rejectUnknownKeys(anchor, ANCHOR_FIELDS, path, errors);
            requireString(anchor.key, `${path}.key`, errors);
            requireFinite(anchor.worldX, `${path}.worldX`, errors);
            requireFinite(anchor.worldY, `${path}.worldY`, errors);
            requirePositiveInteger(anchor.cellCount, `${path}.cellCount`, errors);
            const expectedKey = createWorldSampleKey(anchor.worldX, anchor.worldY, registry.sampleScale);
            if (anchor.key !== expectedKey) errors.push(`${path}.key must match its world coordinate.`);
            if (anchorKeys.has(anchor.key)) errors.push(`${path}.key must be unique.`);
            anchorKeys.add(anchor.key);
        });
        if (registry.bakedSettlements !== registry.anchors.length) {
            errors.push('partialChunkRegistry.bakedSettlements must equal anchors.length.');
        }
    }

    const allowedTileIds = options.allowedTileIds instanceof Set
        ? options.allowedTileIds
        : Array.isArray(options.allowedTileIds)
            ? new Set(options.allowedTileIds)
            : null;
    let cellCount = 0;
    if (!isRecord(registry.cells)) {
        errors.push('partialChunkRegistry.cells must be an object.');
    } else {
        for (const [key, entry] of Object.entries(registry.cells)) {
            cellCount++;
            if (!CELL_KEY_PATTERN.test(key)) errors.push(`partialChunkRegistry.cells.${key} has an invalid key.`);
            if (!Array.isArray(entry) || entry.length !== 2) {
                errors.push(`partialChunkRegistry.cells.${key} must be [tileId, elevation].`);
                continue;
            }
            const [tileId, elevation] = entry;
            requireString(tileId, `partialChunkRegistry.cells.${key}[0]`, errors);
            if (allowedTileIds && !allowedTileIds.has(tileId)) {
                errors.push(`partialChunkRegistry.cells.${key}[0] contains unsupported tile ${tileId}.`);
            }
            if (!Number.isInteger(elevation) ||
                elevation < PARTIAL_CHUNK_ELEVATION_MIN ||
                elevation > PARTIAL_CHUNK_ELEVATION_MAX) {
                errors.push(
                    `partialChunkRegistry.cells.${key}[1] must be an integer from ` +
                    `${PARTIAL_CHUNK_ELEVATION_MIN} to ${PARTIAL_CHUNK_ELEVATION_MAX}.`
                );
            }
        }
    }
    if (registry.anchors?.length && cellCount === 0) {
        errors.push('partialChunkRegistry.cells cannot be empty when anchors are present.');
    }

    compareCompatibility(
        registry.generationVersion,
        options.generationVersion,
        'generationVersion',
        compatibilityErrors
    );
    compareCompatibility(
        registry.worldContentHash,
        options.worldContentHash,
        'worldContentHash',
        compatibilityErrors
    );
    if (Number.isFinite(options.sampleScale) &&
        Math.abs(Number(registry.sampleScale) - Number(options.sampleScale)) > 1e-9) {
        compatibilityErrors.push('sampleScale does not match the active terrain sampler.');
    }
    if (Number.isInteger(options.chunkSize) && registry.chunkSize !== options.chunkSize) {
        compatibilityErrors.push('chunkSize does not match the active terrain solver.');
    }

    return {
        valid: errors.length === 0,
        compatible: errors.length === 0 && compatibilityErrors.length === 0,
        errors,
        compatibilityErrors,
        cellCount,
        anchorCount: Array.isArray(registry.anchors) ? registry.anchors.length : 0
    };
}

export function getPartialChunkCell(registry, field, sampleScale) {
    if (!registry?.cells || !field) return null;
    const key = createWorldSampleKey(field.globalX, field.globalY, sampleScale);
    const entry = key ? registry.cells[key] : null;
    if (!Array.isArray(entry) || entry.length !== 2) return null;
    return {
        key,
        tileId: entry[0],
        elevation: entry[1]
    };
}

function compareCompatibility(actual, expected, field, errors) {
    if (expected === undefined || expected === null) return;
    if (actual !== expected) errors.push(`${field} does not match the active world.`);
}

function rejectUnknownKeys(record, allowed, path, errors) {
    const allowedSet = new Set(allowed);
    for (const key of Object.keys(record)) {
        if (!allowedSet.has(key)) errors.push(`${path}.${key} is not supported.`);
    }
}

function requireString(value, path, errors) {
    if (typeof value !== 'string' || value.length === 0) errors.push(`${path} must be a non-empty string.`);
}

function requireFinite(value, path, errors) {
    if (!Number.isFinite(value)) errors.push(`${path} must be finite.`);
}

function requirePositive(value, path, errors) {
    if (!Number.isFinite(value) || value <= 0) errors.push(`${path} must be positive.`);
}

function requirePositiveInteger(value, path, errors) {
    if (!Number.isInteger(value) || value <= 0) errors.push(`${path} must be a positive integer.`);
}

function requireNonNegativeInteger(value, path, errors) {
    if (!Number.isInteger(value) || value < 0) errors.push(`${path} must be a non-negative integer.`);
}

function isRecord(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
