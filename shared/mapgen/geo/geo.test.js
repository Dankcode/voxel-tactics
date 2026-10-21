import test from 'node:test';
import assert from 'node:assert/strict';
import { geoFrame, dominantAngle, rasterPolygon, plateauAndRelax, groundModel, heightfield } from './GeoFrame.js';
import { decomposeFootprint, largestRectangle, resolveParty } from './GeoBuildings.js';
import { buildGeoDistrict } from '../../mission/GeoDistrict.js';
import { rectifyNetwork, orthogonalizeRing, weightedGridAngle } from './GeoRectify.js';
import { planRows, PROGRAMS } from '../../mission/modern/ModernBuilder.js';
import { MAT } from '../../voxel/Materials.js';

const rect = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
const rot = (ring, a) => ring.map(([x, y]) => [x * Math.cos(a) - y * Math.sin(a), x * Math.sin(a) + y * Math.cos(a)]);
const k2 = (x, y) => `${x},${y}`;

test('geo frame: dominant angle undoes a rotated street grid', () => {
    const a = 0.05;   // ≈ 2.9°, like downtown Baton Rouge
    assert.ok(Math.abs(dominantAngle([rot(rect(0, 0, 40, 20), a), rot(rect(50, 0, 70, 30), a)]) - a) < 1e-6);
    const F = geoFrame({ extent: { x0: -45, x1: 45, y0: -36, y1: 36 }, buildings: [{ ring: rot(rect(-20, -10, 20, 10), a) }] });
    assert.deepEqual([F.W, F.D], [100, 80]);
    const corners = rot(rect(-20, -10, 20, 10), a).map(F.toCell);
    assert.ok(corners.every(([, y], i, c) => i % 2 || Math.abs(y - c[(i + 1) % 4][1]) < 1e-6), 'rotated walls land on grid rows');
    const back = F.toWorld(F.toCell([12.3, -4.5])); assert.ok(Math.hypot(back[0] - 12.3, back[1] + 4.5) < 1e-9);
});

test('geo footprint: an L outline becomes two wings sharing one wall line, nothing lost', () => {
    const L = [[0, 0], [30, 0], [30, 12], [12, 12], [12, 30], [0, 30]];
    const cells = rasterPolygon(L, 40, 40);
    const { wings, mass } = decomposeFootprint(cells);
    assert.equal(wings.length, 2);
    const [A, B] = wings, line = [];
    for (let y = Math.max(A.y0, B.y0); y < Math.min(A.y0 + A.d, B.y0 + B.d); y++) for (let x = Math.max(A.x0, B.x0); x < Math.min(A.x0 + A.w, B.x0 + B.w); x++) line.push([x, y]);
    assert.ok(line.length >= 10 && (line.every(c => c[0] === line[0][0]) || line.every(c => c[1] === line[0][1])), 'wings overlap on exactly one shared wall line');
    const covered = new Set(mass.map(c => k2(...c)));
    for (const r of wings) for (let y = r.y0; y < r.y0 + r.d; y++) for (let x = r.x0; x < r.x0 + r.w; x++) covered.add(k2(x, y));
    assert.equal(covered.size, cells.length, 'wings ∪ mass = the outline');
});

test('geo footprint: touching row buildings keep one party wall', () => {
    const a = { id: 'a', area: 100, cells: rasterPolygon(rect(0, 0, 10, 10), 30, 30, { grow: 0.3 }) };
    const b = { id: 'b', area: 100, cells: rasterPolygon(rect(10, 0, 20, 10), 30, 30, { grow: 0.3 }) };
    const party = resolveParty([a, b]);
    assert.ok(party.size >= 10);
    const xs = [...party].map(k => +k.split(',')[0]);
    assert.ok(xs.every(x => x === xs[0]), 'the party wall is a single column');
    assert.ok(a.cells.some(([x]) => x === xs[0]) && b.cells.some(([x]) => x === xs[0]), 'owned by both');
});

test('geo terrain: plateaus under footprints, every neighbouring step ≤ 1 voxel', () => {
    const dem = { step: 5, x0: -50, y0: -50, kind: 'dtm', z: Array.from({ length: 21 }, (_, j) => Array.from({ length: 21 }, (_, i) => 10 + i * 0.4 + j * 0.15)) };
    const F = geoFrame({ extent: { x0: -45, x1: 45, y0: -45, y1: 45 }, buildings: [] }, { rotate: 0 });
    const hf = heightfield(F, groundModel(dem, { kind: 'dtm' }), { datum: 1, maxRelief: 8 });
    assert.ok(hf.reliefVoxels >= 4);
    const cells = rasterPolygon(rect(40, 40, 60, 60), F.W, F.D);
    const plateaus = plateauAndRelax(hf, F.W, F.D, [{ id: 'x', cells }]);
    assert.ok(cells.every(([x, y]) => hf.z[x + y * F.W] === plateaus.get('x')));
    const own = new Set(cells.map(c => k2(...c)));
    for (let y = 0; y < F.D; y++) for (let x = 0; x < F.W; x++) for (const [dx, dy] of [[1, 0], [0, 1], [1, 1], [1, -1]]) {
        const X = x + dx, Y = y + dy; if (X >= F.W || Y < 0 || Y >= F.D || own.has(k2(x, y)) && own.has(k2(X, Y))) continue;
        assert.ok(Math.abs(hf.z[x + y * F.W] - hf.z[X + Y * F.W]) <= 1, `step at ${x},${y}`);
    }
});

test('planRows: a narrow interior never plans rooms through its outer wall', () => {
    for (const prog of Object.values(PROGRAMS)) for (const [IW, ID] of [[3, 16], [5, 18], [16, 3], [4, 4]]) {
        let plan; try { plan = planRows(IW, ID, prog); } catch { continue; }
        for (const r of plan.rooms) for (const [u, v] of r.cells) assert.ok(u >= 0 && v >= 0 && u < IW && v < ID, `${IW}×${ID} room cell ${u},${v}`);
    }
});

test('geo district: a small real block builds faithfully and deterministically', () => {
    const geo = {
        source: 'test', crs: 'EPSG:32615', origin: { lon: -91.19, lat: 30.45 }, extent: { x0: -45, x1: 45, y0: -36, y1: 36 },
        buildings: [
            { osm: '1', tags: { building: 'yes', name: 'L Block', 'building:levels': '2' }, ring: [[-30, -5], [5, -5], [5, 6], [-14, 6], [-14, 25], [-30, 25]] },
            { osm: '2', tags: { building: 'retail', name: 'Corner Shop' }, ring: rect(8, -5, 26, 10) },
        ],
        highways: [{ osm: '10', tags: { highway: 'secondary', name: 'Main Street', lanes: '2' }, line: [[-50, -16], [50, -16]] },
            { osm: '11', tags: { highway: 'residential', name: 'Side Street' }, line: [[34, -40], [34, 40]] }],
        areas: [{ osm: '20', tags: { amenity: 'parking' }, ring: rect(-10, 12, 26, 32) }],
        dem: { step: 6, x0: -45, y0: -36, kind: 'dtm', z: Array.from({ length: 13 }, (_, j) => Array.from({ length: 16 }, (_, i) => 20 + i * 0.25)) },
    };
    const ms = buildGeoDistrict({ geo, id: 'geo-test', name: 'Geo Test', objectiveName: 'L Block' });
    const rep = ms.meta.geoReport, L = rep.buildings.find(b => b.name === 'L Block');
    assert.equal(rep.buildings.length, 2, 'no building invented or lost');
    assert.equal(L.wings, 2); assert.ok(L.wingDoors >= 2, 'wings joined on every storey');
    assert.ok(rep.buildings.every(b => b.polygonIoU >= 0.85), JSON.stringify(rep.buildings.map(b => b.polygonIoU)));
    assert.ok(rep.reach.every(r => r.entered), 'every wing reachable from the insertion');
    assert.ok(ms.meta.geoGates.gates.propOrigin && ms.meta.geoGates.gates.roadAir && ms.meta.geoGates.gates.vehicles);
    assert.ok(rep.terrain.reliefVoxels >= 2, 'real slope kept');
    // no glass in a shared wing wall
    const wings = ms.buildings.filter(b => b.group === L.id);
    const [A, B] = wings;
    for (let y = Math.max(A.y0, B.y0); y < Math.min(A.y0 + A.d, B.y0 + B.d); y++) for (let x = Math.max(A.x0, B.x0); x < Math.min(A.x0 + A.w, B.x0 + B.w); x++)
        for (let z = A.baseZ + 1; z < A.top; z++) assert.notEqual(ms.store.get(x, y, z), MAT.glass);
    const again = buildGeoDistrict({ geo, id: 'geo-test', name: 'Geo Test', objectiveName: 'L Block' });
    assert.ok(Buffer.from(ms.store.mat.buffer).equals(Buffer.from(again.store.mat.buffer)));
});

test('geo district: road paint comes from the road graph (no painted voxels, no lines in the junction box)', () => {
    const geo = {
        source: 'test', extent: { x0: -45, x1: 45, y0: -36, y1: 36 }, buildings: [{ osm: '1', tags: { building: 'retail', name: 'Shop' }, ring: rect(-30, 5, -5, 25) }],
        highways: [{ osm: '10', tags: { highway: 'secondary', name: 'Main Street', lanes: '4' }, line: [[-50, -10], [50, -10]] },
            { osm: '11', tags: { highway: 'residential', name: 'Side Street' }, line: [[20, -40], [20, 40]] }],
        areas: [], dem: { step: 6, x0: -45, y0: -36, kind: 'dtm', z: [[10, 10], [10, 10]] },
    };
    const ms = buildGeoDistrict({ geo, id: 'paint-test', audit: false });
    let marks = 0; for (let i = 0; i < ms.store.mat.length; i++) if (ms.store.mat[i] === MAT.road_mark) marks++;
    assert.equal(marks, 0, 'paint is a plan, not voxels');
    const { quads } = ms.visual.roadPaint, J = ms.meta.geoReport.paint;
    assert.ok(J.junctions >= 1 && quads.some(q => q.color === 'yellow') && quads.some(q => q.color === 'white'));
    const props = ms.meta.geoReport.props;
    assert.ok(props.street_sign + props.stop_sign >= 1, 'the junction is signed');
    assert.ok(ms.visual.decor.every(d => typeof d.kind === 'string'));
});

test('largestRectangle', () => {
    const set = new Set(); for (let y = 0; y < 6; y++) for (let x = 0; x < 10; x++) if (!(x > 6 && y > 2)) set.add(k2(x, y));
    assert.deepEqual(largestRectangle(set, { x0: 0, y0: 0, x1: 9, y1: 5 }), { x0: 0, y0: 0, w: 7, d: 6 });
});

test('geo district: a strip centre with no mapped parking (Sherwood & Florida) — implied car park, shops front the lot', async () => {
    const { GEO_MAPS } = await import('../../mission/generated/GeoCatalog.js');
    const g = GEO_MAPS.find(x => x.id === 'baton-rouge-sherwood-florida');
    const r = buildGeoDistrict({ geo: g.geo, id: g.id, objectiveName: g.objectiveName, tagOverrides: g.tagOverrides, seed: 1 });
    const rep = r.meta.geoReport;
    assert.ok(Object.values(r.meta.geoGates.gates ?? r.meta.geoGates).filter(v => typeof v === 'boolean').every(Boolean), JSON.stringify(r.meta.geoGates.gates ?? r.meta.geoGates));
    const lot = rep.lots.find(l => l.name === 'Sherwood Plaza');
    assert.ok(lot?.implied && lot.stalls >= 60, 'the centre land becomes a striped car park');
    const store = r.buildings.find(b => b.id === 'asian-supermarket');
    assert.equal(store.realName, 'Asian Supermarket');
    assert.equal(store.front, 'n', 'the supermarket fronts its car park, not the map edge');
    assert.ok(rep.reach.every(b => b.entered));
    assert.ok(rep.props.traffic_signal >= 2 && rep.props.traffic_signal <= 4, 'one signalised intersection, not one per centreline junction');
    // doors between tenant units are closed on purpose (they would open through the party wall); every unit keeps one
    assert.ok(r.buildings.filter(b => b.wing === 0).every(b => (b.exits || []).length >= 1), 'every building keeps an outside door');
});

test('straighten: a street grid a few degrees off (and a 79° crossing) becomes exact grid lines, topology kept', () => {
    const rot = (p, a) => [p[0] * Math.cos(a) - p[1] * Math.sin(a), p[0] * Math.sin(a) + p[1] * Math.cos(a)];
    const a = 6 * Math.PI / 180, J = rot([60, 60], a);
    // a boulevard 6° off, a cross street 11° off it (meeting at 79°) sharing the junction vertex, and two carriageways of a divided road
    const roads = [
        { id: 'blvd', cls: 3, half: 5, line: [rot([0, 60], a), [30, 64.5], J, rot([140, 60], a)] },
        { id: 'cross', cls: 3, half: 4, line: [[J[0] - 18, J[1] - 90], J, [J[0] + 17, J[1] + 80]] },
        { id: 'north', cls: 2, half: 3, line: [rot([0, 20], a), rot([140, 20], a)] },
        { id: 'south', cls: 2, half: 3, line: [rot([0, 30], a), rot([140, 30], a)] }];
    const R = rectifyNetwork(roads, { buildings: [{ id: 'b', ring: [rot([80, 70], a), rot([100, 70], a), rot([100, 85], a), rot([80, 85], a)] }] });
    for (const r of R.roads) for (let i = 1; i < r.line.length; i++) {
        const [p, q] = [r.line[i - 1], r.line[i]];
        assert.ok(Math.abs(p[0] - q[0]) < 1e-9 || Math.abs(p[1] - q[1]) < 1e-9, `${r.id} segment ${i} is on the grid`);
    }
    const blvd = R.roads.find(r => r.id === 'blvd'), cross = R.roads.find(r => r.id === 'cross');
    assert.ok(cross.line.some(p => blvd.line.some(q => Math.hypot(p[0] - q[0], p[1] - q[1]) < 1e-9)), 'the crossing still shares its junction vertex');
    const n = R.roads.find(r => r.id === 'north').line[0][1], s = R.roads.find(r => r.id === 'south').line[0][1];
    assert.ok(s - n >= 2, 'the two carriageways stay apart and in order');
    const b = R.buildings[0].ring;
    for (let i = 0; i < b.length; i++) { const p = b[i], q = b[(i + 1) % b.length]; assert.ok(Math.abs(p[0] - q[0]) < 1e-6 || Math.abs(p[1] - q[1]) < 1e-6, 'building walls on the grid'); }
});

test('straighten: orthogonalizeRing squares a near-rectangle and turns a true diagonal into an L', () => {
    const r = orthogonalizeRing([[0, 0], [40, 1.5], [41, 30], [1, 29]]);
    assert.equal(r.length, 4);
    for (let i = 0; i < 4; i++) { const p = r[i], q = r[(i + 1) % 4]; assert.ok(p[0] === q[0] || p[1] === q[1]); }
    const tri = orthogonalizeRing([[0, 0], [40, 0], [40, 40]]);
    for (let i = 0; i < tri.length; i++) { const p = tri[i], q = tri[(i + 1) % tri.length]; assert.ok(Math.abs(p[0] - q[0]) < 1e-9 || Math.abs(p[1] - q[1]) < 1e-9); }
    assert.ok(Math.abs(weightedGridAngle([{ pts: [[0, 0], [Math.cos(0.1) * 50, Math.sin(0.1) * 50]] }]) - 0.1) < 1e-9);
});

test('straighten: the real maps have no slanted street edge', async () => {
    const { GEO_MAPS } = await import('../../mission/generated/GeoCatalog.js');
    for (const g of GEO_MAPS) {
        const r = buildGeoDistrict({ geo: g.geo, id: g.id, objectiveName: g.objectiveName, tagOverrides: g.tagOverrides, audit: false }), lu = r.meta.landUse, s = r.store;
        const st = r.meta.geoReport.straighten;
        assert.ok(st && st.maxShift < 30, `${g.id}: straightened (max shift ${st?.maxShift} cells)`);
        // a slanted edge rasterises as a run of stair corners: no run of ≥ 3 consecutive diagonal stair corners on a carriageway edge
        const R = (x, y) => lu.codes[x + y * lu.width] === 'R';
        let run = 0, worst = 0;
        for (let y = 0; y + 1 < s.depth; y++) for (let x = 0; x + 1 < s.width; x++) {
            const m = [R(x, y), R(x + 1, y), R(x, y + 1), R(x + 1, y + 1)].filter(Boolean).length;
            const next = x + 2 < s.width && y + 2 < s.depth && [R(x + 1, y + 1), R(x + 2, y + 1), R(x + 1, y + 2), R(x + 2, y + 2)].filter(Boolean).length;
            if ((m === 1 || m === 3) && (next === 1 || next === 3)) worst = Math.max(worst, ++run); else run = 0;
        }
        assert.ok(worst < 3, `${g.id}: a carriageway edge staircases (${worst} stair corners in a row)`);
    }
});

test('context: OSM tenants and Wikidata decide uses, units, landmarks and open land', async () => {
    const { programForTags } = await import('./GeoPrograms.js');
    const { GEO_MAPS } = await import('../../mission/generated/GeoCatalog.js');
    const { buildPlace } = await import('../../mission/GeoMaps.js');
    // the program table
    assert.equal(programForTags({ amenity: 'place_of_worship' }).program, 'chapel');
    assert.equal(programForTags({ tourism: 'museum' }).program, 'museum');
    assert.equal(programForTags({ amenity: 'cafe' }).program, 'diner');
    assert.equal(programForTags({ shop: 'supermarket' }).program, 'supermarket');
    assert.equal(programForTags({ building: 'yes' }, { instanceOf: ['state capitol'] }).program, 'civic');
    // one building, two tenants → two units with their real names and uses
    const sher = buildPlace(GEO_MAPS.find(g => g.id === 'baton-rouge-sherwood-florida'), 1, { audit: true });
    const names = new Set(sher.buildings.map(b => b.realName));
    for (const n of ['Asian Supermarket', 'Dollar Tree', 'Vivi Bubble Tea', 'Baton Wireless']) assert.ok(names.has(n), `${n} is its own unit`);
    assert.equal(sher.buildings.find(b => b.realName === 'Vivi Bubble Tea').program, 'diner');
    // a big lot is about a third full, with planted islands in the rows
    const lot = sher.meta.geoReport.lots.find(l => l.implied);
    assert.ok(lot.islands >= 10, 'row islands');
    assert.ok(Object.values(sher.meta.geoGates.gates).every(Boolean));
    // Gothic Revival landmark from Wikidata: battlements and towers above the roof, no rooftop plant, real lawn
    const osc = buildPlace(GEO_MAPS.find(g => g.id === 'baton-rouge-old-state-capitol'), 1, { audit: true });
    const lm = osc.meta.geoReport.landmarks.find(l => l.name === 'Old State Capitol');
    assert.equal(lm.style, 'gothic'); assert.ok(lm.parts.includes('crenellated parapet') && lm.parts.includes('tower'));
    assert.ok(!osc.visual.hints || !Object.values(osc.visual.hints).some(h => h.piece === 'rooftop_ac' && osc.buildings.some(b => b.landmark && h.centre && h.centre[0] >= b.x0 && h.centre[0] <= b.x0 + b.w && h.centre[1] >= b.y0 && h.centre[1] <= b.y0 + b.d)));
    assert.ok(osc.meta.geoReport.openLand.green > osc.meta.geoReport.openLand.yard, 'the grounds are lawn, not invented parcels');
    assert.ok(Object.values(osc.meta.geoGates.gates).every(Boolean));
    // OSM 3D parts: Independence Hall's tower rises to its mapped height (capped at the map limit)
    const ih = buildPlace(GEO_MAPS.find(g => g.id === 'philadelphia-independence-hall'), 1, { audit: false });
    const hall = ih.buildings.filter(b => b.group === 'independence-hall'), base = hall[0].baseZ;
    let topZ = 0; for (const b of hall) for (let y = b.y0; y < b.y0 + b.d; y++) for (let x = b.x0; x < b.x0 + b.w; x++) topZ = Math.max(topZ, ih.store.topSolid(x, y));
    assert.ok(topZ - base >= 35, `tower ${topZ - base} voxels above the base`);
});
