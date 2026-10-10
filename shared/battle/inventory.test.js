import test from 'node:test';
import assert from 'node:assert/strict';
import { packItems, validateInventory, footprint } from '../inventory/Inventory.js';
import { CLASSES, ENEMIES } from '../content/units.js';
import { Battle } from './Battle.js';
import { VoxelStore } from '../voxel/VoxelStore.js';
import { MAT } from '../voxel/Materials.js';
const slot=(id,itemId,x,y,rotated=false)=>({id,itemId,x,y,rotated});
test('all default kits fit; rotated footprints enforce boundaries and overlap',()=>{
 for(const def of [...Object.values(CLASSES),...Object.values(ENEMIES)])assert.equal(validateInventory(packItems(def.items)),null);
 const a=slot('a','medkit',0,0,true);assert.deepEqual(footprint(a),{w:3,h:2});
 assert.equal(validateInventory([a,slot('b','water_flask',2,1)]),'Items overlap');
 assert.equal(validateInventory([slot('b','breach_charge',5,4)]),'Item outside pack');
 assert.equal(validateInventory([a,slot('a','water_flask',4,0)]),'Invalid item');
 assert.equal(validateInventory([slot('b','unknown',0,0)]),'Invalid item');
 for(const item of ['__proto__','constructor','toString'])assert.equal(validateInventory([slot('b',item,0,0)]),'Invalid item');
});
function fixture(){const store=new VoxelStore(12,12,6);for(let y=0;y<12;y++)for(let x=0;x<12;x++)store.set(x,y,1,MAT.grass);return new Battle({mission:{id:'pack',store,rooms:[{id:0,floorZ:1,cells:[[7,5]]}],buildings:[],spawns:{player:[{x:3,y:5,z:1}],enemy:[{type:'cultist',pos:{x:7,y:5,z:1},group:0}]}},squad:[{type:'vanguard',inventory:[slot('kit','medkit',0,0),slot('smoke','smoke_pot',3,0)]}],seed:1});}
test('prepared pack is authoritative and medical gadget heals once, spends AP and removes its footprint',()=>{
 const b=fixture(),u=b.unit('p0');assert.deepEqual(u.items,{medkit:1,smoke_pot:1});u.hp-=12;
 assert.equal(b.apply({type:'throw',unitId:u.id,itemId:'medkit',to:u}).reason,'no_item');
 assert.ok(b.apply({type:'gadget',unitId:u.id,itemId:'medkit',targetId:u.id}).ok);
 assert.equal(u.hp,u.maxHp-4);assert.equal(u.ap,3);assert.equal(u.items.medkit,0);assert.equal(u.inventory.length,1);
 const before=b.hash();assert.equal(b.apply({type:'gadget',unitId:u.id,itemId:'medkit',targetId:u.id}).reason,'no_item');assert.equal(b.hash(),before);
});
test('window reveals interior sightlines and enemies; opaque wall hides them again',()=>{
 const b=fixture(),u=b.unit('p0'),e=b.unit('e0');
 for(let y=0;y<12;y++)for(let z=2;z<6;z++)b.store.set(5,y,z,MAT.concrete);
 for(let z=2;z<4;z++)b.store.set(5,5,z,MAT.glass);
 b.updateVisibility({initial:true});assert.ok(b.sees(u,e));assert.ok(b.visible.has(e.id));assert.ok(b.visibleInterior.has('7,5,1'));assert.equal(b.revealedRooms.size,0);
 for(let z=2;z<4;z++)b.store.set(5,5,z,MAT.concrete);
 b.updateVisibility({initial:true});assert.equal(b.sees(u,e),false);assert.equal(b.visible.has(e.id),false);assert.equal(b.visibleInterior.has('7,5,1'),false);
});
