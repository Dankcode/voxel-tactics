// After-battle status report: everything a tester needs to compare scenario runs, derived from the battle's event
// log and final unit state. Pure (no clock, no DOM): the client shows it after every battle, the sim prints it, and
// tests check it. Plain JSON, so it can be saved, downloaded and diffed.
import { CLASSES, ENEMIES, ABILITIES } from '../content/units.js';
import { WEAPONS, THROWABLES } from '../content/weapons.js';
import { objectiveStatus } from '../battle/Objectives.js';

export const REPORT_VERSION = 1;
const pct = (a, b) => (b ? Math.round((a / b) * 1000) / 10 : null);
const typeName = u => (CLASSES[u.type] || ENEMIES[u.type])?.name || u.type;
const statusOf = u => (u.extracted ? 'extracted' : u.dead ? 'killed' : u.down ? 'down' : u.hp < u.maxHp ? 'wounded' : 'unhurt');

/**
 * @param battle a finished (or abandoned) Battle
 * @param desc the scenario descriptor it was created from (scenario, seed, squad, operation, test …)
 * @param extra optional fields the caller adds (e.g. { at: ISO time, durationMs }) — kept verbatim under `run`
 */
export function battleReport(battle, desc = {}, extra = {}) {
    const b = battle, m = b.mission;
    const per = new Map(b.units.map(u => [u.id, {
        id: u.id, name: u.name || typeName(u), side: u.side, type: u.type, typeName: typeName(u), group: u.group ?? null,
        status: statusOf(u), hp: Math.max(0, u.hp), maxHp: u.maxHp, will: u.will, stress: u.stress ?? 0,
        shots: 0, shotsHit: 0, projectiles: 0, projectileHits: 0, melee: 0, reactions: 0,
        damageDealt: 0, friendlyDamage: 0, damageTaken: 0, environmentDamage: 0, kills: 0, killedBy: null, killedRound: null,
        moves: 0, tilesMoved: 0, overwatch: 0, reloads: 0, doorsKicked: 0, breaches: 0, healed: 0, healsGiven: 0,
        abilities: {}, items: {}, statuses: {}, disabled: []
    }]));
    const P = id => per.get(id);
    const name = id => P(id)?.name || id;
    const weapons = {};                              // `${side}:${weaponId}` → stats
    const wstat = (side, id) => weapons[`${side}:${id}`] ||= { side, id, name: WEAPONS[id]?.name || id, shots: 0, shotsHit: 0, projectiles: 0, projectileHits: 0, damage: 0, kills: 0 };
    const lastHit = new Map();                       // target id → { source, weaponId }
    const lastThrow = new Map();                     // thrower id → item id (explosion kills)
    const timeline = [];
    let firstContact = null, collapses = 0, doorsKicked = 0, rounds = 1;
    const note = (round, side, text) => { if (timeline.length < 80) timeline.push({ round, side, text }); };
    for (const e of b.log) {
        rounds = Math.max(rounds, e.round || 1);
        switch (e.t) {
            case 'shot': {
                const s = P(e.unitId); if (!s) break;
                const w = wstat(s.side, e.weaponId), hits = e.projectiles.filter(p => p.unitId && P(p.unitId)?.side !== s.side);
                s.shots++; w.shots++; s.projectiles += e.projectiles.length; w.projectiles += e.projectiles.length;
                s.projectileHits += hits.length; w.projectileHits += hits.length;
                if (hits.length) { s.shotsHit++; w.shotsHit++; }
                for (const p of e.projectiles) if (p.unitId) { w.damage += P(p.unitId)?.side !== s.side ? p.damage || 0 : 0; lastHit.set(p.unitId, { source: s.id, weaponId: e.weaponId }); }
                break;
            }
            case 'melee': {
                const s = P(e.unitId); if (!s) break;
                const w = wstat(s.side, e.weaponId); s.melee++; w.shots++; w.projectiles++;
                if (e.damage > 0) { w.shotsHit++; w.projectileHits++; w.damage += e.damage; }
                lastHit.set(e.targetId, { source: s.id, weaponId: e.weaponId });
                break;
            }
            case 'reaction': { const s = P(e.watcherId); if (s) s.reactions++; break; }
            case 'damage': {
                const t = P(e.unitId); if (!t) break;
                t.damageTaken += e.amount;
                const src = P(e.source);
                if (src) { if (src.side !== t.side) src.damageDealt += e.amount; else src.friendlyDamage += e.amount; }   // friendly fire includes self-inflicted
                else t.environmentDamage += e.amount;
                break;
            }
            case 'death': {
                const t = P(e.unitId); if (!t) break;
                t.killedRound = e.round; t.killedBy = e.source ?? null;
                const src = P(e.source), hit = lastHit.get(e.unitId);
                if (src && src.side !== t.side) { src.kills++; if (hit?.source === src.id) wstat(src.side, hit.weaponId).kills++; }
                const tool = hit?.source === src?.id ? WEAPONS[hit.weaponId]?.name || hit.weaponId : lastThrow.has(src?.id) ? THROWABLES[lastThrow.get(src.id)]?.name : null;
                const how = src ? `${src.name}${tool ? ` (${tool})` : ''}` : (e.source || 'the environment');
                note(e.round, t.side, `${t.name} ${t.side === 'player' ? 'killed' : 'down'} — ${how}`);
                break;
            }
            case 'move': { const s = P(e.unitId); if (s && !e.scatter) { s.moves++; s.tilesMoved += Math.max(0, (e.path?.length || 1) - 1); } break; }
            case 'ability': { const s = P(e.unitId); if (s) s.abilities[e.abilityId] = (s.abilities[e.abilityId] || 0) + 1; break; }
            case 'throw': { const s = P(e.unitId); if (s) { s.items[e.itemId] = (s.items[e.itemId] || 0) + 1; lastThrow.set(s.id, e.itemId); } break; }
            case 'heal': {
                const t = P(e.unitId), s = P(e.sourceId); if (t) t.healed += e.amount;
                if (s) { s.healsGiven += e.amount; if (e.itemId) s.items[e.itemId] = (s.items[e.itemId] || 0) + 1; }
                break;
            }
            case 'reload': { const s = P(e.unitId); if (s) s.reloads++; break; }
            case 'overwatch': { const s = P(e.unitId); if (s) s.overwatch++; break; }
            case 'door': if (e.kicked) { doorsKicked++; const s = P(e.unitId); if (s) s.doorsKicked++; } break;
            case 'breach': {
                for (const id of e.unitIds || []) { const s = P(id); if (s) s.breaches++; }
                const lead = P(e.unitIds?.[0]);
                if (lead && (e.entry === 'charge' || e.entry === 'floor')) lead.items.breach_charge = (lead.items.breach_charge || 0) + 1;
                note(e.round, 'player', `Breach (${e.entry}) by ${(e.unitIds || []).map(name).join(', ')}`);
                break;
            }
            case 'status': { const s = P(e.unitId); if (s) s.statuses[e.statusId] = (s.statuses[e.statusId] || 0) + 1; break; }
            case 'disabled': { const s = P(e.unitId); if (s) { s.disabled.push(e.part); note(e.round, s.side, `${s.name}: ${e.part} disabled`); } break; }
            case 'alert': case 'discovery':
                if (firstContact == null) { firstContact = e.round; note(e.round, 'enemy', `First contact (${e.t === 'discovery' ? 'pod scattered' : e.why || 'alerted'})`); }
                break;
            case 'collapse': collapses++; break;
            case 'recover': note(e.round, 'player', `${name(e.unitId)} ${e.secured ? 'secured' : 'picked up'} ${e.label}`); break;
            case 'extract': note(e.round, 'player', `${name(e.unitId)} extracted${e.item ? ' with the package' : ''}`); break;
            case 'outcome': note(e.round, e.winner, `Outcome: ${e.winner} — ${e.reason}`); break;
        }
    }
    const list = side => [...per.values()].filter(s => s.side === side);
    const squad = list('player'), hostiles = list('enemy');
    const sideTotals = (mine, theirs) => {
        const shots = mine.reduce((n, s) => n + s.shots, 0), hit = mine.reduce((n, s) => n + s.shotsHit, 0);
        return {
            units: mine.length, standing: mine.filter(s => s.status !== 'killed' && s.status !== 'down').length,
            losses: mine.filter(s => s.status === 'killed' || s.status === 'down').length,
            kills: mine.reduce((n, s) => n + s.kills, 0), shots, shotsHit: hit, accuracy: pct(hit, shots),
            damageDealt: mine.reduce((n, s) => n + s.damageDealt, 0), damageTaken: mine.reduce((n, s) => n + s.damageTaken, 0),
            friendlyDamage: mine.reduce((n, s) => n + s.friendlyDamage, 0), hpLeft: mine.reduce((n, s) => n + s.hp, 0), hpMax: mine.reduce((n, s) => n + s.maxHp, 0),
            reactions: mine.reduce((n, s) => n + s.reactions, 0), opponents: theirs.length
        };
    };
    const byType = {};
    for (const s of hostiles) {
        const t = byType[s.type] ||= { type: s.type, name: s.typeName, count: 0, killed: 0, survived: 0, damageDealt: 0, damageTaken: 0 };
        t.count++; if (s.status === 'killed' || s.status === 'down') t.killed++; else t.survived++;
        t.damageDealt += s.damageDealt; t.damageTaken += s.damageTaken;
    }
    for (const s of [...squad, ...hostiles]) for (const k of ['accuracy']) s[k] = pct(s.shotsHit, s.shots);
    const o = b.objective, outcome = b.outcome || { winner: 'none', reason: 'abandoned', round: b.round };
    return {
        version: REPORT_VERSION,
        run: { ...extra },
        scenario: {
            id: desc.scenario || m.id || null, name: m.name || m.id || desc.scenario || 'Mission', seed: desc.seed ?? b.seed,
            squad: desc.squad ?? null, operation: desc.operation || null, test: desc.test || null,
            timeOfDay: m.meta?.timeOfDay || null, size: m.store ? `${m.store.width}×${m.store.depth}×${m.store.height}` : null
        },
        outcome: { winner: outcome.winner, reason: outcome.reason, rounds: outcome.round ?? rounds, firstContactRound: firstContact },
        objective: {
            kind: o.kind, text: o.text || m.objective?.text || '', status: objectiveStatus(o, name), deadline: o.turns || null,
            held: o.kind === 'hold' ? `${o.held}/${o.rounds}` : null, extracted: o.extracted?.length || 0,
            secured: o.item ? !!o.item.secured : null
        },
        totals: { player: sideTotals(squad, hostiles), enemy: sideTotals(hostiles, squad) },
        squad, hostiles, enemyTypes: Object.values(byType),
        weapons: Object.values(weapons).map(w => ({ ...w, accuracy: pct(w.shotsHit, w.shots) })).sort((a, c) => (a.side < c.side ? -1 : a.side > c.side ? 1 : c.damage - a.damage)),
        environment: {
            voxelsDestroyed: b.stats.voxelsDestroyed, fires: b.stats.fires, breaches: b.stats.breaches, reactionShots: b.stats.reactions,
            doorsKicked, collapses, drops: b.stats.drops || 0, undergroundSteps: b.stats.undergroundSteps || 0, flankSteps: b.stats.flankSteps || 0
        },
        timeline
    };
}

const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const labelOf = (table, id) => table[id]?.name || id;
const used = obj => Object.entries(obj).map(([k, n]) => `${labelOf({ ...ABILITIES, ...THROWABLES }, k)}×${n}`).join(', ');

/** A plain-text summary (clipboard, console, sim output). */
export function reportText(r) {
    const P = r.totals.player, E = r.totals.enemy, sc = r.scenario;
    const head = r.outcome.winner === 'player' ? 'MISSION COMPLETE' : r.outcome.winner === 'enemy' ? 'MISSION FAILED' : r.outcome.winner === 'draw' ? 'DRAW' : 'ABANDONED';
    const lines = [
        `${head} — ${r.outcome.reason} · round ${r.outcome.rounds}${r.outcome.firstContactRound ? ` · first contact round ${r.outcome.firstContactRound}` : ''}`,
        `${sc.name} (${sc.id}${sc.operation ? `/${sc.operation.plot}` : ''}, seed ${sc.seed}${sc.timeOfDay ? `, ${sc.timeOfDay}` : ''})${sc.test ? ' · TEST GROUND' : ''}`,
        `Objective: ${r.objective.kind} — ${r.objective.status}${r.objective.deadline ? ` (deadline round ${r.objective.deadline})` : ''}`,
        `Squad: ${P.standing}/${P.units} standing · HP ${P.hpLeft}/${P.hpMax} · ${plural(P.kills, 'kill')} · accuracy ${P.accuracy ?? '–'}% (${P.shotsHit}/${P.shots}) · dealt ${P.damageDealt} · took ${P.damageTaken}${P.friendlyDamage ? ` · friendly fire ${P.friendlyDamage}` : ''}`,
        `Hostiles: ${E.standing}/${E.units} standing · ${plural(E.kills, 'kill')} · accuracy ${E.accuracy ?? '–'}% (${E.shotsHit}/${E.shots}) · dealt ${E.damageDealt}`,
        '', 'Soldiers:'
    ];
    for (const s of r.squad) {
        const extras = [used(s.abilities), used(s.items)].filter(Boolean).join(', ');
        lines.push(`  ${s.name} (${s.typeName}) — ${s.status} ${s.hp}/${s.maxHp} HP · ${plural(s.kills, 'kill')} · ${s.shotsHit}/${s.shots} shots${s.accuracy != null ? ` (${s.accuracy}%)` : ''} · dealt ${s.damageDealt} · took ${s.damageTaken}${s.reactions ? ` · ${plural(s.reactions, 'reaction')}` : ''}${extras ? ` · ${extras}` : ''}${s.disabled.length ? ` · disabled ${s.disabled.join('/')}` : ''}`);
    }
    lines.push('', 'Hostiles by type:');
    for (const t of r.enemyTypes) lines.push(`  ${t.name} ×${t.count} — ${t.killed} down, ${t.survived} standing · dealt ${t.damageDealt}`);
    const env = r.environment;
    lines.push('', `Environment: ${env.voxelsDestroyed} voxels destroyed · ${plural(env.fires, 'fire')} · ${env.breaches} breach${env.breaches === 1 ? '' : 'es'} · ${plural(env.doorsKicked, 'door')} kicked · ${plural(env.collapses, 'collapse')} · ${plural(env.drops, 'drop')} · flank steps ${env.flankSteps}`);
    return lines.join('\n');
}
