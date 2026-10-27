import test from 'node:test';
import assert from 'node:assert/strict';
import { programForTags } from './geo/GeoPrograms.js';
import { furnitureForRoom } from '../mission/modern/ModernBuilder.js';
import { roomSlots } from './FurnishSolver.js';
import { VoxelStore } from '../voxel/VoxelStore.js';

test('source functions select distinct plans and trade-specific furniture', () => {
    for (const [tags, expected, item] of [
        [{ shop: 'supermarket' }, 'supermarket', 'chest_freezer'],
        [{ shop: 'hardware' }, 'hardware', 'parts_bin'],
        [{ amenity: 'marketplace' }, 'market', 'market_stall'],
        [{ building: 'warehouse' }, 'warehouse', 'warehouse_rack']
    ]) {
        const use = programForTags(tags);
        assert.equal(use.program, expected);
        assert.ok(use.def.rows.flatMap(row => row.rooms).some(r => furnitureForRoom({ kind: r.kind }, 1).includes(item)));
    }
    assert.equal(programForTags({ shop: 'car_repair' }).program, 'garage');
    assert.ok(!furnitureForRoom({ kind: 'grocery' }, 1).includes('hardware_shelf'));
    const large = furnitureForRoom({ kind: 'grocery', cells: Array(700) }, 1);
    assert.equal(large.filter(id => id === 'checkout').length, 1);
    assert.ok(large.filter(id => id === 'aisle').length >= 8);
});

test('room recipes vary across seeds and replay deterministically', () => {
    for (const kind of ['office', 'bedroom', 'living', 'dining', 'warehouse']) {
        const room = { id: 2, kind, floorZ: 1 };
        const recipes = Array.from({ length: 20 }, (_, seed) => furnitureForRoom(room, seed));
        assert.ok(new Set(recipes.map(r => JSON.stringify(r))).size >= 3, kind);
        assert.deepEqual(furnitureForRoom(room, 5), furnitureForRoom(room, 5));
    }
});

test('operation centre slots accommodate full-length retail shelves and conveyors', () => {
    const cells = Array.from({ length: 81 }, (_, i) => [i % 9 + 1, Math.floor(i / 9) + 1]);
    const slots = roomSlots(new VoxelStore(12, 12, 5), { cells }, new Set(cells.map(c => c.join(','))), 1);
    assert.ok(slots.some(s => s.kind === 'center' && s.cells.length >= 3));
    assert.equal(new Set(slots.flatMap(s => s.cells.map(c => c.join(',')))).size, slots.reduce((n, s) => n + s.cells.length, 0), 'slots never overlap');
});
