import {installBillboardDepth,billboardDepthSlope} from './BillboardDepth.js';
import { WalkerModel } from './WalkerModel.js';
import { WALKERS } from '../../../shared/battle/Walker.js';
// A 2D character standing in the voxel world: a camera-facing quad (depth-tested against voxels),
// a ground ring, an HP/AP bar, and a SpriteAnimator driving the illustrated, relightable atlas.
import * as THREE from 'three';
import { dropAt } from '../render/Ground.js';
import { SpriteAnimator } from '../anim/SpriteAnimator.js';
import { FACING_VEC } from '../../../shared/battle/Units.js';

const loader = new THREE.TextureLoader();
const atlasCache = new Map();
export async function loadCharacterArt(art) {
    art = 'ranger-01'; // One illustrated identity shared by every human character.
    if (atlasCache.has(art)) return atlasCache.get(art);
    const p = (async () => {
        const base = '/assets/characters/ranger-01/';
        const [field, cutin] = await Promise.all([fetch(base + 'field.json').then(r => r.json()), fetch(base + 'cutin.json').then(r => r.json())]);
        const image = await new Promise((res, rej) => loader.load(base + field.image, res, undefined, rej));
        image.colorSpace = THREE.SRGBColorSpace;
        image.magFilter = THREE.LinearFilter; image.minFilter = THREE.LinearMipmapLinearFilter; image.generateMipmaps = true; image.anisotropy = 4;
        const [normal, lighting] = await Promise.all([loader.loadAsync(base + field.normal), loader.loadAsync(base + field.lightingMask)]);
        return { field, cutin, image, normal, lighting, base };
    })();
    atlasCache.set(art, p);
    return p;
}

export class UnitView {
    constructor(scene, unit, art, store) {
        this.scene = scene; this.unit = unit; this.id = unit.id; this.art = unit.art;
        this.group = new THREE.Group();
        const m = art.field;
        const h = m.worldHeight, w = h * m.frameWidth / m.frameHeight;
        const geo = new THREE.PlaneGeometry(w, h);
        geo.translate(0, h / 2 - m.anchor[1] * h, 0);
        this.texture = art.image.clone();
        this.texture.needsUpdate = true;
        this.normal = art.normal.clone(); this.normal.needsUpdate = true;
        this.lighting = art.lighting.clone(); this.lighting.needsUpdate = true;
        this.material = new THREE.MeshStandardMaterial({ map: this.texture, normalMap: this.normal, normalScale: new THREE.Vector2(.65, .65), roughness: .95, metalness: 0, transparent: true, alphaTest: 0.35, side: THREE.DoubleSide, clippingPlanes: scene.clipping, toneMapped: false });
        this.depthSlope=installBillboardDepth(this.material);
        const depthCompile = this.material.onBeforeCompile;
        this.material.onBeforeCompile = shader => {
            depthCompile(shader);
            shader.uniforms.spriteResponse = { value: this.lighting };
            shader.fragmentShader = 'uniform sampler2D spriteResponse;\n' + shader.fragmentShader;
            shader.fragmentShader = shader.fragmentShader.replace('vec3 outgoingLight = totalDiffuse + totalSpecular + totalEmissiveRadiance;', `
                vec3 response = texture2D(spriteResponse, vMapUv).rgb;
                vec3 outgoingLight = (reflectedLight.directDiffuse + reflectedLight.directSpecular) * response.r
                    + (reflectedLight.indirectDiffuse + reflectedLight.indirectSpecular) * response.b
                    + totalEmissiveRadiance + diffuseColor.rgb * response.g;`);
        };
        this.material.customProgramCacheKey = () => 'ranger-edge-lit-billboard-v3';
        this.sprite = new THREE.Mesh(geo, this.material);
        this.spriteHeight=h;this.billboardUp=new THREE.Vector3();
        this.sprite.userData.unitId = unit.id;
        // The billboard casts a sun shadow through its alpha (same animated texture as the colour pass).
        this.sprite.castShadow = true; this.sprite.receiveShadow = true;
        this.sprite.customDepthMaterial = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: this.texture, alphaTest: 0.5, side: THREE.DoubleSide });
        this.group.add(this.sprite);
        if(WALKERS[unit.type]){this.group.remove(this.sprite);this.sprite.geometry.dispose();this.sprite.customDepthMaterial.dispose();this.model=new WalkerModel(unit,store,scene.clipping);this.sprite=this.model.root;this.spriteHeight=WALKERS[unit.type].height+.5;this.group.add(this.sprite);}
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
        const u=this.unit,c=this.barCanvas.getContext('2d'),W=this.barCanvas.width,H=this.barCanvas.height;c.clearRect(0,0,W,H);c.textAlign='center';c.font='600 17px sans-serif';c.fillStyle=u.side==='player'?'#e5e5e9':'#ff7777';c.shadowColor='#000';c.shadowBlur=5;c.fillText(`${u.hp}/${u.maxHp}  ·  ${u.ap} AP`,W/2,18);
        this.barTex.needsUpdate = true;
    }
    update(dt, yaw, camera = this.scene.camera) {
        this.breathTime=(this.breathTime||0)+dt;
        // Screen-facing art retains its drawn proportions; the transparent foot baseline stays at local zero.
        // Only the sprite tilts. Ground rings, collision position and elevation cues stay on the world grid.
        if(this.model){this.model.update(this.pos,dt);this.bar.position.set(0,this.spriteHeight+.25,0);}
        else if(camera) {
            this.sprite.quaternion.copy(camera.quaternion);
            if(this.swayEnabled!==false){this.sprite.rotateZ(Math.sin(this.breathTime*1.7+this.id.length)*.004);this.sprite.position.x=Math.sin(this.breathTime*1.3)*.008;}else this.sprite.position.x=0;
            this.depthSlope.value=billboardDepthSlope(camera);
            this.billboardUp.set(0,1,0).applyQuaternion(camera.quaternion);
            this.bar.position.copy(this.billboardUp).multiplyScalar(this.spriteHeight+.18);
        } else this.sprite.rotation.y=yaw;
        this.animator.setScreenAngle(Math.atan2(this.facingVec[0], this.facingVec[1]) - yaw);
        this.animator.update(dt);
        for (const map of [this.normal, this.lighting]) { map.repeat.copy(this.texture.repeat); map.offset.copy(this.texture.offset); }
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
        this.model?.dispose();this.sprite.customDepthMaterial?.dispose(); this.scene.scene.remove(this.group); this.texture.dispose(); this.normal.dispose(); this.lighting.dispose(); this.material.dispose(); this.barTex.dispose(); }
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
