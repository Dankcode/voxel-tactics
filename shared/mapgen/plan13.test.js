// PLAN-13: designed parcels instead of random outdoor boxes; open metro entrances instead of floating roofed portals.
import test from 'node:test';
import assert from 'node:assert/strict';
import { generateOperation } from './Generator.js';
import { BAY_PIECES, PIECE_POOLS } from './LotCatalogue.js';
import { PARCEL_LAYOUTS } from './ParcelTemplates.js';
import { materialById } from '../voxel/Materials.js';

const BOXES = ['dumpster', 'bins', 'vending', 'rubble', 'sandbags', 'crates', 'pallets', 'drums'];

test('PLAN-13 lot pools carry no random scatter; layouts only use real pieces', () => {
    for (const [name, pool] of Object.entries(PIECE_POOLS)) for (const base of Object.keys(pool)) assert.ok(['open', 'car', 'bus_stop', 'container'].includes(base), `${name}: ${base} is scatter`);
    for (const [kind, layout] of Object.entries(PARCEL_LAYOUTS)) for (const [u, v, base] of layout) {
        assert.ok(u >= 0 && u < 4 && v >= 0 && v < 4, `${kind}: ${u},${v} inside the lot`);
        assert.ok(!BOXES.includes(base), `${kind}: ${base}`);
        assert.ok(BAY_PIECES[base] || BAY_PIECES[`${base}_n`], `${kind}: ${base} exists`);
    }
});

for (const plot of ['downtown', 'industrial', 'suburb']) test(`PLAN-13 ${plot}: no outdoor boxes or stray roofs, entrances are open stairs`, () => {
    for (const seed of [1, 3]) {
        const { mission: m, layout } = generateOperation({ plot, seed });
        assert.ok(Object.values(m.metrics.gates).every(Boolean), `${plot} ${seed}: gates`);
        assert.ok(!layout.pieces.some(p => BOXES.includes(p.base)), `${plot} ${seed}: ${layout.pieces.filter(p => BOXES.includes(p.base)).map(p => p.base)}`);
        const s = m.store, G = m.meta.streetDatum;
        const near = (x, y) => layout.buildings.some(b => x >= b.x0 - 1 && x <= b.x0 + b.w && y >= b.y0 - 1 && y <= b.y0 + b.d);
        for (let x = 0; x < s.width; x++) for (let y = 0; y < s.depth; y++) {
            if (near(x, y)) continue;
            for (let z = G + 1; z < s.height; z++) { const k = materialById(s.get(x, y, z)).key; assert.ok(k !== 'roof' && k !== 'appliance', `${plot} ${seed}: ${k} at ${x},${y},${z}`); }
        }
        // The stair entrance: railings at street level around the well, nothing overhead.
        const portal = m.meta.underground?.connectionParcels?.find(p => p.template === 'street-underpass-portal');
        if (portal) {
            assert.ok(portal.cells.length >= 2, `${plot} ${seed}: railings`);
            assert.ok(portal.cells.every(([x, y, z]) => z === G + 1 && materialById(s.get(x, y, z)).key === 'railing'));
        }
    }
});

test('PLAN-13 parcel pins never contradict: every pinned lot solves without the open-ground fallback', () => {
    const { layout } = generateOperation({ plot: 'suburb', seed: 2 });
    // Fences and hedges come out as runs along parcel edges, not single pieces.
    const runs = layout.pieces.filter(p => ['fence', 'hedge', 'chainlink'].includes(p.base));
    const joined = runs.filter(p => runs.some(q => q !== p && q.base === p.base && q.facing === p.facing && Math.abs(q.x - p.x) + Math.abs(q.y - p.y) === 2));
    assert.ok(runs.length >= 8 && joined.length / runs.length >= 0.6, `${joined.length}/${runs.length} edge pieces join a run`);
});
