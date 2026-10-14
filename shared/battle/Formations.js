// Formations with their own balancing rules (PLAN-01 rev 2 §14): slots, cohesion tiers, a cost, hard caps,
// static decay, the universal "clustered" counter for area attacks, and dissolution on losses.
import { WEAPONS } from '../content/weapons.js';
import { coverAt } from '../voxel/Cover.js';
import { FORMATIONS, FORMATION_RULES as R } from '../content/formations.js';
import { nodeKey, pathTo } from '../world/PathSearch.js';
import { alive } from './Units.js';

const CARDINAL = { n: [0, -1], e: [1, 0], s: [0, 1], w: [-1, 0] };
const cheb = (a, b) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));

export class Formations {
    constructor(battle) { this.battle = battle; this.list = new Map(); this.nextId = 1; }

    of(u) { return u?.formationId ? this.list.get(u.formationId) || null : null; }
    members(f) { return f.members.map(id => this.battle.unit(id)).filter(u => u && alive(u)); }
    tier(f) { return !f || f.assembling ? 0 : f.cohesion >= R.fullAt ? 1 : f.cohesion >= R.halfAt ? 0.5 : 0; }

    slotsFor(f, leader = this.battle.unit(f.leaderId)) {
        const tpl = FORMATIONS[f.template];
        if (!tpl.slots || !leader) return null;
        const [fx, fy] = CARDINAL[f.facing] || CARDINAL.n;
        const rx = -fy, ry = fx;
        return f.members.map((_, i) => {
            const [r, fwd] = tpl.slots[f.assignments?.[f.members[i]]??i];
            const x = leader.x + rx * r + fx * fwd, y = leader.y + ry * r + fy * fwd;
            const s = this.battle.store.surfaceNear(x, y, leader.z);
            return { x, y, z: s ? s.z : leader.z };
        });
    }
    inSlot(u, slot) { return slot && cheb(u, slot) <= 1 && Math.abs(u.z - slot.z) <= 1; }
    strays(f) {
        const slots = this.slotsFor(f);
        if (!slots) return 0;
        return f.members.reduce((n, id, i) => { const u = this.battle.unit(id); return n + (u && alive(u) && !this.inSlot(u, slots[i]) ? 1 : 0); }, 0);
    }

    // ---- intents
    validate(intent) {
        const tpl = FORMATIONS[intent.template];
        if (!tpl) return 'formation_invalid';
        const ids = intent.memberIds || [];
        if (new Set(ids).size !== ids.length || !ids.includes(intent.unitId) || (intent.leaderId && !ids.includes(intent.leaderId)) || ids.length < tpl.min || ids.length > tpl.max) return 'formation_invalid';
        const units = ids.map(id => this.battle.unit(id));
        if (units.some(u => !u || !alive(u) || u.side !== this.battle.activeSide || u.formationId)) return 'formation_invalid';
        if (intent.by && intent.by !== '*' && units.some(u => u.owner !== intent.by)) return 'not_your_unit';
        const side = units[0].side;
        const squad = this.battle.units.filter(u => u.side === side).length;
        const active = [...this.list.values()].filter(f => f.side === side).length;
        if (active >= Math.max(1, Math.floor(squad / R.perSoldiers))) return 'formation_invalid';
        if (intent.template === 'crossfire') {
            const [a, b] = units;
            if (!a.overwatch || !b.overwatch) return 'formation_invalid';
            if (Math.hypot(a.x - b.x, a.y - b.y) < tpl.minSpacing) return 'formation_invalid';
            if (!conesOverlap(a, b)) return 'formation_invalid';
            return null;
        }
        const leader = this.battle.unit(intent.leaderId || ids[0]);
        const f = { template: intent.template, facing: intent.facing || 'n', members: [leader.id, ...ids.filter(id => id !== leader.id)], leaderId: leader.id };
        const slots = this.slotsFor(f, leader);
        for (let i = 0; i < f.members.length; i++) {
            const u = this.battle.unit(f.members[i]), slot = slots[i];
            if (this.battle.store.surfaces(slot.x, slot.y).every(s => Math.abs(s.z - leader.z) > 1 || s.headroom < 2)) return 'formation_invalid';
            if (u.x === slot.x && u.y === slot.y && u.z === slot.z) continue;
            if (cheb(u, slot) > 3 || u.ap < 1) return 'formation_invalid';
        }
        if (tpl.requiresDoor && !this.battle.breachPoints(leader).length) return 'formation_invalid';
        return null;
    }

    declare(intent) {
        const b = this.battle, tpl = FORMATIONS[intent.template];
        const ids = intent.memberIds;
        const leaderId = intent.leaderId || ids[0];
        const f = { id: `f${this.nextId++}`, template: tpl.id, side: b.unit(leaderId).side, facing: intent.facing || 'n',
            members: [leaderId, ...ids.filter(id => id !== leaderId)], leaderId, cohesion: 100, staticPhases: 0 };
        // Formation declarations never teleport soldiers. Assemble by moving into highlighted slots.
        for (const id of f.members) b.unit(id).formationId = f.id;
        this.list.set(f.id, f);
        f.cohesion = Math.max(0, 100 - R.cohesionLossPerStray * this.strays(f));
        const st = b.stats.formations[tpl.id] ||= { declared: 0, phasesActive: 0, dissolved: 0, breaches: 0 };
        st.declared++;
        b.emit({ t: 'formation', action: 'declare', formation: { ...f } });
    }

    validatePlan(i){
        const b=this.battle,u=b.unit(i.unitId),tpl=FORMATIONS[i.template];
        if(!u||u.formationId||!tpl?.slots||!['n','e','s','w'].includes(i.facing))return 'formation_invalid';
        const active=[...this.list.values()].filter(f=>f.side===u.side).length;
        if(active>=Math.max(1,Math.floor(b.unitsOf(u.side).length/R.perSoldiers)))return 'formation_invalid';
        if(tpl.requiresDoor&&!b.breachPoints(u).length)return 'formation_invalid';
        return null;
    }
    plan(i){
        const u=this.battle.unit(i.unitId),f={id:`f${this.nextId++}`,template:i.template,side:u.side,facing:i.facing,leaderId:u.id,members:[u.id],assignments:{[u.id]:0},assembling:true,open:true,cohesion:100,staticPhases:0};
        this.list.set(f.id,f);u.formationId=f.id;
        this.battle.stats.formations[f.template]||={declared:0,phasesActive:0,dissolved:0,breaches:0};this.battle.stats.formations[f.template].declared++;
        this.recruit(f);this.battle.emit({t:'formation',action:'plan',formation:{...f}});
    }
    plannedSlots(f){const leader=this.battle.unit(f.leaderId),tpl=FORMATIONS[f.template];if(!leader||!tpl.slots)return [];
        return this.slotsFor({...f,members:tpl.slots.map((_,i)=>`slot${i}`),assignments:null},leader);
    }
    recruit(f){if(!f.open)return;const slots=this.plannedSlots(f),tpl=FORMATIONS[f.template];
        for(const u of this.battle.unitsOf(f.side)){
            if(u.formationId||f.members.length>=tpl.max)continue;
            const idx=slots.findIndex((p,i)=>i>0&&!Object.values(f.assignments).includes(i)&&u.x===p.x&&u.y===p.y&&u.z===p.z);
            if(idx>=0){u.formationId=f.id;f.members.push(u.id);f.assignments[u.id]=idx;this.battle.emit({t:'formation',action:'join',formationId:f.id,unitId:u.id});}
        }
        f.assembling=f.members.length<tpl.min;
    }
    groupBudget(u){const f=this.of(u);if(!f||f.assembling||f.leaderId!==u.id)return null;return Math.min(...this.members(f).map(m=>(m.ap+m.moveOnlyAp)*this.battle.mobility(m)));}
    onIncomingFire(target,shooter,wasVisible){
        const f=this.of(target),tpl=f&&FORMATIONS[f.template],b=this.battle;if(!f||!this.tier(f))return;
        if(tpl.bonus.counterattack){for(const u of this.members(f)){const w=WEAPONS[u.weapon];if(!alive(shooter))break;if(w?.kind==='ballistic'&&u.ammo[w.id]>0&&b.sees(u,shooter)&&b.distance(u,shooter)<=w.maxRange){b.stats.reactions++;b.emit({t:'reaction',watcherId:u.id,targetId:shooter.id,formation:true});b.fireWeapon(u,w,{unitId:shooter.id,part:'torso'},{reaction:true});}}}
        if(tpl.bonus.repositionOnAmbush&&!wasVisible){for(const u of this.members(f)){if(u.ap<1)continue;const search=b.reach(u,b.mobility(u));
            const score=p=>{const c=coverAt(b.store,p.x,p.y,p.z);return Math.max(c.n,c.e,c.s,c.w)*10+b.distance(p,shooter);};
            const candidates=[...search.nodes.values()].filter(p=>!b.occupant(p.x,p.y,p.z)&&b.distance(p,u)<=2).sort((a,c)=>score(c)-score(a));
            if(candidates[0]&&score(candidates[0])>score(u))b.doMove(u,candidates[0]);
        }}
    }

    dissolve(id, why) {
        const f = this.list.get(id); if (!f) return;
        for (const m of f.members) { const u = this.battle.unit(m); if (u && u.formationId === id) u.formationId = null; }
        this.list.delete(id);
        const st = this.battle.stats.formations[f.template]; if (st) st.dissolved++;
        this.battle.emit({ t: 'formation', action: 'dissolve', formationId: id, template: f.template, why });
    }

    // ---- hooks
    follow(leader) {
        const f = this.of(leader); if (!f || f.leaderId !== leader.id || !FORMATIONS[f.template].slots) return;
        const b = this.battle, slots = this.slotsFor(f);
        f.members.forEach((id, i) => {
            if (id === leader.id) return;
            const u = b.unit(id); if (!u || !alive(u)) return;
            const search = b.reach(u);
            const target = [slots[i], ...neighbours(slots[i])].find(c => search.costs.has(nodeKey(c)) && !b.occupant(c.x, c.y, c.z));
            if (!target) return;
            const cost = search.costs.get(nodeKey(target));
            const ap = b.apForCost(u, cost);
            if (ap > u.ap + u.moveOnlyAp) return;
            b.doMove(u, target);
        });
        this.recompute(f);
    }
    onMoved(u) {for(const f of this.list.values())this.recruit(f);const f=this.of(u);if(f&&!f.assembling)this.recompute(f);}
    recompute(f) {
        if (f.template === 'crossfire') {
            const [a, c] = this.members(f);
            if (!a || !c || !a.overwatch || !c.overwatch) return this.dissolve(f.id, 'overwatch ended');
            f.cohesion = 100; return;
        }
        const before = f.cohesion;
        f.cohesion = Math.max(0, Math.min(f.cohesion, 100 - R.cohesionLossPerStray * this.strays(f)));
        if (f.cohesion < R.halfAt && before >= R.halfAt) this.battle.emit({ t: 'formation', action: 'broken', formationId: f.id, cohesion: f.cohesion });
        if (this.members(f).length < FORMATIONS[f.template].min) this.dissolve(f.id, 'too few members');
    }
    onUnitLost(u) {
        const f = this.of(u); if (!f) return;
        f.members = f.members.filter(id => id !== u.id);
        u.formationId = null;
        if (!f.members.length) { this.dissolve(f.id, 'member lost'); return; }
        if (f.leaderId === u.id) {
            f.leaderId = f.members[0];
            // Rebase the slots around the new leader rather than leaving it assigned to an old wing.
            if(f.assignments)f.assignments=Object.fromEntries(f.members.map((id,i)=>[id,i]));
        } else if(f.assignments)delete f.assignments[u.id];
        if (f.members.length < FORMATIONS[f.template].min && !f.assembling) this.dissolve(f.id, 'member lost'); else if(!f.assembling)this.recompute(f);
    }
    onOverwatch(u) { const f = this.of(u); if (f?.template === 'crossfire') u.reactionsLeft = 1 + (FORMATIONS.crossfire.bonus.extraReactions || 0); }
    onBreach(units) {
        for (const u of units) { const f = this.of(u); if (f?.template === 'breach_stack') { this.battle.stats.formations.breach_stack.breaches++; this.dissolve(f.id, 'breached'); } }
    }
    onSideStart(side, owner = null) {
        for (const f of [...this.list.values()]) {
            if (f.side !== side || (owner && this.battle.unit(f.leaderId)?.owner!==owner)) continue;
            if (f.template === 'crossfire') { this.dissolve(f.id, 'new turn'); continue; }
            if (this.strays(f) === 0) f.cohesion = Math.min(100, f.cohesion + R.cohesionRegain);
            const st = this.battle.stats.formations[f.template]; if (st && this.tier(f) > 0) st.phasesActive++;
        }
    }
    onSideEnd(side, owner = null) {
        for (const f of this.list.values()) {
            if (f.side !== side || (owner && this.battle.unit(f.leaderId)?.owner!==owner) || f.template !== 'shield_line') continue;
            const leader = this.battle.unit(f.leaderId);
            if ((leader?.movedThisTurn || 0) >= 2) f.staticPhases = 0; else f.staticPhases++;
        }
    }

    // ---- effects read by the battle
    mobilityPenalty(u) { const f = this.of(u); return f ? (FORMATIONS[f.template].cost?.mobilityPerAp || 0) : 0; }
    reactionSpreadMult(u) {
        const f = this.of(u);
        return f?.template === 'crossfire' && this.tier(f) > 0 ? FORMATIONS.crossfire.bonus.reactionSpreadMult : null;
    }
    breachAccuracyMult(u) { const f = this.of(u); return f?.template === 'breach_stack' && this.tier(f) > 0 ? Math.min(R.maxAccuracyBonus, FORMATIONS.breach_stack.bonus.breachAccuracyMult) : 1; }
    breachNoiseMult(u) { const f = this.of(u); return f?.template === 'breach_stack' && this.tier(f) > 0 ? FORMATIONS.breach_stack.bonus.doorNoiseMult : 1; }
    defenseSpreadMult(target, shooter) {
        const f = this.of(target);
        if (!f || f.template !== 'shield_line') return 1;
        const slots = this.slotsFor(f), i = f.members.indexOf(target.id);
        if (!this.inSlot(target, slots?.[i])) return 1;
        const [fx, fy] = CARDINAL[f.facing];
        const dx = shooter.x - target.x, dy = shooter.y - target.y, d = Math.hypot(dx, dy) || 1;
        if ((dx * fx + dy * fy) / d < Math.SQRT1_2) return 1;      // outside the front 90°
        const decay = Math.max(0, 1 - FORMATIONS.shield_line.decayPerStaticPhase * f.staticPhases);
        const bonus = (FORMATIONS.shield_line.bonus.frontSpreadMult - 1) * this.tier(f) * decay;
        return Math.min(R.maxDefenseBonus, 1 + bonus);
    }
    /** The universal counter: two or more allies within 2 tiles makes a unit "clustered" for area attacks. */
    isClustered(u) {
        let n = 0;
        for (const o of this.battle.units) if (o !== u && alive(o) && o.side === u.side && cheb(o, u) <= 2 && Math.abs(o.z - u.z) <= 1) n++;
        return n >= 2;
    }
    snapshot() { return [...this.list.values()].map(f => ({ ...f, tier: this.tier(f), strays: this.strays(f) })); }
}

function neighbours(c) { return [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]].map(([dx, dy]) => ({ x: c.x + dx, y: c.y + dy, z: c.z })); }

export function conesOverlap(a, b) {
    // Sample each cone's axis; overlapping if a sample of one lies inside the other.
    const inside = (w, p) => {
        const dx = p.x - w.x, dy = p.y - w.y, d = Math.hypot(dx, dy);
        if (d < 0.5 || d > w.overwatch.range) return false;
        return (dx * w.overwatch.dx + dy * w.overwatch.dy) / d >= Math.cos(w.overwatch.halfAngle);
    };
    for (const [w, o] of [[a, b], [b, a]]) for (let t = 2; t <= w.overwatch.range; t += 1.5) {
        if (inside(o, { x: w.x + w.overwatch.dx * t, y: w.y + w.overwatch.dy * t })) return true;
    }
    return false;
}
