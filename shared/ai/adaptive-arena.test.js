// Headless AI-vs-AI & symmetric adaptation engine tests.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Battle } from '../battle/Battle.js';
import { runAiSide } from '../battle/Ai.js';
import { buildMission, createBattle, sanitizeDesc, squadFor } from '../session/Scenarios.js';
import { spreadInsertion } from '../session/Insertion.js';
import { PLOT_IDS } from '../mapgen/PlotCatalogue.js';
import { partCentre } from '../battle/Ballistics.js';
import { mergeProfile, sanitizeAiProfile, profileForDesc, playstyleFromBattle } from '../session/Playstyle.js';
import { battleReport } from '../session/BattleReport.js';
import { reportMarkup } from '../../client/src/ui/BattleReportView.js';
import { ARENA_BIOME_PRIORS } from './LearnedPriors.js';
import {
    EXTENDED_TRAITS, BIOME_PRIORS, PLAYER_ARCHETYPES, TUNING_KEYS,
    analyzeSideBehavior, mergeSideProfile, counterTuningFrom, updateBiomeMemory
} from './AdaptivePolicy.js';

function startArenaBattle(plot = 'downtown', seed = 1, extra = {}) {
    const desc = sanitizeDesc({ scenario: 'operation', operation: { plot }, seed, squad: 'standard' });
    const mission = buildMission(desc);
    mission.spawns.player = spreadInsertion(mission.store, mission.spawns.player);
    return new Battle({
        mission,
        squad: squadFor(desc),
        seed,
        controllers: { player: 'ai', enemy: 'ai' },
        ...extra
    });
}

test('analyzeSideBehavior extracts all 14 extended traits and ballistic/terrain metrics symmetrically for both sides', () => {
    const b = startArenaBattle('downtown', 1);
    for (let r = 0; r < 2 && !b.outcome; r++) {
        runAiSide(b, 'player', { formations: true, samples: 8 });
        if (!b.outcome) runAiSide(b, 'enemy', { formations: true, samples: 8 });
    }
    for (const side of ['player', 'enemy']) {
        const s = analyzeSideBehavior(b, side);
        assert.equal(s.side, side);
        for (const k of Object.keys(EXTENDED_TRAITS)) {
            assert.ok(Number.isFinite(s.traits[k]) && s.traits[k] >= 0 && s.traits[k] <= 1, `${side}.${k}=${s.traits[k]} bounded in [0,1]`);
        }
        assert.ok(s.metrics.fireModes && typeof s.metrics.hitRate === 'number');
        assert.ok(s.metrics.inCover + s.metrics.exposed + s.metrics.unseen > 0, `${side} recorded end-of-turn positions`);
    }
});

test('counterTuningFrom produces distinct biome-aware counter-strategies for archetypes and updateBiomeMemory reinforces wins', () => {
    let turtleProf = null;
    let demoProf = null;
    let sniperProf = null;

    const synth = (overrides) => ({
        version: 2, side: 'player', metrics: {}, headline: [],
        traits: Object.fromEntries(Object.keys(EXTENDED_TRAITS).map(k => [k, overrides[k] ?? 0.5]))
    });
    for (let i = 0; i < 4; i++) {
        turtleProf = mergeSideProfile(turtleProf, synth({ overwatch: 0.95, cover: 0.95, aggression: 0.2 }), { biome: 'downtown', outcome: 'player', won: true });
        demoProf = mergeSideProfile(demoProf, synth({ explosives: 0.95, elements: 0.9, coverDestruction: 0.95, breach: 0.8 }), { biome: 'industrial', outcome: 'player', won: true });
        sniperProf = mergeSideProfile(sniperProf, synth({ range: 0.95, verticality: 0.95, recoilDiscipline: 0.95 }), { biome: 'arid_compound', outcome: 'player', won: true });
    }

    const tTurtle = counterTuningFrom(turtleProf, { biome: 'downtown' });
    const tDemo = counterTuningFrom(demoProf, { biome: 'industrial' });
    const tSniper = counterTuningFrom(sniperProf, { biome: 'arid_compound' });

    for (const tuned of [tTurtle, tDemo, tSniper]) {
        for (const k of TUNING_KEYS) {
            assert.ok(tuned[k] >= 0.5 && tuned[k] <= 2.0, `${k}=${tuned[k]} within bounds`);
        }
    }
    assert.ok(tTurtle.overwatchCaution > tDemo.overwatchCaution, 'counters overwatch turtle with overwatchCaution');
    assert.ok(tTurtle.flush > tSniper.flush, 'counters dug-in turtle with flush');
    assert.ok(tDemo.spread > tTurtle.spread, 'counters demolisher by spreading out');
    assert.ok(tSniper.closeIn > tTurtle.closeIn, 'counters long-range sniper by closing in');
    assert.ok(tSniper.highGroundBias > 1.2, 'arid_compound + vertical opponent emphasizes highGroundBias');

    for (const biome of PLOT_IDS) assert.ok(BIOME_PRIORS[biome], `BIOME_PRIORS covers ${biome}`);
    for (const id of ['balanced', 'cautious-sniper', 'aggressive-breacher', 'overwatch-turtle', 'grenade-demolisher', 'flanker-skirmisher']) {
        assert.ok(PLAYER_ARCHETYPES[id], `archetype ${id} defined`);
    }

    let mem = {};
    const used = { ...tSniper, closeIn: 1.65, highGroundBias: 1.65 };
    mem = updateBiomeMemory(mem, 'arid_compound', used, true, 3);
    assert.equal(mem.arid_compound.wins, 1);
    assert.ok(mem.arid_compound.deltas.closeIn > 1, 'winning elevated weight gets reinforced');
    const reinforced = counterTuningFrom(sniperProf, { biome: 'arid_compound', biomeMemory: mem });
    assert.ok(reinforced.closeIn >= tSniper.closeIn);
});

test('headless AI-vs-AI executes clean multi-turn combat across multiple biomes without errors', () => {
    for (const biome of ['downtown', 'harbor']) {
        const b = startArenaBattle(biome, 1);
        for (let r = 0; r < 5 && !b.outcome; r++) {
            runAiSide(b, 'player', { formations: true, samples: 8 });
            if (!b.outcome) runAiSide(b, 'enemy', { formations: true, samples: 8 });
        }
        assert.ok(b.round >= 2, `${biome} advanced multiple rounds cleanly`);
        assert.ok(b.log.length > 0);
        // Spot-check no invalid unit coordinates or NaN HP
        for (const u of b.units) {
            assert.ok(Number.isFinite(u.hp) && Number.isFinite(u.x) && Number.isFinite(u.y) && Number.isFinite(u.z));
        }
    }
});

test('live mid-battle adaptation emits aiAdapt on round 2+ and preserves lockstep peer hash parity', () => {
    const makePair = () => {
        const b = startArenaBattle('downtown', 1);
        for (const ev of [
            { t: 'overwatch', unitId: 'p0' },
            { t: 'overwatch', unitId: 'p1' },
            { t: 'overwatch', unitId: 'p2' },
            { t: 'throw', unitId: 'p3', itemId: 'powder_bomb' }
        ]) b.emit(ev);
        b.apply({ type: 'endTurn', side: 'player' });
        b.apply({ type: 'endTurn', side: 'enemy' });
        b.apply({ type: 'endTurn', side: 'player' });
        return b;
    };
    const b1 = makePair();
    const b2 = makePair();
    assert.equal(b1.round, 2);
    assert.ok(b1.aiAdaptation.liveWeight > 0, 'mid-battle liveWeight activated at round 2');
    assert.ok(b1.aiAdaptation.shifts.length > 0, 'significant weight shifts recorded');
    const adaptEv = b1.log.find(e => e.t === 'aiAdapt');
    assert.ok(adaptEv && adaptEv.round === 2 && adaptEv.shifts.length > 0, 'aiAdapt event emitted deterministically');
    assert.notDeepEqual(b1.aiTuning, b1.baseAiTuning, 'live aiTuning diverges from baseAiTuning after observed habits');
    assert.equal(b1.hash(), b2.hash(), 'two lockstep peers produce identical battle hashes across live adaptation');
});

test('Playstyle persists 14 extendedTraits and biomeMemory across sanitizeAiProfile / profileForDesc / createBattle / reportMarkup', () => {
    const b = startArenaBattle('industrial', 1);
    runAiSide(b, 'player', { formations: true, samples: 8 });
    const style = playstyleFromBattle(b);
    let profile = mergeProfile(null, style, { outcome: 'enemy', scenario: 'operation', biome: 'industrial', tuning: b.aiTuning, margin: 2 });
    profile = JSON.parse(JSON.stringify(profile));
    const sanitized = sanitizeAiProfile(profile);
    for (const k of Object.keys(EXTENDED_TRAITS)) {
        assert.ok(Number.isFinite(sanitized.extendedTraits[k]), `extended trait ${k} preserved`);
    }
    assert.equal(sanitized.biomeMemory.industrial.matches, 1);
    assert.equal(sanitized.biomeMemory.industrial.wins, 1);

    const desc = sanitizeDesc({ scenario: 'operation', operation: { plot: 'industrial' }, seed: 1, aiProfile: profileForDesc(profile) });
    assert.ok(desc.aiProfile.extendedTraits && desc.aiProfile.biomeMemory?.industrial, 'profileForDesc carries extendedTraits & biomeMemory');

    const b2 = createBattle(desc);
    assert.equal(b2.biome, 'industrial');
    assert.ok(ARENA_BIOME_PRIORS.industrial, 'learned arena biome priors exist for industrial');
    assert.notDeepEqual(b2.aiTuning, { ...b2.aiTuning, doorWatch: -1 });

    const rep = battleReport(b2, desc, { mode: 'local' });
    assert.equal(rep.playstyle.biome, 'industrial');
    const html = reportMarkup(rep, { tab: 'playstyle' });
    for (const label of ['Recoil discipline', 'High ground', 'Cover breaking', 'Room control', 'Biome doctrine']) {
        assert.ok(html.includes(label), `Playstyle report renders ${label}`);
    }
});
