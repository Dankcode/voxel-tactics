import test from 'node:test';
import assert from 'node:assert/strict';
import { VoxelStore } from '../voxel/VoxelStore.js';
import { MAT } from '../voxel/Materials.js';
import { ElementField, combineSurface, elementStatusesFor } from './Elements.js';
import { createRng } from '../util/Rng.js';

function ground() {
    const s = new VoxelStore(16, 16, 8);
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) { s.set(x, y, 0, MAT.bedrock); s.set(x, y, 1, MAT.grass); }
    return s;
}

test('surface interactions match vibe-game PLAN 15A §7.5', () => {
    assert.equal(combineSurface('wet', 'burning'), null);
    assert.equal(combineSurface('frozen', 'burning'), 'wet');
    assert.equal(combineSurface('wet', 'frozen'), 'frozen');
    assert.equal(combineSurface(null, 'wet'), 'wet');
});

test('fire ignites timber, burns it down over rounds and water puts it out', () => {
    const s = ground(); const f = new ElementField(s);
    for (let x = 4; x < 8; x++) s.set(x, 4, 2, MAT.timber);
    f.applyArea('pyro', 5.5, 4.5, 2.5, 1.2);
    assert.ok(f.isBurning(5, 4, 2));
    const rng = createRng(1);
    let burned = 0;
    for (let r = 0; r < 6; r++) burned += f.tick(rng, { spreadChance: 1 }).burnedOut.length;
    assert.ok(burned >= 1, 'timber burned out');
    assert.ok(s.get(5, 4, 2) === MAT.ash || s.get(5, 4, 2) === 0);
    f.ignite(7, 4, 2);
    f.applyArea('hydro', 7.5, 4.5, 2.5, 1);
    assert.ok(!f.isBurning(7, 4, 2));
});

test('cold freezes water into walkable ice and heat melts it', () => {
    const s = ground(); const f = new ElementField(s);
    s.set(8, 8, 1, MAT.deep_water);
    assert.equal(s.surfaces(8, 8).length, 0);
    f.applyArea('cryo', 8.5, 8.5, 1.5, 1.2);
    assert.equal(s.get(8, 8, 1), MAT.deep_ice);
    assert.equal(s.surfaces(8, 8).length, 1, 'ice bridge is walkable');
    f.applyArea('pyro', 8.5, 8.5, 1.5, 1.2);
    assert.equal(s.get(8, 8, 1), MAT.deep_water, 'ice over deep water melts back into deep water');
    assert.equal(s.surfaces(8, 8).length, 0, 'and is impassable again');
    s.set(9, 8, 1, MAT.water);
    f.applyArea('cryo', 9.5, 8.5, 1.5, 0.6);
    assert.equal(s.get(9, 8, 1), MAT.ice);
    f.applyArea('pyro', 9.5, 8.5, 1.5, 0.6);
    assert.equal(s.get(9, 8, 1), MAT.water, 'shallow ice melts back into shallow water');
});

test('wind clears smoke and fans flames; statuses depend on wetness', () => {
    const s = ground(); const f = new ElementField(s);
    f.addSmoke(5, 5, 2, 2, 3);
    assert.ok(f.isSmoke(5, 5, 2));
    f.applyArea('anemo', 5.5, 5.5, 2.5, 3);
    assert.ok(!f.isSmoke(5, 5, 2));
    assert.deepEqual(elementStatusesFor('cryo', { statuses: [{ id: 'wet' }] }), ['frozen']);
    assert.deepEqual(elementStatusesFor('pyro', { statuses: [{ id: 'wet' }] }), []);
});
