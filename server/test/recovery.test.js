import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import colyseus from 'colyseus';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { Client } from 'colyseus.js';
import { MissionRoom } from '../src/MissionRoom.js';
import { OnlineSession } from '../../client/src/net/OnlineSession.js';
import { CONTENT_CONTRACT } from '../../shared/session/ContentContract.js';
import { replayBattle } from '../../shared/session/BattleReplay.js';
const delay = ms => new Promise(r => setTimeout(r, ms));
async function until(predicate) {
    for (let i=0;i<250;i++) { if (predicate()) return; await delay(20); }
    assert.ok(predicate(), 'condition reached before timeout');
}
const message = (room,type) => new Promise(r => room.onMessage(type,r));
async function setup() {
    const server=http.createServer(); const gs=new colyseus.Server({transport:new WebSocketTransport({server})});
    gs.define('mission',MissionRoom); await new Promise(r=>server.listen(0,'127.0.0.1',r));
    return {url:`ws://127.0.0.1:${server.address().port}`,close:()=>gs.gracefullyShutdown(false)};
}
test('online peers reject stale/forged commands, deduplicate actions, and recover all state', {timeout:30000}, async()=>{
    const srv=await setup();let a,b;
    try {
        await assert.rejects(new Client(srv.url).create('mission',{contract:{protocol:2,content:'old'}}),/Incompatible game content/);
        a=await OnlineSession.connect({url:srv.url,desc:{scenario:'proving-grounds',seed:4,debug:true}});
        b=await OnlineSession.connect({url:srv.url,roomId:a.roomId});
        await until(()=>a.seq===b.seq);
        const hash=a.battle.hash();
        const bad=await b.submit({type:'ability',unitId:'p1',abilityId:'earth_cover',to:{x:1,y:1,z:1}});
        assert.equal(bad.ok,false);assert.equal(a.battle.hash(),hash);
        const forged=await b.submit({type:'overwatch',unitId:'p1',weaponId:'made-up',toward:{x:0,y:0}});
        assert.equal(forged.ok,false);assert.equal(a.battle.hash(),hash);
        assert.equal((await b.submit({type:'wait',unitId:'p0'})).reason,'not_your_unit');
        // Exercise the elemental changes on two real peers before testing replay recovery.
        const u=a.battle.unit('p0');let cover=null;
        for(let dx=-4;dx<=4&&!cover;dx++)for(let dy=-4;dy<=4&&!cover;dy++) {
            const candidate={type:'ability',unitId:u.id,abilityId:'earth_cover',to:{x:u.x+dx,y:u.y+dy,z:u.z},by:a.playerId};
            if(!a.battle.validate(candidate))cover=candidate;
        }
        assert.ok(cover,'supported cover tile exists');assert.ok((await a.submit(cover)).ok);
        await until(()=>a.seq===b.seq);assert.equal(a.battle.hash(),b.battle.hash());
        assert.ok((await a.submit({type:'overwatch',unitId:'p2',weaponId:'longrifle',toward:{x:a.battle.unit('p2').x+10,y:a.battle.unit('p2').y}})).ok);
        await until(()=>a.seq===b.seq);
        const command={nonce:'once' ,expectedSeq:a.seq,intent:{type:'wait',unitId:'p0'}};
        let receipt=message(a.room,'receipt');a.room.send('intent',command);assert.equal((await receipt).ok,true);
        await until(()=>a.seq===b.seq);const seq=a.seq,after=a.battle.hash();
        receipt=message(a.room,'receipt');a.room.send('intent',command);assert.equal((await receipt).ok,true);
        assert.equal(a.seq,seq);assert.equal(a.battle.hash(),after);
        let reject=message(a.room,'reject');a.room.send('intent',{...command,intent:{type:'wait',unitId:'p2'}});assert.equal((await reject).reason,'nonce_reused');
        reject=message(a.room,'reject');a.room.send('intent',{nonce:'stale',expectedSeq:0,intent:{type:'wait',unitId:'p2'}});assert.equal((await reject).reason,'stale_command');
        await until(()=>a.state==='connected');
        // Damage/status changes are authoritative commands, never direct edits to the server.
        const target=a.battle.unit('p1');
        assert.ok((await a.submit({type:'debug',op:'explode',at:{x:target.x+.5,y:target.y+.5,h:target.z+1.5},radius:1,power:0,damage:5})).ok);
        await until(()=>a.seq===b.seq);
        const injured=b.battle.unit('p1').hp;assert.ok(injured<target.maxHp);
        assert.ok((await b.submit({type:'ability',unitId:'p1',abilityId:'water_mend',targetId:'p1'})).ok);
        await until(()=>a.seq===b.seq);assert.ok(b.battle.unit('p1').hp>injured);
        assert.ok(!b.battle.unit('p1').statuses.some(s=>s.id==='burning'));
        await until(()=>a.seq===b.seq);
        const snapshotPromise=message(a.room,'snapshot');a.room.send('sync');const snapshot=await snapshotPromise;
        const restored=replayBattle(snapshot);assert.equal(restored.hash(),b.battle.hash());restored.light.dispose();
        assert.throws(()=>replayBattle({...snapshot,mapHash:'corrupt'}),/Map package hash/);
        await until(()=>a.state==='connected');
        b.battle.unit('p1').hp=1; b.recover();await until(()=>b.state==='connected');
        assert.equal(b.battle.hash(),a.battle.hash());
        // A dropped peer's seats immediately move to the connected peer; reconnect restores them.
        let disconnected=false, reassigned=false;
        a.room.onMessage('players',m=>{if(m.players.some(p=>p.id==='P2'&&!p.connected)){disconnected=true;reassigned=a.battle.unitsOf('player').every(u=>u.owner==='P1');}});
        b.room.connection.close(4001);
        await until(()=>disconnected);
        assert.ok(reassigned);
        await until(()=>b.state==='connected'&&a.players.every(p=>p.connected)&&a.seq===b.seq);
        assert.equal(b.playerId,'P2');assert.equal(a.battle.hash(),b.battle.hash());
        const vote=await a.submit({type:'endTurn'});assert.equal(vote.reason,'waiting_for_team');
        await b.leave();await until(()=>a.battle.round===2);
        assert.ok(a.battle.unitsOf('player').every(u=>u.owner==='P1'));
    } finally {a?.leave();b?.leave();await srv.close();}
});
