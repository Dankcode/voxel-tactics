import test from 'node:test';
import assert from 'node:assert/strict';
import { MAT } from '../voxel/Materials.js';
import { VoxelStore } from '../voxel/VoxelStore.js';
import { Battle } from '../battle/Battle.js';
import { decideEnemy, decideDrone } from '../battle/EnemyAi.js';
import { finalizeMission } from '../mission/MissionCommon.js';
import { createRng } from '../util/Rng.js';
import { CALIBERS } from '../content/calibers.js';
import { WEAPONS } from '../content/weapons.js';
import { ENEMIES, UNIT_HP } from '../content/units.js';
import { PLOT_IDS } from './PlotCatalogue.js';
import { generateOperation } from './Generator.js';
import { theaterCatalog, buildLaunchDescriptor } from '../campaign/OperationsTheater.js';

function testArena({ squad = ['grenadier', 'marksman'], players = [{ x: 10, y: 18, z: 1 }, { x: 12, y: 18, z: 1 }], enemies = [], build = null, seed = 7 } = {}) {
    const store = new VoxelStore(28, 28, 12);
    for (let y = 0; y < 28; y++) for (let x = 0; x < 28; x++) { store.set(x, y, 0, MAT.bedrock); store.set(x, y, 1, MAT.grass); }
    build?.(store);
    const mission = finalizeMission({
        id: 'roster-arena', name: 'Roster Arena', store, rooms: [], buildings: [], rng: createRng(seed), secure: false,
        spawns: { player: players, enemy: enemies.map((e, i) => ({ type: e.type, group: e.group ?? 1, pos: e.pos })) },
        objective: { kind: 'eliminate' }
    });
    return new Battle({ mission, squad: squad.map(type => ({ type })), seed });
}

test('campaign theater unlocks all 8 operations in test env including San Francisco Hills and Citadel', () => {
    const unlocked = theaterCatalog({ completedIds: [], intel: 0, roster: [] });
    assert.equal(unlocked.length, 8);
    assert.ok(unlocked.every(op => op.unlocked));
    assert.ok(unlocked.some(op => op.plot === 'hillside_avenue'));
    const citadel = unlocked.find(op => op.id === 'op-citadel-push');
    assert.ok(citadel && citadel.forceLevel === 4);
    const desc = buildLaunchDescriptor(citadel, { seed: 4242 });
    assert.equal(desc.seed, 4242);
    assert.equal(desc.operation.forceLevel, 4);
    const locked = theaterCatalog({ completedIds: [], intel: 0, roster: [] }, { unlockAll: false });
    assert.ok(locked.some(op => !op.unlocked));
});

test('all 12 biomes pass multi-seed generation gates with road-connected parking lots and clean park cover', () => {
    const cleanLots = new Set(['pocket_park', 'plaza', 'civic_green', 'courtyard_park', 'backyard']);
    for (const family of PLOT_IDS) {
        for (const seed of [1, 2]) {
            const { mission: m, layout } = generateOperation({ plot: family, seed });
            assert.equal(m.metrics.pass, true, `${family}:${seed} gates failed: ${JSON.stringify(m.metrics.gates)}`);
            assert.equal(m.metrics.gates.noClutter, true, `${family}:${seed} noClutter`);
            assert.equal(m.metrics.gates.roomsReachable, true, `${family}:${seed} roomsReachable`);
            assert.equal(m.metrics.gates.objectiveZoneReachable, true, `${family}:${seed} objectiveZoneReachable`);

            const roadSet = new Set((layout.plot?.lots || []).filter(l => l.road).map(l => `${l.lx},${l.ly}`));
            for (const lot of layout.plot?.lots || []) {
                if (lot.road) continue;
                const x0 = lot.lx * 8, y0 = lot.ly * 8;
                if (lot.kind === 'parking_lot') {
                    const hasRoad = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => roadSet.has(`${lot.lx + dx},${lot.ly + dy}`));
                    assert.ok(hasRoad, `${family}:${seed} parking_lot at ${lot.lx},${lot.ly} must front a road`);
                }
                if (cleanLots.has(lot.kind)) {
                    for (let y = y0; y < y0 + 8; y++) for (let x = x0; x < x0 + 8; x++) {
                        const gz = m.meta.streetDatum + (layout.terrain?.dz?.[x + y * layout.width] || 0);
                        assert.notEqual(m.store.get(x, y, gz + 1), MAT.jersey, `${family}:${seed} stray jersey inside ${lot.kind}`);
                    }
                }
            }
        }
    }
});

test('San Francisco hillside slopes, sidewalk stairs, and canal bank stairs emit explicit stairYaw hints', () => {
    for (const family of ['hillside_avenue', 'hillside_ridge']) {
        const { mission: m } = generateOperation({ plot: family, seed: 1 });
        let slopeOrStairHints = 0;
        for (let z = 1; z < m.store.height; z++) for (let y = 0; y < m.store.depth; y++) for (let x = 0; x < m.store.width; x++) {
            const k = m.store.get(x, y, z);
            if (k === MAT.road_slope || k === MAT.cobble_slope || k === MAT.sidewalk_stair) {
                const hint = m.visual?.hints?.[`${x},${y},${z}`];
                if (hint && Number.isFinite(hint.stairYaw)) slopeOrStairHints++;
            }
        }
        assert.ok(slopeOrStairHints > 0, `${family} emits explicit uphill stairYaw hints on sloped streets/stairs`);
    }
    const { mission: canal } = generateOperation({ plot: 'canal_district', seed: 1 });
    let canalStairs = 0;
    for (let z = 1; z < canal.store.height; z++) for (let y = 0; y < canal.store.depth; y++) for (let x = 0; x < canal.store.width; x++) {
        if (canal.store.get(x, y, z) === MAT.stairs_stone) {
            const hint = canal.visual?.hints?.[`${x},${y},${z}`];
            if (hint && Number.isFinite(hint.stairYaw)) canalStairs++;
        }
    }
    assert.ok(canalStairs >= 2, 'canal bank stairs carry explicit uphill stairYaw hints');
});

test('new calibers, weapons, marked/shield/stun/blast mechanics and 7 XCOM 2 enemies work cleanly', () => {
    assert.ok(CALIBERS['45acp'] && CALIBERS['40mm'] && CALIBERS['50bmg']);
    for (const id of ['smg', 'lmg', 'auto_shotgun', 'anti_materiel', 'grenade_launcher', 'shock_baton']) {
        assert.ok(WEAPONS[id], `missing weapon ${id}`);
    }
    for (const id of ['officer', 'heavy_gunner', 'breacher', 'sniper', 'medic', 'demolisher', 'gun_drone']) {
        assert.ok(ENEMIES[id], `missing enemy ${id}`);
        if (id !== 'gun_drone') assert.equal(ENEMIES[id].hp, UNIT_HP);
    }
    assert.equal(ENEMIES.gun_drone.hp, 15);
    assert.equal(ENEMIES.gun_drone.armor, 'light');

    // Officer mark_target + Medic field_shield + Shock Baton stun + Grenade Launcher blast + LMG suppress
    const b = testArena({
        players: [{ x: 10, y: 18, z: 1 }],
        enemies: [
            { type: 'officer', pos: { x: 10, y: 12, z: 1 }, group: 1 },
            { type: 'medic', pos: { x: 12, y: 12, z: 1 }, group: 1 },
            { type: 'heavy_gunner', pos: { x: 14, y: 12, z: 1 }, group: 1 },
            { type: 'breacher', pos: { x: 11, y: 17, z: 1 }, group: 1 },
            { type: 'demolisher', pos: { x: 10, y: 6, z: 1 }, group: 2 },
            { type: 'gun_drone', pos: { x: 10, y: 14, z: 1 }, group: 2 }
        ],
        build: st => { st.set(10, 16, 2, MAT.brick); }
    });
    const officer = b.unit('e0'), medic = b.unit('e1'), gunner = b.unit('e2'), breacher = b.unit('e3'), demo = b.unit('e4'), drone = b.unit('e5');
    b.apply({ type: 'endTurn', side: 'player' });

    const rMark = b.apply({ type: 'ability', unitId: officer.id, abilityId: 'mark_target', targetId: 'p0' });
    assert.ok(rMark.ok, rMark.reason);
    assert.ok(b.unit('p0').statuses.some(s => s.id === 'marked'));

    const rShield = b.apply({ type: 'ability', unitId: medic.id, abilityId: 'field_shield' });
    assert.ok(rShield.ok, rShield.reason);
    assert.ok(officer.statuses.some(s => s.id === 'braced') && gunner.statuses.some(s => s.id === 'braced'));

    const rSup = b.apply({ type: 'ability', unitId: gunner.id, abilityId: 'suppress', targetId: 'p0' });
    assert.ok(rSup.ok, rSup.reason);

    const rStun = b.apply({ type: 'melee', unitId: breacher.id, weaponId: 'shock_baton', targetId: 'p0', part: 'torso' });
    assert.ok(rStun.ok, rStun.reason);
    assert.ok(b.unit('p0').statuses.some(s => s.id === 'stunned'));

    const droneIntent = decideDrone(b, drone);
    assert.equal(droneIntent?.type, 'shoot', 'armed gun_drone fires on spotted player');

    const rBlast = b.apply({ type: 'shoot', unitId: demo.id, weaponId: 'grenade_launcher', aim: { point: { x: 10.5, y: 16.5, h: 2.2 } } });
    assert.ok(rBlast.ok, rBlast.reason);
    assert.ok(rBlast.events.some(e => e.t === 'explosion'), 'grenade launcher triggers blast explosion on impact');
    assert.ok(decideEnemy(b, medic) !== undefined);
});

test('Force Level 1 vs Force Level 4 escalates XCOM 2 pod complexity cleanly', () => {
    const op1 = generateOperation({ plot: 'downtown', seed: 5, forceLevel: 1, compile: false });
    const op4 = generateOperation({ plot: 'downtown', seed: 5, forceLevel: 4, compile: false });
    const count = op => op.design.encounters.reduce((n, e) => n + e.types.length, 0);
    const hasHeavy4 = op4.design.encounters.flatMap(e => e.types).some(t => ['heavy_gunner', 'demolisher', 'medic', 'sniper'].includes(t));
    assert.ok(count(op4) > count(op1), `expected FL 4 (${count(op4)}) > FL 1 (${count(op1)}) hostiles`);
    assert.ok(hasHeavy4, 'FL 4 includes late-game XCOM 2 enemy classes');
});
