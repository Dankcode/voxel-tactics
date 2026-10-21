// PLAN-14: the enemy search drone — a small quadcopter hovering just over head height on its tile (the same body the
// ballistics trace: Ballistics.DRONE_BODY), four spinning rotors, a red scanner eye and a soft search cone on the
// ground under it. Built from primitives in the kit's flat-shaded style; no texture.
import * as THREE from 'three';
import { DRONE_BODY } from '../../../shared/battle/Ballistics.js';

export const DRONE_HOVER = (DRONE_BODY.h0 + DRONE_BODY.h1) / 2;
export class DroneModel {
    constructor(unit, clipping) {
        this.unit = unit; this.root = new THREE.Group(); this.t = Math.random() * 10; this.rotors = [];
        const shell = new THREE.MeshStandardMaterial({ color: 0x2b3033, roughness: 0.55, metalness: 0.45, clippingPlanes: clipping });
        const trim = new THREE.MeshStandardMaterial({ color: 0xc9a227, roughness: 0.6, metalness: 0.3, clippingPlanes: clipping });
        const blade = new THREE.MeshBasicMaterial({ color: 0x9aa3a8, transparent: true, opacity: 0.45, side: THREE.DoubleSide, clippingPlanes: clipping, depthWrite: false });
        const eye = new THREE.MeshBasicMaterial({ color: 0xff3b2f, clippingPlanes: clipping, toneMapped: false });
        this.body = new THREE.Group(); this.body.position.y = DRONE_HOVER; this.body.scale.setScalar(1.45); this.root.add(this.body);
        const hull = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.12, 0.42), shell); this.body.add(hull);
        const dome = new THREE.Mesh(new THREE.SphereGeometry(0.12, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), shell); dome.position.y = 0.06; this.body.add(dome);
        const lens = new THREE.Mesh(new THREE.SphereGeometry(0.055, 10, 8), eye); lens.position.set(0, -0.05, -0.2); this.body.add(lens);
        for (const [x, z] of [[0.28, 0.28], [-0.28, 0.28], [0.28, -0.28], [-0.28, -0.28]]) {
            const arm = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.035, 0.4), trim); arm.position.set(x / 2, 0, z / 2); arm.rotation.y = Math.atan2(x, z); this.body.add(arm);
            const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.06, 8), shell); hub.position.set(x, 0.04, z); this.body.add(hub);
            const r = new THREE.Mesh(new THREE.CircleGeometry(0.15, 16).rotateX(-Math.PI / 2), blade); r.position.set(x, 0.075, z); this.body.add(r); this.rotors.push(r);
        }
        // Scanner cone: a faint red footprint the drone sweeps across the ground.
        this.cone = new THREE.Mesh(new THREE.ConeGeometry(0.55, DRONE_HOVER - 0.05, 20, 1, true), new THREE.MeshBasicMaterial({ color: 0xff5a4a, transparent: true, opacity: 0.08, side: THREE.DoubleSide, depthWrite: false, clippingPlanes: clipping }));
        this.cone.position.y = (DRONE_HOVER - 0.05) / 2; this.root.add(this.cone);
        this.root.traverse(o => { o.userData.unitId = unit.id; if (o.isMesh && o !== this.cone && !this.rotors.includes(o)) o.castShadow = true; });
    }
    /** pos: world position of the unit's tile foot point; facing (dx, dy) turns the lens toward the move. */
    update(pos, dt, facing = null) {
        this.t += dt;
        const dead = this.unit.dead;
        this.body.position.y = dead ? 0.08 : DRONE_HOVER + Math.sin(this.t * 2.6) * 0.05;
        this.body.rotation.z = dead ? 0.6 : Math.sin(this.t * 1.7) * 0.04;
        if (facing && (facing[0] || facing[1])) this.body.rotation.y = Math.atan2(-facing[0], -facing[1]);
        for (const r of this.rotors) { r.rotation.y += dead ? 0 : dt * 40; r.visible = !dead; }
        this.cone.visible = !dead;
        this.cone.material.opacity = 0.06 + 0.04 * (0.5 + 0.5 * Math.sin(this.t * 3));
    }
    dispose() { const mats = new Set(); this.root.traverse(o => { o.geometry?.dispose(); if (o.material) mats.add(o.material); }); for (const m of mats) m.dispose(); }
}
