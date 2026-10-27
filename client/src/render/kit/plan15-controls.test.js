// PLAN-15 controls: one tool at a time, auto end turn, WASD peek stepping, settings migration, shotgun reticle.
import test from 'node:test';
import assert from 'node:assert/strict';
import { toolTeardown, autoEndReady, peekStep, migrateSettings } from '../../ui/ToolState.js';
import { Battle } from '../../../../shared/battle/Battle.js';
import { VoxelStore } from '../../../../shared/voxel/VoxelStore.js';
import { MAT } from '../../../../shared/voxel/Materials.js';
import { aimFriction, partUnderRay, partCentre } from '../../../../shared/battle/Ballistics.js';

function arena({ players = [{ x: 10, y: 20, z: 1 }], squad = ['grenadier'], enemies = [] } = {}) {
    const store = new VoxelStore(40, 40, 10);
    for (let y = 0; y < 40; y++) for (let x = 0; x < 40; x++) { store.set(x, y, 0, MAT.bedrock); store.set(x, y, 1, MAT.grass); }
    return new Battle({ mission: { id: 'p15c', store, rooms: [], buildings: [], spawns: { player: players, enemy: enemies } }, squad: squad.map(type => ({ type })), seed: 2 });
}

test('switching tools tears the previous one down: panels close, aim lock released, peek reset', () => {
    const t = toolTeardown({ kind: 'shoot' }, { kind: 'move' }, { panelOpen: true, locked: true });
    assert.deepEqual([t.closePanel, t.releaseLock, t.endAimCamera, t.resetPeek], [true, true, true, true]);
    assert.equal(toolTeardown({ kind: 'move' }, { kind: 'shoot' }, { panelOpen: true, locked: false }).closePanel, true, 'aiming closes the gear panel');
    assert.equal(toolTeardown({ kind: 'shoot' }, { kind: 'shoot' }, { locked: true }).releaseLock, false, 'staying in aim keeps the mouse');
    assert.equal(toolTeardown({ kind: 'move' }, { kind: 'breach', keepPanel: true }, { panelOpen: true }).closePanel, false);
});

test('auto end turn waits until nobody can act (AP and move-only AP spent, or on overwatch)', () => {
    const b = arena({ squad: ['grenadier', 'marksman'], players: [{ x: 5, y: 5, z: 1 }, { x: 7, y: 5, z: 1 }] });
    const [a, c] = b.unitsOf('player');
    assert.equal(autoEndReady(b), false);
    a.ap = 0; a.moveOnlyAp = 0;
    assert.equal(autoEndReady(b), false, 'one soldier still has AP');
    c.ap = 0; c.moveOnlyAp = 2;
    assert.equal(autoEndReady(b), false, 'move-only AP still counts');
    c.moveOnlyAp = 0;
    assert.equal(autoEndReady(b), true);
    c.ap = 2; c.overwatch = { weaponId: c.weapon };
    assert.equal(autoEndReady(b), true, 'a soldier on overwatch is done');
    assert.equal(autoEndReady(b, u => u.id !== a.id && u.id !== c.id), false, 'nobody of mine to end for');
});

test('WASD peek steps are camera-relative and stay inside the peek cells', () => {
    const b = arena();
    const u = b.unit('p0'), home = { x: u.x, y: u.y, z: u.z };
    const north = { x: 0, y: -1 };                 // camera looking north (grid y decreases)
    assert.deepEqual(peekStep(b, u, home, 'd', north), { x: 11, y: 20, z: 1 }, 'D = screen right = east');
    assert.deepEqual(peekStep(b, u, home, 'w', north), { x: 10, y: 19, z: 1 });
    assert.deepEqual(peekStep(b, u, home, 'd', { x: 1, y: 0 }), { x: 10, y: 21, z: 1 }, 'looking east, right is south');
    assert.equal(peekStep(b, u, { x: 11, y: 20, z: 1 }, 'd', north), undefined, 'range 1: no second step');
    assert.deepEqual(peekStep(b, u, { x: 11, y: 20, z: 1 }, 'a', north), home, 'back home');
});

test('settings migrate once: auto end turn on, aim assist light (or off if it was off)', () => {
    const mem = { v: null, setItem(k, v) { this.v = v; } };
    const m = migrateSettings({ autoEndTurn: false, soundVolume: 0.2 }, mem);
    assert.equal(m.autoEndTurn, true); assert.equal(m.aimAssist, 'light'); assert.equal(m.soundVolume, 0.2); assert.ok(mem.v);
    assert.equal(migrateSettings({ aimAssist: false }, mem).aimAssist, 'off');
    const later = migrateSettings({ ...m, autoEndTurn: false }, mem);
    assert.equal(later.autoEndTurn, false, 'a choice made after the migration sticks');
});

test('free aim: the part is the hitbox under the line, and assist only slows the mouse near an enemy', () => {
    const b = arena({ enemies: [{ type: 'cultist', pos: { x: 25, y: 20, z: 1 }, group: 0 }] });
    const u = b.unit('p0'), e = b.unit('e0'), o = { x: 10.5, y: 20.5, h: 3.35 };
    const head = partCentre(e, 'head');
    assert.equal(partUnderRay(b, u, o, head).part, 'head');
    assert.equal(partUnderRay(b, u, o, { ...head, h: head.h + 1.2 }), null, 'over the head: nothing');
    assert.ok(aimFriction(b, u, o, head) < 1);
    assert.equal(aimFriction(b, u, o, { x: 25.5, y: 10, h: 3 }), 1, 'far off: full speed');
});
