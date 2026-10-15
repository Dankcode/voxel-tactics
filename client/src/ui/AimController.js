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
