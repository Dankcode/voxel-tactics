// Two-bone IK for flat painted cutouts. All coordinates are in the untrimmed sprite frame.
const distance = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
export function solveArm(shoulder, restElbow, restWrist, target, elbowDirection = null) {
    const a = distance(shoulder, restElbow), b = distance(restElbow, restWrist);
    const dx = target.x - shoulder.x, dy = target.y - shoulder.y;
    // Screen-space limits avoid a singular straight or completely folded elbow. These are projected angles.
    const reach = angle => Math.sqrt(a*a+b*b-2*a*b*Math.cos(angle*Math.PI/180));
    const d = clamp(Math.hypot(dx, dy), reach(5), reach(175));
    const angle = Math.atan2(dy, dx);
    const side = Math.sign((restWrist.x-shoulder.x)*(restElbow.y-shoulder.y)-(restWrist.y-shoulder.y)*(restElbow.x-shoulder.x)) || 1;
    const bend = Math.acos(clamp((a*a+d*d-b*b)/(2*a*d),-1,1));
    let elbowAngle=angle+side*bend;
    // The near shooting elbow stays outside the torso even when a longer gun lifts the grip above the shoulder.
    if(elbowDirection){
        const score=t=>Math.cos(t)*elbowDirection[0]+Math.sin(t)*elbowDirection[1];
        elbowAngle=score(angle+bend)>score(angle-bend)?angle+bend:angle-bend;
    }
    return { elbow: { x: shoulder.x+Math.cos(elbowAngle)*a, y: shoulder.y+Math.sin(elbowAngle)*a },
        wrist: { x: shoulder.x+Math.cos(angle)*d, y: shoulder.y+Math.sin(angle)*d } };
}
export function boneMatrix(start, end, posedStart, posedEnd) {
    const x=end.x-start.x,y=end.y-start.y,xx=posedEnd.x-posedStart.x,yy=posedEnd.y-posedStart.y;
    const n=Math.max(1e-8,x*x+y*y),a=(x*xx+y*yy)/n,b=(x*yy-y*xx)/n;
    return [a,b,-b,a,posedStart.x-a*start.x+b*start.y,posedStart.y-b*start.x-a*start.y];
}
/** Report reach as well as transforms: pinning a palm alone must never conceal a disconnected wrist. */
export function armRigPose(rig, targets, width, height) {
    const result={transforms:{},joints:{},maxGap:0};
    if (!rig || !targets) return result;
    const point=p=>({x:p[0]*width,y:p[1]*height});
    // Hands cup the barrel, so orient them from the barrel axis, not the diagonal
    // between the lower pistol grip and fore-end. Preserve legacy fixtures.
    const restAxis=rig.handAxis || [rig.grip,rig.support];
    const axis=rig.handAxis&&targets.muzzle?[targets.stock,targets.muzzle]:[targets.grip,targets.support];
    const restLine={x:(restAxis[1][0]-restAxis[0][0])*width,y:(restAxis[1][1]-restAxis[0][1])*height};
    const line={x:(axis[1][0]-axis[0][0])*width,y:(axis[1][1]-axis[0][1])*height};
    const rotation=Math.atan2(line.y,line.x)-Math.atan2(restLine.y,restLine.x),co=Math.cos(rotation),si=Math.sin(rotation);
    for (const [side,arm] of Object.entries(rig.arms)) {
        const shoulder=point(arm.shoulder),elbow=point(arm.elbow),wrist=point(arm.wrist),palm=point(arm.palm);
        const target=point(side==='trigger'?targets.grip:targets.support),offset={x:wrist.x-palm.x,y:wrist.y-palm.y};
        const wanted={x:target.x+offset.x*co-offset.y*si,y:target.y+offset.x*si+offset.y*co};
        const pose=solveArm(shoulder,elbow,wrist,wanted,arm.elbowDirection),gap=distance(pose.wrist,wanted);
        result.maxGap=Math.max(result.maxGap,gap);
        result.joints[side]={shoulder,...pose,palm:target,handWrist:wanted,gap};
        const transforms={upper:boneMatrix(shoulder,elbow,shoulder,pose.elbow),forearm:boneMatrix(elbow,wrist,pose.elbow,pose.wrist),
            hand:[co,si,-si,co,target.x-co*palm.x+si*palm.y,target.y-si*palm.x-co*palm.y]};
        for (const [part,matrix] of Object.entries(transforms)) result.transforms[`${side}-${part}`]=matrix;
    }
    return result;
}
export const armTransforms=(rig,targets,width,height)=>armRigPose(rig,targets,width,height).transforms;

/** Reduce gun sway to the arm workspace, preserving stock contact, both grips and fixed bone lengths. */
export function constrainGunPose(sample, desired, rig, width, height) {
    const evaluate=t=>{
        const input={yaw:(desired.yaw||0)*t,pitch:(desired.pitch||0)*t,recoil:(desired.recoil||0)*t};
        const targets=sample(input),arms=armRigPose(rig,targets,width,height);
        return {input,targets,arms,scale:t};
    };
    const full=evaluate(1);
    if(full.arms.maxGap<.01)return full;
    let accepted=evaluate(0);
    if(accepted.arms.maxGap>.01)throw Error('Neutral gun pose is outside the painted arm workspace');
    let low=0,high=1;
    for(let i=0;i<14;i++){
        const mid=(low+high)/2,candidate=evaluate(mid);
        if(candidate.arms.maxGap<.001){low=mid;accepted=candidate;}else high=mid;
    }
    // sample() mutates the gun root. Restore the exact accepted pose after the search.
    sample(accepted.input);
    return accepted;
}
export function placeArmRig(figure,rig,targets,width,height) {
    for(const[bone,matrix]of Object.entries(armTransforms(rig,targets,width,height))){
        const el=figure.querySelector(`[data-bone="${bone}"]`);
        if(el){el.style.transformOrigin='0 0';el.style.transform=`matrix(${matrix.map(n=>n.toFixed(6)).join(',')})`;}
    }
}
