// 2D ArtMesh-style puppet. Authored keyforms shape the silhouette; there is no IK or bone-length solver.
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const point=(p,w,h)=>({x:p[0]*w,y:p[1]*h});
const mix=(a,b,t)=>a+(b-a)*t;
export function scalePuppet(puppet,scale,offset){
    const copy=structuredClone(puppet);
    for(const form of Object.values(copy.keyforms))for(const key of Object.values(form)){
        for(const joint of ['shoulder','elbow'])key[joint]=key[joint].map((v,i)=>v*scale+offset[i]);
        for(const part of ['upper','forearm'])key[part].bend*=scale;
        for(const channel of Object.values(key.parameters))for(const sign of Object.keys(channel))channel[sign]=channel[sign].map(v=>v*scale);
    }
    return copy;
}

export function validatePuppet(p){
    const finite=(v,min,max)=>typeof v==='number'&&Number.isFinite(v)&&v>=min&&v<=max;
    const pair=(v,min,max)=>Array.isArray(v)&&v.length===2&&v.every(n=>finite(n,min,max));
    if(![1,2].includes(p?.version)||p.technique!=='authored-2d-warp'||!Number.isInteger(p.meshDivisions)||p.meshDivisions<8||p.meshDivisions>64)throw Error('Invalid puppet format or mesh divisions.');
    for(const param of ['yaw','pitch','recoil'])if(!finite(p.range?.[param],.001,1))throw Error('Invalid parameter range: '+param);
    for(const family of ['rifle','sniper','shotgun'])for(const side of ['trigger','support']){
        const key=p.keyforms?.[family]?.[side];
        if(!key||!pair(key.shoulder,0,1)||!pair(key.elbow,0,1))throw Error('Invalid shoulder/elbow: '+family+' '+side);
        for(const part of ['upper','forearm'])if(!finite(key[part]?.bend,-.1,.1)||!Array.isArray(key[part]?.width)||key[part].width.length!==3||!key[part].width.every(v=>finite(v,.25,2)))throw Error('Invalid sleeve mesh: '+part);
        for(const param of ['aimX','aimY','recoil'])for(const sign of ['negative','positive'])if(!pair(key.parameters?.[param]?.[sign],-.1,.1))throw Error('Invalid keyform: '+param);
        if(key.depth!==undefined&&!(finite(key.depth?.shoulder,.05,50)&&finite(key.depth?.elbow,.05,50)))throw Error('Invalid joint depth: '+family+' '+side);
        const xy=key.parameters.aimXY;
        if(xy!==undefined)for(const corner of ['--','-+','+-','++'])if(xy[corner]!==undefined&&!pair(xy[corner],-.1,.1))throw Error('Invalid corner keyform: '+family+' '+side);
        for(const param of ['aimX','aimY','recoil'])for(const sign of ['depthNegative','depthPositive']){
            const d=key.parameters[param][sign];if(d!==undefined&&!pair(d,-1,1))throw Error('Invalid depth keyform: '+param);
        }
    }
    if(p.layers!==undefined)validatePuppetLayers(p.layers);
    return p;
}
/** v2 per-layer authoring: metric depth (or a depth map), depth offset, Live2D-style clipping masks, art swaps. */
function validatePuppetLayers(layers){
    const finite=(v,min,max)=>typeof v==='number'&&Number.isFinite(v)&&v>=min&&v<=max;
    const pair=(v,min,max)=>Array.isArray(v)&&v.length===2&&v.every(n=>finite(n,min,max));
    if(!layers||typeof layers!=='object'||Array.isArray(layers))throw Error('Invalid puppet layers.');
    const masks=new Set();
    for(const [id,l]of Object.entries(layers)){
        if(l.depth!==undefined&&!finite(l.depth,.05,50))throw Error('Invalid layer depth: '+id);
        if(l.depthOffset!==undefined&&!finite(l.depthOffset,-1,1))throw Error('Invalid layer depth offset: '+id);
        if(l.depthMap!==undefined&&!(typeof l.depthMap?.image==='string'&&pair(l.depthMap.range,.05,50)&&l.depthMap.range[0]<l.depthMap.range[1]))throw Error('Invalid depth map: '+id);
        if(l.clip!==undefined){
            if(!Array.isArray(l.clip.by)||!l.clip.by.length||!l.clip.by.every(m=>typeof m==='string'&&m!==id)||!['inside','outside'].includes(l.clip.mode))throw Error('Invalid clip: '+id);
            l.clip.by.forEach(m=>masks.add(m));
        }
        if(l.swaps!==undefined){
            if(!Array.isArray(l.swaps)||l.swaps.length>4)throw Error('Invalid swaps: '+id);
            for(const w of l.swaps){
                if(typeof w.image!=='string'||!pair(w.foreshorten,0,4)||w.foreshorten[0]>=w.foreshorten[1]||!finite(w.blend??.1,0,1))throw Error('Invalid swap: '+id);
                if(w.bounds!==undefined&&!(Array.isArray(w.bounds)&&w.bounds.length===4&&w.bounds.every(v=>finite(v,-4096,8192))))throw Error('Invalid swap bounds: '+id);
                if(w.source!==undefined&&!(pair(w.source.start,0,1)&&pair(w.source.end,0,1)))throw Error('Invalid swap registration: '+id);
            }
        }
    }
    if(masks.size>8)throw Error('At most 8 clipping masks.');
}
const smooth=(a,b,x)=>{const t=clamp((x-a)/Math.max(1e-6,b-a),0,1);return t*t*(3-2*t);};
/** Crossfade weights of a layer's art swaps for a sleeve's foreshorten ratio; the base painting keeps 1 − Σw. */
export function swapWeights(swaps=[],ratio=1){
    const w=swaps.map(s=>{const e=(s.blend??.1)/2,[a,b]=s.foreshorten;return smooth(a-e,a+e,ratio)*(1-smooth(b-e,b+e,ratio));});
    const sum=w.reduce((a,b)=>a+b,0);return sum>1?w.map(v=>v/sum):w;
}
/** Position of a source point along a ribbon's painted segment (0 at the start pin, 1 at the end pin). */
export function ribbonT(p,d){
    const sx=d.sourceEnd.x-d.sourceStart.x,sy=d.sourceEnd.y-d.sourceStart.y;
    return clamp(((p.x-d.sourceStart.x)*sx+(p.y-d.sourceStart.y)*sy)/Math.max(1e-6,sx*sx+sy*sy),0,1);
}
/** A swap painting has its own registration, so it warps from its own painted segment onto the same target pins. */
export function swapDeformer(d,swap,w,h){
    return swap.source?{...d,sourceStart:point(swap.source.start,w,h),sourceEnd:point(swap.source.end,w,h)}:d;
}
/** `depths` (v2, perspective view): camera distances of the gun contacts, {grip, support} in metres. */
export function puppetPose(art,targets,family='rifle',input={},depths=null) {
    const {width:w,height:h,rig,puppet}=art;
    const form=puppet.keyforms[family]||puppet.keyforms.rifle;
    const axis=rig.handAxis||[rig.stock,rig.muzzle];
    const angle=p=>Math.atan2((p[1][1]-p[0][1])*h,(p[1][0]-p[0][0])*w);
    const rotation=angle([targets.stock,targets.muzzle])-angle(axis),co=Math.cos(rotation),si=Math.sin(rotation);
    const parameters={aimX:clamp((input.yaw||0)/puppet.range.yaw,-1,1),aimY:clamp((input.pitch||0)/puppet.range.pitch,-1,1),recoil:clamp((input.recoil||0)/puppet.range.recoil,0,1)};
    const joints={},deformers={},handTransforms={};
    for(const side of ['trigger','support']){
        const rest=rig.arms[side],key=form[side],shoulder=point(key.shoulder,w,h),elbow=point(key.elbow,w,h);
        let shoulderDepth=key.depth?.shoulder??null,elbowDepth=key.depth?.elbow??null;
        // Live2D-style 2D keyform grid: an optional yaw×pitch corner correction, weighted |aimX·aimY| (zero on both axes).
        const xy=key.parameters.aimXY?.[(parameters.aimX<0?'-':'+')+(parameters.aimY<0?'-':'+')];
        if(xy){const k=Math.abs(parameters.aimX*parameters.aimY);elbow.x+=xy[0]*w*k;elbow.y+=xy[1]*h*k;}
        for(const [parameter,value]of Object.entries(parameters)){
            const channel=key.parameters[parameter];
            const delta=value<0?channel.negative:channel.positive;
            elbow.x+=delta[0]*w*Math.abs(value);elbow.y+=delta[1]*h*Math.abs(value);
            const dd=value<0?channel.depthNegative:channel.depthPositive;
            if(dd&&shoulderDepth!=null){shoulderDepth+=dd[0]*Math.abs(value);elbowDepth+=dd[1]*Math.abs(value);}
        }
        const palm=point(targets[side==='trigger'?'grip':'support'],w,h),restPalm=point(rest.palm,w,h),restWrist=point(rest.wrist,w,h);
        const dx=restWrist.x-restPalm.x,dy=restWrist.y-restPalm.y;
        const wrist={x:palm.x+dx*co-dy*si,y:palm.y+dx*si+dy*co};
        handTransforms[side+'-hand']=[co,si,-si,co,palm.x-co*restPalm.x+si*restPalm.y,palm.y-si*restPalm.x-co*restPalm.y];
        const contactDepth=depths?.[side==='trigger'?'grip':'support']??null;
        const depth={shoulder:shoulderDepth,elbow:elbowDepth,wrist:contactDepth,palm:contactDepth};
        joints[side]={shoulder,elbow,wrist,palm,handWrist:wrist,gap:0,depth};
        for(const [part,start,end]of [['upper','shoulder','elbow'],['forearm','elbow','wrist']]){
            const d={sourceStart:point(rest[start],w,h),sourceEnd:point(rest[end],w,h),start:joints[side][start],end:joints[side][end],bend:key[part].bend*h,width:key[part].width,
                depthStart:depth[start],depthEnd:depth[end]};
            // Foreshortening: projected length over painted length. Art swaps key on this ratio.
            d.foreshorten=Math.hypot(d.end.x-d.start.x,d.end.y-d.start.y)/Math.max(1e-6,Math.hypot(d.sourceEnd.x-d.sourceStart.x,d.sourceEnd.y-d.sourceStart.y));
            deformers[side+'-'+part]=d;
        }
    }
    return {joints,deformers,handTransforms,parameters,maxGap:0,technique:'authored-2d-warp'};
}

/** A curved ribbon deformer: endpoint pins, independently painted bulge and three width handles.
 * Interior vertices bend continuously, so sleeves do not rotate as rigid cardboard rectangles.
 */
export function warpPuppetPoint(p,d) {
    const sx=d.sourceEnd.x-d.sourceStart.x,sy=d.sourceEnd.y-d.sourceStart.y,sl=Math.hypot(sx,sy);
    const ux=sx/sl,uy=sy/sl,px=p.x-d.sourceStart.x,py=p.y-d.sourceStart.y;
    const t=(px*ux+py*uy)/sl,across=-px*uy+py*ux;
    const dx=d.end.x-d.start.x,dy=d.end.y-d.start.y,len=Math.max(1,Math.hypot(dx,dy)),nx=-dy/len,ny=dx/len;
    const tc=clamp(t,0,1),bulge=4*tc*(1-tc)*d.bend;
    const tangent=4*(1-2*tc)*d.bend,tx=dx+nx*tangent,ty=dy+ny*tangent,tl=Math.max(1,Math.hypot(tx,ty));
    const s=tc<.5?tc*2:(tc-.5)*2,smooth=s*s*(3-2*s);
    const width=tc<.5?mix(d.width[0],d.width[1],smooth):mix(d.width[1],d.width[2],smooth);
    return {x:mix(d.start.x,d.end.x,t)+nx*bulge-ty/tl*across*width,y:mix(d.start.y,d.end.y,t)+ny*bulge+tx/tl*across*width};
}

export function deformPuppetMesh(geometry,source,deformer) {
    const positions=geometry.attributes.position,depth=geometry.attributes.depth;
    const ribbonDepth=depth&&deformer.depthStart!=null&&deformer.depthEnd!=null;
    for(let i=0;i<positions.count;i++){
        const p={x:source[i*3],y:-source[i*3+1]},q=warpPuppetPoint(p,deformer);
        positions.setXYZ(i,q.x,-q.y,0);
        if(ribbonDepth)depth.setX(i,mix(deformer.depthStart,deformer.depthEnd,ribbonT(p,deformer))+(deformer.depthOffset||0));
    }
    positions.needsUpdate=true;if(depth)depth.needsUpdate=true;
    // Cards use a fixed flat camera and may deform beyond their neutral bounding box.
    geometry.computeBoundingSphere();
}
