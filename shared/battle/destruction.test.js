import test from 'node:test';
import assert from 'node:assert/strict';
import { Battle } from './Battle.js';
import { VoxelStore } from '../voxel/VoxelStore.js';
import { MAT, AIR } from '../voxel/Materials.js';
import { damageVoxel } from '../voxel/Destruction.js';
import { THROWABLES } from '../content/weapons.js';
import { packMission, unpackMission } from '../session/MissionSnapshot.js';

function arena({ datum = 1, floor = 'concrete', build = () => {}, buildings = [] } = {}) {
    const store = new VoxelStore(24, 24, 14);
    store.fill(0, 0, 0, 23, 23, 0, 'bedrock');
    if (datum > 1) store.fill(0, 0, 1, 23, 23, datum - 1, 'soil');
    store.fill(0, 0, datum, 23, 23, datum, floor);
    store.datum = datum;
    build(store);
    const mission = { id: 'clean-destruction', store, rooms: [], buildings, meta: { streetDatum: datum },
        objective: { kind: 'eliminate' }, spawns: { player: [{ x: 4, y: 14, z: datum }],
            enemy: [{ type: 'cultist', pos: { x: 20, y: 2, z: datum }, group: 0 }] } };
    return new Battle({ mission, squad: [{ type: 'grenadier' }], seed: 2 });
}
const layer = (store, z) => Array.from({ length: store.width * store.depth }, (_, i) =>
    [store.get(i % store.width, Math.floor(i / store.width), z), store.hpAt(i % store.width, Math.floor(i / store.width), z)]);

test('destroyed walls and unsupported upper slabs leave no rubble or replacement material', () => {
    const b = arena({ build(s) {
        s.set(10, 10, 2, MAT.concrete_wall); s.set(10, 10, 3, MAT.concrete_wall);
        for (let x = 10; x <= 12; x++) s.set(x, 10, 4, MAT.plank);
    } });
    assert.ok(damageVoxel(b.store, 10, 10, 2, 99).destroyed);
    assert.equal(b.store.get(10, 10, 2), AIR);
    b.settle();
    for (let z = 2; z <= 4; z++) for (let x = 10; x <= 12; x++) assert.equal(b.store.get(x, 10, z), AIR);
    assert.ok(b.log.some(e => e.t === 'collapse' && e.removed >= 4));
    assert.ok(!b.store.mat.includes(MAT.rubble));
});

test('a thrown frag and its fuel-drum chain preserve ground material and HP on every blast', () => {
    const b = arena({ build(s) { s.set(10, 10, 2, MAT.barrel_powder); s.set(12, 10, 2, MAT.barrel_powder); } });
    const ground = layer(b.store, 1), u = b.unit('p0');
    assert.ok(b.apply({ type: 'throw', unitId: u.id, itemId: 'powder_bomb', to: { x: 10, y: 10, z: 1 } }).ok);
    assert.ok(b.log.filter(e => e.t === 'explosion').length >= 3, 'grenade and both drums detonate');
    assert.deepEqual(layer(b.store, 1), ground);
    b.detonate(THROWABLES.powder_bomb, { x: 10.5, y: 10.5, h: 2.1 }, u);
    assert.deepEqual(layer(b.store, 1), ground, 'repeated grenades never chip the protected floor');
    assert.ok(!b.store.mat.includes(MAT.rubble));
});

test('grenades preserve raised ground but can destroy walls and upper floors above it', () => {
    const b = arena({ datum: 4, build(s) {
        for (let z = 5; z <= 6; z++) s.set(10, 10, z, MAT.concrete_wall);
        for (let x = 9; x <= 11; x++) for (let y = 9; y <= 11; y++) s.set(x, y, 7, MAT.plank);
    }, buildings: [{ x0: 9, y0: 9, w: 3, d: 3, baseZ: 4 }] });
    const ground = [1, 2, 3, 4].map(z => layer(b.store, z));
    b.detonate(THROWABLES.powder_bomb, { x: 10.5, y: 10.5, h: 6.1 }, b.unit('p0'));
    assert.deepEqual([1, 2, 3, 4].map(z => layer(b.store, z)), ground);
    assert.equal(b.store.get(10, 10, 5), AIR);
    assert.equal(b.store.get(10, 10, 7), AIR);
});

test('local terraces keep their ground floor without making nearby crates indestructible', () => {
    const b = arena({ build(s) {
        s.fill(13, 8, 2, 18, 12, 4, 'soil'); s.fill(13, 8, 5, 18, 12, 5, 'oak_floor');
        s.set(15, 10, 6, MAT.crate);
    } });
    const before = b.store.hpAt(15, 10, 5);
    b.detonate(THROWABLES.powder_bomb, { x: 15.5, y: 10.5, h: 6.1 }, b.unit('p0'));
    assert.equal(b.store.get(15, 10, 5), MAT.oak_floor); assert.equal(b.store.hpAt(15, 10, 5), before);
    assert.equal(b.store.get(15, 10, 6), AIR);
});

test('stacked buildings protect only the lowest floor regardless of registration order', () => {
    const bases = [1, 4].map(baseZ => ({ x0: 9, y0: 9, w: 3, d: 3, baseZ }));
    for (const buildings of [bases, [...bases].reverse()]) {
        const b = arena({ buildings, build(s) {
            s.set(10, 10, 2, MAT.concrete_wall); s.set(10, 10, 3, MAT.concrete_wall);
            for (let x = 9; x <= 11; x++) for (let y = 9; y <= 11; y++) s.set(x, y, 4, MAT.plank);
        } });
        b.detonate(THROWABLES.powder_bomb, { x: 10.5, y: 10.5, h: 3.5 }, b.unit('p0'));
        assert.equal(b.store.get(10, 10, 1), MAT.concrete);
        assert.equal(b.store.get(10, 10, 4), AIR);
    }
});

test('incendiaries keep wooden ground intact across fire ticks while surface hazards still burn', () => {
    const b = arena({ floor: 'plank', build(s) { s.set(10, 10, 2, MAT.timber, 1); } });
    const floor = layer(b.store, 1);
    for (let i = 0; i < 2; i++) {
        b.detonate(THROWABLES.fire_flask, { x: 10.5, y: 10.5, h: 2.1 }, b.unit('p0'));
        assert.equal(b.field.surfaceAt(11, 10, 1), 'burning');
        for (let r = 0; r < 4; r++) b.roundEnd();
    }
    assert.deepEqual(layer(b.store, 1), floor);
    assert.ok(!b.store.mat.includes(MAT.ash));
});

test('dedicated demolition can still open a floor; ordinary grenade protection is not global invulnerability', () => {
    const b = arena();
    b.detonate(THROWABLES.breach_charge, { x: 10.5, y: 10.5, h: 2.1 }, b.unit('p0'));
    assert.equal(b.store.get(10, 10, 1), AIR);
});

test('snapshot hydration and grenade replay agree on protected floors and final battle state', () => {
    const a = arena({ datum: 4, build(s) { s.set(10, 10, 5, MAT.barrel_powder); } });
    const b = new Battle({ mission: unpackMission(packMission(a.mission)), squad: [{ type: 'grenadier' }], seed: 2 });
    const intent = { type: 'throw', unitId: 'p0', itemId: 'powder_bomb', to: { x: 10, y: 10, z: 4 } };
    assert.ok(a.apply(intent).ok); assert.ok(b.apply(intent).ok);
    assert.equal(a.hash(), b.hash());
});
