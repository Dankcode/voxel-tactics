import test from 'node:test';
import assert from 'node:assert/strict';
import { createBattle, sanitizeDesc } from '../session/Scenarios.js';
import { packMission,unpackMission } from '../session/MissionSnapshot.js';
test('compiled mission snapshot survives wire serialization with exact voxels, HP, rooms, metadata and battle hash',()=>{
 const desc={scenario:'proving-grounds',seed:2},a=createBattle(desc),packed=packMission(a.mission);
 // MessagePack retains Infinity, unlike JSON; structured clone exercises the portable data structure.
 const b=createBattle(desc,unpackMission(structuredClone(packed)));
 assert.deepEqual(b.store.mat,a.store.mat);assert.deepEqual(b.store.hp,a.store.hp);assert.deepEqual(b.store.rooms,a.store.rooms);assert.deepEqual(b.store.supportGroups||[],a.store.supportGroups||[]);assert.equal(b.hash(),a.hash());
});
test('bad descriptors reject inventories before building a mission, with a soldier-specific explanation',()=>{
 assert.throws(()=>sanitizeDesc({inventories:[[{id:'x',itemId:'medkit',x:5,y:4,rotated:false}]]}),/soldier 1: Item outside pack/);
 assert.throws(()=>sanitizeDesc({inventories:'bad'}),/expected one pack/);
 assert.throws(()=>sanitizeDesc({squad:['not-a-class']}),/Invalid squad/);
 // Equipment choice is intentionally free across classes; geometric capacity is the limit.
 assert.equal(sanitizeDesc({squad:['vanguard'],inventories:[[{id:'x',itemId:'breach_charge',x:0,y:0,rotated:false}]]}).inventories[0][0].itemId,'breach_charge');
});
