// Over-the-shoulder perspective camera for the back shot. While a cut-in plays, the scene renders through
// this camera: behind and above the acting unit's shoulder, looking at the target, with a slow dolly.
//
// SKELETON: one rig (offset back/up/right, dolly forward). TODO(animation): per-kind rigs (low angle
// for heavy weapons, tracking for throws), depth of field, collision against walls behind the unit.
import * as THREE from 'three';
import { castRay } from '../../../shared/voxel/Raycast.js';

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
        // Pull the rig in until nothing solid sits between the shoulder and the lens (no cameras inside walls).
        const store = this.store;
        const head = { x: shooter.x, y: shooter.z, h: shooter.y + 1.7 };
        const clear = v => !store || (!store.isSolid(Math.floor(v.x), Math.floor(v.z), Math.floor(v.y)) &&
            !castRay(store, head, { x: v.x, y: v.z, h: v.y }, { blocks: (s, x, y, z) => s.isSolid(x, y, z) }).hit);
        let back = 4.2;
        const at = (b, side, up) => shooter.clone().addScaledVector(dir, -b).addScaledVector(right, side).add(new THREE.Vector3(0, up, 0));
        while (back > 0.9 && !clear(at(back, 1.4 * back / 4.2, 2.9))) back -= 0.3;
        this.from.copy(at(back, 1.4 * back / 4.2, 2.9));
        this.to.copy(at(back * 0.74, 1.1 * back / 4.2, 2.4));
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
