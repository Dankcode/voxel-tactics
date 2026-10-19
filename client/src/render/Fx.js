// Transient effects: tracers, muzzle flashes, explosions, fire and smoke on the element
// field, and floating combat text (DOM).
import * as THREE from 'three';
import { ELEMENT_COLORS } from '../../../shared/elements/Elements.js';

const w2t = p => new THREE.Vector3(p.x, p.h, p.y);   // world {x,y,h} → three
export const TRACER_SPEED = 90, TRACER_LENGTH = 1.2, BURST_GAP = 0.07;

export class Fx {
    constructor(scene, floatRoot) {
        this.scene = scene; this.floatRoot = floatRoot;
        this.items = [];
        this.group = new THREE.Group(); scene.scene.add(this.group);
        this.fireGroup = new THREE.Group(); this.group.add(this.fireGroup);
        this.fireMat = new THREE.MeshBasicMaterial({ color: 0xff8a2a, transparent: true, opacity: 0.75, depthWrite: false, clippingPlanes: scene.clipping });
        this.smokeMat = new THREE.MeshBasicMaterial({ color: 0x9aa0a6, transparent: true, opacity: 0.35, depthWrite: false, clippingPlanes: scene.clipping });
        this.fireGeo = new THREE.ConeGeometry(0.3, 0.8, 6);
        this.tracerGeo = new THREE.CylinderGeometry(1, 1, 1, 6, 1, true);
        this.puffGeo = new THREE.SphereGeometry(1, 8, 6);
        this.sparkGeo = new THREE.BoxGeometry(0.03, 0.03, 0.12);
        this.smokeGeo = new THREE.SphereGeometry(0.55, 8, 6);
        this.floats = [];
    }
    /**
     * PLAN-07 tracer: a glowing streak (bright core + soft halo, additive) that travels from the muzzle at `speed`
     * tiles/s and fades its tail out after it lands. `delay` staggers burst rounds. `onArrive` fires at the impact
     * (sparks, puffs). Returns the item so callers/tests can follow it.
     */
    tracer(from, to, color = 0xfff0b0, { speed = TRACER_SPEED, length = TRACER_LENGTH, delay = 0, onArrive = null } = {}) {
        const a = w2t(from), b = w2t(to), dist = a.distanceTo(b);
        const obj = new THREE.Group();
        const core = new THREE.Mesh(this.tracerGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
        const halo = new THREE.Mesh(this.tracerGeo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
        core.scale.set(0.022, 1, 0.022); halo.scale.set(0.07, 1, 0.07);
        obj.add(halo, core); obj.visible = false;
        obj.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
        this.group.add(obj);
        const it = { obj, kind: 'tracer', a, b, dist, speed, length, wait: delay, head: 0, onArrive, arrived: false, life: 1, max: 1 };
        this.items.push(it);
        return it;
    }
    /** Impact feedback by material family: sparks off metal, dust off stone/earth, splinters off wood, blood-red off units. */
    impact(at, family = 'stone', { exit = false } = {}) {
        const col = { metal: 0xffd27a, stone: 0xb8ad9c, earth: 0x9c8466, wood: 0xc49a62, unit: 0xd04030, glass: 0xd8f0ff }[family] ?? 0xb8ad9c;
        const p = w2t(at);
        const puff = new THREE.Mesh(this.puffGeo, new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.8, depthWrite: false }));
        puff.position.copy(p); puff.scale.setScalar(0.05); this.group.add(puff);
        this.items.push({ obj: puff, life: exit ? 0.35 : 0.28, max: exit ? 0.35 : 0.28, kind: 'fade', grow: exit ? 0.45 : 0.3 });
        if (family === 'metal' || family === 'unit') {
            const n = family === 'metal' ? 4 : 3;
            for (let i = 0; i < n; i++) {
                const v = new THREE.Vector3(Math.cos(i * 2.4) * 2.2, 1.4 + (i % 2), Math.sin(i * 2.4) * 2.2);
                const s = new THREE.Mesh(this.sparkGeo, new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
                s.position.copy(p); this.group.add(s);
                this.items.push({ obj: s, life: 0.22, max: 0.22, kind: 'spark', v });
            }
        }
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
    /**
     * PLAN-12 airstrike bomb: a dark finned body with a hot trail drops straight down from high above onto `at`
     * ({x,y,h}) over `fall` seconds (after `delay`). Resolves when it lands, so the blast plays on impact.
     */
    bomb(at, { fall = 0.6, delay = 0, height = 26 } = {}) {
        const obj = new THREE.Group();
        const body = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.12, 0.9, 8), new THREE.MeshBasicMaterial({ color: 0x22262a }));
        const nose = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.3, 8), body.material); nose.position.y = -0.6; nose.rotation.x = Math.PI;
        const fins = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.18, 0.04), body.material); fins.position.y = 0.42;
        const fins2 = fins.clone(); fins2.rotation.y = Math.PI / 2;
        const trail = new THREE.Mesh(this.tracerGeo, new THREE.MeshBasicMaterial({ color: 0xffb35a, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
        trail.scale.set(0.1, 5, 0.1); trail.position.y = 3;
        obj.add(body, nose, fins, fins2, trail); obj.visible = false;
        this.group.add(obj);
        return new Promise(resolve => this.items.push({ obj, kind: 'bomb', at: w2t(at), height, fall, wait: delay, t: 0, resolve }));
    }
    stepBomb(it, dt) {
        if (it.wait > 0) { it.wait -= dt; if (it.wait > 0) return true; dt = -it.wait; it.wait = 0; }
        it.obj.visible = true; it.t += dt;
        const k = Math.min(1, it.t / it.fall);
        it.obj.position.copy(it.at).add(new THREE.Vector3(0, it.height * (1 - k * k), 0));
        if (k >= 1) { this.group.remove(it.obj); it.obj.traverse(o => { if (o.geometry && o.geometry !== this.tracerGeo) o.geometry.dispose(); }); it.resolve(); return false; }
        return true;
    }
    stepTracer(it, dt) {
        if (it.wait > 0) { it.wait -= dt; if (it.wait > 0) return true; dt = -it.wait; }
        it.obj.visible = true;
        it.head += it.speed * dt;
        if (!it.arrived && it.head >= it.dist) { it.arrived = true; it.onArrive?.(); }
        const tail = Math.max(0, it.head - it.length), head = Math.min(it.head, it.dist);
        if (tail >= it.dist) { this.group.remove(it.obj); for (const c of it.obj.children) c.material.dispose(); return false; }
        const len = Math.max(0.01, head - tail), mid = (head + tail) / 2;
        it.obj.position.copy(it.a).lerp(it.b, mid / Math.max(it.dist, 1e-6));
        for (const c of it.obj.children) c.scale.y = len;
        return true;
    }
    update(dt) {
        const t = performance.now() / 1000;
        for (const c of this.fireGroup.children) if (c.material === this.fireMat) c.scale.y = 0.8 + Math.sin(t * 9 + c.position.x * 3) * 0.25;
        this.items = this.items.filter(it => {
            if (it.kind === 'tracer') return this.stepTracer(it, dt);
            if (it.kind === 'bomb') return this.stepBomb(it, dt);
            if (it.kind === 'spark') { it.v.y -= 9 * dt; it.obj.position.addScaledVector(it.v, dt); it.obj.lookAt(it.obj.position.clone().add(it.v)); }
            it.life -= dt;
            const k = Math.max(0, it.life / it.max);
            if (it.grow) it.obj.scale.setScalar(Math.max(0.2, it.grow * (1 - k)));
            if (it.obj.material) { it.obj.material.transparent = true; it.obj.material.opacity = Math.min(1, k * 1.4); }
            if (it.life <= 0) { this.group.remove(it.obj); if (![this.puffGeo, this.sparkGeo].includes(it.obj.geometry)) it.obj.geometry?.dispose(); it.obj.material?.dispose(); return false; }
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
