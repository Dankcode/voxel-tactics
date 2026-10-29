// Lint the Ranger aim puppet: every weapon at neutral and every sway/recoil corner, close-up, mirrored and world.
//   node tools/art/lint_puppet.mjs [--json] [--pose close|world|all] [--file close-puppet.json] [--world-file world-puppet.json]
// Exits 1 when any rule reports an error. apply_puppet.mjs runs the same check before writing.
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import {isDeepStrictEqual} from 'node:util';
import sharp from 'sharp';
import {lintPuppet} from '../../client/src/anim/PuppetLint.js';
export const BASE='client/public/assets/characters/ranger-01/';
const read=p=>JSON.parse(fs.readFileSync(p));
async function channel(file,index){
  const {data,info}=await sharp(file).ensureAlpha().extractChannel(index).raw().toBuffer({resolveWithObject:true});
  return {width:info.width,height:info.height,data};
}
/** Gun-space triangles of each gun family, read from gun-kit.glb (same accessor layout as export_aim_layout.mjs). */
export function loadGunTriangles(kit,file='client/public/assets/weapons/ranger-preview/gun-kit.glb'){
  const buffer=fs.readFileSync(file),jsonLength=buffer.readUInt32LE(12),gltf=JSON.parse(buffer.subarray(20,20+jsonLength)),bin=buffer.subarray(28+jsonLength);
  const accessor=index=>{const a=gltf.accessors[index],v=gltf.bufferViews[a.bufferView],size={SCALAR:1,VEC3:3}[a.type],bytes={5123:2,5125:4,5126:4}[a.componentType];
    return Array.from({length:a.count},(_,i)=>Array.from({length:size},(_,j)=>{const at=(v.byteOffset||0)+(a.byteOffset||0)+i*(v.byteStride||size*bytes)+j*bytes;return a.componentType===5126?bin.readFloatLE(at):bytes===2?bin.readUInt16LE(at):bin.readUInt32LE(at)}));};
  const out={};
  for(const [family,assembly]of Object.entries(kit.assemblies)){
    const tris=[];
    for(const node of gltf.nodes.filter(n=>assembly.parts.includes(n.name)))for(const p of gltf.meshes[node.mesh].primitives){
      const pos=accessor(p.attributes.POSITION),idx=accessor(p.indices).flat();for(let i=0;i<idx.length;i+=3)tris.push([pos[idx[i]],pos[idx[i+1]],pos[idx[i+2]]]);
    }
    out[family]=tris;
  }
  return out;
}
/** Alpha (and the body depth map, if authored) for every painted layer of a pose. */
export async function lintContext(art,base=BASE){
  const alpha={},depthMaps={};
  for(const l of art.layers.filter(l=>l.image))if(fs.existsSync(base+l.image))alpha[l.id]=await channel(base+l.image,3);
  const map=art.puppet.layers?.body?.depthMap;
  if(map&&fs.existsSync(base+map.image))depthMaps.body=await channel(base+map.image,0);
  return {alpha,depthMaps,gun:loadGunTriangles(JSON.parse(fs.readFileSync('client/public/assets/weapons/ranger-preview/gun-kit.json')))};
}
/** Lint the manifest, optionally with replacement close-up / world puppets. Returns {pose: issues[]}. */
export async function lintManifest(art,kit,{pose='all',close=null,world=null,base=BASE}={}){
  if(art.staticPose)return {static:[]};
  const out={};
  const closeArt=close?{...art,puppet:close}:art,worldArt=world?{...art.worldAim,puppet:world}:art.worldAim;
  if(pose!=='world')out.close=lintPuppet(closeArt,kit,await lintContext(closeArt,base));
  // WorldAimSprite.update() never passes yaw/pitch/recoil, so only the neutral world pose is ever shown.
  if(pose!=='close'&&worldArt)out.world=lintPuppet(worldArt,kit,{...await lintContext(worldArt,base),corners:['neutral']});
  if(pose!=='world'&&art.variants?.left){
    const left=art.variants.left;
    out.mirrored=isDeepStrictEqual(left.puppet,closeArt.puppet)&&isDeepStrictEqual(left.rig,art.rig)?[]
      :[{rule:'mirror',severity:'error',family:'*',corner:'-',part:'variants.left',message:'mirrored variant differs from the close-up rig; re-apply the puppet'}];
  }
  return out;
}
export function formatIssues(result){
  const lines=[];let errors=0,warns=0;
  for(const [pose,issues]of Object.entries(result)){
    const e=issues.filter(i=>i.severity==='error'),w=issues.filter(i=>i.severity==='warn');errors+=e.length;warns+=w.length;
    lines.push(`${pose}: ${e.length} error(s), ${w.length} warning(s)`);
    const seen=new Set();
    for(const i of [...e,...w]){const key=[i.rule,i.family,i.part,i.severity].join('|');if(seen.has(key))continue;seen.add(key);
      const corners=issues.filter(j=>[j.rule,j.family,j.part,j.severity].join('|')===key).map(j=>j.corner);
      lines.push(`  ${i.severity==='error'?'✗':'!'} ${i.rule.padEnd(15)} ${String(i.family).padEnd(7)} ${String(i.part).padEnd(26)} ${i.message}  [${[...new Set(corners)].join(', ')}]`);}
  }
  return {text:lines.join('\n'),errors,warns};
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
  const args=process.argv.slice(2),opt=k=>{const i=args.indexOf(k);return i<0?null:args[i+1];};
  const art=read(BASE+'cutin.json'),kit=read('client/public/assets/weapons/ranger-preview/gun-kit.json');
  const result=await lintManifest(art,kit,{pose:opt('--pose')||'all',close:opt('--file')&&read(opt('--file')),world:opt('--world-file')&&read(opt('--world-file'))});
  const {text,errors}=formatIssues(result);
  console.log(args.includes('--json')?JSON.stringify(result,null,1):text);
  process.exit(errors?1:0);
}
