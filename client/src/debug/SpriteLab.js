import * as THREE from 'three';
import { SpriteWeapon } from '../anim/SpriteWeapon.js';
import { SpriteAnimator } from '../anim/SpriteAnimator.js';
import { followStep } from '../anim/CutInDirector.js';
import { LIGHTING } from '../render/Scene.js';
async function main() {
const base='/assets/characters/ranger-01/', $=id=>document.getElementById(id);
const [cutin,field]=await Promise.all(['cutin.json','field.json'].map(p=>fetch(base+p).then(r=>r.json())));
const world={camera:new THREE.PerspectiveCamera(),sun:new THREE.DirectionalLight(),hemi:new THREE.HemisphereLight(),back:new THREE.DirectionalLight(0x9fb8ff,.55),renderer:{toneMappingExposure:1}};
world.camera.rotation.y=Math.PI;world.sun.position.set(-.55,1,.8);world.back.position.set(.8,.6,1);
let weapon, follow={}, target={x:0,y:0}, recoil=0, generation=0;
function sections(){
 if(!weapon?.ready)return;const mode=$('sections').value;
 for(const {mesh,layer}of weapon.cards)mesh.visible=!!(mode==='all'||
  (mode==='body'?layer.id==='body':mode==='arms'?!!layer.anatomicalSide:mode==='grips'?layer.bone?.endsWith('-hand'):layer.anatomicalSide===mode));
 weapon.model.visible=(mode==='all'||mode==='grips')&&weapon.gunVisible;
 $('anchors').style.display=mode==='body'?'none':'';
}
function lighting(){const l=LIGHTING[$('lighting').value];world.sun.color.set(l.sun);world.sun.intensity=l.sunI;world.sun.position.fromArray(l.sunDir);world.hemi.color.set(l.sky);world.hemi.groundColor.set(l.ground);world.hemi.intensity=l.hemiI;world.renderer.toneMappingExposure=l.exposure;}
async function rebuild(){
 const token=++generation;weapon?.dispose();$('hero').replaceChildren();
 const pose=$('pose').value,art=pose==='aim'?cutin:cutin.ready[pose];
 $('hero').style.aspectRatio=`${art.width}/${art.height}`;
 const content=document.createElement('div');content.className='sprite-content'+(art.mirror?' sprite-mirrored':'');$('hero').appendChild(content);const overlay=document.createElement('div');overlay.id='anchors';overlay.style.pointerEvents='none';$('hero').appendChild(overlay);
 for(const l of art.layers.filter(l=>l.image)){const img=new Image();img.src=base+l.image;content.appendChild(img);}
 weapon=new SpriteWeapon(content,art,{weapon:$('weapon').value},$('weapon').value,world,base);
 $('status').textContent='Loading rig…';await weapon.loaded;
 if(token!==generation)return;sections();$('status').textContent=weapon.error?weapon.error.message:'Rig ready · 2D character / 3D gun';
}
$('pose').onchange=rebuild;$('weapon').onchange=rebuild;$('lighting').onchange=lighting;
$('sections').onchange=sections;
$('hero').onpointermove=e=>{const r=$('hero').getBoundingClientRect();target={x:((e.clientX-r.left)/r.width-.5)*.22,y:((e.clientY-r.top)/r.height-.5)*.16};};
$('hero').onpointerleave=()=>target={x:0,y:0};$('fire').onclick=()=>recoil=.02;
const img=new Image();img.src=base+field.image;await img.decode();
const tex=new THREE.Texture(),anim=new SpriteAnimator(field,tex);anim.play('run');
for(const f of field.facings){const o=document.createElement('option');o.value=f;o.textContent=f.toUpperCase();$('facing').appendChild(o);}
function play(){anim.play($('clip').value,{restart:true});}
$('clip').onchange=play;$('replay').onclick=play;$('facing').onchange=()=>{anim.row=field.facings.indexOf($('facing').value);anim.apply();};
const context=$('field').getContext('2d');let last=performance.now();lighting();rebuild();
function step(now){const dt=Math.min(.05,(now-last)/1000);last=now;followStep(follow,target,dt,.18);recoil*=Math.exp(-dt*18);
 const targets=weapon?.update({yaw:follow.pos.x*(weapon?.art.mirror?-1:1),pitch:follow.pos.y,recoil});
 if(targets){
  const points=Object.entries(targets).map(([name,p],i)=>{const x=(weapon.art.mirror?1-p[0]:p[0])*100,y=p[1]*100;return `<span style="position:absolute;left:${x}%;top:${y}%;color:#ffbd58;transform:translate(-50%,-50%);font:700 12px system-ui;text-shadow:0 1px 3px #000">⊕${i+1}</span>`;}).join('');
  const joints=weapon.rigPose?.arms.joints;
  const px=p=>[(weapon.art.mirror?1-p.x/weapon.art.width:p.x/weapon.art.width)*100,p.y/weapon.art.height*100];
  const bones=joints&&$('rig-lines').checked?Object.entries(joints).map(([side,arm])=>{
   const positions=['shoulder','elbow','wrist','palm'].map(k=>px(arm[k])),colour=side==='trigger'?'#ffbd58':'#72e7dc';
   return `<polyline points="${positions.map(p=>p.join(',')).join(' ')}" fill="none" stroke="${colour}" stroke-width=".35"/>`+positions.map((p,i)=>`<circle cx="${p[0]}" cy="${p[1]}" r=".65" fill="${colour}"/><text x="${p[0]+1}" y="${p[1]}" fill="${colour}" font-size="2.2">${['S','E','W','P'][i]}</text>`).join('');
  }).join(''):'';
  $('anchors').innerHTML=`<svg viewBox="0 0 100 100" preserveAspectRatio="none" style="position:absolute;inset:0;width:100%;height:100%">${bones}</svg>`+points;
  $('rig-metrics').textContent=`Wrist seam ${(weapon.rigPose?.arms.maxGap||0).toFixed(3)} px · S shoulder / E elbow / W wrist / P palm`;
  $('rig-metrics').dataset.wristGap=weapon.rigPose?.arms.maxGap||0;
  const a=weapon.assembly;
  if(a)$('dimensions').textContent=`${weapon.config.family} · ${a.measuredLengthMetres.toFixed(3)} m · ${a.triangles?.toLocaleString()??'—'} triangles · cel shaded · ${a.parts.map(n=>weapon.anchors.parts[n].role).join(' / ')}`;
  const error=Math.hypot(targets.stock[0]-weapon.art.rig.stock[0],targets.stock[1]-weapon.art.rig.stock[1]);$('status').dataset.stockError=error.toFixed(6);}
 anim.update(dt);const c=field.clips[anim.clip];context.clearRect(0,0,512,512);context.imageSmoothingEnabled=true;
 context.drawImage(img,(c.column+anim.frame)*field.frameWidth,anim.row*field.frameHeight,field.frameWidth,field.frameHeight,64,0,384,512);
 $('frame').textContent=`${anim.clip} · frame ${anim.frame+1}/${c.frames}${!c.loop&&anim.frame===c.frames-1?' · final pose held':''}`;
 requestAnimationFrame(step);}
requestAnimationFrame(step);

}
main().catch(error=>{document.getElementById("status").textContent=error.message;console.error(error);});
