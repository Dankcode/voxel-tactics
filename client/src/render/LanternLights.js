// Warm point lights on the lanterns nearest the camera's focus (a small fixed pool, no shadows), so lit rooms and
// lamp-lit streets read as lit — most visible at dusk and night and inside cut-away rooms.
import * as THREE from 'three';
import { MAT } from '../../../shared/voxel/Materials.js';

export class LanternLights {
    constructor(scene, count = 8) {
        this.scene = scene;
        this.pool = Array.from({ length: count }, () => {
            const l = new THREE.PointLight(0xffb066, 0, 7.5, 1.4);
            l.castShadow = false;
            scene.scene.add(l);
            return l;
        });
        this.spots = [];
        this.strength = 1;
        this.t = 0;
    }
    scan(store) {
        this.spots = [];
        for (let z = 0; z < store.height; z++) for (let y = 0; y < store.depth; y++) for (let x = 0; x < store.width; x++)
            if (store.get(x, y, z) === MAT.lantern) this.spots.push(new THREE.Vector3(x + 0.5, z + 0.5, y + 0.5));
        this.t = 99;
    }
    update(dt, focus, cut = Infinity) {
        this.t += dt;
        if (this.t < 0.4) return;
        this.t = 0;
        const night = { day: 0.8, dusk: 1.3, night: 2.2 }[this.scene.lightingName] ?? 1;
        const near = this.spots.filter(p => p.y < cut).map(p => [p, p.distanceToSquared(focus)]).filter(([, d]) => d < 26 * 26).sort((a, b) => a[1] - b[1]);
        this.pool.forEach((l, i) => {
            const s = near[i];
            if (!s) { l.intensity = 0; return; }
            l.position.copy(s[0]);
            l.intensity = 3.2 * night * this.strength;
        });
    }
}
