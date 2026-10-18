import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_MAP, mapById } from '../mission/Maps.js';
import { sanitizeDesc, scenarioId } from './Scenarios.js';

test('PLAN-10: default and fallback launches generate a map from a theme (downtown, seed 1)', () => {
    assert.equal(sanitizeDesc().scenario, 'operation');
    assert.equal(sanitizeDesc().operation.plot, 'downtown');
    assert.equal(sanitizeDesc().seed, 1);
    assert.equal(scenarioId('unknown-map'), 'operation');
    assert.equal(mapById(DEFAULT_MAP).concept, '/maps/burger-district/concept/reference.png', 'the picture package stays as a mapgen fixture');
});

test('PLAN-10: players pick themes; old map ids map to the closest theme; only the two test rigs remain as fixtures', async () => {
    const { THEMES, FIXTURES, plotForMap } = await import('./Scenarios.js');
    assert.deepEqual(THEMES.map(t => t.id), ['downtown', 'industrial', 'suburb']);
    assert.deepEqual(FIXTURES.map(f => f.id).sort(), ['architecture-yard', 'proving-grounds']);
    assert.equal(plotForMap('harbor-yard'), 'industrial');
    assert.equal(plotForMap('suburb-district'), 'suburb');
    assert.equal(plotForMap('main-street'), 'downtown');
});

test('explicit training maps and generated operations remain available', () => {
    for (const scenario of ['proving-grounds', 'architecture-yard', 'operation']) {
        assert.equal(sanitizeDesc({ scenario, seed: 27 }).scenario, scenario);
        assert.equal(sanitizeDesc({ scenario, seed: 27 }).seed, 27);
    }
});
