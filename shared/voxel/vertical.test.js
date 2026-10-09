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
