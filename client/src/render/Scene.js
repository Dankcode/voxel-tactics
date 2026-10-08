// Renderer, the XCOM-style tactical camera rig (perspective by default, orthographic on V; see CameraRig.js), lighting (sun with soft shadows, sky fill,
// image-based reflections), tone mapping and the storey cutaway plane.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { CameraRig } from './CameraRig.js';

/** Lighting presets (debug panel can switch them). */
export const LIGHTING = {
    day: { sun: 0xfff0d8, sunI: 2.6, sky: 0xc9dcf2, ground: 0x5a4c3a, hemiI: 0.9, env: 0.35, exposure: 1.0, bgTop: '#0d151d', bgBottom: '#2b3843', fog: 0x1b252e, sunDir: [-0.55, 1, -0.35] },
    dusk: { sun: 0xffb27a, sunI: 2.2, sky: 0x7f8fb8, ground: 0x3a2e2a, hemiI: 0.7, env: 0.25, exposure: 1.05, bgTop: '#2c3550', bgBottom: '#c98a63', fog: 0x6d6a78, sunDir: [-0.9, 0.45, -0.2] },
    night: { sun: 0x9fb4ff, sunI: 0.9, sky: 0x31406b, ground: 0x15161c, hemiI: 0.55, env: 0.15, exposure: 1.25, bgTop: '#070b16', bgBottom: '#1b2438', fog: 0x111725, sunDir: [-0.4, 1, 0.5] }
};

export class Scene {
    constructor(canvas) {
        this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
        this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
        this.renderer.localClippingEnabled = true;
        this.renderer.outputColorSpace = THREE.SRGBColorSpace;
        this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFShadowMap;
        this.scene = new THREE.Scene();
        this.rig = new CameraRig(window.innerWidth / Math.max(1, window.innerHeight));
        this.cutPlane = new THREE.Plane(new THREE.Vector3(0, -1, 0), 1000);
        this.clipping = [this.cutPlane];
        this.hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 1);
        this.sun = new THREE.DirectionalLight(0xffffff, 2);
        this.sun.castShadow = true;
        this.sun.shadow.mapSize.set(4096, 4096);
        this.sun.shadow.bias = -0.0004;
        this.sun.shadow.normalBias = 0.04;
        this.sun.shadow.radius = 3;
        // A cool back light (no shadows) separates silhouettes and makes vertical faces facing away from the sun read
        // as walls rather than voids.
        this.back = new THREE.DirectionalLight(0x9fb8ff, 0.55);
        this.scene.add(this.hemi, this.sun, this.sun.target, this.back, this.back.target);
        this.ao = true;
        const pmrem = new THREE.PMREMGenerator(this.renderer);
        this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
        this.setBounds(60, 46, 16);
        this.setLighting('day');
        this.resize();
        window.addEventListener('resize', () => this.resize());
    }
    // ---- camera state lives on the rig; these keep the old Scene API (target, yaw, glide, shake, viewHeight).
    get camera() { return this.rig.camera; }
    get target() { return this.rig.target; }
    get yaw() { return this.rig.yaw; }
    get yawTarget() { return this.rig.yawTarget; }
    get glide() { return this.rig.glide; }
    set glide(v) { this.rig.glide = v; }
    get shake() { return this.rig.shake; }
    set shake(v) { this.rig.shake = v; }
    get viewHeight() { return this.rig.viewHeight; }
    set viewHeight(h) { this.rig.viewHeight = h; }
    get projection() { return this.rig.mode; }
    /** 'perspective' (default) or 'ortho' (the old isometric look); the AO passes follow the active camera. */
    setProjection(mode) {
        this.rig.setMode(mode);
        this.syncPassCamera();
        return this.rig.mode;
    }
    toggleProjection() { return this.setProjection(this.rig.isOrtho ? 'perspective' : 'ortho'); }
    syncPassCamera() {
        if (!this.composer) return;
        const cam = this.camera;
        this.renderPass.camera = cam;
        const g = this.gtao;
        if (g && g.camera !== cam) {
            g.camera = cam;
            for (const m of [g.gtaoMaterial, g.depthRenderMaterial]) {
                if (!m?.defines || !('PERSPECTIVE_CAMERA' in m.defines)) continue;
                m.defines.PERSPECTIVE_CAMERA = cam.isPerspectiveCamera ? 1 : 0;
                m.needsUpdate = true;
            }
        }
    }
    setLighting(name) {
        const L = LIGHTING[name] || LIGHTING.day;
        this.lightingName = name;
        this.sun.color.set(L.sun); this.sun.intensity = L.sunI;
        this.hemi.color.set(L.sky); this.hemi.groundColor.set(L.ground); this.hemi.intensity = L.hemiI;
        this.scene.environmentIntensity = L.env;
        this.renderer.toneMappingExposure = L.exposure;
        this.scene.background = gradientTexture(L.bgTop, L.bgBottom);
        this.scene.fog = new THREE.Fog(L.fog, 160, 320);
        this.sunDir = new THREE.Vector3(...L.sunDir).normalize();
        this.back.intensity = (L.backI ?? 0.55);
        this.placeSun();
    }
    /** Fit the sun's shadow camera to the battlefield. */
    setBounds(w, d, h) {
        this.bounds = { w, d, h };
        this.rig.setBounds(w, d);
        const r = Math.hypot(w, d) / 2 + 2;
        const cam = this.sun.shadow.camera;
        Object.assign(cam, { left: -r, right: r, top: r, bottom: -r, near: 1, far: r * 4 + h * 2 });
        cam.updateProjectionMatrix();
        this.placeSun();
    }
    placeSun() {
        if (!this.bounds || !this.sunDir) return;
        const { w, d } = this.bounds, c = new THREE.Vector3(w / 2, 0, d / 2), r = Math.hypot(w, d);
        this.sun.target.position.copy(c);
        this.sun.position.copy(c).addScaledVector(this.sunDir, r * 1.5);
        this.sun.target.updateMatrixWorld();
        this.back.target.position.copy(c);
        this.back.position.copy(c).add(new THREE.Vector3(-this.sunDir.x, 0.6, -this.sunDir.z).normalize().multiplyScalar(r));
        this.back.target.updateMatrixWorld();
    }
    /** Ambient occlusion (GTAO) through an EffectComposer; overlays, sprites and transparent things are left out. */
    setAO(on) { this.ao = on; if (on && !this.composer) this.makeComposer(); }
    makeComposer() {
        const w = window.innerWidth, h = window.innerHeight;
        this.composer = new EffectComposer(this.renderer);
        this.renderPass = new RenderPass(this.scene, this.camera);
        this.composer.addPass(this.renderPass);
        const gtao = new GTAOPass(this.scene, this.camera, w, h, undefined, { radius: 0.9, distanceExponent: 1.4, thickness: 1.2, scale: 1.1, samples: 12 });
        gtao.blendIntensity = 0.85;
        const base = gtao._overrideVisibility.bind(gtao);
        gtao._overrideVisibility = () => {
            base();
            this.scene.traverse(o => {
                if (!o.visible) return;
                const m = o.material;
                if (o.userData.noAO || o.isSprite || (m && !Array.isArray(m) && m.transparent)) { o.visible = false; gtao._visibilityCache.push(o); }
            });
        };
        this.gtao = gtao;
        this.composer.addPass(gtao);
        this.composer.addPass(new OutputPass());
        this.composer.setSize(w, h);
        this.composer.setPixelRatio(this.renderer.getPixelRatio());
        this.syncPassCamera();
    }
    resize() {
        const w = window.innerWidth, h = window.innerHeight;
        this.renderer.setSize(w, h, false);
        this.composer?.setSize(w, h);
        this.aspect = w / h;
        this.rig.setAspect(this.aspect);
        this.updateCamera();
    }
    /** Cut everything above world height `y` (storey cutaway); Infinity disables it. */
    // Slightly above the cut so the dark section caps (y = cut + 0.001 … 0.026) survive and cut wall tops don't shimmer.
    setCut(y) { this.cutPlane.constant = Number.isFinite(y) ? y + 0.04 : 1000; this.cutLevel = y; }
    rotate(steps) { this.rig.rotate(steps); }
    /** Smooth zoom: f > 1 zooms out (eased in updateCamera). */
    zoom(f) { this.rig.zoom(f); }
    pan(dx, dz) { this.rig.pan(dx, dz); }
    focus(x, y, z) { this.rig.target.set(x, y, z); this.rig.clamp(); }
    /** Smoothly move the camera target (XCOM camera follow). */
    glideTo(v, speed = 6) { this.rig.glideTo(v, speed); }
    /** Screen-relative facing: world direction (dx, dy) seen from this camera. Returns radians, 0 = toward camera. */
    screenAngle(dx, dy) {
        const a = Math.atan2(dx, dy);
        return a - this.yaw;
    }
    /** dt 0 snaps the eased yaw / zoom (used on resize and mission start). */
    updateCamera(dt = 0) { this.rig.update(dt); }
    render(dt) {
        this.shake = Math.max(0, this.shake - dt * 3);
        this.updateCamera(dt);
        if (this.ao) { if (!this.composer) this.makeComposer(); this.composer.render(dt); }
        else this.renderer.render(this.scene, this.camera);
    }
    /** Ray from the camera through a screen pixel, in world coordinates (three space). */
    rayAt(px, py) {
        const ndc = new THREE.Vector2(px / window.innerWidth * 2 - 1, -(py / window.innerHeight) * 2 + 1);
        const ray = new THREE.Raycaster();
        ray.setFromCamera(ndc, this.camera);
        return ray;
    }
    project(v) {
        const p = v.clone().project(this.camera);
        return { x: (p.x + 1) / 2 * window.innerWidth, y: (1 - p.y) / 2 * window.innerHeight, visible: p.z > -1 && p.z < 1 };
    }
}

function gradientTexture(top, bottom) {
    const c = document.createElement('canvas'); c.width = 4; c.height = 256;
    const g = c.getContext('2d'), grad = g.createLinearGradient(0, 0, 0, 256);
    grad.addColorStop(0, top); grad.addColorStop(1, bottom);
    g.fillStyle = grad; g.fillRect(0, 0, 4, 256);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
    return t;
}
