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
    bar: { ground: ['barroom', 'galley', 'storeroom', 'restroom*'], upper: ['office', 'storeroom', 'unit'], top: ['office', 'unit'] },
    // new parcels
    duplex: { ground: ['living', 'living', 'kitchen', 'bathroom*'], upper: ['bedroom', 'bedroom', 'study', 'bathroom*'], top: ['bedroom', 'bedroom', 'bathroom*'] },
    walkup: { ground: ['lobby', 'unit', 'unit', 'utility*'], upper: ['unit', 'unit', 'kitchen', 'bathroom*'], top: ['unit', 'unit', 'living', 'bathroom*'] },
    trailer: { ground: ['living', 'bedroom', 'kitchen', 'bathroom*'], upper: ['bedroom'], top: ['bedroom'] },
    corner_store: { ground: ['convenience', 'storeroom', 'office', 'restroom*'], upper: ['living', 'bedroom', 'kitchen', 'bathroom*'], top: ['living', 'bedroom', 'bathroom*'] },
    laundromat: { ground: ['laundry', 'office', 'storeroom', 'utility*'], upper: ['office', 'storeroom'], top: ['office', 'storeroom'] },
    lockup: { ground: ['garage_bay', 'storeroom', 'utility*'], upper: ['storeroom'], top: ['storeroom'] },
    clinic: { ground: ['lobby', 'ward', 'office', 'restroom*'], upper: ['ward', 'office', 'ward', 'restroom*'], top: ['ward', 'office', 'meeting', 'restroom*'] },
    library: { ground: ['lobby', 'reading', 'office', 'restroom*'], upper: ['reading', 'study', 'office', 'restroom*'], top: ['reading', 'study', 'meeting', 'restroom*'] },
    fire_station: { ground: ['garage_bay', 'lobby', 'office', 'restroom*'], upper: ['barracks', 'galley', 'office', 'restroom*'], top: ['barracks', 'galley', 'office', 'restroom*'] },
    police_precinct: { ground: ['lobby', 'office', 'armory', 'restroom*'], upper: ['office', 'meeting', 'barracks', 'restroom*'], top: ['office', 'meeting', 'barracks', 'restroom*'] },
    pharmacy: { ground: ['convenience', 'ward', 'storeroom', 'restroom*'], upper: ['office', 'storeroom', 'unit', 'restroom*'], top: ['office', 'storeroom', 'unit'] }
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

const FORCE_PODS = Object.freeze({
    1: [
        ['officer', 'cultist'],
        ['cultist', 'archer'],
        ['breacher', 'cultist'],
        ['tech', 'search_drone', 'cultist']
    ],
    2: [
        ['officer', 'cultist', 'warden_foe'],
        ['heavy_gunner', 'cultist'],
        ['breacher', 'medic', 'cultist'],
        ['sniper', 'archer'],
        ['tech', 'search_drone', 'gun_drone']
    ],
    3: [
        ['officer', 'heavy_gunner', 'medic'],
        ['demolisher', 'breacher', 'cultist'],
        ['sniper', 'officer', 'archer'],
        ['pyromancer', 'warden_foe', 'medic'],
        ['tech', 'gun_drone', 'gun_drone']
    ],
    4: [
        ['officer', 'heavy_gunner', 'medic', 'demolisher'],
        ['sniper', 'breacher', 'officer'],
        ['heavy_gunner', 'demolisher', 'medic'],
        ['tech', 'gun_drone', 'gun_drone'],
        ['wall_strider', 'breacher']
    ]
});
const clampForce = fl => Math.max(1, Math.min(4, Number.isInteger(Number(fl)) ? Number(fl) : 2));

export function designProgrammes({ buildings, target, plot, seed, objectiveKind = null, verticalFlow = 'auto', timeOfDay = 'dusk', forceLevel = null, name = null, spread: spreadPods = false }) {
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
    const top = target.storeys - 1;
    const kinds = ['recover', 'recover', 'recover', 'extract', 'hold', 'hold', 'eliminate'];
    const kind = objectiveKind || pick(kinds, `${plot.family}:${seed}:objective`);
    const targetFloor = verticalFlow === 'top_to_bottom' ? 0 : top;
    const topRooms = programs.find(p => p.building === target.id && p.floor === targetFloor).rooms.filter(r => r.gameplay);
    const code = `Operation ${pick(CODE_A, `${seed}:code-a`)} ${pick(CODE_B, `${seed}:code-b:${plot.family}`)}`;
    const where = {
        downtown: 'downtown block', industrial: 'freight yard', suburb: 'residential close',
        harbor: 'harbor waterfront', winter_outpost: 'snowbound ridge outpost', old_quarter: 'cobblestone historic quarter',
        metro_hub: 'transit interchange and subway', arid_compound: 'desert mesa compound',
        canal_district: 'sunken canal locks and stone embankments',
        hillside_avenue: 'steep hillside avenue',
        hillside_ridge: 'terraced highland ridge',
        sunken_basin: 'recessed drainage valley'
    }[plot.family] || 'city block';
    const flowNote = {
        high_to_low: 'Insert on the high ridge, push downhill, and finish at the lower field.',
        low_to_high_to_low: 'Start in the lower sector, fight uphill to the objective, then descend to the lower extraction point.',
        bottom_to_top: 'Deploy in the lower basin and fight uphill to seize the upper crest.',
        top_to_bottom: 'Hold the elevated crest and sweep down into the lower compound.'
    }[verticalFlow] || null;
    const goal = { recover: `recover the intelligence from the ${ORDINAL[targetFloor]}-floor ${topRooms[0].kind.replace('_', ' ')}`, extract: `get three soldiers to the ${ORDINAL[targetFloor]}-floor rendezvous`, hold: `take and hold the ${ORDINAL[targetFloor]}-floor ${topRooms[0].kind.replace('_', ' ')}`, eliminate: 'clear every Syndicate cell in the block' }[kind];
    const under = { subway: 'the subway tunnel', 'storm-drain': 'the storm drain' }[plot.underground];
    const flank = under ? `use ${under} or a fire escape` : 'use a fire escape';
    const design = {
        version: 1, generated: true,
        mission: { kind, title: name || code, timeOfDay, target: { building: target.id, floor: targetFloor, room: topRooms[0].id },
            briefing: `${flowNote ? `${flowNote} ` : ''}The Syndicate has fortified a ${where}. Insert along the approach, ${flank} to flank the ${target.program === 'apartment' ? 'apartment block' : target.program}, and ${goal}.` },
        programs,
        beats: [
            { id: 'approach', text: 'Reach the cover outside the objective.', building: target.id, floor: 0, room: 'hall' },
            { id: 'escalation', text: 'Push past the guarded stair core.', building: target.id, floor: Math.min(1, top), room: 'hall' },
            { id: 'climax', text: kind === 'eliminate' ? 'Break the cell holding the objective.' : 'Secure the command room.', building: target.id, floor: targetFloor, room: topRooms[0].id }
        ],
        encounters: []
    };
    let group = 0;
    const roomOn = (b, floor, prefer) => { const p = programs.find(q => q.building === b.id && q.floor === floor); const g = p.rooms.filter(r => r.gameplay); return prefer && g.find(r => r.id === prefer) ? prefer : g[Math.floor(unit(`${seed}:${b.id}:${floor}:pod`) * g.length)]?.id || 'hall'; };
    // The objective is held on every floor; the top floor's command room is the last fight.
    // PLAN-15 (B.podSpacing > 0): the objective building holds two pods at most (the door and the last fight); the
    // rest of the force spreads along the line of play (addPocketPods), XCOM 2-style, so pods activate one at a time.
    const fl = clampForce(forceLevel);
    const spread = spreadPods && (B.podSpacing ?? 0) > 0;
    const groundTypes = fl <= 1 ? ['warden_foe', 'cultist'] : fl === 2 ? ['breacher', 'warden_foe'] : fl === 3 ? ['breacher', 'officer', 'cultist'] : ['breacher', 'heavy_gunner', 'warden_foe'];
    const midTypes = fl >= 3 ? ['warden_foe', 'medic'] : ['warden_foe'];
    const topTypes = fl <= 1 ? ['officer', 'cultist'] : fl === 2 ? ['officer', 'archer', 'cultist'] : fl === 3 ? ['officer', 'medic', 'demolisher'] : ['officer', 'heavy_gunner', 'medic'];
    design.forceLevel = fl;
    design.encounters.push({ group: group++, building: target.id, floor: 0, room: 'hall', types: groundTypes });
    if (top >= 2 && !spread) design.encounters.push({ group: group++, building: target.id, floor: Math.min(2, top - 1), room: 'hall', types: midTypes });
    design.encounters.push({ group: group++, building: target.id, floor: top, room: topRooms[0].id, types: topTypes });
    // Other buildings: an elevated overwatch sniper/lookout in the one nearest the objective. With spreading on, the
    // picket is placed by addPocketPods in a building along the route instead.
    const others = spread ? [] : buildings.filter(b => b !== target).sort((a, c) => Math.hypot(a.x0 - target.x0, a.y0 - target.y0) - Math.hypot(c.x0 - target.x0, c.y0 - target.y0)).slice(0, 1);
    for (const b of others) {
        const picketTypes = b.storeys >= 2 ? (fl >= 3 ? ['sniper', 'archer'] : fl === 2 ? ['sniper'] : ['archer']) : ['cultist'];
        design.encounters.push({ group: group++, building: b.id, floor: b.storeys - 1, room: roomOn(b, b.storeys - 1), types: picketTypes });
    }
    Object.defineProperty(design, "roomOn", { value: roomOn, enumerable: false });
    return design;
}

/**
 * Outdoor pods at the engagement pockets. PLAN-15 (B.podSpacing > 0): XCOM 2 encounter zones — pods at about 30 %,
 * 55 % and 78 % of the line of play, at least `spacing` tiles from each other and from the objective building's pods,
 * plus an overwatch picket in a side building near the middle of the route.
 */
export function addPocketPods(design, pockets, seed, { buildings = [], target = null, insertion = null, route = null, spacing = B.podSpacing ?? 0, forceLevel = null } = {}) {
    const fl = clampForce(forceLevel ?? design.forceLevel);
    const pool = FORCE_PODS[fl] || FORCE_PODS[2];
    let group = Math.max(-1, ...design.encounters.map(e => e.group)) + 1;
    const typesFor = (p, i) => {
        if (i === 0) return fl <= 1 ? ['tech', 'search_drone', 'cultist'] : fl === 2 ? ['tech', 'search_drone', 'gun_drone'] : ['tech', 'gun_drone', 'gun_drone'];
        const choices = (p.along ?? 0.5) >= 0.45 ? pool : pool.filter(t => !t.includes('wall_strider'));
        return choices[Math.floor(unit(`${seed}:pocket-pod:${p.id}:${fl}`) * choices.length) % choices.length];
    };
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
            const picket = side.storeys >= 2
                ? (fl >= 3 ? ['sniper', 'archer'] : fl === 2 ? ['sniper', 'cultist'] : ['archer', 'cultist'])
                : (fl >= 3 ? ['breacher', 'medic'] : ['breacher', 'cultist']);
            design.encounters.push({ group: group++, building: side.id, floor, room, types: picket });
        }
    }
    return design;
}

/** PLAN-15: smallest distance between two enemy pods of a design (posts: pocket points and building centres). */
export function podPosts(design, buildings) {
    return design.encounters.map(e => e.at ? { group: e.group, x: e.at.x, y: e.at.y, building: null } : (() => { const b = buildings.find(x => x.id === e.building); return b ? { group: e.group, x: b.x0 + b.w / 2, y: b.y0 + b.d / 2, building: b.id, floor: e.floor } : null; })()).filter(Boolean);
}
