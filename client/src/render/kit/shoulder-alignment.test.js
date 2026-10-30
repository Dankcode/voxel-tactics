import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import {aimGunCamera,gunPoint,gunPoseSample,gunStockDrop,lowerGunRearPoint} from '../../anim/SpriteWeapon.js';
import {backshotPlacement} from '../../anim/CutInDirector.js';
import {projectedSpreadRadius,updateReticle} from '../../ui/AimReticle.js';
import {Hud} from '../../ui/Hud.js';
const art=JSON.parse(fs.readFileSync(new URL('../../../public/assets/characters/ranger-01/cutin.json',import.meta.url)));
const kit=JSON.parse(fs.readFileSync(new URL('../../../public/assets/weapons/ranger-preview/gun-kit.json',import.meta.url)));

test('all actual barrel axes intersect the target ray, with a fixed shoulder and no weapon stretching',()=>{
 for(const gun of Object.values(kit.assemblies))for(const view of [{width:1280,height:720},{width:1024,height:768},{width:1920,height:1080},{width:844,height:390}]){
  const placement=backshotPlacement(art,null,view,{bars:0});
  assert.ok(placement.width<=view.width+1,'painting does not cover the centre on narrow displays');
  for(const distance of [3,8,25,100])for(const xy of [[.5,.5],[.48,.45],[.55,.55]]){
   const uv=[(xy[0]*view.width-placement.left)/placement.width,(xy[1]*view.height-placement.top)/placement.height];
   const camera=aimGunCamera(art.rig,gunPoint(gun.stock),art.width/art.height),pose=gunPoseSample(art,gun,camera,{aimUV:uv,aimDistance:distance});
   const stock=lowerGunRearPoint(gunPoint(gun.stock),gun).applyMatrix4(pose.matrix).project(camera);
   assert.ok(Math.hypot(pose.targets.stock[0]-(stock.x+1)/2,pose.targets.stock[1]-(1-stock.y)/2)<1e-10,'stock follows the lowered rear geometry');
   assert.ok(pose.targets.stock[1]>=art.rig.stock[1]-1e-10,'rear stock is lowered');
   const along=pose.bore.target.clone().sub(pose.bore.origin);
   assert.ok(along.dot(pose.bore.direction)>0,'muzzle faces forward');
   assert.ok(along.clone().cross(pose.bore.direction).length()<1e-9,'bore reaches the actual target, not just a parallel screen line');
   assert.ok(Math.abs(pose.matrix.determinant()-1)<1e-10,'no scale or shear');
   const projected=pose.bore.target.clone().project(camera);
   assert.ok(Math.hypot(((projected.x+1)/2-uv[0])*placement.width,((1-projected.y)/2-uv[1])*placement.height)<1e-7);
  }
 }
});

test('accuracy circle grows with angular spread and magnification for every weapon',()=>{
 const camera=new THREE.PerspectiveCamera(38,16/9,.01,500);
 const radius=projectedSpreadRadius(camera,720,2,15);
 assert.ok(projectedSpreadRadius(camera,720,4,15)>radius*1.99);
 camera.fov=20;assert.ok(projectedSpreadRadius(camera,720,2,15)>radius);
 assert.ok(projectedSpreadRadius(camera,390,20,15,844)<=159,'circle and distance fit a short viewport');
 assert.equal(projectedSpreadRadius(camera,720,2,30),projectedSpreadRadius(camera,720,2,15),'angular spread remains distance independent in perspective');
});

const classList=()=>{const values=new Set();return{add:x=>values.add(x),remove:x=>values.delete(x),contains:x=>values.has(x),toggle:(x,on)=>on?values.add(x):values.delete(x)}};
test('live reticle shows only distance and never requests hit odds or pellet estimates',()=>{
 const read={},el={classList:classList(),style:{setProperty(k,v){this[k]=v}},querySelector:s=>{assert.equal(s,'span.read');return read}};
 const camera=new THREE.PerspectiveCamera(38,16/9,.01,100),unit={id:'u',x:0,y:0,z:0};camera.updateMatrixWorld();
 const g={hud:{el:()=>el,equipment:{}},selectedUnit:()=>unit,mode:{kind:'shoot',weaponId:'blunderbuss'},freeAim:{x:0,y:-10,h:0},scene:{camera,renderer:{domElement:{getBoundingClientRect:()=>({width:1280,height:720,left:0,top:0})}}},battle:{spreadFor:()=>({spread:5})},partChance:()=>{throw Error('detailed odds must not be computed')},aimStance:{muzzle:{x:0,y:0,h:0}}};
 updateReticle(g);assert.equal(read.textContent,'10.0 m');assert.equal(el.style.left,'640px');assert.ok(parseFloat(el.style['--aim-radius'])>80);
 g.cutins={current:{}};updateReticle(g);assert.ok(el.classList.contains('hidden'),'no duplicate live reticle during firing');
});

test('aim HUD replaces tactical panels and restores them on exit',()=>{
 const el={classList:classList()},root={classList:classList()},unit={ap:4,ammo:{repeater:30},items:{},inventory:[]};
 const g={mode:{kind:'shoot',weaponId:'repeater'},selectedUnit:()=>unit,battle:{shotAp:()=>2},aimPointer:{unavailable:true}};
 const hud={game:g,root,el:()=>el};Hud.prototype.renderTarget.call(hud);
 assert.ok(root.classList.contains('shooter-mode'));assert.match(el.innerHTML,/shooter-ammo/);assert.doesNotMatch(el.innerHTML,/PELLETS|ANY HIT|%|lean out|body part|AP/);
 g.mode.kind='move';Hud.prototype.renderTarget.call(hud);assert.ok(!root.classList.contains('shooter-mode'));assert.ok(el.classList.contains('hidden'));
});


test('shotgun and sniper butt drops leave every forward barrel point unchanged',()=>{
 for(const [family,gun]of Object.entries(kit.assemblies)){
  const stock=gunPoint(gun.stock),dropped=lowerGunRearPoint(stock,gun);
  assert.ok(Math.abs((stock.y-dropped.y)-gunStockDrop(gun))<1e-10);
  for(const p of [gun.muzzle,gun.support,gun.grip])assert.ok(lowerGunRearPoint(gunPoint(p),gun).distanceTo(gunPoint(p))<1e-10);
  assert.equal(gunStockDrop(gun)>0,family!=='rifle');
 }
});
