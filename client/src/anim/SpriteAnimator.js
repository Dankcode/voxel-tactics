// Frame-based sprite animation over an atlas described by field.json.
//
// SKELETON: playback, 8-facing selection relative to the camera, one-shot → next-clip chaining and
// frame events are implemented; blending, root motion, layered (upper/lower body) clips and
// per-frame anchors are TODOs for when real art lands.
import { CLIPS, resolveClip, onClipFrameEvent } from './AnimationClips.js';

const ROW_FOR_ANGLE = ['s', 'se', 'e', 'ne', 'n', 'nw', 'w', 'sw'];
export const STILL_CLIPS = new Set(['idle', 'aim', 'stacked', 'hunker']);   // angle index 0..7 at 45° steps

export class SpriteAnimator {
    /** @param manifest field.json; @param texture THREE.Texture whose repeat/offset this animator drives */
    constructor(manifest, texture, owner = null) {
        this.m = manifest; this.texture = texture; this.owner = owner;
        this.clip = 'idle'; this.frame = 0; this.t = 0; this.row = 0; this.queued = null; this.onEnd = null;
        texture.repeat.set(1 / manifest.columns, 1 / manifest.rows);
        this.apply();
    }
    has(clip) { return !!this.m.clips[clip]; }
    /** Play a clip. One-shots return to CLIPS[clip].next (or `then`) when done. */
    play(clip, { then = null, restart = false, weaponId = null, onEnd = null } = {}) {
        let c = resolveClip(clip, { weaponId, art: this.owner?.art });
        while (c && !this.has(c)) c = CLIPS[c]?.fallback;     // missing clips fall back gracefully
        if (!c) return;
        if (c === this.clip && !restart) return;
        this.clip = c; this.frame = 0; this.t = 0; this.queued = then ?? CLIPS[c]?.next ?? null; this.onEnd = onEnd;
        this.apply();
    }
    /** Pick the atlas row from a screen-relative angle (radians, 0 = facing the camera). */
    setScreenAngle(angle) {
        const idx = ((Math.round(angle / (Math.PI / 4)) % 8) + 8) % 8;
        const facing = ROW_FOR_ANGLE[idx];
        // TODO(animation): `mirror` in field.json lets an atlas draw 5 facings and mirror 3 (flip U).
        const row = this.m.facings.indexOf(facing);
        if (row !== this.row && row >= 0) { this.row = row; this.apply(); }
    }
    update(dt) {
        const c = this.m.clips[this.clip];
        if (!c) return;
        // PLAN-11: idle and hold poses are still frames; only actions (run, fire, throw, vault, climb, down) animate.
        if (STILL_CLIPS.has(this.clip)) { if (this.frame) { this.frame = 0; this.apply(); } return; }
        this.t += dt;
        const step = 1 / Math.max(1, c.fps);
        while (this.t >= step) {
            this.t -= step;
            const ev = this.m.events?.[this.clip];
            if (ev && ev.frame === this.frame) onClipFrameEvent(this.owner, this.clip, ev.event);
            if (this.frame + 1 < c.frames) this.frame++;
            else if (c.loop) this.frame = 0;
            else {
                const done = this.onEnd; this.onEnd = null;
                if (this.queued) { const q = this.queued; this.queued = null; this.play(q, { restart: true }); }
                done?.();
                return;
            }
            this.apply();
        }
    }
    apply() {
        const c = this.m.clips[this.clip] || { column: 0 };
        const col = c.column + this.frame;
        this.texture.offset.set(col / this.m.columns, 1 - (this.row + 1) / this.m.rows);
    }
}
