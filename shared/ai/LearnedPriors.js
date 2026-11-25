// Distilled per-biome AI posture priors derived from headless AI-vs-AI simulations
// (`npm run ai:arena -- --write-priors`). Blended gently with `BIOME_PRIORS` and live player adaptation.
export const ARENA_PRIORS_META = Object.freeze({
    version: 2,
    source: 'tools/sim/ai_arena.mjs',
    generatedAt: "2026-11-24T06:50:02.979Z",
    matches: 384
});

export const ARENA_BIOME_PRIORS = Object.freeze({
    downtown: Object.freeze({"spread":1.04,"ambush":0.97,"hunt":0.97,"flush":0.98,"doorWatch":1.11,"keepAway":0.97,"highGroundBias":1.04,"recoilDiscipline":1.05,"coverBreakPriority":1.02,"indoorBias":1.05}),
    industrial: Object.freeze({"flankGuard":1.05,"spread":1.04,"closeIn":1.02,"doorWatch":1.03,"recoilDiscipline":1.09,"coverBreakPriority":1.09}),
    suburb: Object.freeze({"overwatchCaution":1.05,"ambush":1.05,"doorWatch":1.09,"indoorBias":1.07}),
    harbor: Object.freeze({"flankGuard":1.07,"spread":1.06,"ambush":0.96,"hunt":0.95,"closeIn":1.06,"flush":0.97,"doorWatch":1.07,"keepAway":0.95,"highGroundBias":0.97,"recoilDiscipline":1.17,"coverBreakPriority":0.95}),
    winter_outpost: Object.freeze({"overwatchCaution":0.97,"flankGuard":0.97,"spread":1.03,"ambush":0.95,"closeIn":1.11,"flush":0.95,"doorWatch":1.08,"keepAway":0.95,"highGroundBias":0.95,"recoilDiscipline":1.15,"coverBreakPriority":0.95,"indoorBias":1.06}),
    old_quarter: Object.freeze({"spread":1.03,"ambush":1.08,"closeIn":1.06,"doorWatch":1.13,"recoilDiscipline":1.02,"indoorBias":1.09}),
    metro_hub: Object.freeze({"overwatchCaution":0.98,"flankGuard":0.97,"spread":1.07,"closeIn":1.11,"flush":0.96,"doorWatch":1.08,"keepAway":0.96,"highGroundBias":0.94,"recoilDiscipline":1.14,"coverBreakPriority":0.94,"indoorBias":0.98}),
    arid_compound: Object.freeze({"overwatchCaution":1.02,"flankGuard":1.09,"spread":1.07,"closeIn":1.11,"doorWatch":1.04,"highGroundBias":1.09,"recoilDiscipline":1.12,"coverBreakPriority":1.05,"indoorBias":1.02})
});

/** Merge a stored per-biome win/loss memory map with an optional override layer. */
export function mergeBiomeMemory(base = null, override = null) {
    if (!base && !override) return null;
    const out = {};
    for (const src of [base, override]) {
        if (!src || typeof src !== 'object') continue;
        for (const [biome, rec] of Object.entries(src)) {
            if (!rec || typeof rec !== 'object') continue;
            out[biome] = {
                matches: Number(rec.matches) || 0,
                wins: Number(rec.wins) || 0,
                winRate: Number(rec.winRate) || 0,
                deltas: { ...(out[biome]?.deltas || {}), ...(rec.deltas || {}) }
            };
        }
    }
    return Object.keys(out).length ? out : null;
}
