import test from 'node:test';
import assert from 'node:assert/strict';
import { debugSite, generateDebugMap, DEBUG_PROGRAMS } from './DebugGenerator.js';
import { LocalSession } from '../../client/src/net/LocalSession.js';

test('debug seeds regenerate architecture and keep bounded source inputs', () => {
    assert.deepEqual(debugSite({ seed: 3 }), debugSite({ seed: 3 }));
    assert.notDeepEqual(debugSite({ seed: 3 }).buildings, debugSite({ seed: 4 }).buildings);
    for (const program of DEBUG_PROGRAMS) {
        const site = debugSite({ seed: 3, program, storeys: 4, timeOfDay: 'night-ops' });
        assert.equal(site.buildings[0].program, program);
        assert.equal(site.buildings[0].storeys, 4);
    }
    for (const options of [{seed: -1}, {seed: 1.5}, {seed: 2**32}, {storeys: 5}, {program: 'castle'}, {timeOfDay: 'invalid'}]) {
        assert.throws(() => debugSite(options), /Map builder|map builder/);
    }
});

test('local debug generation runs real solvers, passes gates, and restarts deterministically', async () => {
    const desc = { seed: 3, squad: 'standard', debug: true, debugMap: { program: 'office', storeys: 4, timeOfDay: 'night-ops' } };
    const session = await LocalSession.create(desc);
    const m = session.battle.mission, data = m.meta.debugGeneration;
    assert.equal(m.metrics.pass, true);
    assert.equal(m.buildings[0].storeys, 4);
    assert.equal(m.meta.timeOfDay, 'night-ops');
    assert.ok(data.layout.buildings[0].floors.length === 4);
    assert.ok(data.layout.layers.route.length > 0);
    assert.equal((await session.restart()).battle.hash(), session.battle.hash());
    assert.notDeepEqual(generateDebugMap({ seed: 4 }).meta.debugGeneration.layout.buildings, data.layout.buildings);
    await assert.rejects(LocalSession.create({ ...desc, debug: false }), /local debug/);
});

import { checkGeneratedGates } from './Gates.js';
import { settleUnsupported } from '../voxel/Destruction.js';
import { reachable, nodeKey } from '../world/PathSearch.js';

test('initial debug maps keep every spawn and escape reachable through a support check', () => {
    for (const [seed, program, storeys] of [[1,'office',3],[2,'house',2],[3,'warehouse',4],[4,'shop',1],[5,'diner',3],[6,'garage',4]]) {
        const m = generateDebugMap({ seed, program, storeys }), hash = m.store.hash();
        assert.equal(settleUnsupported(m.store).removed, 0);
        assert.equal(m.store.hash(), hash);
        const reach = reachable(m.store, m.spawns.player[0]);
        assert.ok(m.spawns.player.every(p => reach.costs.has(nodeKey(p))));
        assert.ok(m.buildings.every(b => b.escapes.every(e => reach.costs.has(nodeKey(e.landing)))));
        for (const gate of ['initialSupport','spawnConnectivity','escapeLandings','roofsReachable','facadeAttachment','floorsReachable','objectiveReachable']) assert.equal(m.metrics.gates[gate], true, `${seed}: ${gate}`);
    }
});

test('generated-map preflight rejects an invalid squad spawn or missing roof landing', () => {
    const m = generateDebugMap({ seed: 3, storeys: 4 }), data = m.meta.debugGeneration;
    const original = m.spawns.player[1];
    m.spawns.player[1] = { x: 0, y: 0, z: 17 };
    assert.throws(() => checkGeneratedGates(m, data), /spawnConnectivity/);
    m.spawns.player[1] = original;
    const e = m.buildings[0].escapes.at(-1);
    m.store.set(e.landing.x,e.landing.y,e.landing.z,0);
    assert.throws(() => checkGeneratedGates(m, data), /escapeLandings/);
});
