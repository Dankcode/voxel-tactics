// PLAN-15: enemy pods spread along the line of play (XCOM 2 encounter zones) instead of piling into the objective.
import test from 'node:test';
import assert from 'node:assert/strict';
import { generateOperation } from './Generator.js';
import { podPosts } from './OperationDesigner.js';
import { B } from '../content/balance.js';

for (const family of ['downtown', 'industrial', 'suburb']) for (const seed of [1, 2, 3]) {
    test(`PLAN-15 ${family} seed ${seed}: pods are spaced, one sits before mid-route, two at most in the objective`, () => {
        const op = generateOperation({ plot: family, seed, compile: false });
        const { design } = op, buildings = op.layout.buildings, plot = { insertion: op.layout.insertion };
        const posts = podPosts(design, buildings);
        const target = design.mission.target.building;
        assert.ok(posts.filter(p => p.building === target).length <= 2, 'objective building holds two pods at most');
        const outside = posts.filter(p => p.building !== target);
        for (let i = 0; i < outside.length; i++) for (let j = i + 1; j < outside.length; j++) {
            const d = Math.hypot(outside[i].x - outside[j].x, outside[i].y - outside[j].y);
            assert.ok(d >= B.podSpacing * 0.75 - 1e-6, `pods ${outside[i].group} and ${outside[j].group} are ${d.toFixed(1)} apart`);
        }
        const ins = plot.insertion, tgt = buildings.find(b => b.id === target), tc = { x: tgt.x0 + tgt.w / 2, y: tgt.y0 + tgt.d / 2 };
        const total = Math.hypot(tc.x - ins.x, tc.y - ins.y);
        assert.ok(outside.some(p => Math.hypot(p.x - ins.x, p.y - ins.y) < total * 0.7), 'a pod waits before the objective');
        for (const p of outside) assert.ok(Math.hypot(p.x - ins.x, p.y - ins.y) >= 15.5, 'no pod on the insertion');
    });
}

test('PLAN-15 place profiles: the baked file matches the place catalog, and sampling stays inside the kind range', async () => {
    const { PLACE_MAPS } = await import('../mission/generated/PlaceCatalog.js');
    const { bakedProfiles } = await import('./geo/PlaceProfiles.source.js');
    const { PLACE_PROFILES } = await import('./geo/PlaceProfiles.generated.js');
    const { sampleStoreys, pickVariant, derivePlaceProfile } = await import('./geo/PlaceProfile.js');
    assert.deepEqual(JSON.parse(JSON.stringify(bakedProfiles(PLACE_MAPS))), JSON.parse(JSON.stringify(PLACE_PROFILES)), 'run node tools/places/places.mjs profiles');
    assert.deepEqual(derivePlaceProfile({ frame: { cell: 1 }, buildings: [{ program: 'shop', storeys: 2, wings: [{ w: 20, d: 8 }, { w: 4, d: 4 }] }] }).samples, [{ program: 'shop', storeys: 2, along: 20, deep: 8 }]);
    const dt = PLACE_PROFILES.downtown;
    const draws = Array.from({ length: 200 }, (_, i) => sampleStoreys(dt, 'office', [1, 3], `k${i}`));
    assert.ok(draws.every(n => n >= 1 && n <= 3));
    assert.ok(new Set(draws).size >= 2, 'weighted by the real heights');
    assert.equal(sampleStoreys({ storeys: {}, all: {} }, 'office', [1, 2], 'x'), null, 'no data: the noise rule stays');
    assert.deepEqual(pickVariant({ ratios: [0.5] }, [[15, 11], [15, 7], [11, 9]], 'x'), [15, 7]);
});
