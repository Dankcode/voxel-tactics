import test from 'node:test';import assert from 'node:assert/strict';
import {remixParameters,solveDistrictParts} from './DistrictRemix.js';
import {buildParkDistrict,buildMallDistrict} from '../mission/LargeDistricts.js';
import {createMap} from '../mission/modern/MapKit.js';
import {placeStreetVehicle,VEHICLE_SPECS} from './StreetDressing.js';
import {MAT} from '../voxel/Materials.js';
import {reachable,nodeKey} from '../world/PathSearch.js';
import {sanitizeDesc,buildMission} from '../session/Scenarios.js';
import {setupToDesc,descToSetup,reportToDesc} from '../../client/src/ui/TestGroundPanel.js';
test('noise WFC is deterministic and constrains adjacent tallest parcels',()=>{
 const nodes=[{id:'a',x0:0,y0:0},{id:'b',x0:12,y0:0},{id:'c',x0:24,y0:0}],r=remixParameters();
 const a=solveDistrictParts(nodes,r,27);assert.deepEqual(a,solveDistrictParts(nodes,r,27));assert.deepEqual(a.map(p=>p.id),['a','b','c']);
 for(let i=1;i<a.length;i++)assert.ok(a[i].storeys!==3||a[i-1].storeys!==3);
 assert.ok(a.every(p=>p.storeys>=1&&p.storeys<=3));
});
test('remix configuration round-trips through saved setups, reports and sanitized mission descriptors',()=>{
 const settings={buildingCount:3,minStoreys:1,maxStoreys:1,elevated:false,furnish:false,glazing:'band',terrain:'flat'};
 const d=sanitizeDesc({scenario:'mall-district',seed:27,district:{width:104,depth:76,shape:'L',remix:settings},test:{enemies:[{type:'cultist',count:1}]}});
 assert.deepEqual(sanitizeDesc(setupToDesc(descToSetup(d))).district,d.district);
 assert.deepEqual(reportToDesc({scenario:{id:d.scenario,seed:d.seed,district:d.district}}).district,d.district);
 const m=buildMission(d);assert.ok(m.buildings.length<=3);assert.equal(m.meta.remix.glazing,'band');assert.equal(m.meta.remix.furnish,false);
 assert.ok(!m.meta.connectionParcels.some(c=>c.template==='supported-bridge-building'));
 const r=reachable(m.store,m.spawns.player[0]);assert.ok(m.buildings.every(b=>b.rooms.filter(r=>r.gameplay!==false).every(room=>room.cells.some(([x,y])=>r.costs.has(nodeKey({x,y,z:room.floorZ}))))));
});
test('vehicle meshes have collision-sized intact footprints and never overwrite reserved routes',()=>{
 for(const [type,spec] of Object.entries(VEHICLE_SPECS)){
  const m=createMap({id:type,width:24,depth:12,ground:'paving'});m.reserve(3,3,3,3);
  assert.equal(placeStreetVehicle(m,type,3,3),null);const v=placeStreetVehicle(m,type,5,5);assert.ok(v);
  const h=Object.values(m.hints).find(h=>h.cells);assert.equal(h.piece,type);assert.equal(h.cells.length,spec.length*spec.width+(type==='abandoned_car'?0:type==='car'?4:spec.length*spec.width));
  assert.ok(h.cells.every(k=>m.store.get(...k.split(',').map(Number))!==0));
 }
});
test('remixed districts retire ornamental cover and preserve the path below the bridge parcel',()=>{
 const m=buildParkDistrict({seed:27}),s=m.store;
 for(const material of [MAT.bench,MAT.planter,MAT.hedge])assert.equal(s.mat.includes(material),false);
 assert.ok(m.buildings.length<=7);assert.ok(new Set(m.buildings.map(b=>b.storeys)).size>=2);
 assert.equal(s.get(38,30,2),0);assert.equal(s.get(38,30,3),0);assert.notEqual(s.get(38,30,4),0);
 assert.ok(m.meta.streetObjects.some(p=>p.type==='bus'));assert.ok(m.meta.streetObjects.some(p=>p.type==='eighteen_wheeler'));
});
