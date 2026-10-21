// PLAN-14: varied buildings — footprint variants, merged parcels (attached wings), new building types, and fewer
// fire escapes (tall blocks without one take their stair core up to a railed roof hatch).
import test from 'node:test';
import assert from 'node:assert/strict';
import { generateOperation } from './Generator.js';
import { LOT_KINDS } from './LotCatalogue.js';
import { MAT } from '../voxel/Materials.js';
import { reachable, nodeKey } from '../world/PathSearch.js';
import { AGENT_PROFILES } from '../world/TraversalRules.js';

test('PLAN-14: generated blocks vary in shape and access, and every map still passes its gates', () => {
    const shapes = new Set(), kinds = new Set();
    let wings = 0, tall = 0, escapes = 0, roofStairs = 0;
    for (const plot of ['downtown', 'industrial', 'suburb']) for (const seed of [1, 3]) {
        const { mission: m, layout } = generateOperation({ plot, seed });
        assert.ok(Object.values(m.metrics.gates).every(Boolean), `${plot} ${seed} gates`);
        for (const b of layout.buildings) {
            shapes.add(`${Math.min(b.w, b.d)}x${Math.max(b.w, b.d)}`); kinds.add(b.kind);
            if (b.wingOf) {
                wings++;
                const main = layout.buildings.find(x => x.id === b.wingOf);
                const touch = (b.x0 === main.x0 + main.w || b.x0 + b.w === main.x0) && b.y0 < main.y0 + main.d && b.y0 + b.d > main.y0
                    || (b.y0 === main.y0 + main.d || b.y0 + b.d === main.y0) && b.x0 < main.x0 + main.w && b.x0 + b.w > main.x0;
                assert.ok(touch, `${b.id} is attached to ${main.id}`);
                assert.ok(b.storeys < main.storeys || b.storeys === 1, 'a wing is lower than its block');
            }
        }
        const search = reachable(m.store, m.spawns.player[0], Infinity, AGENT_PROFILES.player);
        for (const b of m.buildings.filter(b => b.storeys >= 3)) {
            tall++;
            if (b.access.some(r => r.module === 'fire_escape')) escapes++;
            const rs = b.access.find(r => r.module === 'roof_stair');
            if (!rs) continue;
            roofStairs++;
            assert.ok(search.costs.has(nodeKey(rs.landing)), `${b.id}: the roof hatch is reachable from the street`);
            assert.ok(rs.railed.length >= 2 && rs.railed.every(([x, y]) => m.store.get(x, y, b.top + 1) === MAT.railing), 'railed hatch');
        }
    }
    assert.ok(shapes.size >= 6, `${shapes.size} footprint shapes`);
    assert.ok(wings >= 3, `${wings} merged wings`);
    assert.ok(roofStairs >= 1 && escapes < tall, `${escapes}/${tall} tall blocks keep a fire escape`);
    assert.ok(['tenement', 'townhouses', 'motel', 'bar'].some(k => LOT_KINDS[k]) && kinds.size >= 6, [...kinds].join(','));
});
