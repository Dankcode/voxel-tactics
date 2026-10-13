import test from 'node:test';import assert from 'node:assert/strict';
import {buildSunkenJunction} from '../mission/ConnectingDistricts.js';
import {topologyModel} from '../../client/src/ui/TopographyPreview.js';
import {packMission,unpackMission} from './MissionSnapshot.js';
import {reachable,nodeKey} from '../world/PathSearch.js';
import {collisionFootprint} from '../voxel/ConnectedShapes.js';
test('topology diagnostics expose linked parcels and geometry without changing the map',()=>{
 const m=buildSunkenJunction({seed:27}),before=m.store.hash(),model=topologyModel(m);
 assert.equal(model.cells.length,m.store.width*m.store.depth);assert.equal(m.store.hash(),before);
 assert.deepEqual(model.parcelGraph,[['north-boulevard','east-link'],['east-link','south-boulevard']]);
 const reach=reachable(m.store,m.spawns.player[0]);for(const p of model.connectors)for(const s of p.sockets)assert.ok(reach.costs.has(nodeKey(s)));
 assert.ok(model.buildings.some(b=>b.rounded));assert.ok(model.buildings.some(b=>!b.rounded));
 assert.ok(model.decisions.length>=4);assert.doesNotThrow(()=>JSON.stringify(model));
});
test('square architectural corners round-trip with their collision silhouette',()=>{
 const m=buildSunkenJunction({seed:1}),square=m.buildings.find(b=>b.rounded===false),key=`${square.x0},${square.y0}`,copy=unpackMission(packMission(m));
 assert.ok(m.store.squareCorners.has(key));assert.ok(copy.store.squareCorners.has(key));
 assert.deepEqual(collisionFootprint(m.store,square.x0,square.y0,square.baseZ+1),collisionFootprint(copy.store,square.x0,square.y0,square.baseZ+1));
});
