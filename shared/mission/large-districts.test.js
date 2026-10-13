import test from 'node:test';
import assert from 'node:assert/strict';
import {buildParkDistrict,buildMallDistrict,buildDrainageDistrict,districtContains,districtParameters} from './LargeDistricts.js';
import {sanitizeDesc,buildMission} from '../session/Scenarios.js';
import {MAT} from '../voxel/Materials.js';
import {reachable,nodeKey,pathTo} from '../world/PathSearch.js';
test('large irregular districts have real boundaries and reachable elevation and interior connectors',()=>{
 for(const build of [buildParkDistrict,buildMallDistrict,buildDrainageDistrict]){
  const m=build({seed:27}),p=m.meta.footprint;
  assert.equal(m.metrics.pass,true);assert.ok(m.store.width>=96);assert.equal(m.meta.connectorValidation.pass,true);
  for(let y=0;y<p.depth;y++)for(let x=0;x<p.width;x++)if(!districtContains(p,x,y))for(let z=0;z<m.store.height;z++)assert.equal(m.store.get(x,y,z),0);
  const r=reachable(m.store,m.spawns.player[0]);for(const c of m.meta.connectionParcels)for(const s of c.sockets)assert.ok(r.costs.has(nodeKey(s)),c.id);
  if(m.id==='drainage-district'){
   assert.ok(m.store.mat.includes(MAT.water));assert.equal(m.meta.connectionParcels.filter(p=>p.template==='bank-service-ladder').length,3);
   for(const c of m.meta.connectionParcels.filter(p=>p.template==='open-drainage-bank'))for(const s of c.sockets)assert.notEqual(m.store.get(s.x,s.y,s.z),MAT.water,'dry banks');
  }else assert.equal(m.store.mat.includes(MAT.water),false,'no compulsory sunken water');
  if(m.id==='mall-district'){
   const c=m.meta.connectionParcels.find(c=>c.template==='merged-retail-passage');
   const route=pathTo(reachable(m.store,c.sockets[0]),c.sockets[1]);assert.ok(route.length<=5,'direct interior link');
   assert.ok(m.rooms.some(r=>r.cells.length>200),'large retail interior');
  }
 }
});
test('district dimensions and shapes survive descriptor sanitation',()=>{
 const desc=sanitizeDesc({scenario:'park-district',seed:27,district:{width:104,depth:76,shape:'L'}});
 assert.deepEqual(desc.district,{width:104,depth:76,shape:'L'});
 const m=buildMission(desc);assert.equal(m.store.width,104);assert.equal(m.store.depth,76);assert.equal(m.meta.footprint.shape,'L');
 assert.deepEqual(districtParameters({width:Infinity,depth:-1,shape:'bad'}),{width:128,depth:72,shape:'rectangle'});
});

test('maximum-size drainage rectangle fills extensions and retains tactical design gates',()=>{
 const m=buildDrainageDistrict({seed:27,width:128,depth:96,shape:'rectangle',remix:{buildingCount:18,pedestrian:'normal'}});
 assert.equal(m.metrics.pass,true);assert.equal(m.meta.connectorValidation.pass,true);
 assert.ok(m.buildings.some(b=>b.id.startsWith('south-extension')));
 assert.ok(m.buildings.some(b=>b.id==='bank-side-depot'));
});
