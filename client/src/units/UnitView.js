// A 2D character standing in the voxel world: a camera-facing quad (depth-tested against voxels),
// a ground ring, an HP/AP bar, and a SpriteAnimator driving the placeholder atlas.
import * as THREE from 'three';
import { dropAt } from '../render/Ground.js';
import { SpriteAnimator } from '../anim/SpriteAnimator.js';
import { FACING_VEC } from '../../../shared/battle/Units.js';

const loader = new THREE.TextureLoader();
const atlasCache = new Map();
export async function loadCharacterArt(art) {
    if (atlasCache.has(art)) return atlasCache.get(art);
    const p = (async () => {
        const base = `/assets/characters/${art}/`;
        const [field, cutin] = await Promise.all([fetch(base + 'field.json').then(r => r.json()), fetch(base + 'cutin.json').then(r => r.json())]);
        const image = await new Promise((res, rej) => loader.load(base + field.image, res, undefined, rej));
        image.colorSpace = THREE.SRGBColorSpace;
        image.magFilter = THREE.LinearFilter; image.minFilter = THREE.LinearMipmapLinearFilter; image.generateMipmaps = true; image.anisotropy = 4;
        return { field, cutin, image, base };
    })();
    atlasCache.set(art, p);
    return p;
}

export class UnitView {
    constructor(scene, unit, art) {
        this.scene = scene; this.unit = unit; this.id = unit.id; this.art = unit.art;
        this.group = new THREE.Group();
        const m = art.field;
        const h = m.worldHeight, w = h * m.frameWidth / m.frameHeight;
        const geo = new THREE.PlaneGeometry(w, h);
        geo.translate(0, h / 2 - m.anchor[1] * h, 0);
        this.texture = art.image.clone();
        this.texture.needsUpdate = true;
        this.material = new THREE.MeshBasicMaterial({ map: this.texture, transparent: true, alphaTest: 0.35, side: THREE.DoubleSide, clippingPlanes: scene.clipping });
        this.sprite = new THREE.Mesh(geo, this.material);
        this.sprite.userData.unitId = unit.id;
        // The billboard casts a sun shadow through its alpha (same animated texture as the colour pass).
        this.sprite.castShadow = true;
        this.sprite.customDepthMaterial = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: this.texture, alphaTest: 0.5, side: THREE.DoubleSide });
        this.group.add(this.sprite);
        this.blob = new THREE.Mesh(new THREE.CircleGeometry(0.42, 24), new THREE.MeshBasicMaterial({ map: blobTexture(), transparent: true, depthWrite: false, opacity: 0.55, clippingPlanes: scene.clipping }));
        this.blob.rotation.x = -Math.PI / 2; this.blob.position.y = 0.02;
        this.group.add(this.blob);
        const ringColor = unit.side === 'player' ? 0x4fd3ff : 0xff5a4a;
        this.ring = new THREE.Mesh(new THREE.RingGeometry(0.36, 0.42, 32), new THREE.MeshBasicMaterial({ color: ringColor, transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false, clippingPlanes: scene.clipping, toneMapped: false }));
        this.ring.rotation.x = -Math.PI / 2; this.ring.position.y = 0.03;
        this.group.add(this.ring);
        this.selRing = new THREE.Mesh(new THREE.RingGeometry(0.47, 0.55, 40), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.95, side: THREE.DoubleSide, depthWrite: false, toneMapped: false }));
        this.selRing.rotation.x = -Math.PI / 2; this.selRing.position.y = 0.04; this.selRing.visible = false;
        this.group.add(this.selRing);
        this.barCanvas = document.createElement('canvas'); this.barCanvas.width = 128; this.barCanvas.height = 26;
        this.barTex = new THREE.CanvasTexture(this.barCanvas);
        this.barTex.colorSpace = THREE.SRGBColorSpace;
        this.bar = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.barTex, depthTest: false, transparent: true, toneMapped: false }));
        this.bar.scale.set(1.15, 0.234, 1); this.bar.position.y = h + 0.25; this.bar.renderOrder = 10;
        this.group.add(this.bar);
        // Height cue (PLAN 22 D7): a drop line and a ring on the ground below a unit standing on a roof or an upper
        // floor, so its elevation reads at a glance.
        const lineMat = new THREE.LineDashedMaterial({ color: unit.side === 'player' ? 0x4fd3ff : 0xff5a4a, dashSize: 0.18, gapSize: 0.12, transparent: true, opacity: 0.85, depthTest: false, toneMapped: false });
        this.dropLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, -1, 0)]), lineMat);
        this.dropRing = new THREE.Mesh(new THREE.RingGeometry(0.22, 0.3, 24).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: lineMat.color, transparent: true, opacity: 0.8, depthTest: false, side: THREE.DoubleSide, toneMapped: false }));
        this.dropLine.renderOrder = this.dropRing.renderOrder = 9;
        this.dropLine.visible = this.dropRing.visible = false;
        this.group.add(this.dropLine, this.dropRing);
        this.dropHeight = 0;
        this.animator = new SpriteAnimator(m, this.texture, this);
        this.pos = new THREE.Vector3();
        this.facingVec = [...(FACING_VEC[unit.facing] || [0, 1])];
        this.snap();
        this.drawBar();
        scene.scene.add(this.group);
    }
    /** Visual position from the battle state (used after animations settle). */
    snap() { this.setCell(this.unit.x, this.unit.y, this.unit.z); this.facingVec = [...(FACING_VEC[this.unit.facing] || [0, 1])]; }
    setCell(x, y, z) { this.pos.set(x + 0.5, z + 1 - dropAt(x, y, z), y + 0.5); this.group.position.copy(this.pos); }
    setWorld(x, y, h) { this.pos.set(x, h, y); this.group.position.copy(this.pos); }
    face(dx, dy) { if (dx || dy) this.facingVec = [dx, dy]; }
    worldPosition() { return this.pos.clone(); }
    drawBar() {
        // XCOM-style overhead: segmented health pips, AP ticks underneath, a thin stress line.
        const u = this.unit, c = this.barCanvas.getContext('2d'), W = this.barCanvas.width, H = this.barCanvas.height;
        c.clearRect(0, 0, W, H);
        const n = Math.min(u.maxHp, 30), gap = 2, pw = (W - 4 - gap * (n - 1)) / n, per = u.maxHp / n;
        const on = u.side === 'player' ? '#5ff2a0' : '#ff5a4a', off = 'rgba(20,20,24,0.75)';
        c.fillStyle = 'rgba(4,10,16,0.75)'; c.fillRect(0, 0, W, 16);
        for (let i = 0; i < n; i++) { c.fillStyle = u.hp > i * per + per / 2 - 1e-6 ? on : off; c.fillRect(2 + i * (pw + gap), 2, pw, 12); }
        for (let i = 0; i < u.maxAp; i++) { c.fillStyle = i < u.ap ? '#ffc845' : 'rgba(30,30,36,0.7)'; c.fillRect(2 + i * 18, 19, 15, 5); }
        if (u.stress > 0) { c.fillStyle = '#b58cff'; c.fillRect(W - 2 - Math.round(40 * u.stress / 100), 19, Math.round(40 * u.stress / 100), 5); }
        this.barTex.needsUpdate = true;
    }
    update(dt, yaw) {
        this.sprite.rotation.y = yaw;
        this.animator.setScreenAngle(Math.atan2(this.facingVec[0], this.facingVec[1]) - yaw);
        this.animator.update(dt);
        this.bar.visible = !this.unit.dead;
    }
    /** groundY: height of the lowest walkable surface under the unit. */
    updateDrop(groundY) {
        const h = this.pos.y - groundY;
        const show = h >= 1.9 && !this.unit.dead && this.group.visible;
        this.dropLine.visible = this.dropRing.visible = show;
        if (!show || Math.abs(h - this.dropHeight) < 1e-3) return;
        this.dropHeight = h;
        this.dropLine.geometry.setFromPoints([new THREE.Vector3(0, 0.02, 0), new THREE.Vector3(0, -h + 0.03, 0)]);
        this.dropLine.computeLineDistances();
        this.dropRing.position.y = -h + 0.03;
    }
    setSelected(on) { this.selRing.visible = on; }
    setVisible(on) { this.group.visible = on; }
    dispose() {
        this.sprite.customDepthMaterial?.dispose(); this.scene.scene.remove(this.group); this.texture.dispose(); this.material.dispose(); this.barTex.dispose(); }
}

let blobTex = null;
function blobTexture() {
    if (blobTex) return blobTex;
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const g = c.getContext('2d'), grad = g.createRadialGradient(32, 32, 2, 32, 32, 32);
    grad.addColorStop(0, 'rgba(0,0,0,0.85)'); grad.addColorStop(0.6, 'rgba(0,0,0,0.35)'); grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grad; g.fillRect(0, 0, 64, 64);
    blobTex = new THREE.CanvasTexture(c);
    return blobTex;
}
