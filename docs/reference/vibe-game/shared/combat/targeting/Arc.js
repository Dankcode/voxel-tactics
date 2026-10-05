// PLAN 15A §6.5 — lob arcs: the chord plus a parabolic rise peaking at apexAbs over the midpoint.
//   h(s) = (1 − s)·h0 + s·h1 + 4·k·s·(1 − s),  apexAbs = max(h0, h1) + arcApex,  k = apexAbs − (h0 + h1)/2
import { isProjectileBlocking } from './Solidity.js';

export function traceArc(world, from, to, arcApex) {
    const k = Math.max(from.h, to.h) + arcApex - (from.h + to.h) / 2;
    const horizontal = Math.hypot(to.x - from.x, to.y - from.y);
    const samples = Math.max(4, Math.ceil(Math.hypot(horizontal, 2 * k) / 0.25));
    const points = [];
    for (let i = 0; i <= samples; i++) {
        const s = i / samples;
        const p = { x: from.x + (to.x - from.x) * s, y: from.y + (to.y - from.y) * s,
            h: from.h + (to.h - from.h) * s + 4 * k * s * (1 - s) };
        points.push(p);
        if (i > 0 && i < samples && isProjectileBlocking(world, Math.round(p.x), Math.round(p.y), p.h)) {
            return { ok: false, blockedAt: p, points };
        }
    }
    return { ok: true, points };
}

/** Highest apex ≤ requested that clears every voxel; `apex: null` if even a flat 0.3 m arc is blocked. */
export function fitArc(world, from, to, requestedApex) {
    const first = traceArc(world, from, to, requestedApex);
    if (first.ok) return { apex: requestedApex, ...first };
    let lo = 0.3, hi = requestedApex;
    const flat = traceArc(world, from, to, lo);
    if (!flat.ok) return { ...first, apex: null };
    let best = { apex: lo, ...flat };
    for (let i = 0; i < 6; i++) {                          // 6 halvings → ±5 cm precision
        const mid = (lo + hi) / 2, r = traceArc(world, from, to, mid);
        if (r.ok) { lo = mid; best = { apex: mid, ...r }; } else hi = mid;
    }
    return best;
}
