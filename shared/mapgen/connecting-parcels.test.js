import test from 'node:test';import assert from 'node:assert/strict';
import {buildSunkenBoulevard,buildFreightTerraces} from '../mission/ConnectingDistricts.js';
import {reachable,nodeKey} from '../world/PathSearch.js';
import {connectionContract} from './ConnectingParcels.js';
import {navigationFloors} from '../../client/src/render/FloorCutaway.js';
test('connector contracts carry aligned street and lower-level sockets',()=>{
 const c=connectionContract({kind:'stairs',x:8,y:12,dir:[1,0]});assert.equal(c.template,'street-underpass-portal');assert.ok(c.sourceProfile);assert.deepEqual(c.sockets.map(s=>s.z),[4,1]);
});
test('creative split-level maps preserve both routes and expose meaningful floor choices',()=>{
 for(const build of [buildSunkenBoulevard,buildFreightTerraces])for(const seed of [1,3,17]){
  const m=build({seed}),search=reachable(m.store,m.spawns.player[0],Infinity);
  assert.ok(Object.values(m.metrics.gates).every(Boolean));assert.ok(m.meta.connectionParcels.length>=2);
  for(const p of m.meta.connectionParcels)for(const socket of p.sockets)assert.ok(search.costs.has(nodeKey(socket)),`${m.id} ${p.id}: socket reachable`);
  assert.ok(navigationFloors(m).some(f=>Number.isFinite(f.cut)));
 }
});
