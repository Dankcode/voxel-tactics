// Over-the-shoulder perspective camera for the back shot. While a cut-in plays, the scene renders through
// this camera: behind and above the acting unit's shoulder, looking at the target, with a slow dolly.
//
// SKELETON: one rig (offset back/up/right, dolly forward). TODO(animation): per-kind rigs (low angle
// for heavy weapons, tracking for throws), depth of field, collision against walls behind the unit.
import * as THREE from 'three';

export class CameraDirector {
    constructor(scene) {
        this.scene = scene;
        this.cam = new THREE.PerspectiveCamera(42, 1, 0.3, 300);
        this.active = false;
        this.from = new THREE.Vector3(); this.to = new THREE.Vector3(); this.look = new THREE.Vector3();
    }
    /** shooter, target: three-space Vector3 at the units' feet. */
    begin(shooter, target) {
        const dir = new THREE.Vector3().subVectors(target, shooter); dir.y = 0;
        if (dir.lengthSq() < 1e-6) dir.set(0, 0, 1);
        dir.normalize();
        const right = new THREE.Vector3(-dir.z, 0, dir.x);
        this.from.copy(shooter).addScaledVector(dir, -4.2).addScaledVector(right, 1.4).add(new THREE.Vector3(0, 2.9, 0));
        this.to.copy(shooter).addScaledVector(dir, -3.1).addScaledVector(right, 1.1).add(new THREE.Vector3(0, 2.4, 0));
        this.look.copy(target).add(new THREE.Vector3(0, 1.1, 0));
        this.cam.aspect = window.innerWidth / window.innerHeight;
        this.cam.updateProjectionMatrix();
        this.active = true;
        this.apply(0);
    }
    apply(k) {
        this.cam.position.lerpVectors(this.from, this.to, k);
        this.cam.lookAt(this.look);
    }
    end() { this.active = false; }
}
