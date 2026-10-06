// Tile-set rules without a GPU: autotiling decisions, roof surfaces and coverage (every voxel is drawn by exactly one
// of the cube mesher or the tile set).
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { buildProvingGrounds } from '../../../../shared/mission/ProvingGrounds.js';
import { MATERIALS, MAT, AIR } from '../../../../shared/voxel/Materials.js';
import { CHUNK } from '../../../../shared/voxel/VoxelStore.js';
import { buildAllPieces, PIECES } from './KitPieces.js';
import { KitView, kitHandler } from './KitView.js';
import { buildRoofGeometry, roofColumn } from './RoofBuilder.js';

const pieces = buildAllPieces();
const fakeKit = { piece: id => pieces.get(id) || pieces.get(`${id}#0`), material: () => new THREE.MeshBasicMaterial() };
const mission = buildProvingGrounds({ seed: 1 });
const store = mission.store;

function buildAll(cut = Infinity) {
    const view = new KitView(fakeKit, []);
    const byPiece = new Map();
    let roofs = 0;
    for (let cz = 0; cz < Math.ceil(store.height / CHUNK); cz++) for (let cy = 0; cy < Math.ceil(store.depth / CHUNK); cy++) for (let cx = 0; cx < Math.ceil(store.width / CHUNK); cx++) {
        for (const m of view.buildChunk(store, cx, cy, cz, { cutZ: cut })) {
            if (!m.isInstancedMesh) { roofs++; continue; }
            const id = [...pieces].find(([, parts]) => parts.some(p => p.geometry === m.geometry))?.[0];
            byPiece.set(id, (byPiece.get(id) || 0) + m.count);
        }
    }
    return { byPiece, roofs };
}

test('every piece builds within its cell (except the documented overhangs)', () => {
    const overhang = new Set(['cart_shaft', 'stall', 'foliage', 'hedge', 'stair_rail', 'rock#0', 'rock#1', 'rock#2', 'rock_top', 'door_open_lower', 'door_open_upper', 'cart_wheels']);
    for (const [id, parts] of pieces) {
        for (const { geometry } of parts) {
            geometry.computeBoundingBox();
            const b = geometry.boundingBox;
            if (overhang.has(id)) continue;
            assert.ok(b.min.x >= -0.53 && b.max.x <= 0.53 && b.min.z >= -0.53 && b.max.z <= 0.53, `${id} leaves its cell: ${JSON.stringify(b)}`);
            assert.ok(b.min.y >= -0.01 && b.max.y <= 1.11, `${id} height ${b.min.y}..${b.max.y}`);
        }
    }
    assert.ok(Object.keys(PIECES).length >= 40);
});

test('the proving grounds draws walls, windows, doors, stairs, roofs and every cover prop with tile-set pieces', () => {
    const { byPiece, roofs } = buildAll();
    for (const id of ['wall_core', 'wall_arm', 'window', 'door_lower', 'door_upper', 'stair_step', 'crate', 'barrel', 'sandbags', 'cart_body', 'stall', 'hedge', 'foliage', 'trunk_base'])
        assert.ok((byPiece.get(id) || 0) > 0, `no ${id} instances`);
    assert.ok(roofs > 0, 'the powder shack has a pitched roof surface');
});

test('every visible voxel is drawn by exactly one system', () => {
    for (let z = 0; z < store.height; z++) for (let y = 0; y < store.depth; y++) for (let x = 0; x < store.width; x++) {
        const id = store.get(x, y, z);
        if (id === AIR) continue;
        const m = MATERIALS[id];
        const kit = kitHandler(store, x, y, z, id);
        if (m.render === 'none' && m.key !== 'door_open') continue;
        assert.ok(kit !== undefined, `${m.key} at ${x},${y},${z}`);
        // cube-drawn materials must not be wall-like props the kit expects
        if (!kit) assert.ok(!['plaster', 'timber', 'crate', 'sandbag', 'drystone', 'fence', 'hay', 'cart', 'stall', 'rock', 'roof', 'glass', 'door'].includes(m.key), `${m.key} left to the cube mesher`);
    }
});

test('the storey cutaway drops roofs and caps cut walls', () => {
    const house = mission.buildings.find(b => b.id === 'house');
    const cut = house.baseZ + 3;
    const { byPiece, roofs } = buildAll(cut);
    assert.ok((byPiece.get('cap_core') || 0) > 0, 'cut walls get section caps');
    const full = buildAll();
    assert.ok(roofs <= full.roofs);
});

test('roof surfaces slope from eaves to ridge and hole where a roof voxel is destroyed', () => {
    const shack = mission.buildings.find(b => b.id === 'shack');
    const cx = Math.floor((shack.x0 + 3) / CHUNK), cy = Math.floor((shack.y0 + 3) / CHUNK);
    const col = roofColumn(store, shack.x0 + 3, shack.y0 + 3);
    assert.ok(col && col.top > col.bottom, 'stacked roof voxels in the middle of the roof');
    const g = buildRoofGeometry(store, cx, cy, Math.floor(col.top / CHUNK));
    assert.ok(g && g.attributes.position.count > 0);
    const ys = g.attributes.position.array.filter((_, i) => i % 3 === 1);
    assert.ok(Math.max(...ys) - Math.min(...ys) >= 2, 'the roof rises at least two voxels from eave to ridge');
    const s2 = store.clone();
    const cz = Math.floor(col.top / CHUNK);
    const before = buildRoofGeometry(s2, cx, cy, cz).attributes.position.count;
    for (let z = col.bottom; z <= col.top; z++) s2.set(shack.x0 + 3, shack.y0 + 3, z, AIR);
    const after = buildRoofGeometry(s2, cx, cy, cz)?.attributes.position.count ?? 0;
    assert.ok(after < before, 'a destroyed roof column leaves a hole');
});

test('pitched roofs are not walkable; flat roofs are', () => {
    assert.equal(MATERIALS[MAT.roof].walkable, false);
    const tower = mission.buildings.find(b => b.id === 'tower');
    const s = store.surfaces(tower.x0 + 3, tower.y0 + 3).at(-1);
    assert.ok(s && s.z >= tower.top, 'the watchtower roof is a walkable surface');
});
