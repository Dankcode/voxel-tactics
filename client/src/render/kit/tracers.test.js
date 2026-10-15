// PLAN-07: tracers travel, bursts are staggered, impacts fire on arrival, everything is cleaned up.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Fx, TRACER_SPEED, BURST_GAP } from '../Fx.js';
import { EventPlayer } from '../../anim/EventPlayer.js';

const fxOf = () => new Fx({ scene: new THREE.Scene(), clipping: [], shake: 0 }, null);

test('a tracer streak travels from the muzzle to the impact and is removed after its tail lands', () => {
    const fx = fxOf(); let arrived = 0;
    const it = fx.tracer({ x: 0, y: 0, h: 1 }, { x: 18, y: 0, h: 1 }, 0xffffff, { onArrive: () => arrived++ });
    fx.update(0.05);
    const p1 = it.obj.position.x;
    fx.update(0.05);
    assert.ok(it.obj.position.x > p1, 'the streak moves');
    assert.ok(it.obj.children[0].scale.y <= 1.2 + 1e-9, 'the streak is short, not a line to the target');
    assert.equal(arrived, 0);
    fx.update(18 / TRACER_SPEED);
    assert.equal(arrived, 1, 'impact fires once on arrival');
    for (let i = 0; i < 10; i++) fx.update(0.05);
    assert.equal(fx.items.filter(x => x.kind === 'tracer').length, 0);
    assert.deepEqual(fx.group.children, [fx.fireGroup], 'tracers, puffs and sparks are all disposed');
});

test('burst rounds leave the muzzle one after another; impacts spawn puffs and sparks', async () => {
    const fx = fxOf();
    const player = new EventPlayer({ fx, voxelView: { flush() {} }, hud: { refresh() {} }, battle: null, views: new Map() });
    player.speed = 1000;
    const muzzle = { x: 0, y: 0, h: 1.5 };
    await player.play({ t: 'shot', unitId: 'x', weaponId: 'repeater', muzzle, aim: { x: 10, y: 0, h: 1.5 }, rounds: 3, reaction: false,
        projectiles: [0, 1, 2].map(i => ({ to: { x: 10, y: i * 0.1, h: 1.5 }, kind: 'none' })) });
    const tracers = fx.items.filter(x => x.kind === 'tracer');
    assert.equal(tracers.length, 3);
    const waits = tracers.map(t => t.wait);
    assert.ok(waits[0] === 0 && waits[1] > 0 && waits[2] > waits[1], `staggered ${waits}`);
    assert.ok(Math.abs(waits[1] - BURST_GAP / player.speed) < 1e-9);
    fx.impact({ x: 1, y: 1, h: 1 }, 'metal');
    assert.ok(fx.items.some(x => x.kind === 'spark'), 'metal throws sparks');
});
