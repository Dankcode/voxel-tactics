// Designated Campaign Operations Theater (shared pure state + progression across maps & vertical flows).
import { CALLSIGNS, CLASSES, SQUADS } from '../content/units.js';
import { PLOT_FAMILIES } from '../mapgen/PlotCatalogue.js';
import { OPERATION_FLOWS } from '../mapgen/TerrainFeatures.js';

export const THEATER_OPERATIONS = Object.freeze([
    {
        id: 'op-canal-locks',
        code: 'OP-01',
        name: 'Operation Lockbreak',
        region: 'Canal Sector',
        plot: 'canal_district',
        objective: 'recover',
        verticalFlow: 'low_to_high_to_low',
        seed: 104,
        timeOfDay: 'day',
        threat: 'Medium',
        briefing: 'Insert along the sunken canal towpath, breach the fortified lockhouse for Syndicate ciphers, and extract down at the lower quay.',
        reward: { materials: 6, intel: 2, supplies: 40 }
    },
    {
        id: 'op-ridge-ascent',
        code: 'OP-02',
        name: 'Operation Highwater',
        region: 'Highland Spur',
        plot: 'hillside_ridge',
        objective: 'hold',
        verticalFlow: 'bottom_to_top',
        seed: 209,
        timeOfDay: 'dawn',
        threat: 'High',
        briefing: 'Deploy down in the lower valley approach, storm the stepped hillside terraces under grazing fire, and hold the crest relay.',
        reward: { materials: 7, intel: 3, supplies: 50 }
    },
    {
        id: 'op-basin-sweep',
        code: 'OP-03',
        name: 'Operation Sinkhole',
        region: 'Drainage Bowl',
        plot: 'sunken_basin',
        objective: 'extract',
        verticalFlow: 'high_to_low',
        seed: 317,
        timeOfDay: 'overcast',
        threat: 'High',
        briefing: 'Occupy the rim bluff overlooking the recessed industrial bowl, sweep downward through crossfire lanes, and extract from the basin floor.',
        reward: { materials: 8, intel: 3, supplies: 55 }
    },
    {
        id: 'op-skybridge',
        code: 'OP-04',
        name: 'Operation Glass Span',
        region: 'Central Core',
        plot: 'downtown',
        objective: 'recover',
        verticalFlow: 'low_to_high_to_low',
        seed: 412,
        timeOfDay: 'dusk',
        threat: 'Severe',
        briefing: 'Push from lower street alleys up into upper office tiers and skybridges, recover ledger drives, and fight back to ground evac.',
        reward: { materials: 9, intel: 4, supplies: 65 }
    },
    {
        id: 'op-foundry-drop',
        code: 'OP-05',
        name: 'Operation Slagline',
        region: 'Freight Yards',
        plot: 'industrial',
        objective: 'eliminate',
        verticalFlow: 'top_to_bottom',
        seed: 523,
        timeOfDay: 'dawn',
        threat: 'Severe',
        briefing: 'Start atop the upper foundry ridge above shipping lanes and systematically collapse Syndicate strongpoints toward the lower yard.',
        reward: { materials: 10, intel: 4, supplies: 75 }
    },
    {
        id: 'op-frost-summit',
        code: 'OP-06',
        name: 'Operation White Crest',
        region: 'Alpine Ridge',
        plot: 'winter_outpost',
        objective: 'hold',
        verticalFlow: 'high_to_low',
        seed: 631,
        timeOfDay: 'day',
        threat: 'Critical',
        briefing: 'Hold initiative from the frozen upper bluff before sweeping down into the lower ice basin to lock down the Syndicate relay.',
        reward: { materials: 14, intel: 6, supplies: 100 }
    }
]);

const CONTRACT_BIOMES = ['canal_district', 'hillside_ridge', 'sunken_basin', 'old_quarter', 'metro_hub', 'arid_compound', 'harbor', 'suburb'];
const CONTRACT_OBJECTIVES = ['recover', 'extract', 'hold', 'eliminate'];
const CONTRACT_FLOWS = ['high_to_low', 'low_to_high_to_low', 'bottom_to_top', 'top_to_bottom'];
const CONTRACT_TIMES = ['day', 'dawn', 'dusk', 'overcast'];

/** Generate 3 rotating regional contracts tied to the current campaign day. */
export function regionalContracts(day = 1) {
    const out = [];
    for (let i = 0; i < 3; i++) {
        const idx = (day + i * 3 - 1) >>> 0;
        const plot = CONTRACT_BIOMES[idx % CONTRACT_BIOMES.length];
        const objective = CONTRACT_OBJECTIVES[(idx + i) % CONTRACT_OBJECTIVES.length];
        const verticalFlow = CONTRACT_FLOWS[(idx + i * 2) % CONTRACT_FLOWS.length];
        const timeOfDay = CONTRACT_TIMES[(idx + i) % CONTRACT_TIMES.length];
        const seed = 1000 + day * 37 + i * 19;
        const bio = PLOT_FAMILIES[plot];
        out.push({
            id: `contract-${day}-${i + 1}`,
            code: `RC-${day}.${i + 1}`,
            name: `${bio?.name || plot} Contract`,
            region: bio?.theme || 'Sector',
            plot,
            objective,
            verticalFlow,
            seed,
            timeOfDay,
            threat: i === 2 ? 'Severe' : 'Standard',
            contract: true,
            briefing: `Regional reconnaissance contract in ${bio?.name || plot} with ${verticalFlow.replace(/_/g, ' ')} extraction vectors.`,
            reward: { materials: 4 + i * 2, intel: 1 + (i % 2), supplies: 25 + i * 10 }
        });
    }
    return out;
}

/** Create fresh initial Campaign Theater state. */
export function createTheaterState() {
    const baseSquad = [...SQUADS.standard, 'vanguard', 'marksman'];
    const roster = baseSquad.map((type, idx) => ({
        id: `sol-${idx + 1}`,
        name: CALLSIGNS[idx % CALLSIGNS.length],
        type,
        role: CLASSES[type]?.name || type,
        missions: 0,
        kills: 0,
        xp: 0,
        status: 'ready'
    }));
    return {
        version: 1,
        day: 1,
        materials: 4,
        intel: 1,
        supplies: 60,
        completedIds: [],
        activeOpId: THEATER_OPERATIONS[0].id,
        history: [],
        roster
    };
}

/** Normalize loaded/persisted state safely against older or partial records. */
export function normalizeTheaterState(raw) {
    const base = createTheaterState();
    if (!raw || typeof raw !== 'object') return base;
    const completedIds = Array.isArray(raw.completedIds) ? [...new Set(raw.completedIds.filter(id => typeof id === 'string'))] : [];
    const activeValid = THEATER_OPERATIONS.some(o => o.id === raw.activeOpId);
    const nextUnfinished = THEATER_OPERATIONS.find(o => !completedIds.includes(o.id))?.id || THEATER_OPERATIONS[0].id;
    return {
        version: 1,
        day: Number.isInteger(raw.day) && raw.day >= 1 ? raw.day : 1,
        materials: Number.isFinite(raw.materials) ? Math.max(0, raw.materials) : base.materials,
        intel: Number.isFinite(raw.intel) ? Math.max(0, raw.intel) : base.intel,
        supplies: Number.isFinite(raw.supplies) ? Math.max(0, raw.supplies) : base.supplies,
        completedIds,
        activeOpId: activeValid ? raw.activeOpId : nextUnfinished,
        history: Array.isArray(raw.history) ? raw.history.slice(0, 20) : [],
        roster: Array.isArray(raw.roster) && raw.roster.length ? raw.roster : base.roster
    };
}

/** List flagship operations + their live unlock/completion state. */
export function theaterCatalog(state) {
    const done = new Set(state.completedIds || []);
    const unlockedCount = Math.min(THEATER_OPERATIONS.length, done.size + 1);
    return THEATER_OPERATIONS.map((op, index) => {
        const completed = done.has(op.id);
        const unlocked = index < unlockedCount || completed;
        return {
            ...op,
            index,
            completed,
            unlocked,
            status: completed ? 'completed' : unlocked ? 'available' : 'locked'
        };
    });
}

/** Resolve an operation object by ID (flagship campaign op or current regional contract). */
export function findTheaterOp(opId, state = null) {
    return THEATER_OPERATIONS.find(o => o.id === opId)
        || (state ? regionalContracts(state.day).find(o => o.id === opId) : null)
        || null;
}

/** Build a sanitized scenario launch descriptor for deploying a designated operation. */
export function buildLaunchDescriptor(op, { squad = 'standard', extra = {} } = {}) {
    if (!op) throw Error('theater: unknown operation');
    const flow = OPERATION_FLOWS.includes(op.verticalFlow) ? op.verticalFlow : 'auto';
    return {
        scenario: 'operation',
        seed: op.seed,
        squad,
        campaignOpId: op.id,
        operation: {
            plot: PLOT_FAMILIES[op.plot] ? op.plot : 'downtown',
            objective: op.objective || 'recover',
            timeOfDay: op.timeOfDay || 'day',
            ...(flow !== 'auto' ? { verticalFlow: flow } : {})
        },
        ...extra
    };
}

/** Next recommended unlocked campaign op for "Deploy Next Operation" flow. */
export function nextRecommendedOp(state, excludeId = null) {
    const cat = theaterCatalog(state);
    return cat.find(o => o.id !== excludeId && o.status === 'available')
        || cat.find(o => o.id !== excludeId && o.unlocked)
        || cat[0];
}

/** Apply battle report outcome to campaign theater state and return delta summary. */
export function applyOperationOutcome(rawState, opId, report) {
    const prev = normalizeTheaterState(rawState);
    const op = findTheaterOp(opId, prev) || { id: opId, name: report?.scenario?.name || opId, plot: report?.scenario?.operation?.plot || 'downtown', reward: { materials: 4, intel: 1, supplies: 25 } };
    const won = report?.outcome?.winner === 'player';
    const firstClear = won && !prev.completedIds.includes(op.id);
    const mult = won ? (firstClear ? 1 : 0.45) : 0.25;
    const earned = {
        materials: Math.max(1, Math.round((op.reward?.materials ?? 4) * mult)),
        intel: won ? Math.max(firstClear ? 1 : 0, Math.round((op.reward?.intel ?? 1) * mult)) : 0,
        supplies: Math.max(5, Math.round((op.reward?.supplies ?? 20) * mult))
    };
    const completedIds = firstClear ? [...prev.completedIds, op.id] : [...prev.completedIds];
    const roster = prev.roster.map((sol, idx) => {
        const fought = report?.squad?.[idx];
        return fought ? {
            ...sol,
            missions: sol.missions + 1,
            kills: sol.kills + (fought.kills || 0),
            xp: sol.xp + (won ? 40 : 15) + (fought.kills || 0) * 15,
            status: fought.status === 'killed' ? 'recovering' : 'ready'
        } : sol;
    });
    const nextState = {
        ...prev,
        day: prev.day + 1,
        materials: prev.materials + earned.materials,
        intel: prev.intel + earned.intel,
        supplies: prev.supplies + earned.supplies,
        completedIds,
        roster,
        history: [
            {
                at: report?.run?.at || new Date().toISOString(),
                day: prev.day,
                opId: op.id,
                name: op.name,
                plot: op.plot,
                winner: report?.outcome?.winner || 'unknown',
                reason: report?.outcome?.reason || '',
                earned
            },
            ...prev.history
        ].slice(0, 20)
    };
    const nextOp = nextRecommendedOp(nextState, won ? op.id : null);
    nextState.activeOpId = nextOp?.id || prev.activeOpId;
    return { state: nextState, earned, firstClear, won, nextOp, op };
}
