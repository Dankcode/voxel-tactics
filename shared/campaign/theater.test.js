import test from 'node:test';
import assert from 'node:assert/strict';
import {
    THEATER_OPERATIONS,
    createTheaterState,
    theaterCatalog,
    regionalContracts,
    buildLaunchDescriptor,
    applyOperationOutcome,
    findTheaterOp
} from './OperationsTheater.js';
import { generateOperation, OPERATION_FLOWS } from '../mapgen/Generator.js';
import { PLOT_IDS } from '../mapgen/PlotCatalogue.js';
import { sanitizeDesc, buildMission } from '../session/Scenarios.js';

test('theater catalog unlocks all operations in the test environment and supports progressive lock mode', () => {
    assert.equal(THEATER_OPERATIONS.length, 8);
    const plots = new Set(THEATER_OPERATIONS.map(o => o.plot));
    assert.ok(plots.has('canal_district'));
    assert.ok(plots.has('hillside_ridge'));
    assert.ok(plots.has('sunken_basin'));
    assert.ok(plots.has('downtown'));
    assert.ok(plots.has('industrial'));
    assert.ok(plots.has('winter_outpost'));
    assert.ok(plots.has('hillside_avenue'));
    assert.ok(PLOT_IDS.length >= 12);
    for (const op of THEATER_OPERATIONS) {
        assert.ok(OPERATION_FLOWS.includes(op.verticalFlow), op.id);
        assert.ok(op.forceLevel >= 1 && op.forceLevel <= 4, op.id);
    }

    const st = createTheaterState();
    const unlockedCat = theaterCatalog(st);
    assert.ok(unlockedCat.every(op => op.unlocked && op.status === 'available'), 'all ops unlocked in test env');

    const lockedCat = theaterCatalog(st, { unlockAll: false });
    assert.equal(lockedCat[0].status, 'available');
    assert.equal(lockedCat[1].status, 'locked');
});

test('progressive theater rewards, seed overrides, and roster experience updates cleanly', () => {
    let st = createTheaterState();
    assert.equal(st.day, 1);
    let cat = theaterCatalog(st, { unlockAll: false });
    assert.equal(cat[0].status, 'available');
    assert.equal(cat[1].status, 'locked');

    const customDesc = buildLaunchDescriptor(cat[0], { seed: 777 });
    assert.equal(customDesc.seed, 777);
    assert.equal(customDesc.operation.forceLevel, cat[0].forceLevel);

    const res1 = applyOperationOutcome(st, cat[0].id, {
        outcome: { winner: 'player', reason: 'recovered' },
        squad: [{ kills: 2, status: 'unhurt' }, { kills: 1, status: 'wounded' }]
    });
    assert.equal(res1.firstClear, true);
    assert.ok(res1.earned.materials >= 6);
    assert.equal(res1.nextOp.id, cat[1].id);
    st = res1.state;
    assert.equal(st.day, 2);
    assert.ok(st.completedIds.includes(cat[0].id));

    cat = theaterCatalog(st, { unlockAll: false });
    assert.equal(cat[0].status, 'completed');
    assert.equal(cat[1].status, 'available');
    assert.equal(cat[2].status, 'locked');

    // Replaying an already completed op yields partial salvage without duplicate completion entry
    const resReplay = applyOperationOutcome(st, cat[0].id, {
        outcome: { winner: 'player', reason: 'recovered' },
        squad: []
    });
    assert.equal(resReplay.firstClear, false);
    assert.equal(resReplay.state.completedIds.length, 1);
    assert.ok(resReplay.earned.materials < res1.earned.materials);
});

test('regional contracts rotate daily and buildLaunchDescriptor produces sanitized playable missions', () => {
    const day1 = regionalContracts(1);
    const day2 = regionalContracts(2);
    assert.equal(day1.length, 3);
    assert.notEqual(day1[0].seed, day2[0].seed);

    const op1 = findTheaterOp('op-canal-locks');
    const desc = sanitizeDesc(buildLaunchDescriptor(op1));
    assert.equal(desc.campaignOpId, 'op-canal-locks');
    assert.equal(desc.operation.plot, 'canal_district');
    assert.equal(desc.operation.verticalFlow, 'low_to_high_to_low');

    // Verify OP-01 (Canal Locks), OP-02 (Hillside Ascent), and OP-03 (Basin Sweep) build & pass all gates!
    for (const id of ['op-canal-locks', 'op-ridge-ascent', 'op-basin-sweep']) {
        const op = findTheaterOp(id);
        const m = buildMission(sanitizeDesc(buildLaunchDescriptor(op)));
        assert.equal(m.metrics.pass, true, `${id} gates failed: ${JSON.stringify(m.metrics.gates)}`);
    }
});

test('vertical flow descriptor generates elevated and lower terrain objectives across seeds', () => {
    for (const [plot, verticalFlow] of [
        ['hillside_ridge', 'bottom_to_top'],
        ['sunken_basin', 'high_to_low'],
        ['canal_district', 'low_to_high_to_low'],
        ['downtown', 'top_to_bottom']
    ]) {
        const { mission, layout } = generateOperation({ plot, verticalFlow, seed: 42 });
        assert.equal(mission.metrics.pass, true, `${plot}/${verticalFlow} failed`);
        assert.ok(layout.terrain, `${plot} missing terrain`);
    }
});
