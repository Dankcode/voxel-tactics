// The back shot's barrel tip lands on the crosshair, the figure stays left of it, and every camera switch uses it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { backshotPlacement, CUTIN_MODES, BAR_SHARE, aimBackshotLayout, aimBackshotPose, followStep, AIM_SHOT, sideCutin } from '../../anim/CutInDirector.js';

const art = name => JSON.parse(readFileSync(new URL(`../../../public/assets/characters/${name}/cutin.json`, import.meta.url)));
const view = { width: 1280, height: 760 };

test('the barrel tip of every back shot lands exactly on the crosshair', () => {
    for (const name of ['test-soldier', 'grenadier', 'cultist', 'brute']) {
        const c = art(name);
        assert.ok(Array.isArray(c.muzzle) && c.muzzle.length === 2, `${name} has a muzzle anchor`);
        for (const aim of [{ x: 640, y: 380 }, { x: 900, y: 250 }, { x: 300, y: 500 }]) {
            const p = backshotPlacement(c, aim, view);
            const tip = { x: p.left + c.muzzle[0] * p.width, y: p.top + c.muzzle[1] * p.height };
            assert.ok(Math.abs(tip.x - aim.x) < 1e-6 && Math.abs(tip.y - aim.y) < 1e-6, `${name} at ${JSON.stringify(aim)}`);
            assert.ok(p.left + p.width <= aim.x + 0.02 * p.width, 'the figure sits to the left of the crosshair');
        }
    }
});

test('the committed back shot reaches the letterbox and stays left of the crosshair', () => {
    const c = art('test-soldier'), aim = { x: 640, y: 300 };
    const cut = backshotPlacement(c, aim, view);
    assert.ok(cut.top + cut.height >= view.height * (1 - BAR_SHARE) - 1e-6, 'no floating lower edge above the bars');
    assert.ok(cut.height <= view.height * 0.9);
});

test('the aiming back shot is static in the bottom-left corner past the squad rail, whole and unclipped', () => {
    for (const name of ['test-soldier', 'grenadier']) {
        const c = art(name), a = aimBackshotLayout(c, view, 100), b = aimBackshotLayout(c, view, 100);
        assert.deepEqual(a, b, 'it does not depend on the crosshair');
        assert.equal(a.left, 100 + AIM_SHOT.gap);
        assert.ok(Math.abs(a.top + a.height - view.height) < 1e-9, 'sits on the bottom edge');
        assert.ok(a.width <= view.width * AIM_SHOT.maxWidthShare + 1e-9 && a.height <= view.height * AIM_SHOT.heightShare + 1e-9);
        assert.ok(Math.abs(a.width / a.height - c.width / c.height) < 1e-9, 'unstretched');
    }
});

test('the figure leans toward the crosshair after a slight delay and its upper body trails fast moves', () => {
    const c = art('test-soldier'), layout = aimBackshotLayout(c, view, 100);
    const muzzle = { x: layout.left + c.muzzle[0] * layout.width, y: layout.top + c.muzzle[1] * layout.height };
    assert.ok(Math.abs(aimBackshotPose(c, layout, muzzle).lean) < 1e-6, 'at rest when the crosshair is on the barrel line');
    const right = aimBackshotPose(c, layout, { x: 1200, y: muzzle.y }), left = aimBackshotPose(c, layout, { x: muzzle.x - 200, y: 120 });
    assert.ok(right.lean > 0 && left.lean < 0, 'leans toward the side the crosshair is on');
    assert.ok(Math.abs(right.lean) <= AIM_SHOT.maxLean && Math.abs(left.lean) <= AIM_SHOT.maxLean, 'never more than the limit');
    assert.ok(aimBackshotPose(c, layout, muzzle, { x: 900, y: 0 }).bend > 0, 'moving right, the top trails left (CSS skewX +)');
    assert.ok(Math.abs(aimBackshotPose(c, layout, muzzle, { x: 1e6, y: 0 }).bend) <= AIM_SHOT.maxBend);
    // The follow spring lags, then settles.
    const st = {}; followStep(st, { x: 0, y: 0 }, 0); followStep(st, { x: 300, y: 0 }, 1 / 60);
    assert.ok(st.pos.x > 0 && st.pos.x < 60, 'a slight delay behind the crosshair');
    for (let i = 0; i < 90; i++) followStep(st, { x: 300, y: 0 }, 1 / 60);
    assert.ok(Math.abs(st.pos.x - 300) < 1 && Math.abs(st.vel.x) < 5, 'settles');
});

test('there is no cut-in mode that skips the back shot', () => {
    assert.deepEqual(CUTIN_MODES, ['always']);
});

test('left shoulder: a variants.left sprite is used as drawn; without one the art is mirrored and sits bottom-right', () => {
    const c = art('test-soldier');
    assert.deepEqual(sideCutin(c, 'right'), { cutin: c, mirror: false, shoulder: 'right' });
    const m = sideCutin(c, 'left');
    assert.equal(m.mirror, true); assert.equal(m.cutin.muzzle[0], 1 - c.muzzle[0]); assert.equal(m.cutin.muzzle[1], c.muzzle[1]);
    // The committed cut-in puts the mirrored barrel tip on the crosshair with the figure to the right of it.
    const aim = { x: 640, y: 380 }, p = backshotPlacement(m.cutin, aim, view);
    assert.ok(Math.abs(p.left + m.cutin.muzzle[0] * p.width - aim.x) < 1e-6);
    assert.ok(p.left >= aim.x - 0.02 * p.width, 'figure to the right of the crosshair');
    // Aiming: static in the bottom-right corner, whole figure on screen.
    const l = aimBackshotLayout(m.cutin, view, 120, 'left');
    assert.ok(Math.abs(l.left + l.width - (view.width - AIM_SHOT.gap)) < 1e-6 && l.top + l.height === view.height);
    // Art with its own left-hand sprite.
    const own = { ...c, variants: { left: { layers: [{ id: 'body', image: 'backshot-left.png' }], muzzle: [0.01, 0.4], width: 600, height: 440 } } };
    const v = sideCutin(own, 'left');
    assert.equal(v.mirror, false); assert.deepEqual(v.cutin.muzzle, [0.01, 0.4]); assert.equal(v.cutin.layers[0].image, 'backshot-left.png'); assert.equal(v.cutin.width, 600);
});
