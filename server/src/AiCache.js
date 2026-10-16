// PLAN-09: the AI cache. One JSON file (server/data/ai-cache.json, gitignored) holding what the squad's playstyle
// looks like across matches and how the AI adapts to it. The server reads it when a mission room opens (the profile
// goes into the scenario descriptor, so every peer builds the same AI) and updates it when a battle ends. Local games
// post their result to /api/ai-cache.
//
// {
//   "version": 1, "updatedAt": ISO time,
//   "squad":   profile,                      // every match, every player: what the AI plays against by default
//   "players": { "<name>": profile }         // per player name (online co-op)
// }
// profile = { version, matches, traits {aggression..melee 0..1}, headline [..], history [{outcome, scenario, at,
//             traits, headline}], tuning {AI weights}, adaptation ["you do X: the AI now does Y", ..] }
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mergeProfile, sanitizeAiProfile, blendProfiles, profileForDesc, headline, aiTuningFrom, adaptationNotes, PLAYSTYLE_VERSION, TRAITS } from '../../shared/session/Playstyle.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
// Tests (node --test sets NODE_TEST_CONTEXT) never touch the real cache.
export const AI_CACHE_FILE = process.env.AI_CACHE_FILE
    || (process.env.NODE_TEST_CONTEXT ? path.join(os.tmpdir(), `vt-ai-cache-test-${process.pid}.json`) : path.join(ROOT, 'server/data/ai-cache.json'));

const empty = () => ({ version: PLAYSTYLE_VERSION, updatedAt: null, squad: null, players: {} });
const cleanName = n => String(n || '').trim().slice(0, 24);

export function readAiCache(file = AI_CACHE_FILE) {
    try {
        const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
        const out = empty();
        out.updatedAt = typeof raw.updatedAt === 'string' ? raw.updatedAt.slice(0, 40) : null;
        out.squad = full(raw.squad);
        for (const [name, p] of Object.entries(raw.players || {}).slice(0, 64)) { const s = full(p); if (s && cleanName(name)) out.players[cleanName(name)] = s; }
        return out;
    } catch { return empty(); }
}
/** A stored profile with its derived fields (headline, tuning, adaptation) recomputed from the sanitized traits. */
function full(p) {
    const s = sanitizeAiProfile(p);
    return s ? { ...s, headline: headline(s.traits), tuning: aiTuningFrom(s), adaptation: adaptationNotes(s) } : null;
}

function writeAiCache(cache, file = AI_CACHE_FILE) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(cache, null, 2));
    fs.renameSync(tmp, file);
}

/** The profile a new battle plays against: the named players' profiles blended, else the squad profile. */
export function aiProfileFor(names = [], file = AI_CACHE_FILE) {
    const c = readAiCache(file);
    const mine = names.map(cleanName).map(n => c.players[n]).filter(Boolean);
    return profileForDesc(mine.length ? blendProfiles(mine) : c.squad);
}

/**
 * Roll one finished match into the cache. `style` = playstyleFromBattle(...) (or report.playstyle); meta = { outcome,
 * scenario }. Returns the updated squad profile.
 */
export function recordAiMatch(style, meta = {}, names = [], file = AI_CACHE_FILE) {
    if (!style?.traits || typeof style.traits !== 'object') throw Error('playstyle traits required');
    const clean = { traits: Object.fromEntries(Object.keys(TRAITS).map(k => [k, Number(style.traits[k] ?? 0.5)])), headline: Array.isArray(style.headline) ? style.headline.slice(0, 3).map(s => String(s).slice(0, 40)) : undefined };
    const c = readAiCache(file), at = new Date().toISOString();
    const m = { outcome: meta.outcome, scenario: meta.scenario, at };
    c.squad = mergeProfile(c.squad, clean, m);
    for (const n of [...new Set(names.map(cleanName).filter(Boolean))]) c.players[n] = mergeProfile(c.players[n], clean, m);
    c.updatedAt = at;
    writeAiCache(c, file);
    return c.squad;
}

/** Express routes: GET /api/ai-cache (the whole cache), POST /api/ai-cache { style, meta, player? } (a local match). */
export function aiCacheRoutes(app, file = AI_CACHE_FILE) {
    app.get('/api/ai-cache', (_, res) => res.json(readAiCache(file)));
    app.post('/api/ai-cache', (req, res) => {
        try {
            const { style, meta, player } = req.body || {};
            const squad = recordAiMatch(style, meta || {}, player ? [player] : [], file);
            res.json({ ok: true, squad });
        } catch (error) { res.status(400).json({ ok: false, error: error.message }); }
    });
}
