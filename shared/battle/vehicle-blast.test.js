import test from 'node:test';
import assert from 'node:assert/strict';
import { MAT, materialById, AIR } from '../voxel/Materials.js';
import { damageVoxel } from '../voxel/Destruction.js';
import { Battle } from './Battle.js';
import { VoxelStore } from '../voxel/VoxelStore.js';

function arena(enemy) {
    const store = new VoxelStore(32, 32, 8);
    store.fill(0, 0, 0, 31, 31, 1, 'concrete');
    return new Battle({ mission: { id: 'vehicle-blast', store, rooms: [], buildings: [], meta: {}, objective: { kind: 'eliminate' },
        spawns: { player: [{ x: 12, y: 23, z: 1 }], enemy: [{ type: 'cultist', pos: { ...enemy, z: 1 } }] } },
    squad: [{ type: 'grenadier' }], seed: 2 });
}

test('vehicle armour survives ordinary chip damage and its destroyed body queues a blast', () => {
    const body = materialById(MAT.car_body);
    assert.ok(body.hp >= 18);
    const b = arena({ x: 2, y: 2 });
    b.store.set(12, 20, 2, MAT.car_body);
    const chipped = damageVoxel(b.store, 12, 20, 2, 7);
    assert.equal(chipped.destroyed, false);
    const destroyed = damageVoxel(b.store, 12, 20, 2, body.hp);
    assert.equal(destroyed.destroyed, true);
    assert.ok(destroyed.explosion.radius >= 3);
    assert.ok(destroyed.explosion.damage >= 7);
});

test('a destroyed vehicle hurts nearby units and destroys surrounding cover through the shared blast rules', () => {
    const b = arena({ x: 14, y: 20 });
    const enemy = b.unit('e0'), hp = enemy.hp;
    b.store.set(12, 20, 2, MAT.car_body);
    b.store.set(12, 21, 2, MAT.crate);
    const hit = damageVoxel(b.store, 12, 20, 2, materialById(MAT.car_body).hp);
    b.explode({ ...hit.explosion, by: 'p0' });
    assert.ok(enemy.hp < hp);
    assert.equal(b.store.get(12, 21, 2), AIR);
    assert.ok(b.log.some(e => e.t === 'explosion' && e.source === 'car_body'));
});
