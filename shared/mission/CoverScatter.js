// Outdoor cover pass (PLAN-01 §13.3, "no killing fields"): scatters low walls, sandbags, crates, carts, barrels,
// rocks, fences, hay bales and ruined wall stubs over open ground until every outdoor tile is within a short
// move of cover and a target share of outdoor tiles is covered.
//
// Rules that keep the map playable:
//  * a prop never touches another solid voxel (1-tile clearance all round), so it can't seal a street, alley,
//    doorway or bridge; it only ever adds cover to open ground;
//  * door fronts, spawn areas and anything the caller marks as blocked stay clear;
//  * props sit on the top surface with 2+ voxels of headroom (never under roofs or inside rooms).
// The gap to the nearest covered tile is measured by a breadth-first search over outdoor tiles, and each new
// prop goes next to the tile currently farthest from cover, so cover spreads evenly instead of clumping.
import { MAT, AIR, materialById } from '../voxel/Materials.js';
import { coverAt, COVER } from '../voxel/Cover.js';

/** Prop recipes: cells along a line perpendicular to the side they protect. h = voxel height per cell. */
export const COVER_PROPS = {
    low_wall: { len: [2, 4], h: 1, mat: 'stone', cover: 'half', w: 3 },
    sandbags: { len: [2, 3], h: 1, mat: 'sandbag', cover: 'half', w: 3 },
    fence: { len: [3, 4], h: 1, mat: 'timber', cover: 'half', w: 2, ground: ['grass', 'forest_floor', 'soil'] },
    hay: { len: [2, 2], h: 1, mat: 'hay', cover: 'half', w: 2, ground: ['grass', 'forest_floor', 'soil', 'road'] },
    crates: { len: [1, 2], h: 2, mat: 'crate', cover: 'full', w: 2, top: 'crate', ground: ['road', 'cobble', 'stone_floor', 'grass', 'sand'] },
    cart: { len: [3, 3], h: 1, mat: 'furniture', cover: 'half', w: 2, ends: 'crate', ground: ['road', 'cobble', 'grass'] },
    barrels: { len: [2, 3], h: 1, mat: 'barrel_water', cover: 'half', w: 1, mix: 'barrel_powder', ground: ['road', 'cobble', 'stone_floor', 'grass'] },
    rocks: { len: [1, 2], h: 2, mat: 'stone', cover: 'full', w: 1.5, ground: ['grass', 'forest_floor', 'sand', 'snow', 'soil'] },
    ruin: { len: [2, 3], h: 2, mat: 'stone', cover: 'full', w: 1.2, broken: true }
};

/**
 * @param store VoxelStore
 * @param opts { rng, blocked(x, y) → bool, maxGap = 4, targetShare = 0.3, budget, margin = 2, props = COVER_PROPS }
 * @returns { placed: [{type, x, y, z, cells}], metrics: { outdoor, covered, share, maxGap } }
 */
export function scatterCover(store, opts = {}) {
    const { rng, blocked = () => false, maxGap = 4, targetShare = 0.3, margin = 1, props = COVER_PROPS } = opts;
    const W = store.width, D = store.depth;
    const budget = opts.budget ?? Math.round(W * D / 32);
    const top = (x, y) => store.surfaces(x, y).at(-1) || null;
    const isOutdoor = (x, y) => {
        if (x < margin || y < margin || x >= W - margin || y >= D - margin || blocked(x, y)) return null;
        const s = top(x, y);
        if (!s || s.headroom < 3) return null;
        const m = materialById(store.get(x, y, s.z));
        if (m.liquid || store.roomAt(x, y, s.z + 1) >= 0) return null;
        return s;
    };
    const placed = [];
    const isCovered = (s) => { const c = coverAt(store, s.x, s.y, s.z); return Math.max(c.n, c.e, c.s, c.w) >= COVER.HALF; };

    const measure = () => {
        const outdoor = [];
        const dist = new Map();
        const queue = [];
        for (let y = 0; y < D; y++) for (let x = 0; x < W; x++) {
            const s = isOutdoor(x, y); if (!s) continue;
            outdoor.push(s);
            if (isCovered(s)) { dist.set(x + y * W, 0); queue.push(s); }
        }
        const byKey = new Map(outdoor.map(s => [s.x + s.y * W, s]));
        for (let i = 0; i < queue.length; i++) {
            const s = queue[i], d = dist.get(s.x + s.y * W);
            for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
                const k = (s.x + dx) + (s.y + dy) * W, n = byKey.get(k);
                if (!n || dist.has(k) || Math.abs(n.z - s.z) > 1) continue;
                dist.set(k, d + 1); queue.push(n);
            }
        }
        // Tiles the search never reached (prop tops, isolated plateaus) don't count toward the gap, except that
        // with no cover at all every tile is "infinitely" far.
        let covered = 0, worst = queue.length ? 0 : 99;
        for (const s of outdoor) { const d = dist.get(s.x + s.y * W); if (d === 0) covered++; if (d != null) worst = Math.max(worst, d); }
        return { outdoor, dist, covered, share: outdoor.length ? covered / outdoor.length : 1, maxGap: worst };
    };

    const clear = (x, y, z, own) => {
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
            const k = `${x + dx},${y + dy}`;
            if (own.has(k)) continue;
            for (let h = 1; h <= 2; h++) if (store.isSolid(x + dx, y + dy, z + h)) return false;
            // also keep doorways and stairs one tile away
            const g = materialById(store.get(x + dx, y + dy, z + 1));
            if (g.part === 2 || materialById(store.get(x + dx, y + dy, z)).part === 4) return false;
        }
        return true;
    };

    const tryPlace = (target, type) => {
        const p = props[type];
        const groundKey = materialById(store.get(target.x, target.y, target.z)).key;
        if (p.ground && !p.ground.includes(groundKey) && rng.next() < 0.85) return null;
        const sides = rng.shuffle([[0, -1], [1, 0], [0, 1], [-1, 0]]);
        for (const [sx, sy] of sides) {
            const len = p.len[0] + Math.floor(rng.next() * (p.len[1] - p.len[0] + 1));
            const px = -sy, py = sx;                    // along the prop (perpendicular to the protected side)
            const start = -Math.floor((len - 1) / 2) - (len > 1 && rng.next() < 0.5 ? 0 : 0);
            const cells = [];
            for (let i = 0; i < len; i++) cells.push([target.x + sx + px * (start + i), target.y + sy + py * (start + i)]);
            const own = new Set(cells.map(([x, y]) => `${x},${y}`));
            let ok = true;
            for (const [x, y] of cells) {
                const s = isOutdoor(x, y);
                if (!s || s.z !== target.z || !clear(x, y, s.z, own)) { ok = false; break; }
            }
            if (!ok) continue;
            const out = [];
            cells.forEach(([x, y], i) => {
                let h = p.h, mat = p.mat;
                if (p.broken) h = rng.next() < 0.4 ? 1 : 2;
                if (p.ends && (i === 0 || i === cells.length - 1)) mat = p.ends;
                if (p.mix && rng.next() < 0.25) mat = p.mix;
                if (type === 'rocks' && i > 0) h = 1;
                for (let k = 1; k <= h; k++) {
                    const m = k === h && p.top ? p.top : mat;
                    store.set(x, y, target.z + k, MAT[m]);
                }
                out.push([x, y, h, mat]);
            });
            return { type, x: target.x, y: target.y, z: target.z, cells: out };
        }
        return null;
    };

    const weights = Object.entries(props).map(([k, p]) => [k, p.w]);
    const pick = () => {
        let t = rng.next() * weights.reduce((s, [, w]) => s + w, 0);
        for (const [k, w] of weights) { t -= w; if (t <= 0) return k; }
        return weights[0][0];
    };

    let m = measure();
    for (let n = 0; n < budget; n++) {
        if (m.maxGap <= maxGap && m.share >= targetShare) break;
        // Farthest-from-cover tiles first (ties broken by the seeded rng).
        const far = m.outdoor.filter(s => (m.dist.get(s.x + s.y * W) ?? 99) >= 2);
        if (!far.length) break;
        far.sort((a, b) => (m.dist.get(b.x + b.y * W) ?? 99) - (m.dist.get(a.x + a.y * W) ?? 99));
        const pool = far.slice(0, Math.max(6, Math.floor(far.length * 0.08)));
        let done = null;
        for (let tries = 0; tries < 12 && !done; tries++) done = tryPlace(pool[Math.floor(rng.next() * pool.length)], pick());
        if (!done) { // nothing fits around the far tiles; mark one so the loop moves on
            const s = pool[0]; m.dist.set(s.x + s.y * W, 0); continue;
        }
        placed.push(done);
        m = measure();
    }
    return { placed, metrics: { outdoor: m.outdoor.length, covered: m.covered, share: m.share, maxGap: m.maxGap } };
}

export { AIR };
