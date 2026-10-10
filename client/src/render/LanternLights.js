// Warm point lights on the lanterns nearest the camera's focus (a small fixed pool, no shadows), so lit rooms and
// lamp-lit streets read as lit — most visible at dusk and night and inside cut-away rooms.
import * as THREE from 'three';
import { MAT } from '../../../shared/voxel/Materials.js';

/** Height of the lamp above the floor for decor kinds that carry a light (ModernPieces DECOR_LIGHTS). */
const DECOR_LIGHT_HEIGHT = { streetlight: 3.4, floodlight: 4.1, floor_lamp: 1.4, nightstand: 0.65, price_sign: 2.7, motel_sign: 3.9, canopy: -0.1 };

export class LanternLights {
    constructor(scene, count = 10) {
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
    /** Light spots: lantern voxels, plus lamps among the mission's decor (street lights, floodlights, lamps, signs). */
    scan(store, decor = this.decor) {
        this.decor = decor || [];
        this.spots = [];
        for (let z = 0; z < store.height; z++) for (let y = 0; y < store.depth; y++) for (let x = 0; x < store.width; x++)
            if (store.get(x, y, z) === MAT.lantern || store.get(x,y,z)===MAT.emergency_light) this.spots.push(new THREE.Vector3(x + 0.5, z + 0.5, y + 0.5));
        for (const d of this.decor) {
            const h = DECOR_LIGHT_HEIGHT[d.kind];
            if (h == null) continue;
            // Street-light heads hang out on their arm (toward the piece's +Z).
            const arm = d.kind === 'streetlight' ? 0.8 : 0;
            const p = new THREE.Vector3(d.x + 0.5 + Math.sin(d.yaw || 0) * arm, d.z + h, d.y + 0.5 + Math.cos(d.yaw || 0) * arm);
            if (d.kind === 'canopy') { p.range = 12; p.outdoor = true; this.spots.push(p); continue; }
            p.range = h > 2 ? 11 : 6; p.outdoor = h > 2;
            this.spots.push(p);
        }
        this.t = 99;
    }
    update(dt, focus, cut = Infinity) {
        this.t += dt;
        if (this.t < 0.4) return;
        this.t = 0;
        const night = { day: 0.8, dusk: 1.3, night: 2.2, 'night-ops':2.2 }[this.scene.lightingName] ?? 1;
        const near = this.spots.filter(p => p.y < cut).map(p => [p, p.distanceToSquared(focus)]).filter(([, d]) => d < 26 * 26).sort((a, b) => a[1] - b[1]);
        this.pool.forEach((l, i) => {
            const s = near[i];
            if (!s) { l.intensity = 0; return; }
            l.position.copy(s[0]);
            l.distance = s[0].range || 7.5;
            l.intensity = (s[0].outdoor ? 5 * (night - 0.6) : 3.2 * night) * this.strength;
        });
    }
}
