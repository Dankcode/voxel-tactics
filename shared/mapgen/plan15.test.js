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

test('PLAN-15 place profiles: the baked file matches the geo catalog, and sampling stays inside the kind range', async () => {
    const { GEO_MAPS } = await import('../mission/generated/GeoCatalog.js');
    const { bakedProfiles } = await import('./geo/PlaceProfiles.source.js');
    const { PLACE_PROFILES } = await import('./geo/PlaceProfiles.generated.js');
    const { sampleStoreys, pickVariant, ringRect } = await import('./geo/PlaceProfile.js');
    assert.deepEqual(JSON.parse(JSON.stringify(bakedProfiles(GEO_MAPS))), JSON.parse(JSON.stringify(PLACE_PROFILES)), 'run npm run geo:profiles');
    assert.deepEqual(ringRect([[0, 0], [20, 0], [20, 8], [0, 8]]), { along: 20, deep: 8 });
    const dt = PLACE_PROFILES.downtown;
    const draws = Array.from({ length: 200 }, (_, i) => sampleStoreys(dt, 'office', [3, 4], `k${i}`));
    assert.ok(draws.every(n => n === 3 || n === 4));
    assert.ok(draws.includes(3) && draws.includes(4), 'both ends occur, weighted by the real towers');
    assert.equal(sampleStoreys({ storeys: {}, all: {} }, 'office', [1, 2], 'x'), null, 'no data: the noise rule stays');
    assert.deepEqual(pickVariant({ ratios: [0.5] }, [[15, 11], [15, 7], [11, 9]], 'x'), [15, 7]);
});

test('PLAN-15 real places: edge buildings are clipped, not dropped; pods spread from the insertion to the objective', async () => {
    const { GEO_MAPS } = await import('../mission/generated/GeoCatalog.js');
    const { buildGeoDistrict } = await import('../mission/GeoDistrict.js');
    const g = GEO_MAPS.find(x => x.id === 'baton-rouge-third-street');
    const m = buildGeoDistrict({ geo: g.geo, id: g.id, name: g.name, objectiveName: g.objectiveName, ...(g.build || {}), seed: 1, audit: true });
    const r = m.meta.geoReport;
    assert.ok(r.clipped?.length >= 3, 'the storefront row the map edge cuts is kept');
    assert.ok(r.dropped.every(d => /outside map \((\d+)% inside\)/.test(d.reason) ? Number(d.reason.match(/(\d+)%/)[1]) < 12 : true));
    const groups = {}; for (const e of m.spawns.enemy) (groups[e.group] ||= []).push(e.pos);
    const posts = Object.values(groups).map(ps => ({ x: ps.reduce((a, p) => a + p.x, 0) / ps.length, y: ps.reduce((a, p) => a + p.y, 0) / ps.length }));
    let min = Infinity; for (let i = 0; i < posts.length; i++) for (let j = i + 1; j < posts.length; j++) min = Math.min(min, Math.hypot(posts[i].x - posts[j].x, posts[i].y - posts[j].y));
    assert.ok(min >= B.podSpacing * 0.5, `pods ${min.toFixed(1)} apart`);
    const p0 = m.spawns.player[0], d = posts.map(p => Math.hypot(p.x - p0.x, p.y - p0.y)).sort((a, b) => a - b);
    assert.ok(d[0] < d.at(-1) * 0.75, 'not every pod waits at the far end');
});
