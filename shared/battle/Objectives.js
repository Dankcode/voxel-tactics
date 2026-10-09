// Mission objectives beyond "eliminate" (PLAN-02 §8.4), so a map's story beats can be what the squad plays for.
//
//   eliminate  kill or rout every hostile (the default)
//   extract    reach the zone and Extract (1 AP, the unit leaves the map); win when every squad member still standing
//              has left and at least `needed` made it out
//   recover    pick up the objective item (1 AP, adjacent); with a zone the carrier must Extract with it, without one
//              picking it up wins. A carrier who dies drops it where they fell.
//   hold       end `rounds` rounds (after the enemy phase) with a squad member in the zone and no hostile in it
//
// Killing every hostile also completes extract and hold (nobody is left to stop the squad); recover still needs the
// item. `turns` (optional) is a deadline: the mission fails at the end of that round. A squad wiped out fails.
//
// Mission spec: { kind, text, zone?: { x0, y0, x1, y1, z?, dz? }, item?: { x, y, z, label }, rounds?, needed?, turns? }
export const OBJECTIVE_KINDS = Object.freeze(['eliminate', 'extract', 'recover', 'hold']);

export function createObjective(spec = {}) {
    const kind = OBJECTIVE_KINDS.includes(spec.kind) ? spec.kind : 'eliminate';
    return {
        kind, text: spec.text || '', zone: spec.zone ? { ...spec.zone } : null,
        item: spec.item ? { label: 'Package', ...spec.item, carrier: null, secured: false } : null,
        rounds: spec.rounds ?? 3, held: 0, needed: spec.needed ?? 1, turns: spec.turns ?? null,
        extracted: [], failed: false
    };
}

/** Is cell / unit p inside the zone? A zone with z only counts that level (± dz, default 1). */
export function inZone(zone, p) {
    if (!zone || !p) return false;
    if (p.x < zone.x0 || p.x > zone.x1 || p.y < zone.y0 || p.y > zone.y1) return false;
    return zone.z == null || Math.abs(p.z - zone.z) <= (zone.dz ?? 1);
}

/** Can units Extract from the zone in this mission? */
export const extractionOpen = o => !!o.zone && (o.kind === 'extract' || o.kind === 'recover');

/** One line for the HUD. */
export function objectiveStatus(o, unitName = id => id) {
    switch (o.kind) {
        case 'extract': return `Extracted ${o.extracted.length}${o.needed > 1 ? ` / ${o.needed} needed` : ''}`;
        case 'recover': return o.item.secured ? `${o.item.label} secured` : o.item.carrier ? `${o.item.label}: carried by ${unitName(o.item.carrier)}${o.zone ? ' — get to extraction' : ''}` : `${o.item.label}: not recovered`;
        case 'hold': return `Held ${o.held} / ${o.rounds} rounds`;
        default: return 'Eliminate all hostiles';
    }
}

/** Where the squad should be heading for the objective right now (AI autopilot, the sim, the HUD marker). */
export function objectiveGoal(o) {
    if (o.kind === 'recover' && !o.item.carrier && !o.item.secured) return { x: o.item.x, y: o.item.y, z: o.item.z };
    if (o.zone && (o.kind === 'extract' || o.kind === 'hold' || (o.kind === 'recover' && o.item.carrier))) {
        return { x: Math.round((o.zone.x0 + o.zone.x1) / 2), y: Math.round((o.zone.y0 + o.zone.y1) / 2), z: o.zone.z ?? null };
    }
    return null;
}
