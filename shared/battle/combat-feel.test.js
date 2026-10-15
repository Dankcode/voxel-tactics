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

import { traceProjectile } from './Ballistics.js';
import { CALIBERS } from '../content/calibers.js';
const shootThrough = (keys, energy) => {
    const b = arena(['grenadier'], { enemy: [{ x: 2, y: 2 }, { x: 3, y: 2 }] });
    keys.forEach((k, i) => { for (let h = 2; h <= 3; h++) b.store.set(12, 18 - i * 2, h, MAT[k]); });
    return traceProjectile(b, { x: 12.5, y: 21.5, h: 2.5 }, [0, -1, 0], 15, { energy });
};

test('penetration: 5.56 goes through a crate but stops in brick; 7.62×39 gets through one brick; .338 through concrete', () => {
    const ar = shootThrough(['crate', 'brick'], CALIBERS['5.56'].energy);
    assert.equal(ar.kind, 'voxel'); assert.equal(ar.pierced.length, 1); assert.equal(ar.voxel.y, 16, 'stopped in the brick');
    const ak = shootThrough(['brick', 'brick'], CALIBERS['7.62x39'].energy);
    assert.equal(ak.pierced.length, 1); assert.equal(ak.voxel.y, 16);
    const sniper = shootThrough(['concrete_wall'], CALIBERS['338'].energy);
    assert.equal(sniper.pierced.length, 1); assert.notEqual(sniper.kind, 'voxel');
    const pistol = shootThrough(['stucco'], CALIBERS['9mm'].energy);
    assert.equal(pistol.pierced.length, 0, 'a pistol round stops in a stucco wall');
    // Ground and steel always stop a round.
    const steel = shootThrough(['metal'], 99); assert.equal(steel.pierced.length, 0);
    // No energy = the old behaviour (stops at the first block).
    assert.equal(shootThrough(['crate'], 0).pierced.length, 0);
});

test('a unit behind thin cover is hit with reduced damage; behind brick an AR round never reaches it', () => {
    const b = arena(['grenadier'], { enemy: [{ x: 12, y: 15 }] }), e = b.unit('e0');
    for (let h = 2; h <= 3; h++) b.store.set(12, 17, h, MAT.crate);
    const r = traceProjectile(b, { x: 12.5, y: 21.5, h: 2.5 }, [0, -1, 0], 15, { energy: CALIBERS['5.56'].energy });
    assert.equal(r.kind, 'unit'); assert.equal(r.unit.id, e.id); assert.equal(r.pierced.length, 1);
    assert.ok(r.scale < 1 && r.scale >= 0.25, `scale ${r.scale}`);
    for (let h = 2; h <= 3; h++) b.store.set(12, 17, h, MAT.brick);
    const s = traceProjectile(b, { x: 12.5, y: 21.5, h: 2.5 }, [0, -1, 0], 15, { energy: CALIBERS['5.56'].energy });
    assert.equal(s.kind, 'voxel');
});

test('cover breaks: one AR burst opens a car-cabin cell, and pierced voxels take damage too', () => {
    const b = arena(['grenadier'], { enemy: [{ x: 2, y: 2 }] }), u = b.unit('p0');
    for (let x = 11; x <= 13; x++) for (let h = 2; h <= 3; h++) b.store.set(x, 20, h, MAT.car_cabin);
    b.startSide('player');
    const r = b.apply({ type: 'shoot', unitId: u.id, fireMode: 'burst', aim: { point: { x: 12.5, y: 20.5, h: 2.5 } } });
    assert.ok(r.ok, JSON.stringify(r));
    const changes = r.events.filter(e => e.t === 'voxels').flatMap(e => e.changes);
    assert.ok(changes.some(([x, y, z, before, after]) => before === MAT.car_cabin && after === 0), 'a cabin cell is destroyed');
});

test('penetrating fire is deterministic across lockstep peers', () => {
    const run = () => { const b = arena(['grenadier'], { enemy: [{ x: 12, y: 14 }] }); for (let h = 2; h <= 3; h++) b.store.set(12, 18, h, MAT.crate); b.startSide('player');
        b.apply({ type: 'shoot', unitId: 'p0', fireMode: 'auto', aim: { unitId: 'e0', part: 'torso' } }); return b.hash(); };
    assert.equal(run(), run());
});

import { softAt, hardCoverAgainst, coverAt, COVER } from '../voxel/Cover.js';
test('soft cover: crates and car cabins read as soft against a rifle round; brick does not', () => {
    const b = arena(['grenadier']), s = b.store;
    for (let h = 2; h <= 3; h++) { s.set(5, 4, h, MAT.crate); s.set(7, 5, h, MAT.brick); }
    assert.equal(coverAt(s, 5, 5, 1).n, COVER.FULL);
    assert.equal(softAt(s, 5, 5, 1).n, true);
    assert.equal(softAt(s, 6, 5, 1).e, false, 'brick is hard');
    const r = hardCoverAgainst(s, 5, 5, 1, 5, 0, 1);
    assert.deepEqual(r, { level: COVER.FULL, soft: true });
    assert.equal(hardCoverAgainst(s, 5, 5, 1, 5, 0, 1, 1).soft, false, 'a shotgun pellet does not get through a crate');
});

test('scars and scorch: a shot-out voxel leaves a scar, a grenade blackens its radius, both are deterministic', () => {
    const run = () => {
        const b = arena(['grenadier'], { enemy: [{ x: 2, y: 2 }] }), s = b.store;
        for (let h = 2; h <= 3; h++) s.set(12, 20, h, MAT.crate);
        b.startSide('player');
        b.apply({ type: 'shoot', unitId: 'p0', fireMode: 'auto', aim: { point: { x: 12.5, y: 20.5, h: 2.5 } } });
        b.explode({ x: 20.5, y: 10.5, h: 2.2, radius: 2.6, power: 4, damage: 0, element: null });
        return b;
    };
    const b = run();
    assert.ok([...b.store.scars].some(k => k.startsWith('12,20,')), 'the destroyed crate cell is a scar');
    assert.equal(b.store.scorch.get('20,10,1'), 3, 'the floor under the blast centre is black');
    assert.ok([...b.store.scorch.values()].includes(1), 'lighter marks toward the edge');
    assert.equal(b.hash(), run().hash());
    // Rebuilding a scarred cell clears the scar; clones carry the marks.
    const k = [...b.store.scars][0], [x, y, z] = k.split(',').map(Number);
    const c = b.store.clone(); assert.ok(c.scars.has(k) && c.scorch.size === b.store.scorch.size);
    b.store.set(x, y, z, MAT.crate); assert.equal(b.store.scars.has(k), false);
});

test('fire leaves burn marks on the floor when a voxel burns out', () => {
    const b = arena(['grenadier'], { enemy: [{ x: 2, y: 2 }] }), s = b.store;
    s.set(20, 20, 2, MAT.crate);
    assert.ok(b.field.ignite(20, 20, 2));
    for (let i = 0; i < 8; i++) b.field.tick(b.rng, { spreadChance: 0 });
    assert.equal(s.get(20, 20, 2), 0);
    assert.ok((s.scorch.get('20,20,1') || 0) >= 2, 'floor under the burnt crate is scorched');
});

test('! alerts: path steps a visible enemy overwatch covers, and soldiers flanked by visible enemies', () => {
    const b = arena(['grenadier'], { enemy: [{ x: 12, y: 12 }] }), u = b.unit('p0'), e = b.unit('e0');
    e.overwatch = { weaponId: e.weapon, dx: 0, dy: 1, halfAngle: Math.PI / 4, range: 20 };
    b.updateVisibility();
    assert.ok(b.visible.has(e.id), 'the watcher is known');
    const path = [{ x: 12, y: 23, z: 1 }, { x: 12, y: 22, z: 1 }, { x: 13, y: 22, z: 1 }];
    const t = b.overwatchThreats(u, path);
    assert.ok(t.length >= 1 && t.every(s => s.index > 0 && s.watcherId === e.id));
    // A watcher the squad has not seen gives no warning.
    b.visible.delete(e.id);
    assert.equal(b.overwatchThreats(u, path).length, 0);
    b.updateVisibility();
    // In the open, the soldier is flanked by the visible enemy; behind a wall facing it, it is not.
    assert.deepEqual(b.flankedBy(u).map(x => x.id), [e.id]);
    for (const x of [11, 12, 13]) for (let h = 2; h <= 3; h++) b.store.set(x, 22, h, MAT.brick);
    assert.equal(b.flankedBy(u).length, 0);
});
