import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import colyseus from 'colyseus';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { MissionRoom } from '../src/MissionRoom.js';
import { aiCacheRoutes, readAiCache } from '../src/AiCache.js';
import { OnlineSession } from '../../client/src/net/OnlineSession.js';
import { CONTENT_CONTRACT } from '../../shared/session/ContentContract.js';
import { WEAPONS } from '../../shared/content/weapons.js';
import { alive } from '../../shared/battle/Units.js';

const delay = ms => new Promise(r => setTimeout(r, ms));
async function until(predicate, limitMs = 8000) {
    const start = Date.now();
    while (Date.now() - start < limitMs) {
        if (predicate()) return;
        await delay(20);
    }
    assert.ok(predicate(), 'condition reached before timeout');
}
const onceMsg = (room, type) => new Promise(resolve => room.onMessage(type, resolve));

async function setupMissionServer() {
    const server = http.createServer();
    const gs = new colyseus.Server({ transport: new WebSocketTransport({ server }) });
    gs.define('mission', MissionRoom);
    await new Promise(r => server.listen(0, '127.0.0.1', r));
    return { url: `ws://127.0.0.1:${server.address().port}`, gs, close: () => gs.gracefullyShutdown(false) };
}

test('server runEnemyTurn handles mid-turn overwatch kills cleanly without crashing or desyncing peers', { timeout: 30000 }, async () => {
    const srv = await setupMissionServer();
    let a, b;
    try {
        a = await OnlineSession.connect({ url: srv.url, desc: { scenario: 'proving-grounds', seed: 2, debug: true } });
        b = await OnlineSession.connect({ url: srv.url, roomId: a.roomId });
        await until(() => a.seq === b.seq);

        // Move a fragile enemy close to p2 (marksman on longrifle) and put p2 on overwatch facing it.
        const sniper = a.battle.unit('p2');
        const foes = a.battle.unitsOf('enemy').filter(e => !e.drone);
        assert.ok(foes.length >= 2);
        const doomed = foes[0];
        // Teleport doomed enemy near sniper, weaken via explode, alert hostiles, and put sniper on overwatch so it dies mid-turn.
        assert.ok((await a.submit({ type: 'debug', op: 'teleport', unitId: doomed.id, to: { x: sniper.x, y: sniper.y - 4, z: sniper.z } })).ok);
        assert.ok((await a.submit({ type: 'debug', op: 'explode', at: { x: doomed.x + 0.5, y: doomed.y + 0.5, h: doomed.z + 1.5 }, radius: 1, power: 0, damage: Math.max(1, doomed.hp - 5) })).ok);
        assert.ok((await a.submit({ type: 'debug', op: 'alert' })).ok);
        await until(() => a.seq === b.seq);
        assert.ok((await a.submit({ type: 'overwatch', unitId: sniper.id, weaponId: sniper.weapon, toward: { x: doomed.x, y: doomed.y } })).ok);
        await until(() => a.seq === b.seq);

        const [ra, rb] = await Promise.all([a.submit({ type: 'endTurn' }), b.submit({ type: 'endTurn' })]);
        assert.equal(ra.reason, 'waiting_for_team');
        assert.ok(rb.ok);

        await until(() => a.battle.round === 2 && a.battle.activeSide === 'player' && a.seq === b.seq);
        assert.equal(a.battle.hash(), b.battle.hash(), 'peers stay strictly hash-synced after mid-turn enemy death');
    } finally {
        a?.leave(); b?.leave(); await srv.close();
    }
});

test('server rejects malformed/non-integer/out-of-turn intents without extra receipts or wedging the room', { timeout: 25000 }, async () => {
    const srv = await setupMissionServer();
    let a;
    try {
        a = await OnlineSession.connect({ url: srv.url, desc: { scenario: 'proving-grounds', seed: 1 } });
        let receipts = 0;
        a.room.onMessage('receipt', () => { receipts++; });

        // 1. Non-integer expectedSeq
        let rej = onceMsg(a.room, 'reject');
        a.room.send('intent', { nonce: 'bad-seq-str', expectedSeq: '1', intent: { type: 'wait', unitId: 'p0' } });
        assert.equal((await rej).reason, 'bad_command');

        // 2. Non-object / array intent
        rej = onceMsg(a.room, 'reject');
        a.room.send('intent', { nonce: 'bad-arr', expectedSeq: a.seq, intent: [] });
        assert.equal((await rej).reason, 'bad_command');

        // 3. Unknown intent type -> single reject, no duplicate receipt
        const receiptsBefore = receipts;
        rej = onceMsg(a.room, 'reject');
        a.room.send('intent', { nonce: 'bad-type', expectedSeq: a.seq, intent: { type: 'cheat_win', unitId: 'p0' } });
        assert.equal((await rej).reason, 'bad_intent');
        await delay(50);
        assert.equal(receipts, receiptsBefore, 'rejected intent emits only reject, not a duplicate receipt');

        // Room remains completely healthy for valid commands afterwards
        const ok = await a.submit({ type: 'wait', unitId: 'p0' });
        assert.ok(ok.ok);
        assert.equal(a.battle.unit('p0').ap, 0);
    } finally {
        a?.leave(); await srv.close();
    }
});

test('multi-round lockstep soak preserves identical peer hashes across movement, terrain destruction, and AI turns', { timeout: 40000 }, async () => {
    const srv = await setupMissionServer();
    let a, b;
    try {
        a = await OnlineSession.connect({ url: srv.url, desc: { scenario: 'operation', seed: 1, operation: { plot: 'downtown' } } });
        b = await OnlineSession.connect({ url: srv.url, roomId: a.roomId });
        await until(() => a.seq === b.seq);

        for (let round = 1; round <= 2; round++) {
            const p0 = a.battle.unit('p0');
            if (alive(p0) && p0.ap > 0) {
                const tile = [...a.battle.reach(p0, 2).nodes.values()].find(n => (n.x !== p0.x || n.y !== p0.y) && !a.battle.occupant(n.x, n.y, n.z));
                if (tile) {
                    const ownerSession = p0.owner === 'P1' ? a : b;
                    assert.ok((await ownerSession.submit({ type: 'move', unitId: p0.id, to: tile })).ok);
                }
            }
            const g = a.battle.unit('p1');
            if (round === 1 && alive(g) && g.ap >= 2 && (g.items.powder_bomb || 0) > 0) {
                const ownerSession = g.owner === 'P1' ? a : b;
                const throwRes = await ownerSession.submit({ type: 'throw', unitId: g.id, itemId: 'powder_bomb', to: { x: g.x + 2, y: g.y, z: g.z } });
                assert.ok(throwRes.ok || throwRes.reason, 'throw resolved cleanly');
            }
            await until(() => a.seq === b.seq);
            assert.equal(a.battle.hash(), b.battle.hash());

            await Promise.all([a.submit({ type: 'endTurn' }), b.submit({ type: 'endTurn' })]);
            await until(() => a.battle.round === round + 1 && a.battle.activeSide === 'player' && a.seq === b.seq);
            assert.equal(a.battle.hash(), b.battle.hash(), `round ${round + 1} lockstep parity`);
        }
    } finally {
        a?.leave(); b?.leave(); await srv.close();
    }
});

test('AiCache HTTP endpoints reject invalid traits and sanitize NaN/Inf/string trait payloads safely', async () => {
    const tmp = path.join(os.tmpdir(), `vt-aicache-robust-${process.pid}-${Date.now()}.json`);
    const app = express();
    app.use(express.json({ limit: '64kb' }));
    aiCacheRoutes(app, tmp);
    const server = http.createServer(app);
    await new Promise(r => server.listen(0, '127.0.0.1', r));
    const base = `http://127.0.0.1:${server.address().port}`;
    try {
        const bad = await fetch(`${base}/api/ai-cache`, {
            method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ meta: { outcome: 'victory' } })
        });
        assert.equal(bad.status, 400);

        const dirty = await fetch(`${base}/api/ai-cache`, {
            method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                style: { traits: { aggression: 'NaN', flanking: null, overwatch: 0.8 }, extendedTraits: { recoilDiscipline: 'bad' }, headline: ['Custom'] },
                meta: { outcome: 'victory', scenario: 'operation', biome: 'downtown', tuning: { flankGuard: 999, spread: 'NaN' }, margin: -5 },
                player: 'Tester'
            })
        });
        assert.equal(dirty.status, 200);
        const saved = await (await fetch(`${base}/api/ai-cache`)).json();
        assert.ok(saved.squad && Number.isFinite(saved.squad.traits.aggression));
        assert.ok(Number.isFinite(saved.squad.tuning.flankGuard));
        assert.ok(readAiCache(tmp).players.Tester);
    } finally {
        await new Promise(r => server.close(r));
        fs.rmSync(tmp, { force: true });
    }
});
