import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { SpriteAnimator } from '../../anim/SpriteAnimator.js';
import { EVENT_TO_CLIP } from '../../anim/AnimationClips.js';
import { solveArm, boneMatrix, armTransforms, constrainGunPose } from '../../anim/SpriteArmRig.js';
import { fitGunPose, gunPoint, spriteGunParts, gunPivotMatrix } from '../../anim/SpriteWeapon.js';
import { readyCutin, sideCutin } from '../../anim/CutInDirector.js';
const json = name => JSON.parse(readFileSync(new URL(`../../../public/assets/characters/ranger-01/${name}`,import.meta.url)));
const field=json('field.json'), cutin=json('cutin.json');
const near=(a,b,epsilon=1e-5)=>assert.ok(Math.abs(a-b)<epsilon,`${a} != ${b}`);
const apply=(m,p)=>({x:m[0]*p.x+m[2]*p.y+m[4],y:m[1]*p.x+m[3]*p.y+m[5]});

test('movement uses only running; downed plays every frame once and holds the settled pose',()=>{
 assert.equal(EVENT_TO_CLIP.move,'run');assert.equal(field.clips.walk,undefined);
 const a=new SpriteAnimator(field,new THREE.Texture());a.play('run');a.update(1/12);assert.equal(a.frame,1);
 a.update(3/12);assert.equal(a.frame,0);
 let ends=0;a.play('down',{onEnd:()=>ends++});
 for(let i=0;i<3;i++){a.update(1/8);assert.equal(a.frame,i+1);}
 a.update(1);assert.equal(a.frame,3);assert.equal(a.clip,'down');assert.equal(ends,1);
 a.update(5);assert.equal(a.frame,3);assert.equal(ends,1);
});
test('the new atlas covers all clips, eight facings, and 192 named frames',()=>{
 assert.equal(field.columns,24);assert.equal(field.rows,8);assert.equal(field.placeholder,false);
 const list=json('sprite-list.json').frames;assert.equal(list.length,192);
 for(const f of field.facings)for(const [clip,c] of Object.entries(field.clips)){
  assert.equal(list.filter(l=>l.facing===f&&l.clip===clip).length,c.frames);
 }
});
test('ready left flips the complete same character and gun without switching identity or layers',()=>{
 const r=readyCutin(cutin,'right'),l=readyCutin(cutin,'left');
 assert.equal(l.mirror,true);assert.equal(l.mirrorGun,true);assert.deepEqual(l.layers,r.layers);assert.deepEqual(l.rig,r.rig);
 assert.equal(l.character,cutin.character);
});
test('2D arm IK preserves bone lengths and affine pivots',()=>{
 const s={x:2,y:3},e={x:4,y:6},w={x:7,y:4},target={x:5,y:5};
 const p=solveArm(s,e,w,target);
 near(Math.hypot(p.elbow.x-s.x,p.elbow.y-s.y),Math.hypot(e.x-s.x,e.y-s.y));
 near(Math.hypot(p.wrist.x-p.elbow.x,p.wrist.y-p.elbow.y),Math.hypot(w.x-e.x,w.y-e.y));
 const m=boneMatrix(s,e,s,p.elbow),start=apply(m,s),end=apply(m,e);near(start.x,s.x);near(start.y,s.y);near(end.x,p.elbow.x);near(end.y,p.elbow.y);
 const far=solveArm(s,e,w,{x:1e5,y:1e5});assert.ok(Number.isFinite(far.elbow.x));
});
test('source assemblies retain physical scale and gloves follow their actual 3D grips',()=>{
 const guns=JSON.parse(readFileSync(new URL('../../../public/assets/weapons/ranger-preview/gun-kit.json',import.meta.url)));
 for(const [name,part] of Object.entries(guns.parts))assert.deepEqual(part.scale,[1,1,1],name);
 assert.equal(guns.assemblies.sniper.parts.filter(n=>n.includes('scope')).length,1);
 for(const art of [cutin,readyCutin(cutin,'right')]){
  let height;
  for(const kit of Object.values(guns.assemblies)){
   near(kit.measuredLengthMetres,kit.referenceLengthMetres,.001);
   const camera=new THREE.OrthographicCamera(),stock=gunPoint(kit.stock);
   fitGunPose(camera,art.rig,stock,art.width/art.height);
   if(height)near(camera.top-camera.bottom,height);height=camera.top-camera.bottom;
   const uv=p=>{p=p.clone().project(camera);return[(p.x+1)/2,(1-p.y)/2];};
   const targets={stock:uv(stock),grip:uv(new THREE.Vector3()),support:uv(gunPoint(kit.support))};
   targets.stock.forEach((v,i)=>near(v,art.rig.stock[i]));
   const matrices=armTransforms(art.rig,targets,art.width,art.height);
   for(const [side,arm] of Object.entries(art.rig.arms)){
    const palm=apply(matrices[side+'-hand'],{x:arm.palm[0]*art.width,y:arm.palm[1]*art.height}),grip=targets[side==='trigger'?'grip':'support'];
    near(palm.x,grip[0]*art.width);near(palm.y,grip[1]*art.height);
   }
  }
 }
});

test('missing sidearm and melee assets do not masquerade as an unrelated rifle',()=>{for(const id of ['handcannon','firelance','sword','maul'])assert.equal(spriteGunParts(id),null);});

// Exercise the actual stock-fixed projection and workspace constraint, not only palm pinning.
test('full aiming range and recoil preserve both wrists, every bone length, stock contact and mirroring',()=>{
 const guns=JSON.parse(readFileSync(new URL('../../../public/assets/weapons/ranger-preview/gun-kit.json',import.meta.url)));
 let samples=0;
 for(const art of [cutin,sideCutin(cutin,'left'),readyCutin(cutin,'right'),readyCutin(cutin,'left')])for(const gun of Object.values(guns.assemblies)){
  const camera=new THREE.OrthographicCamera(),stock=gunPoint(gun.stock);fitGunPose(camera,art.rig,stock,art.width/art.height);
  const sample=input=>{
   const m=gunPivotMatrix(stock,input),uv=point=>{point=point.clone().applyMatrix4(m).project(camera);return[(point.x+1)/2,(1-point.y)/2];};
   return{stock:uv(stock),grip:uv(new THREE.Vector3()),support:uv(gunPoint(gun.support)),muzzle:uv(gunPoint(gun.muzzle))};
  };
  for(let yi=-6;yi<=6;yi++)for(let pi=-4;pi<=4;pi++)for(const recoil of [0,.025]){
   const solved=constrainGunPose(sample,{yaw:yi*.05,pitch:pi*.05,recoil},art.rig,art.width,art.height);samples++;
   assert.ok(solved.arms.maxGap<.01,`wrist gap ${solved.arms.maxGap}`);
   solved.targets.stock.forEach((v,i)=>near(v,art.rig.stock[i]));
   for(const[side,j]of Object.entries(solved.arms.joints)){
    near(j.wrist.x,j.handWrist.x,.01);near(j.wrist.y,j.handWrist.y,.01);
    const anchor=solved.targets[side==='trigger'?'grip':'support'];near(j.palm.x,anchor[0]*art.width);near(j.palm.y,anchor[1]*art.height);
    for(const part of ['upper','forearm']){const[a,b]=solved.arms.transforms[side+'-'+part];near(a*a+b*b,1);}
    if(art.mirror){const reflected=x=>art.width-x;near(Math.abs(reflected(j.wrist.x)-reflected(j.handWrist.x)),Math.abs(j.wrist.x-j.handWrist.x));}
   }
  }
 }
 assert.equal(samples,2808);
});
test('the emitted gun nodes match the reference part list and metre bounds',()=>{
 const metadata=JSON.parse(readFileSync(new URL('../../../public/assets/weapons/ranger-preview/gun-kit.json',import.meta.url)));
 const buffer=readFileSync(new URL('../../../public/assets/weapons/ranger-preview/gun-kit.glb',import.meta.url));
 const gltf=JSON.parse(buffer.subarray(20,20+buffer.readUInt32LE(12)).toString());
 const nodes=new Map(gltf.nodes.map(n=>[n.name,n]));
 for(const[name,part]of Object.entries(metadata.parts)){
  const n=nodes.get(name);assert.ok(n?.mesh!=null,name);assert.ok(!n.scale||n.scale.every(v=>v===1),name+' has no independent resizing');
  assert.equal(n.extras.reference_role,part.role);
  const bounds=gltf.meshes[n.mesh].primitives.map(p=>gltf.accessors[p.attributes.POSITION]);
  const min=[0,1,2].map(i=>Math.min(...bounds.map(b=>b.min[i]))),max=[0,1,2].map(i=>Math.max(...bounds.map(b=>b.max[i])));
  const expectedMin=[part.bounds[0][0],part.bounds[0][2],-part.bounds[1][1]],expectedMax=[part.bounds[1][0],part.bounds[1][2],-part.bounds[0][1]];
  min.forEach((v,i)=>near(v,expectedMin[i]));max.forEach((v,i)=>near(v,expectedMax[i]));
 }
 const barrel=gltf.accessors[gltf.meshes[nodes.get('rifle_barrel').mesh].primitives[0].attributes.POSITION];
 near(-barrel.min[2],metadata.assemblies.rifle.muzzle[1],.001);
});

test('the authored wrist and palm pivots lie inside the exported painted gloves',()=>{
 const audit=JSON.parse(readFileSync(new URL('../../../../tools/art/sprites/ranger-01/rig-image-audit.json',import.meta.url)));
 for(const[name,pose]of Object.entries(audit))for(const[side,arm]of Object.entries(pose)){
  assert.ok(arm.palmCoverage>.9,`${name}/${side} palm`);assert.ok(arm.wristCoverage>.9,`${name}/${side} wrist`);
  assert.ok(arm.palmDistancePixels<1);assert.ok(arm.wristDistancePixels<1);
 }
});
