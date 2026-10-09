import test from 'node:test';
import assert from 'node:assert/strict';
import { Battle } from './Battle.js';
import { VoxelStore } from '../voxel/VoxelStore.js';
import { MAT, AIR } from '../voxel/Materials.js';
import { addStatus, hasStatus } from './Units.js';
import { WEAPONS } from '../content/weapons.js';
import { estimateShot, traceProjectile } from './Ballistics.js';
import { formationIntents } from './Ai.js';
import { COVER, coverAgainst } from '../voxel/Cover.js';
import { buildProvingGrounds } from '../mission/ProvingGrounds.js';
import { MAPS } from '../mission/Maps.js';

function arena({ squad = ['grenadier', 'marksman'], players = [{ x: 10, y: 16, z: 1 }, { x: 11, y: 16, z: 1 }] } = {}) {
    const store = new VoxelStore(24, 24, 10);
    for (let y = 0; y < 24; y++) for (let x = 0; x < 24; x++) {
        store.set(x, y, 0, MAT.bedrock); store.set(x, y, 1, MAT.grass);
    }
    return new Battle({ mission: { id: 'mechanics-arena', store, rooms: [], buildings: [],
        spawns: { player: players, enemy: [{ type: 'brute', pos: { x: 10, y: 6, z: 1 }, group: 1 }] } },
        squad: squad.map(type => ({ type })), seed: 7 });
}

test('burning deals exactly two own-turn ticks and expires without refreshing itself', () => {
    const b = arena(), u = b.unit('p0'), hp = u.hp;
    addStatus(u, 'burning');
    b.startSide('player'); assert.equal(u.hp, hp - 2);
    b.startSide('player'); assert.equal(u.hp, hp - 4); assert.ok(!hasStatus(u, 'burning'));
    b.startSide('player'); assert.equal(u.hp, hp - 4);
});

test('panic, freezing and suppression last through the affected own turn', () => {
    const b = arena(), u = b.unit('p0');
    addStatus(u, 'panicked'); addStatus(u, 'frozen'); addStatus(u, 'suppressed');
    b.startSide('player');
    assert.equal(u.ap, 2); assert.equal(b.mobility(u), 0);
    assert.equal(b.apply({ type: 'ability', unitId: u.id, abilityId: 'demolish' }).reason, 'no_will');
    assert.ok(hasStatus(u, 'suppressed'));
    b.endTurn('player');
    assert.ok(!hasStatus(u, 'panicked')); assert.ok(!hasStatus(u, 'frozen')); assert.ok(!hasStatus(u, 'suppressed'));
    b.endTurn('enemy'); assert.equal(u.ap, 4); assert.ok(b.mobility(u) > 0);
});

test('suppressive fire pays ability AP and Will, uses ammo and rejects free shot flags', () => {
    const b = arena(), u = b.unit('p0'), target = b.unit('e0');
    const will = u.will, ammo = u.ammo.repeater;
    assert.equal(b.apply({ type: 'shoot', unitId: 'p1', aim: { unitId: target.id }, suppress: true }).reason, 'bad_intent');
    const intent = { type: 'ability', abilityId: 'suppress', unitId: u.id, targetId: target.id };
    assert.ok(b.apply(intent).ok);
    assert.equal(u.ap, 2); assert.equal(u.will, will - 2); assert.equal(u.ammo.repeater, ammo - 3);
    assert.ok(hasStatus(target, 'suppressed'));
    u.ammo.repeater = 0;
    const before = b.hash(); assert.equal(b.apply(intent).reason, 'no_ammo'); assert.equal(b.hash(), before);
});

test('glass is physical cover until the first impact destroys it', () => {
    const b = arena(), u = b.unit('p1'), e = b.unit('e0');
    Object.assign(u, { x: 10, y: 16 }); Object.assign(b.unit('p0'), { x: 5, y: 16 });
    for (const z of [2, 3]) b.store.set(10, 7, z, MAT.glass);
    assert.equal(coverAgainst(b.store, e.x, e.y, e.z, u.x, u.y), COVER.FULL);
    const aim = { unitId: e.id, part: 'torso' };
    const est = estimateShot(b, u, aim, { weapon: WEAPONS.longrifle, spread: 0.1, samples: 32 });
    assert.equal(est.hit, 0); assert.equal(est.cover, 1);
    const first = traceProjectile(b, { x: 10.5, y: 16.5, h: 3.05 }, [0, -1, 0], 20, { ignore: u.id });
    assert.equal(first.kind, 'voxel'); assert.equal(first.voxel.z, 3);
    assert.ok(b.apply({ type: 'shoot', unitId: u.id, aim }).ok);
    assert.ok([2, 3].some(z => b.store.get(10, 7, z) === AIR));
    const shot = b.log.find(e => e.t === 'shot'), impact = shot.projectiles[0];
    assert.equal(impact.kind, 'voxel'); assert.ok(impact.destroyed);
    const delta = [impact.to.x - shot.muzzle.x, impact.to.y - shot.muzzle.y, impact.to.h - shot.muzzle.h];
    const length = Math.hypot(...delta);
    const clear = traceProjectile(b, shot.muzzle, delta.map(v => v / length), 20, { ignore: u.id });
    assert.equal(clear.kind, 'unit', 'the same ray can cross the pane its previous impact destroyed');
});

test('unit targeting requires squad sight; free aim can still shoot opaque cover', () => {
    const b = arena(), u = b.unit('p0'), e = b.unit('e0');
    for (let x = 0; x < 24; x++) for (let z = 2; z <= 4; z++) b.store.set(x, 10, z, MAT.concrete_wall);
    assert.equal(b.apply({ type: 'shoot', unitId: u.id, aim: { unitId: e.id } }).reason, 'no_target');
    assert.ok(b.apply({ type: 'shoot', unitId: u.id, aim: { point: { x: 10.5, y: 10.5, h: 3 } } }).ok);
});

test('formation validation rejects zero-AP alignment, duplicate members and invalid leaders atomically', () => {
    const b = arena(), a = b.unit('p0'), c = b.unit('p1');
    c.y = 15; c.ap = 0;
    const intent = { type: 'formation', unitId: a.id, leaderId: a.id, memberIds: [a.id, c.id], template: 'shield_line', facing: 'n' };
    const before = b.hash(); assert.equal(b.apply(intent).reason, 'formation_invalid'); assert.equal(b.hash(), before);
    c.ap = 1; assert.ok(b.apply(intent).ok); assert.equal(c.ap, 0);
    const fresh = arena();
    assert.equal(fresh.apply({ ...intent, memberIds: ['p0', 'p0'] }).reason, 'formation_invalid');
    assert.equal(fresh.apply({ ...intent, leaderId: 'e0' }).reason, 'formation_invalid');
});

test('co-op formation creation and breakup respect every participant ownership', () => {
    const b = arena(), a = b.unit('p0'), c = b.unit('p1'); a.owner = 'P1'; c.owner = 'P2';
    const intent = { type: 'formation', unitId: a.id, memberIds: [a.id, c.id], template: 'shield_line', facing: 'n' };
    assert.equal(b.apply({ ...intent, by: 'P1' }).reason, 'not_your_unit');
    assert.ok(b.apply({ ...intent, by: '*' }).ok);
    assert.equal(b.apply({ type: 'formation_break', formationId: a.formationId, by: 'P2' }).reason, 'not_your_unit');
    assert.equal(b.apply({ type: 'formation_break', formationId: a.formationId, by: 'P1' }).reason, 'not_your_unit');
});

test('charge breach protects participants from its initial blast and still opens the room', () => {
    const mission = buildProvingGrounds({ seed: 1 });
    const b = new Battle({ mission, squad: ['warden', 'vanguard', 'grenadier'].map(type => ({ type })), seed: 2 });
    const door = mission.buildings.find(x => x.id === 'bunker').doors.find(d => d.exterior && d.side === 's');
    b.unitsOf('player').forEach((u, i) => Object.assign(u, { x: door.x - i, y: door.y + 1, z: door.z }));
    const ids = ['p0', 'p1', 'p2'], hp = ids.map(id => b.unit(id).hp);
    const intent = { type: 'breach', unitId: 'p0', unitIds: ids, door, entry: 'charge' };
    b.unit('p1').owner = 'P2'; assert.equal(b.apply({ ...intent, by: 'player' }).reason, 'not_your_unit');
    assert.equal(b.apply({ ...intent, unitIds: ['p0', 'p0'] }).reason, 'bad_intent');
    assert.ok(b.apply({ ...intent, by: '*' }).ok);
    assert.ok(ids.every(id => !hasStatus(b.unit(id), 'stunned')));
    assert.ok(!b.log.some(e => e.t === 'damage' && ids.includes(e.unitId) && e.element === 'geo'));
    assert.ok(b.log.some(e => e.t === 'breach')); assert.equal(b.unit('p0').items.breach_charge, 1);
    // Falls or defender reactions remain dangerous; only the initial charge blast is protected.
    assert.ok(ids.every((id, i) => b.unit(id).hp <= hp[i]));
});

test('a burning fuel drum detonates once, chains into another drum and damages nearby units', () => {
    const b = arena(), target = b.unit('e0');
    b.store.set(10, 7, 2, MAT.barrel_powder); b.store.set(11, 7, 2, MAT.barrel_powder);
    b.field.ignite(10, 7, 2); b.roundEnd();
    assert.equal(b.store.get(10, 7, 2), AIR); assert.equal(b.store.get(11, 7, 2), AIR);
    assert.equal(b.log.filter(e => e.t === 'explosion' && e.source === 'barrel_powder').length, 2);
    assert.ok(hasStatus(target, 'burning'));
    const count = b.log.filter(e => e.t === 'explosion').length;
    b.roundEnd(); assert.equal(b.log.filter(e => e.t === 'explosion').length, count);
});

test('autopilot formation policy returns ordered intents without mutating the battle', () => {
    const b = arena(); for (let x = 9; x <= 12; x++) b.store.set(x, 15, 2, MAT.sandbag);
    const before = b.hash(), intents = formationIntents(b, 'player');
    assert.equal(b.hash(), before); assert.equal(intents[0]?.type, 'formation');
    assert.ok(b.apply(intents[0]).ok); assert.ok(b.unit('p0').formationId);
});

test('lockstep hash detects ammo, statuses, Will, voxel HP, RNG and turn-state divergence', () => {
    const mutations = [b => b.unit('p0').ammo.repeater--, b => b.unit('p0').will--,
        b => addStatus(b.unit('p0'), 'wet'), b => b.store.hp[b.store.index(2, 2, 1)]--,
        b => b.rng.next(), b => b.round++, b => b.revealedRooms.add(12), b => b.formations.nextId++];
    for (const mutate of mutations) { const b = arena(), before = b.hash(); mutate(b); assert.notEqual(b.hash(), before); }
    assert.equal(arena().hash(), arena().hash());
});

test('modern warehouse maps include dim rooms as well as lit offices', () => {
    const mission = MAPS.find(m => m.name === 'Harbor Yard').build({ seed: 1 });
    assert.ok(mission.rooms.some(r => r.kind === 'warehouse' && !r.lit));
    assert.ok(mission.rooms.some(r => r.kind === 'office' && r.lit));
});

test('group movement rejects newly reassigned teammates and door closing requires AP', () => {
    const b = arena(), a = b.unit('p0'), c = b.unit('p1');
    assert.ok(b.apply({ type: 'formation', unitId: a.id, memberIds: [a.id, c.id], template: 'shield_line', facing: 'n' }).ok);
    a.owner = 'P1'; c.owner = 'P2';
    assert.equal(b.apply({ type: 'move', unitId: a.id, group: true, by: 'P1', to: { x: 10, y: 17, z: 1 } }).reason, 'not_your_unit');
    b.store.set(9, 16, 2, MAT.door_open); b.store.set(9, 16, 3, MAT.door_open); a.ap = 0;
    const door = { type: 'door', unitId: a.id, door: { x: 9, y: 16, z: 1 } };
    assert.equal(b.apply(door).reason, 'no_ap'); assert.equal(b.store.get(9, 16, 2), MAT.door_open);
    a.ap = 1; assert.ok(b.apply(door).ok); assert.equal(a.ap, 0); assert.equal(b.store.get(9, 16, 2), MAT.door);
    assert.ok(b.apply(door).ok); assert.equal(a.ap, 0); assert.equal(b.store.get(9, 16, 2), MAT.door_open);
});
