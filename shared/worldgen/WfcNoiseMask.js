// World-anchored noise layered over fixed, authored masks. The masks are deliberately data,
// rather than a render texture: the same values can constrain the terrain WFC and decorate an
// enterable room without a browser-only image read or viewport-dependent sampling.
//
// v3: outside settlements every overworld sample carries an environment (EnvironmentProfiles).
// Each environment brings its own authored mask, noise scales, optional directional stripe,
// class bias table and tile preferences, and each state rotates/mirrors that mask and nudges the
// class biases, so the same savanna reads differently in Shaia and in Acia.
//
// v4: masks are 16x16 at scale 5-7 (repeat every 80-112 cells, wider than a view) and each
// environment has three facies picked by a low-frequency region noise, so one environment shows
// several landscapes across a region instead of one repeating motif.

import {
    getEnvironmentProfile,
    getStateEnvironmentFlavor
} from './EnvironmentProfiles.js';
import { affinityWeight, sampleNoiseField } from './NoiseField.js';

export const WFC_NOISE_MASK_VERSION = 'environment-wfc-noise-mask-v5';

const STATIC_MASKS = Object.freeze({
    overworld: Object.freeze([
        '24312031',
        '13423142',
        '32134213',
        '41241324',
        '23132431',
        '14203142',
        '32414203',
        '01324312'
    ]),
    interior: Object.freeze([
        '12321',
        '23432',
        '34543',
        '23432',
        '12321'
    ]),
    room: Object.freeze([
        '24132',
        '13241',
        '42314',
        '31423',
        '23142'
    ])
});

const TERRAIN_NOISE_BIAS = Object.freeze({
    water: Object.freeze({ low: 4.2, high: 0.24 }),
    wetland: Object.freeze({ low: 0.3, high: 3.7 }),
    trees: Object.freeze({ low: 0.24, high: 4.2 }),
    relief: Object.freeze({ low: 0.42, high: 3.1 }),
    land: Object.freeze({ low: 0.32, high: 3.4 })
});

/**
 * Read one deterministic static-mask/noise sample. `x` and `y` are world grid coordinates,
 * so overlapping WFC frames and individual building rooms always resolve the same value.
 */
export function sampleWfcNoiseMask({
    mapId = 'overworld',
    x = 0,
    y = 0,
    seed = 'wfc-noise',
    environmentId = null,
    stateId = null
} = {}) {
    const environment = mapId === 'overworld' && environmentId ? getEnvironmentProfile(environmentId) : null;
    if (environment) return sampleEnvironmentMask(environment, { x, y, seed, stateId });
    const resolvedMapId = STATIC_MASKS[mapId] ? mapId : 'overworld';
    const mask = STATIC_MASKS[resolvedMapId];
    const gridX = Math.floor(Number(x) || 0);
    const gridY = Math.floor(Number(y) || 0);
    const maskRow = mask[positiveModulo(gridY, mask.length)];
    const staticValue = Number(maskRow[positiveModulo(gridX, maskRow.length)]) / 5;
    const noise = fractalUnit(gridX, gridY, `${seed}:${resolvedMapId}`);
    const value = clamp01(staticValue * 0.62 + noise * 0.38);
    const channels = sampleNoiseField({ x: gridX, y: gridY, seed, field: resolvedMapId });
    return Object.freeze({
        mapId: resolvedMapId,
        x: gridX,
        y: gridY,
        seed: String(seed),
        staticValue,
        noise,
        value,
        channels
    });
}

/** Static masks are soft WFC priors; authored vectors, water and baked chunk cells still win. */
export function getTerrainNoiseWeightMultiplier(sample, tileSpec) {
    const value = clamp01(sample?.value);
    const tags = tileSpec?.tags instanceof Set ? tileSpec.tags : new Set(tileSpec?.tags || []);
    const environment = sample?.environmentId ? getEnvironmentProfile(sample.environmentId) : null;
    if (environment) return getEnvironmentWeightMultiplier(environment, sample, tileSpec, tags, value);
    const bias = tags.has('water')
        ? TERRAIN_NOISE_BIAS.water
        : tags.has('wet')
            ? TERRAIN_NOISE_BIAS.wetland
            : tags.has('trees')
                ? TERRAIN_NOISE_BIAS.trees
                : tags.has('relief')
                    ? TERRAIN_NOISE_BIAS.relief
                    : TERRAIN_NOISE_BIAS.land;
    // A class-only multiplier cancels whenever an entropy decision contains only
    // meadow/savanna/sand (or any other one tag class). Give every tile a stable,
    // world-anchored offset as well, so the mask can influence those decisions.
    // The seed is the selected world variant, making Regenerate alter organic
    // terrain while source vectors, hard water and baked cells retain precedence.
    const tileValue = fractalUnit(
        Math.floor(Number(sample?.x) || 0),
        Math.floor(Number(sample?.y) || 0),
        `${sample?.seed || 'wfc-noise'}:tile:${tileSpec?.id || 'unknown'}`
    );
    const classMultiplier = bias.low + (bias.high - bias.low) * value;
    const tileMultiplier = 0.25 + tileValue * 3.5;
    return classMultiplier * tileMultiplier * affinityWeight(tileSpec?.affinity, sample?.channels);
}

function sampleEnvironmentMask(environment, { x, y, seed, stateId }) {
    const flavor = getStateEnvironmentFlavor(stateId);
    const gridX = Math.floor(Number(x) || 0);
    const gridY = Math.floor(Number(y) || 0);
    const noiseSeed = `${seed}:env:${environment.id}:${Number(stateId) || 0}`;
    // The seed is the world variant: Regenerate slides the authored mask to a new origin, so the
    // environment keeps its shape language (dunes stay dunes) while the features themselves move.
    const facies = pickFacies(environment, gridX, gridY, noiseSeed);
    const primaryMask = facies?.primary.mask || environment.mask;
    const span = primaryMask.length * environment.noise.maskScale;
    const shiftX = Math.floor(hashUnit(0, 0, `${noiseSeed}:shift-x`) * span);
    const shiftY = Math.floor(hashUnit(0, 0, `${noiseSeed}:shift-y`) * span);
    let staticValue = sampleAuthoredMask(
        primaryMask, gridX + shiftX, gridY + shiftY, environment.noise.maskScale, flavor
    );
    if (facies?.secondary && facies.blend > 0) {
        // Blend into the neighbouring facies across a soft border instead of a hard seam.
        const secondaryValue = sampleAuthoredMask(
            facies.secondary.mask, gridX + shiftX, gridY + shiftY, environment.noise.maskScale, flavor
        );
        staticValue += (secondaryValue - staticValue) * facies.blend;
    }
    const [coarse, medium, fine] = environment.noise.scales;
    const [coarseWeight, mediumWeight, fineWeight] = environment.noise.weights;
    const weightTotal = coarseWeight + mediumWeight + fineWeight || 1;
    const noise = clamp01((
        smoothHash(gridX / coarse, gridY / coarse, `${noiseSeed}:coarse`) * coarseWeight +
        smoothHash(gridX / medium, gridY / medium, `${noiseSeed}:medium`) * mediumWeight +
        smoothHash(gridX / fine, gridY / fine, `${noiseSeed}:fine`) * fineWeight
    ) / weightTotal);
    let stripe = 0;
    const stripeSpec = environment.noise.stripe;
    if (stripeSpec) {
        // Directional banding (dune crests, wind streaks, moraine ranks), bent by the coarse noise
        // so the bands wander instead of ruling straight lines across the map.
        const angle = (Number(stripeSpec.angleDeg) || 0) * Math.PI / 180 + (flavor.maskRotation * Math.PI / 2);
        const along = gridX * Math.cos(angle) + gridY * Math.sin(angle);
        const bend = (smoothHash(gridX / coarse, gridY / coarse, `${noiseSeed}:bend`) - 0.5) * Math.PI;
        const phase = hashUnit(0, 0, `${noiseSeed}:stripe-phase`) * Math.PI * 2;
        const faciesStripe = facies ? facies.primary.stripeMul + ((facies.secondary?.stripeMul ?? 1) - facies.primary.stripeMul) * facies.blend : 1;
        stripe = Math.sin((along / Math.max(1, stripeSpec.period)) * Math.PI * 2 + bend + phase) *
            (Number(stripeSpec.amp) || 0) * faciesStripe;
    }
    const staticWeight = environment.noise.staticWeight;
    const value = clamp01(staticValue * staticWeight + noise * (1 - staticWeight) + stripe);
    const channels = sampleNoiseField({
        x: gridX, y: gridY, seed, environmentId: environment.id,
        faciesId: facies?.primary.id ?? null, stateId, field: 'overworld'
    });
    return Object.freeze({
        mapId: 'overworld',
        environmentId: environment.id,
        faciesId: facies?.primary.id ?? null,
        stateId: Number(stateId) || 0,
        x: gridX,
        y: gridY,
        seed: String(seed),
        staticValue,
        noise,
        stripe,
        value,
        channels
    });
}

const FACIES_BLEND_BAND = 0.12;

/**
 * Facies (sub-environments) are chosen per cell by competing low-frequency noise fields, one per
 * facies, scaled by the facies weight: the highest wins, so regions come out as organic Voronoi-like
 * patches roughly regionScale cells across. Coordinates are domain-warped so borders meander.
 */
function pickFacies(environment, x, y, noiseSeed) {
    const list = environment.facies;
    if (!Array.isArray(list) || list.length === 0) return null;
    const scale = environment.noise.regionScale || 56;
    const warpX = (smoothHash(x / (scale * 0.45), y / (scale * 0.45), `${noiseSeed}:facies-warp-x`) - 0.5) * scale * 0.7;
    const warpY = (smoothHash(x / (scale * 0.45), y / (scale * 0.45), `${noiseSeed}:facies-warp-y`) - 0.5) * scale * 0.7;
    let primary = null;
    let secondary = null;
    for (const [index, entry] of list.entries()) {
        // Each facies field runs on its own rotated lattice; argmax over fields sharing one lattice
        // leaves axis-aligned borders.
        const angle = 0.61 + index * 1.13;
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);
        const px = x + warpX;
        const py = y + warpY;
        const wx = (px * cos - py * sin) / scale + index * 17.3;
        const wy = (px * sin + py * cos) / scale - index * 9.1;
        const score = (smoothHash(wx, wy, `${noiseSeed}:facies:${entry.id}`) * 0.75 +
            smoothHash(wx * 2.1, wy * 2.1, `${noiseSeed}:facies-detail:${entry.id}`) * 0.25) * entry.weight;
        if (!primary || score > primary.score) {
            secondary = primary;
            primary = { entry, score };
        } else if (!secondary || score > secondary.score) {
            secondary = { entry, score };
        }
    }
    const gap = secondary ? primary.score - secondary.score : Infinity;
    const blend = gap < FACIES_BLEND_BAND ? 0.5 * (1 - gap / FACIES_BLEND_BAND) : 0;
    return { primary: primary.entry, secondary: secondary?.entry ?? null, blend };
}

export function getEnvironmentFacies(environment, faciesId) {
    if (!environment || !faciesId) return null;
    return environment.facies?.find((entry) => entry.id === faciesId) || null;
}

function getEnvironmentWeightMultiplier(environment, sample, tileSpec, tags, value) {
    // Trees before wet: jungle is tagged both, and in an environment table it is canopy first.
    const className = tags.has('water')
        ? 'water'
        : tags.has('trees')
            ? 'trees'
            : tags.has('wet')
                ? 'wetland'
                : tags.has('relief')
                    ? 'relief'
                    : 'land';
    const facies = getEnvironmentFacies(environment, sample.faciesId);
    const [low, high] = environment.classBias[className] || [1, 1];
    const nudge = (getStateEnvironmentFlavor(sample.stateId).classNudge?.[className] ?? 1) *
        (facies?.classBiasMul?.[className] ?? 1);
    // Interpolate in log space so a [0.3, 6] range is symmetric around its geometric mean.
    const classMultiplier = Math.exp(Math.log(low) + (Math.log(high) - Math.log(low)) * value) * nudge;
    const preference = interpolatePreference(
        facies?.tilePrefs?.[tileSpec?.id] ?? environment.tilePrefs?.[tileSpec?.id],
        value
    );
    // Narrower per-tile jitter than v2: the environment shape carries the signal, the jitter
    // only separates same-class ties and keeps Regenerate meaningful.
    const tileValue = fractalUnit(
        Math.floor(Number(sample?.x) || 0),
        Math.floor(Number(sample?.y) || 0),
        `${sample?.seed || 'wfc-noise'}:tile:${tileSpec?.id || 'unknown'}`
    );
    return classMultiplier * preference * (0.65 + tileValue * 0.8) * affinityWeight(tileSpec?.affinity, sample?.channels);
}

// Tile preference is either a constant or [atLow, atHigh]. The pair form is the intra-class
// axis: sand and desert share the `land` class, so only a value-dependent preference can put
// sand on the dune crests and desert in the pans.
function interpolatePreference(preference, value) {
    if (Array.isArray(preference)) {
        const [low, high] = preference;
        return Math.exp(Math.log(low) + (Math.log(high) - Math.log(low)) * value);
    }
    return Number.isFinite(preference) ? preference : 1;
}

function sampleAuthoredMask(mask, x, y, scale, flavor) {
    const size = mask.length;
    const fx = x / scale;
    const fy = y / scale;
    const x0 = Math.floor(fx);
    const y0 = Math.floor(fy);
    const tx = smoothStep(fx - x0);
    const ty = smoothStep(fy - y0);
    const read = (mx, my) => {
        let u = positiveModulo(mx, size);
        let v = positiveModulo(my, size);
        if (flavor.mirror) u = size - 1 - u;
        for (let turn = 0; turn < flavor.maskRotation; turn++) [u, v] = [size - 1 - v, u];
        return mask[v][u];
    };
    const top = read(x0, y0) + (read(x0 + 1, y0) - read(x0, y0)) * tx;
    const bottom = read(x0, y0 + 1) + (read(x0 + 1, y0 + 1) - read(x0, y0 + 1)) * tx;
    return top + (bottom - top) * ty;
}

function smoothHash(fx, fy, seed) {
    const x0 = Math.floor(fx);
    const y0 = Math.floor(fy);
    const tx = smoothStep(fx - x0);
    const ty = smoothStep(fy - y0);
    const a = mixedHashUnit(x0, y0, seed);
    const b = mixedHashUnit(x0 + 1, y0, seed);
    const c = mixedHashUnit(x0, y0 + 1, seed);
    const d = mixedHashUnit(x0 + 1, y0 + 1, seed);
    const top = a + (b - a) * tx;
    const bottom = c + (d - c) * tx;
    return top + (bottom - top) * ty;
}

// hashUnit is FNV-1a over `${seed}:${x}:${y}`, which barely mixes the trailing digits into the
// high bits (visible as streaks along one axis). The environment path adds a murmur3 finaliser;
// the legacy interior/room masks keep hashUnit so furniture placement is unchanged.
function mixedHashUnit(x, y, seed) {
    let hash = Math.floor(hashUnit(x, y, seed) * 4294967296) >>> 0;
    hash ^= hash >>> 16;
    hash = Math.imul(hash, 0x85ebca6b);
    hash ^= hash >>> 13;
    hash = Math.imul(hash, 0xc2b2ae35);
    hash ^= hash >>> 16;
    return (hash >>> 0) / 4294967296;
}

function smoothStep(value) {
    return value * value * (3 - 2 * value);
}

export function summarizeWfcNoiseMask(fields = []) {
    const samples = fields
        .map((field) => field?.terrainNoiseMask)
        .filter((sample) => sample && Number.isFinite(sample.value));
    const histogram = [0, 0, 0, 0];
    for (const sample of samples) histogram[Math.min(3, Math.floor(sample.value * 4))]++;
    const average = samples.length
        ? samples.reduce((total, sample) => total + sample.value, 0) / samples.length
        : 0;
    const environments = {};
    const facies = {};
    for (const sample of samples) {
        if (!sample.environmentId) continue;
        environments[sample.environmentId] = (environments[sample.environmentId] || 0) + 1;
        if (sample.faciesId) {
            const key = `${sample.environmentId}/${sample.faciesId}`;
            facies[key] = (facies[key] || 0) + 1;
        }
    }
    return Object.freeze({
        version: WFC_NOISE_MASK_VERSION,
        mapId: 'overworld',
        samples: samples.length,
        average: round(average),
        histogram: Object.freeze(histogram),
        environments: Object.freeze(environments),
        facies: Object.freeze(facies)
    });
}

function fractalUnit(x, y, seed) {
    const coarse = hashUnit(Math.floor(x / 4), Math.floor(y / 4), `${seed}:coarse`);
    const medium = hashUnit(Math.floor(x / 2), Math.floor(y / 2), `${seed}:medium`);
    const fine = hashUnit(x, y, `${seed}:fine`);
    return clamp01(coarse * 0.5 + medium * 0.32 + fine * 0.18);
}

function hashUnit(x, y, seed) {
    let value = 2166136261;
    const source = `${seed}:${x}:${y}`;
    for (let index = 0; index < source.length; index++) {
        value ^= source.charCodeAt(index);
        value = Math.imul(value, 16777619);
    }
    value ^= value >>> 16;
    return (value >>> 0) / 4294967296;
}

function positiveModulo(value, divisor) {
    return ((value % divisor) + divisor) % divisor;
}

function clamp01(value) {
    return Math.max(0, Math.min(1, Number(value) || 0));
}

function round(value) {
    return Math.round(value * 10000) / 10000;
}
