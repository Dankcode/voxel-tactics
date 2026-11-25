// Player shots retain their prepared shoulder camera; other actions use the lower back-shot camera.
import * as THREE from 'three';
import { castRay, blocksSight } from '../../../shared/voxel/Raycast.js';
export const MAX_YAW = 35 * Math.PI / 180;
/** PLAN-14: the over-the-shoulder offset while aiming (tiles): behind the shoulder, to its side, above it. */
export const SHOULDER = Object.freeze({ back: 3.4, side: 0.95, up: 0.45 });
export class CameraDirector {
    constructor(scene) {
        this.scene=scene; this.cam=new THREE.PerspectiveCamera(38,1,0.08,300);
        this.active=false; this.phase=null;
        this.from=new THREE.Vector3();this.to=new THREE.Vector3();this.look=new THREE.Vector3();
        // Shooting uses the complete map; the camera moves to a clear position instead of hiding map voxels.
        this.cutZ=Infinity;this.xray=null;this.xrayCells=null;
    }
    solid(store,x,y,z){return z<this.cutZ&&store.isSolid(x,y,z)&&!this.xrayCells?.has(`${x},${y},${z}`);}
    /** Allied billboards close to the shoulder camera must not fill the aiming viewport. */
    foregroundUnit(position) {
        if(!this.active)return false;
        const p=position.clone().add(new THREE.Vector3(0,1,0)).applyMatrix4(this.cam.matrixWorldInverse);
        const depth=-p.z, halfHeight=Math.max(.1,depth)*Math.tan(THREE.MathUtils.degToRad(this.cam.fov/2));
        // Cull allies whose billboard occupies at least a quarter of the screen height.
        return depth>-.8 && depth<14 && 1.8/(2*halfHeight)>.25 && Math.abs(p.x)<halfHeight*this.cam.aspect+1 && Math.abs(p.y)<halfHeight+1.5;
    }
    /** True when a friendly character's billboard sits near the shoulder camera or overlaps the aiming reticle. */
    obstructsAim(position, aimWorld = null, { height = 2.4, radius = 0.9 } = {}) {
        if (!this.active) return false;
        const feet = position.clone().applyMatrix4(this.cam.matrixWorldInverse);
        const depth = -feet.z;
        if (depth <= -0.8) return false;
        if (depth < 0.5) return Math.hypot(feet.x, feet.y + height * 0.5) < radius + 1.2;
        const halfHeight = depth * Math.tan(THREE.MathUtils.degToRad(this.cam.fov / 2));
        const halfWidth = halfHeight * (this.cam.aspect || 1);
        const uLeft = (feet.x - radius) / halfWidth, uRight = (feet.x + radius) / halfWidth;
        const uBot = (feet.y - 0.15) / halfHeight, uTop = (feet.y + height) / halfHeight;
        if (uRight < -1.05 || uLeft > 1.05 || uTop < -1.05 || uBot > 1.05) return false;
        if (this.foregroundUnit(position) || depth < 4.8) return true;
        let aimDepth = Infinity, aimNdc = { x: 0, y: 0 };
        if (aimWorld) {
            const aimCam = aimWorld.clone().applyMatrix4(this.cam.matrixWorldInverse);
            aimDepth = -aimCam.z;
            aimNdc = aimWorld.clone().project(this.cam);
        }
        if (depth < aimDepth + 0.6) {
            const margin = 0.18;
            const inBox = (x, y) => x >= uLeft - margin && x <= uRight + margin && y >= uBot - margin && y <= uTop + margin;
            return inBox(aimNdc.x, aimNdc.y) || inBox(0, 0);
        }
        return false;
    }
    /** Screen-space clearance behind the shooter's shoulder. This never changes collision or cover. */
    foregroundCells(at,look,pivot) {
        if(!this.store)return new Set();
        const camera=new THREE.PerspectiveCamera(this.cam.fov,this.scene.aspect||1,.01,30);
        camera.position.copy(at);camera.lookAt(look);camera.updateMatrixWorld(true);
        const depth=Math.max(.5,Math.min(4.5,at.distanceTo(pivot)-.35)),cells=new Set();
        for(let iy=-2;iy<=2;iy++)for(let ix=-3;ix<=3;ix++){
            const ray=new THREE.Vector3(ix/3,iy/2,.5).unproject(camera).sub(at).normalize();
            const to=at.clone().addScaledVector(ray,depth);
            castRay(this.store,{x:at.x,y:at.z,h:at.y},{x:to.x,y:to.z,h:to.y},{blocks:()=>false,skipStart:false,visit:(x,y,z)=>{
                if(z>Math.floor(pivot.y)-2 && this.store.get(x,y,z))cells.add(`${x},${y},${z}`);
            }});
        }
        return cells;
    }
    clear(v) {
        const s=this.store;
        return !s || (!this.solid(s,Math.floor(v.x),Math.floor(v.z),Math.floor(v.y)) && !castRay(s,this.head,{x:v.x,y:v.z,h:v.y},{blocks:(store,x,y,z)=>this.solid(store,x,y,z)}).hit);
    }
    /** True when nothing opaque stands between camera position `v` and the look point (its last 1.2 tiles excepted). */
    sees(v,look=this.look) {
        const s=this.store;if(!s)return true;
        const a={x:v.x,y:v.z,h:v.y},b={x:look.x,y:look.z,h:look.y},d=Math.hypot(b.x-a.x,b.y-a.y,b.h-a.h);
        if(d<1.5)return true;
        const k=(d-1.2)/d;
        return !castRay(s,a,{x:a.x+(b.x-a.x)*k,y:a.y+(b.y-a.y)*k,h:a.h+(b.h-a.h)*k},{blocks:(st,x,y,z)=>z<this.cutZ&&!this.xrayCells?.has(`${x},${y},${z}`)&&blocksSight(st,x,y,z)}).hit;
    }
    /**
     * PLAN-10 interior x-ray: every voxel between camera position `v` and the given points, from the shooter's body
     * level up to the storey cut (floors under the feet are never hidden), plus the voxels around the camera itself.
     * A small fan of rays per point keeps the gap wide enough to read the room.
     */
    occluders(v,points,floorZ){
        const s=this.store,out=new Set();if(!s)return out;
        const keep=(x,y,z)=>{if(z>floorZ&&z<this.cutZ&&s.isSolid(x,y,z))out.add(`${x},${y},${z}`);};
        const a={x:v.x,y:v.z,h:v.y};
        for(const p of points)for(const [ox,oy,oh] of [[0,0,0],[.45,0,0],[-.45,0,0],[0,.45,0],[0,-.45,0],[0,0,.5]]) {
            const b={x:p.x+ox,y:p.z+oy,h:p.y+oh},d=Math.hypot(b.x-a.x,b.y-a.y,b.h-a.h);if(d<1e-6)continue;
            const k=Math.max(0,(d-0.6)/d);
            castRay(s,a,{x:a.x+(b.x-a.x)*k,y:a.y+(b.y-a.y)*k,h:a.h+(b.h-a.h)*k},{blocks:()=>false,skipStart:false,visit:keep});
        }
        for(let dx=-1;dx<=1;dx++)for(let dy=-1;dy<=1;dy++)for(let dz=-1;dz<=1;dz++)keep(Math.floor(a.x)+dx,Math.floor(a.y)+dy,Math.floor(a.h)+dz);
        return out;
    }
    prepareAim(shooter,target,{side='right',preserveDirection=false}={}){
        // A strafe translates the shot and keeps its viewing direction even when a wall changes the shoulder offset.
        if(this.active&&this.phase==='prepare'&&this.following){
            this.side=side;
            this.fixedDir=preserveDirection?this.cam.getWorldDirection(new THREE.Vector3()):null;
            this.shooter=shooter.clone();
            this.head={x:shooter.x,y:shooter.z,h:shooter.y+1.7};
            if(!preserveDirection)this.aimFocus=target.clone();
            return;
        }
        this.side=side;this.fixedDir=null;this.following=false;this.desiredAt=null;this.desiredLook=null;
        if(!this.begin(shooter,target.clone().add(new THREE.Vector3(0,-1.1,0)),'prepare',{side}))return;
        this.look.copy(target);this.aimFocus=target.clone();this.desiredLook=target.clone();this.desiredAt=this.cam.position.clone();this.shooter=shooter.clone();
        this.aimDir=this.flatDir(shooter,target);this.apply(0);
    }
    zoomAim(factor) { this.aimFov=THREE.MathUtils.clamp((this.aimFov??38)*factor,14,48); }
    orbitAim(dx, dy, { sens = 0.0055 } = {}) {
        if (this.phase !== 'prepare' || !this.shooter) return;
        const pivot = this.shooter.clone().add(new THREE.Vector3(0, 1.55, 0));
        const base = (this.aimFocus || this.look).clone().sub(pivot);
        const dist = Math.max(4, base.length());
        const flatLen = Math.hypot(base.x, base.z) || 1e-4;
        const yaw = Math.atan2(base.z, base.x) + dx * sens;
        const pitch = THREE.MathUtils.clamp(Math.atan2(base.y, flatLen) - dy * sens, -0.9, 0.9);
        const c = Math.cos(pitch);
        this.aimFocus = pivot.clone().add(new THREE.Vector3(Math.cos(yaw) * c * dist, Math.sin(pitch) * dist, Math.sin(yaw) * c * dist));
        this.fixedDir = null;
        this.track(this.aimFocus, 0);
    }
    flatDir(a,b){const d=b.clone().sub(a);d.y=0;return d.lengthSq()<1e-6?new THREE.Vector3(0,0,1):d.normalize();}
    /**
     * Smooth over-the-shoulder aiming: transitions immediately on direct `track()` / `orbitAim()` / `setPeek()` calls,
     * or smoothly over ~0.12s via `desiredAt`/`desiredLook` in `update(dt)` when `{ smooth: true }` (target framing).
     */
    track(point,dt,{smooth=false}={}){
        if(this.phase!=='prepare'||!this.shooter)return;
        this.clock=(this.clock||0)+(dt||0);
        const pivot=this.shooter.clone().add(new THREE.Vector3(0,1.55,0));
        // PLAN-15: always test walls from the current shooter (home or peek tile), never from where aiming began.
        this.head={x:pivot.x,y:pivot.z,h:pivot.y+0.15};
        const dir=point.clone().sub(pivot),dist=dir.length();if(dist<1e-3)return;dir.multiplyScalar(1/dist);
        if(this.fixedDir)dir.copy(this.fixedDir);
        const flat=new THREE.Vector3(dir.x,0,dir.z);if(flat.lengthSq()<1e-6)flat.set(0,0,1);flat.normalize();
        const right=new THREE.Vector3(-flat.z,0,flat.x),side=(this.side==='left'?-1:1)*SHOULDER.side;
        const desired=pivot.clone().addScaledVector(dir,-SHOULDER.back).addScaledVector(right,side).add(new THREE.Vector3(0,SHOULDER.up,0));
        // PLAN-15: continuous pull-in (stop short of the first wall), then one raised try; never a camera inside a wall.
        let at=this.clear(desired)?desired:this.pullIn(pivot,desired);
        // Too close to read the shot: move to a clear position without hiding intervening geometry.
        const cramped=!at||at.distanceTo(pivot)<SHOULDER.back*0.45;
        if(cramped)at=this.openSpot(pivot,desired);
        const look=this.fixedDir?at.clone().addScaledVector(this.fixedDir,Math.max(dist,6)):pivot.clone().addScaledVector(dir,Math.max(dist,6));
        this.desiredAt=at.clone();
        this.desiredLook=look.clone();
        this.aimFocus=look.clone();
        if(!smooth||this.fixedDir){
            this.cam.position.copy(at);
            this.look.copy(look);
            this.cam.aspect=this.scene.aspect||1;this.cam.updateProjectionMatrix();this.cam.lookAt(this.look);this.cam.updateMatrixWorld();
        }
        this.aimDir=flat;this.following=true;
    }
    commitAim(unitId=null) {
        if(!this.active||this.phase!=='prepare')return false;
        this.phase='action';this.elapsed=0;this.from.copy(this.cam.position);this.to.copy(this.cam.position);this.aimContinuity=true;this.aimUnitId=unitId;
        return true;
    }
    resumeAim() {
        if(!this.active||this.phase!=='action'||!this.aimContinuity||!this.shooter)return false;
        this.phase='prepare';this.elapsed=0;this.following=true;this.from.copy(this.cam.position);this.to.copy(this.cam.position);
        return true;
    }
    /** PLAN-15: the farthest clear spot on the line pivot → desired (then the same line raised 0.6), or null. */
    pullIn(pivot,desired){
        for(const lift of [0,0.6]){
            const d=desired.clone().add(new THREE.Vector3(0,lift,0));
            for(let k=0.94;k>=0.3;k-=0.06){const v=pivot.clone().lerp(d,k);if(this.clear(v))return v;}
        }
        return null;
    }
    /** PLAN-15: the farthest camera position on this line that is not inside a solid voxel. */
    openSpot(pivot,desired){
        const s=this.store;if(!s)return desired;
        for(let k=1;k>=0.2;k-=0.1){const v=pivot.clone().lerp(desired,k);if(!this.solid(s,Math.floor(v.x),Math.floor(v.z),Math.floor(v.y)))return v;}
        return pivot.clone().add(new THREE.Vector3(0,0.4,0));
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
        this.phase=phase; this.elapsed=0; this.aimContinuity=false; this.aimUnitId=null;
        const dir=target.clone().sub(shooter);dir.y=0;if(dir.lengthSq()<1e-6)dir.set(0,0,1);dir.normalize();
        const right=new THREE.Vector3(-dir.z,0,dir.x);
        this.head={x:shooter.x,y:shooter.z,h:shooter.y+1.7};
        const back=phase==='prepare'?7.2:2.8, up=phase==='prepare'?3.2:1.9, side=phase==='prepare'?1.3:0.85;
        const at=(b,sign=1,u=up)=>shooter.clone().addScaledVector(dir,-b).addScaledVector(right,side*sign*b/back).add(new THREE.Vector3(0,u,0));
        const look=target.clone().add(new THREE.Vector3(0,1.1,0)),main=shoulder==='left'?-1:1;
        const pick=(signs,scales,view)=>{
            for(let b=back;b>=0.2;b-=0.2) for(const sign of signs) for(const k of scales) {const v=at(b,sign*k);if(this.clear(v)&&(!view||this.sees(v,look)))return v;}
            return null;
        };
        this.xrayCells=null;
        let safe=pick([main],[1,0.6,0.3,0],true)||pick([-main],[1,0.6,0.3],true)||pick([main,-main],[1],false);
        this.xray?.(null);
        if (!safe) {const v=shooter.clone().add(new THREE.Vector3(0,1.7,0)); if(this.clear(v))safe=v;}
        if (!safe) {this.end();return false;}
        this.from.copy(safe);this.to.copy(safe).lerp(shooter.clone().add(new THREE.Vector3(0,up,0)),0.12);
        if(!this.clear(this.to)||!this.sees(this.to,look))this.to.copy(this.from);
        this.look.copy(target).add(new THREE.Vector3(0,1.1,0));
        this.cam.fov=phase==='prepare'?(this.aimFov??38):44;this.cam.aspect=this.scene.aspect || 1;this.cam.updateProjectionMatrix();
        // Keep whoever is hidden (the aiming shooter): re-framing while the reticle moves must not reveal them.
        this.active=true;this.scene.actionCamera=this.cam;this.hidden||=new Set();this.apply(0);return true;
    }
    update(dt) {
        if (this.active && this.phase === 'prepare') {
            this.elapsed += dt;
            this.cam.fov += ((this.aimFov ?? 38) - this.cam.fov) * (1 - Math.exp(-dt / .15));
            if (this.following) {
                if (this.desiredAt && this.desiredLook) {
                    const alpha = dt > 0 ? (1 - Math.exp(-dt / 0.12)) : 1;
                    this.cam.position.lerp(this.desiredAt, alpha);
                    if (!this.clear(this.cam.position)) this.cam.position.copy(this.desiredAt);
                    this.look.lerp(this.desiredLook, alpha);
                    this.cam.aspect = this.scene.aspect || 1;
                    this.cam.updateProjectionMatrix();
                    this.cam.lookAt(this.look);
                    this.cam.updateMatrixWorld();
                } else {
                    this.cam.updateProjectionMatrix();
                }
                return;
            }
            this.apply(Math.min(1, this.elapsed / 0.65));
        }
    }
    apply(k) {
        this.cam.position.lerpVectors(this.from,this.to,THREE.MathUtils.clamp(k,0,1));
        if(!this.clear(this.cam.position))this.cam.position.copy(this.from);
        this.cam.aspect=this.scene.aspect || 1;this.cam.updateProjectionMatrix();this.cam.lookAt(this.look);this.cam.updateMatrixWorld();
    }
    end() {const was=this.active;this.following=false;this.desiredAt=null;this.desiredLook=null;this.aimFocus=null;this.fixedDir=null;this.xrayAt=null;this.xrayKeep=null;this.aimFov=38;this.shooter=null;this.aimContinuity=false;this.aimUnitId=null;this.active=false;this.phase=null;if(this.xrayCells){this.xrayCells=null;this.xray?.(null);}if(was)this.onEnd?.();this.scene.actionCamera=null;this.hidden=new Set();}
}
