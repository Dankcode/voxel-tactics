import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { CameraDirector } from '../../anim/CameraDirector.js';
import { VoxelStore } from '../../../../shared/voxel/VoxelStore.js';

test('a committed aim preserves its camera; an ordinary action still uses the closer back shot', () => {
    const scene={aspect:1.6},camera=new CameraDirector(scene),shooter=new THREE.Vector3(8.5,2,8.5),target=new THREE.Vector3(8.5,2,18.5);
    const store=new VoxelStore(30,30,12);store.fill(0,0,0,29,29,1,'concrete');store.fill(0,5,2,29,5,7,'brick');camera.store=store;
    camera.prepareAim(shooter,target);assert.equal(camera.phase,'prepare');
    const distance=camera.cam.position.distanceTo(shooter),position=camera.cam.position.clone(),look=camera.look.clone(),fov=camera.cam.fov;
    assert.ok(distance<12);assert.ok(camera.clear(position));
    assert.ok(camera.commitAim());camera.apply(1);
    assert.ok(camera.cam.position.distanceTo(position)<1e-9);assert.ok(camera.look.distanceTo(look)<1e-9);assert.equal(camera.cam.fov,fov);
    assert.ok(camera.resumeAim());assert.equal(camera.phase,'prepare');
    camera.begin(shooter,target);assert.equal(camera.phase,'action');
    assert.ok(camera.cam.position.distanceTo(shooter)<distance);
    for(let k=0;k<=1;k+=0.1){camera.apply(k);assert.ok(camera.clear(camera.cam.position));}
    assert.equal(scene.actionCamera,camera.cam);camera.end();assert.equal(scene.actionCamera,null);
});

test('continuous finishes preserve material identity and do not repeat image textures', async () => {
    const {MaterialLibrary}=await import('../MaterialLibrary.js');
    const {KitLibrary}=await import('./KitLibrary.js');
    const {materialByKey}=await import('../../../../shared/voxel/Materials.js');
    const materials=new MaterialLibrary({capabilities:{getMaxAnisotropy:()=>1}},[]);
    const kit=new KitLibrary(materials);
    for(const key of ['lawn','asphalt','oak_floor','ceramic']) {
        const material=materials.get(key);
        assert.equal(material.map,null);assert.equal(material.normalMap,null);
        assert.equal(material.color.getHex(),materialByKey(key).color);
    }
    const wall=kit.material('self','stucco',[]);
    assert.equal(wall.map,null);assert.equal(wall.color.getHex(),materialByKey('stucco').color);
});

test('tactical pitch stays at 45 degrees across zoom; reset restores framing after orbit', async()=>{
    const {CameraRig}=await import('../CameraRig.js');
    const rig=new CameraRig(1.6);rig.target.set(12,2,12);
    for(const distance of [12,36,80,110]) {
        rig.distance=rig.distanceTarget=distance;rig.apply();
        assert.ok(Math.abs(rig.pitch()-Math.PI/4)<1e-9);
        const delta=rig.camera.position.clone().sub(rig.target);
        assert.ok(Math.abs(Math.atan2(delta.y,Math.hypot(delta.x,delta.z))-Math.PI/4)<1e-9);
    }
    rig.orbit(300,200);rig.resetTactical();
    assert.equal(rig.mode,'perspective');assert.equal(rig.distance,27);assert.equal(rig.pitchOffset,0);
    assert.equal(rig.yaw,Math.PI/4);assert.equal(rig.camera.fov,38);
});

test('CAD presets select plan and compass views while pan stays screen-relative',async()=>{
 const {CameraRig}=await import('../CameraRig.js');const r=new CameraRig();
 r.setPreset('plan');assert.ok(Math.abs(r.pitch()*180/Math.PI-85)<1e-9);
 r.setPreset('E');r.update(0);assert.equal(r.yaw,Math.PI/2);assert.equal(r.pitch(),Math.PI/4);
 r.moveBy(2,0);assert.ok(Math.abs(r.target.x)<1e-9);assert.equal(r.target.z,-2);
 r.setPreset('iso');r.update(0);assert.equal(r.yaw,Math.PI/4);
});

test('aiming round a corner: the camera keeps the right shoulder but moves in until it sees past the wall', () => {
    // Step-out tile (9,12); a tall wall along row 11 from x=10 eastward; the target is north-west past its end.
    const store = new VoxelStore(30, 30, 12); store.fill(0, 0, 0, 29, 29, 1, 'concrete'); store.fill(10, 11, 2, 20, 11, 6, 'concrete');
    const cam = new CameraDirector({ aspect: 1.6 }); cam.store = store;
    const shooter = new THREE.Vector3(9.5, 2, 12.5), target = new THREE.Vector3(6.5, 3.2, 2.5);
    cam.prepareAim(shooter, target);
    assert.equal(cam.phase, 'prepare');
    assert.ok(cam.sees(cam.from, cam.look) && cam.sees(cam.to, cam.look), 'the target is in view, not the wall');
    // Still over the right shoulder (or straight behind), never flipped to the left.
    const dir = target.clone().sub(shooter).setY(0).normalize(), right = new THREE.Vector3(-dir.z, 0, dir.x);
    assert.ok(cam.from.clone().sub(shooter).dot(right) >= -1e-6, 'right shoulder');
    // In the open the full shoulder offset is kept.
    const open = new CameraDirector({ aspect: 1.6 }), o = new VoxelStore(30, 30, 12); o.fill(0, 0, 0, 29, 29, 1, 'concrete'); open.store = o;
    open.prepareAim(shooter, target);
    assert.ok(Math.abs(open.from.clone().sub(shooter).dot(right) - 1.3) < 1e-6);
    assert.ok(cam.from.clone().sub(shooter).dot(right) < 1.3, 'less offset round the corner');
});

test('nearby allied billboards clear the aiming view and return after camera exit',()=>{
 const c=new CameraDirector({aspect:16/9});c.active=true;c.cam.fov=20;c.cam.aspect=16/9;c.cam.position.set(0,2,0);c.cam.lookAt(0,2,-20);c.cam.updateMatrixWorld(true);
 assert.equal(c.foregroundUnit(new THREE.Vector3(1,1,-7)),true);
 assert.equal(c.foregroundUnit(new THREE.Vector3(1,1,-30)),false);
 assert.equal(c.foregroundUnit(new THREE.Vector3(20,1,-7)),false);
 c.active=false;assert.equal(c.foregroundUnit(new THREE.Vector3(1,1,-7)),false);
});

test('new double-tile curve modules load alongside an existing baked library',async()=>{
 const {KitLibrary}=await import('./KitLibrary.js');const kit=new KitLibrary({});
 for(const kind of ['wall','floor','glass'])for(let turn=0;turn<4;turn++)for(let dx=0;dx<2;dx++)for(let dy=0;dy<2;dy++)assert.ok(kit.piece(`double_curve_${kind}_${turn}_${dx}_${dy}`));
});

test('aiming keeps the complete map rendered while choosing clear positions around walls',()=>{
 const c=new CameraDirector({aspect:16/9}),s=new VoxelStore(24,24,10),xrayCalls=[];c.store=s;c.xray=value=>xrayCalls.push(value);
 s.fill(7,4,2,9,4,4,'concrete_wall');s.fill(7,12,2,9,12,4,'concrete_wall');
 const shooter=new THREE.Vector3(8.5,2,6.5),target=new THREE.Vector3(8.5,3,18.5);
 c.prepareAim(shooter,target);
 assert.equal(c.phase,'prepare');assert.equal(c.xrayCells,null);assert.deepEqual(xrayCalls,[null]);
 c.track(target,1/60);
 assert.equal(c.xrayCells,null);assert.deepEqual(xrayCalls,[null]);
});

test('obstructsAim catches close, reticle-overlapping and pitched-down allies while keeping flanks clear',()=>{
 const c=new CameraDirector({aspect:16/9});
 c.cam.fov=38;c.cam.aspect=16/9;c.cam.position.set(0,3.2,0);c.cam.lookAt(0,1.2,-12);c.cam.updateMatrixWorld(true);
 const aimWorld=new THREE.Vector3(0,1.2,-12);
 // Inactive camera never obstructs.
 c.active=false;
 assert.equal(c.obstructsAim(new THREE.Vector3(0,1,-3),aimWorld),false);
 c.active=true;
 // Close ally right in front of the shoulder camera or near the reticle.
 assert.equal(c.obstructsAim(new THREE.Vector3(0.4,1,-3.5),aimWorld),true);
 assert.equal(c.obstructsAim(new THREE.Vector3(0,0.4,-6.5),aimWorld),true);
 // Off-axis distant ally or ally behind aimWorld stays visible.
 assert.equal(c.obstructsAim(new THREE.Vector3(8,1,-10),aimWorld),false);
 assert.equal(c.obstructsAim(new THREE.Vector3(0,1,-16),aimWorld),false);
});

test('frameAim keeps staticPose shooter hidden and Game.frame hides obstructing allies only while aiming',async()=>{
 const {Game}=await import('../../Game.js');
 const shooter={id:'p0',side:'player',x:5,y:5,z:1,dead:false,art:'ranger-01'};
 const closeAlly={id:'p1',side:'player',x:5,y:3,z:1,dead:false};
 const flankAlly={id:'p2',side:'player',x:20,y:5,z:1,dead:false};
 const foe={id:'e0',side:'enemy',x:5,y:0,z:1,dead:false};
 const cam=new CameraDirector({aspect:16/9});
 const mkView=(unit,pos,selected=false)=>({
  id:unit.id,unit,pos,selected,hovered:false,spriteHeight:2.4,group:{visible:true},
  sprite:{visible:true},ring:{visible:true},blob:{visible:true},beacon:{visible:selected},selRing:{visible:selected},bar:{visible:true},
  update(){},updateDrop(){},drawBar(){}
 });
 const views=new Map([
  ['p0',mkView(shooter,new THREE.Vector3(5.5,2,5.5),true)],
  ['p1',mkView(closeAlly,new THREE.Vector3(5.5,2,3.5),false)],
  ['p2',mkView(flankAlly,new THREE.Vector3(20.5,2,5.5),false)],
  ['e0',mkView(foe,new THREE.Vector3(5.5,2,0.5),false)]
 ]);
 const aimPoint={x:5.5,y:0.5,h:3.0};
 const cl=()=>{const s=new Set();return{add:x=>s.add(x),remove:x=>s.delete(x),contains:x=>s.has(x),toggle:(x,on)=>on?s.add(x):s.delete(x)};};
 const retEl={classList:cl(),style:{setProperty(k,v){this[k]=v;}},querySelector:()=>({textContent:''})};
 const g={
  time:0,last:0,selected:'p0',selectedUnit:()=>shooter,views,
  battle:{store:{get:()=>0,surfaces:()=>[{z:1}]},spreadFor:()=>({spread:1}),unit:()=>null},
  cameraDirector:cam,
  cutins:{beginAim(){cam.hidden=new Set();},placeAim(){}},
  hud:{el:()=>retEl,equipment:{open:false}},
  mode:{kind:'shoot',weaponId:'repeater'},
  freeAim:aimPoint,aimStance:null,cutLevel:Infinity,
  options:{aimSway:false,unitTags:'selected',rotateSpeed:1,showEnemyBars:true},
  scene:{yaw:0,rig:{rotationSpeed:1},camera:cam.cam,renderer:{render(){},domElement:{getBoundingClientRect:()=>({width:1280,height:720,left:0,top:0})}},updateCamera(){},render(){}},
  player:{speed:1,busy:false},
  tacticalMarks:{update(){}},sightings:{update(){}},
  overlays:{marker:{visible:false},pulse(){}},
  fx:{update(){}},library:{update(){}},lanterns:{update(){}},
  handleKeysHeld(){},refreshBuildingView(){},stepAim(){},aimMuzzle:()=>({x:5.5,y:5.5,h:3.35,side:'right'}),shooterOf:u=>u
 };
 Game.prototype.frameAim.call(g,shooter,aimPoint,{x:5.5,y:5.5,h:3.35,side:'right'});
 assert.ok(cam.active&&cam.hidden.has('p0'),'frameAim preserves shooter in cameraDirector.hidden even when cutins resets on beginAim');
 cam.update(1);
 Game.prototype.frame.call(g,16);
 assert.equal(views.get('p0').sprite.visible,false);
 assert.equal(views.get('p0').ring.visible,false);
 assert.equal(views.get('p0').blob.visible,false);
 assert.equal(views.get('p0').beacon.visible,false);
 assert.equal(views.get('p0').selRing.visible,false);
 assert.equal(views.get('p1').sprite.visible,false,'obstructing ally clears aiming view');
 assert.equal(views.get('p2').sprite.visible,true,'distant flank ally stays visible');
 assert.equal(views.get('e0').sprite.visible,true,'enemy targets remain visible');
 cam.end();
 Game.prototype.frame.call(g,32);
 assert.equal(views.get('p0').sprite.visible,true,'restored after exiting aim camera');
 assert.equal(views.get('p1').sprite.visible,true,'ally restored after exiting aim camera');
});

test('CameraRig.glideTo smoothly eases target on the overview without changing yaw, pitch or distance', async () => {
 const { CameraRig } = await import('../CameraRig.js');
 const rig = new CameraRig(16 / 9);
 const yaw0 = rig.yaw, pitch0 = rig.pitch(), dist0 = rig.distance;
 rig.target.set(0, 2, 0);
 rig.glideTo(new THREE.Vector3(12, 2, 8), 6);
 rig.update(0.016);
 const midDist = rig.target.distanceTo(new THREE.Vector3(12, 2, 8));
 assert.ok(midDist > 0.5 && midDist < Math.hypot(12, 8), 'glides gradually on first frame');
 assert.equal(rig.yaw, yaw0);
 assert.equal(rig.pitch(), pitch0);
 assert.equal(rig.distance, dist0);
 for (let i = 0; i < 120; i++) rig.update(0.016);
 assert.ok(rig.target.distanceTo(new THREE.Vector3(12, 2, 8)) < 0.05);
 assert.equal(rig.glide, null, 'clears glide upon arrival');
 assert.equal(rig.yaw, yaw0);
 assert.equal(rig.pitch(), pitch0);
 assert.equal(rig.distance, dist0);
});
