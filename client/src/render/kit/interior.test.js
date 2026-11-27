import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { InteriorVisibility } from '../InteriorVisibility.js';
import { VoxelView } from '../VoxelView.js';
import { VoxelStore } from '../../../../shared/voxel/VoxelStore.js';

test('unrevealed interiors and inner door cells are hidden while the exterior shell remains',()=>{
    const revealed=new Set();let fog=true;
    const mission={buildings:[{id:'house',x0:0,y0:0,w:7,d:5}],rooms:[
        {id:0,buildingId:'house',floorZ:1,cells:[[1,2],[2,2]]},
        {id:1,buildingId:'house',floorZ:1,cells:[[4,2],[5,2]]}]};
    const v=new InteriorVisibility(mission,revealed,()=>fog);
    assert.ok(v.hiddenAt(1,2,1));assert.ok(v.hiddenAt(3,2,2));
    assert.equal(v.hiddenAt(0,2,2),false,'exterior door remains selectable');
    revealed.add(0);assert.equal(v.hiddenAt(1,2,2),false);
    assert.equal(v.hiddenAt(3,2,2),false,'door adjoining revealed room becomes visible');
    assert.ok(v.hiddenAt(4,2,2));assert.equal(v.concealedRooms().length,1);
    fog=false;assert.equal(v.hiddenAt(4,2,2),false);assert.equal(v.concealedRooms().length,0);
});

test('window sight cells lose their mask without permanently revealing the room',()=>{
 const seen=new Set(['2,2,1']),v=new InteriorVisibility({rooms:[{id:0,floorZ:1,cells:[[2,2],[5,2]]}]},new Set(),()=>true,seen);
 assert.equal(v.hiddenAt(2,2,2),false);assert.equal(v.hiddenAt(5,2,2),true);
 seen.clear();assert.equal(v.hiddenAt(2,2,2),true);
});

test('concealed rooms render as a 2D soft-shadow plane instead of opaque black per-tile InstancedMesh',()=>{
 const store=new VoxelStore(8,8,8);
 const revealed=new Set();
 const iv=new InteriorVisibility({buildings:[{id:'h',x0:0,y0:0,w:7,d:7}],rooms:[{id:0,buildingId:'h',floorZ:1,cells:[[2,2],[3,2],[2,3],[3,3]]}]},revealed,()=>true);
 const scene={scene:new THREE.Scene(),clipping:[]};
 const vv=new VoxelView(scene,store,null);
 vv.interiorVisibility=iv;
 vv.refreshConcealment();
 assert.ok(vv.concealment,'creates concealment veil group');
 assert.ok(vv.concealment.children.length>=1,'has per-floor 2D shadow plane');
 for(const m of vv.concealment.children){
  assert.equal(!!m.isInstancedMesh,false,'does not use per-tile InstancedMesh tiles');
  assert.equal(m.material.transparent,true,'uses translucent 2D shadow material');
 }
 revealed.add(0);
 vv.refreshConcealment();
 assert.equal(vv.concealment,null,'clears shadow veil once room is revealed');
 vv.dispose();
});
