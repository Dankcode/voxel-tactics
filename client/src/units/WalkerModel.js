import * as THREE from 'three';
import { WALKERS, walkerContacts } from '../../../shared/battle/Walker.js';
import { legPose } from '../../../shared/battle/WalkerIK.js';
const point=p=>new THREE.Vector3(p[0],p[2],p[1]);
export class WalkerModel {
    constructor(unit,store,clipping) {
        this.unit=unit;this.store=store;this.spec=WALKERS[unit.type];this.root=new THREE.Group();this.feet=[];this.phase=0;this.last=null;
        const armor=new THREE.MeshStandardMaterial({color:this.spec.color,roughness:.65,metalness:.6,clippingPlanes:clipping});
        const dark=new THREE.MeshStandardMaterial({color:0x29352f,roughness:.7,metalness:.7,clippingPlanes:clipping});
        const glow=new THREE.MeshBasicMaterial({color:0xff6b55,clippingPlanes:clipping});
        const body=new THREE.Mesh(new THREE.SphereGeometry(.64,16,10),armor);body.scale.set(1.25,.6,1);body.position.y=this.spec.height;this.root.add(body);
        const eye=new THREE.Mesh(new THREE.SphereGeometry(.18,12,8),glow);eye.position.set(0,this.spec.height+.2,-.55);this.root.add(eye);
        const cannon=new THREE.Mesh(new THREE.CylinderGeometry(.1,.16,.8,8),dark);cannon.rotation.x=Math.PI/2;cannon.position.set(.32,this.spec.height,-.7);this.root.add(cannon);
        const pod=new THREE.Mesh(new THREE.SphereGeometry(.18,10,8),dark);pod.position.set(-.32,this.spec.height,-.2);this.root.add(pod);
        this.legs=this.spec.legs.map(()=>{
            const upper=new THREE.Mesh(new THREE.CylinderGeometry(.075,.13,1,8),armor),lower=new THREE.Mesh(new THREE.CylinderGeometry(.045,.075,1,8),dark);
            const joint=new THREE.Mesh(new THREE.SphereGeometry(.14,10,8),glow),toe=new THREE.Mesh(new THREE.SphereGeometry(.13,8,6),dark);
            const tile=new THREE.Mesh(new THREE.RingGeometry(.33,.39,20).rotateX(-Math.PI/2),new THREE.MeshBasicMaterial({color:0xff6655,transparent:true,opacity:.55,side:THREE.DoubleSide,clippingPlanes:clipping}));
            this.root.add(upper,lower,joint,toe,tile);return {upper,lower,joint,toe,tile};
        });
        this.root.traverse(o=>{o.userData.unitId=unit.id;if(o.isMesh)o.castShadow=true;});
    }
    segment(mesh,a,b) {
        const from=point(a),to=point(b),delta=to.clone().sub(from);
        mesh.position.copy(from).add(to).multiplyScalar(.5);mesh.scale.y=delta.length();mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),delta.normalize());
    }
    update(pos,dt) {
        const at={x:pos.x-.5,y:pos.z-.5,z:pos.y-1};
        const grid={x:Math.round(at.x),y:Math.round(at.y),z:Math.round(at.z)};
        const moving=this.last&&this.last.distanceTo(pos)>.001;this.phase+=moving?dt*8:0;
        const contacts=walkerContacts(this.store,this.unit,grid);
        this.spec.legs.forEach((offset,i)=>{
            const fallback={x:at.x+offset[0]+.5,y:at.y+offset[1]+.5,h:at.z+1};
            const target=contacts[i]||fallback;
            if(!this.feet[i])this.feet[i]={...target};
            // Alternate pairs: planted toes hold in world space until the body stretches the stride.
            const foot=this.feet[i],error=Math.hypot(foot.x-target.x,foot.y-target.y,foot.h-target.h);
            if(error>.8||!moving){const k=Math.min(1,dt*(moving?12:20));for(const key of ['x','y','h'])foot[key]+=(target[key]-foot[key])*k;}
            const lifted={...foot,h:foot.h+(moving?Math.max(0,Math.sin(this.phase+i*Math.PI))*.22:0)};
            const pose=legPose(at,offset,lifted,this.spec.height),origin=[pos.x,pos.z,pos.y];
            const local=p=>p.map((v,j)=>v-origin[j]);
            const hip=local(pose.hip),knee=local(pose.knee),tip=local(pose.foot),leg=this.legs[i];
            this.segment(leg.upper,hip,knee);this.segment(leg.lower,knee,tip);leg.joint.position.copy(point(knee));leg.toe.position.copy(point(tip));
            leg.tile.position.copy(point(local([target.x,target.y,target.h+.015])));leg.tile.visible=target.kind!=='wall';
            const disabled=this.unit.parts.legs.disabled;leg.lower.visible=!disabled;
        });
        this.last=pos.clone();
    }
    dispose(){const materials=new Set();this.root.traverse(o=>{o.geometry?.dispose();if(o.material)materials.add(o.material);});for(const m of materials)m.dispose();}
}
