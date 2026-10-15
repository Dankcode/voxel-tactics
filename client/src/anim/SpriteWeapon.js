// The only 3D model in a character cut-in is the gun. Body/arms/gloves stay painted RGBA cutouts.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

export function spriteGunParts(weaponId, mods = {}) {
    if (weaponId === 'handcannon') return { family: 'pistol', body: 'body_pistol', parts: ['body_pistol'], muzzle: 'muzzle_pistol', support: [0, 0.02, 0] };
    if (weaponId === 'blunderbuss' || weaponId === 'firelance') return { family: 'rifle', body: 'body_shotgun', parts: ['body_shotgun', ...(mods.scope ? ['optic_scope'] : [])], muzzle: 'muzzle_shotgun', support: [0, 0.33, 0.072] };
    if (weaponId === 'longrifle') return { family: 'rifle', body: 'body_sniper', parts: ['body_sniper', 'optic_scope'], muzzle: 'muzzle_sniper', support: [0, 0.27, 0.07] };
    if (!['repeater', 'musket', 'crossbow', 'shortbow'].includes(weaponId)) return null;
    const long = mods.barrel || weaponId === 'shortbow';
    return { family: 'rifle', body: 'body_rifle', parts: ['body_rifle', weaponId === 'musket' ? 'mag_ak' : 'mag_rifle', long ? 'barrel_long' : 'barrel_std', mods.scope || weaponId === 'shortbow' ? 'optic_scope' : 'sight_irons', ...(weaponId === 'crossbow' ? ['suppressor'] : [])], muzzle: long ? 'muzzle_long' : 'muzzle_std', support: [0, 0.27, 0.09] };
}
export const gunPoint = p => new THREE.Vector3(p[0], p[2], -p[1]);

/** Orthographic camera fitted to two painted palm anchors; leaves the character entirely 2D. */
export function fitSpriteGunCamera(camera, spec, support, aspect) {
    camera.position.fromArray(spec.cameraPosition || [0.8, 0.6, 5]);
    camera.lookAt(0, 0, 0); camera.updateMatrixWorld(true);
    const v = gunPoint(support).applyMatrix4(camera.matrixWorldInverse);
    const dx = (spec.support[0] - spec.grip[0]) * aspect, dy = spec.grip[1] - spec.support[1];
    const height = Math.hypot(v.x, v.y) / Math.max(0.005, Math.hypot(dx, dy));
    camera.rotateZ(Math.atan2(v.y, v.x) - Math.atan2(dy, dx));
    camera.left = -spec.grip[0] * height * aspect; camera.right = (1 - spec.grip[0]) * height * aspect;
    camera.top = spec.grip[1] * height; camera.bottom = (spec.grip[1] - 1) * height;
    camera.near = .01; camera.far = 50; camera.updateProjectionMatrix(); camera.updateMatrixWorld(true);
    return camera;
}

let kit;
function loadKit() {
    return kit ||= Promise.all([
        new GLTFLoader().loadAsync('/assets/weapons/ranger-preview/gun-kit.glb'),
        fetch('/assets/weapons/ranger-preview/gun-kit.json').then(r => { if (!r.ok) throw Error('Gun anchor data unavailable'); return r.json(); })
    ]).catch(error => { kit = null; throw error; });
}

export class SpriteWeapon {
    constructor(slot, art, unit, weaponId = unit.weapon) {
        this.slot = slot; this.art = art; this.unit = unit;
        this.config = spriteGunParts(weaponId, unit.attachments?.[weaponId]);
        this.ready = false; this.disposed = false; this.last = { yaw: 0, pitch: 0 };
        if (this.config) this.load().catch(error => console.warn('3D weapon: using sprite fallback', error.message));
    }
    async load() {
        const [gltf, anchors] = await loadKit();
        if (this.disposed) return;
        this.anchors = anchors;
        this.scene = new THREE.Scene();
        this.model = gltf.scene.clone(true); this.scene.add(this.model);
        this.pivot = this.model.getObjectByName('Gun') || this.model;
        const known = new Set(['body_rifle', 'body_shotgun', 'body_sniper', 'body_pistol', 'mag_rifle', 'mag_ak', 'barrel_std', 'barrel_long', 'suppressor', 'sight_irons', 'optic_scope']);
        this.model.traverse(ob => { if (known.has(ob.name)) ob.visible = this.config.parts.includes(ob.name); });
        if (this.config.parts.includes('suppressor')) {
            const suppressor = this.model.getObjectByName('suppressor');
            const std = gunPoint(anchors.muzzles.muzzle_std), end = gunPoint(anchors.muzzles[this.config.muzzle]);
            if (suppressor) suppressor.position.add(end.sub(std));
        }
        this.scene.add(new THREE.HemisphereLight(0xdfeaff, 0x394033, 2));
        const light = new THREE.DirectionalLight(0xfff2d9, 3); light.position.set(2, 4, 5); this.scene.add(light);
        this.camera = new THREE.OrthographicCamera();
        // The original arm drawing is calibrated for a rifle. IK handles each actual foregrip.
        fitSpriteGunCamera(this.camera, this.art.rig, [0, .29, .07], this.art.width / this.art.height);
        this.renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'low-power' });
        this.renderer.setClearColor(0, 0); this.renderer.setPixelRatio(1);
        this.renderer.setSize(Math.min(1024, this.art.width), Math.min(1024, this.art.width) * this.art.height / this.art.width, false);
        this.renderer.outputColorSpace = THREE.SRGBColorSpace;
        this.renderer.domElement.className = 'sprite-weapon-canvas';
        this.slot.appendChild(this.renderer.domElement);
        this.ready = true; this.slot.classList.add('weapon-ready'); this.update(this.last);
    }
    project(point) {
        const p = gunPoint(point).applyMatrix4(this.pivot.matrixWorld).project(this.camera);
        return [(p.x + 1) / 2, (1 - p.y) / 2];
    }
    update({ yaw = 0, pitch = 0, recoil = 0 } = {}) {
        this.last = { yaw, pitch, recoil };
        if (!this.ready || this.disposed) return null;
        this.pivot.rotation.set(pitch, yaw, 0, 'YXZ'); this.pivot.position.z = recoil;
        this.model.updateMatrixWorld(true);
        this.renderer.render(this.scene, this.camera);
        return { grip: this.project([0, 0, 0]), support: this.project(this.config.support), muzzle: this.project(this.anchors.muzzles[this.config.muzzle]) };
    }
    dispose() {
        this.disposed = true;
        if (this.renderer) { this.renderer.domElement.remove(); this.renderer.dispose(); this.renderer.forceContextLoss(); }
        // Geometry/materials belong to the cached kit and are reused by the next pose.
    }
}
