import * as Colyseus from 'colyseus.js';
import { CONTENT_CONTRACT } from '../../../shared/session/ContentContract.js';
import { replayBattle } from '../../../shared/session/BattleReplay.js';

export class OnlineSession {
    static async connect({ url, desc = null, roomId = null, name = 'Player', support = 'carpet_bomb', ticket = null }) {
        const client = new Colyseus.Client(url);
        const options = { desc, name, support, ticket, contract: CONTENT_CONTRACT };
        const room = roomId ? await client.joinById(roomId, options) : await client.create('mission', options);
        const early = [];
        room.onMessage('intent', m => early.push(m));
        room.onMessage('hash', () => {}); room.onMessage('players', () => {});
        const init = await new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(Error('Server did not send init')), 15000);
            room.onMessage('init', m => { clearTimeout(timer); resolve(m); });
            room.onError((code, msg) => { clearTimeout(timer); reject(Error(`${code} ${msg}`)); });
        });
        const s = new OnlineSession(room, init, replayBattle(init), client);
        for (const m of early) s.applyRemote(m, true);
        return s;
    }
    constructor(room, init, battle, client) {
        this.client = client; this.desc = init.desc; this.playerId = init.playerId; this.roomId = room.roomId;
        this.battle = battle; this.local = false; this.seq = init.seq; this.pending = new Map();
        this.players = init.players || []; this.state = 'connected'; this.closed = false;
        this.bind(room);
    }
    setState(state) { this.state = state; this.onState?.(state); }
    settle(nonce, result) {
        const pending = this.pending.get(nonce);
        if (pending) { clearTimeout(pending.timer); this.pending.delete(nonce); pending.resolve(result); }
    }
    bind(room) {
        this.room = room;
        room.onMessage('intent', m => this.applyRemote(m));
        room.onMessage('reject', m => {
            this.settle(m.nonce, { ok: false, reason: m.reason, events: [] });
            if (m.reason === 'stale_command') this.recover();
        });
        room.onMessage('receipt', m => this.settle(m.nonce, m));
        room.onMessage('players', m => { this.players = m.players; });
        room.onMessage('votes', m => this.onVotes?.(m));
        room.onMessage('ping', m => this.onPing?.(m));
        room.onMessage('snapshot', m => { this.restoring = (this.restoring || Promise.resolve()).then(() => this.restore(m)); });
        room.onMessage('hash', m => { if (this.state === 'connected' && m.seq === this.seq && m.hash !== this.battle.hash()) this.recover(); });
        room.onLeave(code => { if (!this.closed && code !== 1000) this.reconnect(); else if (!this.closed) this.setState('disconnected'); });
    }
    recover() {
        if (this.state !== 'connected') return;
        this.buffer = []; this.setState('recovering'); this.room.send('sync');
    }
    async restore(snapshot) {
        if (this.state === 'connected' && snapshot.seq < this.seq) return;
        this.buffer ||= []; this.setState('recovering');
        try {
            const battle = replayBattle(snapshot);
            this.battle.light.dispose(); this.battle = battle; this.seq = snapshot.seq; this.players = snapshot.players;
            for (const [nonce] of this.pending) this.settle(nonce, { ok: false, reason: 'state_restored', events: [] });
            await this.onRecovered?.();
            const buffered = this.buffer; this.buffer = []; this.setState('connected');
            for (const m of buffered) this.applyRemote(m);
        } catch (error) { this.setState('disconnected'); this.onError?.(error.message); }
    }
    async reconnect() {
        this.buffer = []; this.setState('reconnecting');
        for (const [nonce] of this.pending) this.settle(nonce, { ok: false, reason: 'connection_lost', events: [] });
        const token = this.room.reconnectionToken;
        for (let attempt = 0; attempt < 5 && !this.closed; attempt++) {
            try {
                const room = await this.client.reconnect(token);
                this.bind(room);
                room.send('sync');
                return;
            } catch { await new Promise(r => setTimeout(r, 1000 * (attempt + 1))); }
        }
        this.setState('disconnected');
    }
    applyRemote(m, replay = false) {
        if (this.state !== 'connected') { this.buffer?.push(m); return; }
        if (m.seq <= this.seq) return;
        if (m.seq !== this.seq + 1) { this.recover(); return; }
        const r = this.battle.apply(m.intent);
        if (!r.ok) { this.recover(); return; }
        this.seq = m.seq;
        if (this.pending.has(m.nonce)) this.settle(m.nonce, r);
        else if (!replay && r.events.length) this.onEvents?.(r.events);
    }
    submit(intent) {
        if (this.state !== 'connected') return Promise.resolve({ ok: false, reason: this.state, events: [] });
        const nonce = `${this.playerId}:${Date.now()}:${Math.random().toString(36).slice(2, 9)}`;
        return new Promise(resolve => {
            const timer = setTimeout(() => { this.settle(nonce, { ok: false, reason: 'command_timeout', events: [] }); this.recover(); }, 10000);
            this.pending.set(nonce, { resolve, timer });
            this.room.send('intent', { nonce, expectedSeq: this.seq, intent });
        });
    }
    canAct() { return this.state === 'connected' && this.battle.activeSide === 'player'; }
    leave() {
        this.closed = true;
        for (const [nonce] of this.pending) this.settle(nonce, { ok: false, reason: 'left_room', events: [] });
        this.room.leave();
    }
}
