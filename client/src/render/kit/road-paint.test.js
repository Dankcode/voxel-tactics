// PLAN-12: road paint is thin and centred, drawn over the asphalt (no painted voxel cells).
import test from 'node:test';
import assert from 'node:assert/strict';
import { planRoadPaint } from '../RoadMarkings.js';
import { generateOperation } from '../../../../shared/mapgen/Generator.js';
import { MAT } from '../../../../shared/voxel/Materials.js';
import { VoxelStore } from '../../../../shared/voxel/VoxelStore.js';

test('a 4-cell carriageway gets a dashed centre line exactly on its centre and zebras at the junction mouth', () => {
    const s = new VoxelStore(26, 16, 4);
    for (let y = 0; y < 16; y++) for (let x = 0; x < 24; x++) s.set(x, y, 1, MAT.concrete);
    for (let x = 0; x < 16; x++) for (let y = 6; y < 10; y++) s.set(x, y, 1, MAT.asphalt);          // road along x, rows 6–9
    for (let x = 16; x < 24; x++) for (let y = 2; y < 14; y++) s.set(x, y, 1, MAT.asphalt);         // a wide junction box
    const { dashes, bars } = planRoadPaint(s);
    assert.ok(dashes.length >= 6);
    for (const d of dashes) assert.equal((d.y0 + d.y1) / 2, 8, 'centred between rows 7 and 8');
    assert.ok(dashes.every(d => d.y1 - d.y0 < 0.2), 'a thin line, not a painted cell');
    assert.ok(bars.length >= 4 && bars.every(b => b.x0 >= 15 && b.x1 <= 16), 'zebra on the last carriageway cell before the junction');
    assert.ok(!dashes.some(d => d.x0 >= 16), 'no centre line through the junction box');
});

test('generated maps have no painted road_mark voxels and do get road paint', () => {
    const { mission: m } = generateOperation({ plot: 'downtown', seed: 1 });
    let marks = 0; for (let i = 0; i < m.store.mat.length; i++) if (m.store.mat[i] === MAT.road_mark) marks++;
    assert.equal(marks, 0);
    const { dashes } = planRoadPaint(m.store);
    assert.ok(dashes.length > 10, `${dashes.length} dashes`);
});
