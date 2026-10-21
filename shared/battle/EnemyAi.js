// PLAN-09: the enemy brain. Health is low and intel decides fights, so NPCs play for information and position:
//
//  - they hunt from what their side knows (battle.enemyIntel: last seen / last heard), never from hidden positions;
//  - they score tiles by XCOM-style hit chance both ways (their chance on you vs. yours on them), stay out of known
//    overwatch cones, and break line of sight when they have no good shot;
//  - wounded or outnumbered NPCs fall back into rooms and corners and set an overwatch ambush instead of charging;
//  - each pod splits into roles: an anchor that holds cover, a flanker that works around, a support that throws;
//  - they use the same gadgets and elements as the squad: water to soak, cryo to freeze the soaked (or chill the
//    dry), fire on dug-in or bunched targets, smoke when caught in the open, Earth Cover walls;
//  - walker monsters (wall_strider) hunt in melee and smash straight through buildings.
//
// Every weight is scaled by battle.aiTuning (from the player's cached playstyle, shared/session/Playstyle.js).
// decide() never mutates the battle: everything here only reads state and returns one intent.
import { WALKERS, occupiedCells } from './Walker.js';
import { WEAPONS, THROWABLES } from '../content/weapons.js';
import { ABILITIES } from '../content/units.js';
import { coverAgainst, hardCoverAgainst, COVER } from '../voxel/Cover.js';
import { alive, hasStatus, partArmor } from './Units.js';
import { nodeKey, pathTo } from '../world/PathSearch.js';
import { reserveAmmo } from '../inventory/Equipment.js';
import { inWatchSector, watchSector } from './WatchSector.js';
import { MAT } from '../voxel/Materials.js';
import { hitChance } from './HitChance.js';
import { DEFAULT_TUNING } from '../session/Playstyle.js';
import { B } from '../content/balance.js';
import { hashString } from '../util/Rng.js';
import { flushShot, blastCoverValue, FLUSH } from './FlushAi.js';

const dist2 = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const cheb = (a, b) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
const tuningOf = b => b.aiTuning || DEFAULT_TUNING;
const ballisticOf = u => u.weapons.map(id => WEAPONS[id]).find(w => w?.kind === 'ballistic') || null;

/**
 * What the enemy side believes about the squad: visible units at their real tiles, plus remembered positions
 * (seen/heard within the last few rounds) for the rest. Each entry: { u, x, y, z, ghost, age }.
 */
export function enemyThreats(battle, u) {
    const seen = battle.visibleTo(u.side), out = [];
    const memory = 3 + Math.round(2 * (tuningOf(battle).hunt - 1));
    for (const e of battle.enemiesOf(u)) {
        if (seen.has(e.id)) { out.push({ u: e, x: e.x, y: e.y, z: e.z, ghost: false, age: 0 }); continue; }
        const m = battle.enemyIntel?.[e.id];
        if (m && m.source !== 'lost' && battle.round - m.round <= memory) out.push({ u: e, x: m.x, y: m.y, z: m.z, ghost: true, age: battle.round - m.round });
    }
    return out;
}

/** Pod role from the unit's place in its group: anchor, flanker or support. Deterministic. */
export function podRole(battle, u) {
    const pod = battle.units.filter(o => o.side === u.side && (o.group ?? 0) === (u.group ?? 0) && !WALKERS[o.type]).map(o => o.id).sort();
    const i = pod.indexOf(u.id);
    if (pod.length < 2) return 'anchor';
    return ['anchor', 'flanker', 'support'][i % 3];
}

export function decideEnemy(battle, u, policy) {
    const T = tuningOf(battle);
    if (WALKERS[u.type]) return decideMonster(battle, u);
    const threats = enemyThreats(battle, u), known = threats.filter(t => !t.ghost);
    const guns = u.weapons.map(id => WEAPONS[id]).filter(w => w.kind === 'ballistic');
    const ranged = guns.find(w => (u.ammo[w.id] || 0) > 0) || guns.find(w => !w.boltAction && reserveAmmo(u, w) > 0);
    const melee = u.weapons.map(id => WEAPONS[id]).find(w => w.kind === 'melee');
    const role = podRole(battle, u);

    // Melee specialists: strike when adjacent, else close in through cover, smoke first if they would be caught open.
    if (!ranged && melee) {
        const adj = known.find(t => cheb(t, u) <= 1 && Math.abs(t.z - u.z) <= 1);
        if (adj && u.ap >= melee.ap) return { type: 'melee', unitId: u.id, weaponId: melee.id, targetId: adj.u.id, part: 'torso' };
        const g = gadget(battle, u, known, T, role);
        if (g) return g;
        const target = nearestOf(u, threats) || fallbackTarget(battle, u);
        if (!target) return null;
        const step = approachCovered(battle, u, target, Math.max(0, u.ap - melee.ap), threats);
        return step ? moveIntent(battle, u, step) : null;
    }
    if (!ranged) return gadget(battle, u, known, T, role);

    const ammoOk = (u.ammo[ranged.id] ?? 0) >= 1;
    const canReload = !ranged.boltAction && reserveAmmo(u, ranged) > 0 && u.ap >= ranged.reloadAp;
    if (!ammoOk && canReload && !known.length) return { type: 'reload', unitId: u.id, weaponId: ranged.id };
    if (u.weapon !== ranged.id) return { type: 'switchWeapon', unitId: u.id, weaponId: ranged.id };
    const shotAp = battle.shotAp(u, ranged);

    // Gadgets and elements before anything else: they set up the shots.
    if (known.length) { const g = gadget(battle, u, known, T, role); if (g) return g; }
    if (!ammoOk && canReload) return { type: 'reload', unitId: u.id, weaponId: ranged.id };

    const shot = ammoOk && u.ap >= shotAp ? bestEnemyShot(battle, u, ranged, known) : null;
    const canMoveAndShoot = u.ap + u.moveOnlyAp - shotAp >= 1;
    // XCOM habit: take a good shot; with a bad one, reposition first if there is AP for both.
    if (shot && (shot.chance >= 70 || shot.kill && shot.chance >= 45 || (!canMoveAndShoot && shot.chance >= 30) || (u.movedThisTurn && shot.chance >= 30)))
        return shot.intent;

    // Formation members hold their slots (enemy formations are rare, kept for parity with the squad AI).
    // Formation members: the leader's group move carries them; get back into the slot if left behind, then cover.
    const formation = battle.formations.of(u);
    if (formation && formation.template !== 'crossfire' && formation.leaderId !== u.id) {
        if (shot && shot.chance >= 30) return shot.intent;
        const slot = battle.formations.slotsFor(formation)?.[formation.members.indexOf(u.id)];
        if (slot && !battle.formations.inSlot(u, slot) && !u.movedThisTurn && u.ap + u.moveOnlyAp >= 1) {
            const step = approachCovered(battle, u, slot, ammoOk ? ranged.ap : 0, threats);
            if (step) return { type: 'move', unitId: u.id, to: step };
        }
        return overwatchToward(battle, u, ranged, nearestOf(u, threats)) || (shot ? shot.intent : null);
    }

    // PLAN-10: hide for real reasons only (wounded, or the pod half gone); a healthy pod presses the attack.
    const wounded = u.hp <= u.maxHp * 0.5;
    const near = battle.unitsOf(u.side).filter(o => o.id !== u.id && dist2(o, u) <= 10).length + 1;
    const outnumbered = !!B.aiHideWhenOutnumbered && known.length > near;
    const pod = battle.units.filter(o => o.side === u.side && (o.group ?? 0) === (u.group ?? 0) && !WALKERS[o.type]);
    const depleted = pod.length >= 2 && pod.filter(alive).length * 2 <= pod.length;
    const pushed = known.some(t => dist2(t, u) <= 6) && T.ambush >= 1.15 && u.hp < u.maxHp;
    const hide = (wounded || depleted || outnumbered || pushed) && !(shot && shot.chance >= 55);
    // Flush (FlushAi): a squad member dug in behind breakable cover that this unit cannot hit well. Break the cover
    // now when it gives way this action and a pod-mate can take the exposed shot; otherwise it is the fallback below.
    const flush = !hide && ammoOk && !(shot && shot.chance >= FLUSH.chanceBelow) ? flushShot(battle, u, ranged, threats, { T }) : null;
    if (flush && flush.breaksNow && flush.follow) return flush.intent;

    if (!threats.length) {
        // Nobody known: hold an ambush, or sweep toward the squad's general direction (alerted pods do not idle).
        if (u.movedThisTurn) return ammoOk && u.ap >= ranged.ap ? overwatchToward(battle, u, ranged, u.investigate ? searchGoal(battle, u) : fallbackTarget(battle, u)) : null;
        // PLAN-14: a sound to run down comes first — go to its source, then sweep around it.
        const search = searchMove(battle, u, ammoOk ? ranged.ap : 0);
        if (search) return search;
        const t = fallbackTarget(battle, u);
        if (!t) return null;
        const tile = enemyTile(battle, u, ranged, [{ u: t.u, x: t.x, y: t.y, z: t.z, ghost: true, age: 9 }], Math.max(1, u.ap + u.moveOnlyAp - (ammoOk ? ranged.ap : 0)), { role, hide: false, T, ammoOk, sweep: t });
        if (tile && !same(tile, u)) return moveIntent(battle, u, tile);
        return ammoOk && u.ap >= ranged.ap ? overwatchToward(battle, u, ranged, t) : null;
    }

    const target = nearestOf(u, threats);
    if (u.ap + u.moveOnlyAp > (ammoOk && !hide ? shotAp : 0) && !u.movedThisTurn) {
        const budgetAp = Math.max(1, u.ap + u.moveOnlyAp - (ammoOk ? (hide ? ranged.ap : shotAp) : 0));
        const best = enemyTile(battle, u, ranged, threats, budgetAp, { role, hide, T, ammoOk, detail: true });
        // PLAN-10, XCOM dash: no worthwhile shot from anywhere this turn → spend everything closing in on the target.
        const fullAp = u.ap + u.moveOnlyAp;
        if (!hide && target && fullAp > budgetAp && (!best || best.offense < B.aiDashIfOffenseBelow) && !(shot && shot.chance >= 30)) {
            const dash = enemyTile(battle, u, ranged, threats, fullAp, { role, hide: false, T, ammoOk, pursue: target, detail: true });
            if (dash && !same(dash.n, u) && dist2(dash.n, target) < dist2(u, target) - 1) return moveIntent(battle, u, dash.n);
        }
        if (best && !same(best.n, u)) return moveIntent(battle, u, best.n);
    }
    if (shot && shot.chance >= 30) return shot.intent;
    // Moved, still no shot and AP left: keep closing instead of parking on overwatch out of range or out of sight.
    if (!hide && target && u.movedThisTurn && u.ap + u.moveOnlyAp >= 1 && (dist2(u, target) > ranged.range || !shot)) {
        const keep = ammoOk && u.ap - shotAp >= 0 && u.ap + u.moveOnlyAp - shotAp >= 1 ? shotAp : 0;
        const step = enemyTile(battle, u, ranged, threats, Math.max(1, u.ap + u.moveOnlyAp - keep), { role, hide: false, T, ammoOk, pursue: target, detail: true });
        if (step && !same(step.n, u) && dist2(step.n, target) < dist2(u, target) - 1) return moveIntent(battle, u, step.n);
    }
    // Caught in the open after moving: raise a wall.
    const wall = earthCover(battle, u, known);
    if (wall) return wall;
    // No shot worth taking and nowhere better to stand: dig them out rather than wait on overwatch.
    if (flush && u.ap >= battle.shotAp(u, ranged)) return flush.intent;
    if (ammoOk && u.ap >= ranged.ap) return overwatchToward(battle, u, ranged, nearestOf(u, threats));
    if (!ammoOk && canReload) return { type: 'reload', unitId: u.id, weaponId: ranged.id };
    if (shot) return shot.intent;
    return null;
}

const same = (a, b) => a.x === b.x && a.y === b.y && a.z === b.z;
/** A move; a formation leader moves the whole formation, breaking it first when the shape will not fit there. */
function moveIntent(battle, u, to) {
    const f = battle.formations.of(u);
    const group = !!f && !f.assembling && f.leaderId === u.id && f.template !== 'crossfire';
    if (group && battle.formations.blockedAt(f, to)) return { type: 'formation_break', unitId: u.id, formationId: f.id };
    return { type: 'move', unitId: u.id, to, ...(group ? { group: true } : {}) };
}
function nearestOf(u, list) { let b = null, bd = Infinity; for (const e of list) { const d = dist2(e, u); if (d < bd) { bd = d; b = e; } } return b; }
/** Alerted with no intel at all: the squad's nearest member, approached as a rumour (cover first, never a charge). */
function fallbackTarget(battle, u) { const e = nearestOf(u, battle.enemiesOf(u)); return e ? { x: e.x, y: e.y, z: e.z, u: e } : null; }

function overwatchToward(battle, u, w, t) {
    if (!t || !w || (u.ammo[w.id] ?? 0) < 1 || u.ap < w.ap) return null;
    const toward = { x: t.x, y: t.y };
    return watchSector(u, toward, w.id) ? { type: 'overwatch', unitId: u.id, weaponId: w.id, toward } : null;
}

/** Best shot by XCOM hit chance and expected damage. */
export function bestEnemyShot(battle, u, w, known) {
    let best = null;
    for (const t of known) {
        const e = t.u;
        if (dist2(e, u) > w.maxRange) continue;
        if (!battle.sees(u, e)) continue;
        const hc = hitChance(battle, u, e, w);
        const perHit = Math.max(0, w.damage - Math.max(0, partArmor(e, 'torso') - w.pierce));
        const expect = hc.chance / 100 * w.projectiles * perHit * (1 + hc.crit / 100 * (B.critDamageMult - 1));
        const kill = w.projectiles * perHit * (hc.crit > 0 ? B.critDamageMult : 1) >= e.hp;
        // A frozen, wet or flanked target is worth extra; a friendly in the line of fire is not worth it.
        let value = expect / Math.max(1, w.ap) * (kill ? 1.6 : 1) * (hasStatus(e, 'frozen') ? 1.3 : 1);
        const friendly = battle.unitsOf(u.side).some(o => o.id !== u.id && segDist(u, e, o) < 0.7 && dist2(o, u) < dist2(e, u));
        if (friendly) value *= 0.2;
        if (!best || value > best.value) best = { value, chance: hc.chance, crit: hc.crit, kill, intent: { type: 'shoot', unitId: u.id, weaponId: w.id, aim: { unitId: e.id, part: 'torso' } } };
    }
    return best && best.value > 0.05 ? best : null;
}
function segDist(a, b, p) {
    const vx = b.x - a.x, vy = b.y - a.y, l2 = vx * vx + vy * vy || 1;
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * vx + (p.y - a.y) * vy) / l2));
    return Math.hypot(a.x + vx * t - p.x, a.y + vy * t - p.y);
}

/**
 * Tile choice. Pass 1 scores every reachable tile cheaply (cover, flank, range, hazards, spacing); pass 2 re-scores
 * the best few with line of sight and hit chance both ways, and checks the walk for known overwatch.
 */
export function enemyTile(battle, u, w, threats, budgetAp, { role = 'anchor', hide = false, T = DEFAULT_TUNING, ammoOk = true, sweep = null, pursue = null, detail = false } = {}) {
    const search = battle.reach(u, budgetAp * battle.mobility(u));
    const nodes = [...search.nodes.values()];
    if (!nodes.length) return null;
    const stride = Math.max(1, Math.floor(nodes.length / 260));
    const allies = battle.unitsOf(u.side).filter(o => o.id !== u.id);
    const pockets = battle.mission.meta?.pockets || [];
    const watchers = battle.enemiesOf(u).filter(p => alive(p) && p.overwatch && !hasStatus(p, 'surprised'));
    const brawlers = battle.enemiesOf(u).filter(p => WEAPONS[p.weapon]?.kind === 'melee' || WEAPONS[p.weapon]?.range <= 8);
    const flankK = role === 'flanker' ? 1.8 : role === 'support' ? 0.6 : 1;
    const want = role === 'support' ? w.range * 0.85 : role === 'flanker' ? w.range * 0.5 : w.range * 0.7;
    const scored = [];
    for (let i = 0; i < nodes.length; i += stride) {
        const n = nodes[i];
        if (battle.occupant(n.x, n.y, n.z) && !same(n, u)) continue;
        let s = 0;
        for (const t of threats) {
            const d = dist2(t, n);
            if (d > 30) continue;
            const ew = ballisticOf(t.u), hc = hardCoverAgainst(battle.store, n.x, n.y, n.z, t.x, t.y, t.z, ew?.energy || 6), c = hc.level;
            s += (c === COVER.FULL ? 14 : c === COVER.HALF ? 8 : -9 * T.flankGuard) * (c && hc.soft ? 0.5 : 1);
            if (!hide && d <= w.range && coverAgainst(battle.store, t.x, t.y, t.z, n.x, n.y, n.z) === COVER.NONE) s += 10 * flankK * T.flush;
            if (role === 'flanker' && !hide) {
                // Work around: reward tiles off the line between the pod and the target.
                const side = Math.abs((t.x - u.x) * (n.y - u.y) - (t.y - u.y) * (n.x - u.x)) / (dist2(t, u) || 1);
                s += Math.min(6, side) * 0.8 * T.flush;
            }
        }
        const nearestD = Math.min(...threats.map(t => dist2(t, n)), 99);
        if (sweep) s -= dist2(n, sweep) * 0.9 * T.hunt;
        else if (hide) s += Math.min(nearestD, w.range) * 0.4;
        // PLAN-10: being too far costs twice as much as being too close, so pods close to their effective range.
        else s -= Math.abs(nearestD - want) * (nearestD > want ? 1.4 : 0.7) * (nearestD > 14 ? T.closeIn : 1);
        if (pursue) {
            // Pursuit: progress toward the target dominates; a tile that barely gains ground is a wasted turn.
            const d = dist2(n, pursue) + Math.abs(n.z - pursue.z) * 0.7, gain = dist2(u, pursue) - d;
            s -= d * B.aiPursuitPerTile * T.hunt;
            if (gain < 0.4 * budgetAp * battle.mobility(u)) s -= 30;
        }
        if (battle.field.surfaceAt(n.x, n.y, n.z) === 'burning' || battle.field.isBurning(n.x, n.y, n.z)) s -= 40;
        if (battle.field.surfaceAt(n.x, n.y, n.z) === 'wet') s -= 4;         // cryo bait
        s -= allies.filter(o => cheb(o, n) <= 2).length * 4 * T.spread;
        if (role !== 'flanker') s += Math.min(2, allies.filter(o => cheb(o, n) <= 7).length) * 1.5 * T.flankGuard;   // stay in mutual support
        if (threats.length) s += Math.max(0, n.z - Math.min(...threats.map(t => t.z))) * 2;
        if (pockets.length && pockets.some(p => Math.hypot(p.x - n.x, p.y - n.y) <= 2.5)) s += 2.5;
        if (battle.roomOf(n) >= 0) s += hide ? 10 * T.ambush : 1;
        if (nextToDoor(battle, n)) s -= 6 * T.doorWatch;
        for (const p of brawlers) if (dist2(p, n) <= 3) s -= 5 * T.keepAway;
        for (const p of watchers) if (inWatchSector(p, p.overwatch, n)) s -= 14 * T.overwatchCaution;
        scored.push({ n, s });
    }
    scored.sort((a, b) => b.s - a.s);
    // Pass 2: line of sight and hit chance, both ways.
    const top = scored.slice(0, 20);
    for (const c of top) {
        const n = c.n, eye = { x: n.x + 0.5, y: n.y + 0.5, h: n.z + 2.4 }, chest = { x: n.x + 0.5, y: n.y + 0.5, h: n.z + 2.05 };
        let danger = 0, offense = 0, seenBy = 0;
        for (const t of threats) {
            const d = dist2(t, n);
            const ew = ballisticOf(t.u);
            const tEye = { x: t.x + 0.5, y: t.y + 0.5, h: t.z + 2.55 };
            const los = d <= B.sightRange && battle.sightLine(tEye, chest);
            if (los) {
                seenBy++;
                if (ew && d <= ew.maxRange) danger += hitChance(battle, t.u, u, ew, { from: t, at: n }).chance / 100 * (t.ghost ? 0.6 : 1);
                else if (d <= 2) danger += 0.8;
            }
            if (ammoOk && !t.ghost && d <= w.maxRange && battle.sightLine(eye, battle.chest(t.u)))
                offense = Math.max(offense, hitChance(battle, u, t.u, w, { from: n }).chance / 100);
        }
        c.s += offense * (hide ? 6 : 26) - danger * 28 * T.flankGuard * (role === 'flanker' ? 0.75 : 1);
        if (!seenBy) c.s += hide ? 26 : 5 * T.closeIn;
        c.danger = danger; c.offense = offense;
    }
    top.sort((a, b) => b.s - a.s);
    // The walk itself: avoid paths through known overwatch.
    if (watchers.length) for (const c of top.slice(0, 6)) {
        const path = pathTo(search, nodeKey(c.n));
        c.s -= battle.overwatchThreats(u, path).length * 20 * T.overwatchCaution;
    }
    top.sort((a, b) => b.s - a.s);
    return detail ? top[0] || null : top[0]?.n || null;
}
function nextToDoor(battle, n) {
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (battle.store.get(n.x + dx, n.y + dy, n.z + 1) === MAT.door) return true;
    return false;
}

/** Move toward a target along tiles that keep cover from the known threats (melee units). */
function approachCovered(battle, u, target, keepAp, threats) {
    const budget = Math.max(1, u.ap + u.moveOnlyAp - keepAp) * battle.mobility(u);
    const search = battle.reach(u, budget);
    let best = null, bs = -Infinity;
    for (const n of search.nodes.values()) {
        const o = battle.occupant(n.x, n.y, n.z);
        if (o && o.id !== u.id) continue;
        let s = -(dist2(n, target) + Math.abs(n.z - target.z));
        for (const t of threats) if (!t.ghost && dist2(t, n) > 1.5 && coverAgainst(battle.store, n.x, n.y, n.z, t.x, t.y, t.z) === COVER.NONE) s -= 1.5;
        if (battle.field.isBurning(n.x, n.y, n.z)) s -= 20;
        if (s > bs) { bs = s; best = n; }
    }
    return best && !same(best, u) ? best : null;
}

// ------------------------------------------------------------------------------------------------- patrols
/**
 * PLAN-10: an unalerted pod patrols instead of standing still. The pod's first living member walks one AP at a time
 * toward a waypoint around its post (`u.home`, the spawn), re-picked every three rounds from a hash (deterministic on
 * every peer); the others keep within two tiles of it. Pods posted inside a room patrol that room. Never mutates.
 */
export function patrolStep(battle, u) {
    const radius = B.aiPatrolRadius;
    if (!radius || WALKERS[u.type] || u.movedThisTurn || u.ap < 1 || u.formationId || hasStatus(u, 'frozen')) return null;
    const pod = battle.unitsOf(u.side).filter(o => (o.group ?? 0) === (u.group ?? 0) && !o.alerted && !WALKERS[o.type]).sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    const leader = pod[0], home = u.home || leader?.home || { x: u.x, y: u.y, z: u.z };
    const room = battle.store.roomAt(home.x, home.y, home.z + 1);
    const search = battle.reach(u, battle.mobility(u));
    const ok = n => !(battle.occupant(n.x, n.y, n.z) && !same(n, u)) && (room < 0 || battle.store.roomAt(n.x, n.y, n.z + 1) === room)
        && Math.hypot(n.x - home.x, n.y - home.y) <= radius && !battle.field.isBurning(n.x, n.y, n.z);
    let goal;
    if (leader && leader.id !== u.id) {
        if (cheb(u, leader) <= 2) return null;
        goal = leader;
    } else {
        const a = 2 * Math.PI * ((hashString(`${u.id}:patrol:${Math.floor(battle.round / 3)}`) >>> 0) / 4294967296);
        goal = { x: home.x + Math.cos(a) * radius * 0.7, y: home.y + Math.sin(a) * radius * 0.7, z: home.z };
    }
    let best = null, bd = Infinity;
    for (const n of search.nodes.values()) {
        if (!ok(n) || (leader && leader.id !== u.id && cheb(n, leader) < 1)) continue;
        const d = Math.hypot(n.x - goal.x, n.y - goal.y) + Math.abs(n.z - goal.z);
        if (d < bd - 1e-9) { bd = d; best = n; }
    }
    if (!best || same(best, u) || bd >= Math.hypot(u.x - goal.x, u.y - goal.y) + Math.abs(u.z - goal.z) - 0.5) return null;
    return { type: 'move', unitId: u.id, to: { x: best.x, y: best.y, z: best.z } };
}

// ------------------------------------------------------------------------------------------------- gadgets
/**
 * The NPC's best gadget or element play, or null. Same items as the squad: water soaks, cryo freezes the soaked
 * (or chills and slows the dry), fire burns out dug-in or bunched targets, smoke covers the exposed, frags blast.
 */
export function gadget(battle, u, known, T = DEFAULT_TUNING, role = 'anchor') {
    if (!known.length) return null;
    const friends = battle.unitsOf(u.side);
    const wet = e => hasStatus(e, 'wet') || battle.field.surfaceAt(e.x, e.y, e.z) === 'wet';
    const plays = [];
    const inRange = (t, e) => dist2(e, u) <= t.range;
    const around = (c, r) => known.filter(t => dist2(t, c) <= r).map(t => t.u);
    const friendly = (c, r) => friends.filter(o => dist2(o, c) <= r + 0.5).length;
    const sideHasFrost = friends.some(o => (o.items?.frost_flask || 0) > 0);
    for (const [id, n] of Object.entries(u.items || {})) {
        const t = THROWABLES[id];
        if (!n || !t || t.placed || t.kind === 'gadget' || u.ap < t.ap) continue;
        if (id === 'smoke_pot') {
            // Caught in the open by someone who can see us, and hurt or without a covered tile in reach.
            const seers = known.filter(k => battle.sees(k.u, u));
            const open = seers.some(k => coverAgainst(battle.store, u.x, u.y, u.z, k.x, k.y, k.z) === COVER.NONE);
            if (open && !battle.field.isSmoke(u.x, u.y, u.z + 1) && (u.hp <= u.maxHp * 0.7 || u.movedThisTurn))
                plays.push({ score: 4 + seers.length, intent: { type: 'throw', unitId: u.id, itemId: id, to: { x: u.x, y: u.y, z: u.z } } });
            continue;
        }
        for (const k of known) {
            const e = k.u;
            if (!inRange(t, e)) continue;
            const hit = around(e, t.radius), own = friendly(e, t.radius);
            if (own) continue;
            let score = 0;
            if (t.element === 'cryo') {
                const soaked = hit.filter(wet).length, dry = hit.length - soaked;
                score = soaked * 5 + dry * 1.1 + (soaked ? 1 : 0);
            } else if (t.element === 'hydro') {
                // Soak them for a freeze (this unit or a pod-mate carries cryo), or put out a burning friend.
                const dry = hit.filter(x => !wet(x)).length;
                score = sideHasFrost ? dry * 1.6 : 0;
                if ((u.items.frost_flask || 0) > 0 && u.ap < t.ap + THROWABLES.frost_flask.ap) score *= 0.6;
            } else if (t.element === 'pyro') {
                const burnable = hit.filter(x => !wet(x) && !hasStatus(x, 'burning'));
                const dug = burnable.filter(x => coverAgainst(battle.store, x.x, x.y, x.z, u.x, u.y, u.z) === COVER.FULL).length;
                score = burnable.length * 1.2 + dug * 0.9 * T.flush;
            } else if (t.damage) {
                const dug = coverAgainst(battle.store, e.x, e.y, e.z, u.x, u.y, u.z) === COVER.FULL ? 1 : 0;
                score = hit.length + dug * 0.6 * T.flush;
                // Frag that takes the cover down with it: count the dug-in targets' breakable cover in the blast.
                const entrenched = known.filter(k => coverAgainst(battle.store, k.x, k.y, k.z, u.x, u.y, u.z) !== COVER.NONE);
                score += Math.min(1.5, 0.25 * blastCoverValue(battle.store, e, t.radius, t.power || 0, entrenched, u)) * T.flush;
            }
            if (role === 'support') score *= 1.2;
            if (score >= 2.2) plays.push({ score, intent: { type: 'throw', unitId: u.id, itemId: id, to: { x: e.x, y: e.y, z: e.z } } });
        }
    }
    // A burning friend nearby: put it out.
    if ((u.items?.water_flask || 0) > 0 && u.ap >= THROWABLES.water_flask.ap) {
        const burning = friends.find(o => hasStatus(o, 'burning') && dist2(o, u) <= THROWABLES.water_flask.range);
        if (burning) plays.push({ score: 3.5, intent: { type: 'throw', unitId: u.id, itemId: 'water_flask', to: { x: burning.x, y: burning.y, z: burning.z } } });
    }
    plays.sort((a, b) => b.score - a.score);
    for (const p of plays) if (!battle.validate(p.intent)) return p.intent;
    return null;
}

/** Earth Cover: an NPC with the ability, exposed to a visible threat, raises a wall on the tile toward it. */
export function earthCover(battle, u, known) {
    const a = ABILITIES.earth_cover;
    if (!u.abilities?.includes('earth_cover') || u.will < a.wp || u.ap < a.ap || !known.length) return null;
    const t = nearestOf(u, known.filter(k => battle.sees(k.u, u)));
    if (!t || coverAgainst(battle.store, u.x, u.y, u.z, t.x, t.y, t.z) !== COVER.NONE) return null;
    const dx = Math.sign(t.x - u.x), dy = Math.sign(t.y - u.y);
    for (const [ox, oy] of [[dx, dy], [dx, 0], [0, dy]]) {
        if (!ox && !oy) continue;
        const intent = { type: 'ability', unitId: u.id, abilityId: 'earth_cover', to: { x: u.x + ox, y: u.y + oy, z: u.z } };
        if (!battle.validate(intent)) return intent;
    }
    return null;
}

// ------------------------------------------------------------------------------------------------- monsters
/**
 * Walker monsters: melee hunters that go through buildings. Claw anything in reach; when a wall stands between the
 * monster and its prey, smash it; otherwise stalk (climbing facades is part of their reach).
 */
export function decideMonster(battle, u) {
    const threats = enemyThreats(battle, u);
    const prey = nearestOf(u, threats) || fallbackTarget(battle, u);
    if (!prey) return null;
    const claws = u.weapons.map(id => WEAPONS[id]).find(w => w?.kind === 'melee');
    if (claws && u.ap >= claws.ap) {
        const victims = battle.enemiesOf(u).filter(e => battle.sees(u, e) || threats.some(t => t.u === e && !t.ghost));
        victims.sort((a, b) => a.hp - b.hp || dist2(a, u) - dist2(b, u));
        for (const e of victims) {
            const intent = { type: 'melee', unitId: u.id, weaponId: claws.id, targetId: e.id, part: 'torso' };
            if (!battle.validate(intent)) return intent;
        }
    }
    const ranged = u.weapons.map(id => WEAPONS[id]).find(w => w?.kind === 'ballistic' && (u.ammo[w.id] || 0) > 0);
    if (ranged && u.ap >= battle.shotAp(u, ranged)) { const s = bestEnemyShot(battle, u, ranged, threats.filter(t => !t.ghost)); if (s && s.chance >= 35) return s.intent; }
    const keep = claws ? claws.ap : 0;
    const step = monsterStep(battle, u, prey, keep);
    const smash = u.abilities?.includes('smash') && u.ap >= ABILITIES.smash.ap ? smashToward(battle, u, prey) : null;
    // Smash when the wall is the short way: the prey is close behind it, or no step gets meaningfully closer.
    if (smash && (!step || dist2(step, prey) > dist2(u, prey) - 2 || dist2(u, prey) <= 10)) return smash;
    if (step) return { type: 'move', unitId: u.id, to: step };
    return smash;
}
function monsterStep(battle, u, target, keepAp) {
    const budget = Math.max(1, u.ap + u.moveOnlyAp - keepAp) * battle.mobility(u);
    const search = battle.reach(u, budget);
    let best = null, bd = Infinity;
    for (const n of search.nodes.values()) {
        const o = battle.occupant(n.x, n.y, n.z);
        if (o && o.id !== u.id) continue;
        const d = Math.hypot(n.x - target.x, n.y - target.y) + Math.abs(n.z - target.z) * 0.7;
        if (d < bd) { bd = d; best = n; }
    }
    return best && !same(best, u) ? best : null;
}
/** The first solid wall voxel between the monster and its prey (within smash range), as a smash intent. */
export function smashToward(battle, u, prey) {
    const a = ABILITIES.smash, cells = occupiedCells(u);
    const dx = prey.x - u.x, dy = prey.y - u.y, d = Math.hypot(dx, dy) || 1;
    for (let r = 1.5; r <= a.range + 1.51; r += 0.5) {             // legs reach about a tile past the body
        const x = Math.floor(u.x + 0.5 + dx / d * r), y = Math.floor(u.y + 0.5 + dy / d * r);
        if (cells.some(c => c.x === x && c.y === y)) continue;
        for (let dz = 1; dz <= 3; dz++) {
            const m = battle.store.get(x, y, u.z + dz);
            if (!battle.store.isSolid(x, y, u.z + dz) || m === MAT.bedrock) continue;
            const intent = { type: 'ability', unitId: u.id, abilityId: 'smash', to: { x, y, z: u.z } };
            if (!battle.validate(intent)) return intent;
        }
    }
    return null;
}

// ------------------------------------------------------------------------------------------------- PLAN-14 search
const unitHash = (s) => (hashString(s) >>> 0) / 4294967296;
/**
 * Where a unit with a search point (`u.investigate`, set by Battle.noise) should head: the source itself, each pod
 * member a step or two off it so they spread out; once it has been reached, a sweep point about four tiles around it
 * that turns every round. Deterministic (hashes of id and round).
 */
export function searchGoal(battle, u) {
    const inv = u.investigate; if (!inv) return null;
    const r = inv.reached ? 4 : 1.5, a = 2 * Math.PI * unitHash(`${u.id}:search:${inv.reached ? battle.round : 0}`);
    return { x: Math.round(inv.x + Math.cos(a) * r), y: Math.round(inv.y + Math.sin(a) * r), z: inv.z };
}
/** One search move toward searchGoal, keeping `keepAp` for a shot. Never mutates the battle. */
export function searchMove(battle, u, keepAp = 0) {
    const goal = searchGoal(battle, u); if (!goal || u.movedThisTurn || hasStatus(u, 'frozen') || u.formationId) return null;
    const budgetAp = Math.max(1, u.ap + u.moveOnlyAp - keepAp);
    const search = battle.reach(u, budgetAp * battle.mobility(u));
    const d = n => Math.hypot(n.x - goal.x, n.y - goal.y) + Math.abs(n.z - goal.z) * 1.5;
    let best = null, bd = Infinity;
    for (const n of search.nodes.values()) {
        if (battle.occupant(n.x, n.y, n.z) && !same(n, u)) continue;
        if (battle.field?.isBurning?.(n.x, n.y, n.z)) continue;
        const v = d(n) - (u.drone ? 0 : 0.4 * coverAgainst(battle.store, n.x, n.y, n.z, goal.x, goal.y, goal.z));
        if (v < bd - 1e-9) { bd = v; best = n; }
    }
    if (!best || same(best, u) || d(best) >= d(u) - 0.75) return null;
    return { type: 'move', unitId: u.id, to: { x: best.x, y: best.y, z: best.z } };
}
/** Unalerted pods that heard something walk over to look (before their patrol). */
export function investigateStep(battle, u) {
    if (!u.investigate || WALKERS[u.type]) return null;
    const guns = (u.weapons || []).map(id => WEAPONS[id]).filter(w => w?.kind === 'ballistic');
    return searchMove(battle, u, guns.length ? Math.min(2, guns[0].ap) : 0);
}
/** Drone techs put a drone up whenever they may (validated by the battle: cooldown, two at most, a free tile). */
export function launchIntent(battle, u) {
    if (!u.abilities?.includes('launch_drone') || u.ap < 1) return null;
    const intent = { type: 'ability', unitId: u.id, abilityId: 'launch_drone' };
    return battle.validate(intent) ? null : intent;
}
/**
 * PLAN-14 search drones: unarmed spotters. With a squad member in view the drone holds that view at a safe distance
 * (backing off inside 5 tiles); otherwise it runs down the latest sound, then the side's last known positions, then
 * sweeps a ring around its tech that turns every round.
 */
export function decideDrone(battle, u) {
    if (u.ap + u.moveOnlyAp < 1 || u.movedThisTurn || hasStatus(u, 'frozen')) return null;
    const seen = battle.enemiesOf(u).filter(p => battle.sees(u, p));
    const budget = (u.ap + u.moveOnlyAp) * battle.mobility(u);
    const nodes = () => [...battle.reach(u, budget).nodes.values()].filter(n => !(battle.occupant(n.x, n.y, n.z) && !same(n, u)));
    if (seen.length) {
        const near = nearestOf(u, seen);
        if (dist2(near, u) >= 5) return null;
        let best = null, bs = -Infinity;
        for (const n of nodes()) {
            const d = dist2(n, near); if (d < 5 || d > 10) continue;
            const s = (battle.sightLine({ x: n.x + .5, y: n.y + .5, h: n.z + 2.5 }, battle.chest(near)) ? 10 : 0) - Math.abs(d - 7);
            if (s > bs) { bs = s; best = n; }
        }
        return best && !same(best, u) ? { type: 'move', unitId: u.id, to: { x: best.x, y: best.y, z: best.z } } : null;
    }
    let goal = u.investigate ? searchGoal(battle, u) : null;
    if (!goal) { const ghost = enemyThreats(battle, u).sort((a, b) => a.age - b.age || dist2(a, u) - dist2(b, u))[0]; if (ghost) goal = { x: ghost.x, y: ghost.y, z: ghost.z }; }
    if (!goal) {
        const tech = battle.unit(u.techId), c = tech && alive(tech) ? tech : (u.home || u), a = 2 * Math.PI * unitHash(`${u.id}:sweep:${battle.round}`);
        goal = { x: Math.round(c.x + Math.cos(a) * 10), y: Math.round(c.y + Math.sin(a) * 10), z: c.z };
    }
    const d = n => Math.hypot(n.x - goal.x, n.y - goal.y) + Math.abs(n.z - goal.z);
    let best = null, bd = Infinity;
    for (const n of nodes()) { const v = d(n); if (v < bd - 1e-9) { bd = v; best = n; } }
    if (!best || same(best, u) || bd >= d(u) - 0.75) return null;
    return { type: 'move', unitId: u.id, to: { x: best.x, y: best.y, z: best.z } };
}
