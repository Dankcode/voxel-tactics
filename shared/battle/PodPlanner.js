// PLAN-15: the enemy plays as a pod. Once per pod per round it agrees on one focus target among the soldiers the side
// knows about and gives every member a role from where it stands and what it carries (instead of by id):
//
//   support  the member holding a useful grenade or gadget — it acts first, to break cover or smoke the pod in;
//   flanker  the member furthest round the side of the line to the focus — it works for the flank;
//   anchor   everyone else — holds cover and shoots, preferring the focus.
//
// Everything is read-only and deterministic (ties broken by id), so lockstep and the sim are unchanged in kind.
import { WALKERS } from './Walker.js';
import { WEAPONS, THROWABLES } from '../content/weapons.js';
import { alive } from './Units.js';
import { hitChance } from './HitChance.js';
import { enemyThreats } from './EnemyAi.js';

const byId = (a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
const ballistic = u => u.weapons.map(id => WEAPONS[id]).find(w => w?.kind === 'ballistic' && (u.ammo[w.id] ?? 0) > 0) || null;
const hasThrowable = u => Object.entries(u.items || {}).some(([id, n]) => n > 0 && THROWABLES[id] && !THROWABLES[id].placed && THROWABLES[id].kind !== 'gadget');

export function podMembers(battle, group) {
    return battle.units.filter(o => o.side === 'enemy' && alive(o) && !o.drone && !WALKERS[o.type] && (o.group ?? 0) === group).sort(byId);
}

/** The pod's plan for this round (cached on battle.podPlans; recomputed when the round, the focus or the intel changes). */
export function podPlan(battle, group) {
    battle.podPlans ||= {};
    const members = podMembers(battle, group);
    if (!members.length) return null;
    const threats = enemyThreats(battle, members[0]);
    const key = `${battle.round}:${members.map(m => m.id).join(',')}:${threats.map(t => `${t.u.id}@${t.x},${t.y}${t.ghost ? '?' : ''}`).join(';')}`;
    const cached = battle.podPlans[group];
    if (cached?.key === key && (!cached.focusId || alive(battle.unit(cached.focusId)))) return cached;
    const plan = { key, round: battle.round, focusId: null, roles: {} };
    // Focus: the soldier the pod can hurt most this round — summed expected damage over members, weighted toward
    // wounded soldiers (a likely kill) and away from soldiers nobody can see.
    let best = null;
    for (const t of threats) {
        let value = 0;
        for (const m of members) {
            const w = ballistic(m); if (!w) continue;
            const d = Math.hypot(t.x - m.x, t.y - m.y); if (d > w.maxRange) continue;
            const chance = t.ghost ? 0.15 : hitChance(battle, m, t.u, w).chance / 100;
            value += chance * (w.damage || 0) * (w.projectiles || 1);
        }
        value *= 1 + (1 - t.u.hp / Math.max(1, t.u.maxHp)) * 0.8;
        if (t.ghost) value *= 0.5;
        if (!best || value > best.value + 1e-9 || (Math.abs(value - best.value) <= 1e-9 && t.u.id < best.t.u.id)) best = { t, value };
    }
    plan.focusId = best?.t.u.id ?? null;
    const focus = best?.t || null;
    // Roles.
    const left = [...members];
    if (members.length >= 2) {
        const support = left.find(m => hasThrowable(m) && focus && Math.hypot(focus.x - m.x, focus.y - m.y) <= 12);
        if (support) { plan.roles[support.id] = 'support'; left.splice(left.indexOf(support), 1); }
    }
    if (focus && left.length >= 2) {
        const cx = members.reduce((s, m) => s + m.x, 0) / members.length, cy = members.reduce((s, m) => s + m.y, 0) / members.length;
        const lx = focus.x - cx, ly = focus.y - cy, ll = Math.hypot(lx, ly) || 1;
        const side = m => Math.abs((m.x - cx) * ly - (m.y - cy) * lx) / ll;
        const flanker = [...left].sort((a, b) => side(b) - side(a) || byId(a, b))[0];
        plan.roles[flanker.id] = 'flanker'; left.splice(left.indexOf(flanker), 1);
    }
    for (const m of left) plan.roles[m.id] = 'anchor';
    battle.podPlans[group] = plan;
    return plan;
}

/** Role of `u` in its pod plan (null when the unit is not in a pod with a plan). */
export function planRole(battle, u) {
    if (u.side !== 'enemy' || u.drone || WALKERS[u.type]) return null;
    return podPlan(battle, u.group ?? 0)?.roles[u.id] || null;
}
/** The pod's focus target id for `u`, if any. */
export function planFocus(battle, u) {
    if (u.side !== 'enemy') return null;
    return podPlan(battle, u.group ?? 0)?.focusId || null;
}
/** Action order inside the enemy phase: support first (cover-breaking), then flankers, then anchors. */
export const ROLE_ORDER = { support: 0, flanker: 1, anchor: 2 };
