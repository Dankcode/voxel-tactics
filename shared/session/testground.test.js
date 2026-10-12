import test from 'node:test';
import assert from 'node:assert/strict';
import { createBattle, sanitizeDesc } from './Scenarios.js';
import { sanitizeTest, TEST_LIMITS } from './TestGround.js';
import { battleReport, reportText } from './BattleReport.js';
import { runAiSide } from '../battle/Ai.js';
import { reachable, nodeKey } from '../world/PathSearch.js';
import { AGENT_PROFILES } from '../world/TraversalRules.js';
import { MAT } from '../voxel/Materials.js';

test('test ground settings are validated and normalised', () => {
    assert.equal(sanitizeTest(undefined), null);
    const t = sanitizeTest({ enemies: [{ type: 'brute', count: 2 }, { type: 'cultist', count: 1 }, { type: 'brute', count: 1 }], podSize: 9, rounds: 2, timeOfDay: 'noon' });
    assert.deepEqual(t.enemies, [{ type: 'cultist', count: 1 }, { type: 'brute', count: 3 }], 'merged and in content order');
    assert.equal(t.podSize, 4); assert.equal(t.rounds, TEST_LIMITS.rounds[0]); assert.equal(t.timeOfDay, null); assert.equal(t.objective, 'map');
    for (const bad of [{ enemies: [{ type: 'alien', count: 1 }] }, { enemies: [{ type: 'cultist', count: 13 }] }, { enemies: [{ type: 'cultist', count: 0 }] },
        { enemies: Array.from({ length: 3 }, (_, i) => ({ type: ['cultist', 'archer', 'brute'][i], count: 9 })) }, { enemies: 'lots' }, 'x'])
        assert.throws(() => sanitizeTest(bad), /enemy|roster|hostiles|settings/i);
    assert.throws(() => sanitizeDesc({ scenario: 'proving-grounds', test: { enemies: [{ type: 'cultist', count: 30 }] } }), /0–12/);
});

test('custom rosters are placed deterministically, reachable, spread into pods and away from the squad', () => {
    for (const scenario of ['proving-grounds', 'signal-house']) {
        const desc = sanitizeDesc({ scenario, seed: 3, test: { enemies: [{ type: 'cultist', count: 5 }, { type: 'brute', count: 3 }, { type: 'archer', count: 2 }], podSize: 3, alerted: true, objective: 'eliminate', rounds: 15, timeOfDay: 'night' } });
        const b = createBattle(desc), again = createBattle(structuredClone(desc));
        assert.equal(b.hash(), again.hash(), `${scenario}: same setup, same battle`);
        const enemies = b.units.filter(u => u.side === 'enemy'), squad = b.units.filter(u => u.side === 'player');
        assert.equal(enemies.length, 10);
        assert.deepEqual(Object.fromEntries(['cultist', 'brute', 'archer'].map(t => [t, enemies.filter(e => e.type === t).length])), { cultist: 5, brute: 3, archer: 2 });
        assert.equal(new Set(enemies.map(e => e.group)).size, 4, 'ceil(10 / 3) pods');
        assert.equal(new Set(enemies.map(e => `${e.x},${e.y},${e.z}`)).size, 10, 'no shared cells');
        const reach = reachable(b.store, squad[0], Infinity, AGENT_PROFILES.player);
        for (const e of enemies) {
            assert.ok(reach.costs.has(nodeKey(e)), `${scenario}: ${e.id} reachable`);
            assert.ok(Math.min(...squad.map(p => Math.hypot(p.x - e.x, p.y - e.y))) >= TEST_LIMITS.minSpawnDistance);
            assert.ok(![MAT.door, MAT.door_open, MAT.ladder].includes(b.store.get(e.x, e.y, e.z + 1)));
            assert.equal(e.alerted, true);
        }
        assert.equal(b.objective.kind, 'eliminate'); assert.equal(b.objective.turns, 15); assert.equal(b.mission.meta.timeOfDay, 'night');
        assert.notEqual(createBattle(sanitizeDesc({ ...desc, seed: 4 })).hash(), b.hash());
    }
});

test('map hostiles can be kept and only alerted; no test settings leaves the mission untouched', () => {
    const plain = createBattle(sanitizeDesc({ scenario: 'cedar-close', seed: 2 }));
    const alerted = createBattle(sanitizeDesc({ scenario: 'cedar-close', seed: 2, test: { alerted: true } }));
    const pos = b => b.units.filter(u => u.side === 'enemy').map(u => `${u.type}@${u.x},${u.y},${u.z}`);
    assert.deepEqual(pos(alerted), pos(plain));
    assert.ok(alerted.units.filter(u => u.side === 'enemy').every(u => u.alerted));
    assert.equal(createBattle(sanitizeDesc({ scenario: 'cedar-close', seed: 2, test: {} })).hash(), plain.hash());
});

test('the after-action report adds up and survives a JSON round trip', () => {
    const desc = sanitizeDesc({ scenario: 'proving-grounds', seed: 5, test: { enemies: [{ type: 'cultist', count: 3 }, { type: 'pyromancer', count: 1 }], alerted: true, objective: 'eliminate', rounds: 12 } });
    const b = createBattle(desc);
    while (!b.outcome && b.round <= 14) { runAiSide(b, 'player'); if (!b.outcome) runAiSide(b, 'enemy'); }
    const r = battleReport(b, desc, { at: 'test' });
    assert.ok(b.outcome); assert.equal(r.outcome.winner, b.outcome.winner); assert.equal(r.outcome.rounds, b.outcome.round);
    assert.equal(r.squad.length, 4); assert.equal(r.hostiles.length, 4);
    assert.deepEqual(r.enemyTypes.map(t => [t.type, t.count]), [['cultist', 3], ['pyromancer', 1]]);
    const sum = (list, k) => list.reduce((n, s) => n + s[k], 0);
    // Every point of damage a hostile took came from the squad, another hostile, or the environment.
    assert.equal(sum(r.hostiles, 'damageTaken'), sum(r.squad, 'damageDealt') + sum(r.hostiles, 'friendlyDamage') + sum(r.hostiles, 'environmentDamage'));
    assert.equal(sum(r.squad, 'damageTaken'), sum(r.hostiles, 'damageDealt') + sum(r.squad, 'friendlyDamage') + sum(r.squad, 'environmentDamage'));
    assert.equal(sum(r.squad, 'kills'), r.hostiles.filter(h => r.squad.some(s => s.id === h.killedBy)).length);
    assert.equal(r.totals.player.shots, sum(r.squad, 'shots'));
    for (const s of r.squad) assert.ok(s.shotsHit <= s.shots && s.hp <= s.maxHp);
    assert.equal(r.scenario.test.objective, 'eliminate');
    assert.deepEqual(JSON.parse(JSON.stringify(r)), r);
    const text = reportText(r);
    assert.match(text, /TEST GROUND/); assert.match(text, /Soldiers:/); assert.match(text, /Gunman ×3/);
});
