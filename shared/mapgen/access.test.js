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

test('the fire escape is one uniform 6×2 ladder-linked platforms on every facade and storey count (no exterior stairs)', () => {
    const sizes = new Set();
    for (const storeys of [3, 4]) for (const side of ['n', 'e', 's', 'w']) {
        const { s, G, origin } = shell(side, storeys);
        const params = { side, origin, datum: G, storeys, doors: {} };
        const { cells } = fireEscapeTemplate(params);
        assert.ok(cells.every(c => c.u >= 0 && c.u < FIRE_ESCAPE.along && c.r >= 0 && c.r <= FIRE_ESCAPE.out + FIRE_ESCAPE.lip));
        assert.ok(cells.filter(c=>c.role==='rung').every(c=>c.u===2&&c.r===2));
        assert.ok(cells.some(c=>c.mat===MAT.ladder));assert.ok(!cells.some(c=>c.mat===MAT.steel_stair));
        const { a, o } = SIDE_FRAME[side];
        const xs = cells.filter(c => c.r > 0).map(c => c.x), ys = cells.filter(c => c.r > 0).map(c => c.y);
        const along = a[0] ? Math.max(...xs) - Math.min(...xs) + 1 : Math.max(...ys) - Math.min(...ys) + 1;
        const out = o[0] ? Math.max(...xs) - Math.min(...xs) + 1 : Math.max(...ys) - Math.min(...ys) + 1;
        sizes.add(`${along}x${out}`);
        // Three rungs per storey and a full platform with one ladder well.
        assert.equal(cells.filter(c=>c.role==='rung').length,3*storeys);
        assert.equal(cells.filter(c=>c.role==='landing').length,11*storeys);
        const rec = compileFireEscape(s, params);
        assert.ok(validateAccessModule(s, rec));
        // Every platform and roof are reachable only when ladder traversal is enabled.
        const [fx, fy] = [origin[0] + o[0], origin[1] + o[1]];
        const reach = reachable(s, { x: fx, y: fy, z: G }, Infinity, AGENT_PROFILES.player, { jump: false });
        for (const l of rec.landings) assert.ok(reach.costs.has(nodeKey(l.stand)), `${side}/${storeys}: storey ${l.storey}`);
        const noLadders=reachable(s,{x:fx,y:fy,z:G},Infinity,AGENT_PROFILES.player,{ladders:false,jump:false});
        assert.ok(rec.landings.every(l=>!noLadders.costs.has(nodeKey(l.stand))));
        const down=reachable(s,rec.landings.at(-1).stand,Infinity,AGENT_PROFILES.player,{jump:false});
        assert.ok(down.costs.has(nodeKey({x:fx,y:fy,z:G})));
        // A tampered cell fails the template gate.
        const p = rec.landings[0].cells[0]; s.set(...p, MAT.concrete);
        assert.throws(() => validateAccessModule(s, rec), /access.template/);
    }
    assert.deepEqual([...sizes], ['6x2']);
});

test('beam-free platforms stay facade anchored and fall when their wall anchors are removed',()=>{
    const {s,G,origin}=shell('e',4),rec=compileFireEscape(s,{side:'e',origin,datum:G,storeys:4,doors:{}});
    assert.equal(settleUnsupported(s.clone()).removed,0);
    assert.ok(!fireEscapeTemplate(rec.params).cells.some(c=>c.mat===MAT.steel_post));
    assert.ok(s.supportGroups.every(g=>g.columns.length===0&&g.anchors.length===6));
    const target=s.supportGroups[1];s.set(...target.anchors[0],0);settleUnsupported(s);
    assert.ok(rec.landings.every(l=>l.cells.every(p=>s.get(...p)===MAT.grate)));
    for(const anchor of target.anchors)s.set(...anchor,0);settleUnsupported(s);
    assert.ok(target.members.every(p=>s.get(...p)===0));

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

test('Signal House has interior stairs and an independent ladder fire escape', () => {
    const pkg = MAP_PACKAGES.find(p => p.manifest.id === 'signal-house');
    const m = buildPackagedMap(pkg, { seed: 1 }), b = m.buildings[0];
    assert.equal(b.storeys, 4);
    assert.deepEqual(b.access.map(a => a.module), ['fire_escape']);
    assert.deepEqual(checkAccess(m), { accessTemplates: true, accessByHeight: true });
    const stairsOnly = reachable(m.store, m.spawns.player[0], Infinity, AGENT_PROFILES.player, { jump: false,
        blocked: p => b.stairs.some(r => r.cells.some(c => c.x === p.x && c.y === p.y && c.z === p.z)) });
    for (const e of b.escapes) assert.ok(stairsOnly.costs.has(nodeKey(e.landing)), `storey ${e.floor}`);
    assert.ok(stairsOnly.costs.has(nodeKey({ x: b.x0 + 1, y: b.y0 + 1, z: b.top })), 'roof by ladder escape');
    const interior=reachable(m.store,m.spawns.player[0],Infinity,AGENT_PROFILES.player,{ladders:false,jump:false});
    for(let floor=1;floor<b.storeys;floor++){const run=b.stairs.find(r=>r.storey===floor-1);assert.ok(run);assert.ok(interior.costs.has(nodeKey(run.after)));}
});
