// XCOM-style cover readout derived from the voxels themselves (Phoenix Point-style ballistics do the
// real work; this is what the HUD shields and the AI's tile scoring read).
import { materialById, coverWeight } from './Materials.js';

export const DIRS4 = Object.freeze([
    { id: 'n', dx: 0, dy: -1 }, { id: 'e', dx: 1, dy: 0 }, { id: 's', dx: 0, dy: 1 }, { id: 'w', dx: -1, dy: 0 }
]);
export const COVER = Object.freeze({ NONE: 0, HALF: 1, FULL: 2 });

/** Cover a unit standing on surface (x, y, z) gets from the neighbour in direction d. */
export function coverToward(store, x, y, z, d) {
    const nx = x + d.dx, ny = y + d.dy;
    const low = coverWeight(materialById(store.get(nx, ny, z + 1)));
    const high = coverWeight(materialById(store.get(nx, ny, z + 2)));
    if (low >= 1 && high >= 1) return COVER.FULL;
    if (low >= 1) return COVER.HALF;
    if (high >= 1) return COVER.HALF;          // window gap / overhang still hides the upper body
    return COVER.NONE;
}

/** { n, e, s, w } cover levels at a standing position. */
export function coverAt(store, x, y, z) {
    const out = {};
    for (const d of DIRS4) out[d.id] = coverToward(store, x, y, z, d);
    return out;
}

/** Cover against a shooter at (sx, sy): the best cover among the faces that look toward the shooter. */
export function coverAgainst(store, x, y, z, sx, sy) {
    const dx = sx - x, dy = sy - y;
    let best = COVER.NONE;
    for (const d of DIRS4) {
        const dot = d.dx * dx + d.dy * dy;
        if (dot <= 0) continue;
        // A face counts when the shooter is within ~60° of it.
        const len = Math.hypot(dx, dy) || 1;
        if (dot / len < 0.5) continue;
        best = Math.max(best, coverToward(store, x, y, z, d));
    }
    return best;
}

/** True when no face toward the attacker has cover (XCOM "flanked"). */
export function isFlanked(store, x, y, z, sx, sy) {
    return coverAgainst(store, x, y, z, sx, sy) === COVER.NONE;
}
