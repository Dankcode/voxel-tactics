import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Fx } from '../Fx.js';
import { EventPlayer } from '../../anim/EventPlayer.js';
import { MAT, AIR } from '../../../../shared/voxel/Materials.js';

test('destruction rebuilds the world without fragment meshes and retains explosion feedback', async () => {
    const scene = { scene: new THREE.Scene(), clipping: [], shake: 0 };
    const fx = new Fx(scene, null);
    let rebuilds = 0;
    const player = new EventPlayer({ fx, voxelView: { flush() { rebuilds++; } }, hud: { refresh() {} } });
    player.speed = 1000;
    await player.play({ t: 'explosion', x: 4.5, y: 4.5, h: 2.5, radius: 3, element: 'geo' });
    const feedback = [...fx.group.children], effects = [...fx.items];
    assert.ok(effects.length > 0 && scene.shake > 0, 'the explosion remains visible and shakes the camera');
    rebuilds = 0;   // the explosion itself redraws scorch marks (PLAN-07); count the destruction rebuild alone
    await player.play({ t: 'voxels', changes: [[4, 4, 2, MAT.concrete_wall, AIR], [4, 4, 3, MAT.plank, AIR]] });
    assert.equal(rebuilds, 1);
    assert.deepEqual(fx.group.children, feedback, 'destroyed buildings add no fragment meshes');
    assert.deepEqual(fx.items, effects, 'destruction queues no flying particles');
});
