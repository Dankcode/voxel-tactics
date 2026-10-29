// Switch the Ranger shoulder pose to the over-the-shoulder perspective view (Blender "aim 3P blockout")
// and seed editable per-weapon puppet keyforms for it. The previous side view is kept as `poses.aim.sideView`,
// which the world pose still uses. Elbows are solved offline from the authored shoulders to the gun-pinned wrists
// with the painted sleeve lengths; the runtime puppet still has no IK. Re-running keeps an existing sideView.
//   node tools/art/seed_aim_3p.mjs [--dry]
import fs from 'node:fs';
import {aimGunCamera,gunPoint,gunPoseSample} from '../../client/src/anim/SpriteWeapon.js';
import {validatePuppet} from '../../client/src/anim/SpritePuppetRig.js';
import {bodyCentre,lintGeometry,rasterPuppet,samplePuppet,seamGaps,LINT_LIMITS} from '../../client/src/anim/PuppetLint.js';
import {lintContext} from './lint_puppet.mjs';
const SRC='tools/art/sprites/ranger-01/formula.json',MAN='client/public/assets/characters/ranger-01/cutin.json';
const formula=JSON.parse(fs.readFileSync(SRC)),art=JSON.parse(fs.readFileSync(MAN));
if(art.staticPose)throw Error('The old rigged backshot is retired. Use tools/art/build_static_backshot.mjs.');
const kit=JSON.parse(fs.readFileSync('client/public/assets/weapons/ranger-preview/gun-kit.json'));
// Camera behind the right shoulder (24 mm on a 36 mm sensor, 16:9), gun space in glTF axes, rifle stock as the seat.
// `card` is the painted card's square in that frame (body fit: scale 1.04, offset -0.0833/+0.0729 of frame height).
const VIEW={projection:'perspective',verticalFovDeg:45.75,frame:[1280,720],card:[-74.376,38.088,748.8,748.8],
  position:[0.26,0.1424,0.8482],lookAt:[0,0.104,-25.5167],seat:[0,0.0724,0.1882],near:.02,far:60,referenceLengthMetres:.705};
const CROSSHAIR=[0.9557,0.4297],SCREEN_HEIGHT=1.04,W=768,H=768;
// Camera distances (metres) measured on the 3P blockout: torso plane, trigger arm in front of it, support arm behind.
const WRIST_WIDTH=+(process.env.WRIST_WIDTH||1.5);
const DEPTH={trigger:{shoulder:.58,elbow:.6},support:{shoulder:.76,elbow:.9}},BODY_DEPTH=.65;
const LAYERS={body:{depth:BODY_DEPTH},'support-upper':{clip:{by:['body'],mode:'inside'}},
  'trigger-hand':{depthOffset:-.02},'trigger-fingers':{depthOffset:.03},'support-hand':{depthOffset:.02},'support-fingers':{depthOffset:-.03},
  // Placeholder swaps (same painting) until the receding-sleeve paintings in remake-prompts.json exist.
  'trigger-forearm':{depthOffset:-.03,swaps:[{image:'aim-trigger-forearm.png',foreshorten:[0,.8],blend:.1}]},
  'support-forearm':{swaps:[{image:'aim-support-forearm.png',foreshorten:[0,.8],blend:.1}]}};
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
  // Neutral: the elbow on the far side of the shoulder→wrist line from `prefer.away` (the torso), so it hangs beside
  // the body instead of across it. Parameter extremes: the solution nearest the neutral elbow.
  if(prefer.away){const side=p=>Math.sign((Wr.x-S.x)*(p.y-S.y)-(Wr.y-S.y)*(p.x-S.x)),body=side(prefer.away);return {p:side(c1)!==body?c1:c2,stretch:1};}
  return {p:dist(c1,prefer)<dist(c2,prefer)?c1:c2,stretch:1};
}
const BODY=bodyCentre(art,(await lintContext(art)).alpha);
const puppet={...structuredClone(aim.sideView.puppet),version:2,range,layers:LAYERS},report={},clip=v=>Math.max(-.1,Math.min(.1,+v.toFixed(4)));
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
      const wrist={x:palm.x+dx*co-dy*si,y:palm.y+dx*si+dy*co};return {...elbow(S,wrist,a,b,prefer),wrist};
    };
    // Trigger arm: the upper sleeve hangs at its painted length beside the torso (side-on to the camera, so not
    // foreshortened); the angle from vertical is the one whose forearm length is closest to painted. The forearm runs
    // into the scene behind it. Support arm: two-bone solve near the authored side-view elbow; it stays behind the torso.
    const hang=th=>({x:S.x+a*Math.sin(th),y:S.y+a*Math.cos(th)});
    let n;
    if(side==='trigger'){
      const wr=solve(t.neutral,{x:0,y:0}).wrist;let best=null;
      for(let d=6;d<=35;d++){const p=hang(d*Math.PI/180),r=dist(p,wr)/b;if(!best||Math.abs(r-1)<Math.abs(best.r-1))best={p,r,d};}
      n={p:best.p,stretch:best.r,angle:best.d};
    }else n=solve(t.neutral,px(aim.sideView.puppet.keyforms[family][side].elbow));
    key.elbow=uv(n.p);
    // The glove keeps its painted angle while the forearm now meets it from below: widen the cuff end to close the joint.
    if(side==='trigger')key.forearm={...key.forearm,width:[key.forearm.width[0],1.05,WRIST_WIDTH]};
    const delta=name=>{const e=solve(t[name],n.p).p;return [clip((e.x-n.p.x)/W),clip((e.y-n.p.y)/H)];};
    key.parameters=side==='trigger'?{aimX:{negative:[0,0],positive:[0,0]},aimY:{negative:[0,0],positive:[0,0]},recoil:{negative:[0,0],positive:[-.006,.004]}}:{aimX:{negative:delta('aimXNegative'),positive:delta('aimXPositive')},aimY:{negative:delta('aimYNegative'),positive:delta('aimYPositive')},recoil:{negative:[0,0],positive:delta('recoil')}};
    key.depth={...DEPTH[side]};
    report[family][side]={elbow:key.elbow,stretch:+n.stretch.toFixed(3),angle:n.angle,parameters:key.parameters};
  }
}
validatePuppet(puppet);
// Seam pass: for each trigger-arm keyform, try small elbow offsets and keep the one with the fewest see-through holes
// at the joints (rasterised with the gun), never accepting an offset that adds another lint error.
const ctx=await lintContext(art),trial={...look,puppet,layers:art.layers},R=LINT_LIMITS.raster,sc=R/W;
const CHANNELS=[['aimX','negative',{yaw:-range.yaw}],['aimX','positive',{yaw:range.yaw}],['aimY','negative',{pitch:-range.pitch}],['aimY','positive',{pitch:range.pitch}],['recoil','positive',{recoil:range.recoil}]];
const holes=(family,input,side)=>{const smp=samplePuppet(trial,kit,family,input),r=rasterPuppet(trial,smp.pose,ctx,smp);
  const j=smp.pose.joints[side];return seamGaps(r.arms,R,[j.shoulder,j.elbow,j.wrist],sc,null,r.covered);};
const errors=(family,input)=>{const n={...samplePuppet(trial,kit,family,{}),name:'neutral'},smp={...samplePuppet(trial,kit,family,input),name:'x'};
  return lintGeometry(trial,family,smp,n,ctx).filter(i=>i.severity==='error').length;};
// Each keyform is scored on its own corner plus every yaw/pitch diagonal that uses it, over two rounds.
const corners=input=>{const out=[input];if('yaw' in input)for(const p of [-range.pitch,range.pitch])out.push({...input,pitch:p});
  if('pitch' in input)for(const y of [-range.yaw,range.yaw])out.push({...input,yaw:y});return out;};
const total=(family,input,f)=>corners(input).reduce((a,c)=>a+f(family,c),0);
for(let round=0;round<3;round++)for(const family of Object.keys(kit.assemblies))for(const side of ['trigger','support'])for(const [param,sign,input]of CHANNELS){
  const step=round<2?.01:.005,span=round<2?.03:.015;
  const ch=puppet.keyforms[family][side].parameters[param],start=ch[sign],hole=(f,c)=>holes(f,c,side);
  let best={d:start,score:total(family,input,hole),err:total(family,input,errors)};
  for(let dx=-span;dx<=span+1e-9;dx+=step)for(let dy=-span;dy<=span+1e-9;dy+=step){
    ch[sign]=[+(start[0]+dx).toFixed(3),+(start[1]+dy).toFixed(3)];
    const err=total(family,input,errors);if(err>best.err)continue;const score=total(family,input,hole);
    if(score<best.score-1||err<best.err)best={d:ch[sign],score,err};
  }
  ch[sign]=best.d;report[family][side].parameters=puppet.keyforms[family][side].parameters;
}
// Corner pass: tune each side's yaw×pitch corner keyform on its own diagonal.
for(const family of Object.keys(kit.assemblies))for(const side of ['trigger','support']){
  const params=puppet.keyforms[family][side].parameters;params.aimXY={'--':[0,0],'-+':[0,0],'+-':[0,0],'++':[0,0]};
  for(const corner of Object.keys(params.aimXY)){
    const input={yaw:(corner[0]==='-'?-1:1)*range.yaw,pitch:(corner[1]==='-'?-1:1)*range.pitch},hole=(f,c)=>holes(f,c,side);
    let best={d:[0,0],score:hole(family,input),err:errors(family,input)};
    for(let dx=-.03;dx<=.0301;dx+=.005)for(let dy=-.03;dy<=.0301;dy+=.005){
      params.aimXY[corner]=[+dx.toFixed(3),+dy.toFixed(3)];const err=errors(family,input);if(err>best.err)continue;
      const score=hole(family,input);if(score<best.score-1||err<best.err)best={d:params.aimXY[corner],score,err};
    }
    params.aimXY[corner]=best.d;
  }
  report[family][side].parameters=params;
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
