// Articulated 3D humanoid unit models for tactical + third-person shooter camera views, with a registry/GLTFLoader
// transfer hook for dropping in external glTF/GLB assets while retaining unified animation, aim & cover APIs.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { WEAPONS } from '../../../shared/content/weapons.js';
import { HITBOX } from '../../../shared/battle/Ballistics.js';

export const CHARACTER_MODES = Object.freeze(['3d', '2d']);
const MODEL_REGISTRY = new Map();
const GLTF_CACHE = new Map();

/** Register a custom 3D builder `(unit, clipping) => HumanoidLikeModel` or glTF `.glb`/`.gltf` URL per `art` id. */
export function registerCharacterModel(artId, builderOrUrl) {
    if (!artId) return;
    if (!builderOrUrl) MODEL_REGISTRY.delete(artId);
    else MODEL_REGISTRY.set(artId, builderOrUrl);
}
export function getRegisteredCharacterModel(artId) {
    return MODEL_REGISTRY.get(artId) || null;
}

/** Optional async loader for future external `.glb`/`.gltf` character meshes (used when URL is registered). */
export function loadCharacterGltf(url) {
    if (GLTF_CACHE.has(url)) return GLTF_CACHE.get(url);
    const loader = new GLTFLoader();
    const promise = new Promise((resolve, reject) => loader.load(url, resolve, undefined, reject));
    GLTF_CACHE.set(url, promise);
    return promise;
}

const PALETTES = Object.freeze({
    vanguard: { suit: 0x3b4d5e, armor: 0x24313d, trim: 0x4fd3ff, skin: 0xd6ad8d, visor: 0x5ff2d6 },
    grenadier: { suit: 0x45513d, armor: 0x2c3428, trim: 0xffb347, skin: 0xc99c7c, visor: 0xffd15c },
    marksman: { suit: 0x343f48, armor: 0x21292f, trim: 0x6ce5e8, skin: 0xd8b498, visor: 0x89f7ff },
    warden: { suit: 0x2e455c, armor: 0x1b2b3b, trim: 0x7cb8ff, skin: 0xc49576, visor: 0xa2d4ff },
    cultist: { suit: 0x483838, armor: 0x2b2123, trim: 0xff5a4a, skin: 0xb88b72, visor: 0xff6b57 },
    archer: { suit: 0x40443b, armor: 0x282b24, trim: 0xff8a4c, skin: 0xc2987d, visor: 0xffb347 },
    pyromancer: { suit: 0x5a3428, armor: 0x361e17, trim: 0xff6e2e, skin: 0xb78469, visor: 0xff9b3f },
    brute: { suit: 0x3b2c2a, armor: 0x221b1b, trim: 0xe64b3c, skin: 0xa87c66, visor: 0xff5245 },
    warden_foe: { suit: 0x2f333a, armor: 0x1d2026, trim: 0xff705c, skin: 0xb58d75, visor: 0xff856e },
    tech: { suit: 0x313e46, armor: 0x1e262b, trim: 0xffc845, skin: 0xc9a084, visor: 0xffdf6b }
});

const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));

/** Articulated voxel-proportioned 3D combatant aligned to Ballistics.HITBOX (~1.82 tiles tall). */
export class HumanoidModel {
    constructor(unit, clipping = null) {
        this.unit = unit;
        this.clipping = clipping;
        this.root = new THREE.Group();
        this.clip = 'idle';
        this.clipTime = 0;
        this.animDur = 0;
        this.stridePhase = 0;
        this.lastPos = null;
        this.yaw = 0;
        this.yawInitialized = false;
        this.aimWorld = null;
        this.aimPitch = 0;
        this.coverLevel = 0;
        this.leanSide = null;
        this.aimingActive = false;
        this.crouchAmt = 0;
        this.leanAmt = 0;
        this.recoilKick = 0;
        this.opacity = 1;
        this._materials = [];
        this._weaponKey = null;

        const pal = PALETTES[unit.type] || (unit.side === 'player' ? PALETTES.vanguard : PALETTES.cultist);
        const mkMat = (color, { roughness = 0.72, metalness = 0.18, emissive = 0, emissiveIntensity = 0 } = {}) => {
            const m = new THREE.MeshStandardMaterial({
                color, roughness, metalness, emissive, emissiveIntensity,
                clippingPlanes: clipping || null
            });
            this._materials.push(m);
            return m;
        };
        this.mats = {
            suit: mkMat(pal.suit, { roughness: 0.78, metalness: 0.12 }),
            armor: mkMat(pal.armor, { roughness: 0.55, metalness: 0.32 }),
            trim: mkMat(pal.trim, { roughness: 0.42, metalness: 0.25, emissive: pal.trim, emissiveIntensity: 0.18 }),
            visor: mkMat(pal.visor, { roughness: 0.2, metalness: 0.5, emissive: pal.visor, emissiveIntensity: 0.45 }),
            skin: mkMat(pal.skin, { roughness: 0.85, metalness: 0.02 }),
            gun: mkMat(0x23282d, { roughness: 0.4, metalness: 0.65 }),
            wood: mkMat(0x6e4a2e, { roughness: 0.75, metalness: 0.08 }),
            blade: mkMat(0xc8d2da, { roughness: 0.28, metalness: 0.82 })
        };

        const bulky = unit.type === 'brute' || unit.type === 'warden_foe' || unit.type === 'grenadier' || unit.type === 'warden';
        const shoulderSpan = bulky ? 0.3 : 0.26;
        this.pelvisBaseY = HITBOX.legs.h1; // 0.72

        this.body = new THREE.Group();
        this.root.add(this.body);

        // Pelvis & Articulated Legs
        this.pelvis = new THREE.Group();
        this.pelvis.position.y = this.pelvisBaseY;
        this.body.add(this.pelvis);

        const belt = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.14, 0.24), this.mats.armor);
        belt.position.y = 0.02;
        this.pelvis.add(belt);

        const makeLeg = sideSign => {
            const hip = new THREE.Group();
            hip.position.set(sideSign * 0.12, -0.02, 0);
            const thigh = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.36, 0.18), this.mats.suit);
            thigh.position.y = -0.18;
            const knee = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.1, 0.2), this.mats.armor);
            knee.position.set(0, -0.36, 0.01);
            const shin = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.28, 0.17), this.mats.armor);
            shin.position.y = -0.51;
            const boot = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.1, 0.25), this.mats.gun);
            boot.position.set(0, -0.65, 0.04);
            hip.add(thigh, knee, shin, boot);
            this.pelvis.add(hip);
            return hip;
        };
        this.legR = makeLeg(-1); // Character right = -X when facing +Z
        this.legL = makeLeg(1);  // Character left  = +X when facing +Z

        // Torso & Tactical Rig
        this.torsoGroup = new THREE.Group();
        this.torsoGroup.position.y = 0.06;
        this.pelvis.add(this.torsoGroup);

        const chest = new THREE.Mesh(new THREE.BoxGeometry(bulky ? 0.5 : 0.44, 0.56, 0.28), this.mats.suit);
        chest.position.y = 0.28;
        const vest = new THREE.Mesh(new THREE.BoxGeometry(bulky ? 0.54 : 0.47, 0.42, 0.32), this.mats.armor);
        vest.position.y = 0.32;
        const pack = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.36, 0.14), this.mats.armor);
        pack.position.set(0, 0.34, -0.2);
        const trimBar = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.06, 0.03), this.mats.trim);
        trimBar.position.set(0, 0.44, -0.28);
        this.torsoGroup.add(chest, vest, pack, trimBar);

        if (unit.type === 'pyromancer') {
            const tank = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.34, 10), this.mats.trim);
            tank.position.set(-0.08, 0.36, -0.24);
            this.torsoGroup.add(tank);
        } else if (unit.type === 'tech') {
            const ant = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.38, 6), this.mats.trim);
            ant.position.set(0.12, 0.62, -0.22);
            this.torsoGroup.add(ant);
        }

        // Head & Helmet/Mask
        this.headGroup = new THREE.Group();
        this.headGroup.position.y = 0.6;
        this.torsoGroup.add(this.headGroup);
        const head = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.29, 0.29), this.mats.skin);
        head.position.y = 0.16;
        const helmet = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.2, 0.33), this.mats.armor);
        helmet.position.set(0, 0.24, -0.01);
        const visor = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.09, 0.06), this.mats.visor);
        visor.position.set(0, 0.18, 0.15);
        this.headGroup.add(head, helmet, visor);

        // Upper weapon rig (rotates for elevation pitch & aim tracking while torso leans cleanly)
        this.upperRig = new THREE.Group();
        this.upperRig.position.set(0, 0.5, 0);
        this.torsoGroup.add(this.upperRig);

        const mkArm = (xOff, rotZ = 0) => {
            const arm = new THREE.Group();
            arm.position.set(xOff, 0, 0);
            const pauldron = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.15, 0.19), this.mats.armor);
            pauldron.position.y = -0.02;
            const upper = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.26, 0.14), this.mats.suit);
            upper.position.set(0, -0.15, 0.05);
            upper.rotation.x = -0.45;
            const fore = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 0.28), this.mats.armor);
            fore.position.set(0, -0.21, 0.21);
            arm.rotation.z = rotZ;
            arm.add(pauldron, upper, fore);
            return arm;
        };
        this.armR = mkArm(-shoulderSpan, 0.06);
        this.armL = mkArm(shoulderSpan, -0.18);
        this.upperRig.add(this.armR, this.armL);

        // Weapon mount on right shoulder line projecting along +Z
        this.weaponMount = new THREE.Group();
        this.weaponMount.position.set(-0.16, -0.18, 0.34);
        this.upperRig.add(this.weaponMount);
        this.weaponGroup = new THREE.Group();
        this.weaponMount.add(this.weaponGroup);
        this.muzzleNode = new THREE.Object3D();
        this.weaponGroup.add(this.muzzleNode);

        this.rebuildWeapon(unit.weapon);

        // Optional ballistic shield arm plate for Warden / Riot Guard
        if (unit.type === 'warden' || unit.type === 'warden_foe') {
            const shield = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.62, 0.34), this.mats.armor);
            shield.position.set(0.14, -0.18, 0.24);
            const strip = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.16, 0.26), this.mats.visor);
            strip.position.set(0.14, -0.02, 0.24);
            this.armL.add(shield, strip);
        }

        // Support optional async custom glTF attachment if registered by URL
        const custom = getRegisteredCharacterModel(unit.art);
        if (typeof custom === 'string') {
            loadCharacterGltf(custom).then(gltf => {
                if (!gltf?.scene) return;
                this.body.visible = false;
                gltf.scene.traverse(o => {
                    o.userData.unitId = unit.id;
                    if (o.isMesh) {
                        o.castShadow = true;
                        o.receiveShadow = true;
                        if (clipping) o.material.clippingPlanes = clipping;
                    }
                });
                this.root.add(gltf.scene);
            }).catch(() => {});
        }

        this.tagMeshes();
    }

    tagMeshes() {
        this.root.traverse(o => {
            o.userData.unitId = this.unit.id;
            if (o.isMesh) {
                o.castShadow = true;
                o.receiveShadow = true;
            }
        });
    }

    rebuildWeapon(weaponId) {
        if (this._weaponKey === weaponId) return;
        this._weaponKey = weaponId;
        for (const ch of [...this.weaponGroup.children]) {
            if (ch !== this.muzzleNode) {
                this.weaponGroup.remove(ch);
                ch.geometry?.dispose?.();
            }
        }
        const w = WEAPONS[weaponId] || WEAPONS[this.unit.weapon] || {};
        if (w.kind === 'melee') {
            const handle = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.06, 0.36), this.mats.wood);
            handle.position.set(0, 0.04, 0.12);
            const blade = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.08, w.id === 'maul' ? 0.28 : 0.48), w.id === 'maul' ? this.mats.armor : this.mats.blade);
            blade.position.set(0, 0.06, 0.44);
            this.weaponGroup.add(handle, blade);
            this.muzzleNode.position.set(0, 0.06, 0.66);
        } else if (weaponId === 'handcannon') {
            const frame = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.09, 0.24), this.mats.gun);
            frame.position.set(0, 0.03, 0.08);
            const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.06, 0.22), this.mats.blade);
            barrel.position.set(0, 0.05, 0.22);
            this.weaponGroup.add(frame, barrel);
            this.muzzleNode.position.set(0, 0.05, 0.34);
        } else if (weaponId === 'longrifle' || weaponId === 'shortbow') {
            const stock = new THREE.Mesh(new THREE.BoxGeometry(0.065, 0.09, 0.28), this.mats.wood);
            stock.position.set(0, 0.01, -0.02);
            const body = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.08, 0.72), this.mats.gun);
            body.position.set(0, 0.03, 0.28);
            const scope = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.028, 0.22, 8).rotateX(Math.PI / 2), this.mats.trim);
            scope.position.set(0, 0.1, 0.14);
            this.weaponGroup.add(stock, body, scope);
            this.muzzleNode.position.set(0, 0.03, 0.66);
        } else if (weaponId === 'blunderbuss') {
            const stock = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.1, 0.26), this.mats.wood);
            stock.position.set(0, 0, -0.02);
            const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.1, 0.46), this.mats.gun);
            barrel.position.set(0, 0.03, 0.22);
            this.weaponGroup.add(stock, barrel);
            this.muzzleNode.position.set(0, 0.03, 0.47);
        } else {
            // Repeater, musket, crossbow, firelance
            const body = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.09, 0.52), this.mats.gun);
            body.position.set(0, 0.02, 0.18);
            const grip = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.11, 0.12), this.mats.wood);
            grip.position.set(0, -0.04, 0.02);
            const rail = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.03, 0.22), this.mats.trim);
            rail.position.set(0, 0.08, 0.18);
            this.weaponGroup.add(body, grip, rail);
            this.muzzleNode.position.set(0, 0.03, 0.46);
        }
        this.tagMeshes();
    }

    play(clip, { restart = false } = {}) {
        if (clip && (clip !== this.clip || restart)) {
            this.clip = clip;
            this.clipTime = 0;
            this.animDur = clip === 'fire' ? 0.28 : clip === 'hit' ? 0.26 : clip === 'throw' ? 0.34 : 0;
            if (clip === 'fire') this.recoilKick = 1;
        }
    }

    setAimTarget(worldPoint) {
        if (!worldPoint) { this.aimWorld = null; return; }
        const y = worldPoint.h != null ? worldPoint.y : worldPoint.z;
        const h = worldPoint.h != null ? worldPoint.h : worldPoint.y;
        this.aimWorld = { x: worldPoint.x, y, h };
    }

    setCoverStance(coverLevel = 0, leanSide = null, aiming = false) {
        if (coverLevel && typeof coverLevel === 'object') {
            const c = coverLevel.cover;
            this.coverLevel = c === 'full' ? 2 : c === 'half' ? 1 : (Number(c) || 0);
            this.leanSide = coverLevel.lean || null;
            this.aimingActive = !!coverLevel.aiming;
            return;
        }
        this.coverLevel = coverLevel === 'full' ? 2 : coverLevel === 'half' ? 1 : (Number(coverLevel) || 0);
        this.leanSide = leanSide || null;
        this.aimingActive = !!aiming;
    }

    setOpacity(alpha = 1) {
        const a = Math.max(0.05, Math.min(1, alpha));
        if (Math.abs(a - this.opacity) < 0.02) return;
        this.opacity = a;
        const trans = a < 0.99;
        for (const m of this._materials) {
            m.transparent = trans;
            m.opacity = a;
            m.depthWrite = !trans;
            m.needsUpdate = true;
        }
    }

    getMuzzleWorldPos() {
        const v = new THREE.Vector3();
        this.root.updateMatrixWorld(true);
        this.muzzleNode.getWorldPosition(v);
        return { x: v.x, y: v.z, h: v.y };
    }

    update(pos, dt = 0, facing = null) {
        this.rebuildWeapon(this.unit.weapon);
        if (dt > 0) this.clipTime += dt;
        const dead = !!this.unit.dead || this.clip === 'down';

        // Track movement stride speed smoothly
        const dist = this.lastPos ? Math.hypot(pos.x - this.lastPos.x, pos.z - this.lastPos.z) : 0;
        if (dist > 1e-4) this.stridePhase += dist * 5.2;
        else if (this.clip === 'run' && dt > 0) this.stridePhase += dt * 11;
        this.lastPos = pos.clone();

        // Determine desired yaw: toward aimWorld while aiming, else facing vector
        let fx = facing?.[0] ?? 0, fy = facing?.[1] ?? 1;
        if (this.aimingActive && this.aimWorld) {
            fx = this.aimWorld.x - pos.x;
            fy = this.aimWorld.y - pos.z;
        }
        if (Math.hypot(fx, fy) > 1e-4) {
            const targetYaw = Math.atan2(fx, fy);
            if (!this.yawInitialized || dt <= 0) {
                this.yaw = targetYaw;
                this.yawInitialized = true;
            } else {
                const dyaw = wrap(targetYaw - this.yaw);
                this.yaw = wrap(this.yaw + dyaw * (1 - Math.exp(-16 * dt)));
            }
        }
        this.root.rotation.y = this.yaw;

        // Dead / downed pose
        if (dead) {
            this.body.rotation.x = -Math.PI / 2;
            this.body.position.y = 0.22;
            this.pelvis.position.y = this.pelvisBaseY;
            this.torsoGroup.rotation.set(0, 0, 0);
            this.upperRig.rotation.set(0, 0, 0);
            this.legL.rotation.set(0, 0, 0);
            this.legR.rotation.set(0, 0, 0);
            return;
        }
        this.body.rotation.x = 0;
        this.body.position.y = 0;

        // Elevation aim pitch when aiming in TPS
        let targetPitch = 0;
        if (this.aimingActive && this.aimWorld) {
            const shoulderY = pos.y + 1.35;
            const aimY = this.aimWorld.h ?? shoulderY;
            const flatDist = Math.max(0.25, Math.hypot(this.aimWorld.x - pos.x, this.aimWorld.y - pos.z));
            targetPitch = THREE.MathUtils.clamp(Math.atan2(aimY - shoulderY, flatDist), -0.95, 0.95);
        }
        if (dt > 0) this.aimPitch += (targetPitch - this.aimPitch) * (1 - Math.exp(-18 * dt));
        else this.aimPitch = targetPitch;

        // Cover crouch vs rising up to aim/shoot + directional lean
        const targetCrouch = this.clip === 'hunker' ? 0.26
            : (this.aimingActive ? 0.03 : (this.coverLevel >= 2 ? 0.22 : this.coverLevel >= 1 ? 0.16 : 0));
        const targetLean = this.aimingActive
            ? (this.leanSide === 'left' ? 0.16 : this.leanSide === 'right' ? -0.16 : -0.05)
            : 0;
        const lerpRate = dt > 0 ? (1 - Math.exp(-14 * dt)) : 1;
        this.crouchAmt += (targetCrouch - this.crouchAmt) * lerpRate;
        this.leanAmt += (targetLean - this.leanAmt) * lerpRate;

        // Recoil kick decay
        if (dt > 0) this.recoilKick = Math.max(0, this.recoilKick - dt * 5.2);
        const kick = this.recoilKick;

        // Stride & idle pose
        const moving = this.clip === 'run' || dist > 0.002;
        const swing = moving ? Math.sin(this.stridePhase) * 0.58 : 0;
        const crouchBend = this.crouchAmt * 1.4;
        this.pelvis.position.y = this.pelvisBaseY - this.crouchAmt + (moving ? Math.abs(Math.cos(this.stridePhase)) * 0.04 : Math.sin(this.clipTime * 2.2) * 0.012);
        this.legL.rotation.x = moving ? swing : -crouchBend * 0.35;
        this.legR.rotation.x = moving ? -swing : crouchBend * 0.35;

        const hitPunch = this.clip === 'hit' && this.clipTime < this.animDur ? Math.sin((this.clipTime / this.animDur) * Math.PI) * 0.28 : 0;
        this.torsoGroup.rotation.x = crouchBend * 0.55 - hitPunch;
        this.torsoGroup.rotation.z = this.leanAmt;
        this.headGroup.rotation.x = -this.torsoGroup.rotation.x * 0.6 - this.aimPitch * 0.35;

        // Raise weapon smoothly to shoulder when aiming/firing/overwatch
        const readyRaise = (this.aimingActive || this.unit.overwatch || kick > 0.05) ? -0.18 : 0.12;
        this.upperRig.rotation.x = -this.aimPitch + readyRaise - kick * 0.14;
        this.weaponGroup.position.z = -kick * 0.08;
        this.weaponGroup.rotation.x = -kick * 0.18;

        if (this.animDur > 0 && this.clipTime >= this.animDur) {
            this.clip = this.unit.overwatch ? 'hunker' : 'idle';
            this.animDur = 0;
        }
    }

    dispose() {
        const geos = new Set();
        this.root.traverse(o => { if (o.geometry) geos.add(o.geometry); });
        for (const g of geos) g.dispose();
        for (const m of this._materials) m.dispose();
    }
}

/** Factory resolving registered custom builders or default HumanoidModel. */
export function createCharacterModel(unit, clipping) {
    const reg = getRegisteredCharacterModel(unit.art);
    if (typeof reg === 'function') return reg(unit, clipping);
    return new HumanoidModel(unit, clipping);
}
