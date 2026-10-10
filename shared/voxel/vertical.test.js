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
test('hand-built maps preserve their datum and material hashes',()=>{
 const hashes={'cedar-close':'34ffd992','main-street':'7cde5c80','harbor-yard':'68c840fa','route-9':'7934db8b','proving-grounds':'c1e20a26'};
 for(const [id,hash] of Object.entries(hashes))assert.equal(MAPS.find(m=>m.id===id).build({seed:1}).store.hash(),hash);
});
import { reachable, nodeKey } from '../world/PathSearch.js';
import { AGENT_PROFILES } from '../world/TraversalRules.js';
import { settleUnsupported } from './Destruction.js';
import { coverAt, COVER } from './Cover.js';
test('supported escape reaches every upper floor and roof without the interior stairs; posts can drop it',()=>{
 const m=MAPS.find(m=>m.id==='signal-house').build({seed:1}),b=m.buildings[0];
 const reach=reachable(m.store,m.spawns.player[0],Infinity,AGENT_PROFILES.player,{blocked:p=>b.stairs.some(r=>r.cells.some(c=>nodeKey(c)===nodeKey(p)))});
 for(const e of b.escapes)assert.ok(reach.costs.has(nodeKey(e.landing)),`landing ${e.floor}`);
 const group=m.store.supportGroups[0];assert.equal(group.posts.length,2);
 for(const p of group.posts)m.store.set(...p,0);settleUnsupported(m.store);
 assert.equal(m.store.get(...group.members.at(-1)),0);assert.ok(m.store.isSolid(b.x0+8,b.y0+2,10));
 const t=createMap({id:'rail',width:10,depth:10});t.store.fill(5,3,2,5,5,2,'railing');assert.equal(coverAt(t.store,4,4,1).e,COVER.HALF);
});
test('generated street datum leaves three underground voxels and keeps compilation deterministic',()=>{
 const map=MAPS.find(m=>m.id==='cedar-image'),a=map.build({seed:1}),b=map.build({seed:1});
 assert.equal(a.meta.streetDatum,4);assert.ok(a.spawns.player.every(p=>p.z===4));assert.equal(a.store.hash(),b.store.hash());assert.equal(a.buildings[0].baseZ,4);
});
