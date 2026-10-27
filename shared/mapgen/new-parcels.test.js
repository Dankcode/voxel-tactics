// New parcels: residential variety, service and back of house, commercial infill and garages — each mix lays out on
// its own, its buildings get generated interiors that are reachable, and the operation generator fields the new lots.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createMap } from '../mission/modern/MapKit.js';
import { PROGRAMS, ROOM_FURNITURE, FURNITURE_ITEMS, planRows, furnitureForRoom } from '../mission/modern/ModernBuilder.js';
import { reachable, nodeKey } from '../world/PathSearch.js';
import { AGENT_PROFILES } from '../world/TraversalRules.js';
import { initDistrict, groundAt, k3 } from './district/Core.js';
import { MIXES } from './district/MixCatalogue.js';
import { layoutLeaves } from './district/MixSolver.js';
import { registerRoads } from './StreetDressing.js';
import { remixParameters } from './DistrictRemix.js';
import { LOT_KINDS, WING_PROGRAM } from './LotCatalogue.js';

const NEW_MIXES = ['duplex-plot', 'trailer-park', 'garden-apartments', 'pool-backyard', 'garage-house', 'loading-dock', 'service-alley', 'corner-store', 'laundromat', 'bar-patio', 'lockup-garages'];
const NEW_PROGRAMS = ['duplex', 'trailer', 'walkup', 'corner_store', 'laundromat', 'bar', 'lockup'];

test('new programmes: every room kind is furnished from known items; a duplex has a front door per home; a lock-up a roller door', () => {
    for (const p of NEW_PROGRAMS) {
        const prog = PROGRAMS[p]; assert.ok(prog, p);
        const kinds = new Set(prog.rows.flatMap(r => r.rooms.map(x => x.kind)).concat(Object.values(prog.upper || {})));
        for (const k of kinds) for (const item of furnitureForRoom({ kind: k, cells: Array(60) }, 1)) assert.ok(FURNITURE_ITEMS[item], `${p}/${k}: ${item}`);
    }
    for (const k of ['laundry', 'convenience', 'barroom', 'garage_bay']) assert.ok(ROOM_FURNITURE[k]?.length >= 4, k);
    const duplex = planRows(14, 8, PROGRAMS.duplex);
    assert.equal(duplex.exits.filter(e => e.v === 0).length, 2, 'two front doors');
    assert.ok(duplex.exits.filter(e => e.v === 9).length >= 1, 'back doors');
    const lockup = planRows(4, 5, PROGRAMS.lockup);
    assert.ok(lockup.exits.length === 1 && lockup.exits[0].roller, 'one roller door');
    assert.equal(planRows(10, 3, PROGRAMS.trailer).rooms.length, 3, 'a trailer is one row of three rooms');
});

for (const id of NEW_MIXES) test(`mix ${id}: lays out alone, registers every prop, and every room of every building it adds is entered from the street`, () => {
    const x = MIXES[id];
    const U = Math.round((x.U[0] + x.U[1]) / 2), V = Math.round((x.V[0] + x.V[1]) / 2);
    const W = U + 8, D = V + 14;
    const m = createMap({ id: `mix-${id}`, width: W, depth: D, height: 18, seed: 1, ground: 'paving' });
    initDistrict(m, {});
    registerRoads(m, [{ id: 'r', axis: 'x', lo: 2, hi: 6, from: 0, to: W - 1, z: 1, kind: 'cross', sidewalk: 2 }]);
    const leaf = { id: 'p0', rect: { x0: 4, y0: 11, w: U, d: V }, front: 'n', frontage: !!x.frontage, z: 1 };
    const remix = remixParameters({ merges: false });
    layoutLeaves(m, [leaf], new Map([['p0', id]]), { seed: 1, family: 'mixed', remix });
    const built = m.buildings;
    if (x.buildings) assert.ok(built.length >= 1, `${id}: built ${built.length}`);
    assert.ok(built.length <= (x.buildings || 0), `${id}: at most ${x.buildings} buildings`);
    // every solid above the ground outside the buildings has an origin (the prop-origin gate)
    const r = leaf.rect, inB = (px, py) => built.some(b => px >= b.x0 && py >= b.y0 && px < b.x0 + b.w && py < b.y0 + b.d);
    let unregistered = 0;
    for (let py = r.y0; py < r.y0 + r.d; py++) for (let px = r.x0; px < r.x0 + r.w; px++) {
        if (inB(px, py)) continue;
        for (let z = groundAt(m, px, py) + 1; z < m.store.height; z++) if (m.store.isSolid(px, py, z) && !m.district.origins.has(k3(px, py, z)) && !m.district.stallCells.has(`${px},${py}`)) unregistered++;
    }
    assert.equal(unregistered, 0, `${id}: unregistered solids`);
    // every building is entered from the sidewalk
    const search = reachable(m.store, { x: 2, y: 8, z: 1 }, Infinity, AGENT_PROFILES.player);
    for (const b of built) for (const rm of b.rooms) {
        const entered = rm.cells.some(([cx, cy]) => search.costs.has(nodeKey({ x: cx, y: cy, z: rm.floorZ })));
        assert.equal(entered, rm.gameplay !== false, `${id}: ${b.id} (${b.program}) ${rm.kind} on storey ${rm.storey}`);
    }
});

test('operation lots: the new kinds are odd-sized footprints on one lot depth, with a wing programme and room programmes', async () => {
    const { designProgrammes } = await import('./OperationDesigner.js');
    for (const k of ['duplex', 'walkup', 'trailer', 'corner_store', 'laundromat', 'lockups']) {
        const t = LOT_KINDS[k]?.building; assert.ok(t, k);
        for (const [along, deep] of t.variants || [[t.along, t.deep]]) {
            assert.ok(along % 2 === 1 && deep % 2 === 1, `${k}: ${along}×${deep} is n bays + shell`);
            assert.ok(deep + t.front <= 8 * LOT_KINDS[k].size[1], `${k}: fits its lot depth`);
        }
        assert.ok(WING_PROGRAM[t.program], `${k}: wing programme`);
        assert.ok(PROGRAMS[t.program], `${k}: ModernBuilder programme`);
        const b = { id: 'b', program: t.program, w: t.along, d: t.deep, storeys: t.storeys[1] };
        const design = designProgrammes({ buildings: [b], target: b, plot: { family: 'suburb' }, seed: 1 });
        assert.equal(design.programs.length, b.storeys, k);
    }
});
