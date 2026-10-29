// Pose linter for the authored 2D aim puppet. Shared by the workbench, tools/art/lint_puppet.mjs and the tests.
// Geometry rules need only the manifest and gun kit; pixel rules also take each layer's alpha (`alpha[id]`:
// {width, height, data} with one byte per pixel in full-canvas coordinates).
import * as THREE from 'three';
import {aimGunCamera,contactDepth,gunPoint,gunPoseSample} from './SpriteWeapon.js';
import {puppetPose,ribbonT,swapWeights,warpPuppetPoint} from './SpritePuppetRig.js';

export const LINT_LIMITS={visibleShare:.25,stretch:[.75,1.25],stretchWarn:[.9,1.1],bend:[25,178],bendSlack:8,contactPx:.5,zFightMetres:.01,seamPx:64,pop:.3,raster:192};
const SIDES=['trigger','support'],PARTS=['upper','forearm'];
const deg=r=>r*180/Math.PI,cross=(a,b,c)=>(b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);

/** Neutral, each parameter extreme and the four yaw/pitch diagonals. */
export function lintCorners(range){
  const {yaw:y,pitch:p,recoil:r}=range;
  return [['neutral',{}],['yaw-',{yaw:-y}],['yaw+',{yaw:y}],['pitch-',{pitch:-p}],['pitch+',{pitch:p}],['recoil',{recoil:r}],
    ['yaw-pitch-',{yaw:-y,pitch:-p}],['yaw+pitch-',{yaw:y,pitch:-p}],['yaw-pitch+',{yaw:-y,pitch:p}],['yaw+pitch+',{yaw:y,pitch:p}]].map(([name,input])=>({name,input}));
}
export function samplePuppet(art,kit,family,input){
  const gun=kit.assemblies[family],camera=aimGunCamera(art.rig,gunPoint(gun.stock),art.width/art.height);
  const s=gunPoseSample(art,gun,camera,input);
  const depthMode=art.puppet.version>=2&&art.rig.gunView?.projection==='perspective';
  return {input,family,camera,matrix:s.matrix,targets:s.targets,depths:s.depths,depthMode,pose:puppetPose(art,s.targets,family,input,depthMode?s.depths:null)};
}
const layerCfg=(art,id)=>art.puppet.layers?.[id]||{};
/** Centre of the painted torso (alpha centroid), or of its bounds when no alpha is supplied. */
const centreOf=(art,ctx)=>ctx._centre||(ctx._centre=bodyCentre(art,ctx.alpha));
export function bodyCentre(art,alpha){
  const a=alpha?.body;
  if(a){let sx=0,sy=0,n=0;for(let y=0;y<a.height;y+=4)for(let x=0;x<a.width;x+=4)if(a.data[y*a.width+x]>127){sx+=x;sy+=y;n++;}
    if(n)return {x:sx/n*art.width/a.width,y:sy/n*art.height/a.height};}
  const b=art.layers.find(l=>l.id==='body')?.bounds||[0,0,art.width,art.height];return {x:(b[0]+b[2])/2,y:(b[1]+b[3])/2};
}
const alphaAt=(a,art,p)=>{if(!a)return null;const x=Math.round(p.x*a.width/art.width),y=Math.round(p.y*a.height/art.height);return x<0||y<0||x>=a.width||y>=a.height?0:a.data[y*a.width+x];};
function bodyDepthAt(art,p,depthMaps){
  const c=layerCfg(art,'body');
  if(c.depthMap&&depthMaps?.body){const v=alphaAt(depthMaps.body,art,p);const [a,b]=c.depthMap.range;return v==null?null:a+(b-a)*v/255;}
  return c.depth??null;
}
/** Points along a ribbon's centre line with screen radius and depth, for overlap tests. */
function ribbonSamples(d,halfWidth,n=12){
  const out=[];for(let i=0;i<=n;i++){const t=i/n,src={x:d.sourceStart.x+(d.sourceEnd.x-d.sourceStart.x)*t,y:d.sourceStart.y+(d.sourceEnd.y-d.sourceStart.y)*t};
    const q=warpPuppetPoint(src,d),w=t<.5?d.width[0]+(d.width[1]-d.width[0])*t*2:d.width[1]+(d.width[2]-d.width[1])*(t-.5)*2;
    out.push({x:q.x,y:q.y,r:halfWidth*w,t,depth:d.depthStart!=null?d.depthStart+(d.depthEnd-d.depthStart)*ribbonT(src,d):null});}
  return out;
}
const halfWidths=art=>Object.fromEntries(SIDES.flatMap(s=>PARTS.map(p=>{const r=art.rig.limbRadii?.[p]||art.rig.limbRadii?.[s+'-'+p];return [s+'-'+p,Array.isArray(r)?Math.max(...r)*(r[0]<=1?art.width:1):(p==='upper'?40:30)];})));

/** Geometry rules for one sample. `neutral` is the neutral sample of the same family (for flips). */
export function lintGeometry(art,family,sample,neutral,ctx={}){
  const issues=[],{pose,targets,depthMode}=sample,w=art.width,h=art.height,L=LINT_LIMITS;
  const add=(rule,severity,part,message,value)=>issues.push({rule,severity,family,corner:sample.name,part,message,value});
  const perspective=art.rig.gunView?.projection==='perspective';
  // With pixel data, sleeves that are mostly hidden (behind the torso or another sleeve) skip shape rules.
  const seen=id=>!sample.visibility||(sample.visibility[id]??1)>=L.visibleShare;
  for(const side of SIDES){
    const j=pose.joints[side],n=neutral.pose.joints[side],armSeen=seen(side+'-upper')||seen(side+'-forearm');
    for(const part of PARTS){
      const id=side+'-'+part,d=pose.deformers[id],r=d.foreshorten;if(!seen(id))continue;
      const covered=swapWeights(layerCfg(art,id).swaps,r).reduce((a,b)=>a+b,0)>.5;
      if(!covered&&(r<L.stretch[0]||r>L.stretch[1]))add('stretch','error',id,`sleeve at ${(r*100).toFixed(0)}% of its painted length`,r);
      else if(!covered&&(r<L.stretchWarn[0]||r>L.stretchWarn[1]))add('stretch','warn',id,`sleeve at ${(r*100).toFixed(0)}% of its painted length`,r);
    }
    const a={x:j.shoulder.x-j.elbow.x,y:j.shoulder.y-j.elbow.y},b={x:j.wrist.x-j.elbow.x,y:j.wrist.y-j.elbow.y};
    const bend=deg(Math.acos(Math.max(-1,Math.min(1,(a.x*b.x+a.y*b.y)/Math.max(1e-9,Math.hypot(a.x,a.y)*Math.hypot(b.x,b.y))))));
    // A pose may not fold the elbow much tighter than its painting (some sleeves are painted folded).
    const rest=art.rig.arms[side],ra={x:rest.shoulder[0]-rest.elbow[0],y:(rest.shoulder[1]-rest.elbow[1])*h/w},rb={x:rest.wrist[0]-rest.elbow[0],y:(rest.wrist[1]-rest.elbow[1])*h/w};
    const painted=deg(Math.acos(Math.max(-1,Math.min(1,(ra.x*rb.x+ra.y*rb.y)/Math.max(1e-9,Math.hypot(ra.x,ra.y)*Math.hypot(rb.x,rb.y))))));
    const minBend=Math.min(L.bend[0],painted-L.bendSlack);
    if(armSeen&&(bend<minBend||bend>L.bend[1]))add('elbow-bend','error',side,`elbow angle ${bend.toFixed(0)}° (allowed ${minBend.toFixed(0)}–${L.bend[1]}°)`,bend);
    if(armSeen&&Math.sign(cross(j.shoulder,j.wrist,j.elbow))!==Math.sign(cross(n.shoulder,n.wrist,n.elbow)))add('elbow-flip','error',side,'elbow crosses the shoulder–wrist line relative to neutral');
    // Over the shoulder, the trigger elbow hangs below the hand and never swings across the back toward the spine.
    const upperLen=Math.hypot(j.elbow.x-j.shoulder.x,j.elbow.y-j.shoulder.y),towardSpine=Math.sign(centreOf(art,ctx).x-j.shoulder.x);
    if(perspective&&side==='trigger'&&(j.elbow.y<=j.wrist.y||(j.elbow.x-j.shoulder.x)*towardSpine>.25*upperLen))
      add('elbow-side','error',side,j.elbow.y<=j.wrist.y?'trigger elbow is above the hand':'trigger elbow swings across the back instead of hanging beside the body');
    const target=targets[side==='trigger'?'grip':'support'],gap=Math.hypot(j.palm.x-target[0]*w,j.palm.y-target[1]*h);
    if(gap>L.contactPx)add('contact','error',side+'-hand',`palm ${gap.toFixed(2)} px off the gun contact`,gap);
  }
  if(perspective){
    // Hidden either by a mask (outside the torso, or only inside it where depth already hides it) or by depth.
    const cfg=layerCfg(art,'support-upper'),clipped=!!cfg.clip&&cfg.clip.by.includes('body');
    const behind=depthMode&&pose.joints.support.depth.shoulder!=null&&(bodyDepthAt(art,pose.joints.support.shoulder,ctx.depthMaps)??Infinity)<pose.joints.support.depth.shoulder;
    if(!clipped&&!behind)add('shoulder-anchor','error','support-upper','support arm is drawn over the torso (clip it outside the body or put it behind)');
  }
  if(depthMode){
    const hw=halfWidths(art),ribbons=SIDES.flatMap(s=>PARTS.map(p=>[s+'-'+p,ribbonSamples(pose.deformers[s+'-'+p],hw[s+'-'+p])]));
    const hidden=id=>sample.visibility?(sample.visibility[id]??1)<L.visibleShare:layerCfg(art,id).clip?.mode==='outside';
    for(let i=0;i<ribbons.length;i++)for(let k=i+1;k<ribbons.length;k++){
      const [ia,ra]=ribbons[i],[ib,rb]=ribbons[k];if(ia.split('-')[0]===ib.split('-')[0]&&ia.endsWith('upper')!==ib.endsWith('upper'))continue;
      if(hidden(ia)||hidden(ib))continue;
      for(const p of ra)for(const q of rb)if(p.depth!=null&&q.depth!=null&&Math.hypot(p.x-q.x,p.y-q.y)<(p.r+q.r)*.6&&Math.abs(p.depth-q.depth)<L.zFightMetres){
        add('depth-order','error',ia+'/'+ib,`sleeves overlap within ${(Math.abs(p.depth-q.depth)*100).toFixed(1)} cm of each other (z-fighting)`);k=ribbons.length;break;}
    }
    const s=targets.stock,m=targets.muzzle,S={x:s[0]*w,y:s[1]*h},M={x:m[0]*w,y:m[1]*h},len=Math.hypot(M.x-S.x,M.y-S.y);
    for(const side of SIDES){
      const id=side+'-forearm';if(hidden(id))continue;
      for(const p of ribbons.find(r=>r[0]===id)[1]){
        if(p.t<.15||p.depth==null)continue;
        const u=Math.max(0,Math.min(1,((p.x-S.x)*(M.x-S.x)+(p.y-S.y)*(M.y-S.y))/(len*len))),gx=S.x+(M.x-S.x)*u,gy=S.y+(M.y-S.y)*u;
        const gd=sample.depths.stock+(sample.depths.muzzle-sample.depths.stock)*u;
        if(Math.hypot(p.x-gx,p.y-gy)<p.r+12&&Math.abs(p.depth-gd)<L.zFightMetres){add('depth-order','warn',id,'sleeve and receiver at the same depth where they overlap');break;}
      }
    }
  }
  return issues;
}

// ---------- pixel rules: a small software rasteriser of the deformed cards ----------
function cardTriangles(art,layer,pose,n=16){
  const [x0,y0,x1,y1]=layer.bounds||[0,0,art.width,art.height],tris=[];
  const d=layer.bone&&pose.deformers[layer.bone],m=layer.bone&&pose.handTransforms[layer.bone];
  const at=(i,k)=>{const src={x:x0+(x1-x0)*i/n,y:y0+(y1-y0)*k/n};let q=src;
    if(d)q=warpPuppetPoint(src,d);else if(m)q={x:m[0]*src.x+m[2]*src.y+m[4],y:m[1]*src.x+m[3]*src.y+m[5]};return {src,q};};
  const grid=[];for(let k=0;k<=n;k++)for(let i=0;i<=n;i++)grid.push(at(i,k));
  for(let k=0;k<n;k++)for(let i=0;i<n;i++){const a=grid[k*(n+1)+i],b=grid[k*(n+1)+i+1],c=grid[(k+1)*(n+1)+i],e=grid[(k+1)*(n+1)+i+1];tris.push([a,b,e],[a,e,c]);}
  return tris;
}
function cardDepth(art,layer,pose,src,ctx){
  const c=layerCfg(art,layer.id),off=c.depthOffset||0,d=layer.bone&&pose.deformers[layer.bone];
  if(d&&d.depthStart!=null)return d.depthStart+(d.depthEnd-d.depthStart)*ribbonT(src,d)+off;
  if(layer.bone?.endsWith('hand')){const side=layer.bone.split('-')[0];const v=pose.joints[side].depth.palm;if(v!=null)return v+off;}
  if(layer.id==='body'){const v=bodyDepthAt(art,src,ctx.depthMaps);if(v!=null)return v+off;}
  return c.depth!=null?c.depth+off:null;
}
/** Rasterise every card at R×R. Returns {visible: {layerId: pixels}, arms: Uint8Array coverage of all sleeves/hands}. */
/** `sample` (optional) adds the projected gun mesh (`ctx.gun[family]`: gun-space triangles) with its true depth. */
export function rasterPuppet(art,pose,ctx,sample=null){
  const R=LINT_LIMITS.raster,sx=R/art.width,sy=R/art.height,depthMode=art.puppet.version>=2&&art.rig.gunView?.projection==='perspective';
  const drawn={},owner=new Int16Array(R*R).fill(-1),zbuf=new Float32Array(R*R).fill(Infinity),arms=new Uint8Array(R*R),bodyMask=new Uint8Array(R*R);
  const layers=art.layers.filter(l=>l.image).sort((a,b)=>a.zIndex-b.zIndex),gunMask=new Uint8Array(R*R);
  const tris=sample&&ctx.gun?.[sample.family];
  const drawGun=()=>{
    if(!tris)return;
    const v=new THREE.Vector3(),proj=p=>{v.set(p[0],p[1],p[2]).applyMatrix4(sample.matrix);const d=contactDepth(sample.camera,v),q=v.project(sample.camera);return {x:(q.x+1)/2*R,y:(1-q.y)/2*R,d};};
    for(const t of tris){
      const [p0,p1,p2]=t.map(proj),area=(p1.x-p0.x)*(p2.y-p0.y)-(p1.y-p0.y)*(p2.x-p0.x);if(Math.abs(area)<1e-9)continue;
      const minX=Math.max(0,Math.floor(Math.min(p0.x,p1.x,p2.x))),maxX=Math.min(R-1,Math.ceil(Math.max(p0.x,p1.x,p2.x)));
      const minY=Math.max(0,Math.floor(Math.min(p0.y,p1.y,p2.y))),maxY=Math.min(R-1,Math.ceil(Math.max(p0.y,p1.y,p2.y)));
      for(let y=minY;y<=maxY;y++)for(let x=minX;x<=maxX;x++){
        const px=x+.5,py=y+.5,w0=((p1.x-px)*(p2.y-py)-(p1.y-py)*(p2.x-px))/area,w1=((p2.x-px)*(p0.y-py)-(p2.y-py)*(p0.x-px))/area,w2=1-w0-w1;
        if(w0<0||w1<0||w2<0)continue;const i=y*R+x,z=p0.d*w0+p1.d*w1+p2.d*w2;gunMask[i]=1;
        if(depthMode){if(z>=zbuf[i])continue;zbuf[i]=z;}owner[i]=-2;
      }
    }
  };
  const gunZ=art.layers.find(l=>l.gun)?.zIndex??100;let gunDone=false;
  if(depthMode){drawGun();gunDone=true;}
  layers.forEach((layer,li)=>{
    if(!gunDone&&layer.zIndex>gunZ){drawGun();gunDone=true;}
    const a=ctx.alpha[layer.id];if(!a)return;
    const clip=layerCfg(art,layer.id).clip,arm=!!layer.bone;
    for(const t of cardTriangles(art,layer,pose)){
      const [p0,p1,p2]=t.map(v=>({x:v.q.x*sx,y:v.q.y*sy,src:v.src}));
      const minX=Math.max(0,Math.floor(Math.min(p0.x,p1.x,p2.x))),maxX=Math.min(R-1,Math.ceil(Math.max(p0.x,p1.x,p2.x)));
      const minY=Math.max(0,Math.floor(Math.min(p0.y,p1.y,p2.y))),maxY=Math.min(R-1,Math.ceil(Math.max(p0.y,p1.y,p2.y)));
      const area=(p1.x-p0.x)*(p2.y-p0.y)-(p1.y-p0.y)*(p2.x-p0.x);if(Math.abs(area)<1e-9)continue;
      for(let y=minY;y<=maxY;y++)for(let x=minX;x<=maxX;x++){
        const px=x+.5,py=y+.5,w0=((p1.x-px)*(p2.y-py)-(p1.y-py)*(p2.x-px))/area,w1=((p2.x-px)*(p0.y-py)-(p2.y-py)*(p0.x-px))/area,w2=1-w0-w1;
        if(w0<0||w1<0||w2<0)continue;
        const src={x:p0.src.x*w0+p1.src.x*w1+p2.src.x*w2,y:p0.src.y*w0+p1.src.y*w1+p2.src.y*w2};
        if((alphaAt(a,art,src)||0)<128)continue;const i=y*R+x;
        if(layer.id==='body')bodyMask[i]=1;
        if(arm)arms[i]=1;
        drawn[layer.id]=(drawn[layer.id]||0)+1;
        if(clip){const inMask=clip.by.some(m=>m==='body'?bodyMask[i]:false);if(clip.mode==='outside'?inMask:!inMask)continue;}
        const z=depthMode?cardDepth(art,layer,pose,src,ctx):null;
        if(z!=null){if(z-layer.zIndex*1e-5>=zbuf[i])continue;zbuf[i]=z-layer.zIndex*1e-5;}
        else if(depthMode&&zbuf[i]!==Infinity)continue;
        else if(!depthMode)zbuf[i]=Infinity;
        owner[i]=li;
      }
    }
  });
  if(!gunDone)drawGun();
  const visible={},armsSeen=new Uint8Array(R*R);
  owner.forEach((o,i)=>{if(o>=0){const id=layers[o].id;visible[id]=(visible[id]||0)+1;if(layers[o].bone)armsSeen[i]=1;}});
  const visibility=Object.fromEntries(Object.entries(drawn).map(([id,n])=>[id,(visible[id]||0)/n]));
  // A seam is a see-through hole: only pixels with nothing drawn (no card, no gun) count as gaps.
  const covered=Uint8Array.from(owner,o=>o!==-1);
  return {visible,visibility,arms:armsSeen,gun:gunMask,covered,R};
}
export function seamGaps(arms,R,joints,scale,perJoint=null,gun=null){
  const dil=new Uint8Array(R*R),ero=new Uint8Array(R*R),r=2;
  for(let y=0;y<R;y++)for(let x=0;x<R;x++){let v=0;for(let dy=-r;dy<=r&&!v;dy++)for(let dx=-r;dx<=r;dx++){const X=x+dx,Y=y+dy;if(X>=0&&Y>=0&&X<R&&Y<R&&arms[Y*R+X]){v=1;break;}}dil[y*R+x]=v;}
  for(let y=0;y<R;y++)for(let x=0;x<R;x++){let v=1;for(let dy=-r;dy<=r&&v;dy++)for(let dx=-r;dx<=r;dx++){const X=x+dx,Y=y+dy;if(X<0||Y<0||X>=R||Y>=R||!dil[Y*R+X]){v=0;break;}}ero[y*R+x]=v;}
  let gaps=0;const rad=12;
  for(const p of joints){const before=gaps,cx=p.x*scale,cy=p.y*scale;for(let y=Math.max(0,Math.floor(cy-rad));y<Math.min(R,cy+rad);y++)for(let x=Math.max(0,Math.floor(cx-rad));x<Math.min(R,cx+rad);x++)if(ero[y*R+x]&&!arms[y*R+x]&&!(gun&&gun[y*R+x]))gaps++;if(perJoint)perJoint.push(Math.round((gaps-before)/(scale*scale)));}
  return gaps/(scale*scale);
}
/** Pixel rules: shoulder on the torso, opaque cuffs, joint seams and visibility pops along neutral → corner. */
export function lintPixels(art,kit,family,samples,ctx){
  const issues=[],add=(rule,severity,corner,part,message,value)=>issues.push({rule,severity,family,corner,part,message,value});
  const neutral=samples.find(s=>s.name==='neutral'),R=LINT_LIMITS.raster,scale=R/art.width;
  for(const side of SIDES){
    const sh=neutral.pose.joints[side].shoulder;if((alphaAt(ctx.alpha.body,art,sh)??255)<128)add('shoulder-anchor','error','neutral',side+'-upper','shoulder anchor is outside the torso painting');
    const hand=art.layers.find(l=>l.id===side+'-hand'),rest=art.rig.arms[side].wrist;
    if(hand&&ctx.alpha[hand.id]){const v=alphaAt(ctx.alpha[hand.id],art,{x:rest[0]*art.width,y:rest[1]*art.height});if(v!=null&&v<128)add('contact','error','neutral',hand.id,'glove cuff is transparent at the wrist pin');}
  }
  const seenJoint=(s,side,k)=>{const v=s.visibility||{},u=v[side+'-upper']??1,f=v[side+'-forearm']??1,m=LINT_LIMITS.visibleShare;
    return k==='shoulder'?u>=m:k==='elbow'?u>=m&&f>=m:f>=m;};
  const jointsOf=s=>SIDES.flatMap(side=>['shoulder','elbow','wrist'].filter(k=>seenJoint(s,side,k)).map(k=>s.pose.joints[side][k]));
  const seam=s=>{const r=rasterPuppet(art,s.pose,ctx,s);return seamGaps(r.arms,R,jointsOf(s),scale,null,r.covered);};
  const base=seam(neutral);
  for(const s of samples){
    if(s.name==='neutral')continue;
    const g=seam(s);
    if(g-base>LINT_LIMITS.seamPx)add('seam','error',s.name,'joints',`${Math.round(g-base)} more gap px at the joints than neutral`,g-base);
    // A pop is a discontinuity: one quarter step changes a layer's visible area far more than its neighbours do.
    // Smooth occlusion (a glove sliding behind the helmet) changes evenly and is not reported.
    const series=[rasterPuppet(art,neutral.pose,ctx,neutral).visible];
    for(const t of [.25,.5,.75,1]){
      const input=Object.fromEntries(Object.entries(s.input).map(([k,v])=>[k,v*t]));
      const step=samplePuppet(art,kit,family,input);series.push(rasterPuppet(art,step.pose,ctx,step).visible);
    }
    const total=Object.entries(series[0]).filter(([id])=>id!=='body').reduce((a,[,v])=>a+v,0);
    for(const id of new Set(series.flatMap(v=>Object.keys(v)))){
      if(id==='body')continue;
      const area=series.map(v=>v[id]||0),steps=area.slice(1).map((v,i)=>Math.abs(v-area[i])),ref=Math.max(...area,total*.02,20);
      const sorted=[...steps].sort((a,b)=>a-b),median=(sorted[1]+sorted[2])/2,jump=Math.max(...steps);
      if(jump/ref>LINT_LIMITS.pop&&jump>3*median+.1*ref){add('pop','error',s.name,id,`visible area jumps ${Math.round(jump/ref*100)}% in one sway step`,jump/ref);}
    }
  }
  return issues;
}
/** Lint every weapon of one pose (close-up manifest or `worldAim`). */
/** `ctx.corners`: corner names to check (the world pose never sways at runtime, so it is linted at neutral only). */
export function lintPuppet(art,kit,ctx={}){
  const issues=[];
  for(const family of Object.keys(kit.assemblies)){
    const corners=lintCorners(art.puppet.range).filter(c=>!ctx.corners||ctx.corners.includes(c.name));
    const samples=corners.map(c=>({...samplePuppet(art,kit,family,c.input),name:c.name}));
    if(ctx.alpha)for(const s of samples)s.visibility=rasterPuppet(art,s.pose,ctx,s).visibility;
    const neutral=samples[0];
    for(const s of samples)issues.push(...lintGeometry(art,family,s,neutral,ctx));
    if(ctx.alpha)issues.push(...lintPixels(art,kit,family,samples,ctx));
  }
  return issues;
}
