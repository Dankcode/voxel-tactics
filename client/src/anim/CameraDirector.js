// Preparation uses a close tactical shoulder view; committed actions use the lower, tighter back-shot camera.
import * as THREE from 'three';
import { castRay } from '../../../shared/voxel/Raycast.js';
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
    prepare(shooter,target) { this.begin(shooter,target,'prepare'); }
    begin(shooter,target,phase='action') {
        this.phase=phase; this.elapsed=0;
        const dir=target.clone().sub(shooter);dir.y=0;if(dir.lengthSq()<1e-6)dir.set(0,0,1);dir.normalize();
        const right=new THREE.Vector3(-dir.z,0,dir.x);
        this.head={x:shooter.x,y:shooter.z,h:shooter.y+1.7};
        const back=phase==='prepare'?5.4:2.8, up=phase==='prepare'?2.7:1.9, side=phase==='prepare'?1.3:0.85;
        const at=(b,sign=1,u=up)=>shooter.clone().addScaledVector(dir,-b).addScaledVector(right,side*sign*b/back).add(new THREE.Vector3(0,u,0));
        let safe=null;
        for(let b=back;b>=0.2&&!safe;b-=0.2) for(const sign of [1,-1]) {const v=at(b,sign);if(this.clear(v)){safe=v;break;}}
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
    end() {this.active=false;this.phase=null;this.scene.actionCamera=null;this.hidden=new Set();}
}
