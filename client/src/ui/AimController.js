// PLAN-07 third-person aim feel. The cursor sets where you want to aim; the aim point follows it through a
// critically damped spring whose time constant grows with the weapon's weight (and wounded arms), plus a slow
// figure-eight sway that grows with stress and suppression. The shot fires at the current aim point, so flicking and
// firing at once is less accurate, as in a shooter. Presentation-side only: the intent carries the exact point.
import { WEAPONS } from '../../../shared/content/weapons.js';

/** Seconds for the aim to settle: light guns are snappy, a sniper rifle swings slowly. */
export const AIM_TAU = Object.freeze({ pistol: 0.08, rifle: 0.14, shotgun: 0.16, sniper: 0.22 });
export function aimClass(w) {
    if (!w) return 'rifle';
    if (w.id === 'handcannon' || w.ap <= 1) return 'pistol';
    if (w.pellets || w.id === 'blunderbuss') return 'shotgun';
    if (w.id === 'longrifle' || w.scoped || w.ap >= 3) return 'sniper';
    return 'rifle';
}
export function aimTau(u, w = WEAPONS[u?.weapon]) {
    const arms = ['armL', 'armR'].filter(p => u?.parts?.[p]?.disabled || u?.parts?.[p]?.hp === 0).length;
    return AIM_TAU[aimClass(w)] * (1 + 0.1 * arms);
}
/** Sway half-amplitude in degrees: 0 when braced or under Deadeye; more with stress and suppression. */
export function swayDegrees(u) {
    if (!u || u.buffs?.deadeye || u.buffs?.braced || u.braced) return 0;
    const suppressed = u.statuses?.some?.(s => s.id === 'suppressed') ? 2 : 1;
    return 0.12 * (1 + (u.stress || 0) / 60) * suppressed;
}

/** Pitch limit for relative aiming (radians from level). */
export const AIM_PITCH_LIMIT = 70 * Math.PI / 180;
/**
 * Relative aim: turn the line origin→focus by a cursor motion of (dx, dy) CSS px. One px is fov/height radians at
 * sensitivity 1 (about a screen pixel); the distance to the focus is kept. Returns the new point {x, y, h}.
 */
export function aimDelta(focus, origin, dx, dy, { fov = 38, height = 720, sensitivity = 0.5 } = {}) {
    if (!focus || !origin || (!dx && !dy)) return null;
    const vx = focus.x - origin.x, vy = focus.y - origin.y, vh = focus.h - origin.h;
    const dist = Math.hypot(vx, vy, vh); if (dist < 1e-6) return null;
    const k = (fov * Math.PI / 180) / Math.max(1, height) * sensitivity;
    // Screen right is clockwise seen from above (x east, y south): yaw grows with dx; screen down lowers the pitch.
    const yaw = Math.atan2(vy, vx) + dx * k;
    const pitch = Math.max(-AIM_PITCH_LIMIT, Math.min(AIM_PITCH_LIMIT, Math.atan2(vh, Math.hypot(vx, vy)) - dy * k));
    const flat = Math.cos(pitch) * dist;
    return { x: origin.x + Math.cos(yaw) * flat, y: origin.y + Math.sin(yaw) * flat, h: origin.h + Math.sin(pitch) * dist };
}

/** Arm/gun lag in radians, independent of camera tracking, zoom and reticle screen position.
 * The heavy weapon trails a turn and returns to its authored pose as the same ballistic spring settles.
 * Only the articulated arms move; the torso and stock contact remain anchored.
 */
export function aimSpriteInertia(current, target, origin) {
    if (!current || !target || !origin) return { yaw: 0, pitch: 0 };
    const angles = p => {
        const x=p.x-origin.x,y=p.y-origin.y,h=p.h-origin.h;
        return Math.hypot(x,y,h)<1e-6 ? null : { yaw:Math.atan2(y,x), pitch:Math.atan2(h,Math.hypot(x,y)) };
    };
    const c=angles(current),t=angles(target);
    if (!c || !t) return { yaw: 0, pitch: 0 };
    const delta=c.yaw-t.yaw,wrap=Math.atan2(Math.sin(delta),Math.cos(delta));
    const clamp=(v,max)=>Math.max(-max,Math.min(max,v));
    return { yaw:clamp(wrap,.12), pitch:clamp(t.pitch-c.pitch,.09) };
}

export class AimController {
    constructor() { this.target = null; this.current = null; this.vel = [0, 0, 0]; this.t = 0; }
    /** Jump straight to a point (entering aim mode, or with inertia turned off). */
    snap(p) { this.target = { ...p }; this.current = { ...p }; this.vel = [0, 0, 0]; }
    setTarget(p) { if (!this.current) return this.snap(p); this.target = { ...p }; }
    clear() { this.target = this.current = null; this.vel = [0, 0, 0]; }
    get settled() { return !this.current || (Math.hypot(this.target.x - this.current.x, this.target.y - this.current.y, this.target.h - this.current.h) < 0.02 && Math.hypot(...this.vel) < 0.05); }
    /**
     * Advance the spring by dt seconds (semi-implicit Euler with sub-steps; critically damped, ω = 2 / τ).
     * Returns the current aim point including sway, or null when not aiming.
     */
    step(dt, { tau = AIM_TAU.rifle, sway = 0, origin = null, inertia = true } = {}) {
        if (!this.current) return null;
        if (!inertia || tau <= 0) { this.current = { ...this.target }; this.vel = [0, 0, 0]; }
        else {
            const w = 2 / tau, n = Math.max(1, Math.ceil(dt / 0.008)), h = dt / n;
            const keys = ['x', 'y', 'h'];
            for (let k = 0; k < n; k++) keys.forEach((c, i) => {
                const a = w * w * (this.target[c] - this.current[c]) - 2 * w * this.vel[i];
                this.vel[i] += a * h; this.current[c] += this.vel[i] * h;
            });
        }
        this.t += dt;
        return this.point({ sway, origin });
    }
    /** Current aim point with a slow figure-eight sway perpendicular to the line of fire. */
    point({ sway = 0, origin = null } = {}) {
        if (!this.current) return null;
        if (!sway || !origin) return { ...this.current };
        const dx = this.current.x - origin.x, dy = this.current.y - origin.y, dh = this.current.h - origin.h;
        const dist = Math.hypot(dx, dy, dh) || 1, flat = Math.hypot(dx, dy) || 1;
        const amp = dist * Math.tan(sway * Math.PI / 180);
        const s1 = Math.sin(this.t * 0.9) * amp, s2 = Math.sin(this.t * 1.8) * amp * 0.5;
        // right = horizontal perpendicular, up = world up.
        return { x: this.current.x + (-dy / flat) * s1, y: this.current.y + (dx / flat) * s1, h: this.current.h + s2 };
    }
}
