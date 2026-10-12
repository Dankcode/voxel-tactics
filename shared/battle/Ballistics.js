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

export function partCentre(u, part) {
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

/** Shoulder point, leaning out of cover toward the aim point when the straight line is blocked close by. */
export function chooseMuzzle(store, u, aimPoint) {
    const base = { x: u.x + 0.5, y: u.y + 0.5, h: u.z + 1 + SHOULDER };
    const dx = aimPoint.x - base.x, dy = aimPoint.y - base.y, len = Math.hypot(dx, dy) || 1;
    const rx = -dy / len, ry = dx / len;
    const candidates = [base, ...[0.55, -0.55].map(s => ({ x: base.x + rx * s, y: base.y + ry * s, h: base.h, lean: s > 0 ? 'right' : 'left' }))];
    let fallback = base;
    for (const c of candidates) {
        if (materialById(store.get(Math.floor(c.x), Math.floor(c.y), Math.floor(c.h))).solid) continue;
        const r = castRay(store, c, aimPoint, { blocks: (s, x, y, z) => materialById(s.get(x, y, z)).projectile !== 'pass' });
        if (!r.hit) return c;
        if (r.t > 1.4 && c === base) fallback = base;
    }
    return fallback;
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
export function traceProjectile(battle, o, d, maxDist, { ignore = null } = {}) {
    const store = battle.store;
    const glass = [];
    const end = { x: o.x + d[0] * maxDist, y: o.y + d[1] * maxDist, h: o.h + d[2] * maxDist };
    const r = castRay(store, o, end, {
        blocks: (s, x, y, z) => materialById(s.get(x, y, z)).projectile === 'block',
        visit: (x, y, z, t) => { if (materialById(store.get(x, y, z)).shatters) {
            const origin=[o.x,o.y,o.h];
            let exit=maxDist;
            [x,y,z].forEach((c,i)=>{if(d[i]) exit=Math.min(exit,((d[i]>0?c+1:c)-origin[i])/d[i]);});
            const hit=intersectCellShape(store,x,y,z,origin,d,t,exit);
            if(hit) glass.push([x,y,z,hit.t]);
        } }
    });
    const voxT = r.hit ? r.t : maxDist;
    let best = null;
    for (const u of battle.units) {
        if (!alive(u) || u.id === ignore) continue;
        const h = rayUnit(o, d, u, voxT,store);
        if (h && h.t < (best?.t ?? Infinity)) best = { unit: u, part: h.part, t: h.t };
    }
    const at = t => ({ x: o.x + d[0] * t, y: o.y + d[1] * t, h: o.h + d[2] * t });
    if (best) return { kind: 'unit', unit: best.unit, part: best.part, t: best.t, point: at(best.t), glass: glass.filter(g => g[3] < best.t) };
    if (r.hit) return { kind: 'voxel', voxel: r.hit, t: r.t, point: r.point, glass: glass.filter(g => g[3] < r.t) };
    return { kind: 'none', t: maxDist, point: end, glass };
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
    const o = muzzle || chooseMuzzle(battle.store, shooter, target);
    const dv = [target.x - o.x, target.y - o.y, target.h - o.h];
    const dist = Math.hypot(...dv);
    const dir = dv.map(c => c / dist);
    const rng = createRng(hashString(`${shooter.id}:${shooter.x},${shooter.y},${shooter.z}:${target.x.toFixed(2)},${target.y.toFixed(2)},${target.h.toFixed(2)}:${spread.toFixed(3)}`));
    const frame = basis(dir);
    const parts = { head: 0, torso: 0, armL: 0, armR: 0, legs: 0 };
    let hit = 0, cover = 0, friendly = 0, other = 0, miss = 0;
    const maxDist = Math.min(weapon.maxRange ?? 40, Math.max(dist + 8, dist * 1.5));
    for (let i = 0; i < samples; i++) {
        const d = sampleCone(dir, spread, rng, frame);
        const res = traceProjectile(battle, o, d, maxDist, { ignore: shooter.id });
        if (res.kind === 'unit') {
            if (aim.unitId && res.unit.id === aim.unitId) { hit++; parts[res.part]++; }
            else if (res.unit.side === shooter.side) friendly++;
            else other++;
        } else if (res.kind === 'voxel' && res.t < dist - 0.3) cover++;
        else miss++;
    }
    const f = n => n / samples;
    return {
        hit: f(hit), cover: f(cover), friendly: f(friendly), other: f(other), miss: f(miss),
        parts: Object.fromEntries(Object.entries(parts).map(([k, v]) => [k, f(v)])),
        partHit: aim.part ? f(parts[aim.part]) : f(hit),
        expectedHits: f(hit) * (weapon.projectiles || 1), distance: dist, spread, muzzle: o, lean: o.lean || null
    };
}
