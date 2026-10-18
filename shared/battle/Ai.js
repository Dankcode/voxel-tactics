import { WALKERS } from './Walker.js';
// Tactical AI shared by enemies, the player-side autopilot and the balance sim.
// It scores reachable tiles by cover against known threats, flanking chances, range and hazards, then
// shoots (expected damage from the same ballistic estimate the HUD uses), throws, overwatches or reloads.
import { WEAPONS, THROWABLES } from '../content/weapons.js';
import { coverAgainst, hardCoverAgainst, COVER } from '../voxel/Cover.js';
import { estimateShot } from './Ballistics.js';
import { alive, partArmor } from './Units.js';
import { nodeKey, pathTo, reachable } from '../world/PathSearch.js';
import { AGENT_PROFILES } from '../world/TraversalRules.js';
import { MAT } from '../voxel/Materials.js';
import { inZone, extractionOpen, objectiveGoal } from './Objectives.js';
import { reserveAmmo } from '../inventory/Equipment.js';
import { decideEnemy, enemyThreats, patrolStep } from './EnemyAi.js';
import { DEFAULT_TUNING } from '../session/Playstyle.js';

export const DEFAULT_POLICY = Object.freeze({ formations: false, breach: true, grenadeMinTargets: 2, shootThreshold: 0.9, samples: 24 });

/** Play every unit of `side`, then end the turn. Returns the events produced. */
export function runAiSide(battle, side, policy = DEFAULT_POLICY, { maxActions = 80 } = {}) {
    const start = battle.log.length;
    policy = { ...DEFAULT_POLICY, ...policy };
    if (policy.formations || side === 'enemy') for (const intent of formationIntents(battle, side)) battle.apply(intent);
    let actions = 0;
    for (const u of aiOrder(battle, side)) {
        let guard = 0;
        while (alive(u) && !battle.outcome && guard++ < 6 && actions < maxActions) {
            const intent = decide(battle, u, policy);
            if (!intent) break;
            const r = battle.apply(intent);
            actions++;
            if (!r.ok) break;
        }
        if (battle.outcome) break;
    }
    if (!battle.outcome && battle.activeSide === side) battle.apply({ type: 'endTurn', side });
    return battle.log.slice(start);
}

/** Turn order for AI units: formation leaders first, so members follow the group move before acting themselves. */
export function aiOrder(battle, side) {
    const lead = u => { const f = battle.formations.of(u); return f && f.leaderId === u.id ? 0 : f ? 2 : 1; };
    return battle.unitsOf(side).map((u, i) => ({ u, i, k: lead(u) })).sort((a, b) => a.k - b.k || a.i - b.i).map(x => x.u);
}

function knownEnemies(battle, u) {
    const seen = battle.visibleTo(u.side);
    const known = battle.enemiesOf(u).filter(e => seen.has(e.id));
    return known;
}

export function decide(battle, u, policy = DEFAULT_POLICY) {
    policy = { ...DEFAULT_POLICY, ...policy };
    // PLAN-10: unalerted pods patrol around their post (policy.patrol false keeps them still, e.g. scripted tests).
    if (u.side === 'enemy' && !u.alerted) return policy.patrol === false ? null : patrolStep(battle, u);
    if (u.ap <= 0 && u.moveOnlyAp <= 0) return null;
    // PLAN-09: the enemy side plays by its own intel, hit chances, roles, gadgets and the player's cached playstyle.
    if (u.side === 'enemy' && !policy.classicEnemies) return decideEnemy(battle, u, policy);
    const known = knownEnemies(battle, u);
    if(WALKERS[u.type] && !known.length){const target=nearest(u,battle.enemiesOf(u));if(!target)return null;const step=approach(battle,u,target,0);return step?{type:'move',unitId:u.id,to:step}:null;}
    const guns = u.weapons.map(id => WEAPONS[id]).filter(w => w.kind === 'ballistic');
    const ranged = guns.find(w => (u.ammo[w.id] || 0) > 0) || guns.find(w => !w.boltAction && reserveAmmo(u, w) > 0);
    const melee = u.weapons.map(id => WEAPONS[id]).find(w => w.kind === 'melee');

    // Objectives (squad side): extract from the zone, pick up the item, and steer movement toward the goal.
    const o = battle.objective;
    const goal = u.side === 'player' && o ? objectiveGoal(o) : null;
    if (u.side === 'player' && o && u.ap >= 1) {
        if (extractionOpen(o) && inZone(o.zone, u) && (o.kind === 'extract' || o.item?.carrier === u.id)) return { type: 'extract', unitId: u.id };
        const it = o.kind === 'recover' ? o.item : null;
        if (it && !it.carrier && !it.secured && Math.max(Math.abs(it.x - u.x), Math.abs(it.y - u.y)) <= 1 && Math.abs(it.z - u.z) <= 1) return { type: 'recover', unitId: u.id };
    }

    // Melee specialists close in and strike.
    if (!ranged && melee) {
        const adj = known.find(e => Math.max(Math.abs(e.x - u.x), Math.abs(e.y - u.y)) <= 1 && Math.abs(e.z - u.z) <= 1);
        if (adj && u.ap >= melee.ap) return { type: 'melee', unitId: u.id, weaponId: melee.id, targetId: adj.id, part: 'torso' };
        const target = nearest(u, known.length ? known : battle.enemiesOf(u));
        if (!target) return null;
        const step = approach(battle, u, target, Math.max(0, u.ap - melee.ap));
        return step ? { type: 'move', unitId: u.id, to: step } : null;
    }
    if (!ranged) return null;

    // Breach a closed door to an unexplored room next to us (player autopilot / sim).
    if (policy.breach && u.side === 'player' && u.ap >= 2) {
        // Door entries only: floor charges (entry 'floor') have no room behind them and need their own intent.
        const bp = battle.breachPoints(u).find(p => p.entry === 'door' && !battle.revealedRooms.has(p.roomId));
        if (bp) {
            const squad = battle.unitsOf(u.side).filter(o => o.ap >= 1 && Math.max(Math.abs(o.x - bp.x), Math.abs(o.y - bp.y)) <= 2 && Math.abs(o.z - bp.z) <= 1);
            const entry = squad.some(o => o.items.breach_charge > 0) && known.length === 0 ? 'charge' : 'door';
            return { type: 'breach', unitId: u.id, unitIds: squad.map(o => o.id), door: bp, entry };
        }
    }

    const ammoOk = (u.ammo[ranged.id] ?? 0) >= 1;
    const canReload = !ranged.boltAction && reserveAmmo(u, ranged) > 0 && u.ap >= ranged.reloadAp;
    if (!ammoOk && canReload) return { type: 'reload', unitId: u.id, weaponId: ranged.id };
    if (u.weapon !== ranged.id) return { type: 'switchWeapon', unitId: u.id, weaponId: ranged.id };
    const shotAp = battle.shotAp(u, ranged);

    // Grenades and flasks on clusters or dug-in targets.
    for (const [id, n] of Object.entries(u.items)) {
        const t = THROWABLES[id];
        if (!n || !t || t.placed || !t.damage || u.ap < t.ap) continue;
        let best = null;
        for (const e of known) {
            if (Math.hypot(e.x - u.x, e.y - u.y) > t.range) continue;
            const hits = known.filter(o => Math.hypot(o.x - e.x, o.y - e.y) <= t.radius).length;
            const friendly = battle.unitsOf(u.side).filter(o => Math.hypot(o.x - e.x, o.y - e.y) <= t.radius + 0.5).length;
            const dug = coverAgainst(battle.store, e.x, e.y, e.z, u.x, u.y, u.z) === COVER.FULL ? 1 : 0;
            const score = hits + dug * 0.6 - friendly * 3;
            if (score >= policy.grenadeMinTargets - 0.5 && (!best || score > best.score)) best = { e, score };
        }
        if (best) return { type: 'throw', unitId: u.id, itemId: id, to: { x: best.e.x, y: best.e.y, z: best.e.z } };
    }

    // Shoot now if there is a good shot and we would not gain by moving first.
    const shot = ammoOk && u.ap >= shotAp ? bestShot(battle, u, ranged, known, policy) : null;
    const canMoveAndShoot = u.ap + u.moveOnlyAp - shotAp >= 1;
    if (shot && (!canMoveAndShoot || shot.value >= policy.shootThreshold * 2 || u.movedThisTurn)) return shot.intent;

    // Formation members hold their slots; the leader moves the whole formation (group move).
    const formation = battle.formations.of(u);
    const holdSlot = formation && formation.template !== 'crossfire' && formation.leaderId !== u.id;
    const group = !!formation && formation.leaderId === u.id;
    if (holdSlot) {
        if (shot) return shot.intent;
        if (ammoOk && u.ap >= ranged.ap && known.length) { const t = nearest(u, known); return { type: 'overwatch', unitId: u.id, weaponId: ranged.id, toward: { x: t.x, y: t.y } }; }
        return null;
    }

    // Nothing in sight: advance on the objective, else the nearest hostile (patrol / search). On generated maps a
    // third of the squad works up a flank of the line of play (PLAN-04 §5.4: the autopilot uses flanks).
    if (!known.length) {
        if (u.movedThisTurn >= 1 && u.ap < 2) return null;
        const target = (goal && flankTarget(battle, u, goal)) || (goal ? { ...goal, z: goal.z ?? u.z } : nearest(u, battle.enemiesOf(u)));
        if (!target || u.movedThisTurn > 12) return null;
        // Closed doors stop squad movement until kicked (classic and intel rules): kick the one in the way.
        const door = closedDoorOnRoute(battle, u, target);
        if (door && u.ap >= 1 && Math.max(Math.abs(door.door.x - u.x), Math.abs(door.door.y - u.y)) <= 1 && Math.abs(door.door.z - u.z) <= 1)
            return { type: 'door', unitId: u.id, door: { x: door.door.x, y: door.door.y, z: door.door.z } };
        const step = advance(battle, u, door ? door.approach : target);
        if (step && group && battle.formations.blockedAt(formation, step)) return { type: 'formation_break', unitId: u.id, formationId: formation.id };
        return step ? { type: 'move', unitId: u.id, to: step, group } : null;
    }

    // Move to a better tile, keeping enough AP to shoot.
    if (u.ap + u.moveOnlyAp > (ammoOk ? shotAp : 0) && !u.movedThisTurn) {
        const budgetAp = Math.max(1, u.ap + u.moveOnlyAp - (ammoOk ? shotAp : 0));
        const tile = bestTile(battle, u, ranged, known.length ? known : battle.enemiesOf(u), budgetAp, goal);
        if (tile && group && battle.formations.blockedAt(formation, tile)) return { type: 'formation_break', unitId: u.id, formationId: formation.id };
        if (tile && (tile.x !== u.x || tile.y !== u.y || tile.z !== u.z)) return { type: 'move', unitId: u.id, to: tile, group };
    }
    if (shot) return shot.intent;
    if (ammoOk && u.ap >= ranged.ap) {
        const t = nearest(u, known.length ? known : battle.enemiesOf(u));
        if (t) return { type: 'overwatch', unitId: u.id, weaponId: ranged.id, toward: { x: t.x, y: t.y } };
    }
    if (!ammoOk && canReload) return { type: 'reload', unitId: u.id, weaponId: ranged.id };
    return null;
}

function bestShot(battle, u, w, known, policy) {
    let best = null;
    for (const e of known) {
        if (Math.hypot(e.x - u.x, e.y - u.y) > w.maxRange) continue;
        for (const part of ['torso', 'head']) {
            const aim = { unitId: e.id, part };
            const { spread } = battle.spreadFor(u, w, { x: e.x + 0.5, y: e.y + 0.5, h: e.z + 2 }, { target: e });
            const est = estimateShot(battle, u, aim, { weapon: w, spread, samples: policy.samples });
            const perHit = Math.max(0, w.damage - Math.max(0, partArmor(e, part) - w.pierce));
            let value = est.hit * w.projectiles * perHit / Math.max(1, w.ap) - est.friendly * 10;
            if (value * Math.max(1, w.ap) >= e.hp) value *= 1.5;                    // likely kill
            if (!best || value > best.value) best = { value, intent: { type: 'shoot', unitId: u.id, weaponId: w.id, aim } };
        }
    }
    return best && best.value > 0.05 ? best : null;
}

function bestTile(battle, u, w, threats, budgetAp, goal = null) {
    const o = battle.objective;
    const pull = !goal ? 0 : (o.kind === 'extract' || o.item?.carrier === u.id) ? 2.2 : o.kind === 'hold' ? 1.2 : 0.8;
    const search = battle.reach(u, budgetAp * battle.mobility(u));
    const nodes = [...search.nodes.values()];
    if (!nodes.length) return null;
    const stride = Math.max(1, Math.floor(nodes.length / 260));
    const allies = battle.unitsOf(u.side).filter(o => o.id !== u.id);
    const pockets = battle.mission.meta?.pockets || [];
    const scored = [];
    for (let i = 0; i < nodes.length; i += stride) {
        const n = nodes[i];
        if (battle.occupant(n.x, n.y, n.z) && !(n.x === u.x && n.y === u.y && n.z === u.z)) continue;
        let s = 0;
        for (const e of threats) {
            const d = Math.hypot(e.x - n.x, e.y - n.y);
            if (d > 30) continue;
            // PLAN-07: cover the threat's round would go straight through is worth half.
            const ew = WEAPONS[e.weapon], hc = hardCoverAgainst(battle.store, n.x, n.y, n.z, e.x, e.y, e.z, ew?.energy || 6), c = hc.level;
            s += (c === COVER.FULL ? 14 : c === COVER.HALF ? 8 : -9) * (c && hc.soft ? 0.5 : 1);
            if (d <= w.range && coverAgainst(battle.store, e.x, e.y, e.z, n.x, n.y, n.z) === COVER.NONE) s += 10;  // flanks it
        }
        const nearestD = Math.min(...threats.map(e => Math.hypot(e.x - n.x, e.y - n.y)), 99);
        s -= Math.abs(nearestD - w.range * 0.7) * 0.7;
        const surf = battle.field.surfaceAt(n.x, n.y, n.z);
        if (surf === 'burning' || battle.field.isBurning(n.x, n.y, n.z)) s -= 40;
        s -= allies.filter(o => Math.max(Math.abs(o.x - n.x), Math.abs(o.y - n.y)) <= 2).length * 4;
        if (threats.length) s += Math.max(0, n.z - Math.min(...threats.map(e => e.z))) * 2;
        // Enemies defend the engagement pockets the generator built along the line of play.
        if (u.side === 'enemy' && pockets.length && pockets.some(p => Math.hypot(p.x - n.x, p.y - n.y) <= 2.5)) s += 2.5;
        if (goal) {
            s -= Math.hypot(n.x - goal.x, n.y - goal.y) * pull;
            if (o.zone && inZone(o.zone, n) && o.kind !== 'recover') s += 25;
        }
        scored.push({ n, s });
    }
    scored.sort((a, b) => b.s - a.s);
    // Prefer tiles that can actually see a threat.
    for (const c of scored.slice(0, 12)) {
        const eye = { x: c.n.x + 0.5, y: c.n.y + 0.5, h: c.n.z + 2.4 };
        if (threats.some(e => Math.hypot(e.x - c.n.x, e.y - c.n.y) <= w.maxRange && battle.sightLine(eye, battle.chest(e)))) c.s += 16;
    }
    scored.sort((a, b) => b.s - a.s);
    return scored[0]?.n || null;
}

function advance(battle, u, target) {
    // Follow the real path (stairs, doors) toward the target as far as this turn's budget allows.
    const available = (u.ap + u.moveOnlyAp) * battle.mobility(u);
    const budget = Math.max(1, u.ap + u.moveOnlyAp - 1) * battle.mobility(u);
    const full = battle.reach(u, Infinity);
    let goal = null, gd = Infinity;
    for (const n of full.nodes.values()) {
        const d = Math.hypot(n.x - target.x, n.y - target.y) + Math.abs(n.z - target.z) * 1.5;
        if (d < gd && !(battle.occupant(n.x, n.y, n.z) && battle.occupant(n.x, n.y, n.z) !== u)) { gd = d; goal = n; }
    }
    if (!goal) return null;
    const path = pathTo(full, nodeKey(goal));
    const stepWithin = limit => {
        let best = null;
        for (const p of path) {
            if (full.costs.get(nodeKey(p)) > limit) break;
            if (!battle.occupant(p.x, p.y, p.z)) best = p;
        }
        return best && (best.x !== u.x || best.y !== u.y || best.z !== u.z) ? best : null;
    };
    // Ladders are atomic moves. If reserving an AP prevents any progress, allow a full-turn climb/dash.
    return stepWithin(Math.min(budget,available)) || stepWithin(available);
}

/**
 * When closed doors keep the squad from getting near `target`, the first closed door on the route that ignores doors,
 * and the cell to stand on to kick it. Null when the target is reachable already (or not at all).
 */
function closedDoorOnRoute(battle, u, target) {
    if (u.side !== 'player') return null;
    const near = (search) => { let best = null, bd = Infinity; for (const n of search.nodes.values()) { const d = Math.hypot(n.x - target.x, n.y - target.y) + Math.abs(n.z - (target.z ?? n.z)) * 1.5; if (d < bd) { bd = d; best = n; } } return { best, bd }; };
    const full = battle.reach(u, Infinity), mine = near(full);
    if (mine.bd <= 2) return null;
    const open = reachable(battle.store, { x: u.x, y: u.y, z: u.z }, Infinity, AGENT_PROFILES.player, { blocked: to => { const o = battle.occupant(to.x, to.y, to.z); return o && o.id !== u.id; } });
    const there = near(open);
    if (!there.best || there.bd >= mine.bd - 1) return null;
    const path = pathTo(open, nodeKey(there.best));
    for (let i = 1; i < path.length; i++) {
        const p = path[i];
        if (battle.store.get(p.x, p.y, p.z + 1) === MAT.door) return full.costs.has(nodeKey(path[i - 1])) ? { door: p, approach: path[i - 1] } : null;
    }
    return null;
}

/** Flankers (every third squad member) follow a flank path ~12 cells ahead of where they stand, then the goal. */
function flankTarget(battle, u, goal) {
    const flanks = battle.mission.meta?.flanks;
    const idx = Number(String(u.id).replace(/\D/g, '')) || 0;
    if (!flanks?.length || idx % 3 !== 1) return null;
    const f = flanks[Math.floor(idx / 3) % flanks.length], path = f.cells;
    if (!path?.length) return null;
    let at = 0, best = Infinity;
    for (let i = 0; i < path.length; i++) { const d = Math.hypot(path[i][0] - u.x, path[i][1] - u.y); if (d < best) { best = d; at = i; } }
    if (at >= path.length - 6) return null;
    const [x, y] = path[Math.min(path.length - 1, at + 12)];
    return { x, y, z: battle.mission.meta.streetDatum ?? u.z };
}

function nearest(u, list) { let b = null, bd = Infinity; for (const e of list) { const d = Math.hypot(e.x - u.x, e.y - u.y); if (d < bd) { bd = d; b = e; } } return b; }

function approach(battle, u, target, keepAp) {
    const budget = Math.max(1, u.ap + u.moveOnlyAp - keepAp) * battle.mobility(u);
    const search = battle.reach(u, budget);
    let best = null, bd = Infinity;
    for (const n of search.nodes.values()) {
        if (battle.occupant(n.x, n.y, n.z)?.id!==u.id && battle.occupant(n.x,n.y,n.z)) continue;
        const d = Math.hypot(n.x - target.x, n.y - target.y) + Math.abs(n.z - target.z);
        if (d < bd) { bd = d; best = n; }
    }
    return best && (best.x !== u.x || best.y !== u.y || best.z!==u.z) ? best : null;
}

/**
 * Sim/autopilot formation policy. Form a Shield Line only when enemies are known and the leader and its
 * slots already have cover toward them; break formations when nothing is in sight (to advance freely).
 */
export function formationIntents(battle, side) {
    const intents = [];
    const known = [...battle.visibleTo(side)].map(id => battle.unit(id)).filter(Boolean);
    for (const f of battle.formations.snapshot().filter(f => f.side === side)) {
        if (!known.length && f.template === 'shield_line') intents.push({ type: 'formation_break', unitId: f.leaderId, formationId: f.id });
        // Enemy pods advance in a wedge and spread into cover on contact.
        else if (side === 'enemy' && known.length && f.template === 'wedge') intents.push({ type: 'formation_break', unitId: f.leaderId, formationId: f.id });
    }
    // PLAN-09: single-tile enemies use formations too (walker monsters never do). A squad that punishes clusters with
    // grenades and elements (cached playstyle) makes them stay loose.
    if (side === 'enemy' && (battle.aiTuning || DEFAULT_TUNING).spread >= 1.5) return intents;
    if (!known.length) return side === 'enemy' ? [...intents, ...enemyWedges(battle)] : intents;
    const units = battle.unitsOf(side).filter(u => !u.formationId && u.ap >= 2 && !WALKERS[u.type] && (side !== 'enemy' || u.alerted));
    const cx = known.reduce((s, e) => s + e.x, 0) / known.length, cy = known.reduce((s, e) => s + e.y, 0) / known.length, cz = known.reduce((s,e)=>s+e.z,0)/known.length;
    for (const leader of units) {
        if (coverAgainst(battle.store, leader.x, leader.y, leader.z, Math.round(cx), Math.round(cy), cz) === COVER.NONE) continue;
        const dx = cx - leader.x, dy = cy - leader.y;
        const facing = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'e' : 'w') : (dy > 0 ? 's' : 'n');
        const mates = units.filter(o => o !== leader && !o.formationId && Math.max(Math.abs(o.x - leader.x), Math.abs(o.y - leader.y)) <= 3).slice(0, 2);
        if (mates.length < 1) continue;
        const intent = { type: 'formation', template: 'shield_line', unitId: leader.id, leaderId: leader.id, memberIds: [leader.id, ...mates.map(m => m.id)], facing };
        const f = { template: 'shield_line', facing, members: intent.memberIds, leaderId: leader.id };
        const slots = battle.formations.slotsFor(f, leader);
        if (!slots || slots.some(sl => coverAgainst(battle.store, sl.x, sl.y, sl.z, Math.round(cx), Math.round(cy), cz) === COVER.NONE)) continue;
        if (!battle.validate(intent)) return [...intents, intent];
    }
    return intents;
}

/** Alerted enemy pods with a lead on the squad (intel, nobody in sight) advance in a wedge toward it. */
function enemyWedges(battle) {
    const out = [], used = new Set();
    const units = battle.unitsOf('enemy').filter(u => !u.formationId && u.ap >= 2 && u.alerted && !WALKERS[u.type]);
    for (const leader of units) {
        if (used.has(leader.id)) continue;
        const lead = nearest(leader, enemyThreats(battle, leader));
        if (!lead) continue;
        const mates = units.filter(o => o !== leader && !used.has(o.id) && (o.group ?? 0) === (leader.group ?? 0) && Math.max(Math.abs(o.x - leader.x), Math.abs(o.y - leader.y)) <= 3).slice(0, 3);
        if (!mates.length) continue;
        const dx = lead.x - leader.x, dy = lead.y - leader.y;
        const facing = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'e' : 'w') : (dy > 0 ? 's' : 'n');
        const intent = { type: 'formation', template: 'wedge', unitId: leader.id, leaderId: leader.id, memberIds: [leader.id, ...mates.map(m => m.id)], facing };
        if (battle.validate(intent)) continue;
        out.push(intent);
        for (const id of intent.memberIds) used.add(id);
        break;                                                 // one new formation per phase (the side's cap re-checks next phase)
    }
    return out;
}
