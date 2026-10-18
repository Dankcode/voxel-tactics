// PLAN-09: XCOM-style hit chance, chill/freeze, the enemy brain (intel, hiding, overwatch, gadgets), walker
// monsters and the playstyle cache that tunes the AI.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Battle } from './Battle.js';
import { VoxelStore } from '../voxel/VoxelStore.js';
import { MAT } from '../voxel/Materials.js';
import { addStatus, hasStatus } from './Units.js';
import { WEAPONS } from '../content/weapons.js';
import { B } from '../content/balance.js';
import { hitChance } from './HitChance.js';
import { decide, runAiSide } from './Ai.js';
import { enemyTile, enemyThreats, podRole } from './EnemyAi.js';
import { inWatchSector } from './WatchSector.js';
import { occupiedCells } from './Walker.js';
import { playstyleFromBattle, mergeProfile, aiTuningFrom, sanitizeAiProfile, adaptationNotes, DEFAULT_TUNING } from '../session/Playstyle.js';

function arena({ squad = ['grenadier', 'marksman'], players = [{ x: 10, y: 16, z: 1 }, { x: 11, y: 16, z: 1 }], enemies = [{ type: 'cultist', pos: { x: 10, y: 6, z: 1 }, group: 1, alerted: true }], build = null, aiProfile = null, seed = 7 } = {}) {
    const store = new VoxelStore(28, 28, 12);
    for (let y = 0; y < 28; y++) for (let x = 0; x < 28; x++) { store.set(x, y, 0, MAT.bedrock); store.set(x, y, 1, MAT.grass); }
    build?.(store);
    return new Battle({ mission: { id: 'enemy-ai-arena', store, rooms: [], buildings: [], spawns: { player: players, enemy: enemies } },
        squad: squad.map(type => ({ type })), seed, aiProfile });
}
const wall = (store, x0, y0, x1, y1, h = 3, mat = MAT.brick) => { for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) for (let z = 2; z < 2 + h; z++) store.set(x, y, z, mat); };

// ------------------------------------------------------------------------------------------------ hit chance
test('hit chance: cover, flanking crits, height and the overwatch penalty', () => {
    const open = arena(), s = open.unit('e0'), t = open.unit('p0'), w = WEAPONS.musket;
    const bare = hitChance(open, s, t, w);
    assert.ok(bare.flanked && bare.crit >= B.flankCrit, 'no cover: flanked, can crit');
    const half = arena({ build: st => wall(st, 9, 15, 12, 15, 1) }), full = arena({ build: st => wall(st, 9, 15, 12, 15, 3) });
    const h = hitChance(half, half.unit('e0'), half.unit('p0'), w), f = hitChance(full, full.unit('e0'), full.unit('p0'), w);
    assert.ok(h.chance < bare.chance && f.chance < h.chance, `${bare.chance} > ${h.chance} > ${f.chance}`);
    assert.equal(h.crit, 0); assert.ok(h.mods.some(([l]) => l.includes('half cover')));
    const ow = hitChance(open, s, t, w, { reaction: true });
    assert.equal(ow.chance, Math.round(bare.chance * B.overwatchAimMult));
    const up = hitChance(open, s, t, w, { from: { x: s.x, y: s.y, z: s.z + 3 } });
    assert.ok(up.chance > bare.chance && up.mods.some(([l]) => l === 'high ground'));
    addStatus(t, 'frozen');
    assert.ok(hitChance(open, s, t, w).chance >= bare.chance, 'frozen targets are easier');
});

test('NPC shots and overwatch roll the chance deterministically and report it', () => {
    const run = () => {
        const b = arena({ seed: 3 });
        b.apply({ type: 'endTurn', side: 'player' });
        const u = b.unit('e0');
        b.apply({ type: 'switchWeapon', unitId: u.id, weaponId: 'musket' });
        const r = b.apply({ type: 'shoot', unitId: u.id, weaponId: 'musket', aim: { unitId: 'p0', part: 'torso' } });
        assert.ok(r.ok, r.reason);
        return { b, shot: r.events.find(e => e.t === 'shot'), cut: r.events.find(e => e.t === 'cutin') };
    };
    const a = run(), c = run();
    assert.ok(Number.isInteger(a.shot.chance) && a.shot.chance > 0);
    assert.ok(a.shot.rolls.length >= 1);
    assert.equal(a.cut.chance, a.shot.chance, 'the cut-in shows the same chance');
    assert.equal(a.b.hash(), c.b.hash());
});

test('a 0 % roll misses wide and a 100 % roll lands on the target', async () => {
    const { BALANCE } = await import('../content/balance.js');
    const keep = { min: BALANCE.hitChanceMin.value, max: BALANCE.hitChanceMax.value };
    try {
        for (const [lo, hi, expectHit] of [[0, 0, false], [100, 100, true]]) {
            BALANCE.hitChanceMin.value = lo; BALANCE.hitChanceMax.value = hi;
            const b = arena({ seed: 11 });
            b.apply({ type: 'endTurn', side: 'player' });
            b.apply({ type: 'switchWeapon', unitId: 'e0', weaponId: 'musket' });
            const r = b.apply({ type: 'shoot', unitId: 'e0', weaponId: 'musket', aim: { unitId: 'p0', part: 'torso' } });
            const shot = r.events.find(e => e.t === 'shot');
            assert.equal(shot.projectiles.some(p => p.unitId === 'p0'), expectHit, `chance ${shot.chance}`);
        }
    } finally { BALANCE.hitChanceMin.value = keep.min; BALANCE.hitChanceMax.value = keep.max; }
});

// ----------------------------------------------------------------------------------------------- chill/freeze
test('cryo freezes only wet units; dry units are chilled and slowed without losing AP', () => {
    const b = arena(), u = b.unit('p0'), v = b.unit('p1');
    const base = b.mobility(u);
    b.explode({ x: u.x + 0.5, y: u.y + 0.5, h: u.z + 1.5, radius: 0.6, power: 0, damage: 0, element: 'cryo' });
    assert.ok(hasStatus(u, 'chilled') && !hasStatus(u, 'frozen'));
    assert.ok(b.mobility(u) < base && b.mobility(u) > 0, 'slowed, not rooted');
    b.startSide('player');
    assert.equal(u.ap, u.maxAp, 'chill no longer costs AP');
    addStatus(v, 'wet');
    b.explode({ x: v.x + 0.5, y: v.y + 0.5, h: v.z + 1.5, radius: 0.6, power: 0, damage: 0, element: 'cryo' });
    assert.ok(hasStatus(v, 'frozen'));
    assert.equal(b.mobility(v), 0);
});

// ------------------------------------------------------------------------------------------------ enemy brain
test('NPCs freeze a soaked squad member with cryo instead of shooting', () => {
    const b = arena({ enemies: [{ type: 'archer', pos: { x: 10, y: 8, z: 1 }, group: 1, alerted: true }] });
    b.apply({ type: 'endTurn', side: 'player' });
    addStatus(b.unit('p0'), 'wet');
    const intent = decide(b, b.unit('e0'));
    assert.equal(intent?.type, 'throw'); assert.equal(intent.itemId, 'frost_flask');
    assert.deepEqual([intent.to.x, intent.to.y], [10, 16]);
});

test('a pod with cryo soaks a dry, bunched squad first (water sets up the freeze)', () => {
    const b = arena({ enemies: [{ type: 'cultist', pos: { x: 10, y: 8, z: 1 }, group: 1, alerted: true }, { type: 'archer', pos: { x: 14, y: 6, z: 1 }, group: 1, alerted: true }] });
    b.apply({ type: 'endTurn', side: 'player' });
    const intent = decide(b, b.unit('e0'));
    assert.equal(intent?.type, 'throw'); assert.equal(intent.itemId, 'water_flask');
});

test('a wounded NPC breaks line of sight instead of trading shots in the open', () => {
    const b = arena({ build: st => wall(st, 1, 5, 8, 5, 4), enemies: [{ type: 'cultist', pos: { x: 9, y: 7, z: 1 }, group: 1, alerted: true }] });
    b.apply({ type: 'endTurn', side: 'player' });
    const u = b.unit('e0'); u.hp = 8; u.items = {};
    const intent = decide(b, u);
    assert.equal(intent?.type, 'move');
    const to = intent.to, chest = { x: to.x + 0.5, y: to.y + 0.5, h: to.z + 2.05 };
    assert.ok(b.unitsOf('player').every(p => !b.sightLine(b.eye(p), chest)), `hid at ${to.x},${to.y}`);
});

test('NPCs keep their walk and their tile out of a known overwatch cone', () => {
    const b = arena({ enemies: [{ type: 'cultist', pos: { x: 10, y: 4, z: 1 }, group: 1, alerted: true }] });
    const p = b.unit('p0');
    assert.ok(b.apply({ type: 'overwatch', unitId: p.id, weaponId: 'repeater', toward: { x: 10, y: 4 } }).ok);
    b.apply({ type: 'endTurn', side: 'player' });
    const u = b.unit('e0');
    const tile = enemyTile(b, u, WEAPONS.musket, enemyThreats(b, u), 3, { T: { ...DEFAULT_TUNING } });
    assert.ok(tile && !inWatchSector(p, p.overwatch, tile), `stayed out of the cone (${tile?.x},${tile?.y})`);
});

test('NPCs hunt from intel: no sightings and no noise means no omniscient charge toward hidden soldiers', () => {
    const b = arena({ build: st => wall(st, 0, 11, 27, 11, 6), enemies: [{ type: 'cultist', pos: { x: 10, y: 4, z: 1 }, group: 1, alerted: true }] });
    b.apply({ type: 'endTurn', side: 'player' });
    const u = b.unit('e0');
    assert.equal(enemyThreats(b, u).length, 0);
    b.enemyIntel.p0 = { x: 22, y: 6, z: 1, round: b.round, source: 'heard' };
    const t = enemyThreats(b, u);
    assert.equal(t.length, 1); assert.ok(t[0].ghost);
    const intent = decide(b, u);
    assert.equal(intent?.type, 'move');
    assert.ok(Math.hypot(intent.to.x - 22, intent.to.y - 6) < Math.hypot(u.x - 22, u.y - 6), 'moves on the last known position');
});

test('noise and sightings feed the enemy intel deterministically; searching the spot makes the lead go cold', () => {
    const b = arena({ build: st => wall(st, 0, 11, 27, 11, 6), enemies: [{ type: 'cultist', pos: { x: 10, y: 9, z: 1 }, group: 1, alerted: true }] });
    b.noise(10, 16, 1, 12, b.unit('p0'));
    assert.equal(b.enemyIntel.p0?.source, 'heard');
    const e = b.unit('e0'); e.x = 10; e.y = 15; e.z = 1; b.unit('p0').x = 3; b.unit('p0').y = 25;
    b.recordSightings();
    assert.ok(['lost', 'seen'].includes(b.enemyIntel.p0.source));
});

test('pods split into anchor, flanker and support roles', () => {
    const b = arena({ enemies: ['cultist', 'cultist', 'archer'].map((type, i) => ({ type, pos: { x: 8 + i * 2, y: 4, z: 1 }, group: 2, alerted: true })) });
    assert.deepEqual(['e0', 'e1', 'e2'].map(id => podRole(b, b.unit(id))), ['anchor', 'flanker', 'support']);
});

test('the enemy side plays whole turns with the new brain without errors', () => {
    const b = arena({ enemies: [
        { type: 'cultist', pos: { x: 6, y: 4, z: 1 }, group: 1, alerted: true }, { type: 'archer', pos: { x: 10, y: 3, z: 1 }, group: 1, alerted: true },
        { type: 'warden_foe', pos: { x: 14, y: 4, z: 1 }, group: 1, alerted: true }, { type: 'brute', pos: { x: 18, y: 5, z: 1 }, group: 2, alerted: true }] });
    for (let i = 0; i < 4 && !b.outcome; i++) {
        b.apply({ type: 'endTurn', side: 'player' });
        runAiSide(b, 'enemy');
        assert.equal(b.activeSide, b.outcome ? b.activeSide : 'player');
    }
});

// ---------------------------------------------------------------------------------------------- monsters
test('the four-legged walker is a melee monster: it claws soldiers in reach', () => {
    const b = arena({ players: [{ x: 10, y: 12, z: 1 }, { x: 20, y: 22, z: 1 }], enemies: [{ type: 'wall_strider', pos: { x: 10, y: 9, z: 1 }, group: 5, alerted: true }] });
    b.apply({ type: 'endTurn', side: 'player' });
    const m = b.unit('e0'), p = b.unit('p0');
    p.x = Math.max(...occupiedCells(m).map(c => c.x)) + 1; p.y = m.y;
    const intent = decide(b, m);
    assert.equal(intent?.type, 'melee'); assert.equal(intent.weaponId, 'strider_claws');
    const hp = p.hp, r = b.apply(intent);
    assert.ok(r.ok, r.reason); assert.ok(p.hp < hp);
});

test('walker monsters smash through a building wall toward their prey (blunt: no burn decal)', () => {
    const b = arena({ players: [{ x: 10, y: 20, z: 1 }, { x: 12, y: 20, z: 1 }],
        build: st => wall(st, 2, 14, 25, 14, 6), enemies: [{ type: 'wall_strider', pos: { x: 10, y: 11, z: 1 }, group: 5, alerted: true }] });
    b.apply({ type: 'endTurn', side: 'player' });
    const m = b.unit('e0');
    b.enemyIntel.p0 = { x: 10, y: 20, z: 1, round: b.round, source: 'heard' };
    const intent = decide(b, m);
    assert.equal(intent?.type, 'ability', JSON.stringify(intent)); assert.equal(intent.abilityId, 'smash');
    const before = b.stats.voxelsDestroyed, r = b.apply(intent);
    assert.ok(r.ok, r.reason);
    assert.ok(b.stats.voxelsDestroyed - before >= 8, `destroyed ${b.stats.voxelsDestroyed - before}`);
    assert.equal(b.store.scorch.size, 0, 'a smash leaves no scorch');
    assert.equal(b.store.get(10, 14, 2), 0, 'the wall at the impact is gone');
});

// --------------------------------------------------------------------------------------------- playstyle
test('the playstyle reads a flanking, overwatch-heavy match and the AI tunes against it', () => {
    const b = arena();
    const log = (e) => b.emit(e);
    for (let i = 0; i < 6; i++) log({ t: 'shot', unitId: 'p0', weaponId: 'repeater', projectiles: [], cover: 0, dist: 5 });
    for (let i = 0; i < 4; i++) log({ t: 'overwatch', unitId: 'p1' });
    log({ t: 'throw', unitId: 'p0', itemId: 'frost_flask' });
    const s = playstyleFromBattle(b);
    assert.ok(s.traits.flanking >= 0.9, JSON.stringify(s.traits));
    assert.ok(s.traits.overwatch >= 0.6 && s.traits.aggression >= 0.5);
    let p = null;
    for (let i = 0; i < 3; i++) p = mergeProfile(p, s, { outcome: 'victory', scenario: 'arena', at: `t${i}` });
    assert.equal(p.matches, 3); assert.equal(p.history.length, 3);
    assert.ok(p.tuning.flankGuard > 1.5 && p.tuning.overwatchCaution > 1.2, JSON.stringify(p.tuning));
    assert.ok(adaptationNotes(p).some(l => l.includes('flank')));
    // The tuning travels in the descriptor: same profile -> same AI -> same hash.
    const a1 = arena({ aiProfile: p }), a2 = arena({ aiProfile: JSON.parse(JSON.stringify(p)) });
    assert.deepEqual(a1.aiTuning, aiTuningFrom(p)); assert.equal(a1.hash(), a2.hash());
    assert.notEqual(a1.hash(), arena().hash());
    assert.deepEqual(aiTuningFrom(null), DEFAULT_TUNING);
    assert.equal(sanitizeAiProfile({ traits: 'x' }), null);
    assert.equal(sanitizeAiProfile({ traits: { flanking: 7 }, matches: -3 }).traits.flanking, 1);
});

// ---------------------------------------------------------------------------------------------- PLAN-10 pursuit
const far = (extra = {}) => arena({ squad: ['grenadier', 'marksman', 'vanguard', 'warden'],
    players: [{ x: 22, y: 25, z: 1 }, { x: 23, y: 25, z: 1 }, { x: 24, y: 25, z: 1 }, { x: 25, y: 25, z: 1 }],
    enemies: [{ type: 'cultist', pos: { x: 2, y: 2, z: 1 }, group: 1, alerted: true }], ...extra });
const seenAll = b => { for (const p of b.unitsOf('player')) b.enemyIntel[p.id] = { x: p.x, y: p.y, z: p.z, round: b.round, source: 'seen' }; };

test('PLAN-10: with no worthwhile shot an NPC dashes, spending its whole turn closing in', () => {
    const b = far(); b.apply({ type: 'endTurn', side: 'player' }); seenAll(b);
    const u = b.unit('e0'), d0 = Math.min(...b.unitsOf('player').map(p => Math.hypot(p.x - u.x, p.y - u.y)));
    for (let k = 0; k < 6; k++) { const i = decide(b, u); if (!i) break; assert.ok(b.apply(i).ok); }
    const d1 = Math.min(...b.unitsOf('player').map(p => Math.hypot(p.x - u.x, p.y - u.y)));
    assert.ok(d0 - d1 >= 6, `closed ${d0.toFixed(1)} -> ${d1.toFixed(1)}`);
    assert.ok(u.ap + u.moveOnlyAp < 1, 'the whole turn went into the dash');
});

test('PLAN-10: a healthy pod facing a bigger squad presses on over three turns; a wounded one still hides', () => {
    const b = far(); seenAll(b);
    const u = b.unit('e0'), dist = () => Math.min(...b.unitsOf('player').map(p => Math.hypot(p.x - u.x, p.y - u.y)));
    const d0 = dist();
    for (let t = 0; t < 3 && !b.outcome; t++) { b.apply({ type: 'endTurn', side: 'player' }); seenAll(b); runAiSide(b, 'enemy'); }
    assert.ok(dist() <= d0 * 0.5, `closed to ${dist().toFixed(1)} of ${d0.toFixed(1)}`);
});

test('PLAN-10: unalerted pods patrol around their post, deterministically, and policy.patrol=false keeps them still', () => {
    const make = () => arena({ build: st => wall(st, 0, 12, 27, 12, 6), enemies: [{ type: 'cultist', pos: { x: 10, y: 5, z: 1 }, group: 1 }, { type: 'cultist', pos: { x: 12, y: 5, z: 1 }, group: 1 }] });
    const a = make(), c = make();
    a.apply({ type: 'endTurn', side: 'player' }); c.apply({ type: 'endTurn', side: 'player' });
    const i = decide(a, a.unit('e0'));
    assert.equal(i?.type, 'move');
    assert.ok(Math.hypot(i.to.x - 10, i.to.y - 5) <= B.aiPatrolRadius + 0.01, 'stays near its post');
    assert.deepEqual(decide(c, c.unit('e0')), i, 'same seed, same patrol');
    assert.equal(decide(a, a.unit('e0'), { patrol: false }), null);
    assert.ok(!a.unit('e0').alerted);
});

test('PLAN-10: a soldier against a full-cover corner sees and shoots past it from the step-out tile', () => {
    const b = arena({ build: st => wall(st, 5, 0, 5, 9, 3), players: [{ x: 4, y: 9, z: 1 }, { x: 1, y: 20, z: 1 }],
        enemies: [{ type: 'cultist', pos: { x: 16, y: 10, z: 1 }, group: 1, alerted: true }] });
    const p = b.unit('p0'), e = b.unit('e0');
    assert.equal(b.sightLine(b.eye(p), b.chest(e)), false, 'the wall blocks the straight line');
    assert.ok(b.peekEyes(p, e).length, 'tucked into full cover: may step out');
    assert.ok(b.sees(p, e), 'sees round the corner');
    const r = b.apply({ type: 'shoot', unitId: p.id, weaponId: p.weapon, aim: { unitId: e.id, part: 'torso' } });
    assert.ok(r.ok, r.reason);
    const shot = r.events.find(x => x.t === 'shot');
    assert.ok(shot.muzzle.step || shot.muzzle.lean, 'fired leaning or stepping out past the corner');
    assert.deepEqual([p.x, p.y], [4, 9], 'and stepped back');
    // In the open there is no peeking.
    const open = arena({ players: [{ x: 4, y: 9, z: 1 }, { x: 1, y: 20, z: 1 }] });
    assert.deepEqual(open.peekEyes(open.unit('p0'), open.unit('e0')), []);
});

test('PLAN-10: free aim lands on what the crosshair line meets, so leaning out never throws the shot off by depth', async () => {
    const { resolveAimPoint, partCentre, aimedUnit } = await import('./Ballistics.js');
    const b = arena({ players: [{ x: 10, y: 20, z: 1 }, { x: 1, y: 26, z: 1 }], enemies: [{ type: 'cultist', pos: { x: 10, y: 5, z: 1 }, group: 1, alerted: true }] });
    const p = b.unit('p0'), e = b.unit('e0'), c = partCentre(e, 'torso');
    const lean = { x: p.x + 0.5 + 0.55, y: p.y + 0.5, h: p.z + 2.35 };                 // leaning right out of cover
    const dir = [c.x - lean.x, c.y - lean.y, c.h - lean.h], L = Math.hypot(...dir);
    const near = { x: lean.x + dir[0] / L * 5, y: lean.y + dir[1] / L * 5, h: lean.h + dir[2] / L * 5 };   // reticle on him, point 5 m out
    const r = resolveAimPoint(b, p, lean, near, 60);
    assert.ok(Math.hypot(r.x - c.x, r.y - c.y) < 0.8, `resolved onto the target (${r.x.toFixed(2)},${r.y.toFixed(2)})`);
    const cross = ((r.x - lean.x) * dir[1] - (r.y - lean.y) * dir[0]) / L;
    assert.ok(Math.abs(cross) < 0.05, `stays on the crosshair line (off by ${cross.toFixed(3)} m)`);
    assert.equal(aimedUnit(b, p, r)?.id, 'e0', 'point shots on a body use that target\'s modifiers');
});

test('PLAN-11: the free-aim reticle sticks to a nearby enemy body part, never through a wall', async () => {
    const { stickyAim, partCentre } = await import('./Ballistics.js');
    const b = arena({ players: [{ x: 10, y: 20, z: 1 }, { x: 1, y: 26, z: 1 }], enemies: [{ type: 'cultist', pos: { x: 10, y: 8, z: 1 }, group: 1, alerted: true }] });
    const p = b.unit('p0'), e = b.unit('e0'), o = { x: p.x + 0.5, y: p.y + 0.5, h: p.z + 2.35 }, c = partCentre(e, 'torso');
    const near = { x: c.x + 0.45, y: c.y + 0.3, h: c.h + 0.1 };                         // just beside him
    assert.equal(stickyAim(b, p, o, near)?.unit.id, 'e0');
    assert.equal(stickyAim(b, p, o, { x: c.x + 4, y: c.y, h: c.h }), null, 'far off: free aim');
    const walled = arena({ build: st => wall(st, 6, 12, 14, 12, 4), players: [{ x: 10, y: 20, z: 1 }, { x: 1, y: 26, z: 1 }], enemies: [{ type: 'cultist', pos: { x: 10, y: 8, z: 1 }, group: 1, alerted: true }] });
    assert.equal(stickyAim(walled, walled.unit('p0'), o, near), null, 'no magnet through a wall');
});
