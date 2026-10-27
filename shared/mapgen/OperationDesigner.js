// Level design for generated operations (PLAN-04): per-floor room programmes sized to each footprint, the
// objective (on the landmark's top floor), located story beats, and enemy pods — inside buildings and at the
// engagement pockets along the line of play (pods spawn at pockets, PLAN-04 §5.4).
import { bayGridOf } from './InteriorPlanSolver.js';
import { hashString } from '../util/Rng.js';
import { B } from '../content/balance.js';

const unit = s => (hashString(s) >>> 0) / 4294967296;
const pick = (list, key) => list[Math.floor(unit(key) * list.length) % list.length];
// Room kinds per programme and floor, most important first; '*' marks a locked service room.
const PROGRAMMES = {
    office: { ground: ['lobby', 'office', 'meeting', 'restroom*'], upper: ['open_office', 'office', 'meeting', 'restroom*'], top: ['office', 'meeting', 'open_office', 'restroom*'] },
    apartment: { ground: ['lobby', 'unit', 'storeroom', 'utility*'], upper: ['unit', 'bedroom', 'kitchen', 'bathroom*'], top: ['unit', 'bedroom', 'study', 'bathroom*'] },
    house: { ground: ['living', 'kitchen', 'study', 'bathroom*'], upper: ['bedroom', 'study', 'bedroom', 'bathroom*'], top: ['bedroom', 'study', 'bedroom', 'bathroom*'] },
    shop: { ground: ['sales', 'storeroom', 'office', 'restroom*'], upper: ['storeroom', 'office', 'unit', 'restroom*'], top: ['office', 'storeroom', 'unit', 'restroom*'] },
    diner: { ground: ['dining', 'galley', 'office', 'restroom*'], upper: ['office', 'storeroom', 'unit'], top: ['office', 'storeroom'] },
    warehouse: { ground: ['warehouse', 'loading', 'office', 'utility*'], upper: ['office', 'storeroom', 'meeting', 'utility*'], top: ['office', 'meeting', 'storeroom'] },
    garage: { ground: ['workshop', 'storeroom', 'office', 'utility*'], upper: ['office', 'storeroom'], top: ['office', 'storeroom'] },
    // PLAN-14 building types, from room kinds the planner and furnisher already know.
    motel: { ground: ['lobby', 'unit', 'unit', 'utility*'], upper: ['unit', 'unit', 'bathroom*'], top: ['unit', 'unit', 'bathroom*'] },
    bar: { ground: ['dining', 'galley', 'storeroom', 'restroom*'], upper: ['office', 'storeroom', 'unit'], top: ['office', 'unit'] }
};
const CODE_A = ['Iron', 'Silent', 'Grey', 'Night', 'Glass', 'Cold', 'Black', 'Copper', 'Ashen', 'Low', 'Broken', 'Last'];
const CODE_B = ['Ledger', 'Harbor', 'Lantern', 'Viaduct', 'Canopy', 'Signal', 'Gutter', 'Spire', 'Ward', 'Switchyard', 'Crossing', 'Furnace'];
const ORDINAL = ['ground', 'first', 'second', 'third'];

/** Room count that fits a floor: about one room per five free bays, 2–5 rooms. */
export function roomsFor(b) {
    const { nbx, nby } = bayGridOf(b.w, b.d), core = b.storeys >= 2 ? 6 : 0, rest = nbx * nby - core;
    const corridor = rest > 12 ? Math.max(nbx, nby) - 1 : 0;
    return Math.max(1, Math.min(4, Math.round((rest - corridor) / 6)));
}

export function designProgrammes({ buildings, target, plot, seed, objectiveKind = null, timeOfDay = 'dusk', name = null, spread: spreadPods = false }) {
    const programs = [];
    for (const b of buildings) {
        const table = PROGRAMMES[b.program] || PROGRAMMES.office, count = roomsFor(b);
        // Select the building's trade once, so its floors share a coherent identity.
        const trade = pick(b.program === 'shop' ? ['grocery', 'hardware', 'market'] : ['warehouse', 'packing', 'cold_storage'], `${seed}:${b.id}:trade`);
        for (let floor = 0; floor < b.storeys; floor++) {
            const list = floor === 0 ? table.ground : floor === b.storeys - 1 ? table.top : table.upper;
            let kinds = list.slice(0, count).map(k => k === 'sales' ? trade : k === 'warehouse' ? trade : k);
            if (b.program === 'warehouse' && count >= 3) kinds[1] = trade === 'packing' ? 'dispatch' : 'packing';
            if (count < 3) kinds = kinds.filter(k => !k.endsWith('*'));
            if (!kinds.length) kinds = [list[0]];
            const seen = new Map();
            const rooms = kinds.map((k, i) => {
                const kind = k.replace('*', ''), n = (seen.get(kind) || 0) + 1; seen.set(kind, n);
                // PLAN-10: service rooms (WC, plant room) are ordinary small rooms with a real door and windows, never sealed.
                return { id: n > 1 ? `${kind}-${n}` : kind, kind, areaShare: i === 0 ? 0.4 : 0.6 / Math.max(1, kinds.length - 1), gameplay: true, service: k.endsWith('*') };
            });
            programs.push({ building: b.id, floor, rooms, adjacencies: [] });
        }
    }
    const top = target.storeys - 1, topRooms = programs.find(p => p.building === target.id && p.floor === top).rooms.filter(r => r.gameplay);
    const kinds = ['recover', 'recover', 'recover', 'extract', 'hold', 'hold', 'eliminate'];
    const kind = objectiveKind || pick(kinds, `${plot.family}:${seed}:objective`);
    const code = `Operation ${pick(CODE_A, `${seed}:code-a`)} ${pick(CODE_B, `${seed}:code-b:${plot.family}`)}`;
    const where = { downtown: 'downtown block', industrial: 'freight yard', suburb: 'residential close' }[plot.family] || 'city block';
    const goal = { recover: `recover the intelligence from the ${ORDINAL[top]}-floor ${topRooms[0].kind.replace('_', ' ')}`, extract: `get three soldiers to the ${ORDINAL[top]}-floor rendezvous`, hold: `take and hold the ${ORDINAL[top]}-floor ${topRooms[0].kind.replace('_', ' ')}`, eliminate: 'clear every Syndicate cell in the block' }[kind];
    const under = { subway: 'the subway tunnel', 'storm-drain': 'the storm drain' }[plot.underground] || 'the underground route';
    const design = {
        version: 1, generated: true,
        mission: { kind, title: name || code, timeOfDay, target: { building: target.id, floor: top, room: topRooms[0].id },
            briefing: `The Syndicate has fortified a ${where}. Insert on the street, push from cover to cover along the line of advance, use ${under} or a fire escape to flank the ${target.program === 'apartment' ? 'apartment block' : target.program}, and ${goal}.` },
        programs,
        beats: [
            { id: 'approach', text: 'Reach the cover outside the objective.', building: target.id, floor: 0, room: 'hall' },
            { id: 'escalation', text: 'Push past the guarded stair core.', building: target.id, floor: Math.min(1, top), room: 'hall' },
            { id: 'climax', text: kind === 'eliminate' ? 'Break the cell holding the top floor.' : 'Secure the command room.', building: target.id, floor: top, room: topRooms[0].id }
        ],
        encounters: []
    };
    let group = 0;
    const roomOn = (b, floor, prefer) => { const p = programs.find(q => q.building === b.id && q.floor === floor); const g = p.rooms.filter(r => r.gameplay); return prefer && g.find(r => r.id === prefer) ? prefer : g[Math.floor(unit(`${seed}:${b.id}:${floor}:pod`) * g.length)]?.id || 'hall'; };
    // The objective is held on every floor; the top floor's command room is the last fight.
    // PLAN-15 (B.podSpacing > 0): the objective building holds two pods at most (the door and the last fight); the
    // rest of the force spreads along the line of play (addPocketPods), XCOM 2-style, so pods activate one at a time.
    const spread = spreadPods && (B.podSpacing ?? 0) > 0;
    design.encounters.push({ group: group++, building: target.id, floor: 0, room: 'hall', types: ['cultist', 'warden_foe'] });
    if (top >= 2 && !spread) design.encounters.push({ group: group++, building: target.id, floor: Math.min(2, top - 1), room: 'hall', types: ['warden_foe'] });
    design.encounters.push({ group: group++, building: target.id, floor: top, room: topRooms[0].id, types: ['archer', 'cultist'] });
    // Other buildings: a picket in the one nearest the objective (an overwatch on the tallest). With spreading on, the
    // picket is placed by addPocketPods in a building along the route instead.
    const others = spread ? [] : buildings.filter(b => b !== target).sort((a, c) => Math.hypot(a.x0 - target.x0, a.y0 - target.y0) - Math.hypot(c.x0 - target.x0, c.y0 - target.y0)).slice(0, 1);
    for (const b of others) design.encounters.push({ group: group++, building: b.id, floor: b.storeys - 1, room: roomOn(b, b.storeys - 1), types: [b.storeys >= 2 ? 'archer' : 'cultist'] });
    Object.defineProperty(design, "roomOn", { value: roomOn, enumerable: false });
    return design;
}

/**
 * Outdoor pods at the engagement pockets. PLAN-15 (B.podSpacing > 0): XCOM 2 encounter zones — pods at about 30 %,
 * 55 % and 78 % of the line of play, at least `spacing` tiles from each other and from the objective building's pods,
 * plus a picket in a side building near the middle of the route. Without spacing, the old placement (the last one or
 * two pockets past 45 %).
 */
export function addPocketPods(design, pockets, seed, { buildings = [], target = null, insertion = null, route = null, spacing = B.podSpacing ?? 0 } = {}) {
    let group = Math.max(-1, ...design.encounters.map(e => e.group)) + 1;
    const typesFor = (p, i) => i === 0 ? ['tech', 'search_drone', 'cultist'] : unit(`${seed}:pocket-pod:${p.id}`) < 0.5 ? ['cultist', 'archer'] : ['warden_foe', 'cultist'];
    if (!spacing || !target) {
        // One outdoor pod on the last pocket before the objective (the squad's fight to get in); a second only on long routes.
        const late = pockets.filter(p => p.along >= 0.45).slice(pockets.length >= 4 ? -2 : -1);
        // PLAN-14: the first outdoor pod is a drone tech's crew; its search drone sweeps the street ahead of it.
        late.forEach((p, i) => design.encounters.push({ group: group++, pocket: p.id, at: { x: p.x, y: p.y }, types: typesFor(p, i) }));
        return design;
    }
    const centre = b => ({ x: b.x0 + b.w / 2, y: b.y0 + b.d / 2 });
    const posts = [centre(target)];
    const far = (q, min) => posts.every(o => Math.hypot(o.x - q.x, o.y - q.y) >= min);
    const chosen = [];
    for (const zone of [0.3, 0.55, 0.78]) {
        for (const min of [spacing, spacing * 0.75]) {
            const p = pockets.filter(q => !chosen.includes(q) && Math.abs(q.along - zone) <= 0.2 && far(q, min)).sort((a, c) => Math.abs(a.along - zone) - Math.abs(c.along - zone))[0];
            if (p) { chosen.push(p); posts.push({ x: p.x, y: p.y }); break; }
        }
        if (chosen.length && Math.abs(chosen.at(-1).along - zone) <= 0.2 && posts.length > chosen.length) continue;
        // No cover pocket in this zone: post the pod beside the line of play itself (the spawn resolver puts it on the
        // nearest reachable tile), still spaced from every other pod and clear of the insertion.
        if (route?.length > 4 && !chosen.some(q => Math.abs(q.along - zone) <= 0.12)) {
            for (let k = 0; k <= 8; k++) for (const sgn of [1, -1]) {
                const i = Math.round((zone + sgn * k * 0.02) * (route.length - 1)); if (i < 1 || i >= route.length - 1) continue;
                const a = route[i - 1], b = route[i + 1], dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy) || 1, side = unit(`${seed}:zone-side:${zone}`) < 0.5 ? 1 : -1;
                const q = { id: `route-${zone}`, x: Math.round(route[i].x - dy / len * side * 3), y: Math.round(route[i].y + dx / len * side * 3), along: i / (route.length - 1) };
                if (insertion && Math.hypot(q.x - insertion.x, q.y - insertion.y) < 16) continue;
                if (buildings.some(bd => q.x >= bd.x0 && q.y >= bd.y0 && q.x < bd.x0 + bd.w && q.y < bd.y0 + bd.d)) continue;
                if (!far(q, spacing * 0.75)) continue;
                chosen.push(q); posts.push({ x: q.x, y: q.y }); k = 99; break;
            }
        }
    }
    chosen.sort((a, c) => a.along - c.along).forEach((p, i) => design.encounters.push({ group: group++, pocket: p.id, at: { x: p.x, y: p.y }, types: typesFor(p, i) }));
    // A picket in a side building near the middle of the route, away from every other pod and the insertion.
    if (insertion) {
        const mid = { x: (insertion.x + centre(target).x) / 2, y: (insertion.y + centre(target).y) / 2 };
        const side = buildings.filter(b => b !== target && b.storeys >= 1 && Math.hypot(centre(b).x - insertion.x, centre(b).y - insertion.y) >= 16 && far(centre(b), spacing * 0.75))
            .sort((a, c) => Math.hypot(centre(a).x - mid.x, centre(a).y - mid.y) - Math.hypot(centre(c).x - mid.x, centre(c).y - mid.y))[0];
        if (side) {
            const floor = side.storeys - 1, room = design.roomOn ? design.roomOn(side, floor) : 'hall';
            design.encounters.push({ group: group++, building: side.id, floor, room, types: [side.storeys >= 2 ? 'archer' : 'cultist', 'cultist'] });
        }
    }
    return design;
}

/** PLAN-15: smallest distance between two enemy pods of a design (posts: pocket points and building centres). */
export function podPosts(design, buildings) {
    return design.encounters.map(e => e.at ? { group: e.group, x: e.at.x, y: e.at.y, building: null } : (() => { const b = buildings.find(x => x.id === e.building); return b ? { group: e.group, x: b.x0 + b.w / 2, y: b.y0 + b.d / 2, building: b.id, floor: e.floor } : null; })()).filter(Boolean);
}
