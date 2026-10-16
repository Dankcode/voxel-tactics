// PLAN-09: the client side of the AI cache. Local games read the squad's playstyle profile before the battle is
// built (it rides in desc.aiProfile, so the AI adapts deterministically) and post each finished match back. The
// server keeps the JSON file (server/data/ai-cache.json); this browser keeps a copy so a static build without the
// server still adapts. Online games are recorded by the mission room itself.
import { mergeProfile, sanitizeAiProfile } from '../../../shared/session/Playstyle.js';

const KEY = 'voxel-tactics.ai-profile.v1';
const local = () => { try { return sanitizeAiProfile(JSON.parse(localStorage.getItem(KEY) || 'null')); } catch { return null; } };
const keep = p => { try { if (p) localStorage.setItem(KEY, JSON.stringify(p)); } catch { /* storage unavailable */ } };

/** The squad profile the AI plays against: the server cache when reachable, else this browser's copy. */
export async function loadAiProfile() {
    try {
        const r = await fetch('/api/ai-cache', { cache: 'no-store' });
        if (r.ok) { const c = await r.json(); if (c?.squad) { keep(c.squad); return sanitizeAiProfile(c.squad); } }
    } catch { /* no server: fall back */ }
    return local();
}

/** Record a finished local match (report.playstyle). Resolves to the updated profile (server's when it answered). */
export async function recordLocalMatch(style, meta = {}) {
    if (!style?.traits) return null;
    const at = new Date().toISOString();
    let profile = mergeProfile(local(), style, { ...meta, at });
    keep(profile);
    try {
        const r = await fetch('/api/ai-cache', { method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ style: { traits: style.traits, headline: style.headline }, meta }) });
        if (r.ok) { const j = await r.json(); if (j?.squad) { profile = j.squad; keep(profile); } }
    } catch { /* offline: the browser copy stands */ }
    return profile;
}
