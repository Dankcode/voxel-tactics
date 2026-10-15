// PLAN-07: blue area by the equipped gun, overwatch cancelled by moving, killstreaks without kills, penetration,
// breakable cover, scars and scorch.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Battle } from './Battle.js';
import { VoxelStore } from '../voxel/VoxelStore.js';
import { MAT } from '../voxel/Materials.js';
import { createRng } from '../util/Rng.js';
import { WEAPONS } from '../content/weapons.js';

export function arena(types = ['grenadier'], { enemy = [{ x: 12, y: 10 }, { x: 25, y: 8 }], size = 32 } = {}) {
    const store = new VoxelStore(size, size, 16); store.fill(0, 0, 0, size - 1, size - 1, 1, 'concrete');
    return new Battle({ mission: { id: 'combat-feel', name: 'Test', store, rooms: [], buildings: [], rng: createRng(1), meta: {}, objective: { kind: 'eliminate' },
        spawns: { player: types.map((_, i) => ({ x: 12 + i * 2, y: 23, z: 1 })), enemy: enemy.map((p, i) => ({ type: 'cultist', group: i, pos: { ...p, z: 1 } })) } },
    squad: types.map(type => ({ type })), seed: 2 });
}

test('blue tiles leave enough AP to fire or overwatch the equipped gun, not just to use a knife', () => {
    const b = arena(['grenadier']), u = b.unit('p0');
    assert.equal(WEAPONS[u.weapon].kind, 'ballistic');
    assert.equal(b.blueAp(u), WEAPONS[u.weapon].ap, 'rifle shot AP');
    const sniper = arena(['marksman']).unit('p0');
    assert.equal(arena(['marksman']).blueAp(sniper), WEAPONS[sniper.weapon].ap);
    // An empty gun with no reserve falls back to the cheapest remaining action.
    u.ammo[u.weapon] = 0; u.rigInventory = []; u.backpackInventory = []; u.pockets = [];
    assert.ok(b.blueAp(u) >= 1);
});

test('moving cancels your own overwatch; knockback does not', () => {
    const b = arena(['grenadier']), u = b.unit('p0');
    assert.ok(b.apply({ type: 'overwatch', unitId: u.id, toward: { x: 12, y: 1 } }).ok);
    assert.ok(u.overwatch);
    b.startSide('player');
    const r = b.apply({ type: 'move', unitId: u.id, to: { x: 13, y: 23, z: 1 } });
    assert.ok(r.ok, JSON.stringify(r));
    assert.equal(u.overwatch, null);
    assert.ok(r.events.some(e => e.t === 'overwatchCancel' && e.unitId === u.id));
    // Knockback is not a voluntary move.
    const b2 = arena(['grenadier']), w = b2.unit('p0');
    assert.ok(b2.apply({ type: 'overwatch', unitId: w.id, toward: { x: 12, y: 1 } }).ok);
    const x0 = w.x; b2.knockback(w, 1, 0, 1);
    assert.notEqual(w.x, x0, 'knocked back');
    assert.ok(w.overwatch, 'knockback keeps overwatch');
});
