// A small, deterministic field shared by WFC callers.  Coordinates are world coordinates;
// callers must never add a viewport origin, which keeps overlapping generated views stable.

const CHANNELS = Object.freeze(['relief', 'moisture', 'growth', 'grain', 'grainStrength', 'wildness', 'age', 'strangeness', 'richness']);

export function sampleNoiseField({ x = 0, y = 0, seed = 'world', environmentId = '', faciesId = '', stateId = 0, field = 'overworld' } = {}) {
    const px = Math.floor(Number(x) || 0), py = Math.floor(Number(y) || 0);
    const key = `${seed}:${field}:${environmentId}:${faciesId}:${stateId}`;
    const channel = (name, scale, salt) => fbm(px / scale, py / scale, `${key}:${name}:${salt}`);
    const relief = channel('relief', 23, 11);
    const moisture = channel('moisture', 19, 29);
    const growth = clamp01(channel('growth', 15, 47) * 0.55 + moisture * 0.45);
    const grain = channel('grain', 11, 71) * Math.PI * 2;
    const grainStrength = channel('grain-strength', 17, 89);
    const wildness = channel('wildness', 31, 107);
    const age = channel('age', 43, 131);
    const strangeness = channel('strangeness', 37, 151);
    const richness = clamp01(channel('richness', 13, 179) * 0.5 + moisture * 0.25 + growth * 0.25);
    return Object.freeze({ x: px, y: py, seed: String(seed), environmentId, faciesId, stateId: Number(stateId) || 0, field,
        relief, moisture, growth, grain, grainStrength, wildness, age, strangeness, richness });
}

export function aggregateNoiseField(samples = []) {
    if (!samples.length) return sampleNoiseField();
    const result = {};
    for (const channel of CHANNELS.filter((name) => name !== 'grain')) result[channel] = samples.reduce((sum, sample) => sum + Number(sample[channel] || 0), 0) / samples.length;
    const x = samples.reduce((sum, sample) => sum + Math.cos(sample.grain || 0) * (sample.grainStrength || 0), 0);
    const y = samples.reduce((sum, sample) => sum + Math.sin(sample.grain || 0) * (sample.grainStrength || 0), 0);
    result.grain = Math.atan2(y, x);
    return Object.freeze(result);
}

// Geometric interpolation prevents several modest preferences from being drowned out by one
// high-weight option. It deliberately stays bounded: affinities can rank legal options only.
export function affinityWeight(affinity = {}, sample = {}) {
    let weight = 1;
    for (const [channel, preference] of Object.entries(affinity || {})) {
        if (!CHANNELS.includes(channel) || channel === 'grain') continue;
        const value = clamp01(sample[channel]);
        const [low, high] = Array.isArray(preference) ? preference : [1, preference];
        if (!(low > 0 && high > 0)) continue;
        weight *= Math.exp(Math.log(low) + (Math.log(high) - Math.log(low)) * value);
    }
    return Math.max(0.05, Math.min(20, weight));
}

export function grainAlign(sample, angle = 0) {
    return 0.5 + 0.5 * Math.cos((sample?.grain || 0) - angle) * (sample?.grainStrength || 0);
}

function fbm(x, y, seed) {
    let total = 0, amplitude = 1, scale = 1, norm = 0;
    for (let octave = 0; octave < 3; octave++) { total += valueNoise(x * scale, y * scale, `${seed}:${octave}`) * amplitude; norm += amplitude; amplitude *= 0.5; scale *= 2; }
    return total / norm;
}
function valueNoise(x, y, seed) {
    const x0 = Math.floor(x), y0 = Math.floor(y), tx = smooth(x - x0), ty = smooth(y - y0);
    const a = hash(x0, y0, seed), b = hash(x0 + 1, y0, seed), c = hash(x0, y0 + 1, seed), d = hash(x0 + 1, y0 + 1, seed);
    return a + (b - a) * tx + ((c + (d - c) * tx) - (a + (b - a) * tx)) * ty;
}
function hash(x, y, seed) { let h = 2166136261; for (const char of `${seed}:${x}:${y}`) { h ^= char.charCodeAt(0); h = Math.imul(h, 16777619); } return (h >>> 0) / 4294967296; }
function smooth(value) { return value * value * (3 - 2 * value); }
function clamp01(value) { return Math.max(0, Math.min(1, Number(value) || 0)); }
