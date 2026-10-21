// Flush AI (2026-10-20): enemies break the cover a dug-in squad member hides behind, the way XCOM 2 and Phoenix
// Point pods dig players out instead of trading 20 % shots or parking on overwatch.
//
// No new rule: a flush is an ordinary free-aim shot (`aim.point`) at the cover voxel, so the same ballistics,
// penetration and voxel damage apply (an AR round does `voxel` damage to every voxel it hits or goes through), and
// grenades already demolish voxels with their blast. What is new is the decision:
//
//   coverVoxels      the voxels that give a target its cover against one shooter (the faces toward it, knee and
//                    chest height — the same cells Cover.coverToward rates)
//   flushShot        for each known target in cover the shooter cannot hit well: can this action break (or badly
//                    crack) that cover, is the cover voxel the first thing the round meets, and can a pod-mate take
//                    the exposed shot afterwards? Returns the best { intent, breaksNow, follow, score }.
//   blastCoverValue  how much destructible cover a grenade at a point would take down around dug-in targets
//                    (EnemyAi.gadget adds it to a throw's score)
//
// Read-only like the rest of the enemy brain: nothing here mutates the battle.
import { DIRS4, COVER, coverAgainst } from '../voxel/Cover.js';
import { materialById, coverWeight } from '../voxel/Materials.js';
import { hitChance } from './HitChance.js';
import { FIRE_MODES, fireModes } from './FireControl.js';
import { chooseMuzzle, occupiedBy, traceProjectile } from './Ballistics.js';
import { WEAPONS } from '../content/weapons.js';
import { alive } from './Units.js';

/** Thresholds (hand-tunable, like balance.js): flush only targets this shooter hits below `chanceBelow` %. */
export const FLUSH = Object.freeze({ chanceBelow: 45, hitShare: 0.75, followChance: 30, minScore: 0.6, maxAge: 1 });

const dist2 = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

/**
 * Cover voxels of the target's faces toward `from`: [{ x, y, z, face, hp, key, breakable }]. Only voxels standing
 * above the target's own floor count — never ground someone stands on, never the shooter's own tile.
 */
export function coverVoxels(store, e, from) {
    const dx = from.x - e.x, dy = from.y - e.y, len = Math.hypot(dx, dy) || 1, out = [];
    // the target must stand on a floor at e.z (a stale or misplaced position gives no cover to break)
    if (!store.isSolid(e.x, e.y, e.z) || store.isSolid(e.x, e.y, e.z + 1)) return out;
    for (const d of DIRS4) {
        if ((d.dx * dx + d.dy * dy) / len < 0.5) continue;
        const x = e.x + d.dx, y = e.y + d.dy;
        if (x === from.x && y === from.y) continue;
        for (const h of [1, 2]) {
            const z = e.z + h, m = materialById(store.get(x, y, z));
            if (coverWeight(m) < 1) continue;
            // a solid with two free voxels on top is ground to stand on (a raised step), not cover to shoot away
            if (h === 1 && !store.isSolid(x, y, z + 1) && !store.isSolid(x, y, z + 2) && m.walkable !== false) continue;
            out.push({ x, y, z, face: d.id, hp: store.hpAt(x, y, z), key: m.key, breakable: Number.isFinite(m.hp) && m.hp > 0 });
        }
    }
    return out;
}

/** The fire mode that puts the most rounds on a wall this action (ammo permitting). */
function heaviestMode(u, w) {
    const modes = fireModes(w).slice().sort((a, b) => (FIRE_MODES[b] || 1) - (FIRE_MODES[a] || 1));
    for (const m of modes) if ((u.ammo[w.id] || 0) >= (FIRE_MODES[m] || 1)) return m;
    return modes[modes.length - 1] || 'single';
}

/**
 * Best cover-breaking shot for `u` with weapon `w` against `threats` (EnemyAi.enemyThreats entries; ghosts seen
 * within FLUSH.maxAge rounds count — a squad member who ducked behind a wall last turn is still behind it).
 */
export function flushShot(battle, u, w, threats, { T = { flush: 1 } } = {}) {
    if (!w || w.kind !== 'ballistic' || !(w.voxel > 0)) return null;
    const shotAp = battle.shotAp(u, w);
    if (u.ap < shotAp || (u.ammo[w.id] || 0) < 1) return null;
    const store = battle.store, mode = heaviestMode(u, w), rounds = Math.min(u.ammo[w.id] || 0, FIRE_MODES[mode] || 1);
    const perAction = rounds * (w.voxel || 0) * FLUSH.hitShare * (u.buffs?.demolish ? 2 : 1);
    const mates = battle.unitsOf(u.side).filter(o => o.id !== u.id && !o.drone);
    let best = null;
    for (const t of threats) {
        if (t.ghost && t.age > FLUSH.maxAge) continue;
        const e = t.u;
        if (!e || !alive(e)) continue;
        const at = t.ghost ? { x: t.x, y: t.y, z: t.z } : { x: e.x, y: e.y, z: e.z };
        const range = dist2(at, u);
        // point-blank (adjacent) is a straight shot, not a demolition job
        if (range <= 1.5 || range > (w.maxRange ?? w.range)) continue;
        const cover = coverAgainst(store, at.x, at.y, at.z, u.x, u.y, u.z);
        if (cover === COVER.NONE) continue;
        // Only when shooting the unit itself is poor (unseen targets have no shot at all).
        const seen = !t.ghost && battle.sees(u, e);
        if (seen && hitChance(battle, u, e, w).chance >= FLUSH.chanceBelow) continue;
        const busy = new Set(battle.units.filter(alive).map(o => `${o.x},${o.y}`));
        const vox = coverVoxels(store, at, u).filter(v => v.breakable && !busy.has(`${v.x},${v.y}`));
        if (!vox.length) continue;
        // Aim at the weakest voxel the round actually reaches first (no wall of our own in the way).
        vox.sort((a, b) => a.hp - b.hp || a.z - b.z);
        for (const v of vox) {
            const point = { x: v.x + 0.5, y: v.y + 0.5, h: v.z + 0.5 };
            const muzzle = chooseMuzzle(store, u, point, { occupied: occupiedBy(battle, u) });
            const dv = [point.x - muzzle.x, point.y - muzzle.y, point.h - muzzle.h], L = Math.hypot(...dv);
            const hit = traceProjectile(battle, muzzle, dv.map(c => c / L), L + 0.75, { ignore: u.id, energy: 0 });
            if (hit.kind !== 'voxel' || hit.voxel.x !== v.x || hit.voxel.y !== v.y || hit.voxel.z !== v.z) continue;
            const breaksNow = perAction >= v.hp;
            // A pod-mate with a gun, AP for a shot and the target in range finishes the job this turn.
            const follow = mates.some(o => {
                const g = (o.weapons || []).map(id => WEAPONS[id]).find(x => x?.kind === 'ballistic' && (o.ammo[x.id] || 0) > 0);
                return g && o.ap >= battle.shotAp(o, g) && dist2(o, at) <= (g.maxRange ?? g.range) && dist2(o, at) <= 18;
            });
            const faceHp = vox.filter(q => q.face === v.face).reduce((s, q) => s + q.hp, 0);
            let score = (breaksNow ? 2 : Math.min(1, perAction / v.hp)) * (cover === COVER.FULL ? 1.3 : 1) * (follow ? 1.5 : 1) * (T.flush ?? 1);
            if (e.hp <= e.maxHp * 0.5) score *= 1.2;
            if (perAction >= faceHp) score *= 1.25;        // the whole face goes: the target is in the open
            const intent = { type: 'shoot', unitId: u.id, weaponId: w.id, aim: { point }, ...(fireModes(w).length > 1 ? { fireMode: mode } : {}), flush: { targetId: e.id, voxel: { x: v.x, y: v.y, z: v.z }, material: v.key } };
            if (battle.validate(intent)) continue;
            if (!best || score > best.score) best = { intent, breaksNow, follow, score, target: e.id, material: v.key, cover };
            break;
        }
    }
    return best && best.score >= FLUSH.minScore ? best : null;
}

/**
 * Destructible cover a blast at `c` (radius r, power p) would remove from around dug-in `targets`: the number of
 * their cover voxels inside the radius whose hp the blast's power can clear. EnemyAi.gadget scales it by T.flush.
 */
export function blastCoverValue(store, c, r, power, targets, from) {
    let n = 0;
    for (const t of targets) for (const v of coverVoxels(store, t, from)) {
        if (!v.breakable) continue;
        if (Math.hypot(v.x + 0.5 - (c.x + 0.5), v.y + 0.5 - (c.y + 0.5)) > r) continue;
        if (v.hp <= Math.max(1, power) * 2) n++;
    }
    return n;
}
