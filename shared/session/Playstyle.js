// PLAN-09: what the player's gameplay says about them, and how the enemy AI adapts to it.
//
// playstyleFromBattle(battle)   one match -> raw metrics + traits (0..1), read from the event log and battle.stats
// mergeProfile(profile, style)  rolls a match into the cached profile (moving average, recent history)
// aiTuningFrom(profile)         cached profile -> the AI weights a Battle runs with (deterministic: rounded numbers)
// adaptationNotes(profile)      plain-language "you do X -> the AI now does Y" lines for the post-match report
//
// Pure and deterministic (no clock, no Math.random): the client and the server both run it, and the tuning a battle
// uses travels in the scenario descriptor (desc.aiProfile) so every lockstep peer builds the same AI.
import { THROWABLES } from '../content/weapons.js';
import { ABILITIES } from '../content/units.js';
import {
    EXTENDED_TRAITS, TUNING_KEYS, BIOME_DOCTRINE_NOTES, BIOME_PRIORS,
    analyzeSideBehavior, counterTuningFrom, updateBiomeMemory
} from '../ai/AdaptivePolicy.js';

export const PLAYSTYLE_VERSION = 1;
export const ALL_TRAITS = EXTENDED_TRAITS;
export { BIOME_DOCTRINE_NOTES };
/** Every trait, 0..1, with what a high value means. */
export const TRAITS = Object.freeze({
    aggression: 'pushes forward and fights up close',
    flanking: 'shoots targets that have no cover toward the shooter',
    overwatch: 'sets overwatch traps',
    explosives: 'blows things up (frags, breaching charges)',
    elements: 'plays the element combos (fire, cryo, water, wind, earth)',
    stealth: 'stays hidden and gathers intel before contact',
    range: 'fights from long range',
    cover: 'ends turns in cover from what it can see',
    breach: 'breaches doors and walls into rooms',
    melee: 'closes to melee'
});
const NEUTRAL = Object.freeze(Object.fromEntries(Object.keys(TRAITS).map(k => [k, 0.5])));
const NEUTRAL_EXT = Object.freeze(Object.fromEntries(Object.keys(EXTENDED_TRAITS).map(k => [k, 0.5])));
const clamp = (x, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, Number.isFinite(x) ? x : (lo + hi) / 2));
const clamp01 = x => clamp(x, 0, 1);
const r2 = x => Math.round(x * 100) / 100;

/** One finished (or abandoned) battle -> { version, metrics, traits, extendedTraits }. Delegates log parsing to AdaptivePolicy. */
export function playstyleFromBattle(b) {
    const res = analyzeSideBehavior(b, 'player');
    const traits = {};
    for (const k of Object.keys(TRAITS)) traits[k] = r2(clamp01(res.traits[k] ?? 0.5));
    return {
        version: PLAYSTYLE_VERSION,
        metrics: res.metrics,
        traits,
        extendedTraits: res.traits,
        headline: headline(traits)
    };
}

/** The 1-3 traits that stand out most (far from neutral), as short labels. */
export function headline(traits) {
    const label = { aggression: ['Aggressive', 'Patient'], flanking: ['Flanker', 'Frontal'], overwatch: ['Overwatch trapper', 'Never waits'],
        explosives: ['Demolitions', null], elements: ['Elementalist', null], stealth: ['Ghost', 'Loud'], range: ['Long range', 'Close range'],
        cover: ['Cover discipline', 'Exposed'], breach: ['Breacher', null], melee: ['Brawler', null] };
    return Object.entries(traits).map(([k, v]) => ({ k, v, d: Math.abs(v - 0.5) })).filter(t => t.d >= 0.2)
        .sort((a, b) => b.d - a.d).map(t => label[t.k]?.[t.v >= 0.5 ? 0 : 1]).filter(Boolean).slice(0, 3);
}

/**
 * Roll a match into the cached profile. Newer matches weigh more (at least 30 %), the first few settle quickly.
 * `meta` stores { outcome, scenario, biome, tuning, margin, at }.
 */
export function mergeProfile(profile, style, meta = {}) {
    const p = sanitizeAiProfile(profile) || { version: PLAYSTYLE_VERSION, matches: 0, traits: { ...NEUTRAL }, extendedTraits: { ...NEUTRAL_EXT }, biomeMemory: {}, history: [] };
    const k = Math.max(0.3, 1 / (p.matches + 1));
    const traits = {};
    for (const t of Object.keys(TRAITS)) traits[t] = r2(p.traits[t] + (clamp01(style.traits[t]) - p.traits[t]) * k);
    const prevExt = p.extendedTraits || { ...NEUTRAL_EXT, ...p.traits };
    const srcExt = style.extendedTraits || style.traits || {};
    const extendedTraits = {};
    for (const t of Object.keys(EXTENDED_TRAITS)) {
        const val = srcExt[t] ?? traits[t] ?? 0.5;
        extendedTraits[t] = r2(prevExt[t] + (clamp01(val) - prevExt[t]) * k);
    }
    const biome = meta.biome || meta.plot || null;
    const biomeMemory = (biome && BIOME_PRIORS[biome])
        ? updateBiomeMemory(p.biomeMemory || {}, biome, meta.tuning || null, meta.outcome === 'enemy', meta.margin ?? 1)
        : (p.biomeMemory || {});
    const history = [...(p.history || []), { ...pick(meta, ['outcome', 'scenario', 'biome', 'at']), traits: style.traits, headline: style.headline || headline(style.traits) }].slice(-10);
    const out = { version: PLAYSTYLE_VERSION, matches: p.matches + 1, traits, extendedTraits, biomeMemory, headline: headline(traits), history };
    out.tuning = aiTuningFrom(out, { biome });
    out.adaptation = adaptationNotes(out, { biome });
    return out;
}
const pick = (o, keys) => Object.fromEntries(keys.filter(k => o?.[k] != null).map(k => [k, String(o[k]).slice(0, 80)]));

/** Default AI weights (no cached profile). */
export const DEFAULT_TUNING = Object.freeze(aiTuningFrom(null));

/**
 * Cached profile -> the weights the AI plays with this match. Blends legacy player traits, extended ballistic/vertical/indoor
 * traits, learned `biomeMemory`, and distilled `BIOME_PRIORS` / `ARENA_BIOME_PRIORS` deterministically.
 */
export function aiTuningFrom(profile, { biome = null, biomeMemory = null } = {}) {
    const p = sanitizeAiProfile(profile);
    const t = p ? p.traits : NEUTRAL;
    const extT = p?.extendedTraits || t;
    const mem = biomeMemory || p?.biomeMemory || null;
    if ((biome && BIOME_PRIORS[biome]) || (biome && mem?.[biome])) {
        const symProfile = p ? { version: 2, matches: p.matches, traits: { ...NEUTRAL_EXT, ...t, ...extT }, biomeMemory: mem } : null;
        return counterTuningFrom(symProfile, { biome, biomeMemory: mem });
    }
    const conf = p ? Math.min(1, p.matches / 3) : 0;
    const w = v => r2(Math.max(0.5, 1 + (clamp01(v) - 0.5) * 2 * conf));
    return {
        overwatchCaution: w(t.overwatch),
        flankGuard: w(t.flanking),
        spread: w((t.explosives + t.elements) / 2),
        ambush: w(t.aggression),
        hunt: w(t.stealth),
        closeIn: w(t.range),
        flush: w(t.cover),
        doorWatch: w(t.breach),
        keepAway: w(t.melee),
        highGroundBias: w((extT.verticality ?? 0.5) * 0.7 + t.range * 0.3),
        recoilDiscipline: w(extT.recoilDiscipline ?? 0.5),
        coverBreakPriority: w(Math.max(t.cover, (extT.coverDestruction ?? t.cover) * 0.85)),
        indoorBias: w((extT.indoorControl ?? 0.5) * 0.75 + t.breach * 0.25)
    };
}

/** Plain-language adaptation lines for the report. */
export function adaptationNotes(profile, { biome = null } = {}) {
    const p = sanitizeAiProfile(profile);
    const out = [];
    if (biome && BIOME_DOCTRINE_NOTES[biome]) out.push(BIOME_DOCTRINE_NOTES[biome]);
    if (!p) return out;
    const t = { ...p.traits, ...(p.extendedTraits || {}) };
    const hi = (k, at = 0.62) => t[k] >= at;
    if (hi('flanking')) out.push('You flank often: enemies favour cover that protects from several sides and stay closer to their pod.');
    if (hi('overwatch')) out.push('You set overwatch traps: enemies avoid tiles your watchers cover and wait you out.');
    if (hi('aggression')) out.push('You push hard: enemies fall back into rooms and corners to ambush the squad.');
    else if (t.aggression <= 0.35) out.push('You play slowly: enemies take the initiative and advance on flanks.');
    if (hi('explosives') || hi('elements')) out.push('You punish clusters with grenades and elements: enemies spread out.');
    if (hi('stealth')) out.push('You stay hidden: enemies sweep toward any noise or last sighting instead of standing still.');
    if (hi('range')) out.push('You fight at long range: enemies break line of sight and close the distance under cover.');
    if (hi('cover')) out.push('You hold good cover: enemies flank wider and burn or blast you out of it.');
    if (hi('breach')) out.push('You breach rooms: defenders stay off the door lines and cover the entries.');
    if (hi('melee')) out.push('You close to melee: enemies keep their distance from your brawlers.');
    if (hi('verticality')) out.push('You seize high ground: hostiles climb elevated perches earlier to contest angles.');
    if (hi('coverDestruction')) out.push('You shred destructible cover: enemies break stubborn fortifications back and stay mobile.');
    if (hi('recoilDiscipline')) out.push('You manage controlled shots well: enemies tighten fire discipline at range.');
    if (!out.length) out.push('No strong habits yet: the AI plays its standard tactics.');
    return out;
}

function sanitizeBiomeMemory(raw) {
    if (!raw || typeof raw !== 'object') return {};
    const out = {};
    for (const [biome, rec] of Object.entries(raw)) {
        if (!BIOME_PRIORS[biome] || !rec || typeof rec !== 'object') continue;
        const deltas = {};
        if (rec.deltas && typeof rec.deltas === 'object') {
            for (const k of TUNING_KEYS) {
                if (rec.deltas[k] != null) deltas[k] = r2(clamp(Number(rec.deltas[k]), 0.65, 1.75));
            }
        }
        const matches = Math.max(0, Math.min(1e5, Math.floor(Number(rec.matches) || 0)));
        const wins = Math.max(0, Math.min(matches, Math.floor(Number(rec.wins) || 0)));
        out[biome] = { matches, wins, winRate: matches ? r2(wins / matches) : 0, deltas };
    }
    return out;
}

/** Validate an untrusted profile (cache file, network, descriptor). Returns null when unusable. */
export function sanitizeAiProfile(p) {
    if (!p || typeof p !== 'object' || !p.traits || typeof p.traits !== 'object') return null;
    const traits = {};
    for (const k of Object.keys(TRAITS)) traits[k] = r2(clamp01(Number(p.traits[k] ?? 0.5)));
    const extendedTraits = {};
    const srcExt = p.extendedTraits && typeof p.extendedTraits === 'object' ? p.extendedTraits : p.traits;
    for (const k of Object.keys(EXTENDED_TRAITS)) extendedTraits[k] = r2(clamp01(Number(srcExt[k] ?? traits[k] ?? 0.5)));
    const matches = Math.max(0, Math.min(1e6, Math.floor(Number(p.matches) || 0)));
    const history = Array.isArray(p.history) ? p.history.slice(-10).filter(h => h && typeof h === 'object').map(h => ({
        ...pick(h, ['outcome', 'scenario', 'biome', 'at']),
        traits: Object.fromEntries(Object.keys(TRAITS).map(k => [k, r2(clamp01(Number(h.traits?.[k] ?? 0.5)))])),
        headline: Array.isArray(h.headline) ? h.headline.slice(0, 3).map(s => String(s).slice(0, 40)) : []
    })) : [];
    const biomeMemory = sanitizeBiomeMemory(p.biomeMemory);
    return { version: PLAYSTYLE_VERSION, matches, traits, extendedTraits, biomeMemory, history };
}
/** The part of a profile a battle needs (keeps scenario descriptors compact & deterministic). */
export function profileForDesc(p) {
    const s = sanitizeAiProfile(p);
    if (!s) return null;
    const out = { version: s.version, matches: s.matches, traits: s.traits, extendedTraits: s.extendedTraits };
    if (Object.keys(s.biomeMemory).length) out.biomeMemory = s.biomeMemory;
    return out;
}
/** Average several players' profiles (co-op squads) into one the AI plays against. */
export function blendProfiles(list) {
    const ps = list.map(sanitizeAiProfile).filter(Boolean);
    if (!ps.length) return null;
    const traits = {}, extendedTraits = {};
    for (const k of Object.keys(TRAITS)) traits[k] = r2(ps.reduce((s, p) => s + p.traits[k], 0) / ps.length);
    for (const k of Object.keys(EXTENDED_TRAITS)) extendedTraits[k] = r2(ps.reduce((s, p) => s + (p.extendedTraits?.[k] ?? 0.5), 0) / ps.length);
    const biomeMemory = {};
    for (const biome of Object.keys(BIOME_PRIORS)) {
        const recs = ps.map(p => p.biomeMemory?.[biome]).filter(Boolean);
        if (!recs.length) continue;
        const deltas = {};
        for (const k of TUNING_KEYS) {
            deltas[k] = r2(recs.reduce((s, r) => s + (r.deltas?.[k] ?? 1), 0) / recs.length);
        }
        const matches = recs.reduce((s, r) => s + r.matches, 0);
        const wins = recs.reduce((s, r) => s + r.wins, 0);
        biomeMemory[biome] = { matches, wins, winRate: matches ? r2(wins / matches) : 0, deltas };
    }
    return { version: PLAYSTYLE_VERSION, matches: Math.min(...ps.map(p => p.matches)), traits, extendedTraits, biomeMemory };
}
