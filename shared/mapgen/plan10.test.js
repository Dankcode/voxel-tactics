// PLAN-10: generated maps only — no sealed or windowless dead-end rooms, no outdoor clutter, vaultable windows.
import test from 'node:test';
import assert from 'node:assert/strict';
import { generateOperation } from './Generator.js';
import { BAY_PIECES, CLUTTER_BASES } from './LotCatalogue.js';
import { canVault } from '../world/PathSearch.js';

for (const plot of ['downtown', 'industrial', 'suburb']) test(`PLAN-10 ${plot}: interiors open, no clutter, ground windows vault`, () => {
    for (const seed of [1, 2, 3, 4]) {
        const { mission: m, layout } = generateOperation({ plot, seed });
        const g = m.metrics.gates;
        for (const gate of ['noSealedRooms', 'roomsReachable', 'roomWindows', 'noDeadEnds', 'noClutter']) assert.equal(g[gate], true, `${plot} ${seed}: ${gate}`);
        assert.ok(!m.rooms.some(r => r.gameplay === false), `${plot} ${seed}: no locked-off service rooms`);
        assert.ok(!layout.pieces.some(p => CLUTTER_BASES.includes(BAY_PIECES[p.id]?.base)));
        // Ground-floor sash/band windows are vault lines.
        let windows = 0, vaults = 0;
        for (const b of m.buildings) for (const w of b.windows) {
            if (w.storey !== 0 || !['window', 'band'].includes(w.kind)) continue;
            windows++;
            const z = b.baseZ ?? m.meta.streetDatum;
            if ([[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => canVault(m.store, { x: w.x - dx, y: w.y - dy, z }, dx, dy))) vaults++;
        }
        if (windows) assert.ok(vaults / windows >= 0.6, `${plot} ${seed}: ${vaults}/${windows} ground windows vaultable`);
    }
});

test('PLAN-11 cover chain: no open dash longer than seven steps along the main line of advance', () => {
    for (const plot of ['downtown', 'industrial', 'suburb']) for (const seed of [2, 4]) {
        const { mission: m } = generateOperation({ plot, seed });
        assert.ok(m.metrics.advanceExposure <= 7, `${plot} ${seed}: exposed run ${m.metrics.advanceExposure}`);
        assert.equal(m.metrics.gates.advanceCover, true);
    }
});
