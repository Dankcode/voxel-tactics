// PLAN-15: real places drive the theme generator. A place profile is a small statistical summary of a real
// neighbourhood (a BlenderGIS / OSM export): how tall its buildings are by use, and how their footprints are shaped
// (depth over frontage). The operation generator samples heights and footprint variants from the profile of its
// theme instead of from noise alone, so a generated downtown is as tall and as deep-plotted as the real downtowns
// in the catalogue. Profiles are baked (tools/geo/place-profiles.mjs → PlaceProfiles.generated.js); this module is
// the pure derivation and the sampling helpers.
import { programFor } from '../GeoSite.js';
import { hashString } from '../../util/Rng.js';

const unit = s => (hashString(s) >>> 0) / 4294967296;

/** Minimum-area rectangle of a ring (edge-aligned candidates): { along, deep } in the ring's units, along ≥ deep. */
export function ringRect(ring) {
    let best = null;
    for (let i = 0; i < ring.length; i++) {
        const [ax, ay] = ring[i], [bx, by] = ring[(i + 1) % ring.length], L = Math.hypot(bx - ax, by - ay);
        if (L < 1e-6) continue;
        const ux = (bx - ax) / L, uy = (by - ay) / L;
        let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
        for (const [x, y] of ring) { const a = x * ux + y * uy, b = -x * uy + y * ux; a0 = Math.min(a0, a); a1 = Math.max(a1, a); b0 = Math.min(b0, b); b1 = Math.max(b1, b); }
        const w = a1 - a0, d = b1 - b0;
        if (!best || w * d < best.w * best.d) best = { w, d };
    }
    return best ? { along: Math.max(best.w, best.d), deep: Math.min(best.w, best.d) } : null;
}

/** Observed storeys from OSM levels or height (3.5 m a storey); null when the source says nothing. */
export function observedStoreys(tags = {}) {
    const lv = parseFloat(tags['building:levels']), h = parseFloat(tags.height);
    return Number.isFinite(lv) ? Math.max(1, Math.round(lv)) : Number.isFinite(h) ? Math.max(1, Math.round(h / 3.5)) : null;
}

const polyArea = ring => Math.abs(ring.reduce((a, [x, y], i) => { const [u, v] = ring[(i + 1) % ring.length]; return a + x * v - u * y; }, 0)) / 2;

/** Profile of one export: one sample per building (program, storeys or null, frontage and depth in metres). */
export function derivePlaceProfile(geo, { id = null } = {}) {
    const samples = [];
    for (const b of geo?.buildings || []) {
        if (!b.ring || b.ring.length < 3) continue;
        const r = ringRect(b.ring), area = polyArea(b.ring);
        if (!r || area < 25) continue;
        samples.push({ program: programFor(b.tags || {}, area), storeys: observedStoreys(b.tags || {}), along: +r.along.toFixed(1), deep: +r.deep.toFixed(1) });
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
