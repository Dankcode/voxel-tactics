import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Fx } from '../Fx.js';
import { EventPlayer } from '../../anim/EventPlayer.js';
import { MAT, AIR } from '../../../../shared/voxel/Materials.js';

test('destruction rebuilds the world with transient material debris and retains explosion feedback', async () => {
    const scene = { scene: new THREE.Scene(), clipping: [], shake: 0 };
    const fx = new Fx(scene, null);
    let rebuilds = 0;
    const player = new EventPlayer({ fx, voxelView: { flush() { rebuilds++; } }, hud: { refresh() {} } });
    player.speed = 1000;
    await player.play({ t: 'explosion', x: 4.5, y: 4.5, h: 2.5, radius: 3, element: 'geo' });
    const effects = [...fx.items];
    assert.ok(effects.length > 0 && scene.shake > 0, 'the explosion remains visible and shakes the camera');
    const blast = effects.find(e => e.kind === 'explosion');
    assert.ok(blast.light.isPointLight && !blast.light.castShadow, 'a brief non-shadowing blast light');
    assert.equal(blast.shockwave.geometry.type, 'RingGeometry');
    rebuilds = 0;   // the explosion itself redraws scorch marks (PLAN-07); count the destruction rebuild alone
    await player.play({ t: 'voxels', changes: [[4, 4, 2, MAT.concrete_wall, AIR], [4, 4, 3, MAT.plank, AIR]] });
    assert.equal(rebuilds, 1);
    const added = fx.items.filter(e => !effects.includes(e));
    assert.equal(added.filter(e => e.kind === 'debris').length, 10, 'each destroyed voxel throws material-colored chips');
    assert.equal(added.filter(e => e.kind === 'dust').length, 2, 'each destroyed voxel emits a fading dust puff');
    assert.equal(added.find(e => e.kind === 'debris').obj.material.color.getHex(), 0xb4b5b0);
    for (let i = 0; i < 20; i++) fx.update(0.05);
    assert.equal(fx.items.length, 0, 'every destruction and explosion effect expires');
    assert.deepEqual(fx.group.children, [fx.fireGroup], 'no debris or impact objects remain in the scene');
});

test('defeat adds a short burst and ring without replacing the down animation', async () => {
    const fx = new Fx({ scene: new THREE.Scene(), clipping: [], shake: 0 }, null);
    fx.float = () => {};
    const view = { unit: { side: 'enemy', drone: false }, worldPosition: () => new THREE.Vector3(2, 1, 2), animator: { play() {} }, drawBar() {} };
    const player = new EventPlayer({ fx, views: new Map([['e0', view]]), hud: { refresh() {} } });
    player.speed = 1000;
    await player.play({ t: 'death', unitId: 'e0' });
    assert.equal(fx.items.filter(e => e.kind === 'spark').length, 6);
    assert.equal(fx.items.filter(e => e.obj.geometry?.type === 'RingGeometry').length, 1);
    fx.update(0.6);
    assert.equal(fx.items.length, 0);
    assert.deepEqual(fx.group.children, [fx.fireGroup]);
});
