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
