import test from 'node:test';
import assert from 'node:assert/strict';
import { VoxelStore } from '../voxel/VoxelStore.js';
import { MAT } from '../voxel/Materials.js';
import { settleUnsupported } from '../voxel/Destruction.js';
import { reachable, nodeKey } from '../world/PathSearch.js';
import { AGENT_PROFILES } from '../world/TraversalRules.js';
import { fireEscapeTemplate, compileFireEscape, validateAccessModule, roofLadderTemplate, compileServiceStair, compileManhole, placeRoofLadder, checkAccess, FIRE_ESCAPE, SIDE_FRAME } from './AccessModules.js';
import { buildPackagedMap } from './PackageBuilder.js';
import { MAP_PACKAGES } from '../mission/generated/PackageCatalog.js';

/** A bare 4-storey shell on a flat street: wall line at the given facade, slabs every 3 voxels. */
function shell(side, storeys = 4) {
    const s = new VoxelStore(40, 40, 18), G = 1;
    s.fill(0, 0, 0, 39, 39, 0, 'bedrock'); s.fill(0, 0, 1, 39, 39, 1, 'concrete');
    const b = { x0: 12, y0: 12, w: 15, d: 15 };
    for (let y = b.y0; y < b.y0 + b.d; y++) for (let x = b.x0; x < b.x0 + b.w; x++) for (let k = 1; k <= storeys; k++) {
        s.set(x, y, G + 3 * k, MAT.concrete);
        if (x === b.x0 || y === b.y0 || x === b.x0 + b.w - 1 || y === b.y0 + b.d - 1) for (let h = 1; h <= 2; h++) s.set(x, y, G + 3 * (k - 1) + h, MAT.stucco);
    }
    const origin = side === 'e' ? [b.x0 + b.w - 1, b.y0 + 3] : side === 'w' ? [b.x0, b.y0 + 3] : side === 'n' ? [b.x0 + 3, b.y0] : [b.x0 + 3, b.y0 + b.d - 1];
    return { s, b, G, origin };
}

test('the fire escape is one uniform 6×2 stair module on every facade and storey count (no ladders)', () => {
    const sizes = new Set();
    for (const storeys of [3, 4]) for (const side of ['n', 'e', 's', 'w']) {
        const { s, G, origin } = shell(side, storeys);
        const params = { side, origin, datum: G, storeys, doors: {} };
        const { cells } = fireEscapeTemplate(params);
        assert.ok(cells.every(c => c.u >= 0 && c.u < FIRE_ESCAPE.along && c.r >= 0 && c.r <= FIRE_ESCAPE.out + FIRE_ESCAPE.lip));
        assert.ok(!cells.some(c => c.mat === MAT.ladder));
        const { a, o } = SIDE_FRAME[side];
        const xs = cells.filter(c => c.r > 0).map(c => c.x), ys = cells.filter(c => c.r > 0).map(c => c.y);
        const along = a[0] ? Math.max(...xs) - Math.min(...xs) + 1 : Math.max(...ys) - Math.min(...ys) + 1;
        const out = o[0] ? Math.max(...xs) - Math.min(...xs) + 1 : Math.max(...ys) - Math.min(...ys) + 1;
        sizes.add(`${along}x${out}`);
        // Exactly two steps per storey, one 2×2 landing per storey.
        assert.equal(cells.filter(c => c.role === 'flight').length, 2 * storeys);
        assert.equal(cells.filter(c => c.role === 'landing').length, 4 * storeys);
        const rec = compileFireEscape(s, params);
        assert.ok(validateAccessModule(s, rec));
        // Every landing and the roof are reachable from the street by stairs alone.
        const [fx, fy] = [origin[0] + o[0], origin[1] + o[1]];
        const reach = reachable(s, { x: fx, y: fy, z: G }, Infinity, AGENT_PROFILES.player, { ladders: false, jump: false });
        for (const l of rec.landings) assert.ok(reach.costs.has(nodeKey(l.stand)), `${side}/${storeys}: storey ${l.storey}`);
        // A tampered cell fails the template gate.
        const p = rec.landings[0].cells[0]; s.set(...p, MAT.concrete);
        assert.throws(() => validateAccessModule(s, rec), /access.template/);
    }
    assert.deepEqual([...sizes], ['6x3']);
});

test('shooting out a post column drops the landings it carries; the other end stays up', () => {
    const { s, G, origin } = shell('e', 4);
    const rec = compileFireEscape(s, { side: 'e', origin, datum: G, storeys: 4, doors: {} });
    assert.equal(settleUnsupported(s.clone()).removed, 0);
    const right = rec.landings.filter(l => l.end === 4), left = rec.landings.filter(l => l.end === 0);
    const post = fireEscapeTemplate(rec.params).cells.find(c => c.role === 'post' && c.u === 5 && c.z === G + 2);
    s.set(post.x, post.y, post.z, 0);
    settleUnsupported(s);
    assert.ok(right.every(l => l.cells.every(p => s.get(...p) === 0)), 'right-end landings fell');
    assert.ok(left.every(l => l.cells.every(p => s.get(...p) === MAT.grate)), 'left-end landings stand');
});

test('roof ladders serve 1–2 storey flat roofs only; manholes and service stairs match their templates', () => {
    const { s, G, origin } = shell('w', 2);
    const params = { side: 'w', origin, datum: G, storeys: 2 };
    for (const c of roofLadderTemplate(params).cells) s.set(c.x, c.y, c.z, c.mat);
    assert.ok(validateAccessModule(s, { module: 'roof_ladder', params }));
    const m = { store: s, G, keep: new Set(), buildings: [] };
    assert.throws(() => placeRoofLadder(m, { id: 'tall', x0: 12, y0: 12, w: 15, d: 15, storeys: 3, doors: [] }), /access.height/);
    // Service stair: the fire-escape module turned inward in a shaft, street (z 4) to tunnel (z 1).
    const u = new VoxelStore(30, 30, 12);
    u.fill(0, 0, 0, 29, 29, 0, 'bedrock'); u.fill(0, 0, 1, 29, 29, 4, 'concrete');
    for (let x = 2; x < 28; x++) for (let z = 2; z <= 3; z++) u.set(x, 6, z, 0);          // a tunnel along y = 6
    const st = compileServiceStair(u, { side: 's', origin: [8, 7], datum: 4, levels: 1 });
    assert.ok(validateAccessModule(u, st));
    const down = reachable(u, st.opening.from, Infinity, AGENT_PROFILES.player, { ladders: false, jump: false });
    assert.ok(down.costs.has(nodeKey(st.opening.to)), 'service stair reaches the tunnel by stairs');
    const mh = compileManhole(u, { x: 20, y: 6, dir: [0, 1], datum: 4 });
    assert.ok(validateAccessModule(u, mh));
});

test('Signal House climbs by stairs only and every access structure passes the template gate', () => {
    const pkg = MAP_PACKAGES.find(p => p.manifest.id === 'signal-house');
    const m = buildPackagedMap(pkg, { seed: 1 }), b = m.buildings[0];
    assert.equal(b.storeys, 4);
    assert.deepEqual(b.access.map(a => a.module), ['fire_escape']);
    assert.deepEqual(checkAccess(m), { accessTemplates: true, accessByHeight: true });
    const stairsOnly = reachable(m.store, m.spawns.player[0], Infinity, AGENT_PROFILES.player, { ladders: false, jump: false,
        blocked: p => b.stairs.some(r => r.cells.some(c => c.x === p.x && c.y === p.y && c.z === p.z)) });
    for (const e of b.escapes) assert.ok(stairsOnly.costs.has(nodeKey(e.landing)), `storey ${e.floor}`);
    assert.ok(stairsOnly.costs.has(nodeKey({ x: b.x0 + 1, y: b.y0 + 1, z: b.top })), 'roof by the escape');
});
