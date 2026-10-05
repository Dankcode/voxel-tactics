// PLAN 15A §6.3 — Amanatides–Woo voxel DDA with optional reflections.
// Tile i covers [i − 0.5, i + 0.5) on x and y; voxel z covers [z, z + 1). x/y are shifted by +0.5 internally.
import { isProjectileBlocking } from './Solidity.js';

const axisNormal = (axis, step) => { const n = [0, 0, 0]; if (axis >= 0) n[axis] = -step[axis]; return n; };

/**
 * @returns {{ hitVoxel: {x,y,z}|null, hitPoint, hitNormal?, points: {x,y,h}[], segments: {a,b}[] }}
 * `points` are the polyline vertices (start, each bounce, end); `segments` pair them up for actor tests.
 */
export function castRay(world, from, to, { maxBounces = 0, maxLength } = {}) {
    const points = [{ x: from.x, y: from.y, h: from.h }];
    const segments = [];
    let o = [from.x + 0.5, from.y + 0.5, from.h];
    let d = [to.x - from.x, to.y - from.y, to.h - from.h];
    const length = Math.hypot(d[0], d[1], d[2]);
    let remaining = maxLength ?? length;
    if (length < 1e-9) return { hitVoxel: null, hitPoint: points[0], points, segments };
    d = d.map(c => c / length);
    let bounces = 0;

    for (;;) {
        const cell = o.map(Math.floor);
        const step = d.map(Math.sign);
        const tDelta = d.map(c => (c === 0 ? Infinity : Math.abs(1 / c)));
        const tMax = d.map((c, i) => (c > 0 ? (cell[i] + 1 - o[i]) / c : c < 0 ? (o[i] - cell[i]) / -c : Infinity));
        let t = 0, axis = -1, hit = null;
        if (bounces === 0 && isProjectileBlocking(world, cell[0], cell[1], o[2])) hit = { x: cell[0], y: cell[1], z: cell[2] };
        while (!hit) {
            axis = tMax[0] < tMax[1] ? (tMax[0] < tMax[2] ? 0 : 2) : (tMax[1] < tMax[2] ? 1 : 2);
            t = tMax[axis];
            if (t > remaining) break;                              // reached the end point unobstructed
            cell[axis] += step[axis];
            tMax[axis] += tDelta[axis];
            // Sample height: on a vertical crossing use a point just inside the entered voxel.
            const hh = axis === 2 ? cell[2] + (step[2] > 0 ? 1e-4 : 1 - 1e-4) : o[2] + d[2] * t;
            if (isProjectileBlocking(world, cell[0], cell[1], hh)) { hit = { x: cell[0], y: cell[1], z: Math.floor(hh) }; break; }
        }
        const end = hit ? t : remaining;
        const point = { x: o[0] + d[0] * end - 0.5, y: o[1] + d[1] * end - 0.5, h: o[2] + d[2] * end };
        segments.push({ a: points[points.length - 1], b: point });
        points.push(point);
        if (!hit) return { hitVoxel: null, hitPoint: point, points, segments };
        if (bounces >= maxBounces || axis < 0) return { hitVoxel: hit, hitPoint: point, hitNormal: axisNormal(axis, step), points, segments };

        // Reflect on the crossed axis and continue with the remaining length.
        d[axis] = -d[axis];
        remaining -= end;
        o = [point.x + 0.5 + d[0] * 1e-3, point.y + 0.5 + d[1] * 1e-3, point.h + d[2] * 1e-3];
        bounces++;
    }
}
