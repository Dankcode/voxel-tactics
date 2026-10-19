// PLAN-07: cracks on damaged voxels, broken edges next to shot-out cells, soot from blasts and fire.
import test from 'node:test';
import assert from 'node:assert/strict';
import { VoxelStore } from '../../../../shared/voxel/VoxelStore.js';
import { MAT } from '../../../../shared/voxel/Materials.js';
import { edgeTexture } from '../DamageDecals.js';
import { damageVoxel, destroyVoxel, scorchBlast } from '../../../../shared/voxel/Destruction.js';
import { DamageDecals, damageLevel, faceMatrix } from '../DamageDecals.js';

const room = () => { const s = new VoxelStore(16, 16, 8); s.fill(0, 0, 0, 15, 15, 0, 'concrete'); return s; };

test('no decals on an intact world; cracks appear at 66 % and heavy cracks at 33 % HP', () => {
    const s = room(), d = new DamageDecals();
    for (let x = 4; x <= 8; x++) for (let z = 1; z <= 2; z++) s.set(x, 5, z, MAT.brick);
    assert.equal(d.collect(s, 0, 0, 0).length, 0);
    s.takeDirtyChunks();
    damageVoxel(s, 6, 5, 1, 4);                         // brick 9 → 5 (56 %)
    assert.equal(damageLevel(s, 6, 5, 1), 1);
    assert.ok(s.dirtyChunks.size > 0, 'crossing a damage band marks the chunk for a redraw');
    const cracks = d.collect(s, 0, 0, 0).filter(x => x.kind === 'crack');
    assert.ok(cracks.length >= 2, 'both broad faces of the wall show cracks');
    damageVoxel(s, 6, 5, 1, 3);                         // 2 / 9
    assert.equal(damageLevel(s, 6, 5, 1), 2);
    assert.ok(d.collect(s, 0, 0, 0).some(x => x.kind === 'heavy'));
});

test('a shot-out cell leaves broken material on the neighbours facing it and frayed edges beside it', () => {
    const s = room(), d = new DamageDecals();
    for (let x = 4; x <= 8; x++) for (let z = 1; z <= 2; z++) s.set(x, 5, z, MAT.concrete_wall);
    destroyVoxel(s, 6, 5, 1);
    assert.ok(s.scars.has('6,5,1'));
    const out = d.collect(s, 0, 0, 0);
    assert.ok(out.filter(x => x.kind === 'rubble').length >= 3, 'left, right and above see into the hole');
    assert.ok(out.some(x => x.kind === 'fray'), 'broad faces fray toward the hole');
    // Rebuilding the cell removes the scar decals.
    s.set(6, 5, 1, MAT.concrete_wall);
    assert.equal(d.collect(s, 0, 0, 0).filter(x => x.kind === 'rubble').length, 0);
});

test('blasts and fire leave soot: burn marks on floors and soot on walls; meshes batch per kind', () => {
    const s = room(), d = new DamageDecals();
    s.set(9, 9, 1, MAT.brick); s.set(9, 9, 2, MAT.brick);
    scorchBlast(s, { x: 8.5, y: 8.5, h: 1.4, radius: 2 });
    const out = d.collect(s, 0, 0, 0);
    assert.ok(out.some(x => x.kind === 'scorch'), 'the floor is burnt');
    assert.ok(out.some(x => x.kind === 'soot'), 'the wall is sooty');
    // PLAN-09: every sooty side face also gets chipped, broken edges (XCOM-style blast wear), never the floor.
    const sootFaces = out.filter(x => x.kind === 'soot').length, edges = out.filter(x => x.kind === 'edge');
    assert.equal(edges.length, sootFaces);
    assert.ok(edges.every(x => x.opacity > 0 && x.tint !== 0xffffff), 'tinted by material, faded by soot level');
    const meshes = d.buildChunk(s, 0, 0, 0);
    assert.equal(meshes.reduce((n, m) => n + m.count, 0), out.length);
    assert.ok(meshes.every(m => m.isInstancedMesh && m.material.transparent && m.material.depthWrite === false));
    // Cut-away storeys hide their decals.
    assert.ok(!d.collect(s, 0, 0, 0, { cutZ: 1 }).some(x => x.kind === 'soot'), 'the cut-away wall shows no soot');
});

test('decals sit on the real footprint of thin walls, not on the cell face', () => {
    const m = faceMatrix({ x0: 4, x1: 5, y0: 5.3, y1: 5.7 }, 1, [0, 1, 0]);
    const p = { x: m.elements[12], y: m.elements[13], z: m.elements[14] };
    assert.ok(Math.abs(p.z - 5.712) < 1e-6, `face plane at y 5.712, got ${p.z}`);
    assert.ok(Math.abs(p.y - 1.5) < 1e-6);
});

test('the edge-chip texture is opaque along all four edges and clear in the middle', () => {
    const t = edgeTexture(), n = t.image.width, a = (x, y) => t.image.data[(y * n + x) * 4 + 3];
    for (const [x, y] of [[n >> 1, 1], [n >> 1, n - 2], [1, n >> 1], [n - 2, n >> 1]]) assert.ok(a(x, y) > 150, `edge ${x},${y}`);
    assert.equal(a(n >> 1, n >> 1), 0);
});

test('PLAN-12: a hole shot above the storey cut leaves no marks on the floor in view, and cut caps carry none', () => {
    const s = room();
    for (let z = 1; z <= 6; z++) for (let y = 2; y <= 10; y++) s.set(6, y, z, MAT.brick);     // a storey-plus wall
    destroyVoxel(s, 6, 6, 4);                                                                 // shot out just above the cut
    const d = new DamageDecals();
    const above = d.collect(s, 0, 0, 0, { cutZ: Infinity });
    assert.ok(above.some(x => x.kind === 'rubble' || x.kind === 'fray'), 'visible with the full view');
    const cut = d.collect(s, 0, 0, 0, { cutZ: 4 });
    assert.equal(cut.filter(x => x.matrix.elements[13] > 3.9).length, 0, 'nothing on the cut cap or above it');
});
