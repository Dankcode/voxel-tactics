// FlushAi: enemies break the cover a dug-in squad member hides behind instead of trading bad shots or idling.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Battle } from './Battle.js';
import { VoxelStore } from '../voxel/VoxelStore.js';
import { MAT, AIR } from '../voxel/Materials.js';
import { WEAPONS } from '../content/weapons.js';
import { coverAgainst, COVER } from '../voxel/Cover.js';
import { decideEnemy, enemyThreats } from './EnemyAi.js';
import { flushShot, coverVoxels, blastCoverValue, FLUSH } from './FlushAi.js';
import { hitChance } from './HitChance.js';

function arena({ build = null, players = [{ x: 10, y: 16, z: 1 }], enemies = [{ type: 'cultist', pos: { x: 10, y: 8, z: 1 }, group: 1, alerted: true }], squad = ['marksman'] } = {}) {
    const store = new VoxelStore(28, 28, 12);
    for (let y = 0; y < 28; y++) for (let x = 0; x < 28; x++) { store.set(x, y, 0, MAT.bedrock); store.set(x, y, 1, MAT.grass); }
    build?.(store);
    return new Battle({ mission: { id: 'flush-arena', store, rooms: [], buildings: [], spawns: { player: players, enemy: enemies } }, squad: squad.map(type => ({ type })), seed: 3 });
}
// A two-high brick wall right in front of the squad member (north face, toward the enemy): full cover.
const wallFront = (h = 2, mat = MAT.brick) => s => { for (let x = 9; x <= 11; x++) for (let z = 2; z < 2 + h; z++) s.set(x, 15, z, mat); };
const gunOf = u => u.weapons.map(id => WEAPONS[id]).find(w => w?.kind === 'ballistic');
// the enemies' turn, with the squad member in view (the arena has no sight blockers but the wall itself)
const seeAll = b => { b.activeSide = 'enemy'; b.visibleTo = side => new Set(b.units.filter(o => o.side !== side).map(o => o.id)); b.sees = () => true; };

test('flush: cover voxels are the target-facing face at knee and chest height', () => {
    const b = arena({ build: wallFront() }), p = b.unit('p0'), e = b.units.find(u => u.side === 'enemy');
    const v = coverVoxels(b.store, p, e);
    assert.deepEqual(v.map(q => [q.x, q.y, q.z]).sort(), [[10, 15, 2], [10, 15, 3]]);
    assert.ok(v.every(q => q.breakable && q.key === 'brick'));
});

test('flush: with no good shot on a dug-in target the enemy shoots the cover (fallback instead of overwatch)', () => {
    const b = arena({ build: wallFront() }), e = b.units.find(u => u.side === 'enemy'), p = b.unit('p0'), w = gunOf(e);
    seeAll(b);
    assert.equal(coverAgainst(b.store, p.x, p.y, p.z, e.x, e.y, e.z), COVER.FULL);
    assert.ok(hitChance(b, e, p, w).chance < FLUSH.chanceBelow);
    const f = flushShot(b, e, w, enemyThreats(b, e));
    assert.ok(f, 'a cover-breaking shot exists');
    assert.deepEqual([f.intent.flush.voxel.x, f.intent.flush.voxel.y], [10, 15]);
    assert.equal(b.validate(f.intent), null);
    // pinned in place (already moved, AP for one shot): the fallback picks the flush over overwatch
    e.movedThisTurn = true; e.moveOnlyAp = 0; e.ap = b.shotAp(e, w);
    const intent = decideEnemy(b, e);
    assert.equal(intent?.type, 'shoot'); assert.ok(intent.flush, JSON.stringify(intent));
});

test('flush: never instead of a good shot on an exposed target', () => {
    const b = arena(), e = b.units.find(u => u.side === 'enemy'), w = gunOf(e);
    seeAll(b);
    assert.equal(flushShot(b, e, w, enemyThreats(b, e)), null);
});

test('flush: applying it breaks the cover (real ballistics, no special rule)', () => {
    const b = arena({ build: wallFront(2, MAT.bin) }), e = b.units.find(u => u.side === 'enemy'), w = gunOf(e);
    seeAll(b);
    const before = [2, 3].filter(z => b.store.get(10, 15, z) !== AIR).length;
    let broke = false;
    for (let i = 0; i < 4 && !broke; i++) {
        e.ap = 4; e.movedThisTurn = true; e.moveOnlyAp = 0;
        const f = flushShot(b, e, w, enemyThreats(b, e)); if (!f) break;
        const r = b.apply(f.intent); assert.ok(r.ok, JSON.stringify(r));
        broke = [2, 3].filter(z => b.store.get(10, 15, z) !== AIR).length < before;
    }
    assert.ok(broke, 'the bins in front of the squad member are gone');
});

test('flush: a frag blast over breakable cover counts the cover it removes', () => {
    const b = arena({ build: wallFront() }), e = b.units.find(u => u.side === 'enemy'), p = b.unit('p0');
    assert.ok(blastCoverValue(b.store, p, 2.6, 8, [p], e) >= 2);
    assert.equal(blastCoverValue(b.store, { x: 20, y: 20 }, 2.6, 8, [p], e), 0);
});
