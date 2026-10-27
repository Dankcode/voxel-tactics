// PLAN-15: real places drive the theme generator. A place profile is a small statistical summary of a real
// neighbourhood (a Geo-voxel export in the place catalog): how tall its buildings are by use, and how their
// footprints are shaped (depth over frontage, from each building's largest wing). The operation generator samples
// heights and footprint variants from the profile of its theme instead of from noise alone, so a generated downtown
// is as tall and as deep-plotted as the real downtowns in the catalogue. Profiles are baked
// (tools/places/places.mjs profiles → PlaceProfiles.generated.js); this module is the pure derivation and sampling.
import { hashString } from '../../util/Rng.js';

const unit = s => (hashString(s) >>> 0) / 4294967296;

/** Profile of one place's Geo-voxel layers: one sample per building (program, storeys, frontage and depth in metres).
 *  (layers@1 storeys include Geo-voxel's default for untagged buildings; an `observedStoreys` field is preferred.) */
export function derivePlaceProfile(layers, { id = null } = {}) {
    const cell = layers?.frame?.cell || 0.9, samples = [];
    for (const b of layers?.buildings || []) {
        const w = (b.wings || []).slice().sort((p, q) => q.w * q.d - p.w * p.d)[0];
        if (!w || w.w * w.d * cell * cell < 25) continue;
        samples.push({ program: b.program || 'shop', storeys: b.observedStoreys ?? b.storeys ?? null, along: +(Math.max(w.w, w.d) * cell).toFixed(1), deep: +(Math.min(w.w, w.d) * cell).toFixed(1) });
    }
    return { id, samples };
}

/** Merge place profiles into one theme profile: storey weights per programme (and overall) and the depth ratios. */
export function themeProfile(profiles) {
    const storeys = {}, all = {}, ratios = [];
    for (const p of profiles) for (const s of p.samples) {
        if (s.storeys) { (storeys[s.program] ||= {})[s.storeys] = ((storeys[s.program] || {})[s.storeys] || 0) + 1; all[s.storeys] = (all[s.storeys] || 0) + 1; }
        if (s.along > 0) ratios.push(+(s.deep / s.along).toFixed(3));
    }
    ratios.sort((a, b) => a - b);
    return { places: profiles.map(p => p.id), storeys, all, ratios };
}

/**
 * Storeys for a generated building of `program` within the kind's [lo, hi]: drawn from the real distribution of
 * that programme (the whole place when the programme has fewer than two observations), clamped into the range.
 * Returns null when the profile has no height data at all (callers keep their own rule).
 */
export function sampleStoreys(profile, program, [lo, hi], key) {
    if (!profile) return null;
    const own = profile.storeys?.[program], n = own ? Object.values(own).reduce((a, b) => a + b, 0) : 0;
    const dist = n >= 2 ? own : profile.all;
    const entries = Object.entries(dist || {}).map(([k, v]) => [Math.max(lo, Math.min(hi, Number(k))), v]);
    const total = entries.reduce((a, [, v]) => a + v, 0);
    if (!total) return null;
    let r = unit(key) * total;
    for (const [k, v] of entries) { r -= v; if (r <= 0) return k; }
    return entries.at(-1)[0];
}

/** The footprint variant ([along, deep]) whose depth ratio is nearest a real one drawn from the profile. */
export function pickVariant(profile, variants, key) {
    if (!profile?.ratios?.length || variants.length < 2) return null;
    const target = profile.ratios[Math.floor(unit(key) * profile.ratios.length)];
    return variants.slice().sort((a, b) => Math.abs(a[1] / a[0] - target) - Math.abs(b[1] / b[0] - target) || 0)[0];
}
