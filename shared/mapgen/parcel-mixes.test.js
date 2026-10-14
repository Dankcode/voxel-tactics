// PLAN-06: parcel mixes, land use, vehicle slots, skybridges, warehouses, terraces, hold zones and the district gates.
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildParkDistrict, buildMallDistrict, buildDrainageDistrict, buildTerraceHeights, buildSuburbDistrict, buildDowntownDistrict, buildDocksideDistrict, buildHighwayDistrict } from '../mission/LargeDistricts.js';
import { createMap } from '../mission/modern/MapKit.js';
import { MAT, materialById } from '../voxel/Materials.js';
import { reachable, nodeKey } from '../world/PathSearch.js';
import { initDistrict, groundAt, k2, put } from './district/Core.js';
import { MIXES, MIX_IDS, mixFits } from './district/MixCatalogue.js';
import { partitionBlock, assignMixes } from './district/MixSolver.js';
import { registerRoads } from './StreetDressing.js';
import { buildSkybridges } from './district/Skybridge.js';
import { layoutWarehouse, addCatwalk, WAREHOUSE_VARIANTS, MAX_RUN } from './district/Warehouse.js';
import { plantTree, TREE_SPECIES } from './district/Props.js';
import { lineOfSight } from '../voxel/Raycast.js';
import { evaluateDistrictGates } from './DistrictGates.js';
import { createRng } from '../util/Rng.js';

const VEHICLES = new Set(['car', 'abandoned_car', 'truck', 'bus', 'semitrailer', 'eighteen_wheeler']);

test('parcel mixes fill the land: no plain ground, every prop has an origin, vehicles only in slots, nothing over the roads', () => {
    for (const [build, seeds] of [[buildParkDistrict, [1, 2]], [buildMallDistrict, [1]], [buildDrainageDistrict, [1, 2]], [buildTerraceHeights, [1]]]) for (const seed of seeds) {
        const m = build({ seed }), g = m.meta.districtGates;
        assert.equal(g.pass, true, `${m.id}#${seed}: ${JSON.stringify(g.gates)} ${JSON.stringify(g.samples)}`);
        assert.ok(g.metrics.plainShare <= 0.08 && g.metrics.plainSquare <= 8, `${m.id}#${seed}: plain ground`);
        assert.equal(g.metrics.unregistered, 0); assert.equal(g.metrics.roadAir, 0); assert.equal(g.metrics.vehiclesOffSlot, 0);
        assert.ok(m.metrics.pass, `${m.id}#${seed}: ${JSON.stringify(m.metrics.gates)}`);
        assert.ok(m.meta.district.leaves.length >= 3, `${m.id}#${seed}: parcels`);
        assert.ok(m.meta.landUse.codes.length === m.store.width * m.store.depth);
    }
});

test('the same seed rebuilds the same parcels, vehicles and props', () => {
    const a = buildParkDistrict({ seed: 5 }), b = buildParkDistrict({ seed: 5 });
    assert.equal(a.store.hash(), b.store.hash());
    assert.deepEqual(a.meta.district.leaves, b.meta.district.leaves);
    assert.deepEqual(a.meta.streetObjects, b.meta.streetObjects);
    assert.equal(a.meta.landUse.codes, b.meta.landUse.codes);
    assert.notEqual(buildParkDistrict({ seed: 6 }).store.hash(), a.store.hash());
});

test('mix catalogue: frontage mixes need a road, fit by size, and the WFC keeps neighbours different and one landmark', () => {
    for (const id of MIX_IDS) { const x = MIXES[id]; assert.ok(x.U[0] <= x.U[1] && x.V[0] <= x.V[1], id); assert.ok(typeof x.dress === 'function', id); }
    assert.equal(mixFits('strip-mall', { U: 30, V: 32, frontage: false }), false);
    assert.equal(mixFits('strip-mall', { U: 30, V: 32, frontage: true }), true);
    assert.equal(mixFits('raised-market', { U: 24, V: 18, frontage: true }, { elevated: false }), false);
    // A long frontage block south of a road becomes several parcels; their mixes differ unless repeatable.
    const m = createMap({ id: 'mix-wfc', width: 120, depth: 40, seed: 3 });
    initDistrict(m, {});
    registerRoads(m, [{ id: 'r', axis: 'x', lo: 2, hi: 6, from: 0, to: 119, z: 1, kind: 'main', sidewalk: 2 }]);
    const block = { id: 'b', x0: 0, y0: 10, w: 120, d: 30, z: 1 };
    const { leaves } = partitionBlock(m, block, { seed: 3, family: 'mixed', elevated: true, rng: createRng(3) });
    assert.ok(leaves.length >= 3 && leaves.every(l => l.frontage && l.front === 'n'), JSON.stringify(leaves.map(l => l.front)));
    const { assignment } = assignMixes(m, leaves, { seed: 3, family: 'mixed', elevated: true });
    const ids = leaves.map(l => assignment.get(l.id));
    for (let i = 1; i < ids.length; i++) if (ids[i] && ids[i] === ids[i - 1]) assert.ok(MIXES[ids[i]].repeat, `${ids[i]} beside itself`);
    assert.ok(ids.filter(id => id && MIXES[id].landmark).length <= 1);
});

test('nested and merged mixes: a strip mall lot sits in front of merged shells; lots and yards register vehicle slots', () => {
    let found = 0;
    for (const seed of [1, 2, 3, 4, 5, 6]) {
        const m = buildParkDistrict({ seed });
        for (const l of m.meta.district.leaves.filter(l => l.mix === 'strip-mall')) {
            const shells = m.buildings.filter(b => b.id.startsWith(`${l.id}-shop`));
            if (shells.length >= 2 && m.meta.remix.merges) assert.ok(shells.some(b => b.mergedWith?.length), 'shells merged');
            found++;
        }
        assert.ok(m.meta.districtGates.metrics.stalls >= m.meta.districtGates.metrics.vehicles, 'vehicles ≤ slots');
    }
    assert.ok(found >= 1, 'a strip mall in six seeds');
});

test('skybridge: only between facing 2-storey buildings, at storey height, with the street clear below', () => {
    const m = createMap({ id: 'bridge', width: 40, depth: 44, height: 16, seed: 1 });
    initDistrict(m, {});
    const road = { id: 'r', axis: 'x', lo: 18, hi: 22, from: 0, to: 39, z: 1, kind: 'main', sidewalk: 2 };
    m.roadX(18, 22); registerRoads(m, [road]);
    const a = m.building({ id: 'north', program: 'office', x0: 10, y0: 4, w: 14, d: 10, storeys: 2, front: 's' });
    assert.equal(buildSkybridges(m, [road], {}).length, 0, 'no building opposite');
    const b = m.building({ id: 'south', program: 'office', x0: 10, y0: 27, w: 14, d: 10, storeys: 2, front: 'n' });
    const [br] = buildSkybridges(m, [road], {});
    assert.ok(br, 'bridge built'); assert.equal(br.z, a.baseZ + 3);
    for (let y = 14; y < 27; y++) { const x = br.sockets[0].x; assert.ok(!m.store.isSolid(x, y, 2) && !m.store.isSolid(x, y, 3), `clear below at ${x},${y}`); assert.ok(m.store.isSolid(x, y, br.z)); }
    const r = reachable(m.store, { x: 12, y: 16, z: 1 });
    assert.ok(br.sockets.every(s => r.costs.has(nodeKey(s))), 'both ends reachable');
});

test('warehouse halls: every variant keeps its floor connected, sightlines ≤ 14, cover within 2, ≥ 3 entrances', () => {
    for (const variant of WAREHOUSE_VARIANTS) {
        const m = createMap({ id: `wh-${variant}`, width: 44, depth: 36, height: 12, seed: 2 });
        initDistrict(m, {});
        const b = m.building({ id: 'wh', program: 'warehouse', x0: 6, y0: 6, w: 30, d: 22, storeys: 1, front: 's', furnish: false });
        const r = layoutWarehouse(m, b, { variant, seed: 2 });
        assert.equal(r.pass, true, `${variant}: ${JSON.stringify(r)}`);
        assert.ok(r.longestRun <= MAX_RUN);
        const hall = b.rooms.find(x => x.kind === 'warehouse');
        const open = hall.cells.filter(([x, y]) => !m.store.isSolid(x, y, hall.floorZ + 1));
        const reach = reachable(m.store, { x: b.exits[0].x + 0, y: b.exits[0].y + 2, z: 1 });
        assert.ok(open.every(([x, y]) => reach.costs.has(nodeKey({ x, y, z: hall.floorZ }))), `${variant}: open floor reachable`);
    }
});

test('terraced district: three flat levels, each wall crossed by a ramp, stairs, a split-level building and a ladder', () => {
    const m = buildTerraceHeights({ seed: 2 }), g = m.meta.districtGates;
    assert.equal(m.meta.terraces.length, 3); assert.deepEqual(m.meta.terraces.map(t => t.z), [1, 4, 7]);
    assert.equal(g.levels.pass, true, JSON.stringify(g.levels));
    for (const p of g.levels.pairs) for (const t of ['terrace-road-ramp', 'terrace-stairs', 'split-level-building']) assert.ok(p.routes.includes(t), `${p.lo}-${p.hi} ${t}`);
    // Parcels are flat: one standing level per parcel.
    for (const l of m.meta.district.leaves) {
        const levels = new Set(); for (let y = l.rect.y0; y < l.rect.y0 + l.rect.d; y++) for (let x = l.rect.x0; x < l.rect.x0 + l.rect.w; x++) levels.add(m.meta.terraces.find(t => x >= t.x0 && x <= t.x1).z);
        assert.equal(levels.size, 1, `${l.id} straddles a wall`);
    }
    assert.equal(m.spawns.player[0].z, 1, 'insertion in the sunken band');
});

test('hold zones keep durable cover after soft cover burns and three grenades land, with blind spawns and a fallback ring', () => {
    for (const [build, seed] of [[buildParkDistrict, 1], [buildDrainageDistrict, 2], [buildMallDistrict, 1], [buildTerraceHeights, 1]]) {
        const m = build({ seed, remix: { objective: 'hold' } }), h = m.meta.districtGates.hold;
        assert.equal(m.objective.kind, 'hold'); assert.ok(m.objective.zone);
        assert.equal(h.pass, true, `${m.id}: ${JSON.stringify(h)}`);
        assert.ok(h.details.anchors >= 4 && h.details.softRemovedCoverShare >= 0.5);
        assert.ok(m.metrics.pass, `${m.id}: ${JSON.stringify(m.metrics.gates)}`);
    }
});

test('cover repair and road sets only add land-use pieces with origins; the insertion roadblock leaves a lane through', () => {
    const m = buildParkDistrict({ seed: 3 });
    for (const r of m.meta.district.repairs) assert.ok(['tree', 'bin', 'appliance', 'jersey', 'concrete_wall', 'brick', 'pallet', 'abandoned_car', 'roadworks'].includes(r.piece), JSON.stringify(r));
    const block = m.meta.district.roadSets.find(r => r.type === 'roadblock');
    assert.ok(block);
    const free = [34, 35, 36, 37, 38].filter(y => !m.store.isSolid(block.at, y, 2));
    assert.ok(free.length >= 1, 'a lane through the roadblock');
});

test('district gates catch an unregistered box, a structure over the road and a vehicle outside a slot', () => {
    const m = buildMallDistrict({ seed: 1 });
    const d = m.district || null;
    assert.equal(m.meta.districtGates.pass, true);
    // Rebuild the map context to plant violations directly.
    const map = createMap({ id: 'gate', width: 30, depth: 20, seed: 1 });
    initDistrict(map, {});
    const road = { id: 'r', axis: 'x', lo: 8, hi: 12, from: 0, to: 29, z: 1, kind: 'main', sidewalk: 2 };
    map.roadX(8, 12); registerRoads(map, [road]);
    map.store.set(5, 10, 2, MAT.crate);                       // a box on the road, no origin
    put(map, 20, 2, 2, 'crate', 'mix:test/ok');               // a registered prop off the road
    map.car(14, 1, 'x');                                      // a car outside any slot
    const mission = map.finish({ name: 'gate', spawns: { player: [{ x: 1, y: 1, z: 1 }], enemy: [] }, objective: { kind: 'eliminate' } });
    const g = evaluateDistrictGates(mission, map);
    assert.equal(g.gates.propOrigin, false); assert.equal(g.gates.roadAir, false); assert.equal(g.gates.vehicles, false);
    assert.ok(d === null || d);
});

test('themed districts: suburb, downtown, docks and highway pass every gate and look like what they are', () => {
    const mixesOf = m => m.meta.district.leaves.map(l => l.mix);
    const sub = buildSuburbDistrict({ seed: 1 }), down = buildDowntownDistrict({ seed: 2 }), dock = buildDocksideDistrict({ seed: 3 }), hw = buildHighwayDistrict({ seed: 2 });
    for (const m of [sub, down, dock, hw]) {
        const g = m.meta.districtGates;
        assert.equal(g.pass, true, `${m.id}: ${JSON.stringify(g.gates)} ${JSON.stringify(g.samples)}`);
        assert.ok(m.metrics.pass, `${m.id}: ${JSON.stringify(m.metrics.gates)}`);
        assert.ok(m.buildings.length >= 3, `${m.id}: ${m.buildings.length} buildings`);
        assert.equal(m.meta.connectorValidation.pass, true);
    }
    assert.ok(mixesOf(sub).filter(x => x === 'house-plot' || x === 'townhouse-row').length >= 2, 'suburb: homes');
    assert.ok(mixesOf(down).some(x => x === 'city-block' || x === 'mainstreet-row'), 'downtown: street-wall blocks');
    assert.ok(!mixesOf(down).some(x => ['house-plot', 'warehouse-yard', 'scrapyard', 'self-storage'].includes(x)), 'downtown: no suburban or heavy-industrial parcels');
    assert.ok(mixesOf(dock).includes('warehouse-yard'), 'docks: warehouses');
    const water = [...Array(dock.store.width).keys()].filter(x => materialById(dock.store.get(x, 2, 1)).key === 'deep_water').length;
    assert.equal(water, dock.store.width, 'docks: deep water along the quay');
    assert.ok(hw.meta.district.roadSets.filter(r => r.type === 'median').length >= 3, 'highway: jersey median');
    assert.ok(!hw.meta.streetObjects.some(v => v.kind === 'kerb' && v.y >= 34 && v.y <= 43), 'highway: no kerb parking on the interstate');
});

test('warehouse catwalk: a grated ring at storey height, stairs up from the floor, and sight down onto the floor', () => {
    const m = createMap({ id: 'wh-catwalk', width: 48, depth: 40, height: 14, seed: 3 });
    initDistrict(m, {});
    const b = m.building({ id: 'wh', program: 'warehouse', x0: 6, y0: 6, w: 32, d: 24, storeys: 2, front: 's', furnish: false });
    layoutWarehouse(m, b, { variant: 'distribution', seed: 3 });
    const cw = addCatwalk(m, b);
    assert.ok(cw && cw.cells >= 40, `catwalk ${JSON.stringify(cw)}`);
    assert.ok(cw.stairs.length >= 2);
    const hall = b.rooms.filter(r => r.storey === 0 && (r.kind === 'warehouse' || r.kind === 'loading')).sort((a, c) => c.cells.length - a.cells.length)[0];
    const reach = reachable(m.store, { x: b.exits[0].x, y: b.exits[0].y + 2, z: 1 });
    for (const st of cw.stairs) assert.ok(reach.costs.has(nodeKey(st.top)), `stair top ${JSON.stringify(st.top)} reachable from the floor`);
    // A shooter on the catwalk sees open floor below it.
    const top = cw.stairs[0].top, eye = { x: top.x + 0.5, y: top.y + 0.5, h: top.z + 1.6 };
    const floor = hall.cells.filter(([x, y]) => !m.store.isSolid(x, y, hall.floorZ + 1) && !m.store.isSolid(x, y, hall.floorZ + 3));
    const seen = floor.filter(([x, y]) => lineOfSight(m.store, eye, { x: x + 0.5, y: y + 0.5, h: hall.floorZ + 1.5 })).length;
    assert.ok(seen >= 20, `catwalk overlooks ${seen} floor cells`);
});

test('trees are species, not blocks: hints carry the species piece and a park mixes several kinds', () => {
    const m = createMap({ id: 'trees', width: 40, depth: 20, height: 14, seed: 1 });
    initDistrict(m, {});
    for (const [i, kind] of Object.keys(TREE_SPECIES).entries()) assert.ok(plantTree(m, 4 + i * 6, 8, `test/${kind}`, kind), kind);
    const pieces = Object.values(m.visual?.hints || m.hints).filter(h => h.tree && h.piece).map(h => h.piece);
    assert.equal(pieces.length, Object.keys(TREE_SPECIES).length);
    assert.ok(new Set(pieces).size >= 5, `pieces ${pieces}`);
    const park = buildParkDistrict({ seed: 2 });
    const kinds = new Set(Object.values(park.visual.hints).filter(h => h.tree && h.piece).map(h => h.piece));
    assert.ok(kinds.size >= 3, `park species ${[...kinds]}`);
});
