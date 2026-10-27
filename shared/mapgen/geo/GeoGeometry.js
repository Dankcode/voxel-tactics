// Small cell-space geometry helpers shared by the place importer and the real-street props.
// (Real-world framing, straightening and terrain live in Geo-voxel now; the game only reads its layers.)

/** Euclidean distance from p to a polyline (closed: back to the first point). */
export function distToPolyline(p, line, closed = false) {
    let best = Infinity;
    const n = closed ? line.length : line.length - 1;
    for (let i = 0; i < n; i++) {
        const [ax, ay] = line[i], [bx, by] = line[(i + 1) % line.length], dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy || 1;
        const t = Math.max(0, Math.min(1, ((p[0] - ax) * dx + (p[1] - ay) * dy) / L));
        best = Math.min(best, Math.hypot(p[0] - ax - t * dx, p[1] - ay - t * dy));
    }
    return best;
}

/** L∞ distance from p to a polyline of axis-aligned segments: square caps and corners on a grid. */
export function distBox(p, line) {
    let best = Infinity;
    for (let i = 1; i < line.length; i++) {
        const [ax, ay] = line[i - 1], [bx, by] = line[i];
        const dx = Math.max(Math.min(ax, bx) - p[0], 0, p[0] - Math.max(ax, bx)), dy = Math.max(Math.min(ay, by) - p[1], 0, p[1] - Math.max(ay, by));
        best = Math.min(best, Math.max(dx, dy));
    }
    return best;
}
