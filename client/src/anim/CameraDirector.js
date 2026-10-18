// Preparation uses a close tactical shoulder view; committed actions use the lower, tighter back-shot camera.
import * as THREE from 'three';
import { castRay, blocksSight } from '../../../shared/voxel/Raycast.js';
export const MAX_YAW = 35 * Math.PI / 180;
/** Frame a human-size target at roughly a third of the viewport, without moving through cover. */
export function targetAimFov(distance) {
    return THREE.MathUtils.clamp(THREE.MathUtils.radToDeg(2*Math.atan(2.4/(Math.max(1,distance)*.7))),14,38);
}
export class CameraDirector {
    constructor(scene) {
        this.scene=scene; this.cam=new THREE.PerspectiveCamera(38,1,0.08,300);
        this.active=false; this.phase=null;
        this.from=new THREE.Vector3();this.to=new THREE.Vector3();this.look=new THREE.Vector3();
    }
    clear(v) {
        const s=this.store;
        return !s || (!s.isSolid(Math.floor(v.x),Math.floor(v.z),Math.floor(v.y)) && !castRay(s,this.head,{x:v.x,y:v.z,h:v.y},{blocks:(store,x,y,z)=>store.isSolid(x,y,z)}).hit);
    }
    /** True when nothing opaque stands between camera position `v` and the look point (its last 1.2 tiles excepted). */
    sees(v,look=this.look) {
        const s=this.store;if(!s)return true;
        const a={x:v.x,y:v.z,h:v.y},b={x:look.x,y:look.z,h:look.y},d=Math.hypot(b.x-a.x,b.y-a.y,b.h-a.h);
        if(d<1.5)return true;
        const k=(d-1.2)/d;
        return !castRay(s,a,{x:a.x+(b.x-a.x)*k,y:a.y+(b.y-a.y)*k,h:a.h+(b.h-a.h)*k},{blocks:blocksSight}).hit;
    }
    prepareAim(shooter,target,{side='right'}={}){this.side=side;if(!this.begin(shooter,target.clone().add(new THREE.Vector3(0,-1.1,0)),'prepare',{side}))return;this.look.copy(target);this.shooter=shooter.clone();this.aimDir=this.flatDir(shooter,target);this.apply(0);}
    focusTarget(point) { this.aimFov=targetAimFov(this.cam.position.distanceTo(point)); }
    zoomAim(factor) { this.aimFov=THREE.MathUtils.clamp((this.aimFov??38)*factor,14,60); }
    flatDir(a,b){const d=b.clone().sub(a);d.y=0;return d.lengthSq()<1e-6?new THREE.Vector3(0,0,1):d.normalize();}
    /**
     * PLAN-07: in the prepare phase the shoulder camera looks where the aim currently is (damped), and swings round
     * behind the shooter again once the aim leaves ±35° yaw of its framing.
     */
    track(point,dt){
        if(this.phase!=='prepare'||!this.shooter)return;
        const k=1-Math.exp(-dt/0.12);this.look.lerp(point,k);
        const d=this.flatDir(this.shooter,point),yaw=Math.acos(THREE.MathUtils.clamp(d.dot(this.aimDir),-1,1));
        // Pitch is followed by the look-at alone; only a yaw beyond the framing re-anchors the shoulder.
        if(yaw>MAX_YAW){const look=this.look.clone();if(this.begin(this.shooter,point.clone().add(new THREE.Vector3(0,-1.1,0)),'prepare',{side:this.side})){this.look.copy(look);this.aimDir=d;this.elapsed=0;}}
    }
    prepare(shooter,target) { this.begin(shooter,target,'prepare'); }
    /**
     * Over-the-shoulder framing from `shooter` (the tile the shot leaves from, i.e. the step-out tile round a corner)
     * toward `target`. The camera stays over the same shoulder (`side`, right by default, so the back-shot sprite
     * always matches) and must see the target past walls: from the full distance inward it tries the full shoulder
     * offset, then less, then straight behind; only if nothing there sees the target does it try the other shoulder,
     * and only then any clear spot.
     */
    begin(shooter,target,phase='action',{side:shoulder='right'}={}) {
        this.phase=phase; this.elapsed=0;
        const dir=target.clone().sub(shooter);dir.y=0;if(dir.lengthSq()<1e-6)dir.set(0,0,1);dir.normalize();
        const right=new THREE.Vector3(-dir.z,0,dir.x);
        this.head={x:shooter.x,y:shooter.z,h:shooter.y+1.7};
        const back=phase==='prepare'?5.4:2.8, up=phase==='prepare'?2.7:1.9, side=phase==='prepare'?1.3:0.85;
        const at=(b,sign=1,u=up)=>shooter.clone().addScaledVector(dir,-b).addScaledVector(right,side*sign*b/back).add(new THREE.Vector3(0,u,0));
        const look=target.clone().add(new THREE.Vector3(0,1.1,0)),main=shoulder==='left'?-1:1;
        const pick=(signs,scales,view)=>{
            for(let b=back;b>=0.2;b-=0.2) for(const sign of signs) for(const k of scales) {const v=at(b,sign*k);if(this.clear(v)&&(!view||this.sees(v,look)))return v;}
            return null;
        };
        let safe=pick([main],[1,0.6,0.3,0],true)||pick([-main],[1,0.6,0.3],true)||pick([main,-main],[1],false);
        if (!safe) {const v=shooter.clone().add(new THREE.Vector3(0,1.7,0)); if(this.clear(v))safe=v;}
        if (!safe) {this.end();return false;}
        this.from.copy(safe);this.to.copy(safe).lerp(shooter.clone().add(new THREE.Vector3(0,up,0)),0.12);
        if(!this.clear(this.to)||!this.sees(this.to,look))this.to.copy(this.from);
        this.look.copy(target).add(new THREE.Vector3(0,1.1,0));
        this.cam.fov=phase==='prepare'?(this.aimFov??38):44;this.cam.aspect=this.scene.aspect || 1;this.cam.updateProjectionMatrix();
        // Keep whoever is hidden (the aiming shooter): re-framing while the reticle moves must not reveal them.
        this.active=true;this.scene.actionCamera=this.cam;this.hidden||=new Set();this.apply(0);return true;
    }
    update(dt) {if(this.active&&this.phase==='prepare'){this.elapsed+=dt;this.cam.fov+=( (this.aimFov??38)-this.cam.fov)*(1-Math.exp(-dt/.15));this.apply(Math.min(1,this.elapsed/0.65));}}
    apply(k) {
        this.cam.position.lerpVectors(this.from,this.to,THREE.MathUtils.clamp(k,0,1));
        if(!this.clear(this.cam.position))this.cam.position.copy(this.from);
        this.cam.aspect=this.scene.aspect || 1;this.cam.updateProjectionMatrix();this.cam.lookAt(this.look);this.cam.updateMatrixWorld();
    }
    end() {const was=this.active;this.aimFov=38;this.shooter=null;this.active=false;this.phase=null;if(was)this.onEnd?.();this.scene.actionCamera=null;this.hidden=new Set();}
}
