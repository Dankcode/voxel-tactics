// Lockstep co-op room (PLAN-01 §8, §10).
//
// The server builds the mission from the descriptor, keeps the authoritative Battle, validates every
// intent (ownership, rules) by applying it, and broadcasts accepted intents with a sequence number.
// Clients rebuild the same mission and apply the same stream, so they reach the same state hash
// (broadcast after each intent for desync detection). AI turns are decided here and streamed too.
//
// Squad units are dealt round-robin to connected players; the squad's turn ends when every connected
// player has voted End Turn. Reconnects get the full intent log and replay it.
import colyseus from 'colyseus';
import { createBattle, scenarioId } from '../../shared/session/Scenarios.js';
import { decide } from '../../shared/battle/Ai.js';

const { Room } = colyseus;
export class MissionRoom extends Room {
    onCreate(options = {}) {
        this.maxClients = 4;
        const d = options.desc || {};
        this.desc = { scenario: scenarioId(d.scenario), seed: Number(d.seed) || 1, squad: d.squad || 'standard' };
        this.battle = createBattle(this.desc);
        this.log = [];             // [{ seq, intent, nonce }]
        this.players = [];         // [{ id, sessionId, name }]
        this.votes = new Set();
        this.nextPlayer = 1;
        this.onMessage('intent', (client, m) => this.onIntent(client, m));
        this.onMessage('ping', (client, m) => this.broadcast('ping', { ...m, from: this.playerOf(client)?.id }, { except: client }));
    }
    playerOf(client) { return this.players.find(p => p.sessionId === client.sessionId) || null; }
    onJoin(client, options = {}) {
        const player = { id: `P${this.nextPlayer++}`, sessionId: client.sessionId, name: String(options.name || 'Player').slice(0, 24) };
        this.players.push(player);
        // Deal units first so the joining peer's init log already contains the ownership intent.
        this.reassignOwners();
        client.send('init', { desc: this.desc, playerId: player.id, log: this.log, players: this.players });
    }
    async onLeave(client, consented) {
        const p = this.playerOf(client);
        if (!consented && p) {
            try { await this.allowReconnection(client, 60); return; } catch { /* timed out */ }
        }
        this.players = this.players.filter(x => x.sessionId !== client.sessionId);
        this.votes.delete(p?.id);
        this.reassignOwners();
        this.maybeEndPlayerTurn();
    }
    /** Deal living squad units round-robin to connected players (a lockstep intent, so every peer agrees). */
    reassignOwners() {
        if (!this.players.length) return;
        const owners = {};
        this.battle.units.filter(u => u.side === 'player').forEach((u, i) => { owners[u.id] = this.players[i % this.players.length].id; });
        this.commit({ type: 'owners', owners });
        this.broadcast('players', { players: this.players });
    }
    commit(intent, nonce = null) {
        const r = this.battle.apply(intent);
        if (!r.ok) return r;
        const entry = { seq: this.log.length + 1, intent, nonce };
        this.log.push(entry);
        this.broadcast('intent', entry);
        this.broadcast('hash', { seq: entry.seq, hash: this.battle.hash() });
        return r;
    }
    onIntent(client, m) {
        const p = this.playerOf(client);
        const intent = { ...(m?.intent || {}), by: p?.id };
        if (!p || this.battle.outcome) return client.send('reject', { nonce: m?.nonce, reason: 'battle_over' });
        if (intent.type === 'endTurn') {
            if (this.battle.activeSide !== 'player') return client.send('reject', { nonce: m.nonce, reason: 'not_your_turn' });
            this.votes.add(p.id);
            if (this.votes.size < this.players.length) {
                this.broadcast('votes', { votes: [...this.votes], needed: this.players.length });
                return client.send('reject', { nonce: m.nonce, reason: 'waiting_for_team' });
            }
            return this.endPlayerTurn(m.nonce);
        }
        if (intent.type === 'owners') return client.send('reject', { nonce: m.nonce, reason: 'bad_intent' });
        const r = this.commit(intent, m.nonce);
        if (!r.ok) client.send('reject', { nonce: m.nonce, reason: r.reason });
    }
    maybeEndPlayerTurn() { if (this.battle.activeSide === 'player' && this.players.length && this.votes.size >= this.players.length) this.endPlayerTurn(null); }
    endPlayerTurn(nonce) {
        this.votes.clear();
        this.commit({ type: 'endTurn', side: 'player', by: '*' }, nonce);
        this.runEnemyTurn();
    }
    /** Enemy AI on the server; every decision is streamed as an intent. */
    runEnemyTurn() {
        const b = this.battle;
        for (let guard = 0; guard < 200 && !b.outcome && b.activeSide === 'enemy'; guard++) {
            let acted = false;
            for (const u of b.unitsOf('enemy')) {
                for (let k = 0; k < 6 && !b.outcome; k++) {
                    const intent = decide(b, u);
                    if (!intent) break;
                    if (!this.commit({ ...intent, by: '*' }).ok) break;
                    acted = true;
                }
            }
            if (!b.outcome) this.commit({ type: 'endTurn', side: 'enemy', by: '*' });
            void acted;
            break;
        }
    }
}
