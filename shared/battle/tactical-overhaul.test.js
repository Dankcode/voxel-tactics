import test from 'node:test';
import assert from 'node:assert/strict';
import { Battle } from './Battle.js';
import { VoxelStore } from '../voxel/VoxelStore.js';
import { MAT } from '../voxel/Materials.js';
import { createRng } from '../util/Rng.js';
import { WEAPONS } from '../content/weapons.js';
import { fireMode, projectileDamage } from './FireControl.js';
import { reserveAmmo, carryWeight, storageOf, inventoryMove, grantTestArsenal, equipCargo, validateLoadout } from '../inventory/Equipment.js';
import { validateInventory, walkInventory } from '../inventory/Inventory.js';
import { visionProfile } from './WatchSector.js';
import { decide } from './Ai.js';
function arena(types=['grenadier']){
 const store=new VoxelStore(32,32,16);store.fill(0,0,0,31,31,1,'concrete');
 return new Battle({mission:{id:'new-tactics',name:'Test',store,rooms:[],buildings:[],rng:createRng(1),meta:{},objective:{kind:'eliminate'},spawns:{player:types.map((_,i)=>({x:12+i*2,y:23,z:1})),enemy:[{type:'cultist',group:0,pos:{x:12,y:10,z:1}},{type:'cultist',group:1,pos:{x:25,y:8,z:1}}]}},squad:types.map(type=>({type})),seed:2});
}
test('single, burst and auto spend 1/3/5 loaded rounds and trace one ray per AR bullet',()=>{
 for(const [mode,rounds] of [['single',1],['burst',3],['auto',5]]){const b=arena(),u=b.unit('p0');const ammo=u.ammo.repeater;assert.equal(fireMode(u,WEAPONS.repeater),'burst');const r=b.apply({type:'shoot',unitId:u.id,fireMode:mode,aim:{point:{x:12.5,y:3,h:2.1}}});assert.ok(r.ok);const shot=r.events.find(e=>e.t==='shot');assert.equal(shot.projectiles.length,rounds);assert.equal(u.ammo.repeater,ammo-rounds);}
});
test('partial final salvo fires remaining rounds; invalid modes and NaN aims never spend ammo',()=>{
 const b=arena(),u=b.unit('p0');u.ammo.repeater=2;assert.equal(b.apply({type:'shoot',unitId:u.id,fireMode:'unlimited',aim:{point:{x:12,y:3,h:2}}}).reason,'bad_intent');assert.equal(b.apply({type:'shoot',unitId:u.id,aim:{point:{x:NaN,y:3,h:2}}}).reason,'bad_intent');assert.equal(u.ammo.repeater,2);
 const r=b.apply({type:'shoot',unitId:u.id,fireMode:'auto',aim:{point:{x:12,y:3,h:2}}});assert.equal(r.events.find(e=>e.t==='shot').rounds,2);
});
test('caliber damage and falloff: shotgun pellets sum to one shell, armor absorbs only unpenetrated damage',()=>{
 for(const [id,close,far]of [['repeater',10,5],['longrifle',30,10],['blunderbuss',30,5],['firelance',30,5]]){const w=WEAPONS[id],n=w.pellets||1;assert.equal(Array.from({length:n},(_,i)=>projectileDamage(w,5,i)).reduce((a,b)=>a+b),close);assert.equal(Array.from({length:n},(_,i)=>projectileDamage(w,6,i)).reduce((a,b)=>a+b),far);}
 const b=arena(),e=b.unit('e0');e.parts.torso.armor=6;assert.equal(b.dealDamage(e,'torso',10,{pierce:2}),6);
});
test('reload transfers real reserve rounds; a bolt-action cycles a single round without reload',()=>{
 const b=arena(),u=b.unit('p0');u.ammo.repeater=0;const before=reserveAmmo(u,WEAPONS.repeater);assert.ok(b.apply({type:'reload',unitId:u.id}).ok);assert.equal(u.ammo.repeater,30);assert.equal(reserveAmmo(u,WEAPONS.repeater),before-30);
 u.rigInventory=[];u.ammo.repeater=0;assert.equal(b.apply({type:'reload',unitId:u.id}).reason,'no_ammo');
 const sniper=arena(['marksman']),s=sniper.unit('p0'),r=reserveAmmo(s,WEAPONS.longrifle);assert.equal(sniper.apply({type:'reload',unitId:s.id}).reason,'bad_intent');assert.ok(sniper.apply({type:'shoot',unitId:s.id,aim:{point:{x:12.5,y:3,h:2}}}).ok);assert.equal(s.ammo.longrifle,1);assert.equal(reserveAmmo(s,WEAPONS.longrifle),r-1);
});
test('persistent overwatch survives phase refresh, consumes ammo repeatedly, and breaks on wounds/status',()=>{
 const b=arena(['vanguard']),u=b.unit('p0');u.weapon='handcannon';assert.ok(b.apply({type:'overwatch',unitId:u.id,toward:{x:12,y:1}}).ok);b.startSide('player');assert.ok(u.overwatch);
 const e=b.unit('e0');e.hp=e.maxHp=500;e.parts.torso.hp=e.parts.torso.max=500;e.x=12;e.y=17;const before=u.ammo.handcannon;
 b.checkReactions(e,[e]);b.checkReactions(e,[e]);assert.ok(u.overwatch);assert.equal(u.ammo.handcannon,before-2);
 b.dealDamage(u,'torso',1,{pierce:99});assert.equal(u.overwatch,null);u.overwatch={weaponId:'handcannon'};b.giveStatus(u,'suppressed',2);assert.equal(u.overwatch,null);
});
test('nested rigs store real ammo, remain bounded and acyclic, and opening storage never mutates state',()=>{
 const b=arena(),u=b.unit('p0');u.inventory=[{id:'spare',itemId:'rig_scout',x:0,y:0,rotated:false}];const hash=b.hash();assert.deepEqual(storageOf(u,'backpack/spare').slots,[]);assert.equal(b.hash(),hash);
 const before=reserveAmmo(u,WEAPONS.repeater);assert.equal(inventoryMove(u,{from:'rig',to:'backpack/spare',itemId:'reserve-ar',x:0,y:0,rotated:false},true),null);assert.equal(reserveAmmo(u,WEAPONS.repeater),before);assert.equal(storageOf(u,'backpack/spare').slots[0].quantity,90);
 assert.notEqual(inventoryMove(u,{from:'backpack',to:'backpack/spare',itemId:'spare',x:0,y:0,rotated:false},true),null);
 assert.equal(validateInventory([{id:'a',itemId:'ammo_ar',quantity:999,x:0,y:0,rotated:false}]),'Invalid quantity');
});
test('all carried gear and nested contents affect movement; optics improve the gun and narrow overwatch',()=>{
 const b=arena(),u=b.unit('p0'),before=carryWeight(u),mobility=b.mobility(u),angle=visionProfile(u).halfAngleDeg;
 u.inventory.push({id:'loaded-rig',itemId:'rig_scout',x:3,y:0,rotated:false,contents:[{id:'heavy',itemId:'ammo_high',quantity:60,x:0,y:0,rotated:false}]});assert.ok(carryWeight(u)>before);assert.ok(b.mobility(u)<mobility);
 const spread=b.spreadFor(u,WEAPONS.repeater,{x:12,y:10,h:2}).spread;u.attachments.repeater={scope:true};assert.ok(visionProfile(u).halfAngleDeg<angle);assert.ok(b.spreadFor(u,WEAPONS.repeater,{x:12,y:10,h:2}).spread<spread);
});
test('markings descend onto the nearest surviving block and replay deterministically',()=>{
 const a=arena(),b=arena();for(const battle of [a,b]){battle.store.set(4,4,4,MAT.concrete);battle.store.set(4,4,7,MAT.concrete);assert.ok(battle.apply({type:'mark',unitId:'p0',color:'blue',at:{x:4,y:4,z:7}}).ok);battle.store.set(4,4,7,0);battle.afterAction();assert.equal(battle.markers[0].z,4);battle.store.set(4,4,4,0);battle.afterAction();assert.equal(battle.markers[0].z,1);}assert.equal(a.hash(),b.hash());
});
test('formation plans do not teleport; a second member must walk onto a slot before bonuses activate',()=>{
 const b=arena(['grenadier','vanguard']),a=b.unit('p0'),c=b.unit('p1'),old={x:c.x,y:c.y,z:c.z};assert.ok(b.apply({type:'formation_plan',unitId:a.id,template:'wedge',facing:'n'}).ok);const f=b.formations.of(a);assert.ok(f.assembling);assert.equal(b.formations.tier(f),0);assert.deepEqual({x:c.x,y:c.y,z:c.z},old);
 const p=b.formations.plannedSlots(f)[2];assert.ok(b.apply({type:'move',unitId:c.id,to:p}).ok);assert.equal(f.assembling,false);assert.equal(c.formationId,f.id);c.ap=1;assert.ok(b.moveBudget(a)<=b.mobility(c));
});
test('the test arsenal carries every throwable, all guns, ammo, and a usable spare rig',()=>{
 const b=arena(),u=b.unit('p0');grantTestArsenal(u);for(const id of Object.keys(WEAPONS))assert.ok(u.weapons.includes(id));for(const id of ['fire_flask','frost_flask','water_flask','gale_flask','powder_bomb','smoke_pot','breach_charge','medkit'])assert.ok(u.items[id]>0,id);assert.ok([...walkInventory(u.inventory)].some(s=>s.id==='spare-ammo'));assert.ok(reserveAmmo(u,WEAPONS.longrifle)>0);
});
test('equipment swaps preserve carried items and keep helmet protection separate from body armor',()=>{
 const b=arena(),u=b.unit('p0');u.inventory=[{id:'helmet',itemId:'helmet_heavy',x:0,y:0,rotated:false},{id:'vest',itemId:'armor_light',x:2,y:0,rotated:false}];
 const weight=carryWeight(u);assert.equal(equipCargo(u,{from:'backpack',itemId:'helmet'},true),null);assert.equal(u.parts.head.armor,3);
 assert.equal(equipCargo(u,{from:'backpack',itemId:'vest'},true),null);assert.equal(u.parts.torso.armor,2);assert.equal(u.parts.head.armor,3);assert.equal(carryWeight(u),weight);assert.equal(validateLoadout(u),null);
 assert.ok(u.inventory.some(s=>s.itemId==='armor_heavy'));assert.ok(u.inventory.some(s=>s.itemId==='helmet_patrol'));
});
test('wearing a stored rig preserves both containers and their contents without cloning ammo',()=>{
 const b=arena(),u=b.unit('p0');u.inventory=[{id:'spare',itemId:'rig_scout',x:0,y:0,rotated:false,contents:[{id:'extra',itemId:'ammo_ar',quantity:20,x:0,y:0,rotated:false}]}];const reserve=reserveAmmo(u,WEAPONS.repeater),weight=carryWeight(u);
 assert.equal(equipCargo(u,{from:'backpack',itemId:'spare'},true),null);assert.equal(u.equipment.rig,'rig_scout');assert.equal(u.rigInventory[0].quantity,20);assert.equal(u.inventory[0].itemId,'rig_patrol');assert.equal(reserveAmmo(u,WEAPONS.repeater),reserve);assert.equal(carryWeight(u),weight);assert.equal(validateLoadout(u),null);
});
test('an assembled wedge returns fire with every eligible member and spends real ammunition',()=>{
 const b=arena(['grenadier','vanguard']),u=b.unit('p0'),ally=b.unit('p1'),enemy=b.unit('e0');enemy.y=12;enemy.hp=enemy.maxHp=500;for(const p of Object.values(enemy.parts))p.hp=p.max=500;
 b.apply({type:'formation_plan',unitId:u.id,template:'wedge',facing:'n'});const f=b.formations.of(u);assert.ok(b.apply({type:'move',unitId:ally.id,to:b.formations.plannedSlots(f)[2]}).ok);
 const before=[u.ammo.repeater,ally.ammo.blunderbuss],ap=[u.ap,ally.ap];b.formations.onIncomingFire(u,enemy,true);
 assert.equal(u.ammo.repeater,before[0]-3);assert.equal(ally.ammo.blunderbuss,before[1]-1);assert.deepEqual([u.ap,ally.ap],ap);assert.equal(b.stats.reactions,2);
});
test('a patrol file repositions only on unseen incoming fire and spends members movement AP',()=>{
 const b=arena(['grenadier','vanguard']),u=b.unit('p0'),ally=b.unit('p1'),enemy=b.unit('e0');b.apply({type:'formation_plan',unitId:u.id,template:'file',facing:'n'});const f=b.formations.of(u);assert.ok(b.apply({type:'move',unitId:ally.id,to:b.formations.plannedSlots(f)[1]}).ok);
 const pos=()=>[u.x,u.y,ally.x,ally.y],before=pos(),ap=u.ap+ally.ap;b.formations.onIncomingFire(u,enemy,true);assert.deepEqual(pos(),before);b.formations.onIncomingFire(u,enemy,false);assert.notDeepEqual(pos(),before);assert.ok(u.ap+ally.ap<ap);
});
test('a commander strike is ready at the start without kills and recharges 10 rounds after use (PLAN-07)',()=>{
 const b=arena(),u=b.unit('p0'),i={type:'ability',unitId:u.id,abilityId:'killstreak_strike',to:{x:4,y:4,z:1}};assert.equal(u.stats.kills,0);assert.ok(b.apply(i).ok);assert.equal(b.supportUsed,1);assert.equal(b.apply(i).reason,'support_cooldown');
 b.round+=9;assert.equal(b.apply(i).reason,'support_cooldown');b.round+=1;assert.ok(b.apply(i).ok);assert.equal(b.strikeReadyAt,b.round+10);
});
test('an AI with exhausted reserves does not loop on impossible reloads',()=>{
 const b=arena(),u=b.unit('p0');u.ammo.repeater=0;u.rigInventory=[];assert.equal(decide(b,u),null);u.rigInventory=[{id:'last-rounds',itemId:'ammo_ar',quantity:2,x:0,y:0,rotated:false}];const i=decide(b,u);assert.equal(i.type,'reload');assert.ok(b.apply(i).ok);assert.equal(u.ammo.repeater,2);
});
test('resupplying an empty bolt-action chambers one loose round without a reload or AP charge',()=>{
 const b=arena(['marksman']),u=b.unit('p0');u.ammo.longrifle=0;u.rigInventory=[];u.pocketInventory=[{id:'resupply',itemId:'ammo_high',quantity:2,x:0,y:0,rotated:false}];const ap=u.ap;
 assert.ok(b.apply({type:'inventoryMove',unitId:u.id,from:'pockets',to:'rig',itemId:'resupply',x:0,y:0,rotated:false}).ok);assert.equal(u.ammo.longrifle,1);assert.equal(reserveAmmo(u,WEAPONS.longrifle),1);assert.equal(u.ap,ap);
});
