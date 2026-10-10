import test from 'node:test';import assert from 'node:assert/strict';
import { createMap } from '../mission/modern/MapKit.js';import { MAT } from './Materials.js';import {LightField} from '../lighting/LightField.js';
test('integer light is deterministic, respects opaque walls and updates only dirty regions',()=>{
 const m=createMap({id:'light',width:40,depth:20,height:18});m.store.fill(10,0,2,10,19,17,'concrete_wall');m.store.set(7,8,3,MAT.lantern);
 const a=new LightField(m.store,{timeOfDay:'night-ops'}),b=new LightField(m.store.clone(),{timeOfDay:'night-ops'});assert.deepEqual(a.values,b.values);assert.ok(a.at(8,8,3)>a.at(12,8,3));
 const before=a.at(8,8,3);m.store.set(7,8,3,0);const dirty=a.flush();assert.ok(dirty.length>0);assert.ok(a.at(8,8,3)<before);assert.deepEqual(a.values,new LightField(m.store.clone(),{timeOfDay:'night-ops'}).values);
 const fires=new Map();const f=new LightField(m.store,{timeOfDay:'night-ops',fires});assert.ok(f.dark(3,3,1));fires.set('3,3,2',2);assert.equal(f.dark(3,3,1),false);fires.clear();assert.ok(f.dark(3,3,1));
});
import { createBattle } from '../session/Scenarios.js';import {WEAPONS} from '../content/weapons.js';
test('distant shots apply darkness once and peers agree after shooting out a light',()=>{
 const a=createBattle({scenario:'subway-crossing',seed:1}),b=createBattle({scenario:'subway-crossing',seed:1});
 for(const battle of [a,b]){const target=battle.units.find(u=>u.side==='enemy'&&u.z===1);const shooter=battle.units[0];shooter.x=target.x-6;shooter.y=target.y;shooter.z=1;
 for(let z=2;z<=3;z++)battle.store.set(target.x,target.y,z,0);
 battle.store.set(target.x+1,target.y,2,MAT.lantern);const aim=battle.chest(target);assert.ok(!battle.spreadFor(shooter,WEAPONS[shooter.weapon],aim,{target}).mods.some(([id])=>id==='darkness'));
 battle.store.set(target.x+1,target.y,2,0);assert.ok(battle.spreadFor(shooter,WEAPONS[shooter.weapon],aim,{target}).mods.some(([id,n])=>id==='darkness'&&n===1.25));}
 assert.deepEqual(a.light.values,b.light.values);assert.equal(a.hash(),b.hash());
});
