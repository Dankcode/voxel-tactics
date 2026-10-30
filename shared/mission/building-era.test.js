// Building era → edge style: curves are explicitly authored, ordinary buildings are straight (interior
// included), and two merged buildings keep their own style per footprint.
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildingEra, markBuildingEdges, straightCells } from './BuildingEra.js';
import { createMap } from './modern/MapKit.js';
import { collisionFootprint, WALL_KEYS } from '../voxel/ConnectedShapes.js';
import { materialById } from '../voxel/Materials.js';
import { packMission, unpackMission } from '../session/MissionSnapshot.js';

test('era comes from the spec: explicit era, then the older rounded flag, then the builder default', () => {
    assert.equal(buildingEra({ era: 'old', rounded: true }), 'old');
    assert.equal(buildingEra({ rounded: false }), 'old');
    assert.equal(buildingEra({ rounded: true }), 'modern');
    assert.equal(buildingEra({}), 'modern');
    assert.equal(buildingEra({}, 'old'), 'old');
    assert.equal(buildingEra({ era: 'baroque' }), 'modern', 'unknown eras fall back');
});

// Two shops built wall to wall (they share the x = 14 wall column), one modern and one old.
function merged() {
    const m = createMap({ id: 'era-test', width: 34, depth: 20, seed: 3 });
    const modern = m.building({ id: 'modern', program: 'office', x0: 3, y0: 3, w: 12, d: 10, storeys: 1, front: 's', era: 'modern', rounded:true });
    const old = m.building({ id: 'old', program: 'office', x0: 14, y0: 3, w: 12, d: 10, storeys: 1, front: 's', era: 'old' });
    return { m, modern, old };
}
const inside = (b, x, y) => x >= b.x0 && y >= b.y0 && x < b.x0 + b.w && y < b.y0 + b.d;
/** True when a footprint polygon has any vertex off the straight band grid (a fillet or a curve). */
const curved = poly => !!poly && poly.some(([x, y]) => [x, y].some(v => ![0, 0.3, 0.7, 1].some(g => Math.abs(v - g) < 1e-9)));

test('the old building is straight-edged across its whole footprint; the modern one stays rounded', () => {
    const { m, modern, old } = merged(), st = m.store;
    assert.equal(old.era, 'old'); assert.equal(old.rounded, false); assert.equal(modern.era, 'modern'); assert.equal(modern.rounded, true);
    const straight = straightCells(st);
    for (let y = old.y0; y < old.y0 + old.d; y++) for (let x = old.x0; x < old.x0 + old.w; x++) assert.ok(straight(x, y), `old cell ${x},${y}`);
    for (let y = modern.y0; y < modern.y0 + modern.d; y++) for (let x = modern.x0; x < modern.x0 + modern.w; x++)
        assert.equal(straight(x, y), inside(old, x, y), `modern cell ${x},${y} is straight only where it is the shared wall`);
    // Every wall in the old building, outer and interior partitions alike, has a straight silhouette.
    const z = old.baseZ + 1;
    let oldWalls = 0, modernCurves = 0;
    for (let y = 0; y < st.depth; y++) for (let x = 0; x < st.width; x++) {
        if (!WALL_KEYS.has(materialById(st.get(x, y, z)).key)) continue;
        const poly = collisionFootprint(st, x, y, z);
        if (inside(old, x, y)) { oldWalls++; assert.ok(!curved(poly), `old wall ${x},${y} is straight`); }
        else if (inside(modern, x, y) && curved(poly)) modernCurves++;
    }
    assert.ok(oldWalls > 40, `old walls checked: ${oldWalls}`);
    assert.ok(modernCurves >= 2, 'the modern building keeps its rounded corners');
});

test('the merge seam belongs to the old building, and the edge style survives a snapshot', () => {
    const { m, old } = merged();
    for (let y = old.y0; y < old.y0 + old.d; y++) assert.ok(m.store.squareCorners.has(`14,${y}`));
    const copy = unpackMission(packMission({ store: m.store }));
    assert.deepEqual([...copy.store.squareCorners].sort(), [...m.store.squareCorners].sort());
});

test('marking is per footprint and only for old buildings', () => {
    const { m } = merged(), st = m.store, before = st.squareCorners.size;
    markBuildingEdges(st, { x0: 0, y0: 0, w: 2, d: 2 }, 'modern');
    assert.equal(st.squareCorners.size, before);
    markBuildingEdges(st, { x0: 0, y0: 0, w: 2, d: 2 }, 'old');
    assert.equal(st.squareCorners.size, before + 4);
    assert.ok(straightCells(st)(1, 1), 'the lookup grid follows the set');
});
