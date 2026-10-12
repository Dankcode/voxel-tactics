// Test ground (admin build): run any map with a custom hostile roster and a few mission overrides.
//
// desc.test = {
//   enemies:   [{ type, count }] | null   replace the map's hostiles (null keeps the map's own pods)
//   podSize:   1–4                         hostiles per pod (pods are mixed round-robin across types)
//   alerted:   boolean                     every hostile starts alerted (no first-contact scatter)
//   objective: 'map' | 'eliminate'         keep the map's objective or make it "eliminate every hostile"
//   rounds:    3–60 | null                 deadline: the mission fails at the end of that round
//   timeOfDay: 'day' | … | null            lighting override
// }
//
// Everything here is deterministic from (mission, desc.test, seed): the server and every co-op peer apply the same
// overrides to the same compiled mission, so lockstep hashes still agree. The mission itself is not rebuilt.
import { ENEMIES } from '../content/units.js';
import { reachable } from '../world/PathSearch.js';
import { AGENT_PROFILES } from '../world/TraversalRules.js';
import { MAT } from '../voxel/Materials.js';
import { createRng, hashString } from '../util/Rng.js';
import { facingToward } from '../battle/Units.js';

export const TEST_TIMES = Object.freeze(['day', 'dawn', 'dusk', 'overcast', 'night', 'night-ops']);
export const TEST_LIMITS = Object.freeze({ perType: 12, total: 24, podSize: [1, 4], rounds: [3, 60], minSpawnDistance: 10 });
export const ENEMY_TYPES = Object.freeze(Object.keys(ENEMIES));

/** Ready-made rosters for the test-ground panel (counts per enemy type). */
export const TEST_PRESETS = Object.freeze({
    patrol: { name: 'Light patrol', enemies: { cultist: 3, archer: 1 } },
    guard: { name: 'Guard post', enemies: { warden_foe: 3, archer: 2 } },
    arson: { name: 'Arson cell', enemies: { pyromancer: 3, cultist: 2 } },
    rush: { name: 'Brute rush', enemies: { brute: 4, cultist: 2 } },
    swarm: { name: 'Mixed swarm', enemies: { cultist: 4, archer: 3, pyromancer: 2, brute: 2, warden_foe: 2 } },
    solo: { name: 'Single target', enemies: { cultist: 1 } }
});

/** Validate and normalise test-ground settings (server rooms, deep links). Returns null when absent. */
export function sanitizeTest(t) {
    if (t == null) return null;
    if (typeof t !== 'object' || Array.isArray(t)) throw Error('Invalid test ground settings');
    let enemies = null;
    if (t.enemies != null) {
        if (!Array.isArray(t.enemies) || t.enemies.length > 32) throw Error('Invalid test ground roster');
        const counts = {};
        for (const e of t.enemies) {
            if (!e || typeof e !== 'object' || !Object.hasOwn(ENEMIES, e.type)) throw Error(`Unknown enemy type: ${e?.type}`);
            const n = Number(e.count);
            if (!Number.isInteger(n) || n < 0 || n > TEST_LIMITS.perType) throw Error(`Enemy count for ${e.type} must be 0–${TEST_LIMITS.perType}`);
            counts[e.type] = (counts[e.type] || 0) + n;
        }
        enemies = ENEMY_TYPES.filter(k => counts[k] > 0).map(type => ({ type, count: counts[type] }));
        const total = enemies.reduce((s, e) => s + e.count, 0);
        if (total < 1 || total > TEST_LIMITS.total) throw Error(`Test ground needs 1–${TEST_LIMITS.total} hostiles (got ${total})`);
        if (enemies.some(e => e.count > TEST_LIMITS.perType)) throw Error(`At most ${TEST_LIMITS.perType} of one enemy type`);
    }
    const podSize = Number.isInteger(Number(t.podSize)) ? Math.min(TEST_LIMITS.podSize[1], Math.max(TEST_LIMITS.podSize[0], Number(t.podSize))) : 3;
    const r = Number(t.rounds);
    const rounds = t.rounds == null || t.rounds === '' || !Number.isFinite(r) || r <= 0 ? null : Math.min(TEST_LIMITS.rounds[1], Math.max(TEST_LIMITS.rounds[0], Math.round(r)));
    return {
        enemies, podSize, alerted: t.alerted === true, objective: t.objective === 'eliminate' ? 'eliminate' : 'map', rounds,
        timeOfDay: TEST_TIMES.includes(t.timeOfDay) ? t.timeOfDay : null
    };
}

/** Is a test descriptor doing anything (so the report and HUD can label it)? */
export const isTestActive = test => !!test && (!!test.enemies || test.alerted || test.objective !== 'map' || !!test.rounds || !!test.timeOfDay);

/**
 * Apply the overrides to a freshly built (or unpacked) mission and return the hostile list for the Battle, or null
 * to keep `mission.spawns.enemy`. Mutates `mission.meta` / `mission.objective` only.
 */
export function applyTestGround(mission, test, seed = 1) {
    if (!isTestActive(test)) return null;
    mission.meta ||= {};
    if (test.timeOfDay) mission.meta.timeOfDay = test.timeOfDay;
    if (test.objective === 'eliminate') mission.objective = { kind: 'eliminate', text: 'Test ground: eliminate every hostile.' };
    if (test.rounds) mission.objective = { ...(mission.objective || { kind: 'eliminate' }), turns: test.rounds };
    let enemies = null;
    if (test.enemies) {
        enemies = placeTestEnemies(mission, test, seed);
        // Recover/hold/extract need nothing from the roster; an emptied enemy roster is rejected by sanitizeTest.
        mission.spawns = { ...mission.spawns, enemy: enemies };
    } else if (test.alerted) enemies = mission.spawns.enemy.map(e => ({ ...e, alerted: true }));
    if (enemies && test.alerted) for (const e of enemies) e.alerted = true;
    mission.meta.testGround = { ...test, hostiles: (enemies || mission.spawns.enemy).length };
    return enemies;
}

/**
 * Place a roster as pods. Anchors, in order: the map's own pod positions, then (seed-shuffled) engagement pockets
 * and gameplay rooms, then the reachable cells farthest from the squad. Members take the nearest free reachable
 * cells around their anchor (same level first), never closer than TEST_LIMITS.minSpawnDistance to a squad spawn,
 * never on a doorway, ladder or occupied cell. Throws when the map cannot hold the roster.
 */
export function placeTestEnemies(mission, test, seed = 1) {
    const store = mission.store, squad = mission.spawns.player, start = squad[0];
    const rng = createRng(hashString(`test-ground:${seed}:${mission.id || mission.name || ''}`));
    const search = reachable(store, start, Infinity, AGENT_PROFILES.player);
    const near = p => Math.min(...squad.map(s => Math.hypot(s.x - p.x, s.y - p.y)));
    const blocked = c => [MAT.door, MAT.door_open, MAT.door_locked, MAT.ladder].includes(store.get(c.x, c.y, c.z + 1)) || store.get(c.x, c.y, c.z) === MAT.ladder;
    const usable = [...search.nodes.values()].filter(c => near(c) >= TEST_LIMITS.minSpawnDistance && !blocked(c) && !store.material(c.x, c.y, c.z).liquid)
        .sort((a, b) => a.z - b.z || a.y - b.y || a.x - b.x);
    if (!usable.length) throw Error('Test ground: no reachable cell far enough from the squad for hostiles');
    const nearestUsable = p => {
        let best = null, bd = Infinity;
        for (const c of usable) { const d = Math.hypot(c.x - p.x, c.y - p.y) + Math.abs(c.z - (p.z ?? c.z)); if (d < bd) { bd = d; best = c; } }
        return best;
    };
    // Anchors.
    const own = [], seen = new Set();
    for (const e of mission.spawns.enemy || []) if (!seen.has(e.group)) { seen.add(e.group); own.push(e.pos); }
    const G = mission.meta?.streetDatum ?? start.z;
    const extra = [...(mission.meta?.pockets || []).map(p => ({ x: p.x, y: p.y, z: G })),
        ...(mission.rooms || []).filter(r => r.gameplay !== false && r.cells?.length).map(r => { const c = r.cells[Math.floor(r.cells.length / 2)]; return { x: c[0], y: c[1], z: r.floorZ }; })];
    rng.shuffle(extra);
    const far = usable.slice().sort((a, b) => near(b) - near(a) || a.z - b.z || a.y - b.y || a.x - b.x).filter((_, i) => i % 7 === 0);
    const anchors = [];
    for (const p of [...own, ...extra, ...far]) {
        const c = nearestUsable(p);
        if (c && anchors.every(a => Math.hypot(a.x - c.x, a.y - c.y) + Math.abs(a.z - c.z) >= 6)) anchors.push(c);
    }
    // Mixed pods: deal the roster round-robin across types, then cut it into pods.
    const queues = test.enemies.map(e => Array(e.count).fill(e.type)), units = [];
    while (queues.some(q => q.length)) for (const q of queues) if (q.length) units.push(q.shift());
    const pods = [];
    for (let i = 0; i < units.length; i += test.podSize) pods.push(units.slice(i, i + test.podSize));
    const taken = new Set(), key = c => `${c.x},${c.y},${c.z}`, out = [];
    pods.forEach((pod, g) => {
        const anchor = anchors[g % Math.max(1, anchors.length)];
        const order = usable.filter(c => !taken.has(key(c)))
            .map(c => ({ c, d: Math.hypot(c.x - anchor.x, c.y - anchor.y) + Math.abs(c.z - anchor.z) * 2 }))
            .sort((a, b) => a.d - b.d || a.c.z - b.c.z || a.c.y - b.c.y || a.c.x - b.c.x);
        if (order.length < pod.length) throw Error(`Test ground: the map has room for only ${out.length + order.length} hostiles`);
        pod.forEach((type, k) => {
            const c = order[k].c; taken.add(key(c));
            out.push({ type, group: g, pos: { x: c.x, y: c.y, z: c.z }, facing: facingToward(start.x - c.x, start.y - c.y), alerted: !!test.alerted });
        });
    });
    return out;
}
