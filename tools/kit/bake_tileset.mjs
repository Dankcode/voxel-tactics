#!/usr/bin/env node
// Bake the tile set: builds every piece in client/src/render/kit/KitPieces.js and writes
//   client/public/assets/kit/tileset.glb   one node per piece, one primitive per material slot (material name = slot)
//   client/public/assets/kit/tileset.json  manifest: pieces, slots, bounds, triangle counts, notes
// The runtime (client/src/render/kit/KitLibrary.js) loads the GLB and falls back to building the pieces in the
// browser if it is missing. To replace pieces with real art, put them in client/public/assets/kit/tileset-art.glb:
// one node per piece with the same name, pivot at the cell's floor centre, authored along +X, materials named after
// the slots. KitLibrary loads it after tileset.glb and its pieces override the procedural ones.
//
//   node tools/kit/bake_tileset.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildAllPieces, PIECES, WALL_T } from '../../client/src/render/kit/KitPieces.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = path.join(ROOT, 'client', 'public', 'assets', 'kit');
const TRI_BUDGET = 1200;

/** Minimal glTF 2.0 binary writer: positions, normals, UVs, 32-bit indices; one material per slot name. */
function writeGlb(pieces) {
    const chunks = [], bufferViews = [], accessors = [], meshes = [], nodes = [], materials = [], matIndex = new Map();
    let offset = 0;
    const push = (typed, target) => {
        const bytes = Buffer.from(typed.buffer, typed.byteOffset, typed.byteLength);
        const pad = (4 - (bytes.length % 4)) % 4;
        chunks.push(bytes, Buffer.alloc(pad));
        bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: bytes.length, ...(target ? { target } : {}) });
        offset += bytes.length + pad;
        return bufferViews.length - 1;
    };
    const material = slot => {
        if (!matIndex.has(slot)) { matIndex.set(slot, materials.length); materials.push({ name: slot, pbrMetallicRoughness: { baseColorFactor: [0.8, 0.8, 0.8, 1], metallicFactor: 0, roughnessFactor: 0.9 } }); }
        return matIndex.get(slot);
    };
    for (const [id, parts] of pieces) {
        const primitives = [];
        for (const { slot, geometry } of parts) {
            const g = geometry.index ? geometry : indexify(geometry);
            const pos = new Float32Array(g.attributes.position.array), nor = new Float32Array(g.attributes.normal.array);
            const uv = g.attributes.uv ? new Float32Array(g.attributes.uv.array) : new Float32Array(pos.length / 3 * 2);
            const idx = new Uint32Array(g.index.array);
            const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
            for (let i = 0; i < pos.length; i += 3) for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], pos[i + k]); max[k] = Math.max(max[k], pos[i + k]); }
            const a = name => accessors.length;
            const pa = a(); accessors.push({ bufferView: push(pos, 34962), componentType: 5126, count: pos.length / 3, type: 'VEC3', min, max });
            const na = a(); accessors.push({ bufferView: push(nor, 34962), componentType: 5126, count: nor.length / 3, type: 'VEC3' });
            const ua = a(); accessors.push({ bufferView: push(uv, 34962), componentType: 5126, count: uv.length / 2, type: 'VEC2' });
            const ia = a(); accessors.push({ bufferView: push(idx, 34963), componentType: 5125, count: idx.length, type: 'SCALAR' });
            primitives.push({ attributes: { POSITION: pa, NORMAL: na, TEXCOORD_0: ua }, indices: ia, material: material(slot) });
        }
        meshes.push({ name: id, primitives });
        nodes.push({ name: id, mesh: meshes.length - 1 });
    }
    const bin = Buffer.concat(chunks);
    const json = { asset: { version: '2.0', generator: 'voxel-tactics bake_tileset' }, scene: 0, scenes: [{ nodes: nodes.map((_, i) => i) }],
        nodes, meshes, materials, accessors, bufferViews, buffers: [{ byteLength: bin.length }] };
    let jsonBuf = Buffer.from(JSON.stringify(json));
    jsonBuf = Buffer.concat([jsonBuf, Buffer.alloc((4 - (jsonBuf.length % 4)) % 4, 0x20)]);
    const header = Buffer.alloc(12); header.writeUInt32LE(0x46546c67, 0); header.writeUInt32LE(2, 4); header.writeUInt32LE(12 + 8 + jsonBuf.length + 8 + bin.length, 8);
    const jh = Buffer.alloc(8); jh.writeUInt32LE(jsonBuf.length, 0); jh.writeUInt32LE(0x4e4f534a, 4);
    const bh = Buffer.alloc(8); bh.writeUInt32LE(bin.length, 0); bh.writeUInt32LE(0x004e4942, 4);
    return Buffer.concat([header, jh, jsonBuf, bh, bin]);
}
function indexify(g) {
    const n = g.attributes.position.count, idx = new Uint32Array(n);
    for (let i = 0; i < n; i++) idx[i] = i;
    g.setIndex(Array.from(idx));
    return g;
}

const pieces = buildAllPieces();
const manifest = { version: 'tileset-v1', generated: new Date().toISOString().slice(0, 10), cell: { size: 1, height: 1, wallThickness: WALL_T }, source: 'tools/kit/bake_tileset.mjs (procedural placeholders)', pieces: {} };
let total = 0;
for (const [id, parts] of pieces) {
    let tris = 0; const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (const { geometry } of parts) {
        tris += (geometry.index ? geometry.index.count : geometry.attributes.position.count) / 3;
        geometry.computeBoundingBox();
        const b = geometry.boundingBox;
        min[0] = Math.min(min[0], b.min.x); min[1] = Math.min(min[1], b.min.y); min[2] = Math.min(min[2], b.min.z);
        max[0] = Math.max(max[0], b.max.x); max[1] = Math.max(max[1], b.max.y); max[2] = Math.max(max[2], b.max.z);
    }
    if (tris > TRI_BUDGET) throw new Error(`${id}: ${tris} triangles > budget ${TRI_BUDGET}`);
    total += tris;
    const base = id.split('#')[0];
    manifest.pieces[id] = { slots: parts.map(p => p.slot), tris, bounds: [min.map(v => +v.toFixed(3)), max.map(v => +v.toFixed(3))], ...PIECES[base].meta };
}
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'tileset.glb'), writeGlb(pieces));
fs.writeFileSync(path.join(OUT, 'tileset.json'), JSON.stringify(manifest, null, 1));
console.log(`tile set: ${pieces.size} pieces, ${total} triangles → ${path.relative(ROOT, OUT)}/tileset.glb`);
