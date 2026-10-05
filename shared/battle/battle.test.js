import test from 'node:test';
import assert from 'node:assert/strict';
import { VoxelStore } from '../voxel/VoxelStore.js';
import { MAT, AIR } from '../voxel/Materials.js';
import { Battle } from './Battle.js';
import { runAiSide } from './Ai.js';
import { estimateShot } from './Ballistics.js';
import { WEAPONS } from '../content/weapons.js';
import { buildProvingGrounds } from '../mission/ProvingGrounds.js';
import { finalizeMission } from '../mission/MissionCommon.js';
import { createRng } from '../util/Rng.js';

/** Flat arena with optional walls; enemies are placed alerted so they act. */
function arena({ walls = [], enemies = [{ type: 'cultist', pos: { x: 10, y: 4, z: 1 } }], squad = ['marksman'], player = [{ x: 10, y: 16, z: 1 }] } = {}) {
    const s = new VoxelStore(24, 24, 10);
    for (let y = 0; y < 24; y++) for (let x = 0; x < 24; x++) { s.set(x, y, 0, MAT.bedrock); s.set(x, y, 1, MAT.grass); }
    for (const [x, y, z, k] of walls) s.set(x, y, z, MAT[k]);
    const mission = finalizeMission({ id: 'arena', name: 'Arena', store: s, rooms: [], buildings: [], rng: createRng(1),
        spawns: { player, enemy: enemies.map(e => ({ type: e.type, group: 0, pos: e.pos })) }, objective: { kind: 'eliminate' } });
    const b = new Battle({ mission, squad: squad.map(type => ({ type })), seed: 9 });
    return b;
}

test('moving spends AP by path cost / mobility and is rejected beyond the budget', () => {
    const b = arena();
    const u = b.unit('p0');
    const r = b.apply({ type: 'move', unitId: 'p0', to: { x: 10, y: 13, z: 1 } });
    assert.ok(r.ok);
    assert.equal(u.ap, 3);
    assert.equal(b.apply({ type: 'move', unitId: 'p0', to: { x: 10, y: 1, z: 1 } }).reason, 'no_ap');
});

test('a wall between shooter and target turns hits into cover hits (physical cover)', () => {
    const open = arena();
    const shooter = open.unit('p0'), target = open.units.find(u => u.side === 'enemy');
    const w = WEAPONS.longrifle;
    const est = estimateShot(open, shooter, { unitId: target.id, part: 'torso' }, { weapon: w, spread: 2, samples: 128 });
    const walled = arena({ walls: [[10, 6, 2, 'stone'], [10, 6, 3, 'stone'], [9, 6, 2, 'stone'], [9, 6, 3, 'stone'], [11, 6, 2, 'stone'], [11, 6, 3, 'stone']] });
    const est2 = estimateShot(walled, walled.unit('p0'), { unitId: walled.units.find(u => u.side === 'enemy').id, part: 'torso' }, { weapon: w, spread: 2, samples: 128 });
    assert.ok(est.hit > 0.3, `open hit ${est.hit}`);
    assert.ok(est2.hit < est.hit * 0.4, `walled ${est2.hit} vs ${est.hit}`);
    assert.ok(est2.cover > 0.5);
});

test('half cover protects the legs but not the head', () => {
    const b = arena({ walls: [[10, 5, 2, 'sandbag'], [9, 5, 2, 'sandbag'], [11, 5, 2, 'sandbag']] });
    const t = b.units.find(u => u.side === 'enemy');
    const legs = estimateShot(b, b.unit('p0'), { unitId: t.id, part: 'legs' }, { weapon: WEAPONS.longrifle, spread: 0.5, samples: 96 });
    const head = estimateShot(b, b.unit('p0'), { unitId: t.id, part: 'head' }, { weapon: WEAPONS.longrifle, spread: 0.5, samples: 96 });
    assert.ok(head.parts.head > 0.5, `head ${head.parts.head}`);
    assert.ok(legs.parts.legs < 0.2, `legs ${legs.parts.legs}`);
});

test('shots resolve deterministically: same seed and intents give the same hash', () => {
    const run = () => {
        const b = arena({ squad: ['grenadier'] });
        const t = b.units.find(u => u.side === 'enemy');
        b.apply({ type: 'shoot', unitId: 'p0', aim: { unitId: t.id, part: 'torso' } });
        return b.hash();
    };
    assert.equal(run(), run());
});

test('disabling an arm reduces accuracy; killing removes the unit and ends the battle', () => {
    const b = arena();
    const t = b.units.find(u => u.side === 'enemy');
    b.dealDamage(t, 'armR', 99, { pierce: 99 });
    assert.ok(t.parts.armR.disabled);
    assert.ok(b.log.some(e => e.t === 'disabled'));
    b.dealDamage(t, 'torso', 99, { pierce: 99 });
    assert.ok(t.dead);
    assert.equal(b.outcome?.winner, 'player');
});

test('overwatch fires at a unit that moves through the cone', () => {
    const b = arena({ squad: ['marksman'], enemies: [{ type: 'cultist', pos: { x: 10, y: 6, z: 1 } }] });
    b.unit('p0').weapon = 'handcannon';
    assert.ok(b.apply({ type: 'overwatch', unitId: 'p0', weaponId: 'handcannon', toward: { x: 10, y: 6 } }).ok);
    b.apply({ type: 'endTurn', side: 'player' });
    const e = b.units.find(u => u.side === 'enemy');
    e.alerted = true;
    const r = b.apply({ type: 'move', unitId: e.id, to: { x: 10, y: 9, z: 1 } });
    assert.ok(r.ok);
    assert.ok(b.log.some(x => x.t === 'reaction'), 'reaction shot');
});

test('a powder bomb destroys timber cover and damages units in the blast', () => {
    const b = arena({ squad: ['grenadier'], walls: [[10, 9, 2, 'timber'], [11, 9, 2, 'timber']], enemies: [{ type: 'cultist', pos: { x: 10, y: 8, z: 1 } }] });
    const e = b.units.find(u => u.side === 'enemy');
    const hp = e.hp;
    const r = b.apply({ type: 'throw', unitId: 'p0', itemId: 'powder_bomb', to: { x: 10, y: 9, z: 1 } });
    assert.ok(r.ok, r.reason);
    assert.ok(b.stats.voxelsDestroyed > 0);
    assert.ok(e.hp < hp || e.dead);
});

test('fire flask sets units burning; burning ticks at the start of their turn', () => {
    const b = arena({ squad: ['vanguard'], enemies: [{ type: 'brute', pos: { x: 10, y: 10, z: 1 } }] });
    const e = b.units.find(u => u.side === 'enemy');
    b.apply({ type: 'throw', unitId: 'p0', itemId: 'fire_flask', to: { x: 10, y: 10, z: 1 } });
    assert.ok(e.statuses.some(s => s.id === 'burning'));
    const hp = e.hp;
    b.apply({ type: 'endTurn', side: 'player' });
    assert.ok(e.hp < hp);
});

test('Proving Grounds: breach a bunker room — door opens, room revealed, defenders surprised', () => {
    const mission = buildProvingGrounds({ seed: 1 });
    const b = new Battle({ mission, squad: [{ type: 'vanguard' }, { type: 'warden' }], seed: 2 });
    const bunker = mission.buildings.find(x => x.id === 'bunker');
    const door = bunker.doors.find(d => d.exterior && d.side === 's');
    const outside = { x: door.x, y: door.y + 1, z: door.z };
    const a = b.unit('p0'), c = b.unit('p1');
    Object.assign(a, outside); Object.assign(c, { x: door.x - 1, y: door.y + 1, z: door.z });
    const points = b.breachPoints(a);
    assert.ok(points.length >= 1, 'breach point');
    const r = b.apply({ type: 'breach', unitId: 'p0', unitIds: ['p0', 'p1'], door: points[0], entry: 'door' });
    assert.ok(r.ok, r.reason);
    assert.ok(b.revealedRooms.has(points[0].roomId));
    assert.ok(b.log.some(e => e.t === 'cutin' && e.kind === 'breach'));
});

test('formations: shield line costs mobility, grants front-arc defense, and clustered units take bonus blast damage', () => {
    const b = arena({ squad: ['warden', 'warden', 'vanguard'], player: [{ x: 9, y: 16, z: 1 }, { x: 10, y: 16, z: 1 }, { x: 11, y: 16, z: 1 }] });
    const r = b.apply({ type: 'formation', template: 'shield_line', unitId: 'p1', leaderId: 'p1', memberIds: ['p1', 'p0', 'p2'], facing: 'n' });
    assert.ok(r.ok, r.reason);
    const u = b.unit('p1'), e = b.units.find(x => x.side === 'enemy');
    assert.ok(b.formations.mobilityPenalty(u) < 0);
    assert.ok(b.formations.defenseSpreadMult(u, e) > 1, 'front arc bonus');
    assert.ok(b.formations.isClustered(u));
});

test('AI plays a full Proving Grounds battle to completion or the round cap without errors', () => {
    const mission = buildProvingGrounds({ seed: 1 });
    const b = new Battle({ mission, squad: ['vanguard', 'grenadier', 'marksman', 'warden'].map(type => ({ type })), seed: 5, controllers: { player: 'ai', enemy: 'ai' } });
    for (let i = 0; i < 25 && !b.outcome; i++) { runAiSide(b, 'player', { formations: true }); if (!b.outcome) runAiSide(b, 'enemy'); }
    assert.ok(b.log.some(e => e.t === 'shot'));
    assert.ok(b.round > 1);
});
