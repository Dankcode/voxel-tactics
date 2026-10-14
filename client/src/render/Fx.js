// Transient effects: tracers, muzzle flashes, explosions, fire and smoke on the element
// field, and floating combat text (DOM).
import * as THREE from 'three';
import { ELEMENT_COLORS } from '../../../shared/elements/Elements.js';

const w2t = p => new THREE.Vector3(p.x, p.h, p.y);   // world {x,y,h} → three

export class Fx {
    constructor(scene, floatRoot) {
        this.scene = scene; this.floatRoot = floatRoot;
        this.items = [];
        this.group = new THREE.Group(); scene.scene.add(this.group);
        this.fireGroup = new THREE.Group(); this.group.add(this.fireGroup);
        this.fireMat = new THREE.MeshBasicMaterial({ color: 0xff8a2a, transparent: true, opacity: 0.75, depthWrite: false, clippingPlanes: scene.clipping });
        this.smokeMat = new THREE.MeshBasicMaterial({ color: 0x9aa0a6, transparent: true, opacity: 0.35, depthWrite: false, clippingPlanes: scene.clipping });
        this.fireGeo = new THREE.ConeGeometry(0.3, 0.8, 6);
        this.smokeGeo = new THREE.SphereGeometry(0.55, 8, 6);
        this.floats = [];
    }
    tracer(from, to, color = 0xfff0b0, life = 0.18) {
        const g = new THREE.BufferGeometry().setFromPoints([w2t(from), w2t(to)]);
        const line = new THREE.Line(g, new THREE.LineBasicMaterial({ color, transparent: true, opacity: 1, depthTest: true }));
        this.group.add(line);
        this.items.push({ obj: line, life, max: life, kind: 'fade' });
    }
    flash(at, color = 0xffe08a, size = 0.35, life = 0.12) {
        const m = new THREE.Mesh(new THREE.SphereGeometry(size, 8, 6), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, depthWrite: false }));
        m.position.copy(w2t(at)); this.group.add(m);
        this.items.push({ obj: m, life, max: life, kind: 'fade', grow: 0 });
    }
    explosion(at, radius, element) {
        const color = new THREE.Color(ELEMENT_COLORS[element] || '#ffb347');
        const m = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.7, depthWrite: false }));
        m.position.copy(w2t(at)); m.scale.setScalar(0.2); this.group.add(m);
        this.items.push({ obj: m, life: 0.45, max: 0.45, kind: 'fade', grow: radius });
        this.scene.shake = Math.max(this.scene.shake, 0.25 + radius * 0.08);
    }
    float(pos, text, color = '#fff', size = 18) {
        const el = document.createElement('div');
        el.className = 'float'; el.textContent = text; el.style.color = color; el.style.fontSize = `${size}px`;
        this.floatRoot.appendChild(el);
        this.floats.push({ el, pos: pos.clone().add(new THREE.Vector3(0, 2.2, 0)), t: 0 });
    }
    /** Mirror the element field: a flame per burning voxel, a puff per smoke cell (capped). */
    syncField(field) {
        for (const c of [...this.fireGroup.children]) { this.fireGroup.remove(c); }
        let n = 0;
        for (const k of field.fires.keys()) {
            if (n++ > 220) break;
            const [x, y, z] = k.split(',').map(Number);
            const f = new THREE.Mesh(this.fireGeo, this.fireMat); f.position.set(x + 0.5, z + 1.3, y + 0.5); this.fireGroup.add(f);
        }
        for (const [k, s] of field.surfaces) {
            if (s.effect !== 'burning' || n++ > 260) continue;
            const [x, y, z] = k.split(',').map(Number);
            const f = new THREE.Mesh(this.fireGeo, this.fireMat); f.scale.setScalar(0.6); f.position.set(x + 0.5, z + 1.25, y + 0.5); this.fireGroup.add(f);
        }
        let m = 0;
        for (const k of field.smoke.keys()) {
            if (m++ > 260) break;
            const [x, y, z] = k.split(',').map(Number);
            const s = new THREE.Mesh(this.smokeGeo, this.smokeMat); s.position.set(x + 0.5, z + 0.5, y + 0.5); this.fireGroup.add(s);
        }
    }
    update(dt) {
        const t = performance.now() / 1000;
        for (const c of this.fireGroup.children) if (c.material === this.fireMat) c.scale.y = 0.8 + Math.sin(t * 9 + c.position.x * 3) * 0.25;
        this.items = this.items.filter(it => {
            it.life -= dt;
            const k = Math.max(0, it.life / it.max);
            if (it.grow) it.obj.scale.setScalar(Math.max(0.2, it.grow * (1 - k)));
            if (it.obj.material) { it.obj.material.transparent = true; it.obj.material.opacity = Math.min(1, k * 1.4); }
            if (it.life <= 0) { this.group.remove(it.obj); it.obj.geometry?.dispose(); it.obj.material?.dispose(); return false; }
            return true;
        });
        this.floats = this.floats.filter(f => {
            f.t += dt;
            if (f.t > 1.2) { f.el.remove(); return false; }
            const v = f.pos.clone(); v.y += f.t * 0.9;
            const p = this.scene.project(v);
            f.el.style.transform = `translate(${p.x}px, ${p.y}px) translate(-50%, -50%)`;
            f.el.style.opacity = String(Math.min(1, 2.4 - f.t * 2));
            return true;
        });
    }
}
