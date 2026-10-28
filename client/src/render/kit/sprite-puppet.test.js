import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {puppetPose,warpPuppetPoint,scalePuppet,validatePuppet} from '../../anim/SpritePuppetRig.js';
import {aimGunCamera,gunPoint,gunPoseSample} from '../../anim/SpriteWeapon.js';
const read=p=>JSON.parse(fs.readFileSync(new URL(p,import.meta.url)));
const art=read('../../../public/assets/characters/ranger-01/cutin.json');
const formula=read('../../../../tools/art/sprites/ranger-01/formula.json');
const kit=read('../../../public/assets/weapons/ranger-preview/gun-kit.json');
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-5,`${a} != ${b}`);
function sample(a,family,input){const gun=kit.assemblies[family],camera=aimGunCamera(a.rig,gunPoint(gun.stock),a.width/a.height);const targets=gunPoseSample(a,gun,camera,input).targets;return {targets,pose:puppetPose(a,targets,family,input)};}
test('authored puppet is installed in every runtime aiming variant',()=>{
 validatePuppet(art.puppet);assert.deepEqual(art.variants.left.puppet,art.puppet);
 assert.deepEqual(art.worldAim.puppet,scalePuppet(formula.poses.aim.sideView?.puppet||art.puppet,formula.worldAim.scale,formula.worldAim.offset));
 const invalid=structuredClone(art.puppet);invalid.keyforms.rifle.trigger.elbow[0]=NaN;assert.throws(()=>validatePuppet(invalid));
});
test('all weapon/range corners keep hands, elbows and sleeve endpoints connected',()=>{
 for(const a of [art,art.worldAim])for(const family of Object.keys(kit.assemblies))for(const yaw of [-a.puppet.range.yaw,0,a.puppet.range.yaw])for(const pitch of [-a.puppet.range.pitch,0,a.puppet.range.pitch])for(const recoil of [0,a.puppet.range.recoil]){
  const {targets,pose}=sample(a,family,{yaw,pitch,recoil});
  for(const [side,j]of Object.entries(pose.joints)){
   const target=targets[side==='trigger'?'grip':'support'];near(j.palm.x,target[0]*a.width);near(j.palm.y,target[1]*a.height);
   // The elbow is authored, never flipped by an IK reach solution.
   assert.ok(j.elbow.y>j.shoulder.y);assert.ok(j.elbow.y>j.wrist.y,JSON.stringify({family,side,yaw,pitch,recoil,elbow:j.elbow,wrist:j.wrist}));
   for(const part of ['upper','forearm']){const d=pose.deformers[side+'-'+part];for(const endpoint of ['Start','End']){const q=warpPuppetPoint(d['source'+endpoint],d);near(q.x,d[endpoint.toLowerCase()].x);near(q.y,d[endpoint.toLowerCase()].y);}}
   const m=pose.handTransforms[side+'-hand'],rest=a.rig.arms[side].wrist;near(m[0]*rest[0]*a.width+m[2]*rest[1]*a.height+m[4],j.wrist.x);near(m[1]*rest[0]*a.width+m[3]*rest[1]*a.height+m[5],j.wrist.y);
  }
 }
});
test('deforming the mesh bends interior vertices while keeping pins fixed, without folded cells',()=>{
 for(const family of Object.keys(kit.assemblies))for(const yaw of [-art.puppet.range.yaw,art.puppet.range.yaw])for(const pitch of [-art.puppet.range.pitch,art.puppet.range.pitch])for(const recoil of [0,.025]){
  const {pose}=sample(art,family,{yaw,pitch,recoil});
  for(const [bone,d]of Object.entries(pose.deformers)){
   const [x0,y0,x1,y1]=art.layers.find(l=>l.bone===bone).bounds,n=32;
   for(let y=0;y<n;y++)for(let x=0;x<n;x++){
    const a=warpPuppetPoint({x:x0+(x1-x0)*x/n,y:y0+(y1-y0)*y/n},d),b=warpPuppetPoint({x:x0+(x1-x0)*(x+1)/n,y:y0+(y1-y0)*y/n},d),c=warpPuppetPoint({x:x0+(x1-x0)*x/n,y:y0+(y1-y0)*(y+1)/n},d);
    assert.ok(Number.isFinite(a.x)&&Number.isFinite(a.y));assert.ok((b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x)>0,`${family} ${bone}: folded mesh`);
   }
   const mid={x:(d.sourceStart.x+d.sourceEnd.x)/2,y:(d.sourceStart.y+d.sourceEnd.y)/2},q=warpPuppetPoint(mid,d);
   near(Math.hypot(q.x-(d.start.x+d.end.x)/2,q.y-(d.start.y+d.end.y)/2),Math.abs(d.bend));
  }
 }
});
test('aim interpolation is continuous at neutral and recoil does not move the shoulder socket',()=>{
 for(const family of Object.keys(kit.assemblies)){
  const a=sample(art,family,{yaw:-1e-7}).pose,b=sample(art,family,{yaw:1e-7}).pose,c=sample(art,family,{recoil:.025}).pose;
  for(const side of ['trigger','support']){assert.ok(Math.hypot(a.joints[side].elbow.x-b.joints[side].elbow.x,a.joints[side].elbow.y-b.joints[side].elbow.y)<.001);assert.deepEqual(a.joints[side].shoulder,c.joints[side].shoulder);}
 }
});
