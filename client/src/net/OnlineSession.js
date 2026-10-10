import { unpackMission } from '../../../shared/session/MissionSnapshot.js';
// Online co-op (lockstep): the server owns ordering. Every peer hydrates the server's compiled mission,
// then applies the server's intent stream in sequence; local intents are sent, validated
// by the server's Battle, and come back in the stream. AI turns are decided on the server and arrive
// as intents too, so every client animates exactly the same battle.
import * as Colyseus from 'colyseus.js';
import { createBattle } from '../../../shared/session/Scenarios.js';

export class OnlineSession {
    static async connect({ url, desc = null, roomId = null, name = 'Player' }) {
        const client = new Colyseus.Client(url);
        const room = roomId ? await client.joinById(roomId, { name }) : await client.create('mission', { desc, name });
        // Buffer stream messages that arrive while the mission is being built.
        const early = [];
        for (const type of ['intent', 'reject', 'players', 'hash', 'votes', 'ping']) room.onMessage(type, m => early.push([type, m]));
        const init = await new Promise((resolve, reject) => {
            room.onMessage('init', resolve);
            room.onError((code, msg) => reject(new Error(`${code} ${msg}`)));
            setTimeout(() => reject(new Error('server did not send init')), 15000);
        });
        const battle = createBattle(init.desc,init.mission?unpackMission(init.mission):null);
        const s = new OnlineSession(room, init, battle);
        for (const m of init.log) s.applyRemote(m, true);
        for (const [type, m] of early) if (type === 'intent' && m.seq > s.seq) s.applyRemote(m, true); else if (type === 'players') s.players = m.players;
        return s;
    }
    constructor(room, init, battle) {
        this.room = room; this.desc = init.desc; this.playerId = init.playerId; this.roomId = room.roomId;
        this.battle = battle; this.local = false; this.seq = 0; this.pending = new Map(); this.onEvents = null; this.players = init.players || [];
        room.onMessage('intent', m => this.applyRemote(m));
        room.onMessage('reject', m => { const p = this.pending.get(m.nonce); if (p) { this.pending.delete(m.nonce); p({ ok: false, reason: m.reason, events: [] }); } });
        room.onMessage('players', m => { this.players = m.players; });
        room.onMessage('votes', m => this.onVotes?.(m));
        room.onMessage('ping', m => this.onPing?.(m));
        room.onMessage('hash', m => { if (m.seq === this.seq && m.hash !== this.battle.hash()) console.warn('desync', m, this.battle.hash()); });
    }
    applyRemote(m, replay = false) {
        if (m.seq <= this.seq) return;
        if (m.seq !== this.seq + 1) console.warn('out of order intent', m.seq, this.seq);
        this.seq = m.seq;
        const r = this.battle.apply(m.intent);
        const p = this.pending.get(m.nonce);
        if (p) { this.pending.delete(m.nonce); p(r); }
        else if (!replay && r.events.length) this.onEvents?.(r.events);
    }
    submit(intent) {
        const nonce = `${this.playerId}:${Date.now()}:${Math.random().toString(36).slice(2, 7)}`;
        return new Promise(resolve => { this.pending.set(nonce, resolve); this.room.send('intent', { nonce, intent: { ...intent, by: this.playerId } }); });
    }
    canAct() { return this.battle.activeSide === 'player'; }
    leave() { this.room.leave(); }
}
