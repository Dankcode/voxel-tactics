// PLAN-15: peek while aiming (shot from the peek tile, exposed, back home), lighter armour with a damage floor.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Battle } from './Battle.js';
import { VoxelStore } from '../voxel/VoxelStore.js';
import { MAT } from '../voxel/Materials.js';
import { peekCells, isPeekCell, peekExposure } from './Peek.js';
import { B } from '../content/balance.js';
import { ARMOR } from '../content/weapons.js';
import { STATUS_DEFS } from '../elements/Elements.js';

function arena({ squad = ['grenadier'], players = [{ x: 10, y: 20, z: 1 }], enemies = [], seed = 5, build = null } = {}) {
    const store = new VoxelStore(40, 40, 10);
    for (let y = 0; y < 40; y++) for (let x = 0; x < 40; x++) { store.set(x, y, 0, MAT.bedrock); store.set(x, y, 1, MAT.grass); }
    build?.(store);
    return new Battle({ mission: { id: 'plan15-arena', store, rooms: [], buildings: [], spawns: { player: players, enemy: enemies } }, squad: squad.map(type => ({ type })), seed });
}
const wall = (s, cells) => { for (const [x, y] of cells) for (let h = 2; h <= 4; h++) s.set(x, y, h, MAT.concrete); };

test('peek cells: own tile first, same storey, range-limited, never through walls, doors or other units', () => {
    const b = arena({ build: s => wall(s, [[11, 19], [11, 20], [11, 21]]), squad: ['grenadier', 'marksman'], players: [{ x: 10, y: 20, z: 1 }, { x: 10, y: 21, z: 1 }] });
    const u = b.unit('p0');
    const cells = peekCells(b, u, 1);
    assert.deepEqual(cells[0], { x: 10, y: 20, z: 1 });
    assert.ok(cells.every(c => Math.max(Math.abs(c.x - 10), Math.abs(c.y - 20)) <= 1 && c.z === 1));
    assert.ok(!cells.some(c => c.x === 11), 'the wall column is not standable');
    assert.ok(!cells.some(c => c.x === 10 && c.y === 21), 'a squadmate holds that tile');
    assert.ok(cells.some(c => c.x === 10 && c.y === 19));
    assert.ok(peekCells(b, u, 2).length > cells.length, 'range 2 reaches further');
    assert.deepEqual(peekCells(b, u, 0), [{ x: 10, y: 20, z: 1 }], 'range 0 disables peeking');
    assert.equal(isPeekCell(b, u, { x: 12, y: 20, z: 1 }, 1), false, 'beyond the wall');
});

test('a peek shot leaves from the peek tile, is validated, and the soldier steps back home', () => {
    const b = arena({ enemies: [{ type: 'cultist', pos: { x: 22, y: 20, z: 1 }, group: 0, alerted: true }] });
    const u = b.unit('p0'), e = b.unit('e0');
    b.visible = b.visibleTo('player');
    const aim = { point: { x: e.x + 0.5, y: e.y + 0.5, h: e.z + 2 } };
    assert.equal(b.validate({ type: 'shoot', unitId: u.id, weaponId: u.weapon, aim, from: { x: 13, y: 20, z: 1 } }), 'bad_intent', 'three tiles is not a peek');
    const r = b.apply({ type: 'shoot', unitId: u.id, weaponId: u.weapon, aim, from: { x: 10, y: 19, z: 1 } });
    assert.ok(r.ok, r.reason);
    const peek = r.events.find(ev => ev.t === 'peek'), back = r.events.find(ev => ev.t === 'peekBack'), cut = r.events.find(ev => ev.t === 'cutin');
    assert.deepEqual(peek.to, { x: 10, y: 19, z: 1 });
    assert.ok(Math.abs(cut.muzzle.y - 19.5) < 0.7, 'the muzzle is on the peek tile');
    assert.ok(back && u.x === 10 && u.y === 20, 'back home');
});

test('peeking into a known overwatch draws its reaction fire on the peek tile; staying home does not', () => {
    const run = from => {
        const b = arena({ enemies: [{ type: 'cultist', pos: { x: 22, y: 20, z: 1 }, group: 0, alerted: true }], build: s => { for (let h = 2; h <= 4; h++) s.set(11, 20, h, MAT.concrete); } });
        const u = b.unit('p0'), w = b.unit('e0');
        b.activeSide = 'enemy';
        const ow = b.apply({ type: 'overwatch', unitId: w.id, weaponId: w.weapon, toward: { x: 10, y: 20 } });
        assert.ok(ow.ok, ow.reason);
        b.activeSide = 'player'; b.visible = b.visibleTo('player');
        const r = b.apply({ type: 'shoot', unitId: u.id, weaponId: u.weapon, aim: { point: { x: 22.5, y: 20.5, h: 3 } }, ...(from ? { from } : {}) });
        assert.ok(r.ok, r.reason);
        return r.events;
    };
    assert.ok(run({ x: 10, y: 19, z: 1 }).some(e => e.t === 'reaction'), 'leaning out past the wall is seen by the overwatch');
    assert.ok(!run(null).some(e => e.t === 'reaction'), 'firing from home draws no reaction');
});

test('peek exposure reports the peek tile cover against known hostiles', () => {
    const b = arena({ enemies: [{ type: 'cultist', pos: { x: 22, y: 20, z: 1 }, group: 0, alerted: true }], build: s => { for (let h = 2; h <= 4; h++) s.set(11, 20, h, MAT.concrete); } });
    const u = b.unit('p0');
    assert.equal(peekExposure(b, u, { x: 10, y: 20, z: 1 }).label, 'FULL COVER');
    assert.equal(peekExposure(b, u, { x: 10, y: 19, z: 1 }).label, 'EXPOSED');
});

test('armour reduces each projectile but never cancels it; plate and brace are lighter', () => {
    assert.ok(ARMOR.plate.torso <= 3 && ARMOR.heavy.torso <= 2, 'lighter table');
    assert.ok(STATUS_DEFS.braced.armorBonus <= 2);
    const b = arena({ enemies: [{ type: 'warden_foe', pos: { x: 30, y: 20, z: 1 }, group: 0 }] });
    const g = b.unit('e0');
    g.statuses.push({ id: 'braced', rounds: 1 });
    const torso = g.parts.torso.armor;
    assert.ok(torso <= 3);
    const dmg556 = b.dealDamage(g, 'torso', 10, { pierce: 2 });
    assert.ok(dmg556 >= 5, `a 5.56 round through braced plate does ${dmg556}`);
    const pellet = b.dealDamage(g, 'torso', 3.75, { pierce: 0 });
    assert.ok(pellet >= Math.ceil(4 * B.armorMinDamage) && pellet > 0, 'a buckshot pellet still hurts');
});

test('grenade preview: detonates where the arc is blocked, same damage the blast deals, tiles behind walls excluded', () => {
    const b = arena({ squad: ['grenadier'], enemies: [{ type: 'cultist', pos: { x: 16, y: 20, z: 1 }, group: 0 }],
        build: s => { for (let y = 15; y <= 25; y++) for (let h = 2; h <= 8; h++) s.set(13, y, h, MAT.concrete); } });
    const u = b.unit('p0');
    u.items.powder_bomb = 2;
    const blocked = b.throwPreview(u, 'powder_bomb', { x: 16, y: 20, z: 1 });
    assert.ok(blocked.blocked, 'a 7-high wall stops the arc');
    assert.ok(blocked.centre.x < 14, 'the preview detonates at the wall, not on the target');
    // Open ground: preview damage equals what the blast deals with no scatter.
    const b2 = arena({ enemies: [{ type: 'cultist', pos: { x: 16, y: 20, z: 1 }, group: 0 }, { type: 'cultist', pos: { x: 17, y: 21, z: 1 }, group: 0 }],
        build: s => { for (let h = 2; h <= 3; h++) s.set(17, 19, h, MAT.concrete); } });
    const g = b2.unit('p0'); g.items.powder_bomb = 1;
    const pv = b2.throwPreview(g, 'powder_bomb', { x: 16, y: 20, z: 1 });
    assert.ok(!pv.blocked && pv.cells.length > 5);
    assert.ok(!pv.cells.some(c => c.x === 17 && c.y === 19), 'the wall tile is not a floor tile in the blast');
    const e0 = b2.unit('e0'), before = e0.hp, expect = pv.units.find(x => x.id === 'e0').dmg;
    b2.blastUnits({ ...pv.centre, radius: pv.radius, damage: 14 }, g.id);
    assert.equal(before - e0.hp, expect);
});

test('a pod agrees on one focus and roles; the support acts first; every enemy intent says why', async () => {
    const { podPlan } = await import('./PodPlanner.js');
    const { decide, aiOrder } = await import('./Ai.js');
    const b = arena({ squad: ['grenadier', 'marksman'], players: [{ x: 10, y: 20, z: 1 }, { x: 10, y: 24, z: 1 }],
        enemies: [{ type: 'cultist', pos: { x: 19, y: 19, z: 1 }, group: 0, alerted: true }, { type: 'warden_foe', pos: { x: 20, y: 22, z: 1 }, group: 0, alerted: true }, { type: 'archer', pos: { x: 19, y: 26, z: 1 }, group: 0, alerted: true }] });
    b.unit('p1').hp = 12;
    b.updateVisibility?.();
    b.activeSide = 'enemy';
    const plan = podPlan(b, 0);
    assert.ok(plan.focusId, 'a focus is chosen');
    assert.equal(podPlan(b, 0), plan, 'cached for the round');
    const roles = Object.values(plan.roles);
    assert.ok(roles.includes('support') && roles.includes('flanker'), roles.join());
    const order = aiOrder(b, 'enemy').map(u => plan.roles[u.id]);
    assert.equal(order[0], 'support');
    for (const u of b.unitsOf('enemy')) { const i = decide(b, u); if (i) assert.ok(i.why, `${u.id} ${i.type} has a reason`); }
});
