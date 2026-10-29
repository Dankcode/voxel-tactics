import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import {puppetPose,ribbonT,swapWeights,swapDeformer,validatePuppet} from '../../anim/SpritePuppetRig.js';
import {aimGunCamera,cardDepth01,contactDepth,gunPoint,gunPoseSample} from '../../anim/SpriteWeapon.js';
const read=p=>JSON.parse(fs.readFileSync(new URL(p,import.meta.url)));
const art=read('../../../../tools/art/archive/ranger-puppet/cutin.json');
const kit=read('../../../public/assets/weapons/ranger-preview/gun-kit.json');
const near=(a,b,e=1e-6)=>assert.ok(Math.abs(a-b)<e,`${a} != ${b}`);
const v2=()=>{const p=structuredClone(art.puppet);p.version=2;for(const f of Object.values(p.keyforms))for(const k of Object.values(f))k.depth={shoulder:.7,elbow:.8};return p;};

test('card depth uses the gun camera depth buffer, and contact depths match the projected gun points',()=>{
 for(const family of Object.keys(kit.assemblies)){
  const gun=kit.assemblies[family],camera=aimGunCamera(art.rig,gunPoint(gun.stock),1),s=gunPoseSample(art,gun,camera,{yaw:.05,pitch:-.03});
  for(const key of ['stock','grip','support','muzzle']){
   const world=gunPoint(gun[key]).applyMatrix4(s.matrix);
   near(s.depths[key],contactDepth(camera,world));
   near(cardDepth01(camera,s.depths[key]),world.clone().project(camera).z*.5+.5,1e-5);
   assert.ok(s.depths[key]>camera.near&&s.depths[key]<camera.far);
  }
 }
});
test('v2 joints carry authored shoulder/elbow depth and the gun contact depth at wrist and palm',()=>{
 const a={...art,puppet:v2()};
 a.puppet.keyforms.rifle.trigger.parameters.aimX.depthPositive=[.02,.1];
 const gun=kit.assemblies.rifle,camera=aimGunCamera(a.rig,gunPoint(gun.stock),1);
 const s=gunPoseSample(a,gun,camera,{yaw:a.puppet.range.yaw}),pose=puppetPose(a,s.targets,'rifle',{yaw:a.puppet.range.yaw},s.depths);
 const j=pose.joints.trigger.depth;near(j.shoulder,.72);near(j.elbow,.9);near(j.wrist,s.depths.grip);near(pose.joints.support.depth.palm,s.depths.support);
 const d=pose.deformers['trigger-forearm'];near(d.depthStart,.9);near(d.depthEnd,s.depths.grip);
 near(ribbonT(d.sourceStart,d),0);near(ribbonT(d.sourceEnd,d),1);
 assert.ok(d.foreshorten>0);
});
test('v1 rigs and the world pose keep legacy depthless joints',()=>{
 const v1=structuredClone(art.puppet);v1.version=1;delete v1.layers;for(const f of Object.values(v1.keyforms))for(const k of Object.values(f)){delete k.depth;delete k.parameters.aimXY;}
 for(const a of [{...art,puppet:v1},art.worldAim]){
  const gun=kit.assemblies.rifle,camera=aimGunCamera(a.rig,gunPoint(gun.stock),a.width/a.height),s=gunPoseSample(a,gun,camera,{});
  const pose=puppetPose(a,s.targets,'rifle',{});assert.equal(pose.joints.trigger.depth.shoulder,null);assert.equal(pose.joints.trigger.depth.wrist,null);
 }
 assert.ok(art.worldAim.rig.gunView.projection!=='perspective');
});
test('v2 layer authoring validates depth, clipping masks and art swaps',()=>{
 const p=v2();p.layers={body:{depthMap:{image:'aim-body-depth.png',range:[.4,1.4]}},'support-upper':{clip:{by:['body'],mode:'outside'}},
  'trigger-fingers':{depthOffset:.03},'trigger-forearm':{swaps:[{image:'aim-trigger-forearm.png',foreshorten:[0,.75],blend:.1}]}};
 validatePuppet(p);
 for(const bad of [{body:{depth:-1}},{'support-upper':{clip:{by:[],mode:'outside'}}},{'support-upper':{clip:{by:['body'],mode:'behind'}}},
   {x:{swaps:[{image:'a.png',foreshorten:[.8,.5]}]}},{x:{depthMap:{image:'d.png',range:[1,.5]}}}])
  assert.throws(()=>validatePuppet({...p,layers:bad}));
 const many=Object.fromEntries(Array.from({length:9},(_,i)=>['l'+i,{clip:{by:['m'+i],mode:'inside'}}]));assert.throws(()=>validatePuppet({...p,layers:many}));
});
test('art swap weights crossfade continuously across band edges',()=>{
 const swaps=[{foreshorten:[0,.75],blend:.1}];
 near(swapWeights(swaps,.4)[0],1);near(swapWeights(swaps,1)[0],0);near(swapWeights(swaps,.75)[0],.5);
 let last=swapWeights(swaps,.6)[0];for(let r=.6;r<=.9;r+=.001){const w=swapWeights(swaps,r)[0];assert.ok(Math.abs(w-last)<.02);last=w;}
 const two=swapWeights([{foreshorten:[0,1],blend:.2},{foreshorten:[.9,2],blend:.2}],.95);assert.ok(two[0]+two[1]<=1+1e-9);
 const d={sourceStart:{x:0,y:0},sourceEnd:{x:10,y:0},start:{x:0,y:0},end:{x:5,y:0}};
 assert.deepEqual(swapDeformer(d,{source:{start:[0,0],end:[.5,0]}},20,20).sourceEnd,{x:10,y:0});
});
