// Pure environment rules shared by the compile tool (tools/compile_environments.mjs) and the
// runtime lookup (EnvironmentProfiles.js). No data imports: callers pass the authored profiles.

export const ENVIRONMENT_NOISE_CLASSES = Object.freeze(['water', 'wetland', 'trees', 'relief', 'land']);

/**
 * First-match environment resolution over an authored order. `field` is a sampled geographic
 * field ({ land, height, biome, riverInfluence }) or an FMG cell reduced to the same shape.
 */
export function resolveEnvironmentIdFromProfiles(field, profiles, order, biomeNames = []) {
    if (!field || !profiles || !Array.isArray(order) || !order.length) return null;
    const biome = biomeNames[Number(field.biome) || 0] || 'Grassland';
    const land = Number.isFinite(Number(field.land)) ? Number(field.land) : 1;
    const height = Number(field.height) || 0;
    const river = Number(field.riverInfluence) || 0;
    for (const id of order) {
        const match = profiles[id]?.match;
        if (!match) continue;
        if (matchesEnvironment(match, { biome, land, height, river })) return id;
    }
    return order[order.length - 1];
}

function matchesEnvironment(match, { biome, land, height, river }) {
    if (Array.isArray(match.notBiomes) && match.notBiomes.includes(biome)) return false;
    if (Number.isFinite(match.minHeight) && height < match.minHeight) return false;
    if (Number.isFinite(match.maxHeight) && height > match.maxHeight) return false;
    if (Number.isFinite(match.maxLand) && land > match.maxLand) return false;
    const biomeListed = Array.isArray(match.biomes) && match.biomes.length > 0;
    const biomeHit = biomeListed && match.biomes.includes(biome);
    const riverHit = Number.isFinite(match.orMinRiver) && river >= match.orMinRiver;
    if (biomeListed || Number.isFinite(match.orMinRiver)) return biomeHit || riverHit;
    return true;
}

/** Map an 8x8 authored digit mask to numbers in [0, 1]. */
export function parseEnvironmentMask(rows) {
    if (!Array.isArray(rows) || rows.length === 0) throw new Error('environment mask must be a non-empty array');
    const width = String(rows[0]).length;
    return rows.map((row, index) => {
        const text = String(row);
        if (text.length !== width || !/^[0-5]+$/.test(text)) {
            throw new Error(`environment mask row ${index} must be ${width} digits 0-5`);
        }
        return [...text].map((digit) => Number(digit) / 5);
    });
}

export function parseHexColor(value) {
    const text = String(value ?? '').trim().replace(/^#/, '').replace(/^0x/i, '');
    if (!/^[0-9a-f]{6}$/i.test(text)) throw new Error(`invalid hex colour ${value}`);
    return Number.parseInt(text, 16);
}
