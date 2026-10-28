// Switch the Ranger shoulder pose to the over-the-shoulder perspective view (Blender "aim 3P blockout")
// and seed editable per-weapon puppet keyforms for it. The previous side view is kept as `poses.aim.sideView`,
// which the world pose still uses. Elbows are solved offline from the authored shoulders to the gun-pinned wrists
// with the painted sleeve lengths; the runtime puppet still has no IK. Re-running keeps an existing sideView.
//   node tools/art/seed_aim_3p.mjs [--dry]
import fs from 'node:fs';
import {aimGunCamera,gunPoint,gunPoseSample} from '../../client/src/anim/SpriteWeapon.js';
import {validatePuppet} from '../../client/src/anim/SpritePuppetRig.js';
const SRC='tools/art/sprites/ranger-01/formula.json',MAN='client/public/assets/characters/ranger-01/cutin.json';
const formula=JSON.parse(fs.readFileSync(SRC)),art=JSON.parse(fs.readFileSync(MAN));
const kit=JSON.parse(fs.readFileSync('client/public/assets/weapons/ranger-preview/gun-kit.json'));
// Camera behind the right shoulder (24 mm on a 36 mm sensor, 16:9), gun space in glTF axes, rifle stock as the seat.
// `card` is the painted card's square in that frame (body fit: scale 1.04, offset -0.0833/+0.0729 of frame height).
const VIEW={projection:'perspective',verticalFovDeg:45.75,frame:[1280,720],card:[-74.376,38.088,748.8,748.8],
  position:[0.26,0.1424,0.8482],lookAt:[0,0.104,-25.5167],seat:[0,0.0724,0.1882],near:.02,far:60,referenceLengthMetres:.705};
const CROSSHAIR=[0.9557,0.4297],SCREEN_HEIGHT=1.04,W=768,H=768;
const aim=formula.poses.aim;
if(!aim.sideView)aim.sideView={muzzle:aim.muzzle,rig:{stock:aim.rig.stock,grip:aim.rig.grip,support:aim.rig.support,gunView:aim.rig.gunView,buttRaiseDegrees:aim.rig.buttRaiseDegrees??8},puppet:aim.puppet};
const rig={...aim.rig,gunView:VIEW,buttRaiseDegrees:0},look={...art,rig,width:W,height:H};
// Match AimController's sway clamp (yaw ±0.12, pitch ±0.09 rad); wider ranges author poses the gun never reaches.
const range={yaw:.12,pitch:.09,recoil:.025},px=p=>({x:p[0]*W,y:p[1]*H}),uv=p=>[+(p.x/W).toFixed(4),+(p.y/H).toFixed(4)];
const dist=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y),ang=(a,b)=>Math.atan2((b[1]-a[1])*H,(b[0]-a[0])*W);
function elbow(S,Wr,a,b,prefer){
  const dx=Wr.x-S.x,dy=Wr.y-S.y,d=Math.hypot(dx,dy),ux=dx/d,uy=dy/d;
  if(d>=a+b)return {p:{x:S.x+ux*d*a/(a+b),y:S.y+uy*d*a/(a+b)},stretch:d/(a+b)};
  const dd=Math.max(d,Math.abs(a-b)+1e-6),al=(a*a-b*b+dd*dd)/(2*dd),h=Math.sqrt(Math.max(0,a*a-al*al));
  const c1={x:S.x+ux*al-uy*h,y:S.y+uy*al+ux*h},c2={x:S.x+ux*al+uy*h,y:S.y+uy*al-ux*h};
  // Neutral: elbows down (the lower solution). Parameter extremes: the solution nearest the neutral elbow.
  return {p:prefer==='down'?(c1.y>c2.y?c1:c2):dist(c1,prefer)<dist(c2,prefer)?c1:c2,stretch:1};
}
const puppet={...structuredClone(aim.sideView.puppet),range},report={},clip=v=>Math.max(-.1,Math.min(.1,+v.toFixed(4)));
const inputs={neutral:{},aimXNegative:{yaw:-range.yaw},aimXPositive:{yaw:range.yaw},aimYNegative:{pitch:-range.pitch},aimYPositive:{pitch:range.pitch},recoil:{recoil:range.recoil}};
let rifleNeutral;
for(const [family,assembly]of Object.entries(kit.assemblies)){
  const camera=aimGunCamera(rig,gunPoint(assembly.stock),1);
  const t=Object.fromEntries(Object.entries(inputs).map(([k,i])=>[k,gunPoseSample(look,assembly,camera,i,0).targets]));
  if(family==='rifle')rifleNeutral=t.neutral;
  report[family]={targets:Object.fromEntries(Object.entries(t.neutral).map(([k,v])=>[k,v.map(x=>+x.toFixed(4))]))};
  for(const side of ['trigger','support']){
    const rest=rig.arms[side],key=puppet.keyforms[family][side],S=px(key.shoulder);
    const a=dist(px(rest.shoulder),px(rest.elbow)),b=dist(px(rest.elbow),px(rest.wrist));
    const solve=(targets,prefer)=>{
      const r=ang(targets.stock,targets.muzzle)-ang(...rig.handAxis),co=Math.cos(r),si=Math.sin(r);
      const palm=px(targets[side==='trigger'?'grip':'support']),rp=px(rest.palm),rw=px(rest.wrist),dx=rw.x-rp.x,dy=rw.y-rp.y;
      return elbow(S,{x:palm.x+dx*co-dy*si,y:palm.y+dx*si+dy*co},a,b,prefer);
    };
    const n=solve(t.neutral,'down');key.elbow=uv(n.p);
    const delta=name=>{const e=solve(t[name],n.p).p;return [clip((e.x-n.p.x)/W),clip((e.y-n.p.y)/H)];};
    key.parameters={aimX:{negative:delta('aimXNegative'),positive:delta('aimXPositive')},aimY:{negative:delta('aimYNegative'),positive:delta('aimYPositive')},recoil:{negative:[0,0],positive:delta('recoil')}};
    report[family][side]={elbow:key.elbow,stretch:+n.stretch.toFixed(3),parameters:key.parameters};
  }
}
validatePuppet(puppet);
console.log(JSON.stringify(report,null,1));
if(process.argv.includes('--dry'))process.exit(0);
Object.assign(aim,{puppet,crosshair:CROSSHAIR,screenHeight:SCREEN_HEIGHT,muzzle:rifleNeutral.muzzle.map(v=>+v.toFixed(4))});
Object.assign(aim.rig,{gunView:VIEW,buttRaiseDegrees:0},Object.fromEntries(['stock','grip','support'].map(k=>[k,rifleNeutral[k].map(v=>+v.toFixed(4))])));
for(const pose of [art,art.variants.left]){
  Object.assign(pose,{puppet,crosshair:CROSSHAIR,screenHeight:SCREEN_HEIGHT,muzzle:aim.muzzle});
  Object.assign(pose.rig,{gunView:VIEW,buttRaiseDegrees:0,stock:aim.rig.stock,grip:aim.rig.grip,support:aim.rig.support});
}
fs.writeFileSync(SRC,JSON.stringify(formula,null,2)+'\n');fs.writeFileSync(MAN,JSON.stringify(art,null,2)+'\n');
console.log('Ranger shoulder pose switched to the over-the-shoulder view; world pose unchanged.');
