import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_MAP, mapById } from '../mission/Maps.js';
import { sanitizeDesc, scenarioId } from './Scenarios.js';

test('default and fallback launches use the authored Burger District package', () => {
    assert.equal(DEFAULT_MAP, 'burger-district');
    assert.equal(sanitizeDesc().scenario, DEFAULT_MAP);
    assert.equal(sanitizeDesc().seed, 1);
    assert.equal(scenarioId('unknown-map'), DEFAULT_MAP);
    assert.equal(mapById(DEFAULT_MAP).concept, '/maps/burger-district/concept/reference.png');
});

test('explicit training maps and generated operations remain available', () => {
    for (const scenario of ['proving-grounds', 'architecture-yard', 'operation']) {
        assert.equal(sanitizeDesc({ scenario, seed: 27 }).scenario, scenario);
        assert.equal(sanitizeDesc({ scenario, seed: 27 }).seed, 27);
    }
});
