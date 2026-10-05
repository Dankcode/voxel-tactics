// Terrain modules used by the geographic WFC layer. These are semantic modules rather than
// rendered assets: each one resolves to an existing tile symbol plus a palette family, while
// adjacency bands keep coastlines, climate transitions, and relief readable.

export const GEOGRAPHIC_TILES = Object.freeze([
    tile('deep-water', 'W', 'coast', -2, 1.15, ['water', 'deep']),
    tile('shallow-water', '~', 'coast', -1, 1.2, ['water', 'shore']),
    tile('wetland', 'G', 'wetland', 0, 0.8, ['land', 'wet', 'shore']),
    tile('sand', 'S', 'coast', 0, 0.9, ['land', 'coast']),
    tile('meadow', 'G', 'meadow', 0, 1.6, ['land', 'temperate']),
    tile('savanna', 'G', 'savanna', 0, 1.0, ['land', 'warm', 'dry']),
    tile('desert', 'S', 'desert', 0, 0.95, ['land', 'hot', 'dry', 'coast']),
    tile('forest', 'F', 'forest', 0, 1.25, ['land', 'temperate', 'trees']),
    tile('jungle', 'F', 'jungle', 0, 0.95, ['land', 'hot', 'wet', 'trees']),
    tile('taiga', 'F', 'taiga', 0, 0.85, ['land', 'cold', 'trees']),
    tile('tundra', 'P', 'tundra', 0, 0.8, ['land', 'cold', 'dry']),
    tile('glacier', 'I', 'alpine', 1, 0.58, ['land', 'cold', 'ice']),
    tile('hill', 'H', 'meadow', 1, 0.9, ['land', 'relief']),
    tile('mountain', 'M', 'alpine', 2, 0.7, ['land', 'relief', 'cold']),
    tile('crystal', 'M', 'crystal', 2, 0.24, ['land', 'relief', 'magic'])
]);

export const GEOGRAPHIC_TILE_BY_ID = new Map(GEOGRAPHIC_TILES.map((entry) => [entry.id, entry]));

export const BIOME_TILE_PRIORS = Object.freeze({
    Marine: Object.freeze(['deep-water', 'shallow-water', 'sand']),
    'Hot desert': Object.freeze(['desert', 'sand', 'savanna', 'hill']),
    'Cold desert': Object.freeze(['tundra', 'desert', 'hill', 'taiga']),
    Savanna: Object.freeze(['savanna', 'meadow', 'desert', 'forest']),
    Grassland: Object.freeze(['meadow', 'savanna', 'forest', 'hill']),
    'Tropical seasonal forest': Object.freeze(['jungle', 'forest', 'savanna', 'wetland']),
    'Temperate deciduous forest': Object.freeze(['forest', 'meadow', 'hill', 'wetland']),
    'Tropical rainforest': Object.freeze(['jungle', 'forest', 'wetland', 'meadow']),
    'Temperate rainforest': Object.freeze(['forest', 'jungle', 'wetland', 'hill']),
    Taiga: Object.freeze(['taiga', 'forest', 'tundra', 'hill']),
    Tundra: Object.freeze(['tundra', 'taiga', 'glacier', 'hill']),
    Glacier: Object.freeze(['glacier', 'tundra', 'mountain', 'taiga']),
    Wetland: Object.freeze(['wetland', 'meadow', 'shallow-water', 'forest'])
});

export function getBiomeName(biomeId, biomeNames = []) {
    return biomeNames[Number(biomeId) || 0] || 'Grassland';
}

export function getTerrainDomain(field, biomeNames = []) {
    const land = clamp01(field?.land);
    const elevation = Number(field?.height) || 0;
    const river = clamp01(field?.riverInfluence);
    const biome = getBiomeName(field?.biome, biomeNames);

    if (land <= 0.22) return ['deep-water', 'shallow-water'];
    if (land <= 0.46) return ['shallow-water', 'sand', 'wetland'];
    if (river >= 0.68) return ['shallow-water', 'wetland', 'sand'];

    const priors = [...(BIOME_TILE_PRIORS[biome] || BIOME_TILE_PRIORS.Grassland)];
    if (land < 0.7) addUnique(priors, 'sand');
    if (river >= 0.28) addUnique(priors, 'wetland');
    if (elevation >= 72) {
        addFirst(priors, 'mountain');
        addUnique(priors, 'crystal');
        addUnique(priors, 'hill');
    } else if (elevation >= 49) {
        addFirst(priors, 'hill');
        addUnique(priors, 'mountain');
    } else if (elevation <= 25 && land < 0.78) {
        addFirst(priors, 'sand');
    }
    return priors.slice(0, 6);
}

export function terrainWaveCompatible(tileAId, tileBId) {
    const a = GEOGRAPHIC_TILE_BY_ID.get(tileAId);
    const b = GEOGRAPHIC_TILE_BY_ID.get(tileBId);
    if (!a || !b) return false;
    if (Math.abs(a.band - b.band) > 1) return false;

    if (a.tags.has('deep') || b.tags.has('deep')) {
        return a.tags.has('water') && b.tags.has('water');
    }
    if (a.tags.has('water') || b.tags.has('water')) {
        const landTile = a.tags.has('water') ? b : a;
        return landTile.tags.has('shore') || landTile.tags.has('coast') || landTile.tags.has('wet');
    }
    if ((a.tags.has('ice') && b.tags.has('hot')) || (b.tags.has('ice') && a.tags.has('hot'))) return false;
    if ((a.tags.has('magic') && b.tags.has('hot')) || (b.tags.has('magic') && a.tags.has('hot'))) return false;
    return true;
}

export function getTerrainWeight(field, tileId, biomeNames = []) {
    const tileSpec = GEOGRAPHIC_TILE_BY_ID.get(tileId);
    if (!tileSpec) return 0;
    const biome = getBiomeName(field?.biome, biomeNames);
    const priors = BIOME_TILE_PRIORS[biome] || BIOME_TILE_PRIORS.Grassland;
    const preferredIndex = priors.indexOf(tileId);
    const land = clamp01(field?.land);
    const elevation = Number(field?.height) || 0;
    const river = clamp01(field?.riverInfluence);
    let weight = tileSpec.weight * (preferredIndex < 0 ? 0.55 : 3.8 / (preferredIndex + 1));

    if (tileSpec.tags.has('water')) weight *= Math.max(0.08, (1 - land) * 6 + river * 2.5);
    else weight *= Math.max(0.1, land * 2.2);
    if (tileId === 'wetland') weight *= 0.7 + river * 4;
    if (tileId === 'sand') weight *= 0.55 + (1 - Math.abs(land - 0.58)) * 2.2;
    if (tileId === 'hill') weight *= 0.55 + proximity(elevation, 58, 24) * 2.6;
    if (tileId === 'mountain') weight *= 0.32 + proximity(elevation, 84, 24) * 4;
    if (tileId === 'crystal') weight *= elevation >= 70 ? 1.3 : 0.08;
    if (tileId === 'glacier') weight *= elevation >= 45 ? 1.4 : 0.35;
    return Math.max(0.0001, weight);
}

function tile(id, symbol, paletteId, band, weight, tags) {
    return Object.freeze({ id, symbol, paletteId, band, weight, tags: new Set(tags) });
}

function addUnique(values, value) {
    if (!values.includes(value)) values.push(value);
}

function addFirst(values, value) {
    const index = values.indexOf(value);
    if (index >= 0) values.splice(index, 1);
    values.unshift(value);
}

function proximity(value, target, radius) {
    return Math.max(0, 1 - Math.abs(value - target) / Math.max(1, radius));
}

function clamp01(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return 0;
    return Math.max(0, Math.min(1, number));
}
