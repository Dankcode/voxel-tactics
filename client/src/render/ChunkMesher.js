// Face-culled chunk mesher: one buffer per render material (RenderTable.js) with world-space or per-face UVs,
// normals, and vertex colours that carry corner ambient occlusion, large-scale variation and fog-of-war tint.
// Pure (no THREE): returns typed-array-ready lists so it can move into a worker later without changes.
// World voxel (x, y, z) → three.js (x, z, y): three's Y is up.
import { MATERIALS, AIR } from '../../../shared/voxel/Materials.js';
import { CHUNK } from '../../../shared/voxel/VoxelStore.js';
import { renderFor, KIND_GROUP } from './RenderTable.js';

// faces: normal, 4 corners (offsets in voxel space x,y,z), uv axes (indices into [x, y, z])
const FACES = [
    { n: [0, 0, 1], c: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]], u: 0, v: 1, top: true },     // top (+z)
    { n: [0, 0, -1], c: [[0, 1, 0], [1, 1, 0], [1, 0, 0], [0, 0, 0]], u: 0, v: 1 },              // bottom
    { n: [1, 0, 0], c: [[1, 0, 0], [1, 1, 0], [1, 1, 1], [1, 0, 1]], u: 1, v: 2 },                // +x
    { n: [-1, 0, 0], c: [[0, 1, 0], [0, 0, 0], [0, 0, 1], [0, 1, 1]], u: 1, v: 2, flipU: true },  // -x
    { n: [0, 1, 0], c: [[1, 1, 0], [0, 1, 0], [0, 1, 1], [1, 1, 1]], u: 0, v: 2, flipU: true },   // +y
    { n: [0, -1, 0], c: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]], u: 0, v: 2 }                // -y
];

function hash2(x, y) { let h = (x * 374761393 + y * 668265263) | 0; h = (h ^ (h >>> 13)) * 1274126177; return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }
function hash3(x, y, z) { return hash2(x * 31 + z * 7919, y); }
/** Smooth value noise in [0, 1] (macro variation across the map). */
export function valueNoise(x, y) {
    const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
    const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
    const a = hash2(x0, y0), b = hash2(x0 + 1, y0), c = hash2(x0, y0 + 1), d = hash2(x0 + 1, y0 + 1);
    return (a + (b - a) * sx) + ((c + (d - c) * sx) - (a + (b - a) * sx)) * sy;
}

/** occluder test for AO and culling: opaque, rendered solids. */
function opaqueAt(store, x, y, z) {
    const id = store.get(x, y, z);
    if (id === AIR) return false;
    const m = MATERIALS[id];
    return m.render === 'solid' || m.render === 'foliage';
}

/**
 * Build geometry for chunk (cx, cy, cz). `options.tint(x, y, z, m)` → [r, g, b] multiplier (fog of war).
 * Returns [{ key: render key, group: 0 opaque | 1 glass | 2 water, positions, normals, uvs, colors, indices }]
 */
export function meshChunk(store, cx, cy, cz, options = {}) {
    const out = new Map();
    const bufFor = (key, r) => {
        let b = out.get(key);
        if (!b) out.set(key, b = { key, group: KIND_GROUP[r.kind || 'opaque'], positions: [], normals: [], uvs: [], colors: [], rims: [], grids: [], indices: [] });
        return b;
    };
    const x0 = cx * CHUNK, y0 = cy * CHUNK, z0 = cz * CHUNK;
    const tint = options.tint || null;
    const cut = options.cutZ ?? Infinity;          // storey cutaway: voxels at z >= cut are not drawn
    const kit = options.kit || (() => null);      // voxels the tile set draws (thin walls, props …) are skipped
    const opaque = (x, y, z) => z < cut && opaqueAt(store, x, y, z);
    const hides = (x, y, z) => opaque(x, y, z) && !kit(store, x, y, z);   // only full cubes hide a neighbour's face
    const apron = !!options.apron;               // the map edge continues as an apron: no boundary side faces
    const W = store.width, D = store.depth;
    const inMap = (x, y) => x >= 0 && y >= 0 && x < W && y < D;
    const aoCorner = (f, x, y, z, dx, dy, dz) => {
        const face = FACES[f];
        let occ = 0;
        const cxw = x + dx, cyw = y + dy, czw = z + dz;
        const sx = dx ? 0 : -1, sy = dy ? 0 : -1, sz = dz ? 0 : -1;
        const ox = face.n[0] ? (face.n[0] > 0 ? 0 : -1) : null, oy = face.n[1] ? (face.n[1] > 0 ? 0 : -1) : null, oz = face.n[2] ? (face.n[2] > 0 ? 0 : -1) : null;
        for (const ddx of ox !== null ? [ox] : [sx, sx + 1]) for (const ddy of oy !== null ? [oy] : [sy, sy + 1]) for (const ddz of oz !== null ? [oz] : [sz, sz + 1]) {
            if (opaque(cxw + ddx, cyw + ddy, czw + ddz)) occ++;
        }
        return 1 - Math.min(3, Math.max(0, occ - 1)) * 0.2;
    };
    /** Push a quad (voxel-space points [x, y, z], counter-clockwise or not — winding is fixed against `n`). */
    const quad = (buf, pts, n, uvs, ks, t, rim = [0, 0, 0, 0], grid = 0) => {
        const start = buf.positions.length / 3;
        const a = pts[0], b = pts[1], c = pts[2];
        // three space: (x, z, y). Cross product of (b - a) × (c - a) in three space vs the normal in three space.
        const u = [b[0] - a[0], b[2] - a[2], b[1] - a[1]], v = [c[0] - a[0], c[2] - a[2], c[1] - a[1]];
        const cr = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
        const flip = cr[0] * n[0] + cr[1] * n[2] + cr[2] * n[1] < 0;
        pts.forEach((p, i) => {
            buf.positions.push(p[0], p[2], p[1]);
            buf.normals.push(n[0], n[2], n[1]);
            buf.uvs.push(uvs[i][0], uvs[i][1]);
            const k = ks[i];
            buf.colors.push(k * (t ? t[0] : 1), k * (t ? t[1] : 1), k * (t ? t[2] : 1));
            buf.rims.push(...rim); buf.grids.push(grid);
        });
        if (flip) buf.indices.push(start, start + 2, start + 1, start, start + 3, start + 2);
        else buf.indices.push(start, start + 1, start + 2, start, start + 2, start + 3);
    };
    const dropOf = key => renderFor(key).drop || 0;
    const SIDE = [{ d: [0, -1], f: 5 }, { d: [1, 0], f: 2 }, { d: [0, 1], f: 4 }, { d: [-1, 0], f: 3 }];   // N E S W
    /**
     * Opaque terrain / slab voxel with rounded edges: the top face is inset where the ground drops away and a 45°
     * chamfer joins it to the side faces; materials with a `drop` (roads) sit lower than their neighbours, which then
     * show a curb strip; faces on the map boundary are skipped when the apron continues the ground.
     */
    function emitRounded(x, y, z, m, base, var0, t) {
        const r0 = base;
        const topNeighbour = z + 1 >= cut ? AIR : store.get(x, y, z + 1);
        const topDrawn = !hides(x, y, z + 1);
        const capped = topDrawn && z + 1 >= cut && store.get(x, y, z + 1) !== AIR && opaqueAt(store, x, y, z + 1) && !kit(store, x, y, z + 1);
        const live = topDrawn && !capped;
        const my = live ? dropOf(m.key) : 0;
        const T = z + 1 - my;
        const bevel = live ? (r0.bevel ?? 0.08) : 0;
        const e = [0, 0, 0, 0], curb = [0, 0, 0, 0];
        SIDE.forEach(({ d: [dx, dy] }, i) => {
            const nx = x + dx, ny = y + dy;
            if (!inMap(nx, ny)) { e[i] = apron ? 0 : bevel; return; }
            const nm = MATERIALS[store.get(nx, ny, z)];
            const nSolid = nm.solid && !nm.liquid && z < cut;
            if (!nSolid) { e[i] = bevel; return; }
            if (!live) return;
            const nLive = !hides(nx, ny, z + 1) && !(z + 1 >= cut);
            const nd = nLive && hides(nx, ny, z) ? dropOf(nm.key) : 0;
            if (nd > my + 0.01) { curb[i] = nd - my; e[i] = Math.min(bevel, curb[i] * 0.45); }
        });
        // ---- top + chamfers
        if (topDrawn) {
            const key = m.key, r = r0, buf = bufFor(key, r), scale = r.scale || 1, faceUv = r.uv === 'face';
            let grid = 0, rim = [0, 0, 0, 0], elev = 1;
            if (!capped) {
                grid = m.walkable && !(z + 1 < cut && store.isSolid(x, y, z + 1)) ? 1 : 0;
                if (grid) rim = [[0, -1], [1, 0], [0, 1], [-1, 0]].map(([dx, dy]) => {
                    if (store.isSolid(x + dx, y + dy, z)) return 0;
                    if (!inMap(x + dx, y + dy)) return 0;
                    let dd = 1; while (dd < 4 && z - dd >= 0 && !store.isSolid(x + dx, y + dy, z - dd)) dd++;
                    return dd;
                });
                elev = 1 + Math.min(0.24, 0.03 * Math.max(0, z - 1));
            }
            const uvOf = p => faceUv ? [p[0] - x, p[1] - y] : [p[0] / scale, p[1] / scale];
            const corner = (cx2, cy2) => [x + (cx2 ? 1 - e[1] : e[3]), y + (cy2 ? 1 - e[2] : e[0]), T];
            const cs = [[0, 0], [1, 0], [1, 1], [0, 1]];
            const pts = cs.map(([a, b]) => corner(a, b));
            const ks = cs.map(([a, b]) => var0 * elev * aoCorner(0, x, y, z, a, b, 1) * (capped ? 0.55 : 1));
            quad(buf, pts, [0, 0, 1], pts.map(uvOf), ks, t, rim, grid);
            // Chamfers: N (y = 0), E (x = 1), S (y = 1), W (x = 0).
            const edgeCorners = [[[0, 0], [1, 0]], [[1, 0], [1, 1]], [[1, 1], [0, 1]], [[0, 1], [0, 0]]];
            SIDE.forEach(({ d: [dx, dy] }, i) => {
                if (!(e[i] > 0)) return;
                const [[a0, b0], [a1, b1]] = edgeCorners[i];
                const inner = [corner(a0, b0), corner(a1, b1)];
                const outer = [[x + a0, y + b0, T - e[i]], [x + a1, y + b1, T - e[i]]];
                const n = [dx * 0.7071, dy * 0.7071, 0.7071];
                const kk = [ks[cs.findIndex(c => c[0] === a0 && c[1] === b0)], ks[cs.findIndex(c => c[0] === a1 && c[1] === b1)]];
                const q = [inner[0], inner[1], outer[1], outer[0]];
                quad(buf, q, n, q.map(uvOf), [kk[0], kk[1], kk[1] * 0.86, kk[0] * 0.86], t, rim, 0);
            });
        }
        // ---- sides (and curb strips)
        SIDE.forEach(({ d: [dx, dy], f }, i) => {
            const nx = x + dx, ny = y + dy;
            if (!inMap(nx, ny) && apron) return;
            const top = live ? T - e[i] : z + 1;
            let bottom = z;
            if (hides(nx, ny, z)) { if (!(curb[i] > 0)) return; bottom = z + 1 - (my + curb[i]); }
            const face = FACES[f];
            let key = m.key, r = r0;
            if (r0.side) { key = live ? r0.side : 'soil'; r = renderFor(key); }
            const buf = bufFor(key, r), scale = r.scale || 1, faceUv = r.uv === 'face';
            // Corners along this side: (a, b) in cell units; f 2 = +x, 3 = -x, 4 = +y, 5 = -y.
            const ends = f === 2 ? [[1, 0], [1, 1]] : f === 3 ? [[0, 1], [0, 0]] : f === 4 ? [[1, 1], [0, 1]] : [[0, 0], [1, 0]];
            const pts = [[x + ends[0][0], y + ends[0][1], bottom], [x + ends[1][0], y + ends[1][1], bottom], [x + ends[1][0], y + ends[1][1], top], [x + ends[0][0], y + ends[0][1], top]];
            const uvOf = (p, li) => {
                const w = [p[0], p[1], p[2]];
                const l = [p[0] - x, p[1] - y, p[2] - z];
                let u = faceUv ? l[face.u] : w[face.u] / scale, v = faceUv ? l[face.v] : w[face.v] / scale;
                if (face.flipU) u = faceUv ? 1 - u : -u;
                return [u, v];
            };
            const ks = pts.map((p, li) => {
                const dz = li >= 2 ? 1 : 0;
                const seam = dz === 0 ? 0.84 : 1;
                return var0 * seam * aoCorner(f, x, y, z, ends[li === 0 || li === 3 ? 0 : 1][0], ends[li === 0 || li === 3 ? 0 : 1][1], dz);
            });
            quad(buf, pts, [face.n[0], face.n[1], 0], pts.map(uvOf), ks, t);
        });
        // ---- bottom (rarely visible: overhangs)
        if (!hides(x, y, z - 1) && z > 0) {
            const buf = bufFor(m.key, r0), scale = r0.scale || 1;
            const pts = [[x, y, z], [x + 1, y, z], [x + 1, y + 1, z], [x, y + 1, z]];
            quad(buf, pts, [0, 0, -1], pts.map(p => [p[0] / scale, p[1] / scale]), pts.map(() => var0 * 0.7), t);
        }
        void topNeighbour;
    }
    for (let z = z0; z < Math.min(z0 + CHUNK, store.height, cut); z++)
        for (let y = y0; y < Math.min(y0 + CHUNK, store.depth); y++)
            for (let x = x0; x < Math.min(x0 + CHUNK, store.width); x++) {
                const id = store.get(x, y, z);
                if (id === AIR) continue;
                const m = MATERIALS[id];
                if (m.render === 'none' || kit(store, x, y, z, id)) continue;
                const base = renderFor(m.key);
                const g = KIND_GROUP[base.kind || 'opaque'];
                const jitter = 0.94 + hash3(x, y, z) * 0.12;
                const macro = base.macro ? 1 - base.macro + 2 * base.macro * valueNoise(x / 7.3, y / 7.3) : 1;
                const t = tint ? tint(x, y, z, m) : null;
                if (g === 0 && options.rounded !== false) { emitRounded(x, y, z, m, base, jitter * macro, t); continue; }
                for (let f = 0; f < 6; f++) {
                    const face = FACES[f];
                    const nx = x + face.n[0], ny = y + face.n[1], nz = z + face.n[2];
                    const nid = nz >= cut ? AIR : store.get(nx, ny, nz);
                    if (g === 0) { if (hides(nx, ny, nz)) continue; }
                    else if (nid === id || hides(nx, ny, nz)) continue;
                    // A top face exposed only by the cutaway is a section cap: drawn dark, like XCOM's cut walls.
                    const capped = face.top && nz >= cut && store.get(nx, ny, nz) !== AIR && opaqueAt(store, nx, ny, nz) && !kit(store, nx, ny, nz);
                    if (m.liquid && f !== 0 && nid !== AIR) continue;
                    // Side faces of grass under open sky get the fringe texture; buried grass sides are soil.
                    let key = m.key, r = base;
                    if (!face.top && base.side && f !== 1) {
                        key = (z + 1 >= cut || store.get(x, y, z + 1) === AIR) ? base.side : 'soil';
                        r = renderFor(key);
                    }
                    const buf = bufFor(key, r);
                    const faceUv = r.uv === 'face', scale = r.scale || 1;
                    // Height readability (PLAN 22 cues): walkable tops get the tile grid; their edges get a rim where
                    // the ground drops (0 none, 1–4 voxels); higher ground is a touch brighter; cliff faces darken
                    // toward the bottom of each voxel row so every step reads as a step.
                    let grid = 0, rim = [0, 0, 0, 0], elev = 1;
                    if (face.top && g === 0 && !capped) {
                        grid = m.walkable && !(z + 1 < cut && store.isSolid(x, y, z + 1)) ? 1 : 0;
                        if (grid) rim = [[0, -1], [1, 0], [0, 1], [-1, 0]].map(([dx, dy]) => {
                            if (store.isSolid(x + dx, y + dy, z)) return 0;
                            let d = 1; while (d < 4 && z - d >= 0 && !store.isSolid(x + dx, y + dy, z - d)) d++;
                            return d;
                        });
                        elev = 1 + Math.min(0.24, 0.03 * Math.max(0, z - 1));
                    }
                    const start = buf.positions.length / 3;
                    const ao = [];
                    for (const [dx, dy, dz] of face.c) {
                        // Corner AO: opaque voxels around the corner on the face's outer side.
                        let occ = 0;
                        if (g === 0) {
                            const cxw = x + dx, cyw = y + dy, czw = z + dz;
                            const sx = dx ? 0 : -1, sy = dy ? 0 : -1, sz = dz ? 0 : -1;
                            const ox = face.n[0] ? (face.n[0] > 0 ? 0 : -1) : null, oy = face.n[1] ? (face.n[1] > 0 ? 0 : -1) : null, oz = face.n[2] ? (face.n[2] > 0 ? 0 : -1) : null;
                            for (const ddx of ox !== null ? [ox] : [sx, sx + 1]) for (const ddy of oy !== null ? [oy] : [sy, sy + 1]) for (const ddz of oz !== null ? [oz] : [sz, sz + 1]) {
                                if (opaque(cxw + ddx, cyw + ddy, czw + ddz)) occ++;
                            }
                        }
                        const seam = f >= 2 && g === 0 && dz === 0 ? 0.84 : 1;
                        const k = jitter * macro * elev * seam * (1 - Math.min(3, Math.max(0, occ - 1)) * 0.2) * (capped ? 0.55 : 1);
                        ao.push(k);
                        buf.positions.push(x + dx, z + dz, y + dy);
                        buf.normals.push(face.n[0], face.n[2], face.n[1]);
                        const w = [x + dx, y + dy, z + dz], l = [dx, dy, dz];
                        let u = faceUv ? l[face.u] : w[face.u] / scale, v = faceUv ? l[face.v] : w[face.v] / scale;
                        if (face.flipU) u = faceUv ? 1 - u : -u;
                        buf.uvs.push(u, v);
                        buf.colors.push(k * (t ? t[0] : 1), k * (t ? t[1] : 1), k * (t ? t[2] : 1));
                        buf.rims.push(...rim); buf.grids.push(grid);
                    }
                    // Flip the quad's diagonal toward the brighter pair (avoids AO creases).
                    if (ao[0] + ao[2] >= ao[1] + ao[3]) buf.indices.push(start, start + 2, start + 1, start, start + 3, start + 2);
                    else buf.indices.push(start + 1, start + 3, start + 2, start + 1, start, start + 3);
                }
            }
    return [...out.values()];
}
