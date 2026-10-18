// The back shot's barrel tip lands on the crosshair, the figure stays left of it, and every camera switch uses it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { backshotPlacement, CUTIN_MODES, BAR_SHARE, sideCutin } from '../../anim/CutInDirector.js';

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

test('there is no cut-in mode that skips the back shot', () => {
    assert.deepEqual(CUTIN_MODES, ['always']);
});

test('committed cropped ranger cut-in meets the letterbox on either shoulder',()=>{
    const ranger=art('ranger-01');
    for(const viewport of [{width:1280,height:720},{width:600,height:800}])for(const shoulder of ['right','left']){
        const c=sideCutin(ranger,shoulder);
        const placements=[backshotPlacement(c,{x:viewport.width/2,y:viewport.height/2},viewport)];
        for(const p of placements){
            assert.equal(c.mirror?p.left+p.width:p.left,c.mirror?viewport.width:0,'no hard torso cut inside the scene');
            assert.ok(p.top>=0,'helmet stays inside viewport');
        }
        assert.equal(placements[0].top+placements[0].height,viewport.height*(1-BAR_SHARE));
    }
});

test('committed cut-ins select an authored left variant when present', () => {
    const c = art('test-soldier');
    assert.equal(sideCutin(c, 'right'), c);
    assert.equal(sideCutin(c, 'left'), c, 'no left sprite yet: the same art, not mirrored');
    const own = { ...c, variants: { left: { layers: [{ id: 'body', image: 'backshot-left.png' }], muzzle: [0.9, 0.4], width: 600, height: 440 } } };
    const v = sideCutin(own, 'left');
    assert.deepEqual(v.muzzle, [0.9, 0.4]); assert.equal(v.layers[0].image, 'backshot-left.png'); assert.equal(v.width, 600);
    assert.equal(sideCutin(own, 'right'), own);
});
