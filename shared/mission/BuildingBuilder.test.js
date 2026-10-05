import test from 'node:test';
import assert from 'node:assert/strict';
import { VoxelStore } from '../voxel/VoxelStore.js';
import { MAT } from '../voxel/Materials.js';
import { createRng } from '../util/Rng.js';
import { buildBuilding, planInterior, STOREY } from './BuildingBuilder.js';
import { reachable, nodeKey } from '../world/PathSearch.js';
import { AGENT_PROFILES } from '../world/TraversalRules.js';

function flatStore(w = 32, d = 32, h = 18) {
    const s = new VoxelStore(w, d, h);
    for (let y = 0; y < d; y++) for (let x = 0; x < w; x++) { s.set(x, y, 0, MAT.bedrock); s.set(x, y, 1, MAT.grass); }
    return s;
}
function build(spec) {
    const store = flatStore();
    let next = 0;
    const ctx = { rng: createRng(7), rooms: [], nextRoomId: () => next++ };
    const b = buildBuilding(store, { id: 'b', x0: 8, y0: 8, w: 12, d: 10, baseZ: 1, storeys: 2, wall: 'stone', role: 'keep', entry: { side: 'n' }, roof: 'flat', ...spec }, ctx);
    return { store, b, ctx };
}

test('corridor plan for a large footprint, split plan for a house', () => {
    const rng = createRng(1);
    assert.equal(planInterior({ x0: 0, y0: 0, w: 12, d: 10 }, rng).layout, 'corridor');
    assert.equal(planInterior({ x0: 0, y0: 0, w: 8, d: 10 }, rng).layout, 'split');
    assert.equal(planInterior({ x0: 0, y0: 0, w: 5, d: 5 }, rng).layout, 'single');
});

test('building is hollow with storeys every 3 voxels and a door on the entry side', () => {
    const { store, b } = build();
    assert.equal(b.storeys, 2);
    // inside air above the ground floor slab
    const inside = b.rooms.find(r => r.storey === 0 && r.kind === 'corridor').cells[0];
    assert.equal(store.get(inside[0], inside[1], 2), 0);
    assert.equal(store.get(inside[0], inside[1], 3), 0);
    assert.ok(store.isSolid(inside[0], inside[1], 1 + STOREY) || b.stairs.some(s => s.cells.some(c => c.x === inside[0] && c.y === inside[1])));
    const ext = b.doors.filter(d => d.exterior);
    assert.ok(ext.length >= 2, 'entry plus a back door');
    assert.equal(ext[0].side, 'n');
    assert.equal(store.get(ext[0].x, ext[0].y, 2), MAT.door);
    assert.ok(b.windows.length > 4);
});

test('every room on every storey is reachable from outside the entry door, including via stairs', () => {
    const { store, b } = build();
    const e = b.doors.find(d => d.exterior);
    const start = store.surfaceNear(e.x, e.y - 1, 1);
    const search = reachable(store, start, Infinity, AGENT_PROFILES.player);
    for (const room of b.rooms) {
        const ok = room.cells.some(([x, y]) => search.costs.has(nodeKey({ x, y, z: room.floorZ })));
        assert.ok(ok, `room ${room.id} (${room.kind}, storey ${room.storey}) reachable`);
    }
});

test('a single-storey flat-roofed keep has a stair to its roof', () => {
    const { store, b } = build({ storeys: 1 });
    assert.ok(b.stairs.some(s => s.toRoof));
    const e = b.doors.find(d => d.exterior);
    const search = reachable(store, store.surfaceNear(e.x, e.y - 1, 1), Infinity, AGENT_PROFILES.player);
    assert.ok([...search.nodes.values()].some(n => n.z === b.top), 'roof reachable');
});

test('a house with a split plan is fully reachable and furnished', () => {
    const { store, b } = build({ w: 8, d: 10, storeys: 1, role: 'home', wall: 'timber', roof: 'dome', entry: { side: 'w' } });
    const e = b.doors.find(d => d.exterior && d.side === 'w');
    const search = reachable(store, store.surfaceNear(e.x - 1, e.y, 1), Infinity, AGENT_PROFILES.player);
    for (const room of b.rooms) assert.ok(room.cells.some(([x, y]) => search.costs.has(nodeKey({ x, y, z: 1 }))), `room ${room.kind}`);
    let furniture = 0;
    for (const r of b.rooms) for (const [x, y] of r.cells) { const id = store.get(x, y, 2); if (id && id !== MAT.door) furniture++; }
    assert.ok(furniture >= 2, 'some furniture placed');
});
