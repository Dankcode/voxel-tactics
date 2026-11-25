import test from 'node:test';
import assert from 'node:assert/strict';
import { INNER_RING_RATIO, sampleConeRay, estimateShotTelemetry, partCentre } from './Ballistics.js';
import { Battle } from './Battle.js';
import { VoxelStore } from '../voxel/VoxelStore.js';
import { MAT } from '../voxel/Materials.js';
import { WEAPONS } from '../content/weapons.js';
import { B } from '../content/balance.js';
import { createRng } from '../util/Rng.js';
import { syncItems } from '../inventory/Equipment.js';

function arena({ squad = ['vanguard', 'grenadier'], players = [{ x: 10, y: 20, z: 1 }, { x: 11, y: 20, z: 1 }], enemies = [{ type: 'cultist', pos: { x: 10, y: 8, z: 1 }, group: 1 }], build = null } = {}) {
    const store = new VoxelStore(28, 28, 12);
    for (let y = 0; y < 28; y++) for (let x = 0; x < 28; x++) { store.set(x, y, 0, MAT.bedrock); store.set(x, y, 1, MAT.grass); }
    build?.(store);
    return new Battle({
        mission: { id: 'cone-arena', store, rooms: [], buildings: [], spawns: { player: players, enemy: enemies } },
        squad: squad.map(type => ({ type })), seed: 4
    });
}

test('Phoenix Point dual-ring cone splits 50/50 between inner half-radius and outer annulus', () => {
    assert.equal(INNER_RING_RATIO, 0.5);
    const rng = createRng(11), spreadDeg = 4;
    let innerCount = 0;
    for (let i = 0; i < 1000; i++) {
        const s = sampleConeRay([1, 0, 0], spreadDeg, rng);
        const angleDeg = Math.acos(Math.min(1, Math.max(-1, s.dir[0]))) * 180 / Math.PI;
        if (s.inner) {
            innerCount++;
            assert.ok(angleDeg <= 2.05, `inner ray ${angleDeg.toFixed(3)}° exceeds half-spread 2.05°`);
        } else {
            assert.ok(angleDeg >= 1.95 && angleDeg <= 4.05, `outer ray ${angleDeg.toFixed(3)}° outside [1.95°, 4.05°]`);
        }
    }
    assert.ok(innerCount >= 450 && innerCount <= 550, `expected ~500 inner rays, got ${innerCount}`);
});

test('estimateShotTelemetry reports bounded probabilities, damage forecasts, and lower hit odds through walls', () => {
    const open = arena();
    const u = open.unit('p0'), e = open.unit('e0');
    const aim = { point: partCentre(e, 'torso') };
    const { spread } = open.spreadFor(u, WEAPONS.repeater, aim.point, { target: e, fireMode: 'burst' });
    const clearTel = estimateShotTelemetry(open, u, aim, { weapon: WEAPONS.repeater, spread, fireMode: 'burst', samples: 96 });
    for (const k of ['hit', 'innerHit', 'partHit', 'expectedDamage', 'dropMeters', 'distance', 'spread', 'rounds', 'totalProjectiles']) {
        assert.ok(Number.isFinite(clearTel[k]), `telemetry field ${k} must be finite`);
    }
    assert.equal(clearTel.critChance, undefined, 'no XCOM critChance in ballistic telemetry');
    assert.ok(clearTel.recoil && Number.isFinite(clearTel.recoil.totalClimbDeg) && Number.isFinite(clearTel.recoil.stabilityMult));
    assert.ok(clearTel.innerHit <= clearTel.hit + 1e-9);
    assert.ok(clearTel.hit > 0.5 && clearTel.expectedDamage > 0);

    const walled = arena({
        build: st => { for (let x = 8; x <= 12; x++) for (let z = 2; z <= 4; z++) st.set(x, 14, z, MAT.concrete); }
    });
    const wallTel = estimateShotTelemetry(walled, walled.unit('p0'), { point: partCentre(walled.unit('e0'), 'torso') }, {
        weapon: WEAPONS.repeater, spread, fireMode: 'burst', samples: 96
    });
    assert.ok(wallTel.hit < clearTel.hit, `concrete cover should reduce hit (${wallTel.hit} vs ${clearTel.hit})`);
});

test('limb disabilities block heavy weapons / dash cleanly; bleeding ticks and medkit cures it', () => {
    const b = arena({ squad: ['marksman', 'vanguard'] });
    const sniper = b.unit('p0'), medic = b.unit('p1'), foe = b.unit('e0');
    const aim = { point: partCentre(foe, 'torso') };

    sniper.parts.armL.disabled = true;
    sniper.parts.armR.disabled = true;
    assert.equal(b.validate({ type: 'shoot', unitId: sniper.id, weaponId: 'longrifle', aim }), 'arms_disabled');
    assert.equal(b.validate({ type: 'shoot', unitId: sniper.id, weaponId: 'handcannon', aim }), null);

    medic.parts.legs.disabled = true;
    assert.equal(b.validate({ type: 'ability', unitId: medic.id, abilityId: 'dash', to: { x: 11, y: 18, z: 1 } }), 'legs_disabled');

    const fresh = b.unit('p0');
    fresh.parts.armL.disabled = false;
    b.dealDamage(fresh, 'armL', 20, { pierce: 99 });
    assert.ok(fresh.statuses.some(s => s.id === 'bleeding'), 'disabling a limb inflicts bleeding');

    const hpBeforeBleed = fresh.hp;
    b.startSide('player');
    assert.equal(fresh.hp, hpBeforeBleed - B.bleedDamage, 'bleeding deals B.bleedDamage at start of turn');

    medic.ap = 4;
    medic.inventory.push({ id: 'mk1', itemId: 'medkit', x: 0, y: 0, rotated: false });
    syncItems(medic);
    const heal = b.apply({ type: 'gadget', unitId: medic.id, itemId: 'medkit', targetId: fresh.id });
    assert.ok(heal.ok, heal.reason);
    assert.ok(!fresh.statuses.some(s => s.id === 'bleeding'), 'medkit clears bleeding');
    assert.ok(fresh.hp > hpBeforeBleed - B.bleedDamage, 'medkit heals HP');
});
