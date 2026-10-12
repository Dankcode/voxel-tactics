// A test-ground setup hosted online: the server and every peer apply the same roster and overrides to the same
// compiled mission, so they start from the same hash; an invalid roster is refused when the room is created.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import colyseus from 'colyseus';
import { WebSocketTransport } from '@colyseus/ws-transport';
import * as Client from 'colyseus.js';
import { MissionRoom } from '../src/MissionRoom.js';
import { createBattle } from '../../shared/session/Scenarios.js';
import { unpackMission } from '../../shared/session/MissionSnapshot.js';

test('an online test-ground room starts every peer on the same custom roster', { timeout: 60000 }, async () => {
    const server = http.createServer();
    const gs = new colyseus.Server({ transport: new WebSocketTransport({ server }) });
    gs.define('mission', MissionRoom);
    await new Promise(r => server.listen(0, r));
    try {
        const url = `ws://127.0.0.1:${server.address().port}`;
        const join = room => new Promise(r => room.onMessage('init', init => r(createBattle(init.desc, unpackMission(init.mission)))));
        const setup = { enemies: [{ type: 'brute', count: 2 }, { type: 'archer', count: 3 }], podSize: 2, alerted: true, objective: 'eliminate', rounds: 10 };
        const a = new Client.Client(url), b = new Client.Client(url);
        const roomA = await a.create('mission', { desc: { scenario: 'proving-grounds', seed: 6, squad: ['marksman', 'warden'], test: setup }, name: 'A' });
        const quiet = room => { for (const t of ['intent', 'hash', 'reject', 'players', 'votes', 'ping']) room.onMessage(t, () => {}); };
        const pa = join(roomA); quiet(roomA);
        const roomB = await b.joinById(roomA.roomId, { name: 'B' });
        const pb = join(roomB); quiet(roomB);
        const [ba, bb] = await Promise.all([pa, pb]);
        assert.equal(ba.hash(), bb.hash());
        const enemies = ba.units.filter(u => u.side === 'enemy');
        assert.deepEqual(enemies.map(e => e.type).sort(), ['archer', 'archer', 'archer', 'brute', 'brute']);
        assert.ok(enemies.every(e => e.alerted));
        assert.equal(ba.units.filter(u => u.side === 'player').length, 2);
        assert.equal(ba.objective.kind, 'eliminate'); assert.equal(ba.objective.turns, 10);
        await roomA.leave(); await roomB.leave();
        await assert.rejects(new Client.Client(url).create('mission', { desc: { scenario: 'proving-grounds', test: { enemies: [{ type: 'alien', count: 1 }] } } }), /Unknown enemy type/);
    } finally { gs.gracefullyShutdown(false); }
});
