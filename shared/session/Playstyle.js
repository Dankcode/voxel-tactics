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

export const PLAYSTYLE_VERSION = 1;
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
const clamp01 = x => Math.max(0, Math.min(1, Number.isFinite(x) ? x : 0.5));
const r2 = x => Math.round(x * 100) / 100;
const EXPLOSIVE = new Set(['powder_bomb', 'breach_charge']);
const ELEMENTAL = new Set(['fire_flask', 'frost_flask', 'water_flask', 'gale_flask']);

/** One finished (or abandoned) battle -> { version, metrics, traits }. */
export function playstyleFromBattle(b) {
    const side = id => b.units.find(u => u.id === id)?.side;
    const squad = b.units.filter(u => u.side === 'player');
    const n = Math.max(1, squad.length);
    const m = { rounds: 1, shots: 0, shotDist: 0, shotsWithTarget: 0, flankShots: 0, closeShots: 0, longShots: 0, tilesMoved: 0,
        overwatch: 0, reactions: 0, explosives: 0, elements: 0, intel: 0, breaches: 0, melee: 0, firstAlertRound: null,
        flankSteps: b.stats?.flankSteps || 0, ...(b.stats?.turnEnds || { inCover: 0, exposed: 0, unseen: 0 }) };
    for (const e of b.log) {
        m.rounds = Math.max(m.rounds, e.round || 1);
        switch (e.t) {
            case 'shot':
                if (side(e.unitId) !== 'player' || e.reaction) break;
                m.shots++;
                if (e.dist != null) {
                    m.shotsWithTarget++; m.shotDist += e.dist;
                    if (e.cover === 0) m.flankShots++;
                    if (e.dist <= 6) m.closeShots++; else if (e.dist >= 14) m.longShots++;
                }
                break;
            case 'reaction': if (side(e.watcherId) === 'player') m.reactions++; break;
            case 'overwatch': if (side(e.unitId) === 'player') m.overwatch++; break;
            case 'move': if (side(e.unitId) === 'player' && !e.scatter) m.tilesMoved += Math.max(0, (e.path?.length || 1) - 1); break;
            case 'throw':
                if (side(e.unitId) !== 'player') break;
                if (EXPLOSIVE.has(e.itemId)) m.explosives++;
                else if (ELEMENTAL.has(e.itemId) || THROWABLES[e.itemId]?.element) m.elements++;
                break;
            case 'ability': {
                if (side(e.unitId) !== 'player') break;
                const a = ABILITIES[e.abilityId];
                if (a?.intel && !a.support) m.intel++;
                else if (a?.element) m.elements++;
                break;
            }
            case 'intel': case 'drone': if (side(e.unitId) === 'player') m.intel++; break;
            case 'breach': m.breaches++; break;
            case 'melee': if (side(e.unitId) === 'player') m.melee++; break;
            case 'alert': if (m.firstAlertRound == null) m.firstAlertRound = e.round || 1; break;
        }
    }
    const turns = n * m.rounds, avgDist = m.shotsWithTarget ? m.shotDist / m.shotsWithTarget : null;
    const faced = m.inCover + m.exposed;
    const traits = {
        aggression: 0.5 * (m.shotsWithTarget ? m.closeShots / m.shotsWithTarget : 0.5) + 0.5 * Math.min(1, m.tilesMoved / turns / 8),
        flanking: Math.min(1, (m.shotsWithTarget ? m.flankShots / m.shotsWithTarget : 0) + m.flankSteps / turns / 6),
        overwatch: Math.min(1, m.overwatch / turns * 3),
        explosives: Math.min(1, m.explosives / n),
        elements: Math.min(1, m.elements / n),
        stealth: Math.min(1, (m.firstAlertRound == null ? 1 : (m.firstAlertRound - 1) / 4) * 0.7 + Math.min(1, m.intel / n) * 0.3),
        range: avgDist == null ? 0.5 : Math.min(1, Math.max(0, (avgDist - 3) / 15)),
        cover: faced ? m.inCover / faced : 0.5,
        breach: Math.min(1, m.breaches / 2),
        melee: Math.min(1, m.melee / n)
    };
    for (const k of Object.keys(traits)) traits[k] = r2(clamp01(traits[k]));
    m.avgShotDist = avgDist == null ? null : r2(avgDist);
    delete m.shotDist;
    return { version: PLAYSTYLE_VERSION, metrics: m, traits, headline: headline(traits) };
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
 * `meta` is stored with the history entry ({ outcome, scenario, at } - the caller supplies the time).
 */
export function mergeProfile(profile, style, meta = {}) {
    const p = sanitizeAiProfile(profile) || { version: PLAYSTYLE_VERSION, matches: 0, traits: { ...NEUTRAL }, history: [] };
    const k = Math.max(0.3, 1 / (p.matches + 1));
    const traits = {};
    for (const t of Object.keys(TRAITS)) traits[t] = r2(p.traits[t] + (clamp01(style.traits[t]) - p.traits[t]) * k);
    const history = [...(p.history || []), { ...pick(meta, ['outcome', 'scenario', 'at']), traits: style.traits, headline: style.headline || headline(style.traits) }].slice(-10);
    const out = { version: PLAYSTYLE_VERSION, matches: p.matches + 1, traits, headline: headline(traits), history };
    out.tuning = aiTuningFrom(out);
    out.adaptation = adaptationNotes(out);
    return out;
}
const pick = (o, keys) => Object.fromEntries(keys.filter(k => o?.[k] != null).map(k => [k, String(o[k]).slice(0, 80)]));

/** Default AI weights (no cached profile). */
export const DEFAULT_TUNING = Object.freeze(aiTuningFrom(null));

/**
 * Cached profile -> the weights the AI plays with this match. Each weight is ~1 for an average player and moves
 * toward 0.5..2 as the matching trait stands out. Rounded so every peer hashes the same numbers.
 */
export function aiTuningFrom(profile) {
    const p = sanitizeAiProfile(profile);
    const t = p ? p.traits : NEUTRAL;
    // Low match counts trust the profile less.
    const conf = p ? Math.min(1, p.matches / 3) : 0;
    const w = v => r2(1 + (v - 0.5) * 2 * conf);            // 0.5 -> 1, 1 -> 2, 0 -> 0 (at full confidence)
    return {
        overwatchCaution: r2(Math.max(0.5, w(t.overwatch))),   // weight on staying out of known overwatch cones
        flankGuard: r2(Math.max(0.5, w(t.flanking))),          // wants cover from every side, sticks with the pod
        spread: r2(Math.max(0.5, w((t.explosives + t.elements) / 2))),   // keeps apart from allies (grenade bait)
        ambush: r2(Math.max(0.5, w(t.aggression))),            // holds rooms and corners to ambush a rushing squad
        hunt: r2(Math.max(0.5, w(t.stealth))),                 // sweeps toward last known positions, investigates noise
        closeIn: r2(Math.max(0.5, w(t.range))),                // breaks sight lines and closes on long-range shooters
        flush: r2(Math.max(0.5, w(t.cover))),                  // flanks and throws fire/frag at dug-in targets
        doorWatch: r2(Math.max(0.5, w(t.breach))),             // stays off door/breach lines, covers entries
        keepAway: r2(Math.max(0.5, w(t.melee)))                // keeps distance from melee units
    };
}

/** Plain-language adaptation lines for the report. */
export function adaptationNotes(profile) {
    const p = sanitizeAiProfile(profile);
    if (!p) return [];
    const t = p.traits, out = [];
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
    if (!out.length) out.push('No strong habits yet: the AI plays its standard tactics.');
    return out;
}

/** Validate an untrusted profile (cache file, network, descriptor). Returns null when unusable. */
export function sanitizeAiProfile(p) {
    if (!p || typeof p !== 'object' || !p.traits || typeof p.traits !== 'object') return null;
    const traits = {};
    for (const k of Object.keys(TRAITS)) traits[k] = r2(clamp01(Number(p.traits[k] ?? 0.5)));
    const matches = Math.max(0, Math.min(1e6, Math.floor(Number(p.matches) || 0)));
    const history = Array.isArray(p.history) ? p.history.slice(-10).filter(h => h && typeof h === 'object').map(h => ({
        ...pick(h, ['outcome', 'scenario', 'at']),
        traits: Object.fromEntries(Object.keys(TRAITS).map(k => [k, r2(clamp01(Number(h.traits?.[k] ?? 0.5)))])),
        headline: Array.isArray(h.headline) ? h.headline.slice(0, 3).map(s => String(s).slice(0, 40)) : []
    })) : [];
    return { version: PLAYSTYLE_VERSION, matches, traits, history };
}
/** The part of a profile a battle needs (keeps scenario descriptors small). */
export function profileForDesc(p) {
    const s = sanitizeAiProfile(p);
    return s ? { version: s.version, matches: s.matches, traits: s.traits } : null;
}
/** Average several players' profiles (co-op squads) into one the AI plays against. */
export function blendProfiles(list) {
    const ps = list.map(sanitizeAiProfile).filter(Boolean);
    if (!ps.length) return null;
    const traits = {};
    for (const k of Object.keys(TRAITS)) traits[k] = r2(ps.reduce((s, p) => s + p.traits[k], 0) / ps.length);
    return { version: PLAYSTYLE_VERSION, matches: Math.min(...ps.map(p => p.matches)), traits };
}
