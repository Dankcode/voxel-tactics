// Building collapse: ladders and fire escapes hang on a building but never hold it up, and a collapse never strands
// the objective.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createBattle } from '../session/Scenarios.js';
import { AIR } from './Materials.js';
import { reachable, nodeKey } from '../world/PathSearch.js';
import { AGENT_PROFILES } from '../world/TraversalRules.js';
import { inZone } from '../battle/Objectives.js';

const blowGroundStorey = (b, B) => {
    const G = b.mission.meta.streetDatum ?? 1;
    for (let y = B.y0; y < B.y0 + B.d; y += 3) for (let x = B.x0; x < B.x0 + B.w; x += 3)
        assert.ok(b.apply({ type: 'debug', op: 'destroy', at: { x: x + 1, y: y + 1, z: G + 2 }, radius: 2, by: '*' }).ok);
};
const upper = (b, B) => { const G = b.mission.meta.streetDatum ?? 1; let n = 0;
    for (let z = G + 4; z < b.store.height; z++) for (let y = B.y0; y < B.y0 + B.d; y++) for (let x = B.x0; x < B.x0 + B.w; x++) if (b.store.get(x, y, z) !== AIR) n++;
    return n; };

test('a building whose ground storey is destroyed collapses, even with a roof ladder or a fire escape attached', () => {
    for (const scenario of ['cedar-image', 'signal-house']) {
        const b = createBattle({ scenario, seed: 1, debug: true });
        const B = b.mission.buildings.find(B => B.storeys >= 2);
        assert.ok((B.access || []).length, `${scenario}: has access modules`);
        assert.ok(upper(b, B) > 100);
        blowGroundStorey(b, B);
        assert.ok(upper(b, B) < 40, `${scenario}: upper storeys fell (${upper(b, B)} voxels left above the ground storey)`);
        assert.ok(b.log.some(e => e.t === 'collapse'));
    }
});

test('a collapse drops the package and the objective zone to the floor that is left, still reachable', () => {
    const b = createBattle({ scenario: 'signal-house', seed: 1, debug: true }), it = b.objective.item;
    blowGroundStorey(b, b.mission.buildings.find(B => B.id === it.building));
    assert.ok(b.store.surfaces(it.x, it.y).some(c => c.z === it.z && c.headroom >= 2), 'package rests on a floor');
    assert.ok(reachable(b.store, b.unitsOf('player')[0], Infinity, AGENT_PROFILES.player).costs.has(nodeKey(it)), 'package reachable');
    assert.ok(b.log.some(e => e.t === 'drop' && e.collapse));
    const h = createBattle({ scenario: 'operation', seed: 5, operation: { plot: 'downtown', objective: 'hold' }, debug: true }), z = h.objective.zone, before = z.z;
    blowGroundStorey(h, h.mission.buildings.find(B => z.x0 >= B.x0 && z.x1 < B.x0 + B.w && z.y0 >= B.y0 && z.y1 < B.y0 + B.d));
    assert.ok(z.z < before);
    let cells = 0;
    for (let y = z.y0; y <= z.y1; y++) for (let x = z.x0; x <= z.x1; x++) cells += h.store.surfaces(x, y).filter(c => c.headroom >= 2 && inZone(z, { x, y, z: c.z })).length;
    assert.ok(cells > 0, 'the zone can still be held');
});

test('carpeted upper floors can take a floor breach charge', () => {
    const b = createBattle({ scenario: 'main-street', seed: 1 });
    const spots = b.mission.rooms.filter(r => r.storey > 0).flatMap(r => r.cells.map(([x, y]) => ({ x, y, z: r.floorZ })));
    assert.ok(spots.some(d => b.store.material(d.x, d.y, d.z).key === 'carpet' && b.validFloorBreach(d)));
});

import { decide } from '../battle/Ai.js';
test('the squad AI never tries to breach a floor-charge spot as a door (it used to stall there every turn)', () => {
    const b = createBattle({ scenario: 'operation', seed: 4, operation: { plot: 'downtown' }, debug: true });
    let checked = 0;
    for (const r of b.mission.rooms.filter(r => r.storey === 2 && r.gameplay !== false)) for (const [x, y] of r.cells) {
        if (checked >= 3 || !b.validFloorBreach({ x, y, z: r.floorZ })) continue;
        b.apply({ type: 'debug', op: 'teleport', unitId: 'p3', to: { x: x - 1, y, z: r.floorZ }, by: '*' });
        const u = b.unit('p3');
        if (!b.breachPoints(u).some(p => p.entry === 'floor')) continue;
        const intent = decide(b, u);
        if (intent?.type === 'breach') { assert.notEqual(intent.door.entry, 'floor'); assert.equal(b.validate({ ...intent, by: '*' }), null); }
        checked++;
    }
    assert.ok(checked > 0);
});
