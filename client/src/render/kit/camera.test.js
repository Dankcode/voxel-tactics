import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { CameraDirector } from '../../anim/CameraDirector.js';
import { VoxelStore } from '../../../../shared/voxel/VoxelStore.js';

test('preparation is closer than tactics; action lowers and tightens the back shot without entering walls', () => {
    const scene={aspect:1.6},camera=new CameraDirector(scene),shooter=new THREE.Vector3(8.5,2,8.5),target=new THREE.Vector3(8.5,2,18.5);
    const store=new VoxelStore(30,30,12);store.fill(0,0,0,29,29,1,'concrete');store.fill(0,5,2,29,5,7,'brick');camera.store=store;
    assert.ok(camera.prepare(shooter,target) !== false);assert.equal(camera.phase,'prepare');
    const distance=camera.cam.position.distanceTo(shooter),height=camera.cam.position.y;
    assert.ok(distance<12);assert.ok(camera.clear(camera.cam.position));
    camera.begin(shooter,target);assert.equal(camera.phase,'action');
    assert.ok(camera.cam.position.distanceTo(shooter)<distance);assert.ok(camera.cam.position.y<height);
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

test('aim clearance removes foreground geometry without cutting target cover',()=>{
 const c=new CameraDirector({aspect:16/9}),s=new VoxelStore(24,24,10);c.store=s;
 s.fill(7,4,2,9,4,4,'concrete_wall');s.fill(7,12,2,9,12,4,'concrete_wall');
 const cells=c.foregroundCells(new THREE.Vector3(8.5,3,2.5),new THREE.Vector3(8.5,3,18.5),new THREE.Vector3(8.5,2,6.5));
 assert.ok([...cells].some(k=>k.split(',')[1]==='4'));
 assert.ok([...cells].every(k=>k.split(',')[1]!=='12'));
});
