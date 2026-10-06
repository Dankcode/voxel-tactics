// Pitched roofs from roof voxels: the stepped stack of roof voxels (BuildingBuilder: shrinking layers) becomes one
// continuous tiled surface. Every grid corner takes the mean height of the four roof columns around it (a missing
// column counts as the eave line), so 1-voxel steps become 45° slopes; corners on the roof outline are pushed out
// and down into eaves. Each column only draws its own quad, so a destroyed roof voxel lowers or holes just that
// part of the roof. Pitched roofs are not walkable (Materials.roof.walkable = false), so the look and the rules agree.
import * as THREE from 'three';
import { MAT } from '../../../../shared/voxel/Materials.js';
import { CHUNK } from '../../../../shared/voxel/VoxelStore.js';

const EAVE_OUT = 0.32, EAVE_DROP = 0.3;

/** Top and bottom of the roof run in a column, below the cutaway (null when the column has no roof). */
export function roofColumn(store, x, y, cut = Infinity) {
    if (x < 0 || y < 0 || x >= store.width || y >= store.depth) return null;
    let top = -1;
    for (let z = Math.min(store.height, cut) - 1; z >= 0; z--) if (store.get(x, y, z) === MAT.roof) { top = z; break; }
    if (top < 0) return null;
    // A column that continues above the cut is cut away entirely.
    for (let z = top + 1; z < store.height; z++) if (store.get(x, y, z) === MAT.roof) return null;
    let bottom = top;
    while (bottom > 0 && store.get(x, y, bottom - 1) === MAT.roof) bottom--;
    return { top, bottom, h: top + 1 };
}

export function buildRoofGeometry(store, cx, cy, cz, cut = Infinity) {
    const x0 = cx * CHUNK, y0 = cy * CHUNK, z0 = cz * CHUNK;
    const cols = new Map();
    const col = (x, y) => { const k = x + y * store.width; if (!cols.has(k)) cols.set(k, roofColumn(store, x, y, cut)); return cols.get(k); };
    const pos = [], uvs = [];
    const corner = (vx, vy) => {
        // cells around grid vertex (vx, vy)
        const around = [col(vx - 1, vy - 1), col(vx, vy - 1), col(vx - 1, vy), col(vx, vy)];
        const present = around.filter(Boolean);
        const base = Math.min(...present.map(c => c.bottom));
        let sum = 0, missing = 0, ox = 0, oy = 0;
        around.forEach((c, i) => {
            if (c) sum += c.h;
            else { sum += base; missing++; ox += i % 2 ? 1 : -1; oy += i < 2 ? -1 : 1; }
        });
        let h = sum / 4, x = vx, y = vy;
        if (missing) {
            const len = Math.hypot(ox, oy) || 1;
            x += ox / len * EAVE_OUT; y += oy / len * EAVE_OUT; h -= EAVE_DROP;
        }
        return [x, h, y];
    };
    for (let y = y0; y < Math.min(y0 + CHUNK, store.depth); y++) for (let x = x0; x < Math.min(x0 + CHUNK, store.width); x++) {
        const c = col(x, y);
        if (!c || c.top < z0 || c.top >= z0 + CHUNK) continue;
        const p00 = corner(x, y), p10 = corner(x + 1, y), p01 = corner(x, y + 1), p11 = corner(x + 1, y + 1);
        const gx = (p10[1] + p11[1] - p00[1] - p01[1]) / 2, gy = (p01[1] + p11[1] - p00[1] - p10[1]) / 2;
        const uv = p => (Math.abs(gx) > Math.abs(gy) ? [p[2] / 2, p[0] * Math.hypot(1, gx) / 2] : [p[0] / 2, p[2] * Math.hypot(1, gy) / 2]);
        for (const p of [p00, p01, p11, p00, p11, p10]) { pos.push(...p); uvs.push(...uv(p)); }
    }
    if (!pos.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    g.computeVertexNormals();
    g.computeBoundingSphere();
    return g;
}
