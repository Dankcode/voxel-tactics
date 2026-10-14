#!/usr/bin/env node
// PLAN-06 preview: an isometric render of a generated map straight from its voxels (no browser, no tile set), for
// reviewing parcel layouts, lots, fences, vehicles and terraces. Optionally cuts roofs away to show interiors.
//
//   node tools/mapgen/district-render.mjs --map park-district --seed 27 [--remix '{"objective":"hold"}'] [--cut] [--scale 6] --out park.png
//   node tools/mapgen/district-render.mjs --map park-district --seed 27 --landuse --out park-landuse.png   (flat land-use map)
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { MAPS } from '../../shared/mission/Maps.js';
import { materialById, AIR } from '../../shared/voxel/Materials.js';
import { LAND_USE_COLORS } from '../../client/src/ui/TopographyPreview.js';

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => { if (a.startsWith('--')) acc.push([a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : true]); return acc; }, []));
const id = args.map || 'park-district', seed = Number(args.seed || 27), scale = Number(args.scale || 6);
const def = MAPS.find(d => d.id === id);
if (!def) throw Error(`unknown map ${id}`);
const m = def.build({ seed, ...(args.remix ? { remix: JSON.parse(args.remix) } : {}), ...(args.width ? { width: Number(args.width) } : {}), ...(args.depth ? { depth: Number(args.depth) } : {}), ...(args.shape ? { shape: args.shape } : {}) });
const s = m.store, hints = m.visual?.hints || {};

function png(w, h, rgb) {
    const raw = Buffer.alloc((w * 3 + 1) * h);
    for (let y = 0; y < h; y++) { raw[y * (w * 3 + 1)] = 0; rgb.copy(raw, y * (w * 3 + 1) + 1, y * w * 3, (y + 1) * w * 3); }
    const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
    const crc = buf => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
    const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
    const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
    return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const hex = c => [(c >> 16) & 255, (c >> 8) & 255, c & 255];

if (args.landuse) {
    const lu = m.meta.landUse, q = scale, W = lu.width * q, H = lu.depth * q, buf = Buffer.alloc(W * H * 3);
    for (let y = 0; y < lu.depth; y++) for (let x = 0; x < lu.width; x++) {
        const c = hex(parseInt((LAND_USE_COLORS[lu.codes[x + y * lu.width]] || '#ff00ff').slice(1), 16));
        for (let py = 0; py < q; py++) for (let px = 0; px < q; px++) { const i = ((y * q + py) * W + x * q + px) * 3; buf[i] = c[0]; buf[i + 1] = c[1]; buf[i + 2] = c[2]; }
    }
    writeFileSync(args.out || `${id}-${seed}-landuse.png`, png(W, H, buf));
} else {
    const tw = scale, th = Math.round(scale / 2), vh = Math.round(scale * 0.62);
    const W = (s.width + s.depth) * tw + 4, H = (s.width + s.depth) * th + s.height * vh + 8;
    const buf = Buffer.alloc(W * H * 3);
    for (let i = 0; i < W * H; i++) { buf[i * 3] = 17; buf[i * 3 + 1] = 27; buf[i * 3 + 2] = 33; }
    const inB = (x, y) => m.buildings.find(b => x >= b.x0 && x < b.x0 + b.w && y >= b.y0 && y < b.y0 + b.d);
    const tintOf = (x, y, z) => { const h = hints[`${x},${y},${z}`]; const a = h?.member ? hints[h.member] : h; return a?.tint ? a.tint.map(v => Math.round(v * 255)) : null; };
    const px = (X, Y, c) => { if (X < 0 || Y < 0 || X >= W || Y >= H) return; const i = (Y * W + X) * 3; buf[i] = c[0]; buf[i + 1] = c[1]; buf[i + 2] = c[2]; };
    const ox = s.depth * tw + 2, oy = s.height * vh + 4;
    // Trees are drawn as their species silhouettes (trunk + soft shaded crown), not as leaf voxels.
    const TREE_SHAPE = { tree_oak: [1.9, 1.15, 2.9], tree_round: [1.35, 1.2, 3.6], tree_birch: [0.85, 1.5, 4.4], tree_ornamental: [1.0, 0.9, 2.5], tree_cypress: [0.6, 2.4, 3.6], tree_conifer: [1.1, 2.1, 3.0] };
    const treeAt = new Map(), treeVoxel = new Set();
    for (const [k, h] of Object.entries(hints)) if (h.tree && h.piece) { const [x, y, z] = k.split(',').map(Number); (treeAt.get(x + y) || treeAt.set(x + y, []).get(x + y)).push({ x, y, z, piece: h.piece, scale: h.scale || 1 }); for (const c of h.cells || []) treeVoxel.add(c); }
    const drawTree = t => {
        const [rx0, ry0, hc] = TREE_SHAPE[t.piece] || [1.2, 1.2, 3.5], k = t.scale;
        const cx = ox + (t.x - t.y) * tw, base = oy + (t.x + t.y) * th + th - (t.z - 1) * vh;
        for (let r = 0; r < Math.round(hc * vh * k * 0.8); r++) for (let c = -1; c <= 1; c++) px(cx + c, base - r, [92, 66, 46]);
        const cy = base - hc * vh * k, rx = rx0 * tw * k, ry = ry0 * vh * k * 1.25;
        const g = [[64, 120, 52], [78, 132, 58], [58, 108, 64], [88, 128, 60]][(t.x * 7 + t.y * 3) % 4];
        const pointed = t.piece === 'tree_conifer' || t.piece === 'tree_cypress';
        for (let dy = -Math.ceil(ry); dy <= Math.ceil(ry); dy++) for (let dx = -Math.ceil(rx); dx <= Math.ceil(rx); dx++) {
            const ny = dy / ry, w = pointed ? Math.max(0, (ny + 1) / 2) : Math.sqrt(Math.max(0, 1 - ny * ny));
            const nx = dx / (rx * (pointed ? Math.max(0.05, w) : 1));
            if (pointed ? Math.abs(nx) > 1 : nx * nx + ny * ny > 1) continue;
            const wob = Math.sin((dx * 1.7 + dy * 2.3 + t.x) * 0.9) * 0.08;
            const light = 0.72 + 0.4 * Math.max(0, -nx * 0.5 - ny * 0.7 + 0.3) + wob;
            px(Math.round(cx + dx), Math.round(cy + dy), g.map(v => Math.min(255, Math.round(v * light))));
        }
    };
    for (let sum = 0; sum < s.width + s.depth; sum++) for (let x = Math.max(0, sum - s.depth + 1); x <= Math.min(s.width - 1, sum); x++) {
        const y = sum - x, b = args.cut ? inB(x, y) : null, cutH = args.cut === true ? 2 : Number(args.cut);
        for (let z = 0; z < s.height; z++) {
            const v = s.get(x, y, z); if (v === AIR || treeVoxel.has(`${x},${y},${z}`)) continue;
            if (b && z > b.baseZ + cutH) continue;
            const mat = materialById(v), base = tintOf(x, y, z) || hex(mat.color ?? 0x888888);
            const above = z + 1 < s.height ? s.get(x, y, z + 1) : AIR;
            const sx = ox + (x - y) * tw, sy = oy + (x + y) * th - z * vh;
            // Top diamond, then the two visible sides (shaded).
            const topOpen = above === AIR || (b && z + 1 > b.baseZ + cutH);
            for (let r = 0; r < 2 * th; r++) { const half = Math.round(tw * (r < th ? (r + 1) / th : (2 * th - r) / th)); for (let c = -half; c < half; c++) px(sx + c, sy + r, topOpen ? base : base.map(v => v * 0.92)); }
            for (let r = 0; r < vh; r++) for (let c = 0; c < tw; c++) {
                const yy = sy + th + r + Math.round(c * th / tw);
                px(sx - tw + c, yy, base.map(v => Math.round(v * 0.72)));
                px(sx + tw - 1 - c, yy, base.map(v => Math.round(v * 0.56)));
            }
        }
        if (x === Math.min(s.width - 1, sum)) for (const t of treeAt.get(sum) || []) drawTree(t);
    }
    writeFileSync(args.out || `${id}-${seed}.png`, png(W, H, buf));
}
const g = m.meta.districtGates;
console.log(`${m.name} #${seed}: ${m.buildings.length} buildings, ${g ? `${g.metrics.vehicles} vehicles, plain ${(100 * g.metrics.plainShare).toFixed(1)} %, district gates ${g.pass ? 'pass' : 'FAIL ' + JSON.stringify(g.gates)}` : 'no district gates'}, mission gates ${m.metrics.pass ? 'pass' : 'FAIL'}`);
