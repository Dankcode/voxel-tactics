// PLAN-07: tracers travel, bursts are staggered, impacts fire on arrival, everything is cleaned up.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Fx, TRACER_SPEED, TRACER_LENGTH, BURST_GAP } from '../Fx.js';
import { EventPlayer } from '../../anim/EventPlayer.js';
import { CutInDirector } from '../../anim/CutInDirector.js';

const fxOf = () => new Fx({ scene: new THREE.Scene(), clipping: [], shake: 0 }, null);

test('a tracer streak travels from the muzzle to the impact and is removed after its tail lands', () => {
    const fx = fxOf(); let arrived = 0;
    const it = fx.tracer({ x: 0, y: 0, h: 1 }, { x: 18, y: 0, h: 1 }, 0xffffff, { light: true, onArrive: () => arrived++ });
    fx.update(0.01);
    const p1 = it.obj.position.x;
    fx.update(0.01);
    assert.ok(it.obj.position.x > p1, 'the streak moves');
    assert.ok(TRACER_LENGTH >= 5 && it.obj.children[0].scale.y <= TRACER_LENGTH + 1e-9, 'a long, single travelling beam');
    assert.ok(it.lightSlot?.light?.isPointLight);
    assert.equal(it.lightSlot.light.castShadow, false);
    assert.equal(arrived, 0);
    fx.update(18 / TRACER_SPEED);
    assert.equal(arrived, 1, 'impact fires once on arrival');
    for (let i = 0; i < 10; i++) fx.update(0.05);
    assert.equal(fx.items.filter(x => x.kind === 'tracer').length, 0);
    assert.deepEqual(fx.group.children, [fx.fireGroup], 'tracers and sparks are all disposed');
});

test('a short enemy tracer and its impact both render and expire at fast playback speeds', () => {
    const fx = fxOf(), from = {x:0,y:0,h:2}, to = {x:2,y:0,h:2};
    const tracer = fx.tracer(from, to, 0xff6a4a, {speed:3*TRACER_SPEED, onArrive:()=>fx.impact(to,'unit')});
    fx.update(.05);
    assert.ok(tracer.obj.visible && fx.group.children.includes(tracer.obj));
    const sparks = fx.items.filter(item=>item.kind==='spark');
    assert.ok(sparks.length);
    fx.update(.05);
    assert.ok(sparks[0].obj.position.y > to.h);
    for(let i=0;i<6;i++) fx.update(.05);
    assert.deepEqual(fx.group.children,[fx.fireGroup]);
});

test('burst rounds leave the muzzle one after another; impacts leave no spherical remnants', async () => {
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
    const before = new Set(fx.items);
    fx.impact({ x: 1, y: 1, h: 1 }, 'stone');
    assert.ok(fx.items.some(x => !before.has(x) && x.kind === 'spark'), 'stone impacts throw chips');
    fx.impact({ x: 1, y: 1, h: 1 }, 'metal');
    const added = fx.items.filter(x => !before.has(x));
    assert.ok(added.some(x => x.kind === 'spark'), 'metal throws sparks');
    assert.ok(added.every(x => x.kind === 'spark' && x.obj.geometry.type !== 'SphereGeometry'));
});

test('tracers originate at the 3D muzzle without any 2D sprite barrel override', async () => {
    const director = Object.create(CutInDirector.prototype), muzzle = { x: 0, y: 0, h: 2 }, impact = { x: 0, y: -10, h: 2 };
    const origin = director.tracerOrigin(muzzle, impact);
    assert.deepEqual(origin, muzzle, 'tracerOrigin passes the authoritative 3D muzzle straight through');
    const fx = fxOf(); let flash; fx.flash = at => { flash = at; };
    const player = new EventPlayer({ fx, voxelView: { flush() {} }, hud: { refresh() {} }, battle: null, views: new Map(), cutins: { tracerOrigin: (m, t) => director.tracerOrigin(m, t) } });
    player.speed = 1000;
    await player.play({ t: 'shot', unitId: 'x', weaponId: 'repeater', muzzle, aim: impact, rounds: 1, reaction: false, projectiles: [{ to: impact, kind: 'none' }] });
    const tracer = fx.items.find(x => x.kind === 'tracer');
    assert.deepEqual(tracer.a, new THREE.Vector3(muzzle.x, muzzle.h, muzzle.y)); assert.deepEqual(tracer.b, new THREE.Vector3(impact.x, impact.h, impact.y));
    assert.deepEqual(flash, muzzle);
});

test('overview calloutRing and shotLine animate and dispose cleanly without leaking scene objects', () => {
    const fx = fxOf();
    const ring = fx.calloutRing(new THREE.Vector3(3.5, 2, 4.5), 0xff5a4a, 0.3);
    const line = fx.shotLine({ x: 3.5, y: 4.5, h: 2.3 }, { x: 9.5, y: 4.5, h: 2.1 }, 0xff6a4a, 0.2);
    assert.ok(fx.group.children.includes(ring) && fx.group.children.includes(line));
    fx.update(0.1);
    assert.ok(ring.material.opacity > 0 && line.material.opacity > 0);
    fx.update(0.25);
    assert.equal(fx.items.length, 0);
    assert.deepEqual(fx.group.children, [fx.fireGroup], 'calloutRing and shotLine clean up cleanly');
});
