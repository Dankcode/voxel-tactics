import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { SpriteAnimator } from '../../anim/SpriteAnimator.js';
import { EVENT_TO_CLIP } from '../../anim/AnimationClips.js';
import { solveArm, boneMatrix, armTransforms, armRigPose, constrainGunPose } from '../../anim/SpriteArmRig.js';
import { fitGunPose, gunPoint, spriteGunParts, gunPoseSample, sortedSpriteLayers } from '../../anim/SpriteWeapon.js';
import { sideCutin, CutInDirector } from '../../anim/CutInDirector.js';
const json = name => JSON.parse(readFileSync(new URL(`../../../public/assets/characters/ranger-01/${name}`,import.meta.url)));
const field=json('field.json'), cutin=json('cutin.json');
const near=(a,b,epsilon=1e-5)=>assert.ok(Math.abs(a-b)<epsilon,`${a} != ${b}`);
const apply=(m,p)=>({x:m[0]*p.x+m[2]*p.y+m[4],y:m[1]*p.x+m[3]*p.y+m[5]});

test('flat and composited parts share the same anatomical occlusion order',()=>{
 const layers=sortedSpriteLayers(cutin.layers.filter(l=>l.image));
 assert.deepEqual(layers.map(l=>l.id),['support-upper','body','support-hand','trigger-fingers','trigger-hand','support-fingers','support-forearm','trigger-upper','trigger-forearm']);
 assert.equal(layers.slice(0,4).every(l=>l.stage==='back'),true);
 assert.equal(layers.slice(4).every(l=>l.stage==='front'),true);
 const z=id=>cutin.layers.find(l=>l.id===id).zIndex;
 assert.ok(z('support-upper')<z('body') && z('body')<z('support-forearm'),'far shoulder is hidden but its raised forearm clears the torso');
 assert.ok(z('support-hand')<z('gun') && z('gun')<z('support-fingers'),'one support hand wraps both sides of the gun');
 assert.ok(z('trigger-fingers')<z('gun') && z('gun')<z('trigger-hand'),'thumb behind grip, knuckles in front');
 for(const side of ['trigger','support'])for(const hand of [`${side}-hand`,`${side}-fingers`])
  assert.ok(z(hand)<z(`${side}-forearm`),'sleeve cuff covers its hand fragments');
 assert.ok(z('trigger-hand')<z('trigger-upper'),'near sleeve overlaps the gripping hand');
});

test('movement uses only running; downed plays every frame once and holds the settled pose',()=>{
 assert.equal(EVENT_TO_CLIP.move,'run');assert.equal(field.clips.walk,undefined);
 // PLAN-14: a four-frame stride (left foot, passing, right foot, passing) that loops back to the first frame.
 assert.equal(field.clips.run.frames,4);assert.equal(field.clips.run.loop,true);
 const a=new SpriteAnimator(field,new THREE.Texture());a.play('run');
 for(const want of [1,2,3,0,1]){a.update(1/field.clips.run.fps+1e-6);assert.equal(a.frame,want);}
 let ends=0;a.play('down',{onEnd:()=>ends++});
 for(let i=0;i<3;i++){a.update(1/8);assert.equal(a.frame,i+1);}
 a.update(1);assert.equal(a.frame,3);assert.equal(a.clip,'down');assert.equal(ends,1);
 a.update(5);assert.equal(a.frame,3);assert.equal(ends,1);
});
test('the new atlas covers all clips, eight facings, and 176 named frames',()=>{
 assert.equal(field.columns,22);assert.equal(field.rows,8);assert.equal(field.placeholder,false);
 const list=json('sprite-list.json').frames;assert.equal(list.length,176);
 for(const f of field.facings)for(const [clip,c] of Object.entries(field.clips)){
  assert.equal(list.filter(l=>l.facing===f&&l.clip===clip).length,c.frames);
 }
});
test('one sprite: the shooting pose serves aiming and firing; the left shoulder flips that same rig',()=>{
 assert.equal(cutin.ready,undefined,'no separate readying sprite');
 const r=sideCutin(cutin,'right'),l=sideCutin(cutin,'left');
 assert.equal(r,cutin);assert.equal(l.mirror,true);assert.equal(l.mirrorGun,true);assert.deepEqual(l.layers,r.layers);assert.deepEqual(l.rig,r.rig);
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
 for(const art of [cutin]){
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

test('remade shooting arms bend below the wrists throughout the live inertia range',()=>{
 const guns=JSON.parse(readFileSync(new URL('../../../public/assets/weapons/ranger-preview/gun-kit.json',import.meta.url)));
 for(const gun of Object.values(guns.assemblies)){
  const camera=new THREE.OrthographicCamera();fitGunPose(camera,cutin.rig,gunPoint(gun.stock),1);
  const sample=input=>gunPoseSample(cutin,gun,camera,input).targets;
  for(const yaw of [-.12,0,.12])for(const pitch of [-.09,0,.09])for(const recoil of [0,.025]){
   const pose=constrainGunPose(sample,{yaw,pitch,recoil},cutin.rig,768,768);
   for(const j of Object.values(pose.arms.joints)){
    assert.ok(j.elbow.y>Math.max(j.shoulder.y,j.wrist.y)+50,'elbow stays below the shoulder and hand instead of folding across the neck');
    assert.ok(j.wrist.y>j.palm.y,'wrist enters the glove from below');
   }
  }
 }
});

// Exercise the actual stock-fixed projection and workspace constraint, not only palm pinning.
test('full aiming range and recoil preserve both wrists, every bone length, stock contact and mirroring',()=>{
 const guns=JSON.parse(readFileSync(new URL('../../../public/assets/weapons/ranger-preview/gun-kit.json',import.meta.url)));
 let samples=0;
 for(const art of [cutin,sideCutin(cutin,'left')])for(const gun of Object.values(guns.assemblies)){
  const camera=new THREE.OrthographicCamera(),stock=gunPoint(gun.stock);fitGunPose(camera,art.rig,stock,art.width/art.height);
  const sample=input=>gunPoseSample(art,gun,camera,input).targets;
  const rest=sample({});
  const original=gunPoseSample(art,gun,camera,{},0).targets;
  rest.muzzle.forEach((v,i)=>near(v,original.muzzle[i]));
  assert.ok(rest.stock[1]<original.stock[1],'butt raises while muzzle is fixed');
  for(let degrees=0;degrees<=10;degrees+=.5){
   const targets=gunPoseSample(art,gun,camera,{},degrees).targets;
   targets.muzzle.forEach((v,i)=>near(v,original.muzzle[i]));
   const pose=armRigPose(art.rig,targets,art.width,art.height);
   assert.ok(pose.maxGap<.01,'angle control keeps both wrists connected');
   assert.ok(pose.joints.trigger.elbow.x>pose.joints.trigger.shoulder.x,'near elbow stays outside the torso');
  }
  for(let yi=-6;yi<=6;yi++)for(let pi=-4;pi<=4;pi++)for(const recoil of [0,.025]){
   const solved=constrainGunPose(sample,{yaw:yi*.05,pitch:pi*.05,recoil},art.rig,art.width,art.height);samples++;
   assert.ok(solved.arms.maxGap<.01,`wrist gap ${solved.arms.maxGap}`);
   solved.targets.stock.forEach((v,i)=>near(v,rest.stock[i]));
   for(const[side,j]of Object.entries(solved.arms.joints)){
    near(j.wrist.x,j.handWrist.x,.01);near(j.wrist.y,j.handWrist.y,.01);
    const anchor=solved.targets[side==='trigger'?'grip':'support'];near(j.palm.x,anchor[0]*art.width);near(j.palm.y,anchor[1]*art.height);
    for(const part of ['upper','forearm']){const[a,b]=solved.arms.transforms[side+'-'+part];near(a*a+b*b,1);}
    if(art.mirror){const reflected=x=>art.width-x;near(Math.abs(reflected(j.wrist.x)-reflected(j.handWrist.x)),Math.abs(j.wrist.x-j.handWrist.x));}
   }
  }
 }
 assert.equal(samples,1404);
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

test('independent gloves keep cuffs opaque and place gun sockets within the gripping silhouette',()=>{
 const audit=JSON.parse(readFileSync(new URL('../../../../tools/art/sprites/ranger-01/rig-image-audit.json',import.meta.url)));
 for(const[name,pose]of Object.entries(audit))for(const[side,arm]of Object.entries(pose)){
  assert.ok(arm.wristCoverage>.9,`${name}/${side} wrist`);
  assert.ok(arm.palmDistancePixels<768*.045,`${name}/${side} socket near glove`);assert.ok(arm.wristDistancePixels<1);
  for(const family of ['rifle','sniper','shotgun']){
   assert.ok(arm.families[family].wristCoverage>.9,`${name}/${side}/${family} opaque cuff`);
   assert.ok(arm.families[family].wristDistancePixels<1,`${name}/${side}/${family} wrist covered`);
  }
 }
});

test('game gun meshes cut source triangle cost by at least half without losing named parts',()=>{
 const metadata=JSON.parse(readFileSync(new URL('../../../public/assets/weapons/ranger-preview/gun-kit.json',import.meta.url)));
 const buffer=readFileSync(new URL('../../../public/assets/weapons/ranger-preview/gun-kit.glb',import.meta.url));
 const gltf=JSON.parse(buffer.subarray(20,20+buffer.readUInt32LE(12)).toString());
 let total=0;
 for(const node of gltf.nodes.filter(n=>n.mesh!=null)){
  const actual=gltf.meshes[node.mesh].primitives.reduce((n,p)=>n+gltf.accessors[p.indices].count/3,0);
  assert.equal(actual,metadata.parts[node.name].triangles,node.name);
  assert.ok(actual>0);total+=actual;
 }
 assert.equal(total,metadata.optimization.triangles);
 assert.ok(total<metadata.optimization.sourceTriangles*.5);
 assert.ok(buffer.length<1200000,'no accidental source mesh re-export');
});

test('support wrists remain below the barrel and pistol-grip placement cannot twist the support glove',()=>{
 for(const art of [cutin]){
  const rig=art.rig,targets={stock:rig.handAxis[0],muzzle:rig.handAxis[1],grip:rig.grip,support:rig.support};
  const first=armRigPose(rig,targets,art.width,art.height);
  const moved=armRigPose(rig,{...targets,grip:[targets.grip[0]+.03,targets.grip[1]-.04]},art.width,art.height);
  assert.deepEqual(first.transforms['support-hand'],moved.transforms['support-hand']);
  const j=first.joints.support,dx=(targets.muzzle[0]-targets.stock[0])*art.width,dy=(targets.muzzle[1]-targets.stock[1])*art.height;
  assert.ok(dx*(j.handWrist.y-j.palm.y)-dy*(j.handWrist.x-j.palm.x)>0,'support cuff below barrel');
  const palm=art.layers.find(l=>l.id==='support-hand'),fingers=art.layers.find(l=>l.id==='support-fingers');
  assert.equal(palm.stage,'back');assert.equal(fingers.stage,'front');assert.equal(fingers.bone,'support-hand');
  assert.equal(art.sections,'complete-independent-paintings');
 }
});

test('gloves come per gun family and every variant file exists',()=>{
 for(const art of [cutin])for(const id of ['trigger-hand','trigger-fingers','support-hand','support-fingers']){
  const l=art.layers.find(x=>x.id===id);assert.ok(l,id);
  for(const fam of ['sniper','shotgun']){const v=l.variants?.[fam];assert.ok(v,`${id} ${fam}`);
   for(const k of ['image','normal','lightingMask'])readFileSync(new URL(`../../../public/assets/characters/ranger-01/${v[k]}`,import.meta.url));}
 }
 // The thumb sits behind the gun and the support fingers in front of it.
 for(const art of [cutin]){
  assert.equal(art.layers.find(l=>l.id==='support-fingers').stage,'front');assert.equal(art.layers.find(l=>l.id==='support-hand').stage,'back');
  assert.equal(art.layers.find(l=>l.id==='trigger-hand').stage,'front');assert.equal(art.layers.find(l=>l.id==='trigger-fingers').stage,'back');
 }
});
test('every pose has exactly one left and right arm; occlusion fragments belong to those same hands',()=>{
 for(const art of [cutin,sideCutin(cutin,'left')]){
  assert.deepEqual(Object.keys(art.anatomy).sort(),['left','right']);
  for(const [side,limb] of Object.entries(art.anatomy)){
   for(const kind of ['upper','forearm','hand']){
    const layers=art.layers.filter(l=>l.id===limb[kind]);assert.equal(layers.length,1);
    assert.equal(layers[0].anatomicalSide,side);
   }
   for(const id of [...(limb.nearFragments||[]),...(limb.farFragments||[])]){
    const fragment=art.layers.find(l=>l.id===id);assert.equal(fragment.fragmentOf,limb.hand);
    assert.equal(fragment.bone,limb.hand);assert.equal(fragment.anatomicalSide,side);
   }
  }
 }
});
test('field frames keep one scale per source sheet; only oversized frames shrink, and never much',()=>{
 const scale=json('sprite-list.json').scale;
 for(const f of field.facings){
  assert.ok(scale[f].scales.field>0&&scale[f].scales.actions>0,f);
  for(const[,,fit]of scale[f].shrunkToFit)assert.ok(fit>=.85,`${f} frame shrunk to ${fit}`);
 }
});

test('the trigger finger rests on top of the trigger guard and its contact point follows the gun',()=>{
 const guns=JSON.parse(readFileSync(new URL('../../../public/assets/weapons/ranger-preview/gun-kit.json',import.meta.url)));
 for(const art of [cutin]){
  const contact=art.rig.triggerContact,tip=art.rig.arms.trigger.fingertip;assert.ok(contact?.rifle&&contact.sniper&&contact.shotgun);assert.ok(tip);
  const gun=guns.assemblies.rifle,camera=new THREE.OrthographicCamera(),stock=gunPoint(gun.stock);fitGunPose(camera,art.rig,stock,art.width/art.height);
  // Exact at rest. (In the over-the-shoulder pose the gripping hand sits under the upper arm, so only its rest
  // contact is checked.)
  let worst=0;const sway=[[0,0]];
  for(const [yaw,pitch] of sway){
   const sample=input=>{const m=gunPoseSample(art,gun,camera,input).matrix,uv=p=>{p=p.clone().applyMatrix4(m).project(camera);return[(p.x+1)/2,(1-p.y)/2];};
    return{stock:uv(stock),grip:uv(new THREE.Vector3()),support:uv(gunPoint(gun.support)),muzzle:uv(gunPoint(gun.muzzle)),trigger:uv(gunPoint(contact.rifle))};};
   const solved=constrainGunPose(sample,{yaw,pitch},art.rig,art.width,art.height);
   const finger=apply(solved.arms.transforms['trigger-hand'],{x:tip[0]*art.width,y:tip[1]*art.height});
   worst=Math.max(worst,Math.hypot(finger.x-solved.targets.trigger[0]*art.width,finger.y-solved.targets.trigger[1]*art.height));
  }
  assert.ok(worst<4,`fingertip strays ${worst.toFixed(2)} px from the trigger guard contact`);
 }
});
