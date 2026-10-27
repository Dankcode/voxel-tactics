import test from 'node:test';
import assert from 'node:assert/strict';
import { bakePrefab, bakePlacePrefabs, stampPrefab, transformFor } from './BuildingPrefab.js';
import { createMap } from '../../mission/modern/MapKit.js';
import { PLACE_MAPS } from '../../mission/generated/PlaceCatalog.js';
import { buildCatalogPlace, placeSource } from '../../mission/PlaceMaps.js';
import { reachable, nodeKey } from '../../world/PathSearch.js';
import { AGENT_PROFILES } from '../../world/TraversalRules.js';
import { bakeMission, registerBaked, bakedMission, clearBaked, fingerprint } from '../../mission/BakedMaps.js';
import { MAPS } from '../../mission/Maps.js';
import { PLACE_GENERATOR_VERSION } from '../../mission/PlaceImport.js';

const third = PLACE_MAPS.find(g => g.id === 'baton-rouge-third-street');
// the real buildings only (the game's parcel fill may add its own on open land)
const built = buildCatalogPlace(third, 1), mission = { ...built, buildings: built.buildings.filter(b => !b.parcelBuilt) };

test('prefab transform: four rotations come home, sides and yaw turn with the cells', () => {
    const T1 = transformFor([5, 3], { rot: 1 });
    assert.deepEqual(T1.size, [3, 5]);
    assert.deepEqual(T1.cell([0, 0]), [2, 0]);
    assert.equal(T1.side('n'), 'e');
    let p = [1, 2], size = [5, 3];
    for (let i = 0; i < 4; i++) { const T = transformFor(size, { rot: 1 }); p = T.cell(p); size = T.size; }
    assert.deepEqual(p, [1, 2]);
    const M = transformFor([5, 3], { mirror: true });
    assert.deepEqual(M.cell([0, 1]), [4, 1]); assert.equal(M.side('e'), 'w');
});

test('prefab: a real building bakes and stamps back voxel for voxel (rotation 0)', () => {
    const b = mission.buildings.find(r => r.group === 'capitol-city-press-building') || mission.buildings[0];
    const pf = bakePrefab(mission, b.group || b.id);
    assert.ok(pf.rooms.length > 0 && pf.records.length > 0 && pf.voxels.length % 3 === 0);
    const json = JSON.parse(JSON.stringify(pf));             // the asset is plain JSON
    const recs = mission.buildings.filter(r => (r.group || r.id) === (b.group || b.id)), z0 = Math.min(...recs.map(r => r.baseZ));
    const m = createMap({ id: 'stamp', width: mission.store.width, depth: mission.store.depth, height: mission.store.height, ground: 'paving', datum: 1 });
    // back where it came from: the prefab origin is (world record x0 − local record x0)
    const at = { x: recs[0].x0 - json.records[0].x0, y: recs[0].y0 - json.records[0].y0, z: z0 };
    stampPrefab(m, json, at);
    let diff = 0, n = 0;
    for (const [lx, ly] of json.footprint) for (let lz = 0; lz < json.size[2]; lz++) {
        const X = at.x + lx, Y = at.y + ly, Z = at.z + lz; n++;
        if (m.store.get(X, Y, Z) !== mission.store.get(X, Y, Z)) diff++;
    }
    assert.equal(diff, 0, `${diff}/${n} voxels differ`);
    assert.equal(m.buildings.length, recs.length);
});

test('prefab: every real building stamps rotated and mirrored into an empty lot with every room still reachable', () => {
    const prefabs = bakePlacePrefabs(mission, { place: third.id });
    assert.equal(prefabs.length, new Set(mission.buildings.map(b => b.group || b.id)).size);
    for (const pf of prefabs.slice(0, 6)) for (const [rot, mirror] of [[1, false], [2, true]]) {
        const [W, D] = transformFor(pf.size.slice(0, 2), { rot }).size, pad = 6;
        const m = createMap({ id: `lot-${pf.id}`, width: W + 2 * pad, depth: D + 2 * pad, height: pf.size[2] + 4, ground: 'paving', datum: 1 });
        const recs = stampPrefab(m, pf, { x: pad, y: pad, z: 1, rot, mirror });
        const start = { x: 1, y: 1, z: 1 };
        const search = reachable(m.store, start, Infinity, AGENT_PROFILES.player);
        const playable = m.ctx.rooms.filter(r => r.gameplay !== false);
        const entered = playable.filter(r => r.cells.some(([x, y]) => search.costs.has(nodeKey({ x, y, z: r.floorZ }))));
        assert.ok(entered.length >= Math.ceil(playable.length * 0.9), `${pf.id} rot ${rot}${mirror ? ' mirrored' : ''}: ${entered.length}/${playable.length} rooms reachable`);
        assert.ok(recs.every(b => b.exits.every(e => m.store.inBounds(e.x, e.y, 0))));
    }
});

test('baked map: a bake loads back identical to the live build, and a stale bake is ignored', () => {
    const live = MAPS.find(d => d.id === third.id).build({ seed: 2 });
    const bake = JSON.parse(JSON.stringify(bakeMission(live, { seed: 2, generator: PLACE_GENERATOR_VERSION, source: placeSource(third) })));
    clearBaked(); registerBaked(bake);
    const loaded = MAPS.find(d => d.id === third.id).build({ seed: 2 });
    assert.ok(loaded.meta.baked, 'came from the bake');
    assert.equal(loaded.store.hash(), live.store.hash());
    assert.deepEqual(loaded.spawns, live.spawns);
    assert.deepEqual(loaded.visual.roadPaint, live.visual.roadPaint);
    assert.equal(Object.keys(loaded.visual.hints).length, Object.keys(live.visual.hints).length);
    assert.equal(bakedMission(third.id, 2, { generator: 'older', source: placeSource(third) }), null, 'a bake from another generator version is not used');
    assert.equal(bakedMission(third.id, 2, { generator: PLACE_GENERATOR_VERSION, source: fingerprint('x') }), null, 'nor one of other source data');
    clearBaked();
});

test('prefab library: a baked real building is found by use and size and placed in a lot facing the street', async () => {
    const { registerPrefab, findPrefabs, placePrefabInLot, clearPrefabs } = await import('./PrefabLibrary.js');
    clearPrefabs();
    for (const pf of bakePlacePrefabs(mission, { place: third.id })) registerPrefab(JSON.parse(JSON.stringify(pf)));
    const shops = findPrefabs({ program: 'shop', fits: [40, 40] });
    assert.ok(shops.length >= 1);
    for (const face of ['n', 'e', 's', 'w']) {
        const pf = shops[0], m = createMap({ id: `lot-${face}`, width: 60, depth: 60, height: pf.size[2] + 4, ground: 'paving', datum: 1 });
        const recs = placePrefabInLot(m, pf, { x0: 5, y0: 5, w: 50, d: 50 }, { face, z: 1 });
        assert.ok(recs, `fits facing ${face}`);
        assert.equal(recs.find(b => b.wing === 0 || b.wing == null).front, face, `front faces ${face}`);
    }
    clearPrefabs();
});
