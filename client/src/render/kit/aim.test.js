// PLAN-07: aim inertia, reticle size from the real cone, shoulder camera follows, back-view sprite faces the aim.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { AimController, aimTau, aimClass, swayDegrees, AIM_TAU, aimDelta, AIM_PITCH_LIMIT, aimSpriteInertia } from '../../ui/AimController.js';
import { reticleRadius } from '../../ui/AimReticle.js';
import { CameraDirector, MAX_YAW, targetAimFov } from '../../anim/CameraDirector.js';
import { AimPointer } from '../../ui/AimPointer.js';
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

test('sprite arms trail the world-space aiming spring, settle and respect inertia off', () => {
    const origin={x:0,y:0,h:2},a=new AimController();a.snap({x:10,y:0,h:2});
    a.setTarget(aimDelta(a.current,origin,200,-100));
    const first=aimSpriteInertia(a.current,a.target,origin);
    assert.ok(first.yaw<0 && first.pitch>0,'weapon trails a right/up turn');
    assert.ok(Math.abs(first.yaw)<=.12 && first.pitch<=.09);
    for(let i=0;i<120;i++)a.step(1/60);
    const settled=aimSpriteInertia(a.current,a.target,origin);
    assert.ok(Math.abs(settled.yaw)<1e-6 && Math.abs(settled.pitch)<1e-6);
    a.setTarget({x:0,y:10,h:3});a.step(1/60,{inertia:false});
    assert.deepEqual(aimSpriteInertia(a.current,a.target,origin),{yaw:0,pitch:0});
    const edge=angle=>({x:Math.cos(angle)*10,y:Math.sin(angle)*10,h:2});
    const wrapped=aimSpriteInertia(edge(Math.PI-.01),edge(-Math.PI+.01),origin);
    assert.ok(Math.abs(wrapped.yaw+.02)<1e-9,'crossing ±180° does not snap to maximum sway');
    assert.deepEqual(aimSpriteInertia(origin,a.target,origin),{yaw:0,pitch:0});
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

test('PLAN-12: the shoulder camera holds its framing while aiming and re-anchors only past its limits', () => {
    const cd = new CameraDirector({ aspect: 1 });
    const shooter = new THREE.Vector3(0, 1, 0);
    cd.prepareAim(shooter, new THREE.Vector3(0, 2, -10));
    const from = cd.from.clone(), look = cd.look.clone();
    cd.track(new THREE.Vector3(1, 2, -10), 0.5);
    assert.ok(cd.look.equals(look), 'the view does not swing with the reticle (the soldier stays put on screen)');
    assert.ok(cd.from.equals(from), 'small swings keep the framing');
    const yaw = MAX_YAW + 0.2, far = new THREE.Vector3(Math.sin(yaw) * 10, 2, -Math.cos(yaw) * 10);
    cd.track(far, 0.016);
    assert.ok(!cd.from.equals(from), 'past the limit the camera swings round behind the shooter');
});

test('re-anchoring the shoulder camera while the reticle moves keeps the shooter hidden', () => {
    const cd = new CameraDirector({ aspect: 1 });
    const shooter = new THREE.Vector3(0, 1, 0);
    cd.hidden = new Set(['p0']);
    cd.prepareAim(shooter, new THREE.Vector3(0, 2, -10));
    const yaw = MAX_YAW + 0.2;
    cd.track(new THREE.Vector3(Math.sin(yaw) * 10, 2, -Math.cos(yaw) * 10), 0.016);
    assert.ok(cd.hidden.has('p0'), 'still hidden after the swing');
    cd.end();
    assert.equal(cd.hidden.size, 0, 'shown again once the shoulder view ends');
});

test('relative aim: cursor motion turns the aim by a damped angle and never runs away', () => {
    const origin = { x: 0, y: 0, h: 2 }, focus = { x: 10, y: 0, h: 2 };
    assert.equal(aimDelta(focus, origin, 0, 0), null);
    const opts = { fov: 38, height: 760 };
    const half = aimDelta(focus, origin, 100, 0, { ...opts, sensitivity: 0.5 }), full = aimDelta(focus, origin, 100, 0, { ...opts, sensitivity: 1 });
    const ang = p => Math.atan2(p.y - origin.y, p.x - origin.x);
    assert.ok(Math.abs(ang(half) - ang(full) / 2) < 1e-9, 'half sensitivity turns half as far');
    assert.ok(Math.abs(ang(full) - 100 * 38 * Math.PI / 180 / 760) < 1e-9, 'one px = fov/height radians at 1x');
    assert.ok(half.y > 0, 'moving right turns toward screen right (clockwise from above)');
    assert.ok(Math.abs(Math.hypot(half.x, half.y, half.h - 2) - 10) < 1e-9, 'the aim distance is kept');
    const down = aimDelta(focus, origin, 0, 50, opts); assert.ok(down.h < 2, 'moving down lowers the aim');
    let p = focus; for (let i = 0; i < 50; i++) p = aimDelta(p, origin, 0, -400, opts);
    assert.ok(Math.atan2(p.h - 2, Math.hypot(p.x, p.y)) <= AIM_PITCH_LIMIT + 1e-9, 'pitch is clamped');
});

test('selecting a distant target zooms smoothly; wheel zoom survives camera re-anchoring and resets on exit',()=>{
    assert.ok(targetAimFov(30)<targetAimFov(10));
    const cd=new CameraDirector({aspect:1}),shooter=new THREE.Vector3(0,1,0),target=new THREE.Vector3(0,2,-30);
    cd.prepareAim(shooter,target,{side:'left'});cd.focusTarget(target);cd.update(.1);
    assert.ok(cd.cam.fov<38&&cd.cam.fov>cd.aimFov,'eases into target framing');
    cd.zoomAim(.8);const zoom=cd.aimFov;cd.track(new THREE.Vector3(30,2,0),.2);
    assert.equal(cd.aimFov,zoom);assert.equal(cd.side,'left');
    cd.zoomAim(.001);assert.equal(cd.aimFov,14);cd.zoomAim(100);assert.equal(cd.aimFov,60);
    cd.end();cd.prepareAim(shooter,target);assert.equal(cd.cam.fov,38,'free aim starts wide');
});

test('mouse capture releases on mode exit, rejects late lock requests and recovers from denial',async()=>{
    const doc=new EventTarget();let requests=0,releases=0,errors=0;
    doc.exitPointerLock=()=>{releases++;doc.pointerLockElement=null;doc.dispatchEvent(new Event('pointerlockchange'));};
    const canvas={ownerDocument:doc,requestPointerLock:()=>{requests++;return Promise.resolve();}};
    const pointer=new AimPointer(canvas,{failed:()=>errors++});
    pointer.request();assert.equal(requests,0);
    pointer.setEnabled(true);pointer.request();pointer.request();assert.equal(requests,1,'only one pending request');
    pointer.setEnabled(false);doc.pointerLockElement=canvas;doc.dispatchEvent(new Event('pointerlockchange'));
    assert.equal(pointer.locked,false,'late request cannot trap the mouse after leaving aim');assert.equal(releases,1);
    pointer.setEnabled(true);canvas.requestPointerLock=()=>Promise.reject(Error('denied'));
    pointer.request();await Promise.resolve();assert.equal(errors,1);assert.equal(pointer.pending,false);
    canvas.requestPointerLock=()=>{doc.pointerLockElement=canvas;doc.dispatchEvent(new Event('pointerlockchange'));};
    pointer.request();assert.equal(pointer.locked,true);pointer.release();assert.equal(pointer.locked,false);
    pointer.dispose();
});
