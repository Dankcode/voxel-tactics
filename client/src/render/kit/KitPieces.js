// The Voxel Tactics tile set: every structure and cover voxel is drawn with one of these pieces instead of a cube.
// Pure three.js geometry (no DOM), so the same code runs in the bake tool (tools/kit/bake_tileset.mjs → GLB) and as
// the in-browser fallback when the baked tile set is missing.
//
// Conventions (same contract as vibe-game's MeshKit, PLAN 19 §1.4):
//   * one voxel cell = x, z ∈ [-0.5, 0.5], y ∈ [0, 1] (three's Y is up); pieces never leave their cell except where
//     noted (eaves, awnings, foliage), and never define collision — the voxel grid stays the gameplay truth;
//   * pieces that run along a line are authored along +X and rotated by the renderer;
//   * every part names a material SLOT; the renderer resolves slots to textures:
//       self  — the voxel's own material (stone / plaster / timber wall …)     trim  — dark structural timber
//       quoin — dressed corner stone      wood — planks      door — door leaf     glass — window pane
//       iron, glow, cloth, crate, barrel, hay, sandbag, drystone, rock, leaves, hedge, bark, cap (cutaway section)
//   * UVs: parts whose slot uses world-space mapping ignore these UVs (walls stay seamless across pieces); crates,
//     barrels, hay, sandbags and cloth use the UVs authored here.
import * as THREE from 'three';
import { rng, box, clean, merge, softBox, blob } from './Geo.js';
import { MODERN_PIECES } from './ModernPieces.js';

export { WALL_T, ARM } from './Geo.js';
import { WALL_T, ARM } from './Geo.js';

// ------------------------------------------------------------------------------------------- pieces
/** id → () => [{ slot, geometry }]. Each piece also lists `meta` for the manifest. */
export const PIECES = {
    // --- walls (autotiled by the renderer: core + one arm per connected side, arms authored toward +X)
    wall_core: { meta: { group: 'wall', text: 'Wall post / junction' }, build: () => [{ slot: 'self', geometry: box(WALL_T, 1, WALL_T) }] },
    wall_arm: { meta: { group: 'wall', text: 'Wall run from the post to the cell edge (+X)' }, build: () => [{ slot: 'self', geometry: box(ARM, 1, WALL_T, WALL_T / 2 + ARM / 2) }] },
    wall_beam: { meta: { group: 'wall', text: 'Timber storey beam on a wall run' }, build: () => [{ slot: 'trim', geometry: box(0.5, 0.13, WALL_T + 0.06, 0.25, 0.855) }] },
    wall_beam_core: { meta: { group: 'wall' }, build: () => [{ slot: 'trim', geometry: box(WALL_T + 0.06, 0.13, WALL_T + 0.06, 0, 0.855) }] },
    wall_post: { meta: { group: 'wall', text: 'Corner timber post' }, build: () => [{ slot: 'trim', geometry: box(WALL_T + 0.08, 0.99, WALL_T + 0.08) }] },
    wall_quoin: { meta: { group: 'wall', text: 'Dressed corner stones' }, build: () => [{ slot: 'quoin', geometry: merge([box(WALL_T + 0.06, 0.46, WALL_T + 0.06, 0, 0.02), box(WALL_T + 0.04, 0.44, WALL_T + 0.04, 0, 0.53)]) }] },
    wall_brace: { meta: { group: 'wall', text: 'Diagonal timber brace' }, build: () => {
        const g = new THREE.BoxGeometry(1.25, 0.09, WALL_T + 0.05).rotateZ(Math.atan2(0.86, 0.9)).translate(0, 0.5, 0);
        return [{ slot: 'trim', geometry: g }];
    } },
    coping_core: { meta: { group: 'wall', text: 'Coping on an exposed wall top' }, build: () => [{ slot: 'quoin', geometry: box(WALL_T + 0.12, 0.08, WALL_T + 0.12, 0, 1) }] },
    coping_arm: { meta: { group: 'wall' }, build: () => [{ slot: 'quoin', geometry: box(ARM, 0.08, WALL_T + 0.12, WALL_T / 2 + ARM / 2, 1) }] },
    cap_core: { meta: { group: 'cutaway', text: 'Section cap where the storey cutaway slices a wall' }, build: () => [{ slot: 'cap', geometry: box(WALL_T + 0.1, 0.025, WALL_T + 0.1, 0, 1.001) }] },
    cap_arm: { meta: { group: 'cutaway' }, build: () => [{ slot: 'cap', geometry: box(ARM, 0.025, WALL_T + 0.1, WALL_T / 2 + ARM / 2, 1.001) }] },

    // --- openings
    window: { meta: { group: 'opening', text: 'Window in a wall run (+X): piers, lintel, frame, pane, sill' }, build: () => [
        { slot: 'self', geometry: merge([box(0.16, 1, WALL_T, -0.42), box(0.16, 1, WALL_T, 0.42), box(1, 0.16, WALL_T, 0, 0.84)]) },
        { slot: 'trim', geometry: merge([box(0.06, 0.7, 0.1, -0.31, 0.12), box(0.06, 0.7, 0.1, 0.31, 0.12), box(0.68, 0.06, 0.1, 0, 0.78), box(0.03, 0.66, 0.08, 0, 0.13), box(0.62, 0.03, 0.08, 0, 0.47)]) },
        { slot: 'glass', geometry: box(0.6, 0.66, 0.03, 0, 0.13) },
        { slot: 'quoin', geometry: box(0.82, 0.07, WALL_T + 0.2, 0, 0.05) }
    ] },
    door_lower: { meta: { group: 'opening', text: 'Closed door, lower voxel (+X run)' }, build: () => [
        { slot: 'trim', geometry: merge([box(0.1, 1, WALL_T + 0.04, -0.45), box(0.1, 1, WALL_T + 0.04, 0.45)]) },
        { slot: 'door', geometry: box(0.8, 1, 0.08) },
        { slot: 'iron', geometry: merge([box(0.62, 0.05, 0.1, 0, 0.2), box(0.62, 0.05, 0.1, 0, 0.75), box(0.05, 0.08, 0.13, 0.28, 0.48)]) }
    ] },
    door_upper: { meta: { group: 'opening', text: 'Closed door, upper voxel with lintel' }, build: () => [
        { slot: 'trim', geometry: merge([box(0.1, 1, WALL_T + 0.04, -0.45), box(0.1, 1, WALL_T + 0.04, 0.45), box(1, 0.14, WALL_T + 0.06, 0, 0.86)]) },
        { slot: 'door', geometry: box(0.8, 0.86, 0.08) },
        { slot: 'iron', geometry: box(0.62, 0.05, 0.1, 0, 0.45) }
    ] },
    door_open_lower: { meta: { group: 'opening', text: 'Open door: frame and the leaf swung in (hinge at −X)' }, build: () => [
        { slot: 'trim', geometry: merge([box(0.1, 1, WALL_T + 0.04, -0.45), box(0.1, 1, WALL_T + 0.04, 0.45)]) },
        { slot: 'door', geometry: box(0.08, 1, 0.8, -0.38, 0, 0.42) }
    ] },
    door_open_upper: { meta: { group: 'opening' }, build: () => [
        { slot: 'trim', geometry: merge([box(0.1, 1, WALL_T + 0.04, -0.45), box(0.1, 1, WALL_T + 0.04, 0.45), box(1, 0.14, WALL_T + 0.06, 0, 0.86)]) },
        { slot: 'door', geometry: box(0.08, 0.86, 0.8, -0.38, 0, 0.42) }
    ] },
    sconce: { meta: { group: 'light', text: 'Wall lantern (both faces of a wall run)' }, build: () => [
        { slot: 'iron', geometry: merge([box(0.05, 0.05, WALL_T + 0.36, 0, 0.62), box(0.12, 0.03, 0.12, 0, 0.42, WALL_T / 2 + 0.16), box(0.12, 0.03, 0.12, 0, 0.42, -WALL_T / 2 - 0.16)]) },
        { slot: 'glow', geometry: merge([box(0.09, 0.16, 0.09, 0, 0.45, WALL_T / 2 + 0.16), box(0.09, 0.16, 0.09, 0, 0.45, -WALL_T / 2 - 0.16)]) }
    ] },

    // --- stairs (rising toward +X)
    stair_block: { meta: { group: 'stairs', text: 'Solid stringer under a stair tread' }, build: () => [{ slot: 'self', geometry: box(1, 1, 1) }] },
    stair_step: { meta: { group: 'stairs', text: 'Two treads in one voxel, rising toward +X' }, build: () => [{ slot: 'self', geometry: merge([box(1, 0.5, 1), box(0.5, 0.5, 1, 0.25, 0.5)]) }] },
    stair_rail: { meta: { group: 'stairs', text: 'Handrail on the open side (+Z)' }, build: () => {
        const rail = new THREE.BoxGeometry(1.42, 0.06, 0.06).rotateZ(Math.PI / 4).translate(0, 1.15, 0.44);
        return [{ slot: 'trim', geometry: merge([rail, box(0.06, 1.1, 0.06, -0.42, 0.3, 0.44), box(0.06, 0.8, 0.06, 0.42, 1, 0.44)]) }];
    } },

    // --- cover props (see shared/mission/PropCatalog.js for their gameplay)
    crate: { meta: { group: 'cover', text: 'Wooden crate' }, build: () => [{ slot: 'crate', geometry: softBox(0.86, 0.86, 0.86, 0.03, 1).translate(0, 0.43, 0) }] },
    barrel: { meta: { group: 'cover', text: 'Barrel (powder or water by material)' }, build: () => {
        const pts = [];
        for (let i = 0; i <= 10; i++) { const t = i / 10; pts.push(new THREE.Vector2(0.3 + Math.sin(t * Math.PI) * 0.06, t * 0.92)); }
        const body = new THREE.LatheGeometry(pts, 20);
        const lid = new THREE.CircleGeometry(0.3, 20).rotateX(-Math.PI / 2).translate(0, 0.92, 0);
        return [{ slot: 'barrel', geometry: merge([body, lid]) }];
    } },
    sandbags: { meta: { group: 'cover', text: 'Sandbag course (+X run), three rows' }, build: () => {
        const bags = [];
        for (let row = 0; row < 3; row++) for (let i = 0; i < 2; i++) {
            const off = row % 2 ? 0.25 : 0;
            const x = -0.25 + i * 0.5 + off;
            if (x > 0.5) continue;
            bags.push(softBox(0.5, 0.3, 0.62 - row * 0.06, 0.12, 1).translate(Math.min(0.25, x), 0.15 + row * 0.27, 0));
        }
        bags.push(softBox(0.28, 0.3, 0.5, 0.12, 1).translate(-0.36, 0.15 + 0.27, 0));
        return [{ slot: 'sandbag', geometry: merge(bags) }];
    } },
    drystone: { meta: { group: 'cover', text: 'Dry-stone field wall (+X run), coursed rubble with capstones' }, build: () => {
        const r = rng(11), stones = [];
        for (let row = 0; row < 4; row++) {
            let x = -0.5;
            while (x < 0.5) {
                const w = 0.18 + r() * 0.2, h = 0.17 + r() * 0.05;
                stones.push(new THREE.BoxGeometry(Math.min(w, 0.5 - x), h, 0.62 - row * 0.04).rotateY((r() - 0.5) * 0.12).translate(x + Math.min(w, 0.5 - x) / 2, row * 0.18 + h / 2, (r() - 0.5) * 0.04));
                x += w;
            }
        }
        const caps = [];
        for (let i = 0; i < 5; i++) caps.push(new THREE.BoxGeometry(0.06, 0.24, 0.56).rotateZ(0.35).translate(-0.4 + i * 0.2, 0.84, 0));
        return [{ slot: 'drystone', geometry: merge([...stones, ...caps]) }];
    } },
    fence: { meta: { group: 'cover', text: 'Plank fence (+X run): posts, rails, boards' }, build: () => {
        const boards = [];
        for (let i = 0; i < 7; i++) boards.push(box(0.12, 0.82 + (i % 2) * 0.05, 0.05, -0.42 + i * 0.14, 0.02, 0.04));
        return [{ slot: 'trim', geometry: merge([box(0.11, 0.98, 0.11, -0.45), box(0.11, 0.98, 0.11, 0.45), box(1, 0.07, 0.06, 0, 0.18, -0.03), box(1, 0.07, 0.06, 0, 0.68, -0.03)]) },
            { slot: 'wood', geometry: merge(boards) }];
    } },
    hay: { meta: { group: 'cover', text: 'Hay bale' }, build: () => [{ slot: 'hay', geometry: merge([softBox(0.92, 0.5, 0.66, 0.08).translate(0, 0.25, 0), softBox(0.86, 0.36, 0.6, 0.08).translate(0.02, 0.68, 0.02)]) }] },
    rock: { meta: { group: 'cover', text: 'Boulder (3 variants by hash)', variants: 3 }, build: (v = 0) => [{ slot: 'rock', geometry: blob(0.72, 1, 31 + v * 17, [1.0, 0.78, 1.0], 0.5).translate(0, 0.42, 0) }] },
    rock_top: { meta: { group: 'cover', text: 'Upper part of a tall boulder' }, build: () => [{ slot: 'rock', geometry: blob(0.62, 1, 77, [1, 0.9, 0.95], 0.45).translate(0, 0.28, 0) }] },
    cart_body: { meta: { group: 'cover', text: 'Cart bed and sides (+X run), one cell' }, build: () => [
        { slot: 'wood', geometry: merge([box(1, 0.1, 0.86, 0, 0.42), box(1, 0.36, 0.06, 0, 0.52, 0.42), box(1, 0.36, 0.06, 0, 0.52, -0.42)]) },
        { slot: 'trim', geometry: merge([box(1, 0.06, 0.08, 0, 0.88, 0.42), box(1, 0.06, 0.08, 0, 0.88, -0.42), box(0.08, 0.08, 0.96, 0, 0.3)]) }
    ] },
    cart_end: { meta: { group: 'cover', text: 'Cart tailboard at a free end (+X)' }, build: () => [{ slot: 'wood', geometry: box(0.06, 0.36, 0.86, 0.47, 0.52) }] },
    cart_wheels: { meta: { group: 'cover', text: 'Wheel pair' }, build: () => {
        const wheel = z => new THREE.CylinderGeometry(0.33, 0.33, 0.07, 14).rotateX(Math.PI / 2).translate(0, 0.33, z);
        const hub = z => new THREE.CylinderGeometry(0.07, 0.07, 0.12, 8).rotateX(Math.PI / 2).translate(0, 0.33, z);
        return [{ slot: 'trim', geometry: merge([wheel(0.5), wheel(-0.5)]) }, { slot: 'iron', geometry: merge([hub(0.53), hub(-0.53)]) }];
    } },
    cart_shaft: { meta: { group: 'cover', text: 'Draught shafts at the front end (+X), reach into the next cell' }, build: () => [{ slot: 'trim', geometry: merge([box(0.9, 0.06, 0.06, 0.9, 0.36, 0.3), box(0.9, 0.06, 0.06, 0.9, 0.36, -0.3)]) }] },
    stall: { meta: { group: 'cover', text: 'Market stall counter (+X run, customers on −Z) with posts and striped awning' }, build: () => {
        const awning = new THREE.BoxGeometry(1.02, 0.04, 1.1).rotateX(-0.28).translate(0, 1.95, -0.08);
        return [
            { slot: 'wood', geometry: merge([box(1, 0.08, 0.66, 0, 0.78, -0.05), box(1, 0.72, 0.06, 0, 0.05, -0.36)]) },
            { slot: 'trim', geometry: merge([box(0.08, 2.0, 0.08, 0.45, 0, 0.32), box(0.08, 1.7, 0.08, 0.45, 0, -0.42), box(0.08, 0.06, 0.6, 0, 0.3, -0.05)]) },
            { slot: 'cloth', geometry: awning }
        ];
    } },
    hedge: { meta: { group: 'foliage', text: 'Hedge bush (concealment, bullets pass)' }, build: () => [{ slot: 'hedge', geometry: merge([blob(0.42, 1, 5, [1.2, 0.95, 1.1], 0.25).translate(0, 0.5, 0), blob(0.3, 1, 9, [1, 1, 1], 0.2).translate(0.22, 0.75, 0.1)]) }] },
    foliage: { meta: { group: 'foliage', text: 'Tree canopy blob (overlaps neighbours)' }, build: () => [{ slot: 'leaves', geometry: blob(0.7, 1, 13, [1.05, 0.9, 1.05], 0.28).translate(0, 0.5, 0) }] },
    trunk: { meta: { group: 'foliage', text: 'Tree trunk segment' }, build: () => [{ slot: 'bark', geometry: new THREE.CylinderGeometry(0.17, 0.2, 1, 9).translate(0, 0.5, 0) }] },
    trunk_base: { meta: { group: 'foliage', text: 'Trunk with root flare' }, build: () => [{ slot: 'bark', geometry: merge([new THREE.CylinderGeometry(0.2, 0.3, 1, 9).translate(0, 0.5, 0), new THREE.CylinderGeometry(0.3, 0.42, 0.18, 9).translate(0, 0.09, 0)]) }] },
    lamp_post: { meta: { group: 'light', text: 'Iron post segment' }, build: () => [{ slot: 'iron', geometry: merge([new THREE.CylinderGeometry(0.06, 0.07, 1, 8).translate(0, 0.5, 0)]) }] },
    lamp_base: { meta: { group: 'light' }, build: () => [{ slot: 'iron', geometry: merge([new THREE.CylinderGeometry(0.06, 0.07, 1, 8).translate(0, 0.5, 0), new THREE.CylinderGeometry(0.16, 0.2, 0.16, 8).translate(0, 0.08, 0)]) }] },
    lantern: { meta: { group: 'light', text: 'Lantern head' }, build: () => [
        { slot: 'iron', geometry: merge([box(0.3, 0.04, 0.3, 0, 0.1), box(0.32, 0.05, 0.32, 0, 0.5), new THREE.ConeGeometry(0.2, 0.16, 4).rotateY(Math.PI / 4).translate(0, 0.62, 0), ...[[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([a, b]) => box(0.03, 0.4, 0.03, a * 0.13, 0.1, b * 0.13))]) },
        { slot: 'glow', geometry: box(0.2, 0.34, 0.2, 0, 0.13) }
    ] },
    table: { meta: { group: 'interior', text: 'Table / bench / bed frame (joins neighbours)' }, build: () => [{ slot: 'wood', geometry: merge([box(1, 0.08, 0.9, 0, 0.66), ...[[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([a, b]) => box(0.07, 0.66, 0.07, a * 0.4, 0, b * 0.36))]) }] },
    shelf: { meta: { group: 'interior', text: 'Shelf / rack (+X faces the room)' }, build: () => [
        { slot: 'wood', geometry: merge([box(0.06, 1, 0.9, -0.3), box(0.06, 1, 0.9, 0.3), box(0.66, 0.04, 0.9, 0, 0.02), box(0.66, 0.04, 0.9, 0, 0.48), box(0.66, 0.04, 0.9, 0, 0.94), box(0.04, 1, 0.9, -0.3)]) },
        { slot: 'crate', geometry: merge([box(0.3, 0.2, 0.3, 0, 0.06, -0.2), box(0.25, 0.25, 0.25, 0.02, 0.52, 0.18)]) }
    ] },
    banner: { meta: { group: 'decor', text: 'Hanging cloth panel' }, build: () => [{ slot: 'cloth', geometry: box(0.9, 0.95, 0.04, 0, 0.02) }] },
    crystal: { meta: { group: 'decor', text: 'Crystal cluster' }, build: () => {
        const r = rng(5), parts = [];
        for (let i = 0; i < 5; i++) parts.push(new THREE.OctahedronGeometry(0.14 + r() * 0.08).scale(0.7, 2.2, 0.7).rotateZ((r() - 0.5) * 0.7).rotateX((r() - 0.5) * 0.7).translate((r() - 0.5) * 0.4, 0.62, (r() - 0.5) * 0.4));
        return [{ slot: 'crystal', geometry: merge(parts) }];
    } },
    // Present-day pieces (walls trims, glazing, doors, furniture, vehicles, street furniture, trees, decor).
    ...MODERN_PIECES
};

/** Build every piece: Map id → [{ slot, geometry }] (variants as `id#n`). */
export function buildAllPieces() {
    const out = new Map();
    for (const [id, def] of Object.entries(PIECES)) {
        const variants = def.meta.variants || 1;
        for (let v = 0; v < variants; v++) out.set(variants > 1 ? `${id}#${v}` : id, def.build(v).map(p => ({ slot: p.slot, geometry: clean(p.geometry) })));
    }
    return out;
}
