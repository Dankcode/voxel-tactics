import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { edgeMesh } from '../Overlays.js';

test('diagonal boundary edges have a solid join at their shared grid vertex',()=>{
    const material=new THREE.MeshBasicMaterial();
    const mesh=edgeMesh([
        [{x:0,y:1,z:1},0,-1],
        [{x:1,y:0,z:1},-1,0],
    ],material);
    const positions=mesh.geometry.getAttribute('position');
    let join;
    for(let start=8;start<positions.count;start+=4){
        const quad=Array.from({length:4},(_,i)=>[positions.getX(start+i),positions.getY(start+i),positions.getZ(start+i)]);
        if(Math.abs(quad.reduce((sum,p)=>sum+p[0],0)/4-1)<1e-6&&Math.abs(quad.reduce((sum,p)=>sum+p[2],0)/4-1)<1e-6)join=quad;
    }
    assert.ok(join,'the shared vertex has a cap');
    const expected=[[.955,2.035,.955],[1.045,2.035,.955],[1.045,2.035,1.045],[.955,2.035,1.045]];
    join.forEach((p,i)=>p.forEach((v,j)=>assert.ok(Math.abs(v-expected[i][j])<1e-6)));
    assert.equal(mesh.geometry.getIndex().count/6,5,'two edge strips and three unique endpoint joins');
    mesh.geometry.dispose();material.dispose();
});

test('shared endpoints reuse one join instead of overdrawing the same square',()=>{
    const material=new THREE.MeshBasicMaterial();
    const mesh=edgeMesh([
        [{x:0,y:0,z:1},0,-1],
        [{x:0,y:0,z:1},-1,0],
    ],material);
    assert.equal(mesh.geometry.getAttribute('position').count,20,'two strips and three unique joins');
    mesh.geometry.dispose();material.dispose();
});
