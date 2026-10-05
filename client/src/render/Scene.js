// Renderer, tactical orthographic camera (4 rotations, zoom, pan), lights and the storey cutaway plane.
import * as THREE from 'three';

const PITCH = Math.atan2(28, Math.hypot(20, 26));          // vibe-game CameraView direction's elevation

export class Scene {
    constructor(canvas) {
        this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
        this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
        this.renderer.localClippingEnabled = true;
        this.renderer.outputColorSpace = THREE.SRGBColorSpace;
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x1d2430);
        this.scene.fog = new THREE.Fog(0x1d2430, 120, 220);
        this.camera = new THREE.OrthographicCamera(-10, 10, 10, -10, -200, 400);
        this.target = new THREE.Vector3(0, 0, 0);
        this.yaw = Math.PI / 4;           // 45°, then 90° steps
        this.yawTarget = this.yaw;
        this.viewHeight = 22;              // world units visible vertically
        this.cutPlane = new THREE.Plane(new THREE.Vector3(0, -1, 0), 1000);
        this.clipping = [this.cutPlane];
        this.shake = 0;
        const hemi = new THREE.HemisphereLight(0xdfe9ff, 0x4a3b2a, 1.4);
        const sun = new THREE.DirectionalLight(0xfff1d6, 1.6);
        sun.position.set(-30, 60, -20);
        this.scene.add(hemi, sun);
        this.resize();
        window.addEventListener('resize', () => this.resize());
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
    zoom(f) { this.viewHeight = Math.max(10, Math.min(90, this.viewHeight * f)); this.updateCamera(); }
    pan(dx, dz) {
        // Pan in screen-aligned ground directions.
        const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw);
        this.target.x += (-fx * dz + fz * dx) * this.viewHeight * 0.02;
        this.target.z += (-fz * dz - fx * dx) * this.viewHeight * 0.02;
    }
    focus(x, y, z) { this.target.set(x, y, z); }
    /** Screen-relative facing: world direction (dx, dy) seen from this camera. Returns radians, 0 = toward camera. */
    screenAngle(dx, dy) {
        // World x → three x, world y → three z. Camera looks along -(sin yaw, cos yaw).
        const a = Math.atan2(dx, dy);
        return a - this.yaw;
    }
    updateCamera(dt = 0) {
        if (Math.abs(this.yawTarget - this.yaw) > 1e-3) this.yaw += (this.yawTarget - this.yaw) * Math.min(1, dt * 8 || 1);
        else this.yaw = this.yawTarget;
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
