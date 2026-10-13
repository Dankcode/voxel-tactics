import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {billboardDepthSlope,installBillboardDepth} from '../../units/BillboardDepth.js';
test('billboard depth follows a vertical character while preserving terrain and wall depth tests',()=>{
 const camera=new THREE.OrthographicCamera(-5,5,5,-5,.1,100);
 camera.position.set(0,10,10);camera.lookAt(0,0,0);camera.updateMatrixWorld();
 const slope=billboardDepthSlope(camera);assert.ok(Math.abs(slope-1)<1e-6);
 const foot=new THREE.Vector3(0,2,0),up=new THREE.Vector3(0,1,0).applyQuaternion(camera.quaternion);
 const card=foot.clone().addScaledVector(up,1.5).applyMatrix4(camera.matrixWorldInverse);
 const upright=foot.clone().add(new THREE.Vector3(0,1.5/up.y,0)).applyMatrix4(camera.matrixWorldInverse);
 assert.ok(Math.abs(card.y-upright.y)<1e-6,'same screen height');
 assert.ok(Math.abs(card.z+1.5*slope-upright.z)<1e-6,'depth is the upright plane');
 const mat=new THREE.MeshBasicMaterial();const uniform=installBillboardDepth(mat);
 assert.equal(mat.depthTest,true);uniform.value=slope;
 const shader={uniforms:{},vertexShader:'#include <project_vertex>'};mat.onBeforeCompile(shader);
 assert.equal(shader.uniforms.billboardDepthSlope.value,slope);assert.match(shader.vertexShader,/uprightProjection/);
});
