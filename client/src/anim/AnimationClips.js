// Animation contract between battle events and character art.
//
// The ranger pack supplies running and a one-shot downed sequence. To update the art:
//   1. Replace client/public/assets/characters/<art>/field.png (keep or edit field.json: frame size,
//      columns per clip, fps, loop, anchor, worldHeight).
//   2. Add clips here if a new state is needed, and map battle events to them in EVENT_TO_CLIP.
//   3. Fill in the TODO hooks below (blend, events, per-weapon overrides).

/** Logical clips every character must provide (field.json `clips`). */
export const CLIPS = Object.freeze({
    vault: { loop: false, fallback: 'run', next: 'run' },
    climb: { loop: true, fallback: 'run' },
    idle: { loop: true, fallback: null },
    run: { loop: true, fallback: 'idle' },
    aim: { loop: true, fallback: 'idle' },
    fire: { loop: false, fallback: 'aim', next: 'aim' },
    throw: { loop: false, fallback: 'aim', next: 'idle' },
    hit: { loop: false, fallback: 'idle', next: 'idle' },
    down: { loop: false, fallback: 'hit' },
    stacked: { loop: true, fallback: 'idle' },     // pressed to a wall beside a door (Breach Stack)
    hunker: { loop: true, fallback: 'idle' }       // overwatch / brace stance
});

/** Which clip a battle event drives. `null` = no change. */
export const EVENT_TO_CLIP = Object.freeze({
    move: 'run', shot: 'fire', melee: 'fire', throw: 'throw', damage: 'hit', death: 'down',
    overwatch: 'hunker', reaction: 'fire', breach: 'stacked', knockback: 'hit', fall: 'hit'
});

/** Seconds a one-shot clip should hold the unit before the event player moves on. */
export const CLIP_HOLD = Object.freeze({ fire: 0.35, throw: 0.45, hit: 0.3, down: 0.6 });

/**
 * TODO(animation): per-weapon / per-ability clip overrides, e.g. { longrifle: { fire: 'fire_heavy' } }.
 * The SpriteAnimator asks resolveClip() before playing; return a clip id that exists in field.json.
 */
export function resolveClip(clip, { weaponId = null, art = null } = {}) {
    void weaponId; void art;
    return clip;
}

/**
 * TODO(animation): frame events. field.json `events` lists e.g. { fire: { frame: 0, event: 'muzzle' } }.
 * Hook muzzle flashes, casings, footstep dust, shell ejection here once real art has keyed frames.
 */
export function onClipFrameEvent(unitView, clip, event) {
    void unitView; void clip; void event;
}
