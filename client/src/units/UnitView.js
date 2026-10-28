import {installBillboardDepth,billboardDepthSlope} from './BillboardDepth.js';
import { WalkerModel } from './WalkerModel.js';
import { DroneModel, DRONE_HOVER } from './DroneModel.js';
import { WALKERS } from '../../../shared/battle/Walker.js';
// A 2D character standing in the voxel world: a camera-facing quad (depth-tested against voxels),
// a ground ring, an HP/AP bar, and a SpriteAnimator driving the illustrated, relightable atlas.
import * as THREE from 'three';
import { dropAt } from '../render/Ground.js';
import { SpriteAnimator } from '../anim/SpriteAnimator.js';
import { FACING_VEC } from '../../../shared/battle/Units.js';
import { characterArtId } from './CharacterArt.js';

const loader = new THREE.TextureLoader();
const atlasCache = new Map();
/** Floor cutaways select complete characters by their occupied cell, never by head pixels. */
export const unitBelowCut = (z, cut = Infinity) => z < cut;
export function unitSpriteMaterial(texture, normal) {
    return new THREE.MeshStandardMaterial({ map:texture, normalMap:normal, normalScale:new THREE.Vector2(.65,.65),
        roughness:.95, metalness:0, transparent:true, alphaTest:.35, side:THREE.DoubleSide, toneMapped:false });
}
export async function loadCharacterArt(art) {
    art = characterArtId(art);
    if (atlasCache.has(art)) return atlasCache.get(art);
    const p = (async () => {
        const base = `/assets/characters/${art}/`;
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
        this.material = unitSpriteMaterial(this.texture, this.normal);
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
        if(unit.drone){this.group.remove(this.sprite);this.sprite.geometry.dispose();this.sprite.customDepthMaterial.dispose();this.model=new DroneModel(unit,scene.clipping);this.sprite=this.model.root;this.spriteHeight=DRONE_HOVER+.15;this.group.add(this.sprite);}   // PLAN-14
        else if(WALKERS[unit.type]){this.group.remove(this.sprite);this.sprite.geometry.dispose();this.sprite.customDepthMaterial.dispose();this.model=new WalkerModel(unit,store,scene.clipping);this.sprite=this.model.root;this.spriteHeight=WALKERS[unit.type].height+.5;this.group.add(this.sprite);}
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
        // PLAN-15: a bobbing chevron over the selected soldier, so who is in control is never in doubt.
        this.beacon = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.32, 4).rotateX(Math.PI), new THREE.MeshBasicMaterial({ color: 0x5ff2d6, transparent: true, opacity: 0.95, depthTest: false, toneMapped: false }));
        this.beacon.renderOrder = 11; this.beacon.visible = false; this.group.add(this.beacon);
        this.barCanvas = document.createElement('canvas'); this.barCanvas.width = 256; this.barCanvas.height = 128;   // PLAN-15: room for name + AP
        this.barTex = new THREE.CanvasTexture(this.barCanvas);
        this.barTex.colorSpace = THREE.SRGBColorSpace;
        this.bar = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.barTex, depthTest: false, transparent: true, toneMapped: false }));
        this.bar.scale.set(1.3, 0.65, 1); this.bar.position.y = h + 0.25; this.bar.renderOrder = 10;
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
    /**
     * PLAN-11 status tag. Normally a slim segmented health bar only (unobtrusive); for a moment after selecting the
     * soldier, reloading or picking a gadget (`flashStatus`) it opens into a small card: HP, AP, the weapon's rounds and
     * spare magazines, and grenade / gadget counts.
     */
    drawBar() {
        const u=this.unit,c=this.barCanvas.getContext('2d'),W=this.barCanvas.width,H=this.barCanvas.height;c.clearRect(0,0,W,H);
        const frac=Math.max(0,Math.min(1,u.hp/Math.max(1,u.maxHp))),hpColor=u.side!=='player'?'#ff6a5c':frac>0.6?'#7ee08a':frac>0.3?'#ffcf5a':'#ff6a5c';
        const segs=Math.max(1,Math.round(u.maxHp/5)),bw=150,bx=(W-bw)/2,by=H-16,sw=bw/segs;
        c.fillStyle='rgba(8,10,14,0.72)';c.fillRect(bx-3,by-3,bw+6,12);
        for(let i=0;i<segs;i++){const filled=(i+1)/segs<=frac+1e-6||(i/segs<frac);c.fillStyle=filled?hpColor:'rgba(255,255,255,0.12)';c.fillRect(bx+i*sw+1,by,sw-2,6);}
        // PLAN-15: the selected soldier always carries its name and AP pips (unitTags: 'selected' | 'always' | 'flash');
        // the full card (rounds, gadgets) still opens on selection, reload and gadget choice.
        const mode=this.tagMode||'selected',player=u.side==='player'&&!u.dead;
        const tag=player&&(mode==='always'||(mode==='selected'&&this.selected));
        const card=player&&this.detailUntil&&performance.now()<this.detailUntil;
        if(tag||card){
            c.shadowColor='#000';c.shadowBlur=3;
            c.fillStyle='rgba(8,10,14,0.66)';c.fillRect(bx-3,by-30,bw+6,26);
            c.textAlign='left';c.font='700 15px sans-serif';c.fillStyle=this.selected?'#5ff2d6':'#e5e5e9';c.fillText((u.name||'').toUpperCase().slice(0,14),bx+3,by-11);
            const max=Math.max(u.maxAp??4,u.ap+(u.moveOnlyAp||0),1);
            for(let i=0;i<max;i++){const x=bx+bw-10-(max-1-i)*15,y=by-17;c.beginPath();c.arc(x,y,5.5,0,Math.PI*2);
                const on=i<u.ap,move=!on&&i<u.ap+(u.moveOnlyAp||0);c.fillStyle=on?'#4fd3ff':move?'#ffcf5a':'rgba(255,255,255,0.12)';c.fill();}
            c.shadowBlur=0;
        }
        if(card){
            const info=this.statusLines?.(u)||[];
            c.fillStyle='rgba(8,10,14,0.78)';c.fillRect(bx-3,by-88,bw+6,56);
            c.shadowColor='#000';c.shadowBlur=3;c.textAlign='left';c.font='700 16px sans-serif';c.fillStyle=hpColor;c.fillText(`${u.hp}/${u.maxHp} HP`,bx+4,by-70);
            c.font='600 13px sans-serif';c.fillStyle='#cfd6dc';
            info.slice(0,2).forEach((line,i)=>c.fillText(line,bx+4,by-53+i*16));
            c.shadowBlur=0;
        }
        this.barTex.needsUpdate = true;
    }
    /** Open the status card for a moment (selection, reload, gadget choice). */
    flashStatus(ms=1800){this.detailUntil=performance.now()+ms;this.drawBar();clearTimeout(this.detailTimer);this.detailTimer=setTimeout(()=>this.drawBar(),ms+30);}
    update(dt, yaw, camera = this.scene.camera) {
        this.group.visible = this.visibilityRequested !== false && unitBelowCut(this.unit.z, this.scene.cutLevel);
        this.breathTime=(this.breathTime||0)+dt;
        // Screen-facing art retains its drawn proportions; the transparent foot baseline stays at local zero.
        // Only the sprite tilts. Ground rings, collision position and elevation cues stay on the world grid.
        if(this.model){this.model.update(this.pos,dt,this.facingVec);this.bar.position.set(0,this.spriteHeight+.47,0);}
        else if(camera) {
            this.sprite.quaternion.copy(camera.quaternion);
            this.sprite.position.x=0;   // PLAN-11: no idle breathing sway on the field sprites (it read as jitter)
            this.depthSlope.value=billboardDepthSlope(camera);
            this.billboardUp.set(0,1,0).applyQuaternion(camera.quaternion);
            this.bar.position.copy(this.billboardUp).multiplyScalar(this.spriteHeight+.4);
        } else this.sprite.rotation.y=yaw;
        this.animator.setScreenAngle(Math.atan2(this.facingVec[0], this.facingVec[1]) - yaw);
        this.animator.update(dt);
        for (const map of [this.normal, this.lighting]) { map.repeat.copy(this.texture.repeat); map.offset.copy(this.texture.offset); }
        this.bar.visible = !this.unit.dead;
        // PLAN-15: the selection beacon bobs above the head; the selected ring breathes.
        this.pulseT=(this.pulseT||0)+dt;
        if(this.beacon.visible){this.beacon.position.set(0,this.spriteHeight+1.0+Math.sin(this.pulseT*4)*0.07,0);}
        if(this.selected){const k=1+Math.sin(this.pulseT*5)*0.06;this.selRing.scale.set(k,k,k);}
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
    setSelected(on) { this.selected = !!on; this.selRing.visible = on || !!this.hovered; this.beacon.visible = !!on && !this.unit.dead; this.drawBar(); }
    /** PLAN-15: hovering a squad portrait lights the soldier's ring in the world. */
    setHovered(on) { this.hovered = !!on; this.selRing.visible = this.selected || this.hovered; this.selRing.material.opacity = this.selected ? 0.95 : 0.6; }
    setVisible(on) { this.visibilityRequested = on; this.group.visible = on && unitBelowCut(this.unit.z, this.scene.cutLevel); }
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
