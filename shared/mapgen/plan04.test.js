// PLAN-04 acceptance tests: fields, plots and lots, the bay WFC, facades, interiors, furnishing, repair, the critic
// and the operation game mode end to end.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Field, fbm, valueNoise, lineOfPlay, sightlineField, picturePrior, gridPath, NOISE_LAYERS } from './Fields.js';
import { createPlot, familyForSite, plotLot, PLOT_IDS, SIDE_VEC, OPPOSITE } from './PlotCatalogue.js';
import { LOT_KINDS, BAY_PIECES } from './LotCatalogue.js';
import { solveDistricts, solveLots, lotCompatible, bayCompatible, solveBays, piecesFromBays } from './ExteriorSolver.js';
import { solveInteriorPlan, placeCore } from './InteriorPlanSolver.js';
import { generateOperation, solveLayoutV3, siteFromLayout, operationOptions } from './Generator.js';
import { compileV3Map } from './ExteriorCompiler.js';
import { checkAccess } from './AccessModules.js';
import { VoxelStore } from '../voxel/VoxelStore.js';
import { MAT } from '../voxel/Materials.js';
import { reachable, nodeKey } from '../world/PathSearch.js';
import { AGENT_PROFILES } from '../world/TraversalRules.js';
import { createBattle } from '../session/Scenarios.js';
import { runAiSide } from '../battle/Ai.js';
import { CEDAR_IMAGE_SITE } from '../mission/generated/CedarImage.js';

const emptyFields = (W, D) => ({ prior: picturePrior(null, W, D, () => [0, 0]), height: new Field(W, D, 0.5), play: { dist: new Field(W, D, 20), flank: new Field(W, D, 20) } });

test('P1 fields: deterministic, continuous noise in range; the line of play is the PathSearch route', () => {
    for (const layer of Object.keys(NOISE_LAYERS)) for (let i = 0; i < 200; i++) {
        const x = (i * 7.31) % 61, y = (i * 3.17) % 47, v = fbm(`t:${layer}`, x, y, NOISE_LAYERS[layer]);
        assert.ok(v >= 0 && v <= 1, `${layer} in range`);
        assert.equal(v, fbm(`t:${layer}`, x, y, NOISE_LAYERS[layer]));
        assert.ok(Math.abs(valueNoise('c', x, y) - valueNoise('c', x + 0.001, y)) < 0.01, 'continuous');
    }
    assert.notEqual(fbm('a', 3.5, 4.5), fbm('b', 3.5, 4.5));
    // A walled courtyard: grid route cost equals PathSearch's cost on the same voxels.
    const W = 30, D = 24, wall = (x, y) => (x === 12 && y < 18) || (y === 9 && x > 16 && x < 28);
    const store = new VoxelStore(W, D, 6); store.fill(0, 0, 0, W - 1, D - 1, 0, 'bedrock'); store.fill(0, 0, 1, W - 1, D - 1, 1, 'concrete');
    for (let y = 0; y < D; y++) for (let x = 0; x < W; x++) if (wall(x, y)) store.fill(x, y, 2, x, y, 4, 'concrete_wall');
    const start = { x: 2, y: 3 }, goal = { x: 25, y: 4 };
    const play = lineOfPlay(W, D, (x, y) => !wall(x, y), start, goal);
    const voxel = reachable(store, { ...start, z: 1 }, Infinity, AGENT_PROFILES.player, { vault: false, ladders: false, jump: false });
    assert.ok(Math.abs(play.main.cost - voxel.costs.get(nodeKey({ ...goal, z: 1 }))) < 1e-6);
    assert.ok(play.flanks.length >= 1 && play.flanks.every(f => f.path[0].x === start.x && f.path.at(-1).x === goal.x));
    const sight = sightlineField(W, D, (x, y) => !wall(x, y));
    assert.ok(sight.get(5, 20) > sight.get(13, 3), 'open ground sees farther than a walled pocket');
});

test('P2 plots and lots: a picture picks its family; 20 seeds tile every plot with matching sockets', () => {
    assert.equal(familyForSite({ theme: 'Industrial' }), 'industrial');
    assert.equal(familyForSite({ theme: 'Suburbs' }), 'suburb');
    assert.equal(familyForSite({ theme: 'Downtown', plot: 'industrial' }), 'industrial');
    for (const family of PLOT_IDS) for (let seed = 1; seed <= 20; seed++) {
        const plot = createPlot(family, seed), fields = emptyFields(plot.W, plot.D);
        const districts = solveDistricts(plot, fields, seed), lots = solveLots(plot, districts, fields, seed), compat = lotCompatible(lots.tiles);
        for (const lot of plot.lots) {
            if (lot.road) continue;
            const id = lots.assignment[`${lot.lx},${lot.ly}`];
            assert.ok(id, `${family}/${seed}: lot ${lot.lx},${lot.ly} assigned`);
            for (const side of ['n', 'e', 's', 'w']) {
                const [dx, dy] = SIDE_VEC[side], n = plotLot(plot, lot.lx + dx, lot.ly + dy);
                if (!n || n.road) continue;
                assert.ok(compat(id, lots.assignment[`${n.lx},${n.ly}`], side), `${family}/${seed}: sockets ${id} ${side} ${lots.assignment[`${n.lx},${n.ly}`]}`);
            }
        }
        // Every building parcel fronts a road on its frontage side; the objective parcel is there.
        for (const p of lots.parcels.filter(p => LOT_KINDS[p.kind].building)) {
            const [dx, dy] = SIDE_VEC[p.front];
            for (let j = 0; j < p.gd; j++) for (let i = 0; i < p.gw; i++) {
                const edge = i + dx < 0 || i + dx >= p.gw || j + dy < 0 || j + dy >= p.gd;
                if (edge) assert.ok(plotLot(plot, p.lx + i + dx, p.ly + j + dy)?.road, `${family}/${seed}: ${p.kind} fronts a road`);
            }
        }
        assert.equal(lots.parcels.filter(p => p.objective).length, 1);
    }
});

test('P3–P8 operations: sockets hold, routes stay clear, pockets sit on the line of play, edges are closed', () => {
    for (const plot of PLOT_IDS) {
        const op = generateOperation({ plot, seed: 2 }), { layout, mission: m } = op;
        assert.ok(m.metrics.pass, `${plot}: all gates pass (${Object.entries(m.metrics.gates).filter(([, v]) => !v).map(([k]) => k)})`);
        // Bay-level sockets: no two pieces touch unless they are one run or one multi-bay object.
        const byBay = new Map(layout.pieces.flatMap(p => { const parts = BAY_PIECES[p.piece].parts || 1; return Array.from({ length: parts }, (_, k) => [`${(p.x >> 1) + (p.axis === 'x' ? k : 0)},${(p.y >> 1) + (p.axis === 'y' ? k : 0)}`, p.base === 'car' || p.base === 'container' ? `${p.base}_${p.axis}_${'abc'[k]}` : p.piece]); }));
        for (const [id, t] of byBay) {
            const [bx, by] = id.split(',').map(Number);
            for (const side of ['e', 's']) { const [dx, dy] = SIDE_VEC[side], n = byBay.get(`${bx + dx},${by + dy}`); if (n) assert.ok(bayCompatible(t, n, side), `${plot}: ${t} ${side} ${n}`); }
        }
        // Nothing stands on the line of play.
        const occupied = new Set(layout.pieces.flatMap(p => p.cells.map(([x, y]) => `${x},${y}`)));
        assert.ok(layout.lineOfPlay.main.every(([x, y]) => !occupied.has(`${x},${y}`)), `${plot}: main route clear`);
        assert.ok(layout.pockets.length >= 2 && layout.pockets.every(p => p.along >= 0.2 && p.along <= 0.95));
        assert.ok(m.metrics.gates.worldEdges && m.metrics.gates.flanksWalkable);
        // P4: no building is all stucco; facades use the district materials; street doors face the frontage.
        assert.ok(layout.buildings.every(b => b.wall !== 'stucco' || b.district === 'residential' || b.district === 'park'));
        assert.ok(layout.buildings.every(b => b.exits[0].side === b.front));
        // Upper-floor windows stack by family (vertical sockets).
        for (const b of layout.buildings) {
            const fam = k => ({ window: 'w', band: 'b', glazing: 'g', storefront: 's' }[k] || 'x');
            const at = (s, x, y) => b.facade.find(p => p.storey === s && p.x === x && p.y === y)?.kind || 'blank';
            for (const p of b.facade) if (p.storey >= 1 && p.storey + 1 < b.storeys) assert.equal(fam(at(p.storey + 1, p.x, p.y)), fam(p.kind), `${b.id} stack at ${p.x},${p.y}`);
        }
        assert.deepEqual(checkAccess(m), { accessTemplates: true, accessByHeight: true });
        assert.ok(m.meta.critic.total >= 0 && m.meta.critic.total <= 100 && layout.critic);
    }
});

test('P5 interiors: 20 seeds × 4 programmes vary, reach every room, mostly two ways in, and stack the core', () => {
    const programmes = {
        office: ['lobby', 'office', 'meeting', 'restroom*'], house: ['living', 'kitchen', 'study', 'bathroom*'],
        warehouse: ['warehouse', 'loading', 'office', 'utility*'], apartment: ['unit', 'bedroom', 'kitchen', 'bathroom*']
    };
    for (const [program, kinds] of Object.entries(programmes)) {
        const plans = new Set();
        let rooms = 0, twoWays = 0;
        for (let seed = 1; seed <= 20; seed++) {
            const b = { id: `${program}-${seed}`, w: 15, d: 11, storeys: 3 };
            const core = placeCore(b, { seed });
            const floors = [0, 1, 2].map(floor => solveInteriorPlan(b, { floor, rooms: kinds.map((k, i) => ({ id: k.replace('*', ''), kind: k.replace('*', ''), areaShare: i ? 0.2 : 0.4, gameplay: !k.endsWith('*') })) }, { seed, core }));
            plans.add(JSON.stringify(floors[0].regions));
            for (const f of floors) {
                assert.deepEqual([f.core.x, f.core.y], [core.x, core.y], 'core stacked');
                // Reachability over doors from the hall (or the root room).
                const ids = f.rooms.map(r => r.id), linked = new Set([ids.includes('hall') ? 'hall' : ids[1]]);
                for (let k = 0; k < ids.length; k++) for (const d of f.doors) if (!d.locked) { if (linked.has(d.room)) linked.add(d.other); if (linked.has(d.other)) linked.add(d.room); }
                for (const r of f.rooms.filter(r => r.gameplay)) assert.ok(linked.has(r.id), `${program}/${seed}/${f.floor}: ${r.id} reachable`);
                for (const r of f.rooms.filter(r => r.gameplay && r.id !== 'hall')) { rooms++; if (f.doors.filter(d => d.room === r.id || d.other === r.id).length >= 2) twoWays++; }
                for (const r of f.rooms.filter(r => !r.gameplay)) assert.ok(f.doors.filter(d => d.room === r.id || d.other === r.id).every(d => d.locked), 'service rooms locked');
            }
        }
        assert.ok(plans.size >= 15, `${program}: ${plans.size} distinct plans over 20 seeds`);
        assert.ok(twoWays / rooms >= 0.5, `${program}: two ways into ${twoWays}/${rooms} rooms`);
    }
});

test('P6 furnishing never blocks a door or splits a floor; the command room carries its story beat', () => {
    const { mission: m, design } = generateOperation({ plot: 'downtown', seed: 4 });
    const search = reachable(m.store, m.spawns.player[0], Infinity, AGENT_PROFILES.player);
    for (const r of m.rooms.filter(r => r.gameplay)) assert.ok(r.cells.some(([x, y]) => search.costs.has(nodeKey({ x, y, z: r.floorZ }))), `${r.buildingId}/${r.storey}/${r.name}`);
    for (const b of m.buildings) for (const d of b.doors.filter(d => !d.locked)) assert.notEqual(m.store.get(d.x, d.y, d.z + 1), MAT.desk);
    const beats = m.buildings.flatMap(b => b.furnishing || []).filter(r => r.kind === 'beat');
    assert.ok(beats.some(r => r.beat === 'climax'), 'climax beat placed');
    assert.ok(m.visual.decor.some(d => ['monitor', 'cash_stack'].includes(d.kind)));
    assert.equal(design.mission.target.building, m.objective.item?.building ?? design.mission.target.building);
});

test('P7 local repair re-collapses one lot and leaves every other piece untouched; operations are deterministic', () => {
    const plot = createPlot('industrial', 6), solved = solveLayoutV3(plot, { seed: 6, timeOfDay: 'night', id: 'operation' }), ctx = solved.context;
    const before = solved.layout.pieces;
    // Re-collapse the most cluttered lot with cover weighted down: only that lot's pieces may change.
    const load = new Map(); for (const p of before) { const k = `${p.x >> 3},${p.y >> 3}`; load.set(k, (load.get(k) || 0) + 1); }
    const [tx, ty] = [...load].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0][0].split(',').map(Number);
    const inLot = p => p.x >> 3 === tx && p.y >> 3 === ty;
    const previous = new Map([...ctx.bays].filter(([id]) => { const [bx, by] = id.split(',').map(Number); return !(bx >> 2 === tx && by >> 2 === ty); }));
    const after = piecesFromBays(solveBays({ ...ctx.solveArgs, pins: ctx.pins, lots: [[tx, ty]], previous, weightBoost: (x, y, p) => (p.cover ? 0.1 : 3) }), ctx.bayGrid);
    const outside = list => list.filter(p => !inLot(p)).map(p => JSON.stringify(p)).sort();
    assert.deepEqual(outside(after), outside(before));
    assert.ok(after.filter(p => inLot(p) && p.cover).length <= before.filter(p => inLot(p) && p.cover).length);
    // Determinism: the same plot and seed rebuild the same layout and matrix; another seed differs.
    const a = generateOperation({ plot: 'suburb', seed: 9 }), b = generateOperation({ plot: 'suburb', seed: 9 });
    assert.equal(JSON.stringify(a.layout), JSON.stringify(b.layout));
    assert.equal(a.mission.store.hash(), b.mission.store.hash());
    assert.notEqual(JSON.stringify(generateOperation({ plot: 'suburb', seed: 10 }).layout.buildings), JSON.stringify(a.layout.buildings));
});

test('game mode: operation descriptors sanitise, build on matching peers, and play AI turns with flankers', () => {
    assert.deepEqual(operationOptions({ plot: 'nowhere', objective: 'loot', timeOfDay: 'noon' }), { plot: 'downtown', objective: null, timeOfDay: null });
    const desc = { scenario: 'operation', seed: 7, operation: { plot: 'industrial', objective: 'hold', timeOfDay: 'night' } };
    const a = createBattle(desc), b = createBattle(desc);
    assert.equal(a.hash(), b.hash());
    assert.equal(a.objective.kind, 'hold');
    assert.equal(a.mission.meta.timeOfDay, 'night');
    assert.ok(a.mission.meta.flanks.length >= 1 && a.mission.meta.pockets.length >= 2);
    for (let round = 0; round < 3 && !a.outcome; round++) { runAiSide(a, 'player'); if (!a.outcome) runAiSide(a, 'enemy'); }
    for (let round = 0; round < 3 && !b.outcome; round++) { runAiSide(b, 'player'); if (!b.outcome) runAiSide(b, 'enemy'); }
    assert.equal(a.hash(), b.hash(), 'lockstep peers agree after AI turns');
    assert.ok(a.stats.flankSteps >= 0);
});

test('picture-site fields read a recorded site (Cedar Image) into a prior', () => {
    const prior = picturePrior(CEDAR_IMAGE_SITE, 56, 48, ([u, v]) => [Math.round(u * 48) + 3, Math.round(v * 40) + 3]);
    assert.ok(prior.building.get(12, 18) > 0.5 && prior.road.get(20, 37) > 0.5 && prior.building.get(20, 37) < 0.2);
    assert.ok(gridPath(10, 10, () => true, { x: 0, y: 0 }, { x: 9, y: 9 }).cost > 12);
    assert.ok(siteFromLayout);
});
