import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { WalkerModel } from '../../units/WalkerModel.js';
import { VoxelStore } from '../../../../shared/voxel/VoxelStore.js';
for(const type of ['wall_strider','siege_weaver'])test(`${type} builds distinct jointed legs and keeps geometry finite while stepping`,()=>{
    const store=new VoxelStore(20,20,12);store.fill(0,0,0,19,19,1,'concrete');
    const u={id:'e0',type,x:8,y:8,z:1,parts:{legs:{disabled:false}}},model=new WalkerModel(u,store,[]);
    assert.equal(model.legs.length,type==='wall_strider'?4:6);
    for(let step=0;step<40;step++){
        model.update(new THREE.Vector3(8.5+step*.02,2,8.5),1/60);
        for(const leg of model.legs)for(const mesh of [leg.upper,leg.lower,leg.joint,leg.toe])assert.ok([...mesh.position.toArray(),...mesh.quaternion.toArray(),...mesh.scale.toArray()].every(Number.isFinite));
    }
    assert.equal(model.root.children.filter(c=>c.userData.unitId==='e0').length,model.root.children.length);model.dispose();
});
