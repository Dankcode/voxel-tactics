import test from 'node:test';
import assert from 'node:assert/strict';
import { createMap } from '../mission/modern/MapKit.js';
import { ladderAttachment, validateLadders } from '../world/LadderAttachment.js';
import { MAT } from './Materials.js';
import { MAPS } from '../mission/Maps.js';
test('ladder columns require one continuous backing side',()=>{
 const m=createMap({id:'ladder-test',width:10,depth:10,height:12});
 m.store.set(5,5,5,MAT.concrete);assert.throws(()=>m.ladder(4,5,1,0),/attachment/);
 m.store.fill(5,5,2,5,5,5,'concrete');m.ladder(4,5,1,0);assert.deepEqual(ladderAttachment(m.store,4,5,3),[1,0]);assert.ok(validateLadders(m.store));
 m.store.set(5,5,3,0);assert.throws(()=>validateLadders(m.store),/attachment/);
});
test('hand-built maps preserve their datum and deterministic hashes with walk-through glass, reserved window landings and retired ornamental cover',()=>{
 const hashes={'cedar-close':'b0d2dabb','main-street':'6334ece8','harbor-yard':'e4cf22b4','route-9':'8288592f','proving-grounds':'007a460d'};
 for(const [id,hash] of Object.entries(hashes))assert.equal(MAPS.find(m=>m.id===id).build({seed:1}).store.hash(),hash);
});
import { reachable, nodeKey } from '../world/PathSearch.js';
import { AGENT_PROFILES } from '../world/TraversalRules.js';
import { settleUnsupported } from './Destruction.js';
import { coverAt, COVER } from './Cover.js';
test('the ladder fire escape reaches every floor and roof, with supported platforms',()=>{
 const m=MAPS.find(m=>m.id==='signal-house').build({seed:1}),b=m.buildings[0];
 const reach=reachable(m.store,m.spawns.player[0],Infinity,AGENT_PROFILES.player,{jump:false,blocked:p=>b.stairs.some(r=>r.cells.some(c=>nodeKey(c)===nodeKey(p)))});
 for(const e of b.escapes)assert.ok(reach.costs.has(nodeKey(e.landing)),`landing ${e.floor}`);
 const groups=m.store.supportGroups;assert.equal(groups.length,b.storeys);assert.ok(groups.every(g=>g.columns.length===0&&g.anchors.some(p=>m.store.isSolid(...p))));
 const hash=m.store.hash();assert.equal(settleUnsupported(m.store).removed,0);assert.equal(m.store.hash(),hash);
 // Remove a platform’s facade anchors: that platform falls while the building stands.
 const target=groups[0];for(const anchor of target.anchors)m.store.set(...anchor,0);settleUnsupported(m.store);
 assert.ok(target.members.every(q=>m.store.get(...q)===0));assert.ok(m.store.isSolid(b.x0+8,b.y0+2,10));
 const t=createMap({id:'rail',width:10,depth:10});t.store.fill(5,3,2,5,5,2,'railing');assert.equal(coverAt(t.store,4,4,1).e,COVER.HALF);
});
test('generated street datum leaves three underground voxels and keeps compilation deterministic',()=>{
 const map=MAPS.find(m=>m.id==='cedar-image'),a=map.build({seed:1}),b=map.build({seed:1});
 assert.equal(a.meta.streetDatum,4);assert.ok(a.spawns.player.every(p=>p.z===4));assert.equal(a.store.hash(),b.store.hash());assert.equal(a.buildings[0].baseZ,4);
});
import { createBattle } from '../session/Scenarios.js';
import { canJumpDown } from '../world/PathSearch.js';
test('a floor charge consumes one item/AP and opens a 2×2 controlled drop',()=>{
 const b=createBattle({scenario:'signal-house',seed:1,debug:true}),u=b.units[0];u.items.breach_charge=1;u.ap=4;
 const room=b.mission.rooms.find(r=>r.gameplay&&r.storey===1&&r.kind!=='hall'),[x,y]=room.cells.find(([x,y])=>b.store.surfaces(x,y).some(s=>s.z===4));
 // Isolate a clear slab and landing, retaining the rest of the real building.
 for(let dy=0;dy<2;dy++)for(let dx=0;dx<2;dx++){b.store.set(x+dx,y+dy,7,MAT.oak_floor);for(let z=5;z<=6;z++)b.store.set(x+dx,y+dy,z,0);}
 u.x=x-1;u.y=y;u.z=7;for(let z=8;z<=9;z++)b.store.set(u.x,u.y,z,0);b.store.set(u.x,u.y,7,MAT.oak_floor);
 const intent={type:'breach',unitId:u.id,unitIds:[u.id],door:{x,y,z:7},entry:'floor'};assert.equal(b.validate(intent),null);b.doBreach(intent);
 assert.equal(u.items.breach_charge,0);assert.equal(u.ap,3);assert.deepEqual(canJumpDown(b.store,u,1,0),{x,y,z:4});assert.ok(b.store.isSolid(b.mission.buildings[0].x0+8,b.mission.buildings[0].y0+2,10));
});
