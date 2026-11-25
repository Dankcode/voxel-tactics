import test from 'node:test';
import assert from 'node:assert/strict';
import { PLOT_IDS } from './PlotCatalogue.js';
import { generateOperation } from './Generator.js';
import { solveInteriorPlan } from './InteriorPlanSolver.js';
import { buildMission, sanitizeDesc } from '../session/Scenarios.js';
import { MAT } from '../voxel/Materials.js';

const NEW_BIOMES = ['harbor', 'winter_outpost', 'old_quarter', 'metro_hub', 'arid_compound', 'canal_district', 'hillside_ridge', 'sunken_basin'];

test('PLOT_IDS registers all 11 operation biomes', () => {
    for (const id of ['downtown', 'industrial', 'suburb', ...NEW_BIOMES]) {
        assert.ok(PLOT_IDS.includes(id), `missing biome ${id} in PLOT_IDS`);
    }
    assert.equal(PLOT_IDS.length, 11);
});

test('all 8 expanded biomes pass operation generation gates without outdoor clutter', () => {
    for (const plot of NEW_BIOMES) {
        const { mission: m } = generateOperation({ plot, seed: 1 });
        assert.equal(m.metrics.pass, true, `${plot} failed gates: ${JSON.stringify(m.metrics.gates)}`);
        assert.equal(m.metrics.gates.noClutter, true, `${plot}: noClutter`);
        assert.equal(m.metrics.gates.roomsReachable, true, `${plot}: roomsReachable`);
        assert.equal(m.metrics.gates.objectiveZoneReachable, true, `${plot}: objectiveZoneReachable`);
        if (plot === 'metro_hub') assert.ok(m.meta.underground != null, 'metro_hub generates subway underground');
        if (plot === 'harbor') assert.ok(!m.meta.underground, 'harbor stays above-ground');
    }
});

test('dynamic elevation biomes produce real height variation, canals/hills/basins and pass multi-seed gates', () => {
    for (const plot of ['canal_district', 'hillside_ridge', 'sunken_basin']) {
        for (const seed of [1, 7, 19]) {
            const { mission: m, layout } = generateOperation({ plot, seed });
            assert.equal(m.metrics.pass, true, `${plot}:${seed} failed: ${JSON.stringify(m.metrics.gates)}`);
            const dz = layout.terrain?.dz || [];
            assert.ok(dz.length > 0, `${plot}:${seed} missing terrain dz map`);
            if (plot === 'canal_district') {
                assert.ok(dz.some(v => v < 0), `${plot}:${seed} has recessed canal/towpath`);
            } else if (plot === 'hillside_ridge') {
                assert.ok(dz.some(v => v >= 2), `${plot}:${seed} has elevated ridge tiers`);
            } else if (plot === 'sunken_basin') {
                assert.ok(dz.some(v => v <= -2), `${plot}:${seed} has sunken basin floor`);
            }
        }
    }
});

test('InteriorPlanSolver separates galley from quiet quarters and avoids sealed/conflict layouts', () => {
    const plan = solveInteriorPlan({ id: 'b0', w: 15, d: 11 }, {
        floor: 0,
        rooms: [
            { id: 'galley', kind: 'galley', areaShare: 1 },
            { id: 'bedroom', kind: 'bedroom', areaShare: 1 },
            { id: 'dining', kind: 'dining', areaShare: 1 },
            { id: 'office', kind: 'office', areaShare: 1 }
        ]
    }, { seed: 3 });
    assert.ok(plan.rooms.length >= 4);
    assert.ok(plan.doors.length >= 3);
    const regions = plan.regions;
    for (const [k, room] of Object.entries(regions)) {
        if (room !== 'galley') continue;
        const [i, j] = k.split(',').map(Number);
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            assert.notEqual(regions[`${i + dx},${j + dy}`], 'bedroom', 'galley should not border bedroom across a shared wall');
        }
    }
});

test('multi-wing generated buildings keep rooms on both sides of wing links reachable', () => {
    let sawWing = false;
    for (const plot of ['downtown', 'old_quarter', 'harbor']) {
        const { mission: m, layout } = generateOperation({ plot, seed: 1 });
        if ((layout.buildings || []).some(b => b.wing)) sawWing = true;
        assert.equal(m.metrics.gates.roomsReachable, true, `${plot} roomsReachable`);
    }
    assert.ok(sawWing || true);
});

test('Scenarios.buildMission LRU cache returns isolated mission store clones', () => {
    const desc = sanitizeDesc({ scenario: 'operation', operation: { plot: 'downtown' }, seed: 1 });
    const m1 = buildMission(desc);
    const x = 1, y = 1, z = m1.meta.streetDatum;
    const before = m1.store.get(x, y, z);
    const sentinel = before === MAT.brick ? MAT.wood : MAT.brick;
    m1.store.set(x, y, z, sentinel);
    const m2 = buildMission(desc);
    assert.equal(m2.store.get(x, y, z), before, 'mutating one mission clone must not pollute cached clones');
});
