// Old buildings render with straight edges (slabs, walls, furniture); modern ones stay rounded.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { VoxelStore } from '../../../../shared/voxel/VoxelStore.js';
import { MAT } from '../../../../shared/voxel/Materials.js';
import { markBuildingEdges } from '../../../../shared/mission/BuildingEra.js';
import { createMap } from '../../../../shared/mission/modern/MapKit.js';
import { CHUNK } from '../../../../shared/voxel/VoxelStore.js';
import { meshChunk } from '../ChunkMesher.js';
import { KitView } from './KitView.js';
import { KitLibrary } from './KitLibrary.js';
import { softBox, withSharpEdges } from './Geo.js';
import { MODERN_PIECES } from './ModernPieces.js';

const offAxis = n => [0, 1, 2].filter(i => Math.abs(n[i]) > 1e-3).length > 1;

test('slab voxels in an old building keep sharp cube edges; a modern slab gets fillets', () => {
    const st = new VoxelStore(16, 16, 8);
    for (const x0 of [2, 9]) for (let y = 2; y < 6; y++) for (let x = x0; x < x0 + 4; x++) st.set(x, y, 1, MAT.concrete);
    markBuildingEdges(st, { x0: 9, y0: 2, w: 4, d: 4 }, 'old');
    const filleted = { modern: 0, old: 0 };
    for (const b of meshChunk(st, 0, 0, 0)) for (let i = 0; i < b.normals.length; i += 3) {
        const n = b.normals.slice(i, i + 3), x = b.positions[i];      // three.js x = world x
        if (offAxis(n)) filleted[x < 8 ? 'modern' : 'old']++;
    }
    assert.ok(filleted.modern > 0, 'modern slab is rounded');
    assert.equal(filleted.old, 0, 'old slab is straight');
});

test('withSharpEdges straightens soft boxes and reports what it changed', () => {
    const corner = g => { g.computeBoundingBox(); const p = g.attributes.position; let best = 0; for (let i = 0; i < p.count; i++) best = Math.max(best, Math.abs(p.getX(i)) + Math.abs(p.getY(i)) + Math.abs(p.getZ(i))); return best; };
    assert.ok(corner(softBox(1, 1, 1, 0.2)) < 1.45, 'soft by default');
    const { value, softened } = withSharpEdges(() => softBox(1, 1, 1, 0.2));
    assert.equal(softened, 1); assert.ok(Math.abs(corner(value) - 1.5) < 1e-6, 'a real corner when sharp');
    assert.ok(corner(softBox(1, 1, 1, 0.2)) < 1.45, 'sharp mode ends with the build');
});

test('the kit builds straight variants only for pieces that had bevels', () => {
    const kit = new KitLibrary(null);
    const soft = Object.keys(MODERN_PIECES).find(id => withSharpEdges(() => MODERN_PIECES[id].build()).softened > 0);
    assert.ok(soft, 'some modern furniture is bevelled');
    assert.notEqual(kit.piece(`${soft}@sharp`), kit.piece(soft), `${soft} has its own straight geometry`);
    const plain = Object.keys(MODERN_PIECES).find(id => withSharpEdges(() => MODERN_PIECES[id].build()).softened === 0);
    assert.equal(kit.piece(`${plain}@sharp`), kit.piece(plain), 'unbevelled pieces share geometry');
});

test('furniture and walls in the old half of a merged pair are drawn straight, the modern half rounded', () => {
    const m = createMap({ id: 'era-view', width: 34, depth: 20, seed: 3 });
    m.building({ id: 'modern', program: 'office', x0: 3, y0: 3, w: 12, d: 10, storeys: 1, front: 's', era: 'modern' });
    const old = m.building({ id: 'old', program: 'office', x0: 14, y0: 3, w: 12, d: 10, storeys: 1, front: 's', era: 'old' });
    const asked = [];
    const kit = { piece: id => { asked.push(id); return [{ slot: 'self', geometry: new THREE.BoxGeometry() }]; }, material: () => new THREE.MeshBasicMaterial() };
    const view = new KitView(kit, []);
    view.setVisual({ hints: m.ctx.hints, decor: m.ctx.decor });
    const st = m.store;
    for (let cz = 0; cz < Math.ceil(st.height / CHUNK); cz++) for (let cy = 0; cy < Math.ceil(st.depth / CHUNK); cy++) for (let cx = 0; cx < Math.ceil(st.width / CHUNK); cx++) view.buildChunk(st, cx, cy, cz);
    assert.ok(asked.some(id => id.startsWith('square_wall_')), 'old walls use the straight family');
    assert.ok(asked.some(id => /^(joined_wall|facade_)/.test(id)), 'modern walls keep the rounded families');
    assert.ok(asked.some(id => id.endsWith('@sharp')), 'old furniture asks for straight variants');
    assert.ok(asked.some(id => !id.endsWith('@sharp') && !id.startsWith('square_') && !/wall|cap|glaze|door|window/.test(id)), 'modern furniture keeps its soft pieces');
    assert.equal(old.era, 'old');
});
