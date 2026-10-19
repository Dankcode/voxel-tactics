// Killstreak strikes: the Airstrike (carpet_bomb), the Orbital Laser (intel rules) and the Commander Strike (classic).
//
// footprint() is exactly what the HUD highlights, and every strike stays inside it:
//  - Airstrike (PLAN-12): one rectangle centred on the marked tile, its long side along the caster's facing. Three bombs
//    fall from above together at deterministic, seeded spots inside it (centres inset by the blast radius, kept apart).
//    The classic-rules killstreak (Commander Strike) is the same airstrike with lighter bombs.
//  - Orbital Laser: a narrower but much longer band (33 x 5) that cuts the whole line.
//  - Commander Strike: one big circle (radius 4).
//
// Depth: open ground only takes a crater one level deep. Structures above the ground floor take up to two storeys of
// destruction from the top down, and the strike never digs below the ground floor (no pits into basements).
import { AIR } from '../voxel/Materials.js';
import { scorchBlast } from '../voxel/Destruction.js';
import { occupiedCells } from './Walker.js';
import { alive } from './Units.js';

export const STRIKES = Object.freeze({
    carpet_bomb: { halfLength: 7, halfWidth: 4, bombs: 3, bombRadius: 3.5, minSeparation: 4, inset: true, damage: 40, edgeDamage: 0 },
    orbital_laser: { halfLength: 16, halfWidth: 2, coreWidth: 1, damage: 40 },
    killstreak_strike: { halfLength: 7, halfWidth: 4, bombs: 3, bombRadius: 3, minSeparation: 4, inset: true, damage: 25, edgeDamage: 0 }
});
const STOREY = 3;                        // shared/mission/BuildingBuilder.js STOREY
const STRUCTURE_DEPTH = 2 * STOREY;      // two storeys from the top of a building

/** Flight axis for a strike cast by `from` at `to`: along whichever axis the caster mostly faces. */
export function strikeAxis(to, from = null) {
    if (!from) return { ax: 1, ay: 0 };
    const dx = to.x - from.x, dy = to.y - from.y;
    return Math.abs(dx) >= Math.abs(dy) ? { ax: 1, ay: 0 } : { ax: 0, ay: 1 };
}
/** Top walkable surface of a column (what the highlight drapes over: roofs, streets, rubble). */
const topOf = (store, x, y, fallback) => { const t = store.topSolid(x, y); return t >= 0 ? t : fallback; };

/** Every tile the strike can affect, as highlight cells { x, y, z } (z = the column's top surface). */
export function footprint(b, id, to, from = null) {
    const s = STRIKES[id], cells = [], st = b.store;
    if (!s || !to) return cells;
    const { ax, ay } = strikeAxis(to, from);
    for (let along = -s.halfLength; along <= s.halfLength; along++) for (let side = -s.halfWidth; side <= s.halfWidth; side++) {
        const x = to.x + ax * along + ay * side, y = to.y + ay * along + ax * side;
        if (st.inBounds(x, y, 0)) cells.push({ x, y, z: topOf(st, x, y, to.z) });
    }
    return cells;
}

/**
 * Bomb centres for an airstrike: `bombs` seeded points inside the square (inset by the blast radius so every blast
 * stays inside the highlight), at least `minSeparation` apart. Bounded rejection sampling, then a fixed triangle.
 */
export function airstrikeBombs(b, to, from = null, id = 'carpet_bomb') {
    const s = STRIKES[id], { ax, ay } = strikeAxis(to, from), out = [];
    const inset = s.inset ? Math.floor(s.bombRadius) : 0, rl = Math.max(0, s.halfLength - inset), rw = Math.max(0, s.halfWidth - inset);
    const at = (along, side) => ({ x: to.x + ax * along + ay * side, y: to.y + ay * along + ax * side });
    const pick = () => at(Math.round((b.rng.next() * 2 - 1) * rl), Math.round((b.rng.next() * 2 - 1) * rw));
    // Fallback: spread along the long axis, alternating sides.
    const fallback = [[-1, -1], [0, 1], [1, -1]].map(([fa, fs]) => at(Math.round(fa * rl), Math.round(fs * rw)));
    for (let i = 0; i < s.bombs; i++) {
        let p = null;
        for (let k = 0; k < 40 && !p; k++) { const q = pick(); if (out.every(o => Math.hypot(o.x - q.x, o.y - q.y) >= s.minSeparation)) p = q; }
        if (!p) return fallback.slice(0, s.bombs);   // no room for a spread draw: the fixed pattern, whole
        out.push(p);
    }
    return out;
}
/**
 * Highlight cells for the floor in view (PLAN-10): each column is drawn on its highest standable surface below the
 * camera's storey cut, so the square sits on the floor you are looking at instead of on the roofs above it.
 */
export function drapeFootprint(store, cells, cutZ = Infinity) {
    if (!Number.isFinite(cutZ)) return cells;
    const out = [];
    for (const c of cells) {
        const s = store.surfaces(c.x, c.y).filter(q => q.z < cutZ - 1).at(-1);
        if (s) out.push({ x: c.x, y: c.y, z: s.z });
    }
    return out;
}

/** Remove a column's voxels for a strike: structure from the top down (`structure` levels), a crater of `crater`. */
function carveColumn(b, x, y, { structure = STRUCTURE_DEPTH, crater = 1 } = {}) {
    const st = b.store, W = st.width;
    if (!st.inBounds(x, y, 0)) return;
    const ground = b.grenadeGroundLevels?.[x + y * W] ?? 0;
    const top = st.topSolid(x, y);
    if (top < 0) return;
    const kill = z => {
        const m = st.material(x, y, z);
        if (m.id !== AIR && Number.isFinite(m.hp) && !m.liquid) { st.set(x, y, z, AIR); b.stats.voxelsDestroyed++; }
    };
    let low = ground + 1;
    if (top > ground) {
        // A building or anything standing on the ground floor: up to two storeys from the top.
        low = Math.max(ground + 1, top - structure + 1);
        for (let z = top; z >= low; z--) kill(z);
    }
    // Open ground (or a structure blown down to it): a crater one level deep, never into a basement.
    if (crater > 0 && low <= ground + 1 && ground >= 1) {
        let solidAbove = false;
        for (let z = ground + 1; z <= top; z++) if (st.isSolid(x, y, z)) { solidAbove = true; break; }
        if (!solidAbove) for (let z = ground; z > ground - crater && z >= 1; z--) kill(z);
    }
}

/** Run an Airstrike or Orbital Laser for `u` at `to`. Emits explosions and voxel changes, damages units. */
export function executeStrike(b, u, id, to) {
    const s = STRIKES[id], cells = footprint(b, id, to, u), hit = new Map();
    const hurt = (e, dmg) => hit.set(e.id, Math.max(hit.get(e.id) || 0, dmg));
    const inside = (e, test) => occupiedCells(e).some(p => test(p.x, p.y));
    const changes = b.store.record(() => {
        if (s.bombs) {
            const bombs = airstrikeBombs(b, to, u, id), r2 = s.bombRadius ** 2;
            // The salvo falls first (the client drops the bombs from the sky), then all of them burst at once.
            b.emit({ t: 'strike', unitId: u.id, abilityId: id, to, bombs: bombs.map(p => ({ x: p.x + 0.5, y: p.y + 0.5, h: topOf(b.store, p.x, p.y, to.z) + 1.2 })), radius: s.bombRadius, cells: cells.length });
            for (const c of cells) {
                const d2 = Math.min(...bombs.map(p => (c.x - p.x) ** 2 + (c.y - p.y) ** 2));
                if (d2 <= r2) carveColumn(b, c.x, c.y, { crater: d2 <= (s.bombRadius - 1.2) ** 2 ? 1 : 0 });
            }
            // All three bombs land together: one salvo, played at once by the client.
            bombs.forEach((p, i) => {
                const h = topOf(b.store, p.x, p.y, to.z) + 1.2;
                scorchBlast(b.store, { x: p.x + 0.5, y: p.y + 0.5, h, radius: s.bombRadius });
                b.emit({ t: 'explosion', x: p.x + 0.5, y: p.y + 0.5, h, radius: s.bombRadius, element: 'geo', source: id, salvo: i, of: bombs.length });
            });
            const inRect = (x, y) => cells.some(c => c.x === x && c.y === y);
            for (const e of b.units.filter(alive)) {
                if (inside(e, (x, y) => bombs.some(p => (x - p.x) ** 2 + (y - p.y) ** 2 <= r2))) hurt(e, s.damage);
                else if (s.edgeDamage && inside(e, inRect)) hurt(e, s.edgeDamage);
            }
        } else {
            const { ax, ay } = strikeAxis(to, u);
            for (const c of cells) {
                const side = Math.abs(ax ? c.y - to.y : c.x - to.x);
                carveColumn(b, c.x, c.y, { structure: Infinity, crater: side <= s.coreWidth ? 1 : 0 });
            }
            for (let along = -s.halfLength; along <= s.halfLength; along += 4) {
                const x = to.x + ax * along, y = to.y + ay * along;
                if (!b.store.inBounds(x, y, 0)) continue;
                const h = topOf(b.store, x, y, to.z) + 1;
                b.emit({ t: 'explosion', x: x + 0.5, y: y + 0.5, h, radius: s.halfWidth + 0.5, element: 'pyro', source: id });
            }
            for (const e of b.units.filter(alive)) if (inside(e, (x, y) => cells.some(c => c.x === x && c.y === y))) hurt(e, s.damage);
        }
        b.settle();
    });
    b.emit({ t: 'voxels', changes });
    for (const [uid, dmg] of hit) { const e = b.unit(uid); if (e && alive(e)) b.dealDamage(e, 'torso', dmg, { pierce: 99, source: id, applyStatuses: false }); }
    return cells;
}

/** Commander Strike (classic rules, PLAN-12): the same three-bomb airstrike over a rectangle, with lighter bombs. */
export function commanderStrike(b, u, to) { return executeStrike(b, u, 'killstreak_strike', to); }
