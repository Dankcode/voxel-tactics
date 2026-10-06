// Renderer, tactical orthographic camera (4 rotations, zoom, pan), lighting (sun with soft shadows, sky fill,
// image-based reflections), tone mapping and the storey cutaway plane.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

const PITCH = Math.atan2(28, Math.hypot(20, 26));          // vibe-game CameraView direction's elevation

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
        this.camera = new THREE.OrthographicCamera(-10, 10, 10, -10, -200, 400);
        this.target = new THREE.Vector3(0, 0, 0);
        this.yaw = Math.PI / 4;           // 45°, then 90° steps
        this.yawTarget = this.yaw;
        this.viewHeight = 22;              // world units visible vertically
        this.cutPlane = new THREE.Plane(new THREE.Vector3(0, -1, 0), 1000);
        this.clipping = [this.cutPlane];
        this.shake = 0;
        this.hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 1);
        this.sun = new THREE.DirectionalLight(0xffffff, 2);
        this.sun.castShadow = true;
        this.sun.shadow.mapSize.set(4096, 4096);
        this.sun.shadow.bias = -0.0004;
        this.sun.shadow.normalBias = 0.04;
        this.sun.shadow.radius = 3;
        this.scene.add(this.hemi, this.sun, this.sun.target);
        const pmrem = new THREE.PMREMGenerator(this.renderer);
        this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
        this.setBounds(60, 46, 16);
        this.setLighting('day');
        this.resize();
        window.addEventListener('resize', () => this.resize());
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
        this.placeSun();
    }
    /** Fit the sun's shadow camera to the battlefield. */
    setBounds(w, d, h) {
        this.bounds = { w, d, h };
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
    }
    resize() {
        const w = window.innerWidth, h = window.innerHeight;
        this.renderer.setSize(w, h, false);
        this.aspect = w / h;
        this.updateCamera();
    }
    /** Cut everything above world height `y` (storey cutaway); Infinity disables it. */
    setCut(y) { this.cutPlane.constant = Number.isFinite(y) ? y : 1000; this.cutLevel = y; }
    rotate(steps) { this.yawTarget += steps * Math.PI / 2; }
    zoom(f) { this.viewHeight = Math.max(8, Math.min(90, this.viewHeight * f)); this.updateCamera(); }
    pan(dx, dz) {
        // Pan in screen-aligned ground directions.
        const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw);
        this.target.x += (-fx * dz + fz * dx) * this.viewHeight * 0.02;
        this.target.z += (-fz * dz - fx * dx) * this.viewHeight * 0.02;
    }
    focus(x, y, z) { this.target.set(x, y, z); }
    /** Smoothly move the camera target (XCOM camera follow). */
    glideTo(v, speed = 6) { this.glide = { to: v.clone(), speed }; }
    /** Screen-relative facing: world direction (dx, dy) seen from this camera. Returns radians, 0 = toward camera. */
    screenAngle(dx, dy) {
        const a = Math.atan2(dx, dy);
        return a - this.yaw;
    }
    updateCamera(dt = 0) {
        if (Math.abs(this.yawTarget - this.yaw) > 1e-3) this.yaw += (this.yawTarget - this.yaw) * Math.min(1, dt * 8 || 1);
        else this.yaw = this.yawTarget;
        if (this.glide && dt) {
            this.target.lerp(this.glide.to, Math.min(1, dt * this.glide.speed));
            if (this.target.distanceTo(this.glide.to) < 0.02) this.glide = null;
        }
        const h = this.viewHeight, w = h * this.aspect;
        Object.assign(this.camera, { left: -w / 2, right: w / 2, top: h / 2, bottom: -h / 2 });
        const d = 120;
        const off = new THREE.Vector3(Math.sin(this.yaw) * Math.cos(PITCH), Math.sin(PITCH), Math.cos(this.yaw) * Math.cos(PITCH)).multiplyScalar(d);
        const jitter = this.shake > 0 ? new THREE.Vector3((Math.random() - 0.5) * this.shake, (Math.random() - 0.5) * this.shake, 0) : new THREE.Vector3();
        this.camera.position.copy(this.target).add(off).add(jitter);
        this.camera.lookAt(this.target.clone().add(jitter));
        this.camera.updateProjectionMatrix();
    }
    render(dt) {
        this.shake = Math.max(0, this.shake - dt * 3);
        this.updateCamera(dt);
        this.renderer.render(this.scene, this.camera);
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
        return { x: (p.x + 1) / 2 * window.innerWidth, y: (1 - p.y) / 2 * window.innerHeight, visible: p.z < 1 };
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
