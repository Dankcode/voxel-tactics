// Free formation slot swaps and switches, narrow-space blocking, enemy formations, and the reworked killstreak
// strikes (wide airstrike corridor, long laser, one-level ground craters).
import test from 'node:test';
import assert from 'node:assert/strict';
import { Battle } from './Battle.js';
import { VoxelStore } from '../voxel/VoxelStore.js';
import { MAT, AIR } from '../voxel/Materials.js';
import { formationIntents } from './Ai.js';
import { footprint, executeStrike, STRIKES } from './Strikes.js';

function arena({ size = 40, squad = ['grenadier', 'marksman', 'vanguard', 'warden'], players, enemies = [{ type: 'cultist', pos: { x: 30, y: 30, z: 2 }, group: 1 }], build = null, intel = false } = {}) {
    const store = new VoxelStore(size, size, 16);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) { store.set(x, y, 0, MAT.bedrock); store.set(x, y, 1, MAT.concrete); store.set(x, y, 2, MAT.concrete); }
    build?.(store);
    players ||= [{ x: 10, y: 10, z: 2 }, { x: 11, y: 10, z: 2 }, { x: 9, y: 10, z: 2 }, { x: 10, y: 13, z: 2 }];
    return new Battle({ mission: { id: 'fs-arena', store, rooms: [], buildings: [], spawns: { player: players, enemy: enemies } },
        squad: squad.map(type => ({ type })), seed: 5, intel });
}
const shieldLine = b => {
    const r = b.apply({ type: 'formation', template: 'shield_line', unitId: 'p0', leaderId: 'p0', memberIds: ['p0', 'p1', 'p2'], facing: 'n' });
    assert.ok(r.ok, r.reason);
    return b.formations.of(b.unit('p0'));
};

test('formation members trade places for free by clicking a spot (swap), including the anchor', () => {
    const b = arena(), f = shieldLine(b), p1 = b.unit('p1'), p2 = b.unit('p2'), p0 = b.unit('p0');
    const ap = [p0.ap, p1.ap, p2.ap];
    assert.ok(b.apply({ type: 'formation_swap', unitId: 'p1', slot: 2 }).ok);
    assert.deepEqual([p1.x, p2.x], [9, 11], 'p1 and p2 swapped tiles');
    assert.deepEqual([p0.ap, p1.ap, p2.ap], ap, 'no AP spent');
    assert.ok(b.apply({ type: 'formation_swap', unitId: 'p2', slot: 0 }).ok);
    assert.equal(f.leaderId, 'p2', 'taking slot 0 makes you the anchor'); assert.deepEqual([p2.x, p0.x], [10, 11]);
    assert.ok(b.apply({ type: 'formation_swap', unitId: 'p1', slot: 3 }).ok, 'an empty spot');
    assert.deepEqual([p1.x, p1.y], [12, 10]);
    assert.equal(b.apply({ type: 'formation_swap', unitId: 'p2', slot: 2 }).reason, 'formation_invalid', 'the anchor cannot step off slot 0 into a free spot');
    assert.equal(b.apply({ type: 'formation_swap', unitId: 'p3', slot: 1 }).reason, 'formation_invalid', 'not a member');
});

test('a wide formation cannot squeeze into a corridor; switching to a file (free) lets the group move', () => {
    // A one-tile-wide corridor running north from (10,7).
    const b = arena({ build: st => { for (let y = 0; y <= 7; y++) for (let z = 3; z <= 6; z++) { st.set(9, y, z, MAT.brick); st.set(11, y, z, MAT.brick); } } });
    shieldLine(b);
    const r = b.apply({ type: 'move', unitId: 'p0', to: { x: 10, y: 6, z: 2 }, group: true });
    assert.equal(r.reason, 'formation_blocked');
    assert.ok(b.apply({ type: 'formation_switch', unitId: 'p0', template: 'file', facing: 'n' }).ok);
    const f = b.formations.of(b.unit('p0'));
    assert.equal(f.template, 'file'); assert.equal(b.unit('p0').ap, 4);
    assert.ok(!b.formations.blockedAt(f, { x: 10, y: 6, z: 2 }), 'a file fits the corridor');
});

test('single-tile enemy pods with a lead on the squad advance in a wedge; walkers never join', () => {
    const b = arena({ players: [{ x: 3, y: 3, z: 2 }, { x: 4, y: 3, z: 2 }, { x: 5, y: 3, z: 2 }, { x: 6, y: 3, z: 2 }],
        build: st => { for (let x = 0; x < 40; x++) for (let z = 3; z <= 9; z++) st.set(x, 12, z, MAT.brick); },
        enemies: [{ type: 'cultist', pos: { x: 20, y: 24, z: 2 }, group: 1, alerted: true }, { type: 'cultist', pos: { x: 22, y: 24, z: 2 }, group: 1, alerted: true },
            { type: 'archer', pos: { x: 21, y: 26, z: 2 }, group: 1, alerted: true }, { type: 'wall_strider', pos: { x: 30, y: 30, z: 2 }, group: 1, alerted: true }] });
    b.apply({ type: 'endTurn', side: 'player' });
    b.enemyIntel.p0 = { x: 3, y: 3, z: 2, round: b.round, source: 'heard' };
    const intents = formationIntents(b, 'enemy');
    const wedge = intents.find(i => i.type === 'formation' && i.template === 'wedge');
    assert.ok(wedge, JSON.stringify(intents));
    assert.ok(!wedge.memberIds.some(id => b.unit(id).type === 'wall_strider'));
    assert.ok(b.apply(wedge).ok);
    assert.equal(wedge.facing, 'n');
});

// ---------------------------------------------------------------------------------------------- strikes
test('PLAN-12: the airstrike highlights one 15 x 9 rectangle along the caster\'s facing; the laser keeps its long band', () => {
    const b = arena(), u = b.unit('p0'), to = { x: 20, y: 11, z: 2 };
    const air = footprint(b, 'carpet_bomb', to, u), laser = footprint(b, 'orbital_laser', to, u);
    const s = STRIKES.carpet_bomb, l = STRIKES.orbital_laser;
    assert.equal(air.length, (2 * s.halfLength + 1) * (2 * s.halfWidth + 1));
    assert.equal(laser.length, (2 * l.halfLength + 1) * (2 * l.halfWidth + 1));
    const span = cs => [new Set(cs.map(c => c.x)).size, new Set(cs.map(c => c.y)).size];
    assert.deepEqual(span(air), [2 * s.halfLength + 1, 2 * s.halfWidth + 1], 'long side east-west for a caster to the west');
    assert.deepEqual(span(footprint(b, 'carpet_bomb', { x: 10, y: 25, z: 2 }, u)), [2 * s.halfWidth + 1, 2 * s.halfLength + 1], 'north-south for a caster to the north');
    assert.ok(air.every(c => c.z === 2), 'cells sit on the top surface');
});

test('PLAN-12: three bombs fall together inside the rectangle, apart, deterministic per seed; damage stays inside', () => {
    const run = () => {
        const b = arena({ intel: true }), u = b.unit('p0'), to = { x: 22, y: 12, z: 2 };
        const cells = new Set(footprint(b, 'carpet_bomb', to, u).map(c => `${c.x},${c.y}`));
        const before = b.log.length;
        executeStrike(b, u, 'carpet_bomb', to);
        return { b, cells, blasts: b.log.slice(before).filter(e => e.t === 'explosion') };
    };
    const { b, cells, blasts } = run(), s = STRIKES.carpet_bomb;
    assert.equal(blasts.length, 3);
    assert.ok(blasts.every(e => e.of === 3), 'one salvo');
    const drop = b.log.find(e => e.t === 'strike');
    assert.equal(drop?.bombs.length, 3, 'the bombs are announced for the falling animation');
    for (const e of blasts) for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++)
        if (dx * dx + dy * dy <= s.bombRadius ** 2) assert.ok(cells.has(`${Math.floor(e.x) + dx},${Math.floor(e.y) + dy}`), 'every blast stays inside the highlight');
    for (let i = 0; i < 3; i++) for (let j = i + 1; j < 3; j++) assert.ok(Math.hypot(blasts[i].x - blasts[j].x, blasts[i].y - blasts[j].y) >= s.minSeparation);
    assert.deepEqual(run().blasts.map(e => [e.x, e.y]), blasts.map(e => [e.x, e.y]), 'same seed, same bombs');
    let craters = 0;
    for (let y = 0; y < 40; y++) for (let x = 0; x < 40; x++) {
        assert.notEqual(b.store.get(x, y, 1), AIR, `never deeper than one level (${x},${y})`);
        if (b.store.get(x, y, 2) === AIR) { craters++; assert.ok(cells.has(`${x},${y}`), 'damage stays in the square'); }
    }
    assert.ok(craters > 20, `craters ${craters}`);
});

test('PLAN-10: the highlight drapes onto the floor in view under the storey cut', async () => {
    const { drapeFootprint } = await import('./Strikes.js');
    const b = arena({ build: st => { for (let x = 18; x <= 22; x++) for (let y = 8; y <= 12; y++) { st.set(x, y, 5, MAT.concrete); st.set(x, y, 8, MAT.concrete); } } });
    const cells = footprint(b, 'carpet_bomb', { x: 20, y: 10, z: 2 }, b.unit('p0'));
    const roof = cells.find(c => c.x === 20 && c.y === 10);
    assert.equal(roof.z, 8, 'the full view shows the roof');
    assert.equal(drapeFootprint(b.store, cells, 7).find(c => c.x === 20 && c.y === 10).z, 5, 'cut under the roof: the upper floor');
    assert.equal(drapeFootprint(b.store, cells, 4).find(c => c.x === 20 && c.y === 10).z, 2, 'cut under the floor: the ground');
});

test('strikes take at most two storeys off a building and the laser cuts its whole line', () => {
    const tower = st => { for (let x = 18; x <= 26; x++) for (let y = 8; y <= 12; y++) for (let z = 3; z <= 14; z++) st.set(x, y, z, MAT.brick); };
    const b = arena({ build: tower }), u = b.unit('p0');
    executeStrike(b, u, 'carpet_bomb', { x: 22, y: 10, z: 14 });
    let lowest = Infinity;
    for (let x = 18; x <= 26; x++) for (let y = 8; y <= 12; y++) for (let z = 3; z <= 14; z++) if (b.store.get(x, y, z) === AIR) lowest = Math.min(lowest, z);
    assert.ok(lowest >= 14 - 6 + 1, `two storeys at most (lowest hole z=${lowest})`);
    const c = arena({ build: tower }), v = c.unit('p0');
    executeStrike(c, v, 'orbital_laser', { x: 22, y: 10, z: 2 });
    for (let x = 18; x <= 26; x++) for (let z = 3; z <= 14; z++) assert.equal(c.store.get(x, 10, z), AIR, 'the band is cut to the ground floor');
    assert.notEqual(c.store.get(22, 10, 1), AIR);
});

test('PLAN-12: the classic killstreak is the same three-bomb airstrike over a rectangle, with no soldier cut-in', () => {
    const b = arena(), u = b.unit('p0'), to = { x: 20, y: 20, z: 2 };
    const s = STRIKES.killstreak_strike;
    assert.equal(footprint(b, 'killstreak_strike', to, u).length, (2 * s.halfLength + 1) * (2 * s.halfWidth + 1));
    const before = b.log.length;
    const r = b.apply({ type: 'ability', unitId: 'p0', abilityId: 'killstreak_strike', to });
    assert.ok(r.ok, r.reason);
    const ev = b.log.slice(before);
    assert.equal(ev.filter(e => e.t === 'explosion').length, 3);
    assert.ok(!ev.some(e => e.t === 'cutin'), 'strikes come from the sky');
    for (let y = 10; y <= 30; y++) for (let x = 10; x <= 30; x++) assert.notEqual(b.store.get(x, y, 1), AIR);
});
