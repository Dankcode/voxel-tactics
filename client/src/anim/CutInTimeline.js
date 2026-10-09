// Keyframed timeline for the action-phase back shot (PLAN-01 §11.2).
//
// SKELETON: tracks of numeric keyframes with easing, sampled each frame. CutInDirector builds one per
// cut-in from the presets below. Real art can replace presets with authored timelines (e.g. exported
// from a tool as JSON with the same shape) — the director only calls sample().

export const EASE = {
    linear: t => t,
    outCubic: t => 1 - (1 - t) ** 3,
    inCubic: t => t ** 3,
    inOutSine: t => -(Math.cos(Math.PI * t) - 1) / 2,
    outBack: t => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2; }
};

export class CutInTimeline {
    /** tracks: { name: [[time, value, ease?], ...] } (times in seconds, ascending) */
    constructor(duration, tracks) { this.duration = duration; this.tracks = tracks; }
    sample(t) {
        const out = {};
        for (const [name, keys] of Object.entries(this.tracks)) {
            if (t <= keys[0][0]) { out[name] = keys[0][1]; continue; }
            const last = keys[keys.length - 1];
            if (t >= last[0]) { out[name] = last[1]; continue; }
            for (let i = 1; i < keys.length; i++) {
                if (t <= keys[i][0]) {
                    const [t0, v0] = keys[i - 1], [t1, v1, ease = 'outCubic'] = keys[i];
                    const k = (EASE[ease] || EASE.linear)((t - t0) / (t1 - t0));
                    out[name] = v0 + (v1 - v0) * k;
                    break;
                }
            }
        }
        return out;
    }
}

/**
 * Presets per cut-in kind. Values: slide (0 = off-screen left, 1 = in place), push (zoom), bars (letterbox
 * 0..1), flash (0..1), text (0..1 opacity), dolly (camera 0..1 along its move).
 * TODO(animation): per-character overrides (a brute stomps in, a marksman settles the rifle).
 */
export const PRESETS = {
    shot: (d = 1.25) => new CutInTimeline(d, {
        bars: [[0, 0], [0.15, 1], [d - 0.2, 1], [d, 0, 'inCubic']],
        slide: [[0, 0], [0.32, 1, 'outBack'], [d - 0.15, 1], [d, 1.15, 'inCubic']],
        push: [[0, 1], [d, 1.08, 'inOutSine']],
        text: [[0.2, 0], [0.4, 1], [d - 0.2, 1], [d, 0]],
        flash: [[0, 0], [d - 0.35, 0], [d - 0.3, 1, 'linear'], [d - 0.12, 0]],
        dolly: [[0, 0], [d, 1, 'inOutSine']]
    }),
    skill: d => PRESETS.shot(d ?? 1.4),
    burst: d => PRESETS.shot(d ?? 1.35),
    heavy: d => PRESETS.shot(d ?? 1.6),
    melee: (d = 1.1) => new CutInTimeline(d, {
        bars: [[0, 0], [0.12, 1], [d - 0.15, 1], [d, 0]],
        slide: [[0, 0], [0.25, 1, 'outBack'], [d - 0.3, 1], [d - 0.15, 1.3, 'inCubic'], [d, 1.3]],
        push: [[0, 1], [d, 1.15, 'inCubic']],
        text: [[0.15, 0], [0.3, 1], [d - 0.2, 1], [d, 0]],
        flash: [[0, 0], [d - 0.25, 0], [d - 0.2, 1, 'linear'], [d, 0]],
        dolly: [[0, 0], [d, 1]]
    }),
    throw: (d = 1.2) => PRESETS.shot(d),
    breach: (d = 1.7) => new CutInTimeline(d, {
        bars: [[0, 0], [0.15, 1], [d - 0.2, 1], [d, 0]],
        slide: [[0, 0], [0.45, 1, 'outBack'], [d - 0.2, 1], [d, 1.2, 'inCubic']],
        push: [[0, 1], [d, 1.05]],
        text: [[0.25, 0], [0.45, 1], [d - 0.2, 1], [d, 0]],
        flash: [[0, 0], [d - 0.4, 0], [d - 0.35, 1, 'linear'], [d - 0.1, 0]],
        dolly: [[0, 0], [d, 1]]
    })
};
