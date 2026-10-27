// Real places: Geo-voxel layers (geo-voxels/layers@1) → a playable mission. Geo-voxel owns the real-world side; the
// game reads the layers, builds the real buildings with generated interiors and fills the open land with its parcels.
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPlaceMission, readLayers, gameProgram, PLACE_GENERATOR_VERSION } from './PlaceImport.js';
import { PLACE_MAPS } from './generated/PlaceCatalog.js';
import { buildCatalogPlace, placeSource, PLACE_IDS } from './PlaceMaps.js';
import { bakeMission, registerBaked, bakedMission, clearBaked } from './BakedMaps.js';
import { MAPS } from './Maps.js';
import { MAT } from '../voxel/Materials.js';
import { decomposeFootprint, largestRectangle, resolveParty } from '../mapgen/geo/GeoBuildings.js';
import { planRows, PROGRAMS } from './modern/ModernBuilder.js';
import { B } from '../content/balance.js';

const k2 = (x, y) => `${x},${y}`;
const rectCells = (x0, y0, x1, y1) => { const out = []; for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) out.push([x, y]); return out; };

/** A small synthetic layers@1 export: a street along the north, an L building, a two-tenant strip, a car park, open land. */
function sampleLayers() {
    const W = 72, D = 60, codes = Array(W * D).fill('.'), set = (cells, c) => { for (const [x, y] of cells) codes[x + y * W] = c; };
    set(rectCells(0, 2, W - 1, 6), 'R'); set(rectCells(0, 1, W - 1, 1), 'K'); set(rectCells(0, 7, W - 1, 7), 'K');
    set(rectCells(0, 0, W - 1, 0), 'S'); set(rectCells(0, 8, W - 1, 9), 'S');
    const L = [...rectCells(4, 11, 25, 20), ...rectCells(4, 21, 13, 34)];
    const strip = rectCells(30, 11, 55, 20);
    const lot = rectCells(30, 22, 55, 34);
    set(L, 'B'); set(strip, 'B'); set(lot, 'L');
    return {
        format: 'geo-voxels/layers@1', frame: { cell: 0.9, theta: 0, width: W, depth: D, window: null, origin: { lon: 0, lat: 0 }, crs: 'local:test' },
        heightfield: Array(W * D).fill(1), landUse: { legend: {}, codes: codes.join('') },
        roads: [{ id: 'main-street-1', name: 'Main Street', cls: 2, link: false, oneway: 0, half: 2.5, line: [[-10, 4.5], [W + 10, 4.5]] }],
        lots: [{ id: 'lot-9', name: null, implied: false, cells: lot }],
        buildings: [
            { id: 'l-block', osm: '1', name: 'L Block', program: 'office', storeys: 2, baseZ: 1, roofZ: 7, front: 'n', wings: [{ x0: 4, y0: 11, w: 22, d: 10 }, { x0: 4, y0: 20, w: 10, d: 15 }], mass: 0, doors: [], cells: L.length, parts: 0, tenants: [], facts: null, landmark: false },
            { id: 'strip', osm: '2', name: null, program: 'shop', storeys: 1, baseZ: 1, roofZ: 4, front: 'n', wings: [{ x0: 30, y0: 11, w: 26, d: 10 }], mass: 0, doors: [], cells: strip.length, parts: 0,
                tenants: [{ name: 'Corner Laundry', use: 'shop', tags: { shop: 'laundry' } }, { name: 'The Anchor', use: 'diner', tags: { amenity: 'pub' } }], facts: null, landmark: false }
        ],
        paint: { quads: [{ c: [[10, 4.4], [14, 4.4], [14, 4.6], [10, 4.6]], z: 1, color: 'yellow' }], junctions: [] }
    };
}

test('readLayers: takes layers.json or a map.json carrying them, refuses anything else', () => {
    const L = sampleLayers();
    assert.equal(readLayers(L), L);
    assert.equal(readLayers({ layers: L, report: {}, palette: {} }), L);
    assert.throws(() => readLayers({ format: 'voxel-tactics/geo-places@1' }), /layers@1/);
    assert.throws(() => readLayers({ ...L, heightfield: [1, 2] }), /heightfield/);
});

test('gameProgram: tenants and size turn real buildings into the game\'s building types', () => {
    assert.equal(gameProgram('diner', { tenants: [{ tags: { amenity: 'pub' } }] }), 'bar');
    assert.equal(gameProgram('shop', { tenants: [{ tags: { shop: 'laundry' } }] }), 'laundromat');
    assert.equal(gameProgram('shop', { tenants: [{ tags: { shop: 'convenience' } }] }), 'corner_store');
    assert.equal(gameProgram('garage', { cells: 80 }), 'lockup');
    assert.equal(gameProgram('house', { cells: 600 }), 'walkup');
    assert.equal(gameProgram('office', { cells: 600 }), 'office');
});

test('a small place builds faithfully and deterministically: every real building, tenants as units, the street paint passed through', () => {
    const layers = sampleLayers();
    const ms = buildPlaceMission({ layers, id: 'place-test', name: 'Place Test', objectiveName: 'L Block', newBuildings: 0 });
    const r = ms.meta.placeReport;
    const real = r.buildings;
    assert.equal(real.filter(b => b.name === 'L Block').length, 1);
    assert.equal(real.find(b => b.name === 'L Block').wings, 2, 'the L is two wings');
    assert.ok(real.find(b => b.name === 'L Block').wingDoors >= 2, 'wings joined on every storey');
    assert.deepEqual(r.units.map(u => u.units.sort()), [['Corner Laundry', 'The Anchor']], 'two tenants, two units');
    assert.equal(ms.buildings.find(b => b.realName === 'Corner Laundry').program, 'laundromat');
    assert.equal(ms.buildings.find(b => b.realName === 'The Anchor').program, 'bar');
    assert.ok(r.reach.every(b => b.entered), JSON.stringify(r.reach));
    assert.ok(Object.values(ms.meta.placeGates.gates).every(Boolean), JSON.stringify(ms.meta.placeGates.gates));
    assert.ok(r.lots[0].stalls >= 5, 'the car park is striped');
    assert.ok(ms.visual.roadPaint.quads.some(q => q.color === 'yellow'), 'Geo-voxel paint kept');
    let marks = 0; for (let i = 0; i < ms.store.mat.length; i++) if (ms.store.mat[i] === MAT.road_mark) marks++;
    assert.equal(marks, 0, 'paint is a plan, not voxels');
    assert.equal(ms.meta.generatorVersion, PLACE_GENERATOR_VERSION);
    const again = buildPlaceMission({ layers, id: 'place-test', name: 'Place Test', objectiveName: 'L Block', newBuildings: 0 });
    assert.equal(ms.store.hash(), again.store.hash());
});

test('the open land is the game\'s: parcels fill it (themed), Landmark keeps lawn, newBuildings 0 adds none', () => {
    const layers = sampleLayers();
    const fill = buildPlaceMission({ layers, id: 'place-fill', theme: 'Suburbs', audit: false });
    assert.ok(fill.meta.placeReport.parcels.mixes.length >= 1, JSON.stringify(fill.meta.placeReport.parcels));
    assert.equal(fill.meta.placeReport.family, 'suburban');
    const none = buildPlaceMission({ layers, id: 'place-fill', theme: 'Suburbs', newBuildings: 0, audit: false });
    assert.equal(none.meta.placeReport.parcels.newBuildings.length, 0);
    const park = buildPlaceMission({ layers, id: 'place-park', theme: 'Landmark', audit: false });
    assert.equal(park.meta.placeReport.openLand.mode, 'park');
    assert.ok(park.meta.placeReport.openLand.green > 0);
    const lu = park.meta.landUse.codes;
    assert.ok([...lu].filter(c => c === 'G').length > [...fill.meta.landUse.codes].filter(c => c === 'G').length, 'more lawn');
});

test('footprints: an L outline becomes two wings sharing one wall line; touching buildings keep one party wall', () => {
    const cells = [...rectCells(0, 0, 29, 11), ...rectCells(0, 12, 11, 29)];
    const { wings, mass } = decomposeFootprint(cells);
    assert.equal(wings.length, 2);
    const covered = new Set(mass.map(c => k2(...c)));
    for (const r of wings) for (let y = r.y0; y < r.y0 + r.d; y++) for (let x = r.x0; x < r.x0 + r.w; x++) covered.add(k2(x, y));
    assert.equal(covered.size, cells.length, 'wings ∪ mass = the outline');
    const a = { id: 'a', area: 100, cells: rectCells(0, 0, 9, 9) }, b = { id: 'b', area: 100, cells: rectCells(10, 0, 19, 9) };
    const party = resolveParty([a, b]);
    const xs = [...party].map(k => +k.split(',')[0]);
    assert.ok(party.size >= 10 && xs.every(x => x === xs[0]), 'one party column');
    assert.ok(a.cells.some(([x]) => x === xs[0]) && b.cells.some(([x]) => x === xs[0]), 'owned by both');
    const set = new Set(); for (let y = 0; y < 6; y++) for (let x = 0; x < 10; x++) if (!(x > 6 && y > 2)) set.add(k2(x, y));
    assert.deepEqual(largestRectangle(set, { x0: 0, y0: 0, x1: 9, y1: 5 }), { x0: 0, y0: 0, w: 7, d: 6 });
});

test('planRows: a narrow interior never plans rooms through its outer wall', () => {
    for (const prog of Object.values(PROGRAMS)) for (const [IW, ID] of [[3, 16], [5, 18], [16, 3], [4, 4]]) {
        let plan; try { plan = planRows(IW, ID, prog); } catch { continue; }
        for (const r of plan.rooms) for (const [u, v] of r.cells) assert.ok(u >= 0 && v >= 0 && u < IW && v < ID, `${IW}×${ID} room cell ${u},${v}`);
    }
});

test('catalog: every place is a map, built from its layers; a bake loads back identical and a stale bake is ignored', () => {
    assert.ok(PLACE_MAPS.length >= 4);
    for (const g of PLACE_MAPS) { assert.ok(PLACE_IDS.has(g.id)); assert.ok(MAPS.some(d => d.id === g.id && d.place), g.id); assert.equal(readLayers(g.layers), g.layers); }
    const g = PLACE_MAPS.find(x => x.id === 'baton-rouge-old-state-capitol');
    const live = buildCatalogPlace(g, 1);
    clearBaked();
    registerBaked(bakeMission(live, { id: g.id, seed: 1, generator: PLACE_GENERATOR_VERSION, source: placeSource(g) }));
    const back = bakedMission(g.id, 1, { generator: PLACE_GENERATOR_VERSION, source: placeSource(g) });
    assert.equal(back.store.hash(), live.store.hash());
    assert.equal(bakedMission(g.id, 1, { generator: 'older', source: placeSource(g) }), null);
    clearBaked();
});

test('real places: Third Street builds with every building entered, its landmark dressed and pods along the line of play', () => {
    const g = PLACE_MAPS.find(x => x.id === 'baton-rouge-third-street');
    const m = buildCatalogPlace(g, 1, { audit: true }), r = m.meta.placeReport;
    assert.ok(r.buildings.length >= 15 && r.dropped.length === 0, `${r.buildings.length} buildings, dropped ${JSON.stringify(r.dropped)}`);
    assert.ok(r.reach.every(b => b.entered), JSON.stringify(r.reach.filter(b => !b.entered)));
    assert.ok(Object.values(m.meta.placeGates.gates).every(Boolean), JSON.stringify(m.meta.placeGates.gates));
    assert.ok(m.buildings.some(b => b.realName === 'Fuqua Hardware Store Building'));
    const groups = {}; for (const e of m.spawns.enemy) (groups[e.group] ||= []).push(e.pos);
    const posts = Object.values(groups).map(ps => ({ x: ps.reduce((a, p) => a + p.x, 0) / ps.length, y: ps.reduce((a, p) => a + p.y, 0) / ps.length }));
    let min = Infinity; for (let i = 0; i < posts.length; i++) for (let j = i + 1; j < posts.length; j++) min = Math.min(min, Math.hypot(posts[i].x - posts[j].x, posts[i].y - posts[j].y));
    assert.ok(min >= B.podSpacing * 0.5, `pods ${min.toFixed(1)} apart`);
    const p0 = m.spawns.player[0], d = posts.map(p => Math.hypot(p.x - p0.x, p.y - p0.y)).sort((a, b) => a - b);
    assert.ok(d[0] < d.at(-1) * 0.75, 'not every pod waits at the far end');
});

test('real places: the Sherwood strip centre keeps its striped car park; the landmarks keep their style', () => {
    const sher = buildCatalogPlace(PLACE_MAPS.find(x => x.id === 'baton-rouge-sherwood-florida'), 1, { audit: true }), sr = sher.meta.placeReport;
    const lot = sr.lots.find(l => l.name === 'Sherwood Plaza');
    assert.ok(lot && lot.stalls >= 60 && lot.islands >= 10, JSON.stringify(lot));
    assert.ok(sr.reach.every(b => b.entered));
    assert.ok(Object.values(sher.meta.placeGates.gates).every(Boolean), JSON.stringify(sher.meta.placeGates.gates));
    const osc = buildCatalogPlace(PLACE_MAPS.find(x => x.id === 'baton-rouge-old-state-capitol'), 1);
    assert.equal(osc.meta.placeReport.landmarks.find(l => l.name === 'Old State Capitol')?.style, 'gothic');
    assert.equal(osc.meta.placeReport.openLand.mode, 'park', 'landmark grounds stay lawn');
});
