import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import sharp from 'sharp';
import {SpriteWeapon,aimGunCamera,gunPoint,gunPoseSample} from '../../anim/SpriteWeapon.js';
import {backshotPlacement,sideCutin} from '../../anim/CutInDirector.js';
const base=new URL('../../../public/assets/characters/ranger-01/',import.meta.url);
const art=JSON.parse(fs.readFileSync(new URL('cutin.json',base)));
const kit=JSON.parse(fs.readFileSync(new URL('../../../public/assets/weapons/ranger-preview/gun-kit.json',import.meta.url)));
test('new backshot is a single fresh painting with no legacy arms, puppet or world-aim sprite',async()=>{
 assert.equal(art.staticPose,true);assert.equal(art.puppet,undefined);assert.equal(art.worldAim,undefined);assert.equal(art.variants,undefined);
 const layers=art.layers.filter(l=>l.image);assert.equal(layers.length,1);assert.equal(layers[0].image,'backshot-static.png');assert.equal(layers[0].bone,undefined);assert.equal(sideCutin(art,'left'),art,'one authored direction');
 const image=sharp(new URL(layers[0].image,base).pathname),meta=await image.metadata();assert.equal(meta.hasAlpha,true);assert.equal(meta.width,art.width);assert.equal(meta.height,art.height);
 assert.equal(fs.readdirSync(base).filter(n=>/^(aim-|world-aim-).*\.png$/.test(n)).length,0,'old backshots removed from public pack');
});
test('aim input cannot deform the painting or rotate the gun out of its fixed grip',()=>{
 for(const gun of Object.values(kit.assemblies)){
  const camera=aimGunCamera(art.rig,gunPoint(gun.stock),art.width/art.height),neutral=gunPoseSample(art,gun,camera,{}),moved=gunPoseSample(art,gun,camera,{yaw:.3,pitch:.2,recoil:.1});
  assert.deepEqual(moved.matrix.elements,neutral.matrix.elements);assert.deepEqual(moved.targets,neutral.targets);
 }
});
test('static mode skips both IK and puppet evaluation in the renderer',()=>{
 const gun=kit.assemblies.rifle,stock=gunPoint(gun.stock),camera=aimGunCamera(art.rig,stock,art.width/art.height);
 const fake={art,ready:true,config:{family:'rifle'},assembly:gun,camera,stock,gunVisible:false,support:gunPoint(gun.support),pivot:{matrix:{copy(){}}},model:{updateMatrixWorld(){}},cards:[],maskScene:{children:[]},renderer:{clear(){},clearDepth(){},render(){}},updateLights(){}};
 assert.doesNotThrow(()=>SpriteWeapon.prototype.update.call(fake,{yaw:.5,pitch:.5,recoil:1}));assert.equal(fake.rigPose.arms.technique,'static-painting');assert.deepEqual(fake.rigPose.input,{yaw:0,pitch:0,recoil:0});
});
test('static backshot remains anchored to the lower left regardless of reticle or shoulder',()=>{
 const view={width:1280,height:720};const a=backshotPlacement(art,{x:100,y:100},view,{bars:0}),b=backshotPlacement(art,{x:1000,y:600},view,{bars:0});assert.deepEqual(a,b);assert.equal(a.left,0);assert.equal(a.top+a.height,view.height);
});
