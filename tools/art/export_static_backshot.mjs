// Static sprite and separate gun reference export. No arm rig or deformation.
// Export screen projections and metre-space geometry for independent Blender alignment checks.
import fs from 'node:fs';
import * as THREE from 'three';
import {aimGunCamera,gunPoint,gunPoseSample,lowerGunRearPoint,gunStockDrop} from '../../client/src/anim/SpriteWeapon.js';
const art=JSON.parse(fs.readFileSync('client/public/assets/characters/ranger-01/cutin.json'));
const kit=JSON.parse(fs.readFileSync('client/public/assets/weapons/ranger-preview/gun-kit.json'));
const buffer=fs.readFileSync('client/public/assets/weapons/ranger-preview/gun-kit.glb');
const jsonLength=buffer.readUInt32LE(12),gltf=JSON.parse(buffer.subarray(20,20+jsonLength)),bin=buffer.subarray(28+jsonLength);
function accessor(index){const a=gltf.accessors[index],v=gltf.bufferViews[a.bufferView],size={SCALAR:1,VEC3:3}[a.type],bytes={5123:2,5125:4,5126:4}[a.componentType];return Array.from({length:a.count},(_,i)=>Array.from({length:size},(_,j)=>{const at=(v.byteOffset||0)+(a.byteOffset||0)+i*(v.byteStride||size*bytes)+j*bytes;return a.componentType===5126?bin.readFloatLE(at):bytes===2?bin.readUInt16LE(at):bin.readUInt32LE(at)}));}
const layouts={};
for(const [family,assembly]of Object.entries(kit.assemblies)){
 const camera=aimGunCamera(art.rig,gunPoint(assembly.stock),art.width/art.height),pose=gunPoseSample(art,assembly,camera),meshes=[];
 for(const node of gltf.nodes.filter(n=>assembly.parts.includes(n.name)))for(const p of gltf.meshes[node.mesh].primitives){
  const localVertices=accessor(p.attributes.POSITION).map(v=>lowerGunRearPoint(new THREE.Vector3(...v),assembly).toArray());
  const vertices=localVertices.map(v=>{const q=new THREE.Vector3(...v).applyMatrix4(pose.matrix).project(camera);return[(q.x+1)/2,(q.y+1)/2,-q.z];});
  const indices=accessor(p.indices).flat(),faces=[];for(let i=0;i<indices.length;i+=3)faces.push(indices.slice(i,i+3));meshes.push({name:node.name,vertices,localVertices,faces});
 }
 layouts[family]={targets:pose.targets,meshes,matrix:pose.matrix.toArray(),assembly,stockDropMetres:gunStockDrop(assembly),actualStock:lowerGunRearPoint(gunPoint(assembly.stock),assembly).toArray(),bore:pose.bore?{origin:pose.bore.origin.toArray(),direction:pose.bore.direction.toArray(),target:pose.bore.target.toArray()}:null};
}
fs.writeFileSync('tools/art/sprites/ranger-01/static-gun-layout.json',JSON.stringify({width:art.width,height:art.height,rig:art.rig,image:art.layers.find(l=>l.image).image,layouts}));
