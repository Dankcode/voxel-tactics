// PLAN 23 Phase B — one table of how long each encounter event takes to show on screen.
// The client's EventPlayer animates with these numbers and the server paces bot turns with the same
// numbers, so "Your turn" opens when the monsters have actually finished walking and striking.
export const PRESENTATION = Object.freeze({
    walkTilesPerSecond: 4.8,      // ≈ 0.21 s per tile
    rayTilesPerSecond: 14,
    arcSeconds: 0.6,
    pushCellSeconds: 0.12,
    playedFallbackSeconds: 0.25,
    downSeconds: 0.3,
    diedSeconds: 0.35,
    revivedSeconds: 0.2,
    slackMs: 250,                 // network + frame slack added once per batch
    capMs: 4000                   // a long monster turn never holds the party for more than this
});

function pathLength(path = []) {
    let d = 0;
    for (let i = 1; i < path.length; i++) d += Math.hypot(path[i].x - path[i - 1].x, path[i].y - path[i - 1].y, (path[i].z ?? 0) - (path[i - 1].z ?? 0));
    return d;
}
function pointsLength(pts = []) {
    let d = 0;
    for (let i = 1; i < pts.length; i++) d += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y, (pts[i].h ?? 0) - (pts[i - 1].h ?? 0));
    return d;
}

/** Seconds the client spends on one event (0 for instant events such as damage numbers). */
export function eventSeconds(e, P = PRESENTATION) {
    switch (e?.t) {
        case 'moved': return e.path?.length > 1 ? pathLength(e.path) / P.walkTilesPerSecond : 0.05;
        case 'pushed': return Math.max(0.1, (e.path?.length || 0) * P.pushCellSeconds);
        case 'played': {
            const pts = e.trajectory?.points || [];
            if (pts.length < 2) return P.playedFallbackSeconds;
            if (e.trajectory.kind === 'arc') return P.arcSeconds;
            if (e.trajectory.kind === 'path') return pointsLength(pts) / (P.walkTilesPerSecond * 2);
            return Math.max(0.12, pointsLength(pts) / P.rayTilesPerSecond);
        }
        case 'down': return P.downSeconds;
        case 'died': return P.diedSeconds;
        case 'revived': return P.revivedSeconds;
        default: return 0;
    }
}

/** Milliseconds a batch of events needs on screen, with slack, capped. Empty batches need nothing. */
export function presentationMs(events = [], P = PRESENTATION) {
    if (!events.length) return 0;
    const seconds = events.reduce((s, e) => s + eventSeconds(e, P), 0);
    return Math.min(P.capMs, Math.round(seconds * 1000) + P.slackMs);
}
