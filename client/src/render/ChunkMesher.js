// Face-culled chunk mesher: one buffer per render material (RenderTable.js) with world-space or per-face UVs,
// normals, and vertex colours that carry corner ambient occlusion, large-scale variation and fog-of-war tint.
// Pure (no THREE): returns typed-array-ready lists so it can move into a worker later without changes.
// World voxel (x, y, z) → three.js (x, z, y): three's Y is up.
import { emitConnectedWater } from './ConnectedWater.js';
import { MATERIALS, AIR } from '../../../shared/voxel/Materials.js';
import { CHUNK } from '../../../shared/voxel/VoxelStore.js';
import { renderFor, KIND_GROUP } from './RenderTable.js';
import { straightCells } from '../../../shared/mission/BuildingEra.js';

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
    const opaque = (x, y, z) => z < cut && !options.hidden?.(x,y,z) && opaqueAt(store, x, y, z);
    const hides = (x, y, z) => opaque(x, y, z) && !kit(store, x, y, z);   // only full cubes hide a neighbour's face
    const apron = !!options.apron;
    const straight = straightCells(store);       // old buildings: straight edges (BuildingEra.js)               // the map edge continues as an apron: no boundary side faces
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
            const r = renderFor(buf.key);
            const k = ks[i] * (r.macro ? 1 - r.macro + 2*r.macro*valueNoise(p[0]/7.3,p[1]/7.3) : 1);
            buf.colors.push(k * (t ? t[0] : 1), k * (t ? t[1] : 1), k * (t ? t[2] : 1));
            buf.rims.push(...rim); buf.grids.push(grid);
        });
        if (flip) {
            buf.indices.push(start, start + 2, start + 1);
            if (pts.length === 4) buf.indices.push(start, start + 3, start + 2);
        } else {
            buf.indices.push(start, start + 1, start + 2);
            if (pts.length === 4) buf.indices.push(start, start + 2, start + 3);
        }
    };
    const dropOf = key => renderFor(key).drop || 0;
    const SIDE = [{ d: [0, -1], f: 5 }, { d: [1, 0], f: 2 }, { d: [0, 1], f: 4 }, { d: [-1, 0], f: 3 }];   // N E S W
    /**
     * Grid of vertices → quads with per-vertex normals (smooth fillets). pos(i, j) / nrm(i, j) give voxel-space
     * [x, y, z]; rows × cols cells. Winding is fixed against the supplied normal.
     */
    const patch = (buf, rows, cols, pos, nrm, uvOf, kOf, t, rim = [0, 0, 0, 0], grid = 0) => {
        const start = buf.positions.length / 3;
        for (let i = 0; i <= rows; i++) for (let j = 0; j <= cols; j++) {
            const p = pos(i, j), n = nrm(i, j), rr = renderFor(buf.key);
            const k = kOf(i, j) * (rr.macro ? 1 - rr.macro + 2 * rr.macro * valueNoise(p[0] / 7.3, p[1] / 7.3) : 1);
            buf.positions.push(p[0], p[2], p[1]); buf.normals.push(n[0], n[2], n[1]);
            const uv = uvOf(p, n); buf.uvs.push(uv[0], uv[1]);
            buf.colors.push(k * (t ? t[0] : 1), k * (t ? t[1] : 1), k * (t ? t[2] : 1));
            buf.rims.push(...rim); buf.grids.push(grid);
        }
        const at = (i, j) => start + i * (cols + 1) + j;
        // Orientation from the first cell with area.
        const P = (i, j) => pos(i, j);
        let flip = false;
        {
            const a = P(0, 0), b = P(Math.min(1, rows), 0), c = P(0, Math.min(1, cols)), n = nrm(0, 0);
            const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
            let cr = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
            if (Math.hypot(...cr) < 1e-9) {   // degenerate first row (a sphere pole): use the far corner
                const d = P(Math.min(1, rows), Math.min(1, cols));
                const w = [d[0] - a[0], d[1] - a[1], d[2] - a[2]];
                cr = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
                if (Math.hypot(...cr) < 1e-9) cr = [w[1] * v[2] - w[2] * v[1], w[2] * v[0] - w[0] * v[2], w[0] * v[1] - w[1] * v[0]];
            }
            // voxel space is (x, y, z) with z up; three space swaps y/z, which mirrors handedness.
            flip = cr[0] * n[0] + cr[1] * n[1] + cr[2] * n[2] > 0;
        }
        for (let i = 0; i < rows; i++) for (let j = 0; j < cols; j++) {
            const a = at(i, j), b = at(i + 1, j), c = at(i + 1, j + 1), d = at(i, j + 1);
            if (flip) buf.indices.push(a, c, b, a, d, c); else buf.indices.push(a, b, c, a, c, d);
        }
    };
    const SEG = 3;
    const CORNERS = [[0, 0, 0, 3], [1, 0, 0, 1], [1, 1, 1, 2], [0, 1, 2, 3]];   // corner (cx, cy) and its two sides (N=0 E=1 S=2 W=3)
    const OUT = [[0, -1], [1, 0], [0, 1], [-1, 0]];
    /**
     * Opaque terrain / slab voxel drawn as part of a rounded mass: sides that face open space are pulled in and
     * rounded — quarter-round fillets along exposed top edges, quarter-cylinders down exposed vertical corners, a
     * sphere octant where both meet — while sides against other terrain stay flush, so touching voxels merge into one
     * smooth shape (raised beds, berms, kerbs, pond banks). Materials with a `drop` (roads, lawns) sit lower and the
     * higher neighbour shows a kerb. Faces on the map boundary are skipped when the apron continues the ground.
     */
    function emitRounded(x, y, z, m, base, var0, t) {
        const r0 = base;
        const topDrawn = !hides(x, y, z + 1);
        const capped = topDrawn && z + 1 >= cut && store.get(x, y, z + 1) !== AIR && opaqueAt(store, x, y, z + 1) && !kit(store, x, y, z + 1);
        const live = topDrawn && !capped;
        const my = live ? dropOf(m.key) : 0;
        const T = z + 1 - my;
        const R = Math.min(0.32, r0.bevel ?? 0.16);
        const rT = live ? R : 0;
        const ex = [false, false, false, false], curb = [0, 0, 0, 0];
        SIDE.forEach(({ d: [dx, dy] }, i) => {
            const nx = x + dx, ny = y + dy;
            if (!inMap(nx, ny)) { ex[i] = !apron; return; }
            if (!hides(nx, ny, z)) { ex[i] = true; return; }
            if (!live) return;
            const nLive = !hides(nx, ny, z + 1) && z + 1 < cut;
            const nd = nLive ? dropOf(MATERIALS[store.get(nx, ny, z)].key) : 0;
            if (nd > my + 0.01) curb[i] = nd - my;
        });
        const convex = CORNERS.map(([, , a, b]) => ex[a] && ex[b]);
        const ins = i => (ex[i] ? rT : 0);
        const key = m.key, scale = r0.scale || 1, faceUv = r0.uv === 'face';
        const uvTop = p => (faceUv ? [p[0] - x, p[1] - y] : [p[0] / scale, p[1] / scale]);
        // ---- top
        let grid = 0, rim = [0, 0, 0, 0], elev = 1;
        if (topDrawn) {
            const buf = bufFor(key, r0);
            if (!capped) {
                grid = m.walkable && !(z + 1 < cut && store.isSolid(x, y, z + 1)) ? 1 : 0;
                if (grid) rim = [[0, -1], [1, 0], [0, 1], [-1, 0]].map(([dx, dy]) => {
                    if (store.isSolid(x + dx, y + dy, z) || !inMap(x + dx, y + dy)) return 0;
                    let dd = 1; while (dd < 4 && z - dd >= 0 && !store.isSolid(x + dx, y + dy, z - dd)) dd++;
                    return dd;
                });
                elev = 1 + Math.min(0.2, 0.025 * Math.max(0, z - 1));
            }
            const x0 = x + ins(3), x1 = x + 1 - ins(1), y0 = y + ins(0), y1 = y + 1 - ins(2);
            const kTop = var0 * elev * (capped ? 0.55 : 1);
            const pts = [[x0, y0, T], [x1, y0, T], [x1, y1, T], [x0, y1, T]];
            const ks = [[0, 0], [1, 0], [1, 1], [0, 1]].map(([a, b2]) => kTop * aoCorner(0, x, y, z, a, b2, 1));
            quad(buf, pts, [0, 0, 1], pts.map(uvTop), ks, t, rim, grid);
            if (live && rT > 0) {
                // Edge fillets.
                SIDE.forEach(({ d: [dx, dy] }, i) => {
                    if (!ex[i]) return;
                    // Ends of the fillet along the side: inset where the corner is convex (the octant covers it).
                    const along = dx === 0 ? [1, 0] : [0, 1];                    // axis the side runs along
                    const cs = CORNERS.filter(([, , a, b2]) => a === i || b2 === i);   // its two corners
                    const lo = cs.find(c => (along[0] ? c[0] : c[1]) === 0), hi = cs.find(c => (along[0] ? c[0] : c[1]) === 1);
                    const s0 = convex[CORNERS.indexOf(lo)] ? rT : 0, s1 = 1 - (convex[CORNERS.indexOf(hi)] ? rT : 0);
                    // Line of the inset top edge.
                    const base0 = dx === 1 ? x + 1 - rT : dx === -1 ? x + rT : null, baseY = dy === 1 ? y + 1 - rT : dy === -1 ? y + rT : null;
                    patch(buf, SEG, 1, (ii, jj) => {
                        const ph = (ii / SEG) * Math.PI / 2, s2 = jj ? s1 : s0;
                        const px = along[0] ? x + s2 : base0 + dx * rT * Math.sin(ph);
                        const py = along[1] ? y + s2 : baseY + dy * rT * Math.sin(ph);
                        return [px, py, T - rT + rT * Math.cos(ph)];
                    }, (ii) => { const ph = (ii / SEG) * Math.PI / 2; return [dx * Math.sin(ph), dy * Math.sin(ph), Math.cos(ph)]; },
                    uvTop, (ii) => kTop * (1 - 0.12 * ii / SEG), t, rim, 0);
                });
                // Corner octants.
                CORNERS.forEach(([cx, cy, a, b2], c) => {
                    if (!convex[c]) return;
                    const ccx = cx ? x + 1 - rT : x + rT, ccy = cy ? y + 1 - rT : y + rT;
                    const nA = OUT[a], nB = OUT[b2];
                    patch(buf, SEG, SEG, (ii, jj) => {
                        const ph = (ii / SEG) * Math.PI / 2, th = (jj / SEG) * Math.PI / 2;
                        const hx = Math.cos(th) * nA[0] + Math.sin(th) * nB[0], hy = Math.cos(th) * nA[1] + Math.sin(th) * nB[1];
                        return [ccx + rT * Math.sin(ph) * hx, ccy + rT * Math.sin(ph) * hy, T - rT + rT * Math.cos(ph)];
                    }, (ii, jj) => {
                        const ph = (ii / SEG) * Math.PI / 2, th = (jj / SEG) * Math.PI / 2;
                        const hx = Math.cos(th) * nA[0] + Math.sin(th) * nB[0], hy = Math.cos(th) * nA[1] + Math.sin(th) * nB[1];
                        return [Math.sin(ph) * hx, Math.sin(ph) * hy, Math.cos(ph)];
                    }, uvTop, (ii) => kTop * (1 - 0.12 * ii / SEG), t, rim, 0);
                });
            }
        }
        // ---- sides, vertical corners and kerb strips
        const sideKey = r0.side ? (live ? r0.side : 'soil') : key;
        const rs = r0.side ? renderFor(sideKey) : r0;
        const sbuf = bufFor(sideKey, rs), sScale = rs.scale || 1, sFace = rs.uv === 'face';
        const topSide = live ? T - rT : z + 1;
        const kSide = var0 * 0.96;
        SIDE.forEach(({ d: [dx, dy], f }, i) => {
            let bottom = z, top = topSide;
            if (!ex[i]) {
                if (!(curb[i] > 0)) return;
                bottom = z + 1 - (my + curb[i]); top = T;
            }
            const face = FACES[f];
            const along = dx === 0 ? [1, 0] : [0, 1];
            const cs = CORNERS.filter(([, , a, b2]) => a === i || b2 === i);
            const lo = cs.find(c => (along[0] ? c[0] : c[1]) === 0), hi = cs.find(c => (along[0] ? c[0] : c[1]) === 1);
            const cut0 = ex[i] && convex[CORNERS.indexOf(lo)] ? R : 0, cut1 = ex[i] && convex[CORNERS.indexOf(hi)] ? R : 0;
            const fx = dx === 1 ? x + 1 : dx === -1 ? x : null, fy = dy === 1 ? y + 1 : dy === -1 ? y : null;
            const P = (s2, h) => [along[0] ? x + s2 : fx, along[1] ? y + s2 : fy, h];
            const pts = [P(cut0, bottom), P(1 - cut1, bottom), P(1 - cut1, top), P(cut0, top)];
            const uvOf = p => {
                const l = [p[0] - x, p[1] - y, p[2] - z];
                let u = sFace ? l[face.u] : p[face.u] / sScale, v = sFace ? l[face.v] : p[face.v] / sScale;
                if (face.flipU) u = sFace ? 1 - u : -u;
                return [u, v];
            };
            const ks = pts.map((p, li) => kSide * (li < 2 ? 0.92 : 1) * aoCorner(f, x, y, z, along[0] ? (li === 0 || li === 3 ? 0 : 1) : (dx > 0 ? 1 : 0), along[1] ? (li === 0 || li === 3 ? 0 : 1) : (dy > 0 ? 1 : 0), li < 2 ? 0 : 1));
            quad(sbuf, pts, [face.n[0], face.n[1], 0], pts.map(uvOf), ks, t);
        });
        CORNERS.forEach(([cx, cy, a, b2], c) => {
            if (!convex[c]) return;
            const ccx = cx ? x + 1 - R : x + R, ccy = cy ? y + 1 - R : y + R;
            const nA = OUT[a], nB = OUT[b2];
            patch(sbuf, 1, SEG, (ii, jj) => {
                const th = (jj / SEG) * Math.PI / 2;
                return [ccx + R * (Math.cos(th) * nA[0] + Math.sin(th) * nB[0]), ccy + R * (Math.cos(th) * nA[1] + Math.sin(th) * nB[1]), ii ? topSide : z];
            }, (ii, jj) => { const th = (jj / SEG) * Math.PI / 2; return [Math.cos(th) * nA[0] + Math.sin(th) * nB[0], Math.cos(th) * nA[1] + Math.sin(th) * nB[1], 0]; },
            (p) => [(p[0] + p[1]) / sScale, p[2] / sScale], (ii) => kSide * (ii ? 1 : 0.92), t);
        });
        // ---- bottom (rarely visible: overhangs)
        if (!hides(x, y, z - 1) && z > 0) {
            const buf = bufFor(m.key, r0);
            const pts = [[x, y, z], [x + 1, y, z], [x + 1, y + 1, z], [x, y + 1, z]];
            quad(buf, pts, [0, 0, -1], pts.map(p => [p[0] / scale, p[1] / scale]), pts.map(() => var0 * 0.7), t);
        }
    }
    for (let z = z0; z < Math.min(z0 + CHUNK, store.height, cut); z++)
        for (let y = y0; y < Math.min(y0 + CHUNK, store.depth); y++)
            for (let x = x0; x < Math.min(x0 + CHUNK, store.width); x++) {
                if (options.hidden?.(x,y,z)) continue;
                const id = store.get(x, y, z);
                if (id === AIR) continue;
                const m = MATERIALS[id];
                if (m.render === 'none' || kit(store, x, y, z, id)) continue;
                const base = renderFor(m.key);
                const g = KIND_GROUP[base.kind || 'opaque'];
                const jitter = 1;
                const macro = 1;
                const t = tint ? tint(x, y, z, m) : null;
                if (m.liquid || m.key === 'ice' || m.key === 'deep_ice') {
                    const key = m.key === 'deep_water' ? 'water' : m.key === 'deep_ice' ? 'ice' : m.key;
                    emitConnectedWater(store,x,y,z,m.key,bufFor(key,renderFor(key)),quad,t,cut);
                    continue;
                }
                if (g === 0 && options.rounded !== false && !straight(x, y)) { emitRounded(x, y, z, m, base, jitter * macro, t); continue; }
                for (let f = 0; f < 6; f++) {
                    const face = FACES[f];
                    const nx = x + face.n[0], ny = y + face.n[1], nz = z + face.n[2];
                    const nid = nz >= cut || options.hidden?.(nx,ny,nz) ? AIR : store.get(nx, ny, nz);
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
                        const seam = 1;
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
