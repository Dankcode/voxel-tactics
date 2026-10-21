import { WALKERS } from './Walker.js';
// PLAN-02 rule changes: 30 HP and caliber damage, cosmetic glass, jump-down and ladders, objectives.
import test from 'node:test';
import assert from 'node:assert/strict';
import { VoxelStore } from '../voxel/VoxelStore.js';
import { MAT } from '../voxel/Materials.js';
import { coverAgainst, COVER } from '../voxel/Cover.js';
import { Battle } from './Battle.js';
import { estimateShot } from './Ballistics.js';
import { WEAPONS } from '../content/weapons.js';
import { CALIBERS } from '../content/calibers.js';
import { CLASSES, ENEMIES, UNIT_HP } from '../content/units.js';
import { finalizeMission } from '../mission/MissionCommon.js';
import { createRng } from '../util/Rng.js';
import { reachable, pathTo, nodeKey, stepKind, canJumpDown } from '../world/PathSearch.js';
import { AGENT_PROFILES } from '../world/TraversalRules.js';
import { buildMission } from '../session/Scenarios.js';
import { decide, runAiSide } from './Ai.js';

function arena({ build = () => {}, enemies = [{ type: 'cultist', pos: { x: 20, y: 2, z: 1 } }], squad = ['marksman'], player = [{ x: 10, y: 16, z: 1 }], objective = { kind: 'eliminate' } } = {}) {
    const s = new VoxelStore(24, 24, 12);
    for (let y = 0; y < 24; y++) for (let x = 0; x < 24; x++) { s.set(x, y, 0, MAT.bedrock); s.set(x, y, 1, MAT.grass); }
    build(s);
    const mission = finalizeMission({ id: 'arena', name: 'Arena', store: s, rooms: [], buildings: [], rng: createRng(1), secure: false,
        spawns: { player, enemy: enemies.map(e => ({ type: e.type, group: 0, pos: e.pos })) }, objective });
    return new Battle({ mission, squad: squad.map(type => ({ type })), seed: 3 });
}
/** A 5×3 concrete platform whose top surface is z = 4 (one storey up). */
const platform = s => { for (let y = 10; y <= 12; y++) for (let x = 8; x <= 12; x++) for (let z = 2; z <= 4; z++) s.set(x, y, z, MAT.concrete); };

test('high ground ignores low cover below the chest; full walls and upper bands still protect',()=> {
    const b=arena({enemies:[{type:'cultist',pos:{x:10,y:6,z:1}}]}),s=b.store;
    for(const x of [9,10,11])s.set(x,7,2,MAT.stucco);
    assert.equal(coverAgainst(s,10,6,1,10,16,1),COVER.HALF);
    assert.equal(coverAgainst(s,10,6,1,10,16,4),COVER.NONE);
    for(const x of [9,10,11])s.set(x,7,3,MAT.stucco);
    assert.equal(coverAgainst(s,10,6,1,10,16,4),COVER.FULL);
    for(const x of [9,10,11])s.set(x,7,2,MAT.air);
    assert.equal(coverAgainst(s,10,6,1,10,16,4),COVER.HALF,'an upper band still hides the head/shoulders');
    assert.equal(coverAgainst(s,10,6,1,10,8,10),COVER.NONE,'a steep shot passes over the actual wall footprint');
});

test('elevated shot preview shares the height-aware cover readout and still traces physical cover',()=> {
    const low=arena({player:[{x:10,y:16,z:4}],enemies:[{type:'cultist',pos:{x:10,y:6,z:1}}],build:s=> {
        for(let z=2;z<=4;z++)s.set(10,16,z,MAT.concrete);
        for(const x of [9,10,11])s.set(x,7,2,MAT.stucco);
    }});
    const target=low.units.find(u=>u.side==='enemy');
    const shot={type:'shoot',unitId:'p0',aim:{unitId:target.id,part:'torso'}};
    const pv=low.preview(shot);assert.ok(pv.ok,pv.reason);assert.equal(pv.cover,COVER.NONE);assert.ok(pv.flanked);assert.equal(pv.estimate.cover,0);
    assert.ok(pv.mods.some(([kind])=>kind==='height'));
    for(const x of [9,10,11])low.store.set(x,7,3,MAT.stucco);
    const est=estimateShot(low,low.unit('p0'),shot.aim,{weapon:{...WEAPONS.longrifle,energy:0},spread:0,samples:16});
    assert.equal(coverAgainst(low.store,10,6,1,10,16,4),COVER.FULL);assert.equal(est.cover,1,'the solid upper wall still stops the downward shot');
});

test('autopilot spends a full movement turn on an affordable tall ladder instead of stalling',()=> {
    const b=arena({squad:['grenadier'],enemies:[],player:[{x:10,y:14,z:1}],objective:{kind:'recover',item:{x:10,y:13,z:8}},build:s=> {
        for(let z=2;z<=8;z++){s.set(10,13,z,MAT.concrete);s.set(10,14,z,MAT.ladder);}
    }});
    const u=b.unit('p0');u.mobility*=2.5/b.mobility(u); // Isolate the ladder's four-AP traversal; weight is covered separately.
    const intent=decide(b,u);
    assert.equal(intent?.type,'move');assert.deepEqual(intent.to,{x:10,y:13,z:8});
    const preview=b.preview(intent);assert.ok(preview.ok,preview.reason);assert.equal(preview.ap,4);
    assert.ok(b.apply(intent).ok);assert.equal(u.ap,0);assert.equal(u.z,8);assert.equal(u.hp,30);
    b.apply({type:'endTurn',side:'player'});b.apply({type:'endTurn',side:'enemy'});
    runAiSide(b,'player');assert.equal(b.outcome?.reason,'recovered');
});

test('every human character has 30 HP and every gun takes its damage from its caliber', () => {
    for (const def of [...Object.values(CLASSES), ...Object.values(ENEMIES).filter(def=>!WALKERS[def.id]&&!def.drone)]) assert.equal(def.hp, UNIT_HP, def.id);   // PLAN-14: drones are one-hit
    assert.equal(UNIT_HP, 30);
    for (const w of Object.values(WEAPONS).filter(w => w.caliber)) {
        const c = CALIBERS[w.caliber];
        assert.ok(c, `${w.id} caliber ${w.caliber}`);
        assert.equal(w.damage, c.damage, w.id); assert.equal(w.pierce, c.pierce, w.id); assert.equal(w.voxel, c.voxel, w.id);
    }
    // Heavier rounds hit harder and pierce more.
    assert.equal(CALIBERS['338'].damage,30);
    for(const id of ['7.62','5.56','9mm'])assert.equal(CALIBERS[id].damage,10,'AR-family damage is shared; gun builds determine accuracy');
    assert.ok(CALIBERS['338'].pierce > CALIBERS['5.56'].pierce);
    // A close high-caliber round is lethal through light armour.
    const b = arena(), e = b.units.find(u => u.side === 'enemy');
    b.dealDamage(e, 'torso', WEAPONS.longrifle.damage, { pierce: WEAPONS.longrifle.pierce });
    assert.equal(e.hp, 0);
});

test('glass is cosmetic: no cover, never stops a shot, but the pane still breaks', () => {
    const pane = s => { for (const x of [9, 10, 11]) for (const z of [2, 3]) s.set(x, 14, z, MAT.glass); };
    const open = arena({ enemies: [{ type: 'cultist', pos: { x: 10, y: 13, z: 1 } }] });
    const glazed = arena({ build: pane, enemies: [{ type: 'cultist', pos: { x: 10, y: 13, z: 1 } }] });
    assert.equal(coverAgainst(glazed.store, 10, 13, 1, 10, 16), COVER.NONE);
    const est = b => estimateShot(b, b.unit('p0'), { unitId: b.units.find(u => u.side === 'enemy').id, part: 'torso' }, { weapon: WEAPONS.longrifle, spread: 1.5, samples: 64 });
    assert.equal(est(glazed).cover, 0);
    assert.equal(est(glazed).hit, est(open).hit);
    const r = glazed.apply({ type: 'shoot', unitId: 'p0', aim: { unitId: glazed.units.find(u => u.side === 'enemy').id, part: 'torso' } });
    assert.ok(r.ok);
    assert.ok([9, 10, 11].some(x => [2, 3].some(z => glazed.store.get(x, 14, z) === MAT.air)), 'a crossed pane shatters');
});

test('jump down one storey: reachable, costs about an AP, no fall damage, lands staggered', () => {
    const b = arena({ build: platform, player: [{ x: 10, y: 11, z: 4 }] });
    const u = b.unit('p0');
    const to = { x: 10, y: 13, z: 1 };
    const pv = b.preview({ type: 'move', unitId: 'p0', to });
    assert.ok(pv.ok, pv.reason);
    const r = b.apply({ type: 'move', unitId: 'p0', to });
    assert.ok(r.ok);
    assert.deepEqual([u.x, u.y, u.z], [10, 13, 1]);
    assert.equal(u.hp, WALKERS[u.type]? (u.type==='wall_strider'?60:90):30);
    assert.ok(u.statuses.some(s => s.id === 'staggered'));
    assert.ok(r.events.find(e => e.t === 'move').kinds.includes('jump'));
    // Jumping is one way: without stairs or a ladder the platform cannot be reached from the ground.
    assert.ok(!reachable(b.store, to, Infinity, AGENT_PROFILES.player).costs.has(nodeKey({ x: 10, y: 11, z: 4 })));
});

test('a railing on the ledge blocks the jump; drops beyond one storey are not jumps', () => {
    const railed = arena({ build: s => { platform(s); for (let x = 7; x <= 13; x++) s.set(x, 13, 5, MAT.chainlink); }, player: [{ x: 10, y: 11, z: 4 }] });
    assert.ok(canJumpDown(arena({ build: platform }).store, { x: 10, y: 12, z: 4 }, 0, 1), 'open edge');
    assert.equal(canJumpDown(railed.store, { x: 10, y: 12, z: 4 }, 0, 1), null, 'railed edge');
    const tall = arena({ build: s => { for (let y = 10; y <= 12; y++) for (let x = 8; x <= 12; x++) for (let z = 2; z <= 7; z++) s.set(x, y, z, MAT.concrete); }, player: [{ x: 10, y: 11, z: 7 }] });
    assert.ok(!reachable(tall.store, { x: 10, y: 11, z: 7 }, Infinity, AGENT_PROFILES.player).costs.has(nodeKey({ x: 10, y: 13, z: 1 })));
});

test('ladders climb up to the ledge and back down', () => {
    const b = arena({ build: s => { platform(s); for (let z = 2; z <= 4; z++) s.set(10, 13, z, MAT.ladder); }, player: [{ x: 10, y: 14, z: 1 }] });
    const top = { x: 10, y: 12, z: 4 };
    const search = reachable(b.store, { x: 10, y: 14, z: 1 }, Infinity, AGENT_PROFILES.player);
    assert.ok(search.costs.has(nodeKey(top)));
    const path = pathTo(search, top);
    assert.equal(stepKind(b.store, path.at(-2), path.at(-1)), 'climb');
    const r = b.apply({ type: 'move', unitId: 'p0', to: top });
    assert.ok(r.ok, r.reason);
    assert.equal(b.unit('p0').z, 4);
    assert.ok(!b.unit('p0').statuses.some(s => s.id === 'staggered'), 'climbing does not stagger');
    const down = reachable(b.store, top, Infinity, AGENT_PROFILES.player, { jump: false });
    assert.ok(down.costs.has(nodeKey({ x: 10, y: 13, z: 1 })), 'climb down');
    // The ladder is not cover and not a place to stand.
    assert.equal(coverAgainst(b.store, 10, 14, 1, 10, 2), COVER.NONE);
    assert.ok(!b.store.surfaces(10, 13).some(s => s.z >= 2));
});

test('extract: units leave from the zone; the mission is won when the squad is out', () => {
    const b = arena({ squad: ['marksman', 'grenadier'], player: [{ x: 10, y: 16, z: 1 }, { x: 12, y: 16, z: 1 }],
        objective: { kind: 'extract', zone: { x0: 9, y0: 18, x1: 13, y1: 20 }, needed: 2 } });
    assert.equal(b.apply({ type: 'extract', unitId: 'p0' }).reason, 'not_in_zone');
    assert.ok(b.apply({ type: 'move', unitId: 'p0', to: { x: 10, y: 19, z: 1 } }).ok);
    assert.ok(b.apply({ type: 'extract', unitId: 'p0' }).ok);
    assert.ok(b.unit('p0').extracted && !b.outcome);
    assert.ok(b.apply({ type: 'move', unitId: 'p1', to: { x: 12, y: 19, z: 1 } }).ok);
    assert.ok(b.apply({ type: 'extract', unitId: 'p1' }).ok);
    assert.deepEqual([b.outcome?.winner, b.outcome?.reason], ['player', 'extracted']);
});

test('recover: pick up the item, a carrier who dies drops it, extracting with it wins', () => {
    const b = arena({ squad: ['marksman', 'grenadier'], player: [{ x: 10, y: 16, z: 1 }, { x: 12, y: 16, z: 1 }],
        objective: { kind: 'recover', item: { x: 10, y: 12, label: 'Cash bag' }, zone: { x0: 9, y0: 18, x1: 13, y1: 20 } } });
    b.kill(b.unit('e0'), 'test');
    assert.equal(b.outcome, null, 'with every hostile down the item still has to come out');
    assert.equal(b.apply({ type: 'recover', unitId: 'p0' }).reason, 'not_adjacent');
    assert.ok(b.apply({ type: 'move', unitId: 'p0', to: { x: 10, y: 13, z: 1 } }).ok);
    assert.ok(b.apply({ type: 'recover', unitId: 'p0' }).ok);
    assert.equal(b.objective.item.carrier, 'p0');
    b.kill(b.unit('p0'), 'test');
    assert.equal(b.objective.item.carrier, null);
    assert.deepEqual([b.objective.item.x, b.objective.item.y], [10, 13]);
    assert.ok(b.apply({ type: 'move', unitId: 'p1', to: { x: 11, y: 14, z: 1 } }).ok);
    assert.ok(b.apply({ type: 'recover', unitId: 'p1' }).ok);
    b.apply({ type: 'endTurn', side: 'player' }); b.apply({ type: 'endTurn', side: 'enemy' });
    assert.ok(b.apply({ type: 'move', unitId: 'p1', to: { x: 11, y: 18, z: 1 } }).ok);
    assert.ok(b.apply({ type: 'extract', unitId: 'p1' }).ok);
    assert.deepEqual([b.outcome?.winner, b.outcome?.reason], ['player', 'recovered']);
});

test('hold: rounds only count with the squad in the zone and no hostile in it', () => {
    const b = arena({ enemies: [{ type: 'cultist', pos: { x: 2, y: 2, z: 1 } }], objective: { kind: 'hold', zone: { x0: 9, y0: 15, x1: 11, y1: 17 }, rounds: 2 } });
    b.unit('e0').alerted = false;
    const pass = () => { b.apply({ type: 'endTurn', side: 'player' }); b.apply({ type: 'endTurn', side: 'enemy' }); };
    pass(); assert.equal(b.objective.held, 1);
    b.unit('e0').x = 10; b.unit('e0').y = 15;                // a hostile walks in: contested
    pass(); assert.equal(b.objective.held, 1);
    b.unit('e0').x = 2; b.unit('e0').y = 2;
    pass();
    assert.deepEqual([b.outcome?.winner, b.outcome?.reason], ['player', 'held']);
});

test('the objective maps resolve their objectives', () => {
    for (const [id, kind] of [['route-9', 'recover'], ['main-street', 'hold'], ['harbor-yard', 'extract']]) {
        const m = buildMission({ scenario: id, seed: 1 });
        assert.equal(m.objective.kind, kind, id);
        if (kind === 'recover') assert.ok(Number.isInteger(m.objective.item.x) && m.objective.zone, id);
        else assert.ok(m.objective.zone, id);
    }
});

test('a ladder column is climbed down, not jumped', () => {
    const b = arena({ build: s => { platform(s); for (let z = 2; z <= 4; z++) s.set(10, 13, z, MAT.ladder); }, player: [{ x: 10, y: 12, z: 4 }] });
    assert.equal(canJumpDown(b.store, { x: 10, y: 12, z: 4 }, 0, 1), null);
    const r = b.apply({ type: 'move', unitId: 'p0', to: { x: 10, y: 13, z: 1 } });
    assert.ok(r.ok, r.reason);
    assert.equal(r.events.find(e => e.t === 'move').kinds.at(-1), 'climb');
    assert.ok(!b.unit('p0').statuses.some(s => s.id === 'staggered'));
});
