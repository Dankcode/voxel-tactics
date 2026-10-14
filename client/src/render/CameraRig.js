// XCOM 2-style tactical camera rig. Owns a perspective camera (default) and an orthographic one (the old
// isometric look, toggled with V) that share one state: a ground target, a yaw (45° + 90° steps, eased; free
// while orbiting with the middle mouse), an eased zoom distance with a stable tactical pitch, smooth
// key / edge panning with momentum, grab-the-ground drag panning, the follow glide and the hit shake.
//
// World coords: three x = grid x, three y = height, three z = grid y.
import * as THREE from 'three';

const DEG = Math.PI / 180;
export const FOV = 38;                                       // vertical, degrees
const TACTICAL_PITCH = 45 * DEG;
const ORTHO_PITCH = TACTICAL_PITCH;
const MIN_DIST = 8, MAX_DIST = 110, DEFAULT_DIST = 27;
const PITCH_MIN = 30 * DEG, PITCH_MAX = 85 * DEG;             // clamp for the orbit tilt
const VH_PER_DIST = 22 / 36;                        // ortho frustum height per unit of distance (default = old 22)
const STEP = Math.PI / 2, BASE = Math.PI / 4;
const MARGIN = 2;                                             // how far the target may leave the map
const ease = (rate, dt) => 1 - Math.exp(-rate * dt);

export class CameraRig {
    constructor(aspect = 1) {
        this.aspect = aspect;
        this.persp = new THREE.PerspectiveCamera(FOV, aspect, 0.5, 900);
        this.ortho = new THREE.OrthographicCamera(-10, 10, 10, -10, -200, 400);
        this.mode = 'perspective';
        this.target = new THREE.Vector3();
        this.yaw = BASE; this.yawTarget = BASE;
        this.distance = DEFAULT_DIST; this.distanceTarget = DEFAULT_DIST;
        this.pitchOffset = 0;                                  // user tilt from middle-mouse orbit
        this.panIntent = new THREE.Vector2();                  // x = right, y = forward, each -1..1 (keys + edges)
        this.panVel = new THREE.Vector3();
        this.glide = null;
        this.shake = 0;
        this.bounds = null;
        this._tmp = new THREE.Vector3();
    }
    get camera() { return this.mode === 'ortho' ? this.ortho : this.persp; }
    get isOrtho() { return this.mode === 'ortho'; }
    setMode(mode) { this.mode = mode === 'ortho' ? 'ortho' : 'perspective'; this.apply(); }
    toggleMode() { this.setMode(this.isOrtho ? 'perspective' : 'ortho'); return this.mode; }
    setAspect(a) { this.aspect = a; this.apply(); }
    setBounds(w, d) { this.bounds = { w, d }; this.clamp(); }

    /** Ortho-equivalent "world units visible vertically" (kept for older callers: scene.viewHeight = 34). */
    get viewHeight() { return this.distance * VH_PER_DIST; }
    set viewHeight(h) { this.distance = this.distanceTarget = clampN(h / VH_PER_DIST, MIN_DIST, MAX_DIST); }

    pitch() {
        return clampN((this.isOrtho ? ORTHO_PITCH : TACTICAL_PITCH) + this.pitchOffset, PITCH_MIN, PITCH_MAX);
    }
    setPreset(name) {
        this.pitchOffset=(name==='plan'?85:45)*DEG-TACTICAL_PITCH;
        const yaw={N:0,E:90,S:180,W:270,iso:45}[name];if(yaw!==undefined)this.yawTarget=yaw*DEG;this.apply();
    }
    resetTactical() {
        this.mode='perspective';this.yaw=this.yawTarget=BASE;
        this.distance=this.distanceTarget=DEFAULT_DIST;this.pitchOffset=0;
        this.panIntent.set(0,0);this.panVel.set(0,0,0);this.glide=null;this.shake=0;this.apply();
    }
    /** Q/E: 90° steps on the 45° grid. After a free orbit the next press snaps to the next step that way. */
    rotate(steps) {
        const k = (this.yawTarget - BASE) / STEP, r = Math.round(k);
        if (Math.abs(k - r) > 0.02) this.yawTarget = BASE + (steps > 0 ? Math.ceil(k) : Math.floor(k)) * STEP;
        else this.yawTarget = BASE + (r + steps) * STEP;
    }
    /** Middle-mouse orbit: free yaw and a clamped tilt (pixels in). */
    orbit(dxPx, dyPx) {
        this.yaw -= dxPx * 0.006; this.yawTarget = this.yaw;
        const base = this.pitch() - this.pitchOffset;
        this.pitchOffset = clampN(this.pitchOffset + dyPx * 0.004, PITCH_MIN - base, PITCH_MAX - base);
    }
    /** Smooth zoom: multiply the target distance (eased in update). */
    zoom(f) { this.distanceTarget = clampN(this.distanceTarget * f, MIN_DIST, MAX_DIST); }
    /** Held-input panning (keys / screen edges), screen-relative; any input cancels the follow glide. */
    setPanIntent(right, forward) {
        this.panIntent.set(right, forward);
        if (right || forward) this.glide = null;
    }
    /** Immediate screen-relative pan in "old" units (fraction of the view per call) — kept for compatibility. */
    pan(dx, dz) {
        const s = this.viewHeight * 0.02;
        this.moveBy(dx * s, dz * s);
    }
    moveBy(right, forward) {
        const sy = Math.sin(this.yaw), cy = Math.cos(this.yaw);
        this.target.x += cy * right - sy * forward;
        this.target.z += -sy * right - cy * forward;
        this.clamp();
    }
    glideTo(v, speed = 6) { this.glide = { to: v.clone(), speed }; }
    clamp() {
        if (!this.bounds) return;
        const { w, d } = this.bounds;
        this.target.x = clampN(this.target.x, -MARGIN, w + MARGIN);
        this.target.z = clampN(this.target.z, -MARGIN, d + MARGIN);
        this.target.y=Math.max(this.minLayerHeight??0,this.target.y);
    }
    /** Where a screen ray meets the horizontal plane through the target (grab-the-ground panning). */
    groundPoint(raycaster, y = this.target.y) {
        const r = raycaster.ray;
        if (Math.abs(r.direction.y) < 1e-4) return null;
        const t = (y - r.origin.y) / r.direction.y;
        if (t < 0 && !this.isOrtho) return null;
        return r.origin.clone().addScaledVector(r.direction, t);
    }
    update(dt = 0) {
        if (!dt) {                                           // dt 0 = snap (resize, mission start)
            this.yaw = this.yawTarget; this.distance = this.distanceTarget;
            return this.apply();
        }
        this.yaw += Math.abs(this.yawTarget - this.yaw) > 1e-4 ? (this.yawTarget - this.yaw) * ease(9*(this.rotationSpeed||1), dt) : this.yawTarget - this.yaw;
        this.distance += Math.abs(this.distanceTarget - this.distance) > 1e-3 ? (this.distanceTarget - this.distance) * ease(10, dt) : this.distanceTarget - this.distance;
        // Key / edge pan with a little momentum; speed scales with the zoom distance.
        const sy = Math.sin(this.yaw), cy = Math.cos(this.yaw), speed = this.distance * 0.65;
        const ix = this.panIntent.x, iz = this.panIntent.y, n = Math.hypot(ix, iz) > 1 ? Math.hypot(ix, iz) : 1;
        const want = this._tmp.set((cy * ix - sy * iz) / n, 0, (-sy * ix - cy * iz) / n).multiplyScalar(speed);
        this.panVel.lerp(want, ease(ix || iz ? 10 : 14, dt));
        if (this.panVel.lengthSq() > 1e-6) { this.target.addScaledVector(this.panVel, dt); this.clamp(); }
        else this.panVel.set(0, 0, 0);
        if (this.glide) {
            this.target.lerp(this.glide.to, Math.min(1, dt * this.glide.speed));
            this.clamp();
            if (this.target.distanceTo(this.glide.to) < 0.02) this.glide = null;
        }
        this.apply();
    }
    /** Place both cameras from the current state (the inactive one too, so a V toggle is seamless). */
    apply() {
        const p = this.pitch(), yaw = this.yaw;
        const dir = new THREE.Vector3(Math.sin(yaw) * Math.cos(p), Math.sin(p), Math.cos(yaw) * Math.cos(p));
        let jitter = null;
        if (this.shake > 0) {
            const right = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw)), up = new THREE.Vector3(0, 1, 0);
            jitter = right.multiplyScalar((Math.random() - 0.5) * this.shake).addScaledVector(up, (Math.random() - 0.5) * this.shake);
        }
        const look = this.target.clone(); if (jitter) look.add(jitter);
        // Perspective.
        const pc = this.persp;
        pc.aspect = this.aspect;
        pc.position.copy(look).addScaledVector(dir, this.distance);
        pc.lookAt(look);
        pc.updateProjectionMatrix(); pc.updateMatrixWorld();
        // Orthographic (old look: fixed far placement, frustum sized from the zoom).
        const oc = this.ortho, h = this.viewHeight, w = h * this.aspect;
        Object.assign(oc, { left: -w / 2, right: w / 2, top: h / 2, bottom: -h / 2 });
        oc.position.copy(look).addScaledVector(dir, 120);
        oc.lookAt(look);
        oc.updateProjectionMatrix(); oc.updateMatrixWorld();
    }
}

function clampN(v, a, b) { return Math.max(a, Math.min(b, v)); }
