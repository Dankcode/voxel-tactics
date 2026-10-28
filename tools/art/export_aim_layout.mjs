// Export the exact runtime 2D puppet vertices and authored parameter shapes for Blender.
import fs from 'node:fs';
import * as THREE from 'three';
import {aimGunCamera,gunPoint,gunPoseSample} from '../../client/src/anim/SpriteWeapon.js';
import {puppetPose,warpPuppetPoint} from '../../client/src/anim/SpritePuppetRig.js';
const art=JSON.parse(fs.readFileSync('client/public/assets/characters/ranger-01/cutin.json'));
const kit=JSON.parse(fs.readFileSync('client/public/assets/weapons/ranger-preview/gun-kit.json'));
const buffer=fs.readFileSync('client/public/assets/weapons/ranger-preview/gun-kit.glb');
const jsonLength=buffer.readUInt32LE(12),gltf=JSON.parse(buffer.subarray(20,20+jsonLength)),bin=buffer.subarray(28+jsonLength);
function accessor(index){const a=gltf.accessors[index],v=gltf.bufferViews[a.bufferView],size={SCALAR:1,VEC3:3}[a.type],bytes={5123:2,5125:4,5126:4}[a.componentType];return Array.from({length:a.count},(_,i)=>Array.from({length:size},(_,j)=>{const at=(v.byteOffset||0)+(a.byteOffset||0)+i*(v.byteStride||size*bytes)+j*bytes;return a.componentType===5126?bin.readFloatLE(at):bytes===2?bin.readUInt16LE(at):bin.readUInt32LE(at)}));}
const layouts={};
for(const [family,assembly]of Object.entries(kit.assemblies)){
 const camera=aimGunCamera(art.rig,gunPoint(assembly.stock),1);
 const pose=gunPoseSample(art,assembly,camera),arms=puppetPose(art,pose.targets,family),meshes=[];
 for(const node of gltf.nodes.filter(n=>assembly.parts.includes(n.name)))for(const p of gltf.meshes[node.mesh].primitives){
  const vertices=accessor(p.attributes.POSITION).map(v=>{const q=new THREE.Vector3(...v).applyMatrix4(pose.matrix).project(camera);return [(q.x+1)/2,(q.y+1)/2,-q.z];});
  const indices=accessor(p.indices).flat(),faces=[];for(let i=0;i<indices.length;i+=3)faces.push(indices.slice(i,i+3));
  meshes.push({name:node.name,vertices,faces});
 }
 const range=art.puppet.range;
 const forms={neutral:{},aimXNegative:{yaw:-range.yaw},aimXPositive:{yaw:range.yaw},aimYNegative:{pitch:-range.pitch},aimYPositive:{pitch:range.pitch},recoil:{recoil:range.recoil}};
 const samples=Object.fromEntries(Object.entries(forms).map(([name,input])=>[name,puppetPose(art,gunPoseSample(art,assembly,camera,input).targets,family,input)]));
 const cards=art.layers.filter(l=>l.image).map(layer=>{
  const l={...layer,...layer.variants?.[family]},deform=!!arms.deformers[l.bone],n=deform?art.puppet.meshDivisions:1;
  const [x0,y0,x1,y1]=deform?l.bounds:[0,0,768,768],uv=[],source=[],faces=[];
  for(let y=0;y<=n;y++)for(let x=0;x<=n;x++){const px=x0+(x1-x0)*x/n,py=y0+(y1-y0)*y/n;source.push({x:px,y:py});uv.push([px/768,1-py/768]);}
  for(let y=0;y<n;y++)for(let x=0;x<n;x++){const i=y*(n+1)+x;faces.push([i,i+n+1,i+n+2,i+1]);}
  const shapes=Object.fromEntries(Object.entries(samples).map(([name,a])=>[name,source.map(p=>{let q=p;const d=a.deformers[l.bone],m=a.handTransforms[l.bone];if(d)q=warpPuppetPoint(p,d);else if(m)q={x:m[0]*p.x+m[2]*p.y+m[4],y:m[1]*p.x+m[3]*p.y+m[5]};return[q.x/768,1-q.y/768,0];})]));
  return {id:l.id,bone:l.bone,image:l.image,zIndex:l.zIndex,uv,faces,shapes};
 });
 layouts[family]={targets:pose.targets,arms,meshes,cards};
}
fs.writeFileSync('tools/art/sprites/ranger-01/aim-layout.json',JSON.stringify(layouts));
