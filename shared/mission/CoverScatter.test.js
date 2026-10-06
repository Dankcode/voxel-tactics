import test from 'node:test';
import assert from 'node:assert/strict';
import { VoxelStore } from '../voxel/VoxelStore.js';
import { MAT } from '../voxel/Materials.js';
import { createRng } from '../util/Rng.js';
import { scatterCover } from './CoverScatter.js';
import { reachable } from '../world/PathSearch.js';
import { AGENT_PROFILES } from '../world/TraversalRules.js';
import { buildProvingGrounds } from './ProvingGrounds.js';

function field(W = 40, D = 32) {
    const s = new VoxelStore(W, D, 8);
    for (let y = 0; y < D; y++) for (let x = 0; x < W; x++) { s.set(x, y, 0, MAT.bedrock); s.set(x, y, 1, MAT.grass); }
    return s;
}

test('cover scatter turns an empty field into covered ground without cutting it up', () => {
    const s = field();
    const { placed, metrics } = scatterCover(s, { rng: createRng(7), maxGap: 4, targetShare: 0.3, budget: 80 });
    assert.ok(placed.length > 10, `placed ${placed.length}`);
    assert.ok(metrics.maxGap <= 5, `max gap ${metrics.maxGap}`);
    assert.ok(metrics.share >= 0.25, `share ${metrics.share}`);
    // Every ground tile outside a prop's footprint is still reachable (props never seal anything off).
    const footprint = new Set(placed.flatMap(p => p.cells.map(([x, y]) => `${x},${y}`)));
    const costs = reachable(s, { x: 1, y: 1, z: 1 }, Infinity, AGENT_PROFILES.player).costs;
    for (let y = 0; y < s.depth; y++) for (let x = 0; x < s.width; x++) {
        if (!footprint.has(`${x},${y}`)) assert.ok(costs.has(`${x},${y},1`), `ground tile ${x},${y} cut off`);
    }
});

test('cover scatter is deterministic and respects blocked tiles', () => {
    const a = field(), b = field();
    const blocked = (x, y) => x >= 10 && x <= 20 && y >= 10 && y <= 20;
    scatterCover(a, { rng: createRng(3), blocked });
    scatterCover(b, { rng: createRng(3), blocked });
    assert.equal(a.hash(), b.hash());
    for (let y = 10; y <= 20; y++) for (let x = 10; x <= 20; x++) assert.ok(!a.isSolid(x, y, 2), `prop inside the blocked box at ${x},${y}`);
});

test('proving grounds: outdoor cover gates pass', () => {
    const m = buildProvingGrounds({ seed: 1 }).metrics;
    assert.ok(m.gates.outdoorCover && m.gates.coverGap, JSON.stringify({ outdoorCover: m.outdoorCover, coverGap: m.coverGap }));
    assert.ok(m.killingField <= 10);
});
