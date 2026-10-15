// PLAN-07: aim inertia, reticle size from the real cone, shoulder camera follows, back-view sprite faces the aim.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { AimController, aimTau, aimClass, swayDegrees, AIM_TAU } from '../../ui/AimController.js';
import { reticleRadius } from '../../ui/AimReticle.js';
import { CameraDirector, MAX_YAW } from '../../anim/CameraDirector.js';
import { WEAPONS } from '../../../../shared/content/weapons.js';

test('the aim spring lags the cursor, settles without overshoot, and heavier guns are slower', () => {
    const run = tau => { const a = new AimController(); a.snap({ x: 0, y: 0, h: 1 }); a.setTarget({ x: 10, y: 0, h: 1 }); const xs = []; for (let i = 0; i < 60; i++) xs.push(a.step(1 / 60, { tau }).x); return xs; };
    const rifle = run(AIM_TAU.rifle), sniper = run(AIM_TAU.sniper);
    assert.ok(rifle[0] < 2, 'it does not jump to the cursor');
    assert.ok(rifle.every((x, i) => i === 0 || x >= rifle[i - 1] - 1e-9) && Math.max(...rifle) <= 10 + 1e-6, 'critically damped: no overshoot');
    assert.ok(Math.abs(rifle.at(-1) - 10) < 0.05, 'settles within a second');
    assert.ok(sniper[10] < rifle[10], 'a sniper rifle swings slower');
    assert.deepEqual(run(AIM_TAU.rifle), rifle, 'deterministic');
    const off = new AimController(); off.snap({ x: 0, y: 0, h: 0 }); off.setTarget({ x: 5, y: 0, h: 0 });
    assert.equal(off.step(1 / 60, { inertia: false }).x, 5, 'inertia off snaps');
});

test('weapon weight classes, wounded arms and sway', () => {
    assert.equal(aimClass(WEAPONS.handcannon), 'pistol'); assert.equal(aimClass(WEAPONS.longrifle), 'sniper');
    assert.equal(aimClass(WEAPONS.blunderbuss), 'shotgun'); assert.equal(aimClass(WEAPONS.repeater), 'rifle');
    const u = { weapon: 'repeater', parts: { armL: { hp: 0 }, armR: { hp: 5 } }, stress: 0, statuses: [], buffs: {} };
    assert.ok(Math.abs(aimTau(u) - AIM_TAU.rifle * 1.1) < 1e-9);
    assert.ok(swayDegrees({ ...u, stress: 60 }) > swayDegrees(u));
    assert.equal(swayDegrees({ ...u, buffs: { deadeye: true } }), 0);
    const a = new AimController(); a.snap({ x: 10, y: 0, h: 2 }); a.t = 1;
    const p = a.point({ sway: 0.5, origin: { x: 0, y: 0, h: 2 } });
    assert.ok(Math.abs(p.x - 10) < 1e-9 && Math.abs(p.y) > 0, 'sway is perpendicular to the line of fire');
});

test('the reticle radius is the projected cone, with no 4 px floor', () => {
    assert.equal(reticleRadius(2.2), 2.2);
    assert.equal(reticleRadius(40), 40);
    assert.equal(reticleRadius(0.2), 1.5);
    assert.equal(reticleRadius(900), 260);
});

test('the shoulder camera follows the aim and re-anchors only past its yaw limit', () => {
    const cd = new CameraDirector({ aspect: 1 });
    const shooter = new THREE.Vector3(0, 1, 0);
    cd.prepareAim(shooter, new THREE.Vector3(0, 2, -10));
    const from = cd.from.clone();
    cd.track(new THREE.Vector3(2, 2, -10), 0.5);
    assert.ok(cd.look.x > 0.5, 'the look point moves toward the aim');
    assert.ok(cd.from.equals(from), 'small swings keep the framing');
    const yaw = MAX_YAW + 0.2, far = new THREE.Vector3(Math.sin(yaw) * 10, 2, -Math.cos(yaw) * 10);
    cd.track(far, 0.016);
    assert.ok(!cd.from.equals(from), 'past the limit the camera swings round behind the shooter');
});
