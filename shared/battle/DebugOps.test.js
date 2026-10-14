import test from 'node:test';
import assert from 'node:assert/strict';
import { buildProvingGrounds } from '../mission/ProvingGrounds.js';
import { Battle } from './Battle.js';
import { alive } from './Units.js';

const squad = ['vanguard', 'grenadier', 'marksman', 'warden'].map(type => ({ type }));
const make = (debug = true) => new Battle({ mission: buildProvingGrounds({ seed: 1 }), squad, seed: 3, debug });

test('debug intents are rejected unless the battle was created in debug mode', () => {
    const b = make(false);
    assert.equal(b.apply({ type: 'debug', op: 'ap', unitId: 'p0' }).reason, 'debug_disabled');
});

test('debug: ap, god, kill, heal/revive, refill', () => {
    const b = make();
    const u = b.unit('p0');
    assert.ok(b.apply({ type: 'debug', op: 'ap', unitId: 'p0', amount: 3 }).ok);
    assert.equal(u.ap, 7);
    b.apply({ type: 'debug', op: 'god', unitId: 'p0', on: true });
    b.dealDamage(u, 'torso', 50, { pierce: 99 });
    assert.equal(u.hp, u.maxHp, 'god mode ignores damage');
    const e = b.unitsOf('enemy')[0];
    b.apply({ type: 'debug', op: 'kill', unitId: e.id });
    assert.ok(!alive(e));
    b.apply({ type: 'debug', op: 'heal', unitId: e.id });
    assert.ok(alive(e) && e.hp === e.maxHp, 'heal revives');
});

test('debug: teleport and spawn snap to the nearest free standing spot', () => {
    const b = make();
    const u = b.unit('p1');
    const r = b.apply({ type: 'debug', op: 'teleport', unitId: 'p1', to: { x: 30, y: 30, z: 1 } });
    assert.ok(r.ok, r.reason);
    assert.ok(Math.abs(u.x - 30) <= 3 && Math.abs(u.y - 30) <= 3);
    const n = b.units.length;
    const s = b.apply({ type: 'debug', op: 'spawn', unitType: 'brute', side: 'enemy', to: { x: u.x, y: u.y, z: u.z } });
    assert.ok(s.ok, s.reason);
    assert.equal(b.units.length, n + 1);
    const nu = b.units.at(-1);
    assert.ok(!(nu.x === u.x && nu.y === u.y && nu.z === u.z), 'spawn does not stack on an occupied tile');
    assert.ok(s.events.some(e => e.t === 'spawn'));
});

test('debug: place, destroy and explode change voxels and emit voxel events', () => {
    const b = make();
    const at = { x: 30, y: 40, z: 2 };
    const p = b.apply({ type: 'debug', op: 'place', at, material: 'stone', height: 2 });
    assert.ok(p.ok && p.events.some(e => e.t === 'voxels'));
    assert.ok(b.store.isSolid(30, 40, 2) && b.store.isSolid(30, 40, 3));
    const d = b.apply({ type: 'debug', op: 'destroy', at: { x: 30, y: 40, z: 3 }, radius: 0 });
    assert.ok(d.ok && !b.store.isSolid(30, 40, 3));
    const before = b.stats.voxelsDestroyed;
    const x = b.apply({ type: 'debug', op: 'explode', at: { x: 30.5, y: 40.5, h: 2.5 }, radius: 2, power: 12 });
    assert.ok(x.ok && b.stats.voxelsDestroyed > before);
});

test('debug: element and endSide', () => {
    const b = make();
    const r = b.apply({ type: 'debug', op: 'element', element: 'cryo', at: { x: 44, y: 33, h: 2 }, radius: 2 });
    assert.ok(r.ok);
    b.apply({ type: 'debug', op: 'endSide' });
    assert.equal(b.activeSide, 'enemy');
});

test('explicit refill restores physical consumables while preserving nested equipment and ammo',()=>{
 const b=make(),u=b.unit('p0');u.inventory=[{id:'spare',itemId:'rig_scout',x:0,y:0,rotated:false,contents:[{id:'nested-ammo',itemId:'ammo_ar',quantity:17,x:0,y:0,rotated:false}]}];u.items={};
 const rig=structuredClone(u.rigInventory);
 assert.ok(b.apply({type:'debug',op:'refill',unitId:u.id}).ok);
 assert.deepEqual(u.inventory.find(s=>s.id==='spare').contents,[{id:'nested-ammo',itemId:'ammo_ar',quantity:17,x:0,y:0,rotated:false}]);
 assert.deepEqual(u.rigInventory,rig);assert.equal(u.items.fire_flask,2);assert.equal(u.items.smoke_pot,2);
});
