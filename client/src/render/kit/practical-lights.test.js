import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { LanternLights } from '../LanternLights.js';
import { LIGHTING } from '../Scene.js';

const scene = time => ({ scene: new THREE.Scene(), lightingName: time });
const street = [{ kind: 'streetlight', x: 4, y: 5, z: 1, yaw: 0 }];

test('street lamps cast useful non-shadowing light across dark streets', () => {
    const lights = new LanternLights(scene('night'), 2);
    lights.scan({ width: 0, depth: 0, height: 0 }, street);
    lights.update(1, new THREE.Vector3(4, 1, 5));
    assert.ok(lights.pool[0].intensity >= 15);
    assert.ok(lights.pool[0].distance >= 14);
    assert.equal(lights.pool[0].castShadow, false);
    lights.scene.lightingName = 'day';
    lights.update(1, new THREE.Vector3(4, 1, 5));
    assert.ok(lights.pool[0].intensity < 4);
});

test('night keeps readable sky fill without daylight-strength moonlight', () => {
    assert.ok(LIGHTING.night.sunI < LIGHTING.day.sunI * 0.3);
    assert.ok(LIGHTING.night.hemiI >= 0.2);
    assert.ok(LIGHTING.night.backI >= 0.4);
    assert.ok(LIGHTING['night-ops'].sunI < LIGHTING.night.sunI);
});
