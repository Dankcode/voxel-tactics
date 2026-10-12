import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import colyseus from 'colyseus';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { Client } from 'colyseus.js';
import { StagingRoom } from '../src/StagingRoom.js';
import { MissionRoom } from '../src/MissionRoom.js';
import { OnlineSession } from '../../client/src/net/OnlineSession.js';
import { CONTENT_CONTRACT } from '../../shared/session/ContentContract.js';
const next=(room,type)=>new Promise(r=>room.onMessage(type,r));
async function eventually(fn) {for(let i=0;i<250;i++){if(fn())return;await new Promise(r=>setTimeout(r,20));}assert.ok(fn());}
test('separate staging validates drafts and launches immediately without readiness', {timeout:30000},async()=>{
    const server=http.createServer(),gs=new colyseus.Server({transport:new WebSocketTransport({server})});
    gs.define('staging',StagingRoom);gs.define('mission',MissionRoom);await new Promise(r=>server.listen(0,'127.0.0.1',r));
    const url=`ws://127.0.0.1:${server.address().port}`,client=new Client(url);let a,b,sa,sb;
    try {
        a=await client.create('staging',{contract:CONTENT_CONTRACT,desc:{scenario:'proving-grounds',seed:27}});
        let state; a.onMessage('state',m=>state=m);a.onMessage('seat',()=>{});a.onMessage('error',()=>{});
        await eventually(()=>state);
        b=await client.joinById(a.roomId,{contract:CONTENT_CONTRACT});b.onMessage('state',()=>{});b.onMessage('seat',()=>{});b.onMessage('error',()=>{});
        await eventually(()=>state.seats.length===2);
        let error=next(b,'error');b.send('configure',{desc:{seed:4}});assert.match((await error).message,/Only the host/);
        error=next(a,'error');a.send('configure',{desc:{scenario:'proving-grounds',inventories:[[{id:'kit',itemId:'medkit',x:5,y:4,rotated:false}]]}});assert.match((await error).message,/outside pack/);assert.equal(state.desc.seed,27);
        const revision=state.revision;
        a.send('draft',{index:0,owner:'P2'});await eventually(()=>state.revision>revision);assert.ok(state.seats.every(s=>!s.ready));
        // Launch while every seat is still unready: testing must not wait on party votes.
        const launchA=next(a,'launched'),launchB=next(b,'launched');a.send('launch');const [la,lb]=await Promise.all([launchA,launchB]);
        assert.equal(la.roomId,lb.roomId);assert.equal(la.owners.p0,'P2');assert.notEqual(la.ticket,lb.ticket);
        await assert.rejects(client.joinById(la.roomId,{contract:CONTENT_CONTRACT}),/Staging seat required/);
        // Join in reverse order: draft identities are preserved rather than assigned by connection order.
        sb=await OnlineSession.connect({url,roomId:lb.roomId,ticket:lb.ticket});sa=await OnlineSession.connect({url,roomId:la.roomId,ticket:la.ticket});
        await eventually(()=>sa.seq===sb.seq);assert.equal(sb.playerId,'P2');assert.equal(sa.playerId,'P1');assert.equal(sa.battle.unit('p0').owner,'P2');assert.equal(sa.battle.hash(),sb.battle.hash());
        error=next(a,'error');a.send('configure',{desc:{seed:123}});assert.match((await error).message,/frozen/);
    }finally{a?.leave();b?.leave();sa?.leave();sb?.leave();await gs.gracefullyShutdown(false);}
});
