// PLAN-07 balance: generated districts field three enemy pods (7 hostiles) plus, since PLAN-09, one walker monster, like the hand-built maps (Cedar Close: 7
// in 4 pods). Two pods hold the farthest buildings, one patrols the street near the target end of the map.
export const DISTRICT_PODS = Object.freeze([
    { group: 0, units: ['warden_foe', 'cultist', 'archer'] },
    { group: 1, units: ['brute', 'cultist'] },
    { group: 2, units: ['archer', 'cultist'], street: true },
    // PLAN-09: a walker monster prowls the street (melee; smashes through buildings). Left out if it cannot fit.
    { group: 5, units: ['wall_strider'], street: true, monster: true }
]);
/**
 * far: buildings sorted farthest first; fallback: [{x,y,z}, {x,y,z}] when a pod has no building; street: {x,y,z}.
 * Returns spawn specs for MissionCommon (room specs spread over the building's rooms by index).
 */
export function districtPods(far, { fallback = [], street = null } = {}) {
    const out = [];
    DISTRICT_PODS.forEach((pod, p) => {
        pod.units.forEach((type, i) => {
            if (pod.street) {
                const s = street || fallback[1] || fallback[0];
                if (s) out.push({ type, group: pod.group, at: pod.monster ? { x: s.x, y: s.y - 6, z: s.z } : { x: s.x + (i % 2 ? 2 : -2), y: s.y + (i > 1 ? 2 : 0), z: s.z } });
                return;
            }
            const b = far[p];
            if (b) out.push({ type, group: pod.group, room: { building: b.id, index: i } });
            else if (fallback[p]) out.push({ type, group: pod.group, at: { x: fallback[p].x + i * 2, y: fallback[p].y, z: fallback[p].z } });
        });
    });
    return out;
}

/**
 * PLAN-15: XCOM 2 encounter zones for districts and real places. Instead of every pod holding the buildings farthest
 * from the insertion (which piles the whole force into one corner), the pods are posted along the line from the
 * insertion to the objective: the main pod holds the objective building, a second pod a building around two thirds
 * of the way, the street pod about 40 % of the way out, the walker beside the street near the objective — each at
 * least `spacing` tiles from the others and 16 from the insertion.
 *   buildings: building records (x0, y0, w, d, id, rooms); objective: the objective record (or null);
 *   roadCells: [{x, y, z}] street tiles; spawn, goal: {x, y}.
 */
export function zonedDistrictPods(buildings, { spawn, goal, objective = null, roadCells = [], spacing = 12, fallback = [] } = {}) {
    const centre = b => ({ x: b.x0 + b.w / 2, y: b.y0 + b.d / 2 });
    const L = Math.hypot(goal.x - spawn.x, goal.y - spawn.y) || 1, ux = (goal.x - spawn.x) / L, uy = (goal.y - spawn.y) / L;
    const along = p => ((p.x - spawn.x) * ux + (p.y - spawn.y) * uy) / L;
    const off = p => Math.abs((p.x - spawn.x) * uy - (p.y - spawn.y) * ux);
    const posts = [], out = [];
    const far = (p, min) => posts.every(o => Math.hypot(o.x - p.x, o.y - p.y) >= min) && Math.hypot(p.x - spawn.x, p.y - spawn.y) >= 16;
    const pick = (list, at, key) => {
        for (const min of [spacing, spacing * 0.75, spacing * 0.5]) {
            const c = list.filter(p => far(key(p), min)).sort((a, b) => (Math.abs(along(key(a)) - at) + off(key(a)) / L * 0.6) - (Math.abs(along(key(b)) - at) + off(key(b)) / L * 0.6))[0];
            if (c) return c;
        }
        return null;
    };
    const roomed = buildings.filter(b => b.rooms?.length && (b.wing ?? 0) === 0);
    DISTRICT_PODS.forEach((pod, p) => {
        let target = null;
        if (pod.street) {
            const s = pick(roadCells, pod.monster ? 0.8 : 0.42, c => c) || fallback[1] || fallback[0];
            if (!s) return;
            posts.push(s);
            pod.units.forEach((type, i) => out.push({ type, group: pod.group, at: pod.monster ? { x: s.x, y: s.y, z: s.z } : { x: s.x + (i % 2 ? 2 : -2), y: s.y + (i > 1 ? 2 : 0), z: s.z } }));
            return;
        }
        if (p === 0 && objective) target = objective;
        else target = pick(roomed.filter(b => b !== objective && !out.some(o => o.room?.building === b.id)), p === 0 ? 0.95 : 0.66, centre);
        if (target) { posts.push(centre(target)); pod.units.forEach((type, i) => out.push({ type, group: pod.group, room: { building: target.id, index: i } })); }
        else if (fallback[p]) { posts.push(fallback[p]); pod.units.forEach((type, i) => out.push({ type, group: pod.group, at: { x: fallback[p].x + i * 2, y: fallback[p].y, z: fallback[p].z } })); }
    });
    return out;
}
