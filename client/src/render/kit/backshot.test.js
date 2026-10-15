// The back shot's barrel tip lands on the crosshair, the figure stays left of it, and every camera switch uses it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { backshotPlacement, CUTIN_MODES, BAR_SHARE } from '../../anim/CutInDirector.js';

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

test('the committed back shot reaches the letterbox; the aiming one stays small and leaves the view clear', () => {
    const c = art('test-soldier'), aim = { x: 640, y: 300 };
    const cut = backshotPlacement(c, aim, view);
    assert.ok(cut.top + cut.height >= view.height * (1 - BAR_SHARE) - 1e-6, 'no floating lower edge above the bars');
    assert.ok(cut.height <= view.height * 0.9);
    const aiming = backshotPlacement(c, aim, view, { bars: 0, scale: 0.75, fit: false });
    assert.ok(aiming.height < cut.height && aiming.width * aiming.height < 0.45 * view.width * view.height, 'covers under 45 % of the screen');
    assert.ok(aiming.left + aiming.width <= aim.x + 0.02 * aiming.width, 'kept to the left');
});

test('there is no cut-in mode that skips the back shot', () => {
    assert.deepEqual(CUTIN_MODES, ['always']);
});
