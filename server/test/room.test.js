import { CONTENT_CONTRACT } from '../../shared/session/ContentContract.js';
import { unpackMission } from '../../shared/session/MissionSnapshot.js';
// Lockstep co-op protocol: two clients join, units are dealt, intents are ordered and validated,
// both peers' battles reach the server's hash, the squad turn ends on both votes, AI turn streams.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import colyseus from 'colyseus';
import { WebSocketTransport } from '@colyseus/ws-transport';
import * as ColyseusClient from 'colyseus.js';
const Client = { Client: class extends ColyseusClient.Client {
    track(room) {
        let seq = 0;
        room.onMessage('init', m => { seq = Math.max(seq, m.seq); });
        room.onMessage('intent', m => { seq = Math.max(seq, m.seq); });
        room.onMessage('receipt', () => {});
        const send = room.send.bind(room);
        room.send = (type, data) => send(type, type === 'intent' ? { expectedSeq: seq, ...data } : data);
        return room;
    }
    async create(...args) { return this.track(await super.create(...args)); }
    async joinById(...args) { return this.track(await super.joinById(...args)); }
} };
import { MissionRoom } from '../src/MissionRoom.js';
import { createBattle } from '../../shared/session/Scenarios.js';

async function startServer() {
    const server = http.createServer();
    const gs = new colyseus.Server({ transport: new WebSocketTransport({ server }) });
    gs.define('mission', MissionRoom);
    await new Promise(r => server.listen(0, r));
    return { gs, port: server.address().port, close: () => gs.gracefullyShutdown(false) };
}
const next = (room, type) => new Promise(r => room.onMessage(type, r));

for (const scenario of ['proving-grounds', 'signal-house', 'operation']) test(`two players share a squad in lockstep through an AI turn on ${scenario}`, { timeout: 60000 }, async () => {
    const srv = await startServer();
    try {
        const url = `ws://127.0.0.1:${srv.port}`;
        const a = new Client.Client(url), b = new Client.Client(url);
        const mirror = room => {
            const p = { early: [], hashes: [], rejects: [] };
            room.onMessage('intent', m => (p.battle ? apply(p, m) : p.early.push(m)));
            room.onMessage('hash', m => p.hashes.push(m));
            room.onMessage('reject', m => p.rejects.push(m));
            room.onMessage('players', () => {}); room.onMessage('votes', () => {});
            p.init = new Promise(r => room.onMessage('init', init => {
                p.battle = createBattle(init.desc,unpackMission(init.mission)); p.seq = 0; p.id = init.playerId;
                for (const m of [...init.log, ...p.early]) apply(p, m);
                r(init);
            }));
            return p;
        };
        const apply = (p, m) => { if (m.seq > p.seq) { p.seq = m.seq; p.battle.apply(m.intent); } };
        const roomA = await a.create('mission', { contract: CONTENT_CONTRACT, desc: { scenario, seed: 4, squad: 'standard', inventories:[[{id:'kit',itemId:'medkit',x:0,y:0,rotated:true},{id:'smoke',itemId:'smoke_pot',x:0,y:3,rotated:false}]] }, name: 'A' });
        const pa = mirror(roomA); const initA = await pa.init;
        const roomB = await b.joinById(roomA.roomId, { contract: CONTENT_CONTRACT, name: 'B' });
        const pb = mirror(roomB); const initB = await pb.init;
        assert.equal(initA.playerId, 'P1'); assert.equal(initB.playerId, 'P2');
        const peers = [pa, pb];
        for(const peer of peers){assert.equal(peer.battle.unit('p0').items.medkit,1);assert.equal(peer.battle.unit('p0').inventory[0].rotated,true);}
        await new Promise(r => setTimeout(r, 300));
        // Ownership was dealt round-robin: P1 has p0,p2; P2 has p1,p3.
        assert.equal(peers[0].battle.unit('p0').owner, 'P1');
        assert.equal(peers[0].battle.unit('p1').owner, 'P2');
        // P2 cannot move P1's soldier.
        roomB.send('intent', { nonce: 'x1', intent: { type: 'move', unitId: 'p0', to: { x: 22, y: 40, z: 1 } } });
        await new Promise(r => setTimeout(r, 200));
        assert.equal(peers[1].rejects[0]?.reason, 'not_your_unit');
        // P1 moves its own soldier to a reachable, unoccupied cell on either map.
        const soldier=peers[0].battle.unit('p0');
        const destination=[...peers[0].battle.reach(soldier,3).nodes.values()].find(n=>(n.x!==soldier.x||n.y!==soldier.y)&&!peers[0].battle.occupant(n.x,n.y,n.z));
        assert.ok(destination);
        roomA.send('intent', { nonce: 'x2', intent: { type: 'move', unitId: 'p0', to: { x:destination.x,y:destination.y,z:destination.z } } });
        await new Promise(r => setTimeout(r, 300));
        assert.deepEqual(peers.map(p=>[p.battle.unit('p0').x,p.battle.unit('p0').y,p.battle.unit('p0').z]),[[destination.x,destination.y,destination.z],[destination.x,destination.y,destination.z]]);
        // New HUD commands are authoritative intents too: ammo moves, fire mode, and shared block marks.
        for(const [nonce,intent] of [
            ['cargo',{type:'inventoryMove',unitId:'p0',from:'rig',to:'pockets',itemId:'reserve-shotgun',x:0,y:0,rotated:false}],
            ['mode',{type:'setFireMode',unitId:'p0',mode:'single'}],
            ['mark',{type:'mark',unitId:'p0',color:'blue',at:{x:soldier.x,y:soldier.y,z:soldier.z}}],
            ['plan',{type:'formation_plan',unitId:'p0',template:'wedge',facing:'n'}]
        ]){
            const received=next(roomA,'receipt');roomA.send('intent',{nonce,intent});assert.ok((await received).ok,nonce);
        }
        await new Promise(r=>setTimeout(r,100));
        for(const peer of peers){assert.equal(peer.battle.unit('p0').pocketInventory[0].itemId,'ammo_shotgun');assert.equal(peer.battle.markers.at(-1).color,'blue');assert.equal(peer.battle.formations.of(peer.battle.unit('p0')).template,'wedge');}
        // Rotate and move a real grenade, then consume that exact slot on both peers.
        for(const [nonce,intent] of [
            ['move-grenade',{type:'inventoryMove',unitId:'p0',from:'backpack',to:'rig',itemId:'smoke',x:2,y:1,rotated:true}],
            ['throw-grenade',{type:'throw',unitId:'p0',itemId:'smoke_pot',cargo:{path:'rig',id:'smoke'},to:{x:soldier.x,y:soldier.y,z:soldier.z}}]
        ]){const receipt=next(roomA,'receipt');roomA.send('intent',{nonce,intent});assert.ok((await receipt).ok,nonce);}
        await new Promise(r=>setTimeout(r,100));
        for(const peer of peers){assert.ok(!peer.battle.unit('p0').rigInventory.some(s=>s.id==='smoke'));assert.equal(peer.battle.unit('p0').items.smoke_pot,undefined);}
        assert.equal(peers[0].battle.hash(),peers[1].battle.hash());
        // End turn needs both votes; then the server streams the AI turn.
        roomA.send('intent', { nonce: 'e1', intent: { type: 'endTurn', side: 'player' } });
        await new Promise(r => setTimeout(r, 200));
        assert.equal(peers[0].battle.activeSide, 'player');
        roomB.send('intent', { nonce: 'e2', intent: { type: 'endTurn', side: 'player' } });
        await new Promise(r => setTimeout(r, 1500));
        assert.equal(peers[0].battle.activeSide, 'player', 'AI turn finished and handed back');
        assert.equal(peers[0].battle.round, 2);
        const last = peers[0].hashes.at(-1);
        assert.equal(peers[0].battle.hash(), last.hash, 'peer A in sync with server');
        assert.equal(peers[1].battle.hash(), last.hash, 'peer B in sync with server');
        await roomA.leave(); await roomB.leave();
    } finally { await srv.close(); }
});

test('debug co-op is opt-in, host-only, and broadcasts replayable debug intents', { timeout: 30000 }, async () => {
    const srv = await startServer();
    try {
        const client = new Client.Client(`ws://127.0.0.1:${srv.port}`);
        const host = await client.create('mission', { contract: CONTENT_CONTRACT, desc: { scenario: 'proving-grounds', seed: 2, debug: true } });
        host.onMessage('players', () => {}); host.onMessage('votes', () => {});
        const hostState = await next(host, 'init');
        assert.equal(hostState.desc.debug, true);
        const mirror = createBattle(hostState.desc,unpackMission(hostState.mission));
        for (const entry of hostState.log) assert.ok(mirror.apply(entry.intent).ok);
        const hashes = []; host.onMessage('hash', m => hashes.push(m));
        host.onMessage('intent', m => { assert.ok(mirror.apply(m.intent).ok); });
        const guest = await client.joinById(host.roomId, { contract: CONTENT_CONTRACT, name: 'Guest' });
        guest.onMessage('intent', () => {}); guest.onMessage('hash', () => {}); guest.onMessage('players', () => {});
        const guestState = await next(guest, 'init');
        assert.equal(guestState.desc.debug, true);
        const rejected = next(guest, 'reject');
        guest.send('intent', { nonce: 'guest-debug', intent: { type: 'debug', op: 'status', unitId: 'p0', status: 'wet' } });
        assert.equal((await rejected).reason, 'not_your_unit');
        const accepted = next(host, 'intent');
        host.send('intent', { nonce: 'host-debug', intent: { type: 'debug', op: 'status', unitId: 'p0', status: 'wet' } });
        const entry = await accepted;
        assert.equal(entry.intent.type, 'debug'); assert.equal(entry.intent.by, 'P1');
        await new Promise(r => setTimeout(r, 100));
        assert.ok(mirror.unit('p0').statuses.some(s => s.id === 'wet'));
        assert.equal(mirror.hash(), hashes.at(-1).hash);
        await host.leave(); await guest.leave();
    } finally { await srv.close(); }
});


test('room creation rejects malformed packs with a readable inventory error', {timeout:15000},async()=>{
 const srv=await startServer();try{
  const client=new Client.Client(`ws://127.0.0.1:${srv.port}`);
  await assert.rejects(client.create('mission',{ contract: CONTENT_CONTRACT,desc:{scenario:'operation',inventories:[[{id:'kit',itemId:'medkit',x:5,y:4,rotated:false}]]}}),error=>error.code===4211&&/soldier 1: Item outside pack/.test(error.message));
 }finally{await srv.close();}
});

test('four asynchronous peers act independently, reject forged turns, and replay identical hashes', {timeout:30000},async()=>{
    const srv=await startServer(),rooms=[],peers=[];
    try {
        const client=new Client.Client(`ws://127.0.0.1:${srv.port}`);
        for(let i=0;i<4;i++) {
            const room=i?await client.joinById(rooms[0].roomId,{ contract: CONTENT_CONTRACT,support:'orbital_laser'}):await client.create('mission',{ contract: CONTENT_CONTRACT,desc:{scenario:'proving-grounds',seed:4,intel:true,asyncCoop:true}});
            rooms.push(room);const peer={seq:0,early:[],hashes:[]};peers.push(peer);
            const apply=m=>{if(!peer.battle){peer.early.push(m);return;}if(m.seq>peer.seq){assert.equal(m.seq,peer.seq+1);assert.ok(peer.battle.apply(m.intent).ok);peer.seq=m.seq;}};
            room.onMessage('intent',apply);room.onMessage('hash',m=>peer.hashes.push(m));room.onMessage('players',()=>{});room.onMessage('votes',()=>{});room.onMessage('reject',()=>{});
            const init=await next(room,'init');peer.battle=createBattle(init.desc,unpackMission(init.mission));peer.id=init.playerId;
            for(const m of [...init.log,...peer.early])apply(m);
        }
        const accepted=async(room,nonce,intent)=>{await new Promise(r=>setTimeout(r,50));return new Promise(resolve=>{room.onMessage('intent',m=>{if(m.nonce===nonce)resolve(m);});room.send('intent',{nonce,intent});});};
        await accepted(rooms[1],'p2-wait',{type:'wait',unitId:'p1'});
        // P1 can complete and refresh while P2, P3 and P4 never vote.
        await accepted(rooms[0],'p1-end',{type:'endTurn',side:'player'});
        await new Promise(r=>setTimeout(r,150));
        for(const p of peers){assert.equal(p.battle.round,2);assert.equal(p.battle.unit('p1').ap,0);assert.equal(p.battle.personalTurns.P1,1);assert.equal(p.battle.unit('p0').ap,4);assert.equal(p.battle.supportChoices.P2,'orbital_laser');}
        const rejected=next(rooms[1],'reject');rooms[1].send('intent',{nonce:'forged',intent:{type:'personalEnd',owner:'P1'}});assert.equal((await rejected).reason,'bad_intent');
        await accepted(rooms[2],'p3-sense',{type:'ability',unitId:'p2',abilityId:'scout_drone',to:{x:peers[2].battle.unit('p2').x,y:peers[2].battle.unit('p2').y,z:peers[2].battle.unit('p2').z}});
        await new Promise(r=>setTimeout(r,100));
        const hash=peers[0].hashes.at(-1).hash;for(const p of peers)assert.equal(p.battle.hash(),hash);
        for(const room of rooms)await room.leave();
    }finally{await srv.close();}
});
