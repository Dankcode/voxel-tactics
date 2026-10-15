import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { SoundPlayer, SOUNDS, explosionSound, weaponHandlingSound } from './SoundPlayer.js';
import { EventPlayer } from '../anim/EventPlayer.js';

const flush = () => new Promise(resolve => setImmediate(resolve));
function fakeContext() {
    const context = {
        state: 'running', destination: {}, sources: [],
        createGain: () => ({ gain: { value: 1 }, connect() {}, disconnect() {} }),
        decodeAudioData: async () => ({}),
        createBufferSource() {
            const source = { playbackRate: { value: 1 }, connect() {}, disconnect() {},
                start() { this.started = true; }, stop() { this.stopped = true; } };
            this.sources.push(source); return source;
        }
    };
    return context;
}

test('all supplied clips exist; explosion distance and weapon handling select appropriate sounds', () => {
    for (const file of Object.values(SOUNDS)) assert.ok(existsSync(new URL(`../../public/assets/audio/${file}`, import.meta.url)));
    assert.equal(explosionSound({ x: 2, y: 2 }, { x: 0, z: 0 }), 'explosion');
    assert.equal(explosionSound({ x: 25, y: 0 }, { x: 0, z: 0 }), 'distantExplosion');
    assert.equal(explosionSound({ x: 2, y: 2, element: 'hydro' }), null);
    assert.equal(weaponHandlingSound('blunderbuss'), 'shotgunPump');
    assert.equal(weaponHandlingSound('handcannon'), 'handgunClick');
    assert.equal(weaponHandlingSound('repeater'), null);
});

test('cancelled footsteps never start after loading; muting stops active voices', async t => {
    t.mock.method(globalThis, 'fetch', async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(1) }));
    const context = fakeContext(), audio = new SoundPlayer({ contextFactory: () => context });
    audio.unlock();
    const stop = audio.play('footsteps', { loop: true });
    stop(); await flush();
    assert.equal(context.sources.length, 0);
    audio.play('footsteps', { loop: true }); await flush();
    assert.equal(context.sources[0].started, true);
    assert.equal(context.sources[0].loop, true);
    audio.setVolume(0);
    assert.equal(context.sources[0].stopped, true);
    assert.equal(audio.voices.size, 0);
    audio.play('explosion'); await flush();
    assert.equal(context.sources.length, 1);
});

test('overlapping blast tails are capped and leaving battle cancels pending clips', async t => {
    t.mock.method(globalThis, 'fetch', async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(1) }));
    const context = fakeContext(), audio = new SoundPlayer({ contextFactory: () => context });
    audio.unlock(); await flush();
    for (let i = 0; i < 20; i++) audio.play('explosion');
    await flush(); assert.equal(audio.voices.size, 12);
    audio.play('handgunClick'); audio.active = false; audio.stopAll(); await flush();
    assert.equal(audio.voices.size, 0);
    assert.ok(context.sources.every(s => s.stopped));
});

function presentation() {
    const calls = [], unit = { id: 'p0', side: 'player', type: 'vanguard' };
    const view = { unit, group: { scale: { y: 1 } }, animator: { play() {} }, face() {}, setCell() {}, worldPosition: () => ({}) };
    const game = { audio: { play(name, options) { if (name) calls.push(['play', name, options]); return () => calls.push(['stop', name]); } },
        views: new Map([['p0', view]]), hud: { refresh() {} }, updateEnemyVisibility() {}, isVisible: () => false };
    const player = new EventPlayer(game); player.speed = 100;
    return { player, calls, game, view };
}

test('footsteps span continuous walking, stop for climbing, and stay silent for hidden enemies or knockback', async () => {
    const { player, calls, view } = presentation();
    const path = [{ x: 0, y: 0, z: 1 }, { x: 1, y: 0, z: 1 }, { x: 2, y: 0, z: 1 }, { x: 2, y: 0, z: 2 }];
    await player.play({ t: 'move', unitId: 'p0', path, kinds: ['walk', 'walk', 'climb'] });
    assert.deepEqual(calls.map(c => c.slice(0, 2)), [['play', 'footsteps'], ['stop', 'footsteps']]);
    calls.length = 0; view.unit.side = 'enemy';
    await player.play({ t: 'move', unitId: 'p0', path });
    view.unit.side = 'player';
    await player.play({ t: 'knockback', unitId: 'p0', path });
    assert.equal(calls.length, 0);
});

test('shotgun cycling follows the shot; reloads use the matching mechanical clip', async () => {
    const { player, calls, game } = presentation();
    game.fx = { flash() {}, float() {} };
    await player.play({ t: 'shot', unitId: 'p0', weaponId: 'blunderbuss', projectiles: [] });
    await player.play({ t: 'reload', unitId: 'p0', weaponId: 'handcannon' });
    await player.play({ t: 'reload', unitId: 'p0', weaponId: 'repeater' });
    assert.deepEqual(calls.map(c => c[1]), ['shotgunPump', 'handgunClick']);
});
