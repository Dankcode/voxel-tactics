// PLAN-14: sound draws searchers, drone techs and their one-hit search drones, Recon Scan, faster movement with gear.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Battle } from './Battle.js';
import { VoxelStore } from '../voxel/VoxelStore.js';
import { MAT } from '../voxel/Materials.js';
import { decide, runAiSide } from './Ai.js';
import { rayUnit, partCentre } from './Ballistics.js';
import { B } from '../content/balance.js';
import { GEAR } from '../content/gear.js';
import { gearMove, loadPenalty } from '../inventory/Equipment.js';
import { ABILITIES, ENEMIES } from '../content/units.js';

function arena({ squad = ['grenadier'], players = [{ x: 3, y: 20, z: 1 }], enemies = [], seed = 3 } = {}) {
    const store = new VoxelStore(40, 40, 10);
    for (let y = 0; y < 40; y++) for (let x = 0; x < 40; x++) { store.set(x, y, 0, MAT.bedrock); store.set(x, y, 1, MAT.grass); }
    return new Battle({ mission: { id: 'plan14-arena', store, rooms: [], buildings: [], spawns: { player: players, enemy: enemies } }, squad: squad.map(type => ({ type })), seed });
}

test('a loud sound sends pods that heard it to search the source; a quiet one only reaches close by', () => {
    const b = arena({ enemies: [{ type: 'cultist', pos: { x: 34, y: 20, z: 1 }, group: 0 }, { type: 'cultist', pos: { x: 35, y: 21, z: 1 }, group: 0 }] });
    const p = b.unit('p0'), [e0, e1] = [b.unit('e0'), b.unit('e1')];
    p.god = true;   // PLAN-15: lighter armour — this test is about the search, not whether a lone soldier survives it
    b.noise(20, 20, 1, 4, p);                       // footsteps-quiet, 14 tiles away
    assert.equal(e0.investigate ?? null, null);
    b.noise(20, 20, 1, 12, p);                      // a gunshot: heard out to 21 tiles, alerts within 12
    assert.ok(e0.investigate && e1.investigate, 'the whole pod heard it');
    assert.equal(e0.alerted, false, 'too far to be alerted, close enough to come and look');
    assert.ok(b.log.some(e => e.t === 'heard' && e.unitIds.includes('e0')));
    // Unalerted, it walks toward the sound instead of patrolling round its post.
    const before = Math.hypot(e0.x - 20, e0.y - 20);
    b.apply({ type: 'endTurn', side: 'player' });
    runAiSide(b, 'enemy');
    assert.ok(Math.hypot(e0.x - 20, e0.y - 20) < before - 2, 'moved toward the source');
    // Reaching it marks the point swept; it goes cold after a few rounds.
    for (let i = 0; i < 6 && !e0.investigate?.reached; i++) { b.apply({ type: 'endTurn', side: 'player' }); runAiSide(b, 'enemy'); }
    for (let i = 0; i < 4; i++) { b.apply({ type: 'endTurn', side: 'player' }); runAiSide(b, 'enemy'); }
    assert.equal(e0.investigate, null, 'the search is dropped');
});

test('a drone tech launches search drones (two at most); a drone is destroyed by any hit and does not hold the map', () => {
    assert.equal(ENEMIES.search_drone.hp, 1);
    const b = arena({ enemies: [{ type: 'tech', pos: { x: 30, y: 20, z: 1 }, group: 0 }] });
    const tech = b.unit('e0');
    b.apply({ type: 'endTurn', side: 'player' });
    runAiSide(b, 'enemy');
    const drones = () => b.units.filter(u => u.drone && !u.dead);
    assert.equal(drones().length, 1, 'one drone up');
    assert.equal(drones()[0].techId, tech.id);
    for (let i = 0; i < 6; i++) { b.apply({ type: 'endTurn', side: 'player' }); runAiSide(b, 'enemy'); }
    assert.equal(drones().length, 2, 'never more than two');
    const d = drones()[0];
    assert.ok(Object.values(d.parts).every(p => p.armor === 0));
    // Its body is a small target at chest height on its tile.
    const c = partCentre(d, 'head');
    assert.ok(rayUnit({ x: c.x - 5, y: c.y, h: c.h }, [1, 0, 0], d, 10), 'a ray through the body hits');
    assert.equal(rayUnit({ x: c.x - 5, y: c.y, h: c.h + 0.45 }, [1, 0, 0], d, 10), null, 'over it misses');
    assert.equal(rayUnit({ x: c.x - 5, y: c.y, h: d.z + 1.3 }, [1, 0, 0], d, 10), null, 'under it (chest height) misses');
    b.dealDamage(d, 'torso', 4, { source: 'p0' });
    assert.ok(d.dead, 'one hit');
    // Drones do not count toward eliminating the enemy.
    for (const u of b.units.filter(u => u.side === 'enemy' && !u.drone)) b.kill(u, 'p0');
    assert.equal(b.outcome?.winner, 'player');
});

test('a drone that sees the squad relays it: pods within 14 tiles are alerted', () => {
    const b = arena({ enemies: [{ type: 'search_drone', pos: { x: 8, y: 20, z: 1 }, group: 0 }, { type: 'cultist', pos: { x: 18, y: 30, z: 1 }, group: 1 }] });
    b.updateVisibility();
    assert.equal(b.unit('e1').alerted, true);
});

test('Recon Scan: approximate circles around every hostile in range, shared squad cooldown', () => {
    const b = arena({ squad: ['grenadier', 'marksman'], players: [{ x: 3, y: 20, z: 1 }, { x: 3, y: 22, z: 1 }], enemies: [{ type: 'cultist', pos: { x: 29, y: 20, z: 1 }, group: 0 }, { type: 'cultist', pos: { x: 39, y: 39, z: 1 }, group: 1 }] });
    const a = ABILITIES.recon_scan;
    assert.equal(b.apply({ type: 'ability', unitId: 'p0', abilityId: 'recon_scan' }).ok, true);
    const ev = b.log.find(e => e.t === 'scan');
    assert.equal(ev.contacts.length, 1, 'only the hostile within range');
    const [c] = ev.contacts;
    assert.ok(Math.hypot(c.x - 29, c.y - 20) <= a.radius, 'the real tile is inside the circle');
    assert.equal(c.r, a.radius);
    assert.equal(b.apply({ type: 'ability', unitId: 'p1', abilityId: 'recon_scan' }).reason, 'support_cooldown', 'shared cooldown');
    assert.equal(b.unit('e0').alerted, false, 'scanning is silent');
});

test('faster soldiers: tiles per AP scale with B.moveScale, light kit adds and heavy kit takes away', () => {
    const b = arena(), u = b.unit('p0');
    const base = b.mobility(u);
    assert.ok(B.moveScale > 1);
    assert.ok(Math.abs(base - (u.mobility + gearMove(u)) * B.moveScale * (1 - loadPenalty(u))) < 1e-9, `${base} tiles per AP`);
    u.equipment.rig = 'rig_scout'; u.equipment.backpack = 'pack_recon';
    assert.ok(b.mobility(u) > base, 'scout rig + recon pack');
    u.equipment.rig = 'rig_assault'; u.equipment.backpack = 'pack_raid'; u.equipment.helmet = 'helmet_heavy';
    assert.ok(b.mobility(u) < base, 'assault rig + raid pack + heavy helmet');
    assert.ok(GEAR.rig_scout.move > 0 && GEAR.pack_raid.move < 0);
});
