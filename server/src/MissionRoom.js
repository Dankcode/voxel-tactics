// Lockstep co-op room (PLAN-01 §8, §10).
//
// The server builds the mission from the descriptor, keeps the authoritative Battle, validates every
// intent (ownership, rules) by applying it, and broadcasts accepted intents with a sequence number.
// Clients hydrate the server’s compiled mission and apply the same stream, reaching the same state hash
// (broadcast after each intent for desync detection). AI turns are decided here and streamed too.
//
// Squad units are dealt round-robin. Experimental co-op ends a personal turn without a vote,
// then streams the enemy response and refreshes only that owner's squad. Classic mode retains
// team votes. Late joins replay the full log; dropped connections have a 60-second grace period.
import colyseus from 'colyseus';
import { CONTENT_CONTRACT } from '../../shared/session/ContentContract.js';
import { hashString } from '../../shared/util/Rng.js';
import { createBattle, sanitizeDesc } from '../../shared/session/Scenarios.js';
import { unpackMission } from '../../shared/session/MissionSnapshot.js';
import { buildMissionAsync } from './MissionBuilder.js';
import { decide } from '../../shared/battle/Ai.js';

const { Room } = colyseus;
export class MissionRoom extends Room {
    async onCreate(options = {}) {
        this.checkContract(options);
        this.roster = options.roster || null;
        this.hostPlayer = options.host || 'P1';
        this.launchOwners = options.owners || null;
        if (this.roster) {
            this.autoDispose = false;
            this.clock.setTimeout(() => { if (!this.clients.length) this.disconnect(); }, 60000);
        }
        this.maxClients = 4;
        const d = options.desc || {};
        try {
            this.desc = sanitizeDesc(d);
            this.initialMission=await buildMissionAsync(this.desc);
            this.battle=createBattle(this.desc,unpackMission(this.initialMission));
        }catch(error){throw new colyseus.ServerError(4211,error.message);}
        this.mapHash = hashString(JSON.stringify(this.initialMission)).toString(16);
        this.receipts = new Map();
        this.log = [];             // [{ seq, intent, nonce }]
        this.players = [];         // [{ id, sessionId, name }]
        this.votes = new Set();
        this.nextPlayer = 1;
        this.onMessage('sync', client => client.send('snapshot', this.snapshot(client)));
        this.onMessage('intent', (client, m) => this.onIntent(client, m));
        this.onMessage('ping', (client, m) => this.broadcast('ping', { ...m, from: this.playerOf(client)?.id }, { except: client }));
    }
    checkContract(options) {
        if (options?.contract?.protocol !== CONTENT_CONTRACT.protocol || options?.contract?.content !== CONTENT_CONTRACT.content)
            throw new colyseus.ServerError(4213, 'Incompatible game content. Rebuild or refresh both peers.');
    }
    onAuth(client, options) {
        this.checkContract(options);
        if (this.roster && !this.roster.some(s=>s.ticket===options.ticket)) throw new colyseus.ServerError(4214,'Staging seat required');
        return true;
    }
    snapshot(client) {
        return { contract: CONTENT_CONTRACT, mapHash: this.mapHash, desc: this.desc, mission: this.initialMission,
            playerId: this.playerOf(client)?.id, players: this.players, log: this.log, seq: this.log.length, hash: this.battle.hash() };
    }
    connectedPlayers() { return this.players.filter(p => p.connected); }
    playerOf(client) { return this.players.find(p => p.sessionId === client.sessionId) || null; }
    onJoin(client, options = {}) {
        this.autoDispose = true;
        const seat = this.roster?.find(s=>s.ticket===options.ticket);
        if (seat && this.players.some(p=>p.id===seat.id)) throw new colyseus.ServerError(4214,'Seat already occupied');
        const player = { connected: true, id: seat?.id || `P${this.nextPlayer++}`, sessionId: client.sessionId, name: String(options.name || 'Player').slice(0, 24), support: options.support === 'orbital_laser' ? 'orbital_laser' : (this.desc.support || 'carpet_bomb') };
        if(this.players.length>=this.battle.units.filter(u=>u.side==='player').length)throw new colyseus.ServerError(4212,'No squad slot available');
        this.players.push(player);
        // Deal units first so the joining peer's init log already contains the ownership intent.
        this.reassignOwners();
        client.send('init', this.snapshot(client));
    }
    async onLeave(client, consented) {
        const p = this.playerOf(client);
        if (!consented && p) {
            p.connected = false;
            this.votes.delete(p.id);
            this.reassignOwners();
            this.maybeEndPlayerTurn();
            try {
                const restored = await this.allowReconnection(client, 60);
                p.connected = true;
                p.sessionId = restored.sessionId;
                this.reassignOwners();
                restored.send('snapshot', this.snapshot(restored));
                return;
            } catch { /* timed out */ }
        }
        this.players = this.players.filter(x => x.sessionId !== client.sessionId);
        this.votes.delete(p?.id);
        this.reassignOwners();
        this.maybeEndPlayerTurn();
    }
    /** Deal living squad units round-robin to connected players (a lockstep intent, so every peer agrees). */
    reassignOwners() {
        const connected = this.connectedPlayers();
        if (!connected.length) { this.broadcast('players', { players: this.players }); return; }
        const owners = {};
        this.battle.units.filter(u => u.side === 'player').forEach((u, i) => { owners[u.id] = connected.some(p=>p.id===this.launchOwners?.[u.id]) ? this.launchOwners[u.id] : connected[i % connected.length].id; });
        this.commit({ type: 'owners', owners, supports:Object.fromEntries(connected.map(p=>[p.id,p.support])) });
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
        const player = this.playerOf(client);
        if (!player?.connected) return;
        const nonce = m?.nonce;
        const reject = reason => client.send('reject', { nonce, reason });
        if (typeof nonce !== 'string' || nonce.length < 1 || nonce.length > 128 || !m.intent || typeof m.intent !== 'object' || Array.isArray(m.intent)) return reject('bad_command');
        const key = `${player.id}:${nonce}`;
        const fingerprint = JSON.stringify(m.intent);
        const prior = this.receipts.get(key);
        if (prior) {
            if (prior.fingerprint !== fingerprint) return reject('nonce_reused');
            client.send('receipt', prior.result);
            return;
        }
        if (this.receipts.size >= 20000) return reject('command_limit');
        if (m.expectedSeq !== this.log.length) return reject('stale_command');
        // Reserve the nonce before executing so retries cannot repeat votes, AP costs, or AI turns.
        const before = this.log.length;
        this.receipts.set(key, { fingerprint, result: { nonce, ok: false, reason: 'rejected', events: [] } });
        this.executeIntent(client, m);
        const accepted = this.log.slice(before).find(entry => entry.nonce === nonce);
        const result = accepted ? { nonce, ok: true, events: [] } : this.receipts.get(key).result;
        this.receipts.get(key).result = result;
        client.send('receipt', result);
    }
    rejectCommand(client, nonce, reason) {
        const key = `${this.playerOf(client)?.id}:${nonce}`;
        const receipt = this.receipts.get(key);
        if (receipt) receipt.result = { nonce, ok: false, reason, events: [] };
        client.send('reject', { nonce, reason });
    }
    executeIntent(client, m) {
        const p = this.playerOf(client);
        const intent = { ...(m?.intent || {}), by: p?.id };
        if (!p || this.battle.outcome) return this.rejectCommand(client, m.nonce, 'battle_over' );
        if (intent.type === 'endTurn') {
            if (this.battle.activeSide !== 'player') return this.rejectCommand(client, m.nonce, 'not_your_turn' );
            if(this.battle.asyncCoop){
                const r=this.commit({type:'personalEnd',owner:p.id,by:p.id},m.nonce);
                if(!r.ok)return this.rejectCommand(client, m.nonce, r.reason);
                this.runEnemyTurn();return;
            }
            this.votes.add(p.id);
            if (this.votes.size < this.connectedPlayers().length) {
                this.broadcast('votes', { votes: [...this.votes], needed: this.connectedPlayers().length });
                return this.rejectCommand(client, m.nonce, 'waiting_for_team' );
            }
            return this.endPlayerTurn(m.nonce);
        }
        if (intent.type === 'debug' && p.id !== this.hostPlayer) return this.rejectCommand(client, m.nonce, 'not_your_unit' );
        if (['owners','personalEnd'].includes(intent.type) || !['move','shoot','melee','throw','overwatch','reload','gadget','wait','switchWeapon','ability','door','breach','formation','formation_break','face','extract','recover','debug'].includes(intent.type)) return this.rejectCommand(client, m.nonce, 'bad_intent' );
        const r = this.commit(intent, m.nonce);
        if (!r.ok) this.rejectCommand(client, m.nonce, r.reason );
    }
    maybeEndPlayerTurn() { if (this.battle.activeSide === 'player' && this.connectedPlayers().length && this.votes.size >= this.connectedPlayers().length) this.endPlayerTurn(null); }
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
