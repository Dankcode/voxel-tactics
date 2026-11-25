// Physical recoil & trajectory ballistics regression tests (no XCOM hit-chance formula).
import test from 'node:test';
import assert from 'node:assert/strict';
import { Battle } from './Battle.js';
import { VoxelStore } from '../voxel/VoxelStore.js';
import { MAT } from '../voxel/Materials.js';
import { WEAPONS } from '../content/weapons.js';
import { CALIBERS } from '../content/calibers.js';
import { createRng } from '../util/Rng.js';
import {
    ballisticDropAt, ballisticProfile, sampleSalvoRay, traceProjectile,
    partCentre, evaluateBallisticShot
} from './Ballistics.js';
import { bestEnemyShot } from './EnemyAi.js';
import { enemyThreats } from './EnemyAi.js';

function arena({
    w = 48, d = 32, h = 14, squad = ['grenadier', 'marksman'],
    players = [{ x: 6, y: 16, z: 1 }, { x: 7, y: 16, z: 1 }],
    enemies = [{ type: 'cultist', pos: { x: 22, y: 16, z: 1 }, group: 1, alerted: true }],
    build = null, seed = 5
} = {}) {
    const store = new VoxelStore(w, d, h);
    for (let y = 0; y < d; y++) for (let x = 0; x < w; x++) { store.set(x, y, 0, MAT.bedrock); store.set(x, y, 1, MAT.grass); }
    build?.(store);
    return new Battle({
        mission: { id: 'recoil-arena', store, rooms: [], buildings: [], spawns: { player: players, enemy: enemies } },
        squad: squad.map(type => ({ type })),
        seed
    });
}

test('salvo recoil climbs vertically, drifts laterally, blooms spread, and recoilHeat resets on next turn', () => {
    const dir = [1, 0, 0];
    const w = WEAPONS.repeater;
    const rng = createRng(19);
    const r0 = sampleSalvoRay(dir, 1.5, w, 0, rng, { heat: 0, stability: 1 });
    const r3 = sampleSalvoRay(dir, 1.5, w, 3, rng, { heat: 0, stability: 1 });
    assert.equal(r0.climbDeg, 0, 'first round in salvo has zero accumulated climb');
    assert.equal(r0.driftDeg, 0, 'first round in salvo has zero lateral drift');
    assert.ok(r3.climbDeg > r0.climbDeg, `later round climbs vertically (${r3.climbDeg} > 0)`);
    assert.ok(r3.roundSpread > r0.roundSpread, `later round blooms spread (${r3.roundSpread} > ${r0.roundSpread})`);
    assert.ok(r3.recoilDir[2] > r0.recoilDir[2], 'vertical climb points upward in world z');

    const b = arena();
    const u = b.unit('p0'), foe = b.unit('e0');
    assert.equal(u.recoilHeat, 0);
    const aim = { unitId: foe.id, part: 'torso' };
    const r1 = b.apply({ type: 'shoot', unitId: u.id, weaponId: 'repeater', fireMode: 'burst', aim });
    assert.ok(r1.ok, r1.reason);
    const s1 = r1.events.find(e => e.t === 'shot');
    assert.ok(u.recoilHeat > 0, `firing accumulates recoilHeat (got ${u.recoilHeat})`);
    assert.ok(s1.recoilClimb >= 0 && s1.heat === u.recoilHeat && s1.fireMode === 'burst');
    assert.equal(s1.chance, undefined, 'shot event must not carry XCOM hit chance');
    assert.equal(s1.rolls, undefined, 'shot event must not carry XCOM RNG rolls');

    const profBefore = ballisticProfile(u, w, partCentre(foe, 'torso'), { spread: 1.5, rounds: 3 });
    assert.ok(profBefore.finalSpread > 1.5 && profBefore.totalClimbDeg > 0);

    b.apply({ type: 'endTurn', side: 'player' });
    b.apply({ type: 'endTurn', side: 'enemy' });
    assert.equal(u.recoilHeat, 0, 'recoilHeat resets cleanly at start of player turn');
});

test('ballistic trajectory drops past zeroRange in proportion to caliber velocity', () => {
    assert.equal(ballisticDropAt(10, CALIBERS['9mm'].velocity, 12), 0, 'flat inside zeroRange');
    assert.equal(ballisticDropAt(12, CALIBERS['9mm'].velocity, 12), 0, 'flat right at zeroRange');

    const dropSubgun = ballisticDropAt(26, CALIBERS['9mm'].velocity, 12);
    const dropRifle = ballisticDropAt(26, CALIBERS['338'].velocity, 12);
    assert.ok(dropSubgun > 0 && dropRifle > 0, 'positive drop past zeroRange');
    assert.ok(dropSubgun > dropRifle * 3, `slow 9mm (${CALIBERS['9mm'].velocity}m/s) drops much more than .338 (${CALIBERS['338'].velocity}m/s): ${dropSubgun} vs ${dropRifle}`);

    const b = arena({ w: 56, enemies: [{ type: 'cultist', pos: { x: 46, y: 16, z: 1 }, group: 1 }] });
    const o = { x: 8.5, y: 16.5, h: 2.4 };
    const tr = traceProjectile(b, o, [1, 0, 0], 34, { ignore: 'p0', velocity: CALIBERS['9mm'].velocity, zeroRange: 8 });
    assert.ok(Array.isArray(tr.arc) && tr.arc.length > 2, `piecewise dropping arc emits multiple vertices (got ${tr.arc?.length})`);
    assert.ok(tr.drop > 0.2, `subgun drops noticeably over 34m (${tr.drop})`);
    assert.ok(tr.arc[tr.arc.length - 1].h < o.h - 0.2, 'final endpoint sits physically below muzzle bore line');
});

test('concrete wall stops trajectory cleanly while open LOS lands physical hits without RNG hit-chance rolls', () => {
    const blocked = arena({
        squad: ['grenadier'],
        players: [{ x: 10, y: 16, z: 1 }],
        enemies: [{ type: 'cultist', pos: { x: 18, y: 16, z: 1 }, group: 1, alerted: true }],
        build: st => { for (let y = 13; y <= 19; y++) for (let z = 2; z <= 5; z++) st.set(14, y, z, MAT.concrete); }
    });
    const shooter = blocked.unit('p0'), foe = blocked.unit('e0');
    const r = blocked.apply({ type: 'shoot', unitId: shooter.id, weaponId: 'repeater', fireMode: 'burst', aim: { point: partCentre(foe, 'torso') } });
    assert.ok(r.ok, r.reason);
    const shot = r.events.find(e => e.t === 'shot');
    assert.ok(shot.projectiles.every(p => p.unitId !== foe.id), 'concrete wall stops all rounds before reaching enemy');
    assert.ok(shot.projectiles.some(p => p.kind === 'voxel'), 'rounds impact concrete wall physically');
});

test('AI prefers single controlled fire when recoilHeat is high or range is long, and heavier fire modes up close', () => {
    const bLong = arena({
        players: [{ x: 4, y: 16, z: 1 }],
        enemies: [{ type: 'warden_foe', pos: { x: 30, y: 16, z: 1 }, group: 1, alerted: true }]
    });
    bLong.apply({ type: 'endTurn', side: 'player' });
    bLong.visibleTo = () => new Set(['p0']);
    bLong.sees = () => true;
    const eLong = bLong.unit('e0');
    const wAuto = { ...WEAPONS.repeater, modes: ['single', 'burst', 'auto'], ap: 1 };
    eLong.weapons = [wAuto.id];
    eLong.ammo[wAuto.id] = 30;
    eLong.recoilHeat = 4.5;
    const highHeatChoice = evaluateBallisticShot(bLong, eLong, bLong.unit('p0'), wAuto, { fireMode: 'single', samples: 16 });
    const hotAuto = evaluateBallisticShot(bLong, eLong, bLong.unit('p0'), wAuto, { fireMode: 'auto', samples: 16 });
    assert.ok(highHeatChoice.recoil.totalClimbDeg < hotAuto.recoil.totalClimbDeg, 'single fire has far less climb than full-auto under heat');

    const bestHot = bestEnemyShot(bLong, eLong, wAuto, enemyThreats(bLong, eLong), { recoilDiscipline: 1.8 });
    assert.equal(bestHot?.fireMode, 'single', `disciplined AI under high heat at long range switches down from auto (picked ${bestHot?.fireMode})`);
});
