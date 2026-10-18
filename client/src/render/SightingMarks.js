// PLAN-11: where enemies were seen. XCOM-style contact feedback, presentation only (never changes battle state).
//
//  - Spotted: when a hostile comes into the squad's view, a red "!" and an expanding ring flash on its tile for a moment.
//  - Last seen: when a hostile drops out of view, a red "?" ghost marker stays where it was last seen, labelled with how
//    many rounds ago, until it is seen again, dies, or the lead is three rounds old.
// Markers above the current storey cut are hidden, like units.
import * as THREE from 'three';

const RED = 0xff5a4a, FLASH = 2.4, MAX_AGE = 3;
const signTexture = (text, color = '#ff5a4a') => {
    const c = document.createElement('canvas'); c.width = 128; c.height = 128;
    const g = c.getContext('2d');
    g.beginPath(); g.arc(64, 64, 52, 0, Math.PI * 2); g.fillStyle = 'rgba(10,12,16,0.78)'; g.fill();
    g.lineWidth = 8; g.strokeStyle = color; g.stroke();
    g.font = 'bold 76px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = color; g.fillText(text, 64, 68);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
};
const labelTexture = text => {
    const c = document.createElement('canvas'); c.width = 256; c.height = 64;
    const g = c.getContext('2d'); g.font = '600 30px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillStyle = 'rgba(10,12,16,0.7)'; g.fillRect(28, 10, 200, 44); g.fillStyle = '#ffb3aa'; g.fillText(text, 128, 33);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
};

export class SightingMarks {
    constructor(scene) {
        this.scene = scene; this.group = new THREE.Group(); this.group.renderOrder = 30; scene.scene.add(this.group);
        this.seen = new Map();       // enemy id → { x, y, z, round }
        this.visible = new Set();    // enemy ids visible at the last check
        this.flashes = [];           // { group, t }
        this.ghosts = new Map();     // enemy id → { group, key }
        this.key = null; this.textures = { bang: signTexture('!'), ask: signTexture('?') };
        this.ringGeo = new THREE.RingGeometry(0.36, 0.46, 40); this.ringGeo.rotateX(-Math.PI / 2);
    }
    clear() {
        for (const f of this.flashes) this.dispose(f.group);
        for (const g of this.ghosts.values()) this.dispose(g.group);
        this.flashes = []; this.ghosts.clear(); this.seen.clear(); this.visible.clear(); this.key = null;
    }
    dispose(group) { this.group.remove(group); group.traverse(o => { if (o.material) { if (o.material.map && !Object.values(this.textures).includes(o.material.map)) o.material.map.dispose(); o.material.dispose(); } }); }
    sign(tex, scale = 0.62) { const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, toneMapped: false })); s.scale.set(scale, scale, 1); s.renderOrder = 31; return s; }
    ring(opacity = 0.9) { const m = new THREE.Mesh(this.ringGeo, new THREE.MeshBasicMaterial({ color: RED, transparent: true, opacity, depthTest: false, depthWrite: false, toneMapped: false, side: THREE.DoubleSide })); m.renderOrder = 30; return m; }
    /** @param game the running Game (battle, isVisible, cutLevel); @param time seconds; @param dt frame time */
    update(game, time, dt) {
        const b = game.battle;
        if (!b) { this.group.visible = false; return; }
        this.group.visible = true;
        const key = `${b.seq}:${game.visualInterior?.size ?? 0}:${b.round}`;
        if (key !== this.key) { this.key = key; this.refresh(game); }
        // The shoulder / cut-in cameras look at the target itself: markers would only cover it there.
        if (game.cameraDirector?.active) { this.group.visible = false; return; }
        const cut = game.cutLevel ?? Infinity;
        for (let i = this.flashes.length - 1; i >= 0; i--) {
            const f = this.flashes[i]; f.t += dt;
            const k = f.t / FLASH;
            if (k >= 1) { this.dispose(f.group); this.flashes.splice(i, 1); continue; }
            f.ring.scale.setScalar(1 + k * 2.2); f.ring.material.opacity = 0.9 * (1 - k);
            f.sign.material.opacity = k < 0.75 ? 1 : (1 - k) / 0.25;
            f.sign.position.y = 2.6 + Math.min(1, k * 4) * 0.25;
            f.group.visible = f.z < cut;
        }
        for (const g of this.ghosts.values()) {
            g.group.visible = g.z < cut;
            g.sign.position.y = 1.15 + Math.sin(time * 2.4) * 0.05;
            g.ring.material.opacity = 0.45 + Math.sin(time * 3) * 0.15;
        }
    }
    refresh(game) {
        const b = game.battle, now = new Set();
        for (const e of b.units) {
            if (e.side === 'player' || e.extracted) continue;
            if (e.dead || e.hp <= 0) { this.drop(e.id); this.seen.delete(e.id); continue; }
            if (!game.isVisible(e)) continue;
            now.add(e.id);
            if (!this.visible.has(e.id)) this.flash(e);               // just spotted
            this.seen.set(e.id, { x: e.x, y: e.y, z: e.z, round: b.round });
            this.drop(e.id);
        }
        for (const [id, s] of this.seen) {
            if (now.has(id)) continue;
            if (b.round - s.round >= MAX_AGE) { this.drop(id); this.seen.delete(id); continue; }
            this.ghost(id, s, b.round - s.round);
        }
        this.visible = now;
    }
    flash(e) {
        const group = new THREE.Group(), ring = this.ring(), sign = this.sign(this.textures.bang, 0.7);
        ring.position.y = 0.06; group.add(ring, sign); group.position.set(e.x + 0.5, e.z + 1, e.y + 0.5);
        this.group.add(group); this.flashes.push({ group, ring, sign, t: 0, z: e.z });
    }
    ghost(id, s, age) {
        const key = `${s.x},${s.y},${s.z}:${age}`, old = this.ghosts.get(id);
        if (old?.key === key) return;
        if (old) this.dispose(old.group);
        const group = new THREE.Group(), ring = this.ring(0.5), sign = this.sign(this.textures.ask, 0.5);
        const label = this.sign(labelTexture(age ? `last seen ${age} rd ago` : 'last seen'), 1); label.scale.set(1.1, 0.28, 1); label.position.y = 0.72;
        ring.position.y = 0.06; group.add(ring, sign, label); group.position.set(s.x + 0.5, s.z + 1, s.y + 0.5);
        this.group.add(group); this.ghosts.set(id, { group, ring, sign, key, z: s.z });
    }
    drop(id) { const g = this.ghosts.get(id); if (g) { this.dispose(g.group); this.ghosts.delete(id); } }
}
