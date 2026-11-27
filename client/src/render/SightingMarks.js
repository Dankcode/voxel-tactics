// PLAN-11: where enemies were seen. XCOM-style contact feedback, presentation only (never changes battle state).
//
//  - Spotted: when a hostile comes into the squad's view, a red "!" and an expanding ring flash on its tile for a moment.
//  - Last seen: when a hostile drops out of view, a red "?" ghost marker stays where it was last seen, labelled with how
//    many rounds ago, until it is seen again, dies, or the lead is three rounds old.
// Markers above the current storey cut are hidden, like units.
import * as THREE from 'three';

const RED = 0xff5a4a, FLASH = 2.4, MAX_AGE = 3;
const UI_FONT = '"Inter", "Segoe UI", system-ui, sans-serif';
const hash2 = (x, y, seed = 0) => {
    let n = (Math.imul(x + 37, 374761393) + Math.imul(y + 91, 668265263) + Math.imul(seed + 13, 1442695041)) | 0;
    n = (n ^ (n >>> 13)) | 0;
    n = Math.imul(n, 1274126177);
    return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
};
const noisyOutlineTexture = (seed = 0) => {
    if (typeof document === 'undefined') {
        const t = new THREE.DataTexture(new Uint8Array([255, 70, 64, 210, 255, 255, 255, 210]), 2, 1, THREE.RGBAFormat);
        t.needsUpdate = true;
        return t;
    }
    const SIZE = 128, GRID = 36, STEP = SIZE / GRID, HALF = GRID / 2;
    const raw = document.createElement('canvas'); raw.width = SIZE; raw.height = SIZE;
    const rctx = raw.getContext('2d');
    for (let gy = 0; gy < GRID; gy++) {
        for (let gx = 0; gx < GRID; gx++) {
            const nx = (gx + 0.5 - HALF) / (HALF * 0.88);
            const ny = (gy + 0.5 - HALF) / (HALF * 0.88);
            const d = Math.hypot(nx, ny);
            const angNoise = (hash2(gx >> 1, gy >> 1, seed + 5) - 0.5) * 0.14;
            const ringDist = Math.abs(d - (0.8 + angNoise));
            const h = hash2(gx, gy, seed);
            const inEdge = d >= 0.66 && d <= 0.98 && ringDist < 0.15;
            const stray = d >= 0.54 && d <= 1.04 && h > 0.86;
            if (!inEdge && !stray) continue;
            if (inEdge && h < 0.24) continue;
            const white = hash2(gx * 3 + 1, gy * 5 + 2, seed + 17) > 0.52;
            const alpha = inEdge ? (0.58 + 0.36 * hash2(gx, gy, seed + 29)) : (0.28 + 0.35 * hash2(gx, gy, seed + 41));
            rctx.fillStyle = white ? `rgba(255,255,255,${alpha.toFixed(2)})` : `rgba(255,70,64,${alpha.toFixed(2)})`;
            rctx.fillRect(Math.floor(gx * STEP), Math.floor(gy * STEP), Math.ceil(STEP), Math.ceil(STEP));
        }
    }
    const out = document.createElement('canvas'); out.width = SIZE; out.height = SIZE;
    const ctx = out.getContext('2d');
    ctx.save();
    ctx.filter = 'blur(2.5px)';
    ctx.drawImage(raw, 0, 0);
    ctx.restore();
    ctx.save();
    ctx.globalAlpha = 0.5;
    ctx.filter = 'blur(1px)';
    ctx.drawImage(raw, 0, 0);
    ctx.restore();
    const t = new THREE.CanvasTexture(out);
    t.colorSpace = THREE.SRGBColorSpace;
    t.minFilter = THREE.LinearFilter;
    t.magFilter = THREE.LinearFilter;
    return t;
};
const signTexture = (text, color = '#ff5a4a') => {
    if (typeof document === 'undefined') {
        const t = new THREE.DataTexture(new Uint8Array([255, 90, 74, 220]), 1, 1, THREE.RGBAFormat);
        t.needsUpdate = true; return t;
    }
    const c = document.createElement('canvas'); c.width = 128; c.height = 128;
    const g = c.getContext('2d');
    g.fillStyle = 'rgba(10,12,16,0.78)'; g.fillRect(22, 22, 84, 84);
    for (let i = 0; i < 16; i++) {
        const x = 16 + ((i * 23) % 92), y = i < 8 ? 16 : 104;
        g.fillStyle = i % 2 ? '#ffffffcc' : '#ff4640cc'; g.fillRect(x, y, 6, 6);
    }
    g.font = `bold 72px ${UI_FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = color; g.fillText(text, 64, 67);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
};
const labelTexture = text => {
    if (typeof document === 'undefined') {
        const t = new THREE.DataTexture(new Uint8Array([255, 180, 174, 220]), 1, 1, THREE.RGBAFormat);
        t.needsUpdate = true; return t;
    }
    const c = document.createElement('canvas'); c.width = 256; c.height = 64;
    const g = c.getContext('2d'); g.font = `700 28px ${UI_FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillStyle = 'rgba(10,12,16,0.78)'; g.fillRect(24, 10, 208, 44); g.fillStyle = '#ffd0ca'; g.fillText(text, 128, 33);
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
        this.noiseTextures = [noisyOutlineTexture(0), noisyOutlineTexture(1)];
        this.outlineGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    }
    clear() {
        for (const f of this.flashes) this.dispose(f.group);
        for (const g of this.ghosts.values()) this.dispose(g.group);
        this.flashes = []; this.ghosts.clear(); this.seen.clear(); this.visible.clear(); this.key = null; this.clearScan?.();
    }
    dispose(group) { this.group.remove(group); group.traverse(o => { if (o.material) { if (o.material.map && !Object.values(this.textures).includes(o.material.map) && !this.noiseTextures.includes(o.material.map)) o.material.map.dispose(); o.material.dispose(); } }); }
    sign(tex, scale = 0.62) { const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, toneMapped: false })); s.scale.set(scale, scale, 1); s.renderOrder = 31; return s; }
    ring(opacity = 0.9, radius = 0.55) {
        const size = radius * 2.15;
        const m = new THREE.Mesh(this.outlineGeo, new THREE.MeshBasicMaterial({ map: this.noiseTextures[0], transparent: true, opacity, depthTest: false, depthWrite: false, toneMapped: false, side: THREE.DoubleSide }));
        m.scale.set(size, 1, size);
        m.renderOrder = 30;
        m.userData.noisyOutline = true;
        return m;
    }
    /** @param game the running Game (battle, isVisible, cutLevel); @param time seconds; @param dt frame time */
    update(game, time, dt) {
        const b = game.battle;
        if (!b) { this.group.visible = false; return; }
        this.group.visible = true;
        const key = `${b.seq}:${game.visualInterior?.size ?? 0}:${b.round}`;
        if (key !== this.key) { this.key = key; this.refresh(game); }
        this.stepScan(game, time);
        // Hide sighting markers during full action cut-ins, but keep them visible during live prepare aiming.
        if (game.cameraDirector?.active && game.cameraDirector.phase !== 'prepare') { this.group.visible = false; return; }
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
    /**
     * PLAN-14 Recon Scan: a red search circle (the contact is somewhere inside it, not at its centre) on each contact's
     * floor, with a "CONTACT" tag; drones get a "DRONE" tag. They stay until the round the scan expires.
     */
    showScan(e) {
        this.clearScan();
        this.scan = { until: e.until, groups: [] };
        for (let idx = 0; idx < e.contacts.length; idx++) {
            const c = e.contacts[idx];
            const group = new THREE.Group();
            const size = c.r * 2.15;
            const edge = new THREE.Mesh(
                this.outlineGeo,
                new THREE.MeshBasicMaterial({
                    map: this.noiseTextures[idx % 2],
                    transparent: true,
                    opacity: 0.78,
                    depthTest: false,
                    depthWrite: false,
                    toneMapped: false,
                    side: THREE.DoubleSide
                })
            );
            edge.scale.set(size, 1, size);
            edge.renderOrder = 29;
            edge.position.y = 0.06;
            edge.userData.noisyOutline = true;
            const label = this.sign(labelTexture(c.drone ? 'DRONE?' : 'CONTACT?'), 1); label.scale.set(1.3, 0.33, 1); label.position.y = 0.9;
            group.add(edge, label); group.position.set(c.x + 0.5, c.z + 1, c.y + 0.5);
            this.group.add(group); this.scan.groups.push({ group, edge, z: c.z, t: 0, idx });
            group.userData.floorLabel = c.z;
        }
    }
    clearScan() { for (const g of this.scan?.groups || []) this.dispose(g.group); this.scan = null; }
    /** Called from update(): shimmer the noisy pixel outline, keep synced to floor cut. */
    stepScan(game, time) {
        if (!this.scan) return;
        if (game.battle.round > this.scan.until) { this.clearScan(); return; }
        const cut = game.cutLevel ?? Infinity;
        const phase = Math.floor(time * 4) % 2;
        // A contact above the storey cut is still shown, on the cut plane, so the player knows to look up there.
        for (const g of this.scan.groups) {
            g.group.position.y = g.z < cut ? g.z + 1 : cut + 0.05;
            g.edge.material.opacity = 0.58 + 0.24 * Math.sin(time * 4.5 + g.idx);
            const nextTex = this.noiseTextures[(phase + g.idx) % 2];
            if (g.edge.material.map !== nextTex) { g.edge.material.map = nextTex; g.edge.material.needsUpdate = true; }
        }
    }
}
