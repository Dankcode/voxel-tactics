// Present-day maps: determinism, design gates across seeds, reachability of every room and exit, spawn safety,
// clear door approaches, and well-formed render hints / decor.
import test from 'node:test';
import assert from 'node:assert/strict';
import { MAPS } from './Maps.js';
import { MATERIALS, AIR } from '../voxel/Materials.js';
import { reachable, nodeKey } from '../world/PathSearch.js';
import { AGENT_PROFILES } from '../world/TraversalRules.js';

const SEEDS = [1, 2, 3, 4];

test('every map builds the same battlefield from the same seed', () => {
    for (const def of MAPS) {
        const a = def.build({ seed: 3 }), b = def.build({ seed: 3 });
        assert.equal(a.store.hash(), b.store.hash(), `${def.id} voxels`);
        assert.deepEqual(a.spawns, b.spawns, `${def.id} spawns`);
        assert.deepEqual(a.visual, b.visual, `${def.id} hints and decor`);
    }
});

test('every map passes the design gates (cover gap ≤ 6, spawn safety, lanes, breaching …) on several seeds', () => {
    for (const def of MAPS) for (const seed of SEEDS) {
        const m = def.build({ seed }).metrics;
        const failing = Object.entries(m.gates).filter(([, ok]) => !ok).map(([k]) => k);
        assert.deepEqual(failing, [], `${def.id}#${seed}: ${failing.join(', ')} (gap ${m.coverGap}, sight ${m.sightlineMedian.toFixed(1)})`);
        assert.ok(m.coverGap <= 6 && m.spawnSafe === 1);
    }
});

test('combat rooms and exits are reachable, closed rooms stay inaccessible, and door approaches stay clear', () => {
    for (const def of MAPS) {
        const m = def.build({ seed: 1 });
        const s = m.store;
        const search = reachable(s, m.spawns.player[0], Infinity, AGENT_PROFILES.player);
        for (const room of m.rooms) {
            const ok = room.cells.some(([x, y]) => search.costs.has(nodeKey({ x, y, z: room.floorZ })));
            assert.equal(ok, room.gameplay !== false, `${def.id}: room ${room.id} (${room.buildingId} ${room.kind}, storey ${room.storey}) has incorrect gameplay access`);
        }
        for (const b of m.buildings) for (const e of b.exits || []) {
            const side = { n: [0, -1], s: [0, 1], e: [1, 0], w: [-1, 0] }[e.side];
            const out = { x: e.x + side[0], y: e.y + side[1] };
            const surf = s.surfaceNear(out.x, out.y, b.baseZ);
            assert.ok(surf && search.costs.has(nodeKey({ x: out.x, y: out.y, z: surf.z })), `${def.id}: exit of ${b.id} at ${e.x},${e.y} unreachable`);
            for (let h = 1; h <= 2; h++) assert.equal(s.isSolid(out.x, out.y, surf.z + h), false, `${def.id}: something blocks the door of ${b.id}`);
        }
        for (const e of m.spawns.enemy) assert.ok(search.costs.has(nodeKey(e.pos)), `${def.id}: enemy at ${JSON.stringify(e.pos)} unreachable`);
    }
});

test('render hints point at real voxels and decor sits in empty cells', () => {
    for (const def of MAPS) {
        const m = def.build({ seed: 2 }), s = m.store;
        for (let i = 0; i < s.mat.length; i++) assert.ok(s.mat[i] < MATERIALS.length, `${def.id}: unknown material id ${s.mat[i]}`);
        for (const [k, h] of Object.entries(m.visual.hints)) {
            const [x, y, z] = k.split(',').map(Number);
            if (h.roller) continue;
            assert.notEqual(s.get(x, y, z), AIR, `${def.id}: hint on an empty cell ${k}`);
            if (h.member) assert.ok(m.visual.hints[h.member]?.cells?.includes(k), `${def.id}: ${k} names an anchor that does not list it`);
        }
        for (const d of m.visual.decor) {
            if (d.free) continue;
            const x = Math.floor(d.x + 0.5), y = Math.floor(d.y + 0.5);
            assert.equal(s.get(x, y, d.z), AIR, `${def.id}: decor ${d.kind} inside a solid at ${x},${y},${d.z}`);
        }
        assert.ok(m.visual.decor.length > 10, `${def.id}: dressed with decor`);
    }
});
