// Preparation uses a close tactical shoulder view; committed actions use the lower, tighter back-shot camera.
import * as THREE from 'three';
import { castRay } from '../../../shared/voxel/Raycast.js';
export const MAX_YAW = 35 * Math.PI / 180;
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
    prepareAim(shooter,target,{side='right'}={}){this.side=side;if(!this.begin(shooter,target.clone().add(new THREE.Vector3(0,-1.1,0)),'prepare',{side}))return;this.look.copy(target);this.shooter=shooter.clone();this.aimDir=this.flatDir(shooter,target);this.apply(0);}
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
    /** `side`: which shoulder to look over first ('right' default; 'left' when the soldier leans or steps out left). */
    begin(shooter,target,phase='action',{side:shoulder='right'}={}) {
        this.phase=phase; this.elapsed=0;
        const dir=target.clone().sub(shooter);dir.y=0;if(dir.lengthSq()<1e-6)dir.set(0,0,1);dir.normalize();
        const right=new THREE.Vector3(-dir.z,0,dir.x);
        this.head={x:shooter.x,y:shooter.z,h:shooter.y+1.7};
        const back=phase==='prepare'?5.4:2.8, up=phase==='prepare'?2.7:1.9, side=phase==='prepare'?1.3:0.85;
        const at=(b,sign=1,u=up)=>shooter.clone().addScaledVector(dir,-b).addScaledVector(right,side*sign*b/back).add(new THREE.Vector3(0,u,0));
        let safe=null;
        for(let b=back;b>=0.2&&!safe;b-=0.2) for(const sign of shoulder==='left'?[-1,1]:[1,-1]) {const v=at(b,sign);if(this.clear(v)){safe=v;break;}}
        if (!safe) {const v=shooter.clone().add(new THREE.Vector3(0,1.7,0)); if(this.clear(v))safe=v;}
        if (!safe) {this.end();return false;}
        this.from.copy(safe);this.to.copy(safe).lerp(shooter.clone().add(new THREE.Vector3(0,up,0)),0.12);
        if(!this.clear(this.to))this.to.copy(this.from);
        this.look.copy(target).add(new THREE.Vector3(0,1.1,0));
        this.cam.fov=phase==='prepare'?38:44;this.cam.aspect=this.scene.aspect || 1;this.cam.updateProjectionMatrix();
        this.active=true;this.scene.actionCamera=this.cam;this.hidden=new Set();this.apply(0);return true;
    }
    update(dt) {if(this.active&&this.phase==='prepare'){this.elapsed+=dt;this.apply(Math.min(1,this.elapsed/0.65));}}
    apply(k) {
        this.cam.position.lerpVectors(this.from,this.to,THREE.MathUtils.clamp(k,0,1));
        if(!this.clear(this.cam.position))this.cam.position.copy(this.from);
        this.cam.aspect=this.scene.aspect || 1;this.cam.updateProjectionMatrix();this.cam.lookAt(this.look);this.cam.updateMatrixWorld();
    }
    end() {const was=this.active;this.shooter=null;this.active=false;this.phase=null;if(was)this.onEnd?.();this.scene.actionCamera=null;this.hidden=new Set();}
}
