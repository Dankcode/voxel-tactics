// Face-culled chunk mesher with per-vertex colour and corner ambient occlusion.
// Pure (no THREE): returns typed arrays so it can move into a worker later without changes.
// World voxel (x, y, z) → three.js (x, z, y): three's Y is up.
import { MATERIALS, AIR } from '../../../shared/voxel/Materials.js';
import { CHUNK } from '../../../shared/voxel/VoxelStore.js';

// faces: normal, 4 corners (as offsets in voxel space x,y,z), shade
const FACES = [
    { n: [0, 0, 1], c: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]], shade: 1.0 },     // top (+z)
    { n: [0, 0, -1], c: [[0, 1, 0], [1, 1, 0], [1, 0, 0], [0, 0, 0]], shade: 0.45 },   // bottom
    { n: [1, 0, 0], c: [[1, 0, 0], [1, 1, 0], [1, 1, 1], [1, 0, 1]], shade: 0.78 },    // +x
    { n: [-1, 0, 0], c: [[0, 1, 0], [0, 0, 0], [0, 0, 1], [0, 1, 1]], shade: 0.7 },    // -x
    { n: [0, 1, 0], c: [[1, 1, 0], [0, 1, 0], [0, 1, 1], [1, 1, 1]], shade: 0.86 },    // +y
    { n: [0, -1, 0], c: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]], shade: 0.64 }    // -y
];
const SIDE_COLOR = { grass: 0x7a5a3c, forest_floor: 0x6a4a30 };
const GROUPS = { solid: 0, foliage: 0, glass: 1, water: 2 };

function hash(x, y, z) { let h = (x * 374761393 + y * 668265263 + z * 2147483647) | 0; h = (h ^ (h >>> 13)) * 1274126177; return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }

/** occluder test for AO and culling: opaque, rendered solids. */
function opaqueAt(store, x, y, z) {
    const id = store.get(x, y, z);
    if (id === AIR) return false;
    const m = MATERIALS[id];
    return m.render === 'solid' || m.render === 'foliage';
}

/**
 * Build geometry for chunk (cx, cy, cz). `options.hidden(x, y, z)` hides voxels (e.g. unrevealed rooms' furniture).
 * Returns [{ group: 0 opaque | 1 glass | 2 water, positions, normals, colors, indices }]
 */
export function meshChunk(store, cx, cy, cz, options = {}) {
    const out = [0, 1, 2].map(group => ({ group, positions: [], normals: [], colors: [], indices: [] }));
    const x0 = cx * CHUNK, y0 = cy * CHUNK, z0 = cz * CHUNK;
    const tint = options.tint || null;
    for (let z = z0; z < Math.min(z0 + CHUNK, store.height); z++)
        for (let y = y0; y < Math.min(y0 + CHUNK, store.depth); y++)
            for (let x = x0; x < Math.min(x0 + CHUNK, store.width); x++) {
                const id = store.get(x, y, z);
                if (id === AIR) continue;
                const m = MATERIALS[id];
                if (m.render === 'none') continue;
                const g = GROUPS[m.render] ?? 0;
                const buf = out[g];
                const v = 0.92 + hash(x, y, z) * 0.16;
                for (let f = 0; f < 6; f++) {
                    const face = FACES[f];
                    const nx = x + face.n[0], ny = y + face.n[1], nz = z + face.n[2];
                    const nid = store.get(nx, ny, nz);
                    if (g === 0) { if (opaqueAt(store, nx, ny, nz)) continue; }
                    else if (nid === id || opaqueAt(store, nx, ny, nz)) continue;
                    if (m.liquid && f !== 0) {
                        // Water: only the top and the sides that face air/glass.
                        if (nid !== AIR) continue;
                    }
                    let color = m.color;
                    if (f !== 0 && SIDE_COLOR[m.key] && store.get(x, y, z + 1) === AIR) color = SIDE_COLOR[m.key];
                    else if (f !== 0 && SIDE_COLOR[m.key]) color = SIDE_COLOR[m.key];
                    let r = ((color >> 16) & 255) / 255, gg = ((color >> 8) & 255) / 255, b = (color & 255) / 255;
                    if (tint) { const t = tint(x, y, z, m); if (t) { r *= t[0]; gg *= t[1]; b *= t[2]; } }
                    const base = buf.positions.length / 3;
                    const ao = [];
                    for (const [dx, dy, dz] of face.c) {
                        // Corner AO: count opaque voxels around the corner on the face's outer side.
                        let occ = 0;
                        if (g === 0) {
                            const cxw = x + dx, cyw = y + dy, czw = z + dz;
                            const ax = face.n[0] ? [0] : [dx ? 0 : -1, dx ? 0 : -1];
                            const sx = dx ? 0 : -1, sy = dy ? 0 : -1, sz = dz ? 0 : -1;
                            const ox = face.n[0] ? (face.n[0] > 0 ? 0 : -1) : null, oy = face.n[1] ? (face.n[1] > 0 ? 0 : -1) : null, oz = face.n[2] ? (face.n[2] > 0 ? 0 : -1) : null;
                            for (const ddx of ox !== null ? [ox] : [sx, sx + 1]) for (const ddy of oy !== null ? [oy] : [sy, sy + 1]) for (const ddz of oz !== null ? [oz] : [sz, sz + 1]) {
                                if (opaqueAt(store, cxw + ddx, cyw + ddy, czw + ddz)) occ++;
                            }
                            void ax;
                        }
                        const k = face.shade * v * (1 - Math.min(3, Math.max(0, occ - 1)) * 0.13);
                        ao.push(k);
                        buf.positions.push(x + dx, z + dz, y + dy);
                        buf.normals.push(face.n[0], face.n[2], face.n[1]);
                        buf.colors.push(r * k, gg * k, b * k);
                    }
                    // Flip the quad's diagonal toward the brighter pair (avoids AO creases).
                    if (ao[0] + ao[2] >= ao[1] + ao[3]) buf.indices.push(base, base + 2, base + 1, base, base + 3, base + 2);
                    else buf.indices.push(base + 1, base + 3, base + 2, base + 1, base, base + 3);
                }
            }
    return out;
}
