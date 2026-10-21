import { WALKERS, walkerContacts } from './Walker.js';
import { legPose, rayCapsule } from './WalkerIK.js';
import { intersectCellShape } from '../voxel/ConnectedShapes.js';
// Phoenix Point-style free-aim ballistics on the voxel grid.
//
// A shot is `projectiles` rays inside an accuracy cone. Rays are traced through voxels (Raycast.js,
// ported from vibe-game) and against per-body-part cylinders. Cover is never a dice modifier: a wall
// in the way stops the rays that hit it, and the voxel takes the damage. The hit estimate the HUD shows
// is a deterministic Monte-Carlo of the same trace, so preview and resolution agree.
import { castRay } from '../voxel/Raycast.js';
import { materialById } from '../voxel/Materials.js';
import { createRng, hashString } from '../util/Rng.js';
import { FACING_VEC, alive, SHOULDER } from './Units.js';

export const HITBOX = Object.freeze({
    legs: { off: 0, r: 0.2, h0: 0, h1: 0.72 },
    torso: { off: 0, r: 0.25, h0: 0.72, h1: 1.32 },
    head: { off: 0, r: 0.15, h0: 1.32, h1: 1.74 },
    armR: { off: 0.36, r: 0.1, h0: 0.75, h1: 1.3 },
    armL: { off: -0.36, r: 0.1, h0: 0.75, h1: 1.3 }
});
const DEG = Math.PI / 180;

/** PLAN-14: a search drone's body hovers over its tile at head height; every part is that one small body. */
export const DRONE_BODY = Object.freeze({ h0: 1.6, h1: 2.0, r: 0.45 });   // hovers just over head height, so it reads above a crowd
export function partCentre(u, part) {
    if (u.drone) return { x: u.x + 0.5, y: u.y + 0.5, h: u.z + 1 + (DRONE_BODY.h0 + DRONE_BODY.h1) / 2 };
    if(WALKERS[u.type]){const spec=WALKERS[u.type];return {x:u.x+.5+(part==='armR'?.4:part==='armL'?-.4:part==='legs'?spec.legs[0][0]:0),y:u.y+.5+(part==='legs'?spec.legs[0][1]:part==='head'?-.55:part==='armR'?-.7:part==='armL'?-.2:0),h:u.z+1+(part==='legs'?.5:spec.height+(part==='head'?.25:0))};}
    const hb = HITBOX[part];
    const [fx, fy] = FACING_VEC[u.facing] || [0, 1];
    const len = Math.hypot(fx, fy) || 1;
    const rx = -fy / len, ry = fx / len;
    return { x: u.x + 0.5 + rx * hb.off, y: u.y + 0.5 + ry * hb.off, h: u.z + 1 + (hb.h0 + hb.h1) / 2 };
}

/** Ray (origin o, unit dir d) against a vertical cylinder. Returns entry distance or Infinity. */
function rayCylinder(o, d, cx, cy, r, h0, h1) {
    const ox = o.x - cx, oy = o.y - cy;
    const a = d[0] * d[0] + d[1] * d[1];
    let tIn = -Infinity, tOut = Infinity;
    if (a < 1e-12) { if (ox * ox + oy * oy > r * r) return Infinity; }
    else {
        const b = 2 * (ox * d[0] + oy * d[1]), c = ox * ox + oy * oy - r * r;
        const disc = b * b - 4 * a * c;
        if (disc < 0) return Infinity;
        const s = Math.sqrt(disc);
        tIn = (-b - s) / (2 * a); tOut = (-b + s) / (2 * a);
    }
    // Clip by the height slab.
    if (Math.abs(d[2]) < 1e-12) { if (o.h < h0 || o.h > h1) return Infinity; }
    else {
        let t0 = (h0 - o.h) / d[2], t1 = (h1 - o.h) / d[2];
        if (t0 > t1) [t0, t1] = [t1, t0];
        tIn = Math.max(tIn, t0); tOut = Math.min(tOut, t1);
    }
    if (tIn > tOut || tOut < 0) return Infinity;
    return Math.max(0, tIn);
}

/** First body part of `u` a ray meets, or null. */
export function rayUnit(o, d, u, maxT, store=null) {
    if (u.drone) { const t = rayCylinder(o, d, u.x + .5, u.y + .5, DRONE_BODY.r, u.z + 1 + DRONE_BODY.h0, u.z + 1 + DRONE_BODY.h1); return t <= maxT ? { part: 'torso', t } : null; }
    if(WALKERS[u.type]){
        const spec=WALKERS[u.type],origin=[o.x,o.y,o.h];let best=null;
        const take=(part,t)=>{if(t<=maxT&&t<(best?.t??Infinity))best={part,t};};
        take('torso',rayCylinder(o,d,u.x+.5,u.y+.5,.7,u.z+1+spec.height-.4,u.z+1+spec.height+.25));
        if(!u.parts.head.disabled)take('head',rayCylinder(o,d,u.x+.5,u.y-.05,.24,u.z+1+spec.height+.12,u.z+1+spec.height+.5));
        for(const [part,dx,dy] of [['armR',.32,-.7],['armL',-.32,-.2]])if(!u.parts[part].disabled)take(part,rayCapsule(origin,d,[u.x+.5+dx,u.y+.5+dy-.3,u.z+1+spec.height],[u.x+.5+dx,u.y+.5+dy+.3,u.z+1+spec.height],.16));
        const contacts=store?walkerContacts(store,u):[];
        if(!u.parts.legs.disabled)spec.legs.forEach((offset,i)=>{const foot=contacts[i]||{x:u.x+.5+offset[0],y:u.y+.5+offset[1],h:u.z+1};const p=legPose(u,offset,foot,spec.height);take('legs',rayCapsule(origin,d,p.hip,p.knee,.14));take('legs',rayCapsule(origin,d,p.knee,p.foot,.1));});
        return best;
    }
    // Cheap reject: distance from the unit's axis.
    const cx = u.x + 0.5, cy = u.y + 0.5;
    const ox = cx - o.x, oy = cy - o.y;
    const along = ox * d[0] + oy * d[1];
    if (along < -1) return null;
    const [fx, fy] = FACING_VEC[u.facing] || [0, 1];
    const len = Math.hypot(fx, fy) || 1, rx = -fy / len, ry = fx / len;
    let best = null;
    for (const part of ['head', 'armL', 'armR', 'torso', 'legs']) {
        if (u.parts[part].hp <= 0 && part !== 'torso') continue;   // a destroyed arm no longer stops bullets... it is gone
        const hb = HITBOX[part];
        const t = rayCylinder(o, d, cx + rx * hb.off, cy + ry * hb.off, hb.r, u.z + 1 + hb.h0, u.z + 1 + hb.h1);
        if (t < (best?.t ?? Infinity) && t <= maxT) best = { part, t };
    }
    return best;
}

/** Neighbour offsets a soldier can step out to, in a fixed order (determinism). */
const STEP_DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
/** Step-out tiles beside `u` toward `aimPoint`: sideways first, then forward diagonals; never backward. */
export function stepOutTiles(store, u, aimPoint, { occupied = null } = {}) {
    if (WALKERS[u.type]) return [];
    const cx = u.x + 0.5, cy = u.y + 0.5, dx = aimPoint.x - cx, dy = aimPoint.y - cy, len = Math.hypot(dx, dy);
    if (len < 1e-6) return [];
    const fx = dx / len, fy = dy / len, rx = -fy, ry = fx;
    const open = (x, y, z) => !materialById(store.get(x, y, z)).solid;
    const stand = (x, y) => store.inBounds?.(x, y, u.z) !== false && store.surfaces(x, y).some(c => c.z === u.z && c.headroom >= 2)
        && open(x, y, u.z + 1) && open(x, y, u.z + 2) && !occupied?.(x, y, u.z);
    const out = [];
    STEP_DIRS.forEach(([ox, oy], i) => {
        const l = Math.hypot(ox, oy), fwd = (ox * fx + oy * fy) / l, side = (ox * rx + oy * ry) / l;
        if (fwd < -0.3 || Math.abs(side) < 0.1) return;
        const x = u.x + ox, y = u.y + oy;
        if (!stand(x, y)) return;
        // A diagonal step squeezes past a corner only when both orthogonal tiles are open at body height.
        if (ox && oy && !(open(u.x + ox, u.y, u.z + 1) && open(u.x + ox, u.y, u.z + 2) && open(u.x, u.y + oy, u.z + 1) && open(u.x, u.y + oy, u.z + 2))) return;
        out.push({ x, y, z: u.z, side: side > 0 ? 'right' : 'left', rank: Math.abs(fwd) + (ox && oy ? 0.5 : 0) + i * 1e-3 });
    });
    return out.sort((a, b) => a.rank - b.rank).map(({ rank, ...t }) => t);
}

/**
 * Shoulder point for a shot at `aimPoint`. The straight line from the shoulder is tried first, then a lean out of
 * cover to either side, then (XCOM-style) a step out to a free side tile when the angle is blocked, e.g. around a
 * corner or past a pillar. A step-out muzzle carries `step: {x,y,z}` and `side`; the soldier does not move.
 * `occupied(x,y,z)` keeps steps off tiles other units stand on.
 */
export function chooseMuzzle(store, u, aimPoint, { occupied = null } = {}) {
    const base = { x: u.x + 0.5, y: u.y + 0.5, h: u.z + 1 + SHOULDER };
    const dx = aimPoint.x - base.x, dy = aimPoint.y - base.y, len = Math.hypot(dx, dy) || 1;
    const rx = -dy / len, ry = dx / len;
    const leans = [0.55, -0.55].map(s => ({ x: base.x + rx * s, y: base.y + ry * s, h: base.h, lean: s > 0 ? 'right' : 'left', side: s > 0 ? 'right' : 'left' }));
    const clear = c => !materialById(store.get(Math.floor(c.x), Math.floor(c.y), Math.floor(c.h))).solid
        && !castRay(store, c, aimPoint, { blocks: (s, x, y, z) => materialById(s.get(x, y, z)).projectile !== 'pass' }).hit;
    for (const c of [base, ...leans]) if (clear(c)) return c;
    for (const t of stepOutTiles(store, u, aimPoint, { occupied })) {
        const c = { x: t.x + 0.5, y: t.y + 0.5, h: base.h, lean: `step-${t.side}`, side: t.side, step: { x: t.x, y: t.y, z: t.z } };
        if (clear(c)) return c;
    }
    return base;
}
/** Occupancy test for chooseMuzzle from a battle (or a light preview object with `units`). */
export function occupiedBy(battle, self) {
    if (battle.occupant) return (x, y, z) => { const o = battle.occupant(x, y, z); return !!o && o !== self; };
    return (x, y, z) => (battle.units || []).some(o => o !== self && alive(o) && o.x === x && o.y === y && o.z === z);
}

function basis(d) {
    const up = Math.abs(d[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
    const u = [d[1] * up[2] - d[2] * up[1], d[2] * up[0] - d[0] * up[2], d[0] * up[1] - d[1] * up[0]];
    const ul = Math.hypot(...u); u[0] /= ul; u[1] /= ul; u[2] /= ul;
    const v = [d[1] * u[2] - d[2] * u[1], d[2] * u[0] - d[0] * u[2], d[0] * u[1] - d[1] * u[0]];
    return { u, v };
}

/** A direction inside the cone of half-angle `spreadDeg` around `dir`, drawn from rng. */
export function sampleCone(dir, spreadDeg, rng, frame = basis(dir)) {
    const phi = rng.next() * Math.PI * 2, rho = Math.tan(spreadDeg * DEG) * Math.sqrt(rng.next());
    const d = [dir[0] + (frame.u[0] * Math.cos(phi) + frame.v[0] * Math.sin(phi)) * rho,
        dir[1] + (frame.u[1] * Math.cos(phi) + frame.v[1] * Math.sin(phi)) * rho,
        dir[2] + (frame.u[2] * Math.cos(phi) + frame.v[2] * Math.sin(phi)) * rho];
    const l = Math.hypot(...d); return [d[0] / l, d[1] / l, d[2] / l];
}

/**
 * Trace one projectile. Does not mutate anything.
 * @returns { kind: 'unit'|'voxel'|'none', unit?, part?, voxel?, t, point, glass: [x,y,z][] }
 */
/**
 * PLAN-07 penetration. A projectile carries `energy` from its round; every blocking voxel it meets costs that
 * material's `resistance`. While energy > resistance the ray goes through (the voxel is listed in `pierced`, and the
 * damage of whatever it hits next is scaled by the energy left); otherwise it stops there, as before. Glancing hits
 * cost more (cost ÷ max(0.5, |d · normal|)). Materials without a resistance (ground, floors, steel) always stop it.
 */
export function crossingCost(store, x, y, z, normal, d) {
    const m = materialById(store.get(x, y, z));
    const r = m.resistance ?? Infinity;
    if (!Number.isFinite(r)) return Infinity;
    const cos = normal ? Math.abs(d[0] * normal[0] + d[1] * normal[1] + d[2] * normal[2]) : 1;
    return r / Math.max(0.5, cos);
}
const MAX_PIERCE = 6;
export function traceProjectile(battle, o, d, maxDist, { ignore = null, energy = 0 } = {}) {
    const store = battle.store;
    const glass = [], pierced = [];
    const origin = [o.x, o.y, o.h];
    const at = t => ({ x: o.x + d[0] * t, y: o.y + d[1] * t, h: o.h + d[2] * t });
    const end = at(maxDist);
    let start = 0, e = energy, stop = null;
    for (let seg = 0; seg <= MAX_PIERCE; seg++) {
        const from = at(start);
        const r = castRay(store, from, end, {
            skipStart: seg === 0,
            blocks: (s, x, y, z) => materialById(s.get(x, y, z)).projectile === 'block',
            visit: (x, y, z, t) => { if (materialById(store.get(x, y, z)).shatters) {
                let exit = maxDist;
                [x, y, z].forEach((c, i) => { if (d[i]) exit = Math.min(exit, ((d[i] > 0 ? c + 1 : c) - origin[i]) / d[i]); });
                const hit = intersectCellShape(store, x, y, z, origin, d, start + t, exit);
                if (hit) glass.push([x, y, z, hit.t]);
            } }
        });
        if (!r.hit) break;
        const tHit = start + r.t, v = r.hit;
        const cost = crossingCost(store, v.x, v.y, v.z, r.normal, d);
        if (seg < MAX_PIERCE && e > cost) {
            // Leave through the far side of this cell and keep going with what is left.
            let exit = maxDist;
            [v.x, v.y, v.z].forEach((c, i) => { if (d[i]) exit = Math.min(exit, ((d[i] > 0 ? c + 1 : c) - origin[i]) / d[i]); });
            pierced.push({ x: v.x, y: v.y, z: v.z, t: tHit, cost, before: e });
            e -= cost;
            start = Math.max(exit, tHit) + 1e-4;
            if (start >= maxDist) break;
            continue;
        }
        stop = { voxel: v, t: tHit, point: at(tHit) };
        break;
    }
    const voxT = stop ? stop.t : maxDist;
    let best = null;
    for (const u of battle.units) {
        if (!alive(u) || (Array.isArray(ignore) ? ignore.includes(u.id) : u.id === ignore)) continue;
        const h = rayUnit(o, d, u, voxT, store);
        if (h && h.t < (best?.t ?? Infinity)) best = { unit: u, part: h.part, t: h.t };
    }
    const scaleAt = t => { if (!energy) return 1; let left = energy; for (const p of pierced) if (p.t < t) left -= p.cost; return Math.max(0.25, left / energy); };
    const upTo = t => ({ glass: glass.filter(g => g[3] < t), pierced: pierced.filter(p => p.t < t) });
    if (best) return { kind: 'unit', unit: best.unit, part: best.part, t: best.t, point: at(best.t), scale: scaleAt(best.t), ...upTo(best.t) };
    if (stop) return { kind: 'voxel', voxel: stop.voxel, t: stop.t, point: stop.point, scale: scaleAt(stop.t), ...upTo(stop.t) };
    return { kind: 'none', t: maxDist, point: end, scale: scaleAt(maxDist), glass, pierced };
}

/** Where to aim: a body part of a unit, or a free-aim point (e.g. a wall voxel to destroy). */
export function aimPointOf(battle, aim) {
    if (aim.point) return aim.point;
    const u = battle.unit(aim.unitId);
    return partCentre(u, aim.part || 'torso');
}

/**
 * Deterministic hit estimate (what the HUD shows). Same tracer, fixed seed, no side effects.
 */
export function estimateShot(battle, shooter, aim, { weapon, spread, samples = 96, muzzle = null } = {}) {
    const target = aimPointOf(battle, aim);
    const o = muzzle || chooseMuzzle(battle.store, shooter, target, { occupied: occupiedBy(battle, shooter) });
    const dv = [target.x - o.x, target.y - o.y, target.h - o.h];
    const dist = Math.hypot(...dv);
    const dir = dv.map(c => c / dist);
    const rng = createRng(hashString(`${shooter.id}:${shooter.x},${shooter.y},${shooter.z}:${target.x.toFixed(2)},${target.y.toFixed(2)},${target.h.toFixed(2)}:${spread.toFixed(3)}`));
    const frame = basis(dir);
    const parts = { head: 0, torso: 0, armL: 0, armR: 0, legs: 0 };
    let hit = 0, cover = 0, friendly = 0, other = 0, miss = 0, through = 0;
    const maxDist = Math.min(weapon.maxRange ?? 40, Math.max(dist + 8, dist * 1.5));
    for (let i = 0; i < samples; i++) {
        const d = sampleCone(dir, spread, rng, frame);
        const res = traceProjectile(battle, o, d, maxDist, { ignore: shooter.id, energy: weapon.energy || 0 });
        if (res.kind === 'unit') {
            if (aim.unitId && res.unit.id === aim.unitId) { hit++; parts[res.part]++; if (res.pierced.length) through++; }
            else if (res.unit.side === shooter.side) friendly++;
            else other++;
        } else if (res.kind === 'voxel' && res.t < dist - 0.3) cover++;
        else miss++;
    }
    const f = n => n / samples;
    return {
        hit: f(hit), cover: f(cover), throughCover: hit ? through / hit : 0, friendly: f(friendly), other: f(other), miss: f(miss),
        parts: Object.fromEntries(Object.entries(parts).map(([k, v]) => [k, f(v)])),
        partHit: aim.part ? f(parts[aim.part]) : f(hit),
        expectedHits: f(hit) * (weapon.projectiles || 1), distance: dist, spread, muzzle: o, lean: o.lean || null
    };
}

/**
 * PLAN-10 free aim depth. The reticle turns about the muzzle; the aim point is then put on the first thing that line
 * meets (a body part or a bullet-stopping voxel; glass is looked through), so the shot line, the cone and the reticle
 * all agree with what is under the crosshair whatever its distance. Geometry within `skip` of the muzzle (the cover
 * being leant out of) is ignored. Returns `point` unchanged when nothing is met.
 */
export function resolveAimPoint(battle, shooter, origin, point, maxDist = 60, { skip = 1.2 } = {}) {
    const dv = [point.x - origin.x, point.y - origin.y, point.h - origin.h], len = Math.hypot(...dv);
    if (len < 1e-6) return point;
    const d = dv.map(c => c / len), start = { x: origin.x + d[0] * skip, y: origin.y + d[1] * skip, h: origin.h + d[2] * skip };
    const res = traceProjectile(battle, start, d, Math.max(1, maxDist - skip), { ignore: shooter?.id ?? null, energy: 0 });
    return res.kind === 'none' ? point : { x: res.point.x, y: res.point.y, h: res.point.h };
}
/** PLAN-10: the hostile a free-aim point sits on (torso within ~1 m), so point shots get the same target modifiers. */
export function aimedUnit(battle, shooter, point, filter = null) {
    let best = null, bd = 1.1;
    for (const t of battle.units) {
        if (!alive(t) || t.side === shooter.side || (filter && !filter(t))) continue;
        const c = partCentre(t, 'torso'), d = Math.hypot(c.x - point.x, c.y - point.y, (c.h - point.h) * 0.6);
        if (d < bd) { bd = d; best = t; }
    }
    return best;
}
/**
 * PLAN-11 aim magnetism. When the free-aim line passes within a small angle (or ~0.6 m) of a hostile's torso, head or
 * legs, return that body part's centre so the reticle settles on the enemy instead of the wall or cover beside it.
 * The part must be reachable by a straight line from the muzzle, so magnetism never pulls a shot into a blind wall.
 */
export function stickyAim(battle, shooter, origin, point, { filter = null, maxDeg = 3, maxOffset = 0.6 } = {}) {
    const dv = [point.x - origin.x, point.y - origin.y, point.h - origin.h], L = Math.hypot(...dv);
    if (L < 1e-6) return null;
    const d = dv.map(c => c / L);
    let best = null;
    for (const t of battle.units) {
        if (!alive(t) || t.side === shooter.side || (filter && !filter(t))) continue;
        // PLAN-14: every body part can sit under the reticle (Phoenix Point); a drone is one small body.
        for (const part of t.drone ? ['torso'] : ['torso', 'head', 'legs', 'armL', 'armR']) {
            if (t.parts?.[part]?.disabled && part !== 'torso') continue;
            const c = partCentre(t, part), v = [c.x - origin.x, c.y - origin.y, c.h - origin.h], along = v[0] * d[0] + v[1] * d[1] + v[2] * d[2];
            if (along <= 0.5) continue;
            const off = Math.hypot(v[0] - d[0] * along, v[1] - d[1] * along, v[2] - d[2] * along);
            if (off > Math.max(maxOffset, along * Math.tan(maxDeg * Math.PI / 180))) continue;
            // Judged from the muzzle the shot would really use for that part (a lean or step-out round a corner).
            const m = chooseMuzzle(battle.store, shooter, c, { occupied: occupiedBy(battle, shooter) });
            const hit = castRay(battle.store, m, c, { blocks: (s, x, y, z) => materialById(s.get(x, y, z)).projectile === 'block' });
            const blocked = !!hit.hit && hit.t < hit.length - 0.35;
            if (blocked) continue;
            const score = off / along;
            if (!best || score < best.score) best = { score, unit: t, part, point: c };
        }
    }
    return best;
}
