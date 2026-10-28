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
    if(p?.version!==1||p.technique!=='authored-2d-warp'||!Number.isInteger(p.meshDivisions)||p.meshDivisions<8||p.meshDivisions>64)throw Error('Invalid puppet format or mesh divisions.');
    for(const param of ['yaw','pitch','recoil'])if(!finite(p.range?.[param],.001,1))throw Error('Invalid parameter range: '+param);
    for(const family of ['rifle','sniper','shotgun'])for(const side of ['trigger','support']){
        const key=p.keyforms?.[family]?.[side];
        if(!key||!pair(key.shoulder,0,1)||!pair(key.elbow,0,1))throw Error('Invalid shoulder/elbow: '+family+' '+side);
        for(const part of ['upper','forearm'])if(!finite(key[part]?.bend,-.1,.1)||!Array.isArray(key[part]?.width)||key[part].width.length!==3||!key[part].width.every(v=>finite(v,.25,2)))throw Error('Invalid sleeve mesh: '+part);
        for(const param of ['aimX','aimY','recoil'])for(const sign of ['negative','positive'])if(!pair(key.parameters?.[param]?.[sign],-.1,.1))throw Error('Invalid keyform: '+param);
    }
    return p;
}
export function puppetPose(art,targets,family='rifle',input={}) {
    const {width:w,height:h,rig,puppet}=art;
    const form=puppet.keyforms[family]||puppet.keyforms.rifle;
    const axis=rig.handAxis||[rig.stock,rig.muzzle];
    const angle=p=>Math.atan2((p[1][1]-p[0][1])*h,(p[1][0]-p[0][0])*w);
    const rotation=angle([targets.stock,targets.muzzle])-angle(axis),co=Math.cos(rotation),si=Math.sin(rotation);
    const parameters={aimX:clamp((input.yaw||0)/puppet.range.yaw,-1,1),aimY:clamp((input.pitch||0)/puppet.range.pitch,-1,1),recoil:clamp((input.recoil||0)/puppet.range.recoil,0,1)};
    const joints={},deformers={},handTransforms={};
    for(const side of ['trigger','support']){
        const rest=rig.arms[side],key=form[side],shoulder=point(key.shoulder,w,h),elbow=point(key.elbow,w,h);
        for(const [parameter,value]of Object.entries(parameters)){
            const channel=key.parameters[parameter];
            const delta=value<0?channel.negative:channel.positive;
            elbow.x+=delta[0]*w*Math.abs(value);elbow.y+=delta[1]*h*Math.abs(value);
        }
        const palm=point(targets[side==='trigger'?'grip':'support'],w,h),restPalm=point(rest.palm,w,h),restWrist=point(rest.wrist,w,h);
        const dx=restWrist.x-restPalm.x,dy=restWrist.y-restPalm.y;
        const wrist={x:palm.x+dx*co-dy*si,y:palm.y+dx*si+dy*co};
        handTransforms[side+'-hand']=[co,si,-si,co,palm.x-co*restPalm.x+si*restPalm.y,palm.y-si*restPalm.x-co*restPalm.y];
        joints[side]={shoulder,elbow,wrist,palm,handWrist:wrist,gap:0};
        for(const [part,start,end]of [['upper','shoulder','elbow'],['forearm','elbow','wrist']]){
            deformers[side+'-'+part]={sourceStart:point(rest[start],w,h),sourceEnd:point(rest[end],w,h),start:joints[side][start],end:joints[side][end],bend:key[part].bend*h,width:key[part].width};
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
    const positions=geometry.attributes.position;
    for(let i=0;i<positions.count;i++){
        const q=warpPuppetPoint({x:source[i*3],y:-source[i*3+1]},deformer);
        positions.setXYZ(i,q.x,-q.y,0);
    }
    positions.needsUpdate=true;
    // Cards use a fixed flat camera and may deform beyond their neutral bounding box.
    geometry.computeBoundingSphere();
}
