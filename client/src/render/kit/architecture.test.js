import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { buildAllPieces } from './KitPieces.js';
import { KitView } from './KitView.js';
import { VoxelStore } from '../../../../shared/voxel/VoxelStore.js';
import { MAT } from '../../../../shared/voxel/Materials.js';
import { pickVisibleTile } from '../TilePicking.js';
const pieces=buildAllPieces();
function drawn(s,hints={}) {
    const kit={piece:k=>pieces.get(k),material:()=>new THREE.MeshBasicMaterial()},v=new KitView(kit,[]);v.setVisual({hints});
    return v.buildChunk(s,0,0,0).map(m=>[...pieces].find(([,parts])=>parts.some(p=>p.geometry===m.geometry))?.[0]);
}
test('uninterrupted glass keeps its curtain frame even without a nearby wall material',()=>{
    const s=new VoxelStore(12,12,8);s.fill(0,0,0,11,11,1,'concrete');
    for(let x=2;x<10;x++)for(const z of [2,3])s.set(x,5,z,MAT.glass);
    const ids=drawn(s);assert.ok(ids.includes('glaze'));assert.ok(!ids.includes('window'));
    const r=pickVisibleTile(s,{x:5.5,y:7.5,h:4.5},{x:5.5,y:2.5,h:.5});
    assert.equal(r.voxel.z,1);assert.ok(r.cell.y<5,'glass does not intercept destination selection');
});
test('window style hints select new frame-only families without old masonry surrounds',()=>{
    const s=new VoxelStore(12,12,8),hints={};
    for(const [x,style] of [[2,'sash'],[5,'ribbon'],[8,'factory']]){s.set(x,5,3,MAT.glass);hints[`${x},5,3`]={windowStyle:style};}
    const ids=drawn(s,hints);
    for(const style of ['sash','ribbon','factory'])assert.ok(ids.includes(`window_${style}`));
    assert.ok(!ids.includes('window'));
    for(const style of ['sash','ribbon','factory'])assert.ok(pieces.get(`window_${style}`).every(p=>!['quoin','self','brick'].includes(p.slot)));
});
test('rounded walls, glazed bends and caps use continuous matching pieces',()=>{
    const s=new VoxelStore(12,12,8);s.set(5,5,2,MAT.concrete_wall);s.set(6,5,2,MAT.concrete_wall);s.set(5,6,2,MAT.concrete_wall);
    assert.ok(drawn(s).includes('facade_concrete_3'));assert.ok(drawn(s).includes('joined_cap_3'));
    s.set(5,5,2,MAT.glass);assert.ok(drawn(s).includes('glaze_curve_3'));
});

test('complete ground under curves does not bevel adjacent terrain into cut-outs',async()=>{
 const {stampDoubleCurve,curveCell}=await import('../../../../shared/voxel/DoubleTileCurves.js');
 const {meshChunk}=await import('../ChunkMesher.js');const s=new VoxelStore(12,12,8);s.fill(0,0,0,11,11,1,'concrete');
 stampDoubleCurve(s,{x:4,y:4,z:1,height:0});
 const out=meshChunk(s,0,0,0,{kit:(st,x,y,z)=>!!curveCell(st,x,y,z)});
 let checked=0;
 for(const b of out){const p=b.positions,n=b.normals;
  for(let i=0;i<p.length;i+=3)if(p[i]>3.5&&p[i]<4.01&&p[i+2]>4.1&&p[i+2]<5.9&&p[i+1]>1.8){
   assert.ok(Math.abs(n[i])<1e-6&&Math.abs(n[i+2])<1e-6,'adjacent ground stays flat at the curve seam');checked++;
  }
 }
 assert.ok(checked>0);
});
