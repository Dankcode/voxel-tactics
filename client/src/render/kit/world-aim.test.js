import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as THREE from 'three';
import {WorldAimSprite,worldAimGeometry,worldAimSide} from '../../anim/WorldAimSprite.js';
import {CutInDirector} from '../../anim/CutInDirector.js';
import {fitGunPose,gunPoint,gunPoseSample} from '../../anim/SpriteWeapon.js';
import {armRigPose} from '../../anim/SpriteArmRig.js';
const art=JSON.parse(readFileSync(new URL('../../../public/assets/characters/ranger-01/cutin.json',import.meta.url))).worldAim;

test('world aim has a complete body and both shoulders keep the foot anchor at the unit origin',()=>{
 assert.ok(art);assert.deepEqual(art.cropEdges,[]);assert.equal(art.worldHeight,2.4);
 const geometry=worldAimGeometry(art);geometry.computeBoundingBox();
 const b=geometry.boundingBox,w=art.worldHeight*art.width/art.height;
 assert.ok(Math.abs(b.min.x+art.anchor[0]*w)<1e-6);
 assert.ok(Math.abs(b.max.y-art.anchor[1]*art.worldHeight)<1e-6);
 for(const side of [-1,1]){
  const foot=new THREE.Vector3(0,0,0).applyMatrix4(new THREE.Matrix4().makeScale(side,1,1));
  assert.equal(foot.length(),0,'flipping never translates the feet');
 }
 geometry.dispose();
});
test('crosshair crossing the character changes facing, with a stable centre deadband',()=>{
 const camera=new THREE.PerspectiveCamera(38,1,.1,100);camera.position.set(0,2,8);camera.lookAt(0,1.4,0);camera.updateMatrixWorld();
 const pos=new THREE.Vector3();
 assert.equal(worldAimSide(camera,pos,new THREE.Vector3(-2,1.4,0)),'left');
 assert.equal(worldAimSide(camera,pos,new THREE.Vector3(2,1.4,0)),'right');
 assert.equal(worldAimSide(camera,pos,new THREE.Vector3(0,1.4,0),'left'),'left');
});
test('world aiming renders a static grip pose and never uses reticle lag or screen-edge positioning',()=>{
 const camera=new THREE.PerspectiveCamera();camera.updateMatrixWorld();let calls=[];
 const world={art:{...art},mesh:new THREE.Mesh(),depthSlope:{value:0},texture:{},weapon:{update:(...a)=>calls.push(a)},ready:true};
 WorldAimSprite.prototype.update.call(world,camera,'left');
 assert.equal(world.mesh.scale.x,-1);assert.equal(world.texture.needsUpdate,true);assert.deepEqual(calls,[[]]);
 const view={pos:new THREE.Vector3()},updates=[],director={cameraDirector:{scene:{camera}},aiming:{view,unitId:'u',shoulder:'right',world:{ready:true,update:(...a)=>updates.push(a)}}};
 CutInDirector.prototype.placeAim.call(director,new THREE.Vector3(2,1,-5),{yaw:1,pitch:1});
 assert.equal(updates.length,1);assert.equal(updates[0].length,2);assert.deepEqual([...director.cameraDirector.hidden],['u']);
});
test('all gun families remain inside the world card and both glove wrists meet their sleeves',()=>{
 const guns=JSON.parse(readFileSync(new URL('../../../public/assets/weapons/ranger-preview/gun-kit.json',import.meta.url)));
 for(const gun of Object.values(guns.assemblies)){
  const camera=new THREE.OrthographicCamera();fitGunPose(camera,art.rig,gunPoint(gun.stock),1);
  const targets=gunPoseSample(art,gun,camera).targets;
  for(const p of Object.values(targets))assert.ok(p.every(n=>n>.02&&n<.98),'gun is fully inside the sprite frame');
  assert.ok(armRigPose(art.rig,targets,art.width,art.height).maxGap<.01);
 }
});
