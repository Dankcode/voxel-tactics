import test from 'node:test';
import assert from 'node:assert/strict';
import { VoxelStore } from './VoxelStore.js';
import { MAT, AIR } from './Materials.js';
import { castRay, lineOfSight, fitArc } from './Raycast.js';
import { damageVoxel, explodeVoxels, settleUnsupported } from './Destruction.js';
import { coverAt, coverAgainst, COVER } from './Cover.js';
import { reachable, nodeKey } from '../world/PathSearch.js';
import { AGENT_PROFILES } from '../world/TraversalRules.js';

function ground(w = 20, d = 20, h = 10) {
    const s = new VoxelStore(w, d, h);
    for (let y = 0; y < d; y++) for (let x = 0; x < w; x++) { s.set(x, y, 0, MAT.bedrock); s.set(x, y, 1, MAT.grass); }
    return s;
}

test('surfaces follow the vibe-game VoxelWorld contract (walkable tops with headroom)', () => {
    const s = ground();
    const surf = s.surfaces(3, 3);
    assert.equal(surf.length, 1);
    assert.equal(surf[0].z, 1);
    assert.ok(surf[0].headroom >= 2);
    s.set(3, 3, 3, MAT.stone);                    // a low ceiling
    assert.equal(s.surfaces(3, 3)[0].headroom, 1);
});

test('copied PathSearch walks the store, climbs 1-voxel steps and wades shallow water', () => {
    const s = ground();
    for (let x = 5; x < 8; x++) s.set(x, 5, 2, MAT.soil);   // a 1-high terrain step (walls are not walkable)
    s.set(10, 5, 1, MAT.water);
    const search = reachable(s, { x: 2, y: 5, z: 1 }, Infinity, AGENT_PROFILES.player);
    assert.ok(search.costs.has(nodeKey({ x: 6, y: 5, z: 2 })), 'stepped up');
    assert.ok(search.costs.has(nodeKey({ x: 10, y: 5, z: 1 })), 'waded');
    s.set(12, 5, 1, MAT.deep_water);
    assert.ok(!reachable(s, { x: 2, y: 5, z: 1 }, Infinity, AGENT_PROFILES.player).costs.has(nodeKey({ x: 12, y: 5, z: 1 })), 'deep water blocks');
});

test('rays stop at solid voxels, pass glass for sight and foliage for bullets', () => {
    const s = ground();
    s.set(5, 5, 2, MAT.stone);
    const r = castRay(s, { x: 2.5, y: 5.5, h: 2.5 }, { x: 9.5, y: 5.5, h: 2.5 });
    assert.deepEqual(r.hit, { x: 5, y: 5, z: 2 });
    s.set(5, 5, 2, MAT.glass);
    assert.ok(lineOfSight(s, { x: 2.5, y: 5.5, h: 2.5 }, { x: 9.5, y: 5.5, h: 2.5 }), 'see through glass');
    s.set(5, 5, 2, MAT.hedge);
    assert.ok(!lineOfSight(s, { x: 2.5, y: 5.5, h: 2.5 }, { x: 9.5, y: 5.5, h: 2.5 }), 'hedge hides');
    assert.equal(castRay(s, { x: 2.5, y: 5.5, h: 2.5 }, { x: 9.5, y: 5.5, h: 2.5 }).hit, null, 'bullets pass a hedge');
});

test('arcs clear a wall when a lob is high enough', () => {
    const s = ground();
    for (let z = 2; z <= 3; z++) s.set(6, 5, z, MAT.stone);
    const arc = fitArc(s, { x: 2.5, y: 5.5, h: 3.5 }, { x: 10.5, y: 5.5, h: 2.1 }, 2.5);
    assert.ok(arc.apex != null && arc.ok);
});

test('voxels take damage, explosions chain through powder kegs, unsupported pieces fall', () => {
    const s = ground();
    s.set(4, 4, 2, MAT.timber);
    assert.equal(damageVoxel(s, 4, 4, 2, 2).destroyed, false);
    assert.equal(damageVoxel(s, 4, 4, 2, 2).destroyed, true);
    s.set(8, 8, 2, MAT.barrel_powder); s.set(10, 8, 2, MAT.barrel_powder);
    const { explosions } = explodeVoxels(s, { x: 8.5, y: 8.5, h: 2.5, radius: 1.5, power: 5 });
    assert.ok(explosions.length >= 2, 'keg chained');
    // A floating slab: pillar removed → slab disappears without rubble.
    s.set(15, 15, 2, MAT.stone); s.set(15, 15, 3, MAT.stone); for (let x = 15; x < 18; x++) s.set(x, 15, 4, MAT.plank);
    s.set(15, 15, 2, AIR); s.set(15, 15, 3, AIR);
    const { removed } = settleUnsupported(s);
    assert.equal(removed, 3);
    assert.equal(s.get(16, 15, 4), AIR);
    assert.equal(s.get(16, 15, 2), AIR);
    assert.ok(!s.mat.includes(MAT.rubble), 'collapse creates no rubble');
});

test('cover readout: half behind a 1-high wall, full behind a 2-high wall, flanked from the side', () => {
    const s = ground();
    s.set(6, 4, 2, MAT.sandbag);
    assert.equal(coverAt(s, 6, 5, 1).n, COVER.HALF);
    s.set(6, 4, 3, MAT.sandbag);
    assert.equal(coverAt(s, 6, 5, 1).n, COVER.HALF, 'a lone stack is a narrow rounded post: bullets get past its sides');
    for (const x of [5, 7]) { s.set(x, 4, 2, MAT.sandbag); s.set(x, 4, 3, MAT.sandbag); }
    assert.equal(coverAt(s, 6, 5, 1).n, COVER.FULL, 'a joined run of sandbags is full cover');
    assert.equal(coverAgainst(s, 6, 5, 1, 6, 0), COVER.FULL);
    assert.equal(coverAgainst(s, 6, 5, 1, 12, 5), COVER.NONE);
});
