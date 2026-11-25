// Symmetric playstyle & environment analysis + adaptive counter-tuning engine.
// Used by the headless AI-vs-AI arena, co-evolution benchmarks, and live Playstyle adaptation.
import { THROWABLES } from '../content/weapons.js';
import { ABILITIES } from '../content/units.js';
import { ARENA_BIOME_PRIORS } from './LearnedPriors.js';

export const ADAPTIVE_VERSION = 2;

export const BIOME_DOCTRINE_NOTES = Object.freeze({
    downtown: 'Downtown grid: hostiles guard alley doors, favor upper windows, and shatter street planters.',
    industrial: 'Industrial yard: hostiles spread across shipping bays, manage recoil, and blast cover early.',
    suburb: 'Suburb close: hostiles hold house interiors, watch front doorways, and set street ambushes.',
    harbor: 'Harbor quay: hostiles tighten bursts along sightlines and guard wide dock flanks.',
    winter_outpost: 'Alpine outpost: hostiles contest warm interiors and close gaps across frozen ponds.',
    old_quarter: 'Old Quarter: hostiles ambush cobblestone chokepoints and watch tight building doors.',
    metro_hub: 'Metro concourse: hostiles push transit flanks and punish exposed subway approaches.',
    arid_compound: 'Arid compound: hostiles contest ridges, guard open desert flanks, and chip hard cover.',
    canal_district: 'Canal quarter: hostiles hold stone bridges, watch opposite quays, and contest sunken water crossings.',
    hillside_ridge: 'Hillside ridge: hostiles seize elevated terraces, rain fire downhill, and defend stair ascents.',
    sunken_basin: 'Sunken valley: hostiles patrol recessed drainage floors, hold rim parapets, and ambush stair landings.'
});

export const EXTENDED_TRAITS = Object.freeze({
    aggression: 'pushes forward and fights up close',
    flanking: 'shoots targets that have no cover toward the shooter',
    overwatch: 'sets overwatch traps',
    explosives: 'blows things up (frags, breaching charges)',
    elements: 'plays element combos (fire, cryo, water, wind, earth)',
    stealth: 'stays hidden and gathers intel before contact',
    range: 'fights from long range',
    cover: 'ends turns in cover from visible threats',
    breach: 'breaches doors and walls into rooms',
    melee: 'closes to melee',
    recoilDiscipline: 'manages fire modes and keeps recoil spread tight',
    verticality: 'seizes elevated high ground',
    coverDestruction: 'shoots away and blasts hostile cover',
    indoorControl: 'holds interior rooms and building approaches'
});

export const BIOME_PRIORS = Object.freeze({
    downtown: Object.freeze({ highGroundBias: 1.15, indoorBias: 1.1, coverBreakPriority: 1.1, doorWatch: 1.1 }),
    industrial: Object.freeze({ spread: 1.05, coverBreakPriority: 1.2, recoilDiscipline: 1.1, flankGuard: 1.1 }),
    suburb: Object.freeze({ indoorBias: 1.15, doorWatch: 1.15, overwatchCaution: 1.1, ambush: 1.1 }),
    harbor: Object.freeze({ closeIn: 1.1, recoilDiscipline: 1.15, flankGuard: 1.15, highGroundBias: 1.05 }),
    winter_outpost: Object.freeze({ indoorBias: 1.15, closeIn: 1.15, recoilDiscipline: 1.1, hunt: 1.1 }),
    old_quarter: Object.freeze({ ambush: 1.15, doorWatch: 1.2, closeIn: 1.1, indoorBias: 1.15 }),
    metro_hub: Object.freeze({ closeIn: 1.2, ambush: 1.15, keepAway: 1.05, recoilDiscipline: 1.1, hunt: 1.15 }),
    arid_compound: Object.freeze({ highGroundBias: 1.2, closeIn: 1.2, recoilDiscipline: 1.15, flankGuard: 1.15, coverBreakPriority: 1.1 }),
    canal_district: Object.freeze({ flankGuard: 1.2, overwatchCaution: 1.15, recoilDiscipline: 1.15, ambush: 1.1 }),
    hillside_ridge: Object.freeze({ highGroundBias: 1.35, keepAway: 1.1, flankGuard: 1.15, recoilDiscipline: 1.15 }),
    sunken_basin: Object.freeze({ highGroundBias: 1.25, ambush: 1.2, closeIn: 1.1, coverBreakPriority: 1.15 })
});

export const PLAYER_ARCHETYPES = Object.freeze({
    balanced: Object.freeze({
        id: 'balanced', name: 'Balanced Tactics',
        shootThreshold: 0.9, grenadeMinTargets: 2, breach: true, formations: true
    }),
    'cautious-sniper': Object.freeze({
        id: 'cautious-sniper', name: 'Cautious Overwatching Marksmen',
        rangePref: 1.35, coverWeight: 1.3, highGroundBias: 1.5, recoilDiscipline: 1.5,
        overwatchWeight: 1.25, aggression: 0.55, preferMode: 'single', shootThreshold: 1.05,
        grenadeMinTargets: 2, breach: false, formations: true
    }),
    'aggressive-breacher': Object.freeze({
        id: 'aggressive-breacher', name: 'Aggressive Door Breachers',
        rangePref: 0.55, aggression: 1.6, breachWeight: 1.8, flankWeight: 1.3,
        overwatchWeight: 0.3, indoorBias: 1.3, preferMode: 'auto', shootThreshold: 0.65,
        grenadeMinTargets: 2, breach: true, formations: false
    }),
    'overwatch-turtle': Object.freeze({
        id: 'overwatch-turtle', name: 'Overwatch Turtle',
        coverWeight: 1.5, overwatchWeight: 1.9, rangePref: 1.15, aggression: 0.45,
        recoilDiscipline: 1.3, shootThreshold: 1.3, grenadeMinTargets: 2, breach: false, formations: true
    }),
    'grenade-demolisher': Object.freeze({
        id: 'grenade-demolisher', name: 'Demolitions & Elementalist',
        grenadeMinTargets: 1.1, coverBreakPriority: 1.6, flushWeight: 1.5, aggression: 1.1,
        shootThreshold: 1.0, breach: true, formations: false
    }),
    'flanker-skirmisher': Object.freeze({
        id: 'flanker-skirmisher', name: 'Mobile Flanker Skirmishers',
        flankWeight: 1.9, rangePref: 0.75, coverWeight: 1.1, aggression: 1.25,
        highGroundBias: 1.15, recoilDiscipline: 0.9, preferMode: 'burst', shootThreshold: 0.8,
        grenadeMinTargets: 2, breach: true, formations: false
    })
});

export const TUNING_KEYS = Object.freeze([
    'overwatchCaution', 'flankGuard', 'spread', 'ambush', 'hunt', 'closeIn',
    'flush', 'doorWatch', 'keepAway', 'highGroundBias', 'recoilDiscipline',
    'coverBreakPriority', 'indoorBias'
]);

const NEUTRAL_TRAITS = Object.freeze(Object.fromEntries(Object.keys(EXTENDED_TRAITS).map(k => [k, 0.5])));
const clamp = (x, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, Number.isFinite(x) ? x : (lo + hi) / 2));
const clamp01 = x => clamp(x, 0, 1);
const r2 = x => Math.round(x * 100) / 100;
const EXPLOSIVE = new Set(['powder_bomb', 'breach_charge']);
const ELEMENTAL = new Set(['fire_flask', 'frost_flask', 'water_flask', 'gale_flask']);

/** Compute concise dominant trait labels. */
export function extendedHeadline(traits) {
    const label = {
        aggression: ['Aggressive', 'Patient'],
        flanking: ['Flanker', 'Frontal'],
        overwatch: ['Overwatch trapper', 'Never waits'],
        explosives: ['Demolitions', null],
        elements: ['Elementalist', null],
        stealth: ['Ghost', 'Loud'],
        range: ['Long range', 'Close range'],
        cover: ['Cover discipline', 'Exposed'],
        breach: ['Breacher', null],
        melee: ['Brawler', null],
        recoilDiscipline: ['Controlled bursts', 'Spray & pray'],
        verticality: ['High-ground', null],
        coverDestruction: ['Cover breaker', null],
        indoorControl: ['Room fighter', null]
    };
    return Object.entries(traits || {})
        .map(([k, v]) => ({ k, v, d: Math.abs(v - 0.5) }))
        .filter(t => t.d >= 0.2)
        .sort((a, b) => b.d - a.d || (a.k < b.k ? -1 : 1))
        .map(t => label[t.k]?.[t.v >= 0.5 ? 0 : 1])
        .filter(Boolean)
        .slice(0, 4);
}

/**
 * Symmetric behavioral, ballistic, and environmental analyzer for either side (`'player'` or `'enemy'`).
 */
export function analyzeSideBehavior(battle, side = 'player') {
    const unitById = new Map((battle.units || []).map(u => [u.id, u]));
    const ownUnits = (battle.units || []).filter(u => u.side === side && !u.drone);
    const n = Math.max(1, ownUnits.length);
    const sideEnd = battle.stats?.sideTurnEnds?.[side];
    const fallbackEnd = side === 'player' ? (battle.stats?.turnEnds || {}) : {};
    const m = {
        rounds: 1,
        firstContactRound: null,
        shots: 0,
        projectiles: 0,
        hits: 0,
        hitRate: 0,
        headshots: 0,
        pierced: 0,
        fireModes: { single: 0, burst: 0, auto: 0 },
        rangeBandHits: { close: 0, mid: 0, long: 0 },
        shotDist: 0,
        shotsWithTarget: 0,
        spreadSum: 0,
        climbSum: 0,
        flankShots: 0,
        closeShots: 0,
        longShots: 0,
        flushShots: 0,
        coverDestroyed: 0,
        tilesMoved: 0,
        overwatch: 0,
        reactions: 0,
        explosives: 0,
        elements: 0,
        intel: 0,
        breaches: 0,
        melee: 0,
        dronesDown: 0,
        firstAlertRound: null,
        flankSteps: side === 'player' ? (battle.stats?.flankSteps || 0) : (sideEnd?.flankSteps || 0),
        undergroundSteps: side === 'player' ? (battle.stats?.undergroundSteps || 0) : (sideEnd?.undergroundSteps || 0),
        inCover: sideEnd?.inCover ?? fallbackEnd.inCover ?? 0,
        exposed: sideEnd?.exposed ?? fallbackEnd.exposed ?? 0,
        unseen: sideEnd?.unseen ?? fallbackEnd.unseen ?? 0,
        highGroundTurns: sideEnd?.highGround ?? 0,
        indoorTurns: sideEnd?.indoor ?? 0
    };

    for (const e of battle.log || []) {
        m.rounds = Math.max(m.rounds, e.round || 1);
        switch (e.t) {
            case 'shot': {
                const actor = unitById.get(e.unitId);
                if (actor?.side !== side) break;
                const projs = e.projectiles || [];
                const foeHits = projs.filter(p => p.kind === 'unit' && unitById.get(p.unitId)?.side !== side);
                m.projectiles += projs.length;
                m.hits += foeHits.length;
                m.headshots += foeHits.filter(p => p.headshot).length;
                m.pierced += projs.filter(p => p.pierced?.length).length;
                const voxelBreaks = projs.filter(p => p.destroyed).length;
                m.coverDestroyed += voxelBreaks;
                if (e.reaction) break;
                m.shots++;
                const fm = e.fireMode || 'single';
                m.fireModes[fm] = (m.fireModes[fm] || 0) + 1;
                m.spreadSum += e.spread || 0;
                m.climbSum += e.recoilClimb || 0;
                if (voxelBreaks > 0 && e.dist == null) m.flushShots++;
                if (e.dist != null) {
                    m.shotsWithTarget++;
                    m.shotDist += e.dist;
                    if (e.cover === 0) m.flankShots++;
                    if (e.dist <= 6) { m.closeShots++; m.rangeBandHits.close += foeHits.length; }
                    else if (e.dist >= 14) { m.longShots++; m.rangeBandHits.long += foeHits.length; }
                    else m.rangeBandHits.mid += foeHits.length;
                }
                break;
            }
            case 'reaction': {
                if (unitById.get(e.watcherId)?.side === side) m.reactions++;
                break;
            }
            case 'overwatch': {
                if (unitById.get(e.unitId)?.side === side) m.overwatch++;
                break;
            }
            case 'move': {
                if (unitById.get(e.unitId)?.side === side && !e.scatter) {
                    m.tilesMoved += Math.max(0, (e.path?.length || 1) - 1);
                }
                break;
            }
            case 'throw': {
                if (unitById.get(e.unitId)?.side !== side) break;
                if (EXPLOSIVE.has(e.itemId)) { m.explosives++; m.coverDestroyed++; }
                else if (ELEMENTAL.has(e.itemId) || THROWABLES[e.itemId]?.element) m.elements++;
                break;
            }
            case 'ability': {
                if (unitById.get(e.unitId)?.side !== side) break;
                const a = ABILITIES[e.abilityId];
                if (a?.intel && !a.support) m.intel++;
                else if (a?.element) m.elements++;
                break;
            }
            case 'intel': case 'drone': {
                if (unitById.get(e.unitId)?.side === side) m.intel++;
                break;
            }
            case 'breach': {
                const actorSide = unitById.get(e.unitIds?.[0])?.side;
                if (actorSide === side || (side === 'player' && !actorSide)) m.breaches++;
                break;
            }
            case 'melee': {
                if (unitById.get(e.unitId)?.side === side) m.melee++;
                break;
            }
            case 'death': {
                const deadUnit = unitById.get(e.unitId);
                const killer = unitById.get(e.source);
                if (deadUnit?.drone && killer?.side === side) m.dronesDown++;
                break;
            }
            case 'alert': case 'discovery': {
                if (m.firstAlertRound == null) m.firstAlertRound = e.round || 1;
                if (m.firstContactRound == null) m.firstContactRound = e.round || 1;
                break;
            }
        }
    }

    const turns = Math.max(1, n * m.rounds);
    const avgDist = m.shotsWithTarget ? m.shotDist / m.shotsWithTarget : null;
    const faced = m.inCover + m.exposed;
    const endTurns = faced + m.unseen;
    const avgSpread = m.shots ? m.spreadSum / m.shots : 1.8;
    const avgClimb = m.shots ? m.climbSum / m.shots : 0.4;
    const controlledRatio = m.shots ? (m.fireModes.single + m.fireModes.burst * 0.55) / m.shots : 0.5;
    m.hitRate = m.projectiles ? r2(m.hits / m.projectiles) : 0;
    m.avgShotDist = avgDist == null ? null : r2(avgDist);
    m.avgSpread = m.shots ? r2(avgSpread) : null;
    m.avgRecoilClimb = m.shots ? r2(avgClimb) : null;
    delete m.shotDist;
    delete m.spreadSum;
    delete m.climbSum;

    const traits = {
        aggression: 0.5 * (m.shotsWithTarget ? m.closeShots / m.shotsWithTarget : 0.5) + 0.5 * Math.min(1, m.tilesMoved / turns / 8),
        flanking: Math.min(1, (m.shotsWithTarget ? m.flankShots / m.shotsWithTarget : 0) + m.flankSteps / turns / 6),
        overwatch: Math.min(1, (m.overwatch / turns) * 3),
        explosives: Math.min(1, m.explosives / Math.max(1, n * 0.75)),
        elements: Math.min(1, m.elements / Math.max(1, n * 0.75)),
        stealth: Math.min(1, (m.firstAlertRound == null ? 1 : (m.firstAlertRound - 1) / 4) * 0.7 + Math.min(1, m.intel / n) * 0.3),
        range: avgDist == null ? 0.5 : Math.min(1, Math.max(0, (avgDist - 6) / 14)),
        cover: faced ? m.inCover / faced : 0.5,
        breach: Math.min(1, m.breaches / 2),
        melee: Math.min(1, m.melee / n),
        recoilDiscipline: m.shots ? clamp01(0.55 * controlledRatio + 0.45 * Math.max(0, 1 - avgClimb / 2.2)) : 0.5,
        verticality: endTurns ? clamp01((m.highGroundTurns / endTurns) * 2.2) : 0.5,
        coverDestruction: clamp01((m.coverDestroyed + m.flushShots * 1.5) / Math.max(2, n * 2)),
        indoorControl: endTurns ? clamp01((m.indoorTurns / endTurns) * 1.6) : 0.5
    };
    for (const k of Object.keys(traits)) traits[k] = r2(clamp01(traits[k]));
    return {
        version: ADAPTIVE_VERSION,
        side,
        metrics: m,
        traits,
        headline: extendedHeadline(traits)
    };
}

/** Validate/normalize a generic adaptive profile for either side. */
export function sanitizeSideProfile(p) {
    if (!p || typeof p !== 'object' || !p.traits || typeof p.traits !== 'object') return null;
    const traits = {};
    for (const k of Object.keys(EXTENDED_TRAITS)) traits[k] = r2(clamp01(Number(p.traits[k] ?? 0.5)));
    const matches = Math.max(0, Math.min(1e6, Math.floor(Number(p.matches) || 0)));
    const history = Array.isArray(p.history) ? p.history.slice(-12).filter(Boolean).map(h => ({
        outcome: h.outcome ? String(h.outcome).slice(0, 24) : null,
        biome: h.biome ? String(h.biome).slice(0, 40) : null,
        traits: Object.fromEntries(Object.keys(EXTENDED_TRAITS).map(k => [k, r2(clamp01(Number(h.traits?.[k] ?? 0.5)))])),
        headline: Array.isArray(h.headline) ? h.headline.slice(0, 4).map(String) : []
    })) : [];
    const byBiome = {};
    if (p.byBiome && typeof p.byBiome === 'object') {
        for (const [b, rec] of Object.entries(p.byBiome)) {
            if (!rec || typeof rec !== 'object') continue;
            byBiome[b] = {
                matches: Number(rec.matches) || 0,
                wins: Number(rec.wins) || 0,
                traits: Object.fromEntries(Object.keys(EXTENDED_TRAITS).map(k => [k, r2(clamp01(Number(rec.traits?.[k] ?? 0.5)))]))
            };
        }
    }
    return { version: ADAPTIVE_VERSION, matches, traits, history, byBiome };
}

/** Roll one match observation into a running EMA profile for an opponent side. */
export function mergeSideProfile(profile, style, meta = {}) {
    const p = sanitizeSideProfile(profile) || {
        version: ADAPTIVE_VERSION, matches: 0, traits: { ...NEUTRAL_TRAITS }, history: [], byBiome: {}
    };
    const alpha = Math.max(0.28, 1 / (p.matches + 1));
    const traits = {};
    for (const k of Object.keys(EXTENDED_TRAITS)) {
        traits[k] = r2(p.traits[k] + (clamp01(style.traits?.[k] ?? 0.5) - p.traits[k]) * alpha);
    }
    const biome = meta.biome || meta.plot || null;
    const byBiome = { ...p.byBiome };
    if (biome) {
        const prev = byBiome[biome] || { matches: 0, wins: 0, traits: { ...NEUTRAL_TRAITS } };
        const bAlpha = Math.max(0.35, 1 / (prev.matches + 1));
        const bTraits = {};
        for (const k of Object.keys(EXTENDED_TRAITS)) {
            bTraits[k] = r2(prev.traits[k] + (clamp01(style.traits?.[k] ?? 0.5) - prev.traits[k]) * bAlpha);
        }
        byBiome[biome] = {
            matches: prev.matches + 1,
            wins: prev.wins + (meta.won ? 1 : 0),
            traits: bTraits
        };
    }
    const history = [...p.history, {
        outcome: meta.outcome || null,
        biome,
        traits: Object.fromEntries(Object.keys(EXTENDED_TRAITS).map(k => [k, r2(clamp01(style.traits?.[k] ?? 0.5))])),
        headline: style.headline || extendedHeadline(style.traits)
    }].slice(-12);
    return {
        version: ADAPTIVE_VERSION,
        matches: p.matches + 1,
        traits,
        headline: extendedHeadline(traits),
        history,
        byBiome
    };
}

/**
 * Compute deterministic 13-weight tactical counter-tuning from an observed opponent profile,
 * blended with static `BIOME_PRIORS`, distilled `ARENA_BIOME_PRIORS`, and learned outcome `biomeMemory`.
 */
export function counterTuningFrom(opponentProfile, { biome = null, biomeMemory = null } = {}) {
    const p = sanitizeSideProfile(opponentProfile);
    const t = p ? p.traits : NEUTRAL_TRAITS;
    const conf = p ? Math.min(1, p.matches / 3) : 0;
    const w = (v, min = 0.55, max = 1.95) => clamp(1 + (clamp01(v) - 0.5) * 2 * conf, min, max);
    const staticP = (biome && BIOME_PRIORS[biome]) || {};
    const arenaP = (biome && ARENA_BIOME_PRIORS[biome]) || {};
    const prior = {};
    for (const k of TUNING_KEYS) prior[k] = ((staticP[k] ?? 1) + (arenaP[k] ?? 1)) * 0.5;
    const mem = (biome && biomeMemory?.[biome]?.deltas) || {};

    const raw = {
        overwatchCaution: w(t.overwatch),
        flankGuard: w(t.flanking),
        spread: w(Math.max(t.explosives, t.elements, (t.explosives + t.elements) * 0.6)),
        ambush: w(t.aggression),
        hunt: w(t.stealth),
        closeIn: clamp(w(t.range) * (1 - 0.35 * Math.max(0, clamp01(t.overwatch) - 0.5) * conf), 0.55, 1.95),
        flush: w(Math.max(t.cover, t.overwatch * 0.8)),
        doorWatch: w(Math.max(t.breach, t.indoorControl * 0.7)),
        keepAway: w(t.melee),
        highGroundBias: w(t.verticality * 0.7 + t.range * 0.3),
        recoilDiscipline: w(t.recoilDiscipline),
        coverBreakPriority: w(Math.max(t.cover, t.coverDestruction * 0.85)),
        indoorBias: w(t.indoorControl * 0.75 + t.breach * 0.25)
    };
    const out = {};
    for (const k of TUNING_KEYS) {
        const pFactor = 1 + ((prior[k] ?? 1) - 1) * 0.65;
        const mFactor = 1 + ((mem[k] ?? 1) - 1) * 0.65;
        const combined = raw[k] * pFactor * mFactor;
        out[k] = r2(clamp(combined, 0.55, 1.95));
    }
    return out;
}

/**
 * Deterministic mid-battle tactical adaptation from the live round's event log (`side = 'player'`).
 * Activates on Round 2+ once at least 3 meaningful player actions have occurred so peers stay lockstep-identical.
 */
export function blendLiveAdaptation(baseTuning, battle, { biome = null, biomeMemory = null, side = 'player' } = {}) {
    const base = Object.fromEntries(TUNING_KEYS.map(k => [k, r2(baseTuning?.[k] ?? 1)]));
    if (!battle || battle.round < 2) return { tuning: base, liveWeight: 0, detected: [], shifts: [] };
    const style = analyzeSideBehavior(battle, side);
    const m = style.metrics;
    const actions = m.shots + m.overwatch + m.explosives + m.elements + m.breaches + m.melee + (m.tilesMoved >= 6 ? 1 : 0);
    if (actions < 3) return { tuning: base, liveWeight: 0, detected: [], shifts: [] };

    const synthProfile = { version: ADAPTIVE_VERSION, matches: 3, traits: style.traits };
    const liveTuning = counterTuningFrom(synthProfile, { biome, biomeMemory });
    const alpha = r2(Math.min(0.35, 0.12 * (battle.round - 1)));
    const tuning = {};
    const shifts = [];
    for (const k of TUNING_KEYS) {
        tuning[k] = r2(clamp(base[k] * (1 - alpha) + liveTuning[k] * alpha, 0.55, 1.95));
        const delta = Math.abs(tuning[k] - base[k]);
        if (delta >= 0.08) shifts.push({ key: k, from: base[k], to: tuning[k], delta: r2(tuning[k] - base[k]) });
    }
    shifts.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta) || (a.key < b.key ? -1 : 1));
    return {
        tuning,
        liveWeight: alpha,
        detected: style.headline || [],
        shifts: shifts.slice(0, 3).map(({ key, from, to }) => ({ key, from, to }))
    };
}

/** Reinforce biome-specific weight deltas after a match ends based on win/loss and survivor margin. */
export function updateBiomeMemory(memory, biome, tuningUsed, won, margin = 1) {
    if (!biome) return memory || {};
    const next = { ...(memory || {}) };
    const prev = next[biome] || { matches: 0, wins: 0, winRate: 0, deltas: {} };
    const step = clamp(Math.abs(margin || 1) / 3, 0.4, 1.5);
    const dir = won ? 0.08 * step : -0.05 * step;
    const deltas = { ...prev.deltas };
    for (const k of TUNING_KEYS) {
        const used = tuningUsed?.[k] ?? 1;
        const dev = used - 1;
        // Reinforce deviations that succeeded; revert deviations that lost (and slightly boost passive vigilance on close losses).
        const cur = deltas[k] ?? 1;
        const delta = Math.abs(dev) > 0.04 ? dev * dir : (!won ? 0.015 * step : 0);
        deltas[k] = r2(clamp(cur + delta, 0.65, 1.75));
    }
    const matches = prev.matches + 1;
    const wins = prev.wins + (won ? 1 : 0);
    next[biome] = { matches, wins, winRate: r2(wins / matches), deltas };
    return next;
}
