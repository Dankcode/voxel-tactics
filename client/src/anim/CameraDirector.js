// Preparation uses a close tactical shoulder view; committed actions use the lower, tighter back-shot camera.
import * as THREE from 'three';
import { castRay, blocksSight } from '../../../shared/voxel/Raycast.js';
export const MAX_YAW = 35 * Math.PI / 180;
/** PLAN-14: the over-the-shoulder offset while aiming (tiles): behind the shoulder, to its side, above it. */
export const SHOULDER = Object.freeze({ back: 3.4, side: 0.95, up: 0.45 });
/** Frame a human-size target at roughly a third of the viewport, without moving through cover. */
export function targetAimFov(distance) {
    return THREE.MathUtils.clamp(THREE.MathUtils.radToDeg(2*Math.atan(2.4/(Math.max(1,distance)*.7))),14,38);
}
export class CameraDirector {
    constructor(scene) {
        this.scene=scene; this.cam=new THREE.PerspectiveCamera(38,1,0.08,300);
        this.active=false; this.phase=null;
        this.from=new THREE.Vector3();this.to=new THREE.Vector3();this.look=new THREE.Vector3();
        // PLAN-10: the storey cut in view (voxels at or above it are not drawn, so they never block the camera) and the
        // x-ray hook that hides the walls between a cramped interior camera and the shot (set by Game).
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
    prepareAim(shooter,target,{side='right'}={}){
        // PLAN-14: already aiming (a step-out or a shoulder swap): the follow camera glides over; no cut.
        if(this.active&&this.phase==='prepare'&&this.following){this.side=side;this.shooter=shooter.clone();this.head={x:shooter.x,y:shooter.z,h:shooter.y+1.7};return;}   // PLAN-15: wall tests from where the shooter now is
        this.side=side;this.following=false;if(!this.begin(shooter,target.clone().add(new THREE.Vector3(0,-1.1,0)),'prepare',{side}))return;this.look.copy(target);this.shooter=shooter.clone();this.aimDir=this.flatDir(shooter,target);this.apply(0);}
    focusTarget(point) { this.aimFov=targetAimFov(this.cam.position.distanceTo(point)); }
    zoomAim(factor) { this.aimFov=THREE.MathUtils.clamp((this.aimFov??38)*factor,14,60); }
    flatDir(a,b){const d=b.clone().sub(a);d.y=0;return d.lengthSq()<1e-6?new THREE.Vector3(0,0,1):d.normalize();}
    /**
     * PLAN-14: third-person-shooter aiming (Gears / The Division / Phoenix Point free aim). While aiming, the camera is
     * rigidly attached over the shooter's shoulder and turns with the aim: the mouse swings the view, the soldier keeps
     * the same place on screen and the reticle stays at the centre. Looking down raises the camera, looking up lowers
     * it (an orbit around the shoulder). The shoulder never pushes through walls: it pulls in toward the shooter, and
     * where even that is blocked the walls between camera and aim are cut away (x-ray, throttled).
     */
    track(point,dt){
        if(this.phase!=='prepare'||!this.shooter)return;
        this.clock=(this.clock||0)+dt;
        const pivot=this.shooter.clone().add(new THREE.Vector3(0,1.55,0));
        // PLAN-15: always test walls from the current shooter (home or peek tile), never from where aiming began.
        this.head={x:pivot.x,y:pivot.z,h:pivot.y+0.15};
        const dir=point.clone().sub(pivot),dist=dir.length();if(dist<1e-3)return;dir.multiplyScalar(1/dist);
        const flat=new THREE.Vector3(dir.x,0,dir.z);if(flat.lengthSq()<1e-6)flat.set(0,0,1);flat.normalize();
        const right=new THREE.Vector3(-flat.z,0,flat.x),side=(this.side==='left'?-1:1)*SHOULDER.side;
        const desired=pivot.clone().addScaledVector(dir,-SHOULDER.back).addScaledVector(right,side).add(new THREE.Vector3(0,SHOULDER.up,0));
        // PLAN-15: continuous pull-in (stop short of the first wall), then one raised try; never a camera inside a wall.
        let at=this.clear(desired)?desired:this.pullIn(pivot,desired);
        const look=pivot.clone().addScaledVector(dir,Math.max(dist,6));
        // Too close to read the shot: keep the readable shoulder distance and cut away what stands in front of it.
        const cramped=!at||at.distanceTo(pivot)<SHOULDER.back*0.45;
        if(cramped)at=this.openSpot(pivot,desired);
        this.xrayT=Math.max(0,(this.xrayT||0)-dt);
        const moved=!this.xrayAt||this.xrayAt.distanceTo(at)>0.3||this.xrayLook.distanceTo(look)>0.8;
        if(this.store&&!this.xrayT&&moved){
            this.xrayT=0.12;this.xrayAt=at.clone();this.xrayLook=look.clone();
            const fresh=this.foregroundCells(at,look,pivot);
            if(cramped||!this.sees(at,look))for(const cell of this.occluders(at,[pivot],Math.floor(this.shooter.y)-1))fresh.add(cell);
            // Hysteresis: a cut cell stays cut for 0.4 s after it stops blocking, so fast swings do not flash walls back.
            this.xrayKeep||=new Map();for(const c of fresh)this.xrayKeep.set(c,this.clock+0.4);
            for(const [c,until] of this.xrayKeep)if(until<this.clock)this.xrayKeep.delete(c);
            const cells=this.xrayKeep.size?new Set(this.xrayKeep.keys()):null,old=this.xrayCells;
            const changed=(!old)!==(!cells)||(old&&cells&&(old.size!==cells.size||[...cells].some(c=>!old.has(c))));
            if(changed){this.xrayCells=cells;this.xray?.(cells);}
        }
        const k=dt>0?1-Math.exp(-dt/0.05):1;
        this.cam.position.lerp(at,k);
        if(this.store&&this.solid(this.store,Math.floor(this.cam.position.x),Math.floor(this.cam.position.z),Math.floor(this.cam.position.y)))this.cam.position.copy(at);
        this.look.lerp(look,k);
        this.cam.aspect=this.scene.aspect||1;this.cam.updateProjectionMatrix();this.cam.lookAt(this.look);this.cam.updateMatrixWorld();
        this.aimDir=flat;this.following=true;
    }
    /** PLAN-15: the farthest clear spot on the line pivot → desired (then the same line raised 0.6), or null. */
    pullIn(pivot,desired){
        for(const lift of [0,0.6]){
            const d=desired.clone().add(new THREE.Vector3(0,lift,0));
            for(let k=0.94;k>=0.3;k-=0.06){const v=pivot.clone().lerp(d,k);if(this.clear(v))return v;}
        }
        return null;
    }
    /** PLAN-15: a camera spot at the readable distance that is at least not inside a solid voxel (walls get cut away). */
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
        this.phase=phase; this.elapsed=0;
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
        // PLAN-10: cramped interiors. Instead of pushing the shoulder camera into the shooter's back, keep it back at a
        // readable distance, widen the view and hide the walls and furniture between it and the shot (XCOM cutaway).
        let xray=null;
        // PLAN-11: also when the best spot found still cannot see the target (the fallback pick ignores the view), keep
        // that spot and cut away what is in the way, so the target is always visible while aiming.
        const blind=!!safe&&!this.sees(safe,look);
        if(phase==='prepare'&&this.store&&(!safe||blind||safe.distanceTo(shooter)<back*0.6)) {
            const s=this.store,keep=blind&&safe.distanceTo(shooter)>=back*0.6;
            for(const v of keep?[safe]:[back*0.8,back*0.6,back*0.45].map(b=>at(b,main))) {
                if(v.x<0.5||v.z<0.5||v.x>s.width-0.5||v.z>s.depth-0.5)continue;
                const cells=this.occluders(v,[shooter.clone().add(new THREE.Vector3(0,1.4,0)),target.clone().add(new THREE.Vector3(0,1.1,0)),target.clone().add(new THREE.Vector3(0,0.4,0))],Math.min(Math.floor(shooter.y),Math.floor(target.y))-1);
                xray={v,cells};break;
            }
            if(xray){safe=xray.v;this.xrayCells=xray.cells;this.aimFov=Math.max(this.aimFov??38,50);}
        }
        this.xray?.(this.xrayCells);
        if (!safe) {const v=shooter.clone().add(new THREE.Vector3(0,1.7,0)); if(this.clear(v))safe=v;}
        if (!safe) {this.end();return false;}
        this.from.copy(safe);this.to.copy(safe).lerp(shooter.clone().add(new THREE.Vector3(0,up,0)),0.12);
        if(!this.clear(this.to)||!this.sees(this.to,look))this.to.copy(this.from);
        this.look.copy(target).add(new THREE.Vector3(0,1.1,0));
        this.cam.fov=phase==='prepare'?(this.aimFov??38):44;this.cam.aspect=this.scene.aspect || 1;this.cam.updateProjectionMatrix();
        // Keep whoever is hidden (the aiming shooter): re-framing while the reticle moves must not reveal them.
        this.active=true;this.scene.actionCamera=this.cam;this.hidden||=new Set();this.apply(0);return true;
    }
    update(dt) {if(this.active&&this.phase==='prepare'){this.elapsed+=dt;this.cam.fov+=( (this.aimFov??38)-this.cam.fov)*(1-Math.exp(-dt/.15));if(this.following){this.cam.updateProjectionMatrix();return;}this.apply(Math.min(1,this.elapsed/0.65));}}
    apply(k) {
        this.cam.position.lerpVectors(this.from,this.to,THREE.MathUtils.clamp(k,0,1));
        if(!this.clear(this.cam.position))this.cam.position.copy(this.from);
        this.cam.aspect=this.scene.aspect || 1;this.cam.updateProjectionMatrix();this.cam.lookAt(this.look);this.cam.updateMatrixWorld();
    }
    end() {const was=this.active;this.following=false;this.xrayAt=null;this.xrayKeep=null;this.aimFov=38;this.shooter=null;this.active=false;this.phase=null;if(this.xrayCells){this.xrayCells=null;this.xray?.(null);}if(was)this.onEnd?.();this.scene.actionCamera=null;this.hidden=new Set();}
}
