// A 2D character standing in the voxel world: a camera-facing quad (depth-tested against voxels),
// a ground ring, an HP/AP bar, and a SpriteAnimator driving the placeholder atlas.
import * as THREE from 'three';
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
        image.magFilter = THREE.NearestFilter; image.minFilter = THREE.LinearFilter; image.generateMipmaps = false;
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
        this.group.add(this.sprite);
        const ringColor = unit.side === 'player' ? 0x3fe0e6 : 0xf04646;
        this.ring = new THREE.Mesh(new THREE.RingGeometry(0.34, 0.44, 24), new THREE.MeshBasicMaterial({ color: ringColor, transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthWrite: false, clippingPlanes: scene.clipping }));
        this.ring.rotation.x = -Math.PI / 2; this.ring.position.y = 0.03;
        this.group.add(this.ring);
        this.selRing = new THREE.Mesh(new THREE.RingGeometry(0.48, 0.58, 32), new THREE.MeshBasicMaterial({ color: 0xffe066, side: THREE.DoubleSide, depthWrite: false }));
        this.selRing.rotation.x = -Math.PI / 2; this.selRing.position.y = 0.04; this.selRing.visible = false;
        this.group.add(this.selRing);
        this.barCanvas = document.createElement('canvas'); this.barCanvas.width = 64; this.barCanvas.height = 12;
        this.barTex = new THREE.CanvasTexture(this.barCanvas);
        this.bar = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.barTex, depthTest: false, transparent: true }));
        this.bar.scale.set(1.1, 0.2, 1); this.bar.position.y = h + 0.25; this.bar.renderOrder = 10;
        this.group.add(this.bar);
        this.animator = new SpriteAnimator(m, this.texture, this);
        this.pos = new THREE.Vector3();
        this.facingVec = [...(FACING_VEC[unit.facing] || [0, 1])];
        this.snap();
        this.drawBar();
        scene.scene.add(this.group);
    }
    /** Visual position from the battle state (used after animations settle). */
    snap() { this.setCell(this.unit.x, this.unit.y, this.unit.z); this.facingVec = [...(FACING_VEC[this.unit.facing] || [0, 1])]; }
    setCell(x, y, z) { this.pos.set(x + 0.5, z + 1, y + 0.5); this.group.position.copy(this.pos); }
    setWorld(x, y, h) { this.pos.set(x, h, y); this.group.position.copy(this.pos); }
    face(dx, dy) { if (dx || dy) this.facingVec = [dx, dy]; }
    worldPosition() { return this.pos.clone(); }
    drawBar() {
        const u = this.unit, c = this.barCanvas.getContext('2d');
        c.clearRect(0, 0, 64, 12);
        c.fillStyle = 'rgba(0,0,0,0.6)'; c.fillRect(0, 0, 64, 12);
        c.fillStyle = u.side === 'player' ? '#58e08a' : '#ff6060';
        c.fillRect(1, 1, Math.max(0, 62 * u.hp / u.maxHp), 6);
        c.fillStyle = '#ffd34d';
        for (let i = 0; i < u.maxAp; i++) if (i < u.ap) c.fillRect(1 + i * 9, 8, 7, 3);
        c.fillStyle = '#c38bff';
        c.fillRect(64 - 2 - Math.round(20 * u.stress / 100), 8, Math.round(20 * u.stress / 100), 3);
        this.barTex.needsUpdate = true;
    }
    update(dt, yaw) {
        this.sprite.rotation.y = yaw;
        this.animator.setScreenAngle(Math.atan2(this.facingVec[0], this.facingVec[1]) - yaw);
        this.animator.update(dt);
        this.bar.visible = !this.unit.dead;
    }
    setSelected(on) { this.selRing.visible = on; }
    setVisible(on) { this.group.visible = on; }
    dispose() { this.scene.scene.remove(this.group); this.texture.dispose(); this.material.dispose(); this.barTex.dispose(); }
}
