// Extraction parity: the copied vibe-game generator still produces the same world. The fingerprint is
// the hash of the Kida window as baked in client/public/missions/sites/burg-10.json; it was checked
// against vibe-game's own generator output on 2026-10-06 (see PROVENANCE.md).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { generateSite } from '../mission/WorldSites.js';
import { hashString } from '../util/Rng.js';

test('generateSite(burg-10) matches the baked site byte-for-byte (worldgen extraction parity)', { timeout: 60000 }, () => {
    const baked = JSON.parse(fs.readFileSync(new URL('../../client/public/missions/sites/burg-10.json', import.meta.url), 'utf8'));
    const live = generateSite('burg-10');
    assert.equal(hashString(JSON.stringify(live.cells)), hashString(JSON.stringify(baked.cells)));
    assert.equal(live.buildings.length, baked.buildings.length);
    assert.equal(live.contentHash, baked.contentHash);
});
