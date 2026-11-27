// Transient effects: tracers, muzzle flashes, explosions, destruction debris, defeat bursts,
// fire and smoke on the element field, and floating combat text (DOM).
import * as THREE from 'three';
import { ELEMENT_COLORS } from '../../../shared/elements/Elements.js';

const w2t = p => new THREE.Vector3(p.x, p.h, p.y);   // world {x,y,h} → three
export const TRACER_SPEED = 310, TRACER_LENGTH = 5.2, BURST_GAP = 0.055;

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
        this.sparkGeo = new THREE.BoxGeometry(0.03, 0.03, 0.12);
        this.debrisGeo = new THREE.BoxGeometry(0.12, 0.12, 0.12);
        this.dustGeo = new THREE.SphereGeometry(0.32, 8, 6);
        this.smokeGeo = new THREE.SphereGeometry(0.55, 8, 6);
        this.explosionCoreGeo = new THREE.SphereGeometry(1, 10, 8);
        this.explosionRingGeo = new THREE.RingGeometry(0.78, 1, 28);
        this.flashGeo = new THREE.SphereGeometry(1, 8, 6);
        this.calloutRingGeo = new THREE.RingGeometry(0.42, 0.56, 24);
        this.defeatRingGeo = new THREE.RingGeometry(0.32, 0.43, 24);
        this.bombBodyGeo = new THREE.CylinderGeometry(0.16, 0.12, 0.9, 8);
        this.bombNoseGeo = new THREE.ConeGeometry(0.16, 0.3, 8);
        this.bombFinGeo = new THREE.BoxGeometry(0.5, 0.18, 0.04);
        this.sharedGeos = new Set([
            this.fireGeo, this.tracerGeo, this.sparkGeo, this.debrisGeo, this.dustGeo, this.smokeGeo,
            this.explosionCoreGeo, this.explosionRingGeo, this.flashGeo, this.calloutRingGeo, this.defeatRingGeo,
            this.bombBodyGeo, this.bombNoseGeo, this.bombFinGeo
        ]);
        // Fixed PointLight pool: attach directly to scene.scene so NUM_POINT_LIGHTS stays constant while fx.group stays clean.
        const lightParent = scene?.scene || this.group;
        this.lightPool = Array.from({ length: 3 }, () => {
            const l = new THREE.PointLight(0xffffff, 0, 1, 2);
            l.castShadow = false;
            lightParent.add(l);
            return { light: l, busy: false, seq: 0 };
        });
        this._lightSeq = 0;
        this.floats = [];
    }
    acquireLight(color, intensity, distance, pos) {
        let slot = this.lightPool.find(s => !s.busy);
        if (!slot) slot = this.lightPool.reduce((a, b) => (a.seq < b.seq ? a : b));
        slot.busy = true;
        slot.seq = ++this._lightSeq;
        slot.light.color.set(color);
        slot.light.intensity = intensity;
        slot.light.distance = distance;
        if (pos) slot.light.position.copy(pos);
        return slot;
    }
    releaseLight(slot) {
        if (!slot) return;
        slot.busy = false;
        slot.light.intensity = 0;
    }
    /**
     * PLAN-07 tracer: a glowing streak (bright core + soft halo, additive) that travels from the muzzle at `speed`
     * tiles/s and fades its tail out after it lands. `delay` staggers burst rounds. `onArrive` fires at the impact
     * (sparks). Returns the item so callers/tests can follow it.
     */
    tracer(from, to, color = 0xfff0b0, { speed = TRACER_SPEED, length = TRACER_LENGTH, delay = 0, light = false, onArrive = null, arc = null } = {}) {
        const a = w2t(from), b = w2t(to);
        const pts = Array.isArray(arc) && arc.length >= 2 ? arc.map(w2t) : [a, b];
        const cum = [0];
        for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + pts[i - 1].distanceTo(pts[i]));
        const dist = cum[cum.length - 1] || a.distanceTo(b);
        const obj = new THREE.Group();
        const core = new THREE.Mesh(this.tracerGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
        const halo = new THREE.Mesh(this.tracerGeo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
        core.scale.set(0.018, 1, 0.018); halo.scale.set(0.055, 1, 0.055);
        obj.add(halo, core);
        const lightSlot = light ? this.acquireLight(color, 3.2, 4.5, a) : null;
        obj.visible = false;
        obj.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), pts[1].clone().sub(pts[0]).normalize());
        this.group.add(obj);
        const it = { obj, kind: 'tracer', a, b, pts, cum, dist, speed, length, wait: delay, head: 0, onArrive, arrived: false, life: 1, max: 1, lightSlot };
        this.items.push(it);
        return it;
    }
    /** Short material-colored fragments at the projectile contact point. */
    impact(at, family = 'stone') {
        const col = family === 'metal' ? 0xffd27a : family === 'unit' ? 0xdb6254 : family === 'wood' ? 0xc49b6c : 0xc4beb4;
        const p = w2t(at);
        const n = family === 'metal' ? 4 : 3;
        for (let i = 0; i < n; i++) {
            const v = new THREE.Vector3(Math.cos(i * 2.4) * 2.2, 1.4 + (i % 2), Math.sin(i * 2.4) * 2.2);
            const s = new THREE.Mesh(this.sparkGeo, new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
            s.scale.setScalar(family === 'unit' ? 1.8 : 1.4);
            s.position.copy(p); this.group.add(s);
            this.items.push({ obj: s, life: 0.22, max: 0.22, kind: 'spark', v });
        }
    }
    debris(at, material) {
        let activeDebris = 0, activeDust = 0;
        for (const it of this.items) {
            if (it.kind === 'debris') activeDebris++;
            else if (it.kind === 'dust') activeDust++;
        }
        const p = w2t(at), color = new THREE.Color(material.color);
        if (activeDebris < 48) {
            for (let i = 0; i < 5; i++) {
                const a = i * 2.4 + (at.x + at.y) * 0.37;
                const v = new THREE.Vector3(Math.cos(a) * (1.4 + i * 0.12), 1.8 + (i % 3) * 0.45, Math.sin(a) * (1.4 + i * 0.12));
                const chip = new THREE.Mesh(this.debrisGeo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 1, clippingPlanes: this.scene.clipping }));
                chip.scale.setScalar(0.65 + (i % 3) * 0.22); chip.position.copy(p); this.group.add(chip);
                this.items.push({ obj: chip, life: 0.65 + i * 0.025, max: 0.65 + i * 0.025, kind: 'debris', v });
            }
        }
        if (activeDust < 14) {
            const dustColor = color.clone().lerp(new THREE.Color(0xd8d2c4), 0.45);
            const dust = new THREE.Mesh(this.dustGeo, new THREE.MeshBasicMaterial({ color: dustColor, transparent: true, opacity: 0.38, depthWrite: false, clippingPlanes: this.scene.clipping }));
            dust.position.copy(p); dust.scale.setScalar(0.3); this.group.add(dust);
            this.items.push({ obj: dust, life: 0.75, max: 0.75, kind: 'dust', grow: 1.8 });
        }
    }
    defeat(at, drone = false) {
        const color = drone ? 0x80d8ff : 0xff6b5f;
        const ring = new THREE.Mesh(this.defeatRingGeo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }));
        ring.rotation.x = -Math.PI / 2; ring.position.copy(at).add(new THREE.Vector3(0, 0.08, 0)); this.group.add(ring);
        this.items.push({ obj: ring, life: 0.5, max: 0.5, kind: 'fade', grow: 2.2 });
        const p = at.clone().add(new THREE.Vector3(0, 0.9, 0));
        for (let i = 0; i < 6; i++) {
            const a = i * Math.PI / 3, v = new THREE.Vector3(Math.cos(a) * 2.2, 1.2 + (i % 2) * 0.8, Math.sin(a) * 2.2);
            const spark = new THREE.Mesh(this.sparkGeo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
            spark.position.copy(p); this.group.add(spark);
            this.items.push({ obj: spark, life: 0.5, max: 0.5, kind: 'spark', v });
        }
    }
    calloutRing(at, color = 0xff5a4a, life = 0.42) {
        const ring = new THREE.Mesh(
            this.calloutRingGeo,
            new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, depthTest: false, depthWrite: false, side: THREE.DoubleSide, toneMapped: false })
        );
        ring.rotation.x = -Math.PI / 2;
        ring.renderOrder = 25;
        ring.position.copy(at?.isVector3 ? at : w2t(at)).add(new THREE.Vector3(0, 0.08, 0));
        this.group.add(ring);
        this.items.push({ obj: ring, life, max: life, kind: 'fade', grow: 1.9, baseOpacity: 0.9 });
        return ring;
    }
    shotLine(from, to, color = 0xff6a4a, life = 0.28) {
        const line = new THREE.Line(
            new THREE.BufferGeometry().setFromPoints([w2t(from), w2t(to)]),
            new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.55, depthWrite: false, toneMapped: false })
        );
        line.renderOrder = 22;
        this.group.add(line);
        this.items.push({ obj: line, life, max: life, kind: 'fade', grow: 0, baseOpacity: 0.55 });
        return line;
    }
    flash(at, color = 0xffe08a, size = 0.35, life = 0.12) {
        const m = new THREE.Mesh(this.flashGeo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, depthWrite: false }));
        m.scale.setScalar(size);
        m.position.copy(w2t(at)); this.group.add(m);
        this.items.push({ obj: m, life, max: life, kind: 'fade', grow: 0 });
    }
    explosion(at, radius, element) {
        const color = new THREE.Color(ELEMENT_COLORS[element] || '#ffb347'), obj = new THREE.Group();
        const core = new THREE.Mesh(this.explosionCoreGeo, new THREE.MeshBasicMaterial({ color: 0xffd18a, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
        const shockwave = new THREE.Mesh(this.explosionRingGeo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.65, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }));
        shockwave.rotation.x = -Math.PI / 2;
        obj.add(core, shockwave); obj.position.copy(w2t(at)); this.group.add(obj);
        const intensity = 18 + radius * 3;
        const lightSlot = this.acquireLight(color, intensity, radius * 4, obj.position);
        this.items.push({ obj, core, shockwave, light: lightSlot.light, lightSlot, life: 0.55, max: 0.55, kind: 'explosion', radius, intensity });
        this.scene.shake = Math.max(this.scene.shake, 0.25 + radius * 0.08);
    }
    float(pos, text, color = '#fff', size = 18) {
        const label = String(text ?? '').trim();
        if (!label || !this.floatRoot) return;
        const pxSize = Math.max(12, Math.min(22, Number(size) || 16));
        const spawnPos = pos.clone().add(new THREE.Vector3(0, 2.2, 0));
        const nearby = this.floats.filter(f => f.t < 0.55 && f.pos.distanceTo(spawnPos) < 1.5).length;
        spawnPos.y += nearby * 0.46;
        const el = document.createElement('div');
        el.className = 'float'; el.textContent = label; el.style.color = color; el.style.fontSize = `${pxSize}px`;
        this.floatRoot.appendChild(el);
        this.floats.push({ el, pos: spawnPos, t: 0 });
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
        const bodyMat = new THREE.MeshBasicMaterial({ color: 0x22262a });
        const body = new THREE.Mesh(this.bombBodyGeo, bodyMat);
        const nose = new THREE.Mesh(this.bombNoseGeo, bodyMat); nose.position.y = -0.6; nose.rotation.x = Math.PI;
        const fins = new THREE.Mesh(this.bombFinGeo, bodyMat); fins.position.y = 0.42;
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
        if (k >= 1) {
            this.group.remove(it.obj);
            const mats = new Set();
            it.obj.traverse(o => {
                if (o.geometry && !this.sharedGeos.has(o.geometry)) o.geometry.dispose();
                if (o.material) mats.add(o.material);
            });
            for (const m of mats) m.dispose();
            it.resolve(); return false;
        }
        return true;
    }
    stepTracer(it, dt) {
        if (it.wait > 0) { it.wait -= dt; if (it.wait > 0) return true; dt = -it.wait; }
        it.obj.visible = true;
        it.head += it.speed * dt;
        if (!it.arrived && it.head >= it.dist) { it.arrived = true; it.head = it.dist; it.onArrive?.(); }
        const tail = Math.max(0, it.head - it.length), head = Math.min(it.head, it.dist);
        if (tail >= it.dist) { this.group.remove(it.obj); this.releaseLight(it.lightSlot); for (const c of it.obj.children) c.material?.dispose(); return false; }
        const len = Math.max(0.01, head - tail), mid = (head + tail) / 2;
        if (it.pts && it.cum && it.pts.length > 2) {
            let si = 1;
            while (si < it.cum.length - 1 && it.cum[si] < mid) si++;
            const d0 = it.cum[si - 1], d1 = it.cum[si], k = d1 > d0 ? (mid - d0) / (d1 - d0) : 0;
            it.obj.position.copy(it.pts[si - 1]).lerp(it.pts[si], k);
            const segDir = it.pts[si].clone().sub(it.pts[si - 1]);
            if (segDir.lengthSq() > 1e-8) it.obj.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), segDir.normalize());
        } else {
            it.obj.position.copy(it.a).lerp(it.b, mid / Math.max(it.dist, 1e-6));
        }
        if (it.lightSlot) it.lightSlot.light.position.copy(it.obj.position);
        for (const c of it.obj.children) if (c.isMesh) c.scale.y = len;
        return true;
    }
    update(dt) {
        const t = performance.now() / 1000;
        for (const c of this.fireGroup.children) if (c.material === this.fireMat) c.scale.y = 0.8 + Math.sin(t * 9 + c.position.x * 3) * 0.25;
        const active = this.items;
        this.items = []; // Arrival callbacks can enqueue new effects during this pass.
        const survivors = active.filter(it => {
            if (it.kind === 'tracer') return this.stepTracer(it, dt);
            if (it.kind === 'bomb') return this.stepBomb(it, dt);
            if (it.kind === 'explosion') {
                it.life -= dt;
                const k = Math.max(0, it.life / it.max), age = 1 - k;
                it.core.scale.setScalar(0.2 + it.radius * 0.7 * Math.min(1, age * 4));
                it.core.material.opacity = k * k * 0.95;
                it.shockwave.scale.setScalar(0.4 + it.radius * 1.4 * age);
                it.shockwave.material.opacity = k * 0.65;
                if (it.lightSlot) it.lightSlot.light.intensity = it.intensity * k * k;
                if (it.life <= 0) { this.group.remove(it.obj); this.releaseLight(it.lightSlot); it.obj.traverse(o => { if (o.geometry && !this.sharedGeos.has(o.geometry)) o.geometry.dispose(); o.material?.dispose(); }); return false; }
                return true;
            }
            if (it.kind === 'spark' || it.kind === 'debris') {
                it.v.y -= (it.kind === 'debris' ? 12 : 9) * dt; it.obj.position.addScaledVector(it.v, dt);
                if (it.kind === 'spark') it.obj.lookAt(it.obj.position.clone().add(it.v));
                else { it.obj.rotation.x += dt * 8; it.obj.rotation.z += dt * 6; }
            }
            if (it.kind === 'dust') it.obj.position.y += dt * 0.3;
            it.life -= dt;
            const k = Math.max(0, it.life / it.max);
            if (it.grow) it.obj.scale.setScalar(Math.max(0.2, it.grow * (1 - k)));
            if (it.obj.material) {
                it.obj.material.transparent = true;
                const baseOp = it.baseOpacity ?? (it.kind === 'dust' ? 0.38 : 1);
                it.obj.material.opacity = baseOp * Math.min(1, k * 1.4);
            }
            if (it.life <= 0) { this.group.remove(it.obj); if (it.obj.geometry && !this.sharedGeos.has(it.obj.geometry)) it.obj.geometry.dispose(); it.obj.material?.dispose(); return false; }
            return true;
        });
        this.items.push(...survivors);
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
