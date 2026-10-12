// Analytic two-bone inverse kinematics; shared by the procedural mesh and ballistic leg capsules.
const add=(a,b)=>a.map((v,i)=>v+b[i]),sub=(a,b)=>a.map((v,i)=>v-b[i]),mul=(a,k)=>a.map(v=>v*k);
const dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0),len=a=>Math.hypot(...a),norm=a=>mul(a,1/(len(a)||1));
export function solveLeg(hip,foot,upper=1.8,lower=1.8,bend=[0,0,1]) {
    const delta=sub(foot,hip),distance=len(delta),axis=norm(delta);
    const d=Math.max(.001,Math.min(distance,upper+lower-.0001));
    const along=(upper*upper-lower*lower+d*d)/(2*d);
    let perpendicular=sub(bend,mul(axis,dot(bend,axis)));
    if(len(perpendicular)<.001)perpendicular=sub([1,0,0],mul(axis,axis[0]));
    const knee=add(add(hip,mul(axis,along)),mul(norm(perpendicular),Math.sqrt(Math.max(0,upper*upper-along*along))));
    return {hip,knee,foot};
}
export function legPose(u,offset,foot,height) {
    const [dx,dy]=offset;
    return solveLeg([u.x+.5+Math.sign(dx)*.32,u.y+.5+Math.sign(dy)*.25,u.z+1+height],
        [foot.x,foot.y,foot.h],Math.abs(dx)>1?2.2:1.8,Math.abs(dx)>1?2.2:1.8,[dx,dy,1.2]);
}
/** First ray hit on a finite capsule, including both spherical end caps. */
export function rayCapsule(origin,d,a,b,r) {
    const axis=norm(sub(b,a)),length=len(sub(b,a)),o=sub(origin,a),od=dot(o,axis),dd=dot(d,axis);
    const po=sub(o,mul(axis,od)),pd=sub(d,mul(axis,dd));
    const aa=dot(pd,pd),bb=2*dot(po,pd),cc=dot(po,po)-r*r,disc=bb*bb-4*aa*cc;
    let best=Infinity;
    if(aa>1e-9&&disc>=0)for(const t of [(-bb-Math.sqrt(disc))/(2*aa),(-bb+Math.sqrt(disc))/(2*aa)])if(t>=0&&od+t*dd>=0&&od+t*dd<=length)best=Math.min(best,t);
    for(const c of [a,b]){const q=sub(origin,c),projection=dot(q,d),discriminant=projection*projection-dot(q,q)+r*r;
        if(discriminant>=0){const near=-projection-Math.sqrt(discriminant),far=-projection+Math.sqrt(discriminant);if(far>=0)best=Math.min(best,Math.max(0,near));}}
    return best;
}
