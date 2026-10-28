// Gun guide points for tools/art/paint_gloves.py: projected part hulls, key points and axis units per pose and family.
import { readFileSync, writeFileSync } from 'node:fs';
import * as THREE from 'three';
import { fitGunPose, gunPoint } from '../../client/src/anim/SpriteWeapon.js';
// Read authoring coordinates directly: guides must precede (not depend on) a new sprite bake.
const formula=JSON.parse(readFileSync('tools/art/sprites/ranger-01/formula.json'));
const cutin={...formula.poses.aim,width:formula.poses.aim.canvasWidth||768,height:768};
const guns=JSON.parse(readFileSync('client/public/assets/weapons/ranger-preview/gun-kit.json'));
const out={};
for (const [pname,art] of [['aim',cutin]]) {
  out[pname]={width:art.width,height:art.height,guns:{}};
  for (const [gname,kit] of Object.entries(guns.assemblies)) {
    const cam=new THREE.OrthographicCamera(),stock=gunPoint(kit.stock);fitGunPose(cam,{...art.rig,...(art.sideView?.rig||{})},stock,art.width/art.height);
    const px=p=>{const q=gunPoint(p).project(cam);return [(q.x+1)/2*art.width,(1-q.y)/2*art.height];};
    const parts={};
    for (const name of kit.parts){const [a,b]=guns.parts[name].bounds;const pts=[];for(const x of [a[0],b[0]])for(const y of [a[1],b[1]])for(const z of [a[2],b[2]])pts.push(px([x,y,z]));parts[name]=pts;}
    const keys={stock:kit.stock,grip:[0,0,0],support:kit.support,muzzle:kit.muzzle};
    out[pname].guns[gname]={parts,keys:Object.fromEntries(Object.entries(keys).map(([k,v])=>[k,px(v)])),pxPerMetre:null,
      unitX:px([0,1,0]).map((v,i)=>v-px([0,0,0])[i]),unitZ:px([0,0,1]).map((v,i)=>v-px([0,0,0])[i]),unitY:px([1,0,0]).map((v,i)=>v-px([0,0,0])[i])};
  }
}
writeFileSync('tools/art/sprites/ranger-01/gun-guides.json',JSON.stringify(out));
console.log(JSON.stringify(out.aim.guns.rifle.unitX),JSON.stringify(out.aim.guns.rifle.unitZ),JSON.stringify(out.aim.guns.rifle.unitY));
