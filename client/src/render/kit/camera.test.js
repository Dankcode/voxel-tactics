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
