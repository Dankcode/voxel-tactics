import test from 'node:test';import assert from 'node:assert/strict';import * as THREE from 'three';
import {buildAllPieces} from './KitPieces.js';import {KitView} from './KitView.js';
import {createMap} from '../../../../shared/mission/modern/MapKit.js';import {MAT} from '../../../../shared/voxel/Materials.js';
import {groundDrop} from '../RenderTable.js';
const pieces=buildAllPieces(),kit={piece:id=>pieces.get(id),material:()=>new THREE.MeshBasicMaterial()};
test('functional street assemblies render once and fragment after a member is destroyed',()=>{
 const m=createMap({id:'street-test',width:12,depth:12});const cells=[[4,4,2],[5,4,2]];for(const c of cells)m.store.set(...c,MAT.crate);m.object('bike_rack',cells,{axis:'x',dir:1,size:[2,1]});
 const v=new KitView(kit,[]);v.setVisual({hints:m.hints,decor:[]});
 const before=v.buildChunk(m.store,0,0,0);assert.ok(before.some(mesh=>mesh.geometry===pieces.get('bike_rack')[0].geometry&&mesh.count===1));
 m.store.set(5,4,2,0);const after=v.buildChunk(m.store,0,0,0);assert.ok(!after.some(mesh=>mesh.geometry===pieces.get('bike_rack')[0].geometry));
});
test('compact stair meshes have six risers and grounded centre feet within one tile',()=>{
 const geometry=pieces.get('stair_step')[0].geometry;geometry.computeBoundingBox();assert.ok(geometry.boundingBox.min.x>=-.5&&geometry.boundingBox.max.x<=.5);assert.equal(geometry.boundingBox.max.y,1);
 const heights=new Set(Array.from(geometry.getAttribute('position').array).filter((_,i)=>i%3===1).map(h=>Math.round(h*6)));for(let h=1;h<=6;h++)assert.ok(heights.has(h));
 const m=createMap({id:'steps',width:8,depth:8});m.store.set(4,4,2,MAT.stairs_stone);assert.equal(groundDrop(m.store,4,4,2),1/3);
});
