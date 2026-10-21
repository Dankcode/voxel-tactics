import {TRAFFIC_PIECES} from './TrafficPieces.js';
import {STREET_PROP_PIECES} from './StreetPropPieces.js';
// Present-day tile-set pieces. Same contract as KitPieces.js (cell x, z ∈ [-0.5, 0.5], y ∈ [0, 1], pivot at the
// cell-floor centre, runs along +X) plus two conventions for furniture and vehicles:
//   * FRONT is +Z, the BACK (against a wall) is −Z — the builder's hints rotate pieces so the back meets the wall;
//   * multi-cell objects (cars, containers, dumpsters, trees) are authored around their own footprint centre and are
//     placed once per object (meta.footprint documents the cells they cover).
// Rounded edges everywhere (softBox / bevelled extrusions): nothing here should read as a cube.
import * as THREE from 'three';
import { WALL_T, ARM, box, merge, softBox, blob, cyl, disc, profileX, profileZ, rng } from './Geo.js';

const sb = (w, h, d, r, x = 0, y = 0, z = 0, seg = 1) => softBox(w, h, d, r, seg).translate(x, y + h / 2, z);
const legs4 = (w, d, h, t = 0.045, y = 0) => [[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([a, b]) => box(t, h, t, a * (w / 2 - t), y, b * (d / 2 - t)));
const P = (meta, build) => ({ meta, build });

// ----------------------------------------------------------------------------------------- walls & openings
const wallTrims = {
    mcap_core: P({ group: 'modern-wall', text: 'Dark metal flashing on an exposed modern wall top' }, () => [{ slot: 'frame', geometry: box(WALL_T + 0.1, 0.06, WALL_T + 0.1, 0, 1) }]),
    mcap_arm: P({ group: 'modern-wall' }, () => [{ slot: 'frame', geometry: box(ARM, 0.06, WALL_T + 0.1, WALL_T / 2 + ARM / 2, 1) }]),
    plinth_core: P({ group: 'modern-wall', text: 'Skirting / plinth at the foot of a wall' }, () => [{ slot: 'plinth', geometry: box(WALL_T + 0.04, 0.1, WALL_T + 0.04) }]),
    plinth_arm: P({ group: 'modern-wall' }, () => [{ slot: 'plinth', geometry: box(ARM, 0.1, WALL_T + 0.04, WALL_T / 2 + ARM / 2) }]),
    glaze: P({ group: 'glazing', text: 'Full-width glazing panel with half mullions at both cell edges (+X run)' }, () => [
        { slot: 'glass', geometry: box(0.94, 1, 0.03) },
        { slot: 'frame', geometry: merge([box(0.05, 1, 0.1, -0.475), box(0.05, 1, 0.1, 0.475)]) }
    ]),
    glaze_sill: P({ group: 'glazing', text: 'Bottom rail and outside sill under a glazing run' }, () => [
        { slot: 'frame', geometry: merge([box(1, 0.06, 0.1), box(1, 0.035, WALL_T + 0.12, 0, -0.005)]) }
    ]),
    glaze_head: P({ group: 'glazing', text: 'Head rail over a glazing run' }, () => [{ slot: 'frame', geometry: box(1, 0.07, 0.1, 0, 0.93) }]),
    mdoor_lower: P({ group: 'modern-door', text: 'Flush timber door in a slim frame (lower voxel)' }, () => [
        { slot: 'frame', geometry: merge([box(0.07, 1, WALL_T + 0.02, -0.465), box(0.07, 1, WALL_T + 0.02, 0.465)]) },
        { slot: 'leaf', geometry: box(0.86, 1, 0.05) },
        { slot: 'chrome', geometry: merge([box(0.025, 0.32, 0.03, 0.33, 0.42, 0.05), box(0.025, 0.32, 0.03, 0.33, 0.42, -0.05)]) }
    ]),
    mdoor_upper: P({ group: 'modern-door' }, () => [
        { slot: 'frame', geometry: merge([box(0.07, 0.86, WALL_T + 0.02, -0.465), box(0.07, 0.86, WALL_T + 0.02, 0.465), box(1, 0.05, WALL_T + 0.02, 0, 0.84)]) },
        { slot: 'leaf', geometry: box(0.86, 0.84, 0.05) },
        { slot: 'self', geometry: box(1, 0.11, WALL_T, 0, 0.89) }
    ]),
    mdoor_open_lower: P({ group: 'modern-door', text: 'Open door, leaf swung toward +Z' }, () => [
        { slot: 'frame', geometry: merge([box(0.07, 1, WALL_T + 0.02, -0.465), box(0.07, 1, WALL_T + 0.02, 0.465)]) },
        { slot: 'leaf', geometry: box(0.05, 1, 0.84, -0.41, 0, 0.45) }
    ]),
    mdoor_open_upper: P({ group: 'modern-door' }, () => [
        { slot: 'frame', geometry: merge([box(0.07, 0.86, WALL_T + 0.02, -0.465), box(0.07, 0.86, WALL_T + 0.02, 0.465), box(1, 0.05, WALL_T + 0.02, 0, 0.84)]) },
        { slot: 'leaf', geometry: box(0.05, 0.84, 0.84, -0.41, 0, 0.45) },
        { slot: 'self', geometry: box(1, 0.11, WALL_T, 0, 0.89) }
    ]),
    gdoor_lower: P({ group: 'modern-door', text: 'Glazed storefront door with push bar' }, () => [
        { slot: 'frame', geometry: merge([box(0.07, 1, WALL_T, -0.465), box(0.07, 1, WALL_T, 0.465), box(0.86, 0.14, 0.06), box(0.05, 1, 0.06, -0.405), box(0.05, 1, 0.06, 0.405)]) },
        { slot: 'glass', geometry: box(0.76, 0.86, 0.025, 0, 0.14) },
        { slot: 'chrome', geometry: merge([box(0.7, 0.03, 0.03, 0, 0.5, 0.06), box(0.7, 0.03, 0.03, 0, 0.5, -0.06)]) }
    ]),
    gdoor_upper: P({ group: 'modern-door' }, () => [
        { slot: 'frame', geometry: merge([box(0.07, 0.95, WALL_T, -0.465), box(0.07, 0.95, WALL_T, 0.465), box(1, 0.07, 0.1, 0, 0.86), box(0.05, 0.86, 0.06, -0.405), box(0.05, 0.86, 0.06, 0.405)]) },
        { slot: 'glass', geometry: merge([box(0.76, 0.86, 0.025), box(0.86, 0.07, 0.025, 0, 0.93)]) }
    ]),
    gdoor_open_lower: P({ group: 'modern-door' }, () => [
        { slot: 'frame', geometry: merge([box(0.07, 1, WALL_T, -0.465), box(0.07, 1, WALL_T, 0.465), box(0.06, 0.14, 0.84, -0.41, 0, 0.45)]) },
        { slot: 'glass', geometry: box(0.025, 0.86, 0.76, -0.41, 0.14, 0.45) }
    ]),
    gdoor_open_upper: P({ group: 'modern-door' }, () => [
        { slot: 'frame', geometry: merge([box(0.07, 0.95, WALL_T, -0.465), box(0.07, 0.95, WALL_T, 0.465), box(1, 0.07, 0.1, 0, 0.86)]) },
        { slot: 'glass', geometry: box(0.025, 0.86, 0.76, -0.41, 0, 0.45) }
    ]),
    roller_lower: P({ group: 'modern-door', text: 'Roller shutter (warehouse) lower voxel' }, () => [
        { slot: 'frame', geometry: merge([box(0.06, 1, WALL_T + 0.04, -0.47), box(0.06, 1, WALL_T + 0.04, 0.47), box(0.94, 0.05, 0.1)]) },
        { slot: 'shutter', geometry: box(0.94, 1, 0.05) }
    ]),
    roller_upper: P({ group: 'modern-door' }, () => [
        { slot: 'frame', geometry: merge([box(0.06, 1, WALL_T + 0.04, -0.47), box(0.06, 1, WALL_T + 0.04, 0.47), box(1, 0.2, 0.34, 0, 0.8, -0.04)]) },
        { slot: 'shutter', geometry: box(0.94, 0.8, 0.05) }
    ]),
    roller_open_lower: P({ group: 'modern-door' }, () => [{ slot: 'frame', geometry: merge([box(0.06, 1, WALL_T + 0.04, -0.47), box(0.06, 1, WALL_T + 0.04, 0.47)]) }]),
    roller_open_upper: P({ group: 'modern-door' }, () => [
        { slot: 'frame', geometry: merge([box(0.06, 1, WALL_T + 0.04, -0.47), box(0.06, 1, WALL_T + 0.04, 0.47), box(1, 0.2, 0.34, 0, 0.8, -0.04)]) },
        { slot: 'shutter', geometry: disc(0.12, 0.94, 12, 0, 0.88, -0.02).rotateY(Math.PI / 2) }
    ]),
    column: P({ group: 'structure', text: 'Square steel column (canopies)' }, () => [{ slot: 'iron', geometry: merge([box(0.26, 1, 0.26), box(0.34, 0.08, 0.34)]) }]),
    // Fixed steel ladder against a wall or container side; its back (−Z) meets the wall. One piece per ladder voxel.
    ladder: P({ group: 'structure', text: 'Steel ladder segment (rails and rungs, back against the wall)' }, () => [{ slot: 'iron', geometry: merge([
        box(0.05, 1, 0.05, -0.22, 0, -0.36), box(0.05, 1, 0.05, 0.22, 0, -0.36),
        ...[0.12, 0.37, 0.62, 0.87].map(y => box(0.44, 0.035, 0.035, 0, y, -0.36)),
        box(0.05, 0.05, 0.12, -0.22, 0.45, -0.46), box(0.05, 0.05, 0.12, 0.22, 0.45, -0.46)]) }]),
    ladder_top: P({ group: 'structure', overhang: true, text: 'Top ladder segment: rails curve over the ledge as grab handles' }, () => [{ slot: 'iron', geometry: merge([
        box(0.05, 1, 0.05, -0.22, 0, -0.36), box(0.05, 1, 0.05, 0.22, 0, -0.36),
        ...[0.12, 0.37, 0.62, 0.87].map(y => box(0.44, 0.035, 0.035, 0, y, -0.36)),
        box(0.05, 0.9, 0.05, -0.22, 1, -0.36), box(0.05, 0.9, 0.05, 0.22, 1, -0.36),
        box(0.05, 0.05, 0.42, -0.22, 1.85, -0.57), box(0.05, 0.05, 0.42, 0.22, 1.85, -0.57)]) }])
};

// ----------------------------------------------------------------------------------------- furniture
const sofaBase = (back = 0.42, arm = 0) => {
    const parts = [sb(1.0, 0.3, 0.84, 0.06, 0, 0.1, 0.02), sb(1.0, back, 0.22, 0.08, 0, 0.36, -0.31), sb(arm ? 0.84 : 0.98, 0.13, 0.6, 0.05, arm * 0.07, 0.4, 0.08)];
    if (arm) parts.push(sb(0.18, 0.56, 0.84, 0.07, arm * 0.41, 0.1, 0.02));
    return [{ slot: 'self', geometry: merge(parts) }, { slot: 'frame', geometry: merge(legs4(0.9, 0.74, 0.1, 0.04)) }];
};
const cushion = x => ({ slot: 'accent', geometry: sb(0.34, 0.3, 0.1, 0.04, x, 0.5, -0.17).rotateX(-0.2) });
const kitchenBody = (extra = []) => [
    { slot: 'lacquer', geometry: merge([box(1, 0.76, 0.6, 0, 0.08, -0.2)]) },
    { slot: 'plinth', geometry: box(1, 0.08, 0.54, 0, 0, -0.23) },
    { slot: 'worktop', geometry: box(1, 0.05, 0.66, 0, 0.84, -0.17) },
    { slot: 'frame', geometry: merge([box(0.012, 0.66, 0.01, 0, 0.12, 0.105), box(0.98, 0.012, 0.01, 0, 0.6, 0.105)]) },
    { slot: 'chrome', geometry: merge([box(0.26, 0.02, 0.025, -0.24, 0.7, 0.12), box(0.26, 0.02, 0.025, 0.24, 0.7, 0.12)]) },
    // Wall cupboards above the worktop (reach into the voxel above; scenery only).
    { slot: 'lacquer', geometry: box(1, 0.5, 0.34, 0, 1.36, -0.33) },
    ...extra
];
const shelvesWithGoods = (seed, depth = 0.8, levels = [0.08, 0.5, 0.92], twoSided = true) => {
    const r = rng(seed), goods = { goods_a: [], goods_b: [], goods_c: [] };
    for (const y of levels) for (const side of twoSided ? [-1, 1] : [1]) {
        let x = -0.44;
        while (x < 0.42) {
            const w = 0.1 + r() * 0.14, h = 0.12 + r() * 0.2;
            const key = ['goods_a', 'goods_b', 'goods_c'][Math.floor(r() * 3)];
            const ww = Math.min(w, 0.46 - x);
            goods[key].push(box(ww, h, depth * 0.36, x + ww / 2, y + 0.03, side * depth * 0.22));
            x += w + 0.02;
        }
    }
    return Object.entries(goods).filter(([, l]) => l.length).map(([slot, l]) => ({ slot, geometry: merge(l) }));
};

const furniture = {
    sofa: P({ group: 'furniture', text: 'Sofa section (back −Z)' }, () => [...sofaBase(), cushion(0.2)]),
    sofa_end_l: P({ group: 'furniture', text: 'Sofa end with the arm at −X' }, () => [...sofaBase(0.42, -1), cushion(0)]),
    sofa_end_r: P({ group: 'furniture', text: 'Sofa end with the arm at +X' }, () => sofaBase(0.42, 1)),
    booth: P({ group: 'furniture', text: 'Diner booth bench, high back' }, () => [
        { slot: 'self', geometry: merge([sb(1, 0.4, 0.6, 0.05, 0, 0, 0.05), sb(1, 0.6, 0.18, 0.06, 0, 0.36, -0.36)]) },
        { slot: 'frame', geometry: box(1, 0.06, 0.5, 0, 0, 0.05) }
    ]),
    bed_head: P({ group: 'furniture', text: 'Bed half with headboard and pillow (head −Z)' }, () => [
        { slot: 'wood', geometry: merge([box(1, 0.2, 1, 0, 0.04), box(1, 0.85, 0.08, 0, 0.04, -0.46)]) },
        { slot: 'linen', geometry: merge([sb(0.98, 0.2, 0.92, 0.06, 0, 0.24, 0.04), sb(0.62, 0.14, 0.3, 0.06, 0, 0.42, -0.26)]) },
        { slot: 'self', geometry: sb(1, 0.07, 0.42, 0.03, 0, 0.42, 0.29) }
    ]),
    bed_foot: P({ group: 'furniture', text: 'Bed half at the foot, duvet and throw' }, () => [
        { slot: 'wood', geometry: box(1, 0.2, 1, 0, 0.04) },
        { slot: 'linen', geometry: sb(0.98, 0.2, 0.96, 0.06, 0, 0.24, -0.02) },
        { slot: 'self', geometry: sb(1, 0.08, 0.96, 0.04, 0, 0.42, -0.02) },
        { slot: 'accent', geometry: sb(1.02, 0.04, 0.32, 0.02, 0, 0.49, 0.22) }
    ]),
    bed_head_single: P({ group: 'furniture' }, () => [
        { slot: 'wood', geometry: merge([box(0.9, 0.2, 1, 0, 0.04), box(0.9, 0.7, 0.07, 0, 0.04, -0.46)]) },
        { slot: 'linen', geometry: merge([sb(0.86, 0.2, 0.92, 0.06, 0, 0.24, 0.04), sb(0.55, 0.13, 0.28, 0.06, 0, 0.42, -0.26)]) },
        { slot: 'self', geometry: sb(0.9, 0.07, 0.42, 0.03, 0, 0.42, 0.29) }
    ]),
    bed_foot_single: P({ group: 'furniture' }, () => [
        { slot: 'wood', geometry: box(0.9, 0.2, 1, 0, 0.04) },
        { slot: 'linen', geometry: sb(0.86, 0.2, 0.96, 0.06, 0, 0.24, -0.02) },
        { slot: 'self', geometry: sb(0.9, 0.08, 0.96, 0.04, 0, 0.42, -0.02) }
    ]),
    kitchen: P({ group: 'furniture', text: 'Base cabinet, worktop and wall cupboard (back −Z)', overhang: true }, () => kitchenBody()),
    kitchen_sink: P({ group: 'furniture', overhang: true }, () => kitchenBody([
        { slot: 'chrome', geometry: merge([box(0.5, 0.012, 0.34, 0, 0.885, -0.12), cyl(0.015, 0.015, 0.26, 6, 0, 0.88, -0.38), box(0.03, 0.025, 0.18, 0, 1.12, -0.3)]) }
    ])),
    kitchen_hob: P({ group: 'furniture', overhang: true }, () => kitchenBody([
        { slot: 'screen', geometry: box(0.6, 0.012, 0.46, 0, 0.885, -0.15) },
        { slot: 'chrome', geometry: box(0.7, 0.12, 0.4, 0, 1.6, -0.3) }
    ])),
    island: P({ group: 'furniture', text: 'Kitchen island with an overhanging worktop' }, () => [
        { slot: 'lacquer', geometry: box(1, 0.78, 0.66, 0, 0.06, -0.1) },
        { slot: 'plinth', geometry: box(0.96, 0.06, 0.6, 0, 0, -0.1) },
        { slot: 'worktop', geometry: box(1.02, 0.06, 0.98, 0, 0.84, 0.02) }
    ]),
    fridge_lower: P({ group: 'furniture', text: 'Tall fridge, lower voxel' }, () => [
        { slot: 'self', geometry: sb(0.9, 1.0, 0.74, 0.03, 0, 0, -0.1) },
        { slot: 'frame', geometry: merge([box(0.006, 1, 0.01, 0, 0, 0.275), box(0.88, 0.01, 0.01, 0, 0.62, 0.275)]) },
        { slot: 'chrome', geometry: merge([box(0.025, 0.4, 0.03, -0.05, 0.62, 0.3), box(0.025, 0.4, 0.03, 0.05, 0.62, 0.3)]) }
    ]),
    fridge_upper: P({ group: 'furniture' }, () => [
        { slot: 'self', geometry: sb(0.9, 0.9, 0.74, 0.03, 0, 0, -0.1) },
        { slot: 'frame', geometry: box(0.006, 0.9, 0.01, 0, 0, 0.275) },
        { slot: 'chrome', geometry: merge([box(0.025, 0.36, 0.03, -0.05, 0.05, 0.3), box(0.025, 0.36, 0.03, 0.05, 0.05, 0.3)]) }
    ]),
    washer: P({ group: 'furniture', text: 'Washing machine' }, () => [
        { slot: 'self', geometry: sb(0.86, 0.86, 0.7, 0.04, 0, 0, -0.1) },
        { slot: 'chrome', geometry: new THREE.TorusGeometry(0.22, 0.03, 8, 20).translate(0, 0.42, 0.26) },
        { slot: 'glass', geometry: disc(0.2, 0.02, 16, 0, 0.42, 0.25) }
    ]),
    tv_unit: P({ group: 'furniture', text: 'Low media cabinet (TV sits on it as decor)' }, () => [
        { slot: 'wood', geometry: sb(1, 0.42, 0.5, 0.02, 0, 0.1, -0.2) },
        { slot: 'frame', geometry: merge([...legs4(0.9, 0.4, 0.1, 0.03).map(g => g.translate(0, 0, -0.2)), box(0.98, 0.006, 0.01, 0, 0.32, 0.055)]) }
    ]),
    wardrobe_lower: P({ group: 'furniture', text: 'Tall cupboard / wardrobe / filing cabinet, lower voxel' }, () => [
        { slot: 'lacquer', geometry: box(0.98, 1, 0.6, 0, 0, -0.18) },
        { slot: 'frame', geometry: merge([box(0.008, 1, 0.01, 0, 0, 0.125), box(0.98, 0.06, 0.56, 0, 0, -0.2)]) },
        { slot: 'chrome', geometry: merge([box(0.02, 0.3, 0.03, -0.06, 0.62, 0.14), box(0.02, 0.3, 0.03, 0.06, 0.62, 0.14)]) }
    ]),
    wardrobe_upper: P({ group: 'furniture' }, () => [
        { slot: 'lacquer', geometry: box(0.98, 0.9, 0.6, 0, 0, -0.18) },
        { slot: 'frame', geometry: box(0.008, 0.9, 0.01, 0, 0, 0.125) }
    ]),
    desk_end_l: P({ group: 'furniture', text: 'Desk / table end (legs at −X)' }, () => [
        { slot: 'self', geometry: box(1, 0.05, 0.72, 0, 0.7) },
        { slot: 'frame', geometry: merge([box(0.05, 0.7, 0.05, -0.44, 0, -0.3), box(0.05, 0.7, 0.05, -0.44, 0, 0.3), box(0.04, 0.04, 0.6, -0.44, 0.08)]) }
    ]),
    desk_end_r: P({ group: 'furniture' }, () => [
        { slot: 'self', geometry: box(1, 0.05, 0.72, 0, 0.7) },
        { slot: 'frame', geometry: merge([box(0.05, 0.7, 0.05, 0.44, 0, -0.3), box(0.05, 0.7, 0.05, 0.44, 0, 0.3), box(0.04, 0.04, 0.6, 0.44, 0.08)]) }
    ]),
    desk_mid: P({ group: 'furniture' }, () => [{ slot: 'self', geometry: box(1, 0.05, 0.72, 0, 0.7) }]),
    workbench: P({ group: 'furniture', text: 'Steel workbench with a vice, tools and a pegboard', overhang: true }, () => [
        { slot: 'wood', geometry: box(1, 0.08, 0.7, 0, 0.78, -0.12) },
        { slot: 'iron', geometry: merge([...legs4(0.96, 0.66, 0.78, 0.05).map(g => g.translate(0, 0, -0.12)), box(0.96, 0.03, 0.62, 0, 0.18, -0.12), box(1, 0.7, 0.03, 0, 0.86, -0.47)]) },
        { slot: 'goods_a', geometry: merge([box(0.18, 0.12, 0.12, -0.3, 0.86, -0.1), box(0.08, 0.3, 0.04, 0.2, 1.1, -0.44)]) }
    ]),
    bookcase_lower: P({ group: 'furniture', text: 'Bookcase (two voxels)' }, () => [
        { slot: 'wood', geometry: merge([box(0.04, 1, 0.36, -0.48, 0, -0.3), box(0.04, 1, 0.36, 0.48, 0, -0.3), box(1, 0.03, 0.36, 0, 0.02, -0.3), box(1, 0.03, 0.36, 0, 0.48, -0.3), box(1, 1, 0.02, 0, 0, -0.48)]) },
        ...shelvesWithGoods(41, 0.36, [0.05, 0.51], false).map(p => ({ ...p, geometry: p.geometry.translate(0, 0, -0.38) }))
    ]),
    bookcase_upper: P({ group: 'furniture' }, () => [
        { slot: 'wood', geometry: merge([box(0.04, 0.9, 0.36, -0.48, 0, -0.3), box(0.04, 0.9, 0.36, 0.48, 0, -0.3), box(1, 0.03, 0.36, 0, 0.42, -0.3), box(1, 0.04, 0.36, 0, 0.88, -0.3), box(1, 0.9, 0.02, 0, 0, -0.48)]) },
        ...shelvesWithGoods(43, 0.36, [0, 0.45], false).map(p => ({ ...p, geometry: p.geometry.translate(0, 0, -0.38) }))
    ]),
    store_shelf_lower: P({ group: 'furniture', text: 'Double-sided store gondola with goods' , overhang: true }, () => [
        { slot: 'frame', geometry: merge([box(1, 1, 0.04), box(1, 0.08, 0.8), box(1, 0.025, 0.78, 0, 0.5)]) },
        ...shelvesWithGoods(7, 0.8, [0.08, 0.52])
    ]),
    store_shelf_upper: P({ group: 'furniture' , overhang: true }, () => [
        { slot: 'frame', geometry: merge([box(1, 0.75, 0.04), box(1, 0.025, 0.7, 0, 0.0), box(1, 0.04, 0.12, 0, 0.72)]) },
        ...shelvesWithGoods(9, 0.7, [0.02, 0.38])
    ]),
    produce_display: P({group:'furniture',text:'Low sloping produce bins, open timber trays'},()=>[
        {slot:'wood',geometry:merge([...legs4(.92,.75,.5,.07),box(1,.08,.85,0,.48),box(1,.1,.85,0,.78),...[-.46,0,.46].map(x=>box(.035,.16,.85,x,.55))])},
        {slot:'goods_a',geometry:merge(Array.from({length:12},(_,i)=>cyl(.075,.075,.1,6).translate(-.36+(i%4)*.24,.6, -.29+Math.floor(i/4)*.27)))},
        {slot:'goods_b',geometry:merge(Array.from({length:8},(_,i)=>cyl(.065,.065,.09,6).translate(-.33+(i%4)*.22,.87,-.24+Math.floor(i/4)*.34)))}
    ]),
    pegboard_lower: P({group:'furniture',text:'Wall pegboard with hanging tools and shallow bins'},()=>[
        {slot:'frame',geometry:merge([box(1,1,.06,0,0,-.43),box(1,.06,.45,0,.05,-.22),box(1,.06,.35,0,.52,-.27)])},
        {slot:'chrome',geometry:merge(Array.from({length:5},(_,i)=>box(.035,.3,.07,-.36+i*.18,.64,-.34)))},
        {slot:'goods_c',geometry:merge(Array.from({length:4},(_,i)=>box(.14,.25,.22,-.34+i*.23,.12,-.16)))}
    ]),
    pegboard_upper: P({group:'furniture',text:'Pegboard head with hanging hardware'},()=>[
        {slot:'frame',geometry:merge([box(1,.9,.06,0,0,-.43),box(1,.05,.12,0,.85,-.4)])},
        {slot:'chrome',geometry:merge(Array.from({length:5},(_,i)=>box(.04,.4,.06,-.36+i*.18,.16,-.34)))}
    ]),
    warehouse_rack_lower: P({group:'furniture',text:'Open steel pallet racking with wide beams'},()=>[
        {slot:'iron',geometry:merge([...legs4(.98,.82,1,.07),box(1,.09,.84,0,.1),box(1,.09,.84,0,.9)])},
        {slot:'wood',geometry:merge([box(.9,.07,.7,0,.2),box(.9,.07,.7,0,.3)])},
        {slot:'goods_a',geometry:box(.65,.4,.6,0,.38)}
    ]),
    warehouse_rack_upper: P({group:'furniture',text:'Upper steel rack with bundled stock'},()=>[
        {slot:'iron',geometry:merge([...legs4(.98,.82,.95,.07),box(1,.09,.84,0,.85)])},
        {slot:'wood',geometry:box(.9,.07,.7,0,.03)},
        {slot:'goods_c',geometry:merge([box(.25,.54,.55,-.28,.1),box(.25,.54,.55,.03,.1),box(.25,.54,.55,.32,.1)])}
    ]),
    cooler_lower: P({ group: 'furniture', text: 'Glass-door drinks cooler' }, () => [
        { slot: 'self', geometry: merge([box(1, 1, 0.08, 0, 0, -0.4), box(0.05, 1, 0.8, -0.475), box(0.05, 1, 0.8, 0.475), box(1, 0.1, 0.8)]) },
        ...shelvesWithGoods(13, 0.6, [0.12, 0.55], false).map(p => ({ ...p, geometry: p.geometry.translate(0, 0, -0.1) })),
        { slot: 'glass', geometry: box(0.92, 0.9, 0.02, 0, 0.1, 0.38) }
    ]),
    cooler_upper: P({ group: 'furniture' }, () => [
        { slot: 'self', geometry: merge([box(1, 0.9, 0.08, 0, 0, -0.4), box(0.05, 0.9, 0.8, -0.475), box(0.05, 0.9, 0.8, 0.475), box(1, 0.16, 0.8, 0, 0.74)]) },
        ...shelvesWithGoods(17, 0.6, [0.0, 0.38], false).map(p => ({ ...p, geometry: p.geometry.translate(0, 0, -0.1) })),
        { slot: 'glass', geometry: box(0.92, 0.74, 0.02, 0, 0, 0.38) },
        { slot: 'lamp', geometry: box(0.9, 0.06, 0.04, 0, 0.8, 0.4) }
    ]),
    checkout: P({ group: 'furniture', text: 'Checkout counter with a belt' }, () => [
        { slot: 'lacquer', geometry: sb(1, 0.8, 0.7, 0.03) },
        { slot: 'screen', geometry: box(0.96, 0.03, 0.5, 0, 0.8, 0.04) },
        { slot: 'accent', geometry: box(1, 0.5, 0.02, 0, 0.12, 0.36) }
    ]),
    counter: P({ group: 'furniture', text: 'Service counter (diner, reception)' }, () => [
        { slot: 'accent', geometry: box(1, 0.86, 0.08, 0, 0, 0.3) },
        { slot: 'lacquer', geometry: box(1, 0.86, 0.6, 0, 0, -0.04) },
        { slot: 'worktop', geometry: box(1, 0.05, 0.84, 0, 0.86, 0.04) }
    ]),
    vanity: P({ group: 'furniture', text: 'Vanity unit with a basin and a mirror', overhang: true }, () => [
        { slot: 'wood', geometry: box(0.9, 0.5, 0.5, 0, 0.3, -0.24) },
        { slot: 'porcelain', geometry: merge([box(0.9, 0.06, 0.52, 0, 0.8, -0.23), sb(0.44, 0.1, 0.32, 0.04, 0, 0.86, -0.2)]) },
        { slot: 'chrome', geometry: merge([cyl(0.015, 0.015, 0.2, 6, 0, 0.86, -0.42), box(0.6, 0.6, 0.02, 0, 1.15, -0.49)]) }
    ]),
    pallet: P({ group: 'cover', text: 'Wrapped boxes on a pallet' }, () => [
        { slot: 'wood', geometry: merge([box(0.96, 0.03, 0.96, 0, 0.11), box(0.96, 0.03, 0.96), ...[-0.4, 0, 0.4].map(x => box(0.1, 0.08, 0.96, x, 0.03))]) },
        { slot: 'cardboard', geometry: merge([sb(0.44, 0.38, 0.9, 0.02, -0.23, 0.14), sb(0.44, 0.38, 0.9, 0.02, 0.23, 0.14), sb(0.44, 0.38, 0.44, 0.02, -0.23, 0.53, -0.23), sb(0.44, 0.38, 0.44, 0.02, 0.23, 0.53, 0.23), sb(0.44, 0.38, 0.44, 0.02, 0.23, 0.53, -0.23)]) }
    ]),
    pallet_top: P({ group: 'cover' }, () => [{ slot: 'cardboard', geometry: merge([sb(0.44, 0.34, 0.44, 0.02, -0.23, 0, -0.23), sb(0.44, 0.34, 0.44, 0.02, 0.23, 0, 0.23), sb(0.44, 0.34, 0.9, 0.02, -0.23, 0.36)]) }]),
    locker_lower: P({ group: 'furniture', text: 'Steel lockers' , overhang: true }, () => [
        { slot: 'self', geometry: box(0.98, 1, 0.5, 0, 0, -0.24) },
        { slot: 'frame', geometry: merge([box(0.006, 1, 0.01, 0, 0, 0.012), box(0.006, 1, 0.01, -0.33, 0, 0.012), box(0.006, 1, 0.01, 0.33, 0, 0.012), ...[-0.16, 0.16, 0.49, -0.49].map(x => box(0.12, 0.012, 0.012, x * 0.98, 0.84, 0.015))]) }
    ]),
    locker_upper: P({ group: 'furniture' }, () => [
        { slot: 'self', geometry: box(0.98, 0.86, 0.5, 0, 0, -0.24) },
        { slot: 'frame', geometry: merge([box(0.006, 0.86, 0.01, 0, 0, 0.012), box(0.006, 0.86, 0.01, -0.33, 0, 0.012), box(0.006, 0.86, 0.01, 0.33, 0, 0.012)]) }
    ])
};

// ----------------------------------------------------------------------------------------- outdoor props
const outdoor = {
    planter: P({ group: 'cover', text: 'Concrete planter trough with planting (+X run)' , overhang: true }, () => [
        { slot: 'self', geometry: sb(0.98, 0.62, 0.8, 0.05) },
        { slot: 'soil', geometry: box(0.88, 0.04, 0.7, 0, 0.58) },
        { slot: 'leaves', geometry: merge([blob(0.24, 1, 3, [1.2, 0.8, 1], 0.3).translate(-0.22, 0.74, 0), blob(0.22, 1, 8, [1, 1.1, 1], 0.3).translate(0.2, 0.76, 0.05)]) },
        { slot: 'flowers', geometry: merge([blob(0.07, 0, 2).translate(-0.05, 0.86, 0.2), blob(0.07, 0, 4).translate(0.32, 0.84, -0.18), blob(0.06, 0, 5).translate(-0.36, 0.82, -0.16)]) }
    ]),
    privacy_fence: P({ group: 'cover', text: 'Horizontal cedar slat fence with a post (+X run)' }, () => [
        { slot: 'post', geometry: box(0.1, 1, 0.1, -0.45) },
        { slot: 'self', geometry: merge(Array.from({ length: 6 }, (_, i) => box(1, 0.13, 0.05, 0, 0.02 + i * 0.165))) }
    ]),
    privacy_fence_top: P({ group: 'cover', text: 'Upper voxel of a tall fence, with a cap rail' }, () => [
        { slot: 'post', geometry: box(0.1, 0.86, 0.1, -0.45) },
        { slot: 'self', geometry: merge(Array.from({ length: 5 }, (_, i) => box(1, 0.13, 0.05, 0, 0.0 + i * 0.165))) },
        { slot: 'post', geometry: box(1, 0.05, 0.09, 0, 0.82) }
    ]),
    chainlink: P({ group: 'cover', text: 'Chain-link panel (see-through, bullets pass)' }, () => [
        { slot: 'iron', geometry: merge([cyl(0.03, 0.03, 1, 8, -0.47), box(1, 0.03, 0.03, 0, 0.05)]) },
        { slot: 'mesh', geometry: box(0.96, 0.95, 0.01, 0, 0.05) }
    ]),
    chainlink_top: P({ group: 'cover' }, () => [
        { slot: 'iron', geometry: merge([cyl(0.03, 0.03, 0.9, 8, -0.47), box(1, 0.035, 0.035, 0, 0.86)]) },
        { slot: 'mesh', geometry: box(0.96, 0.86, 0.01) }
    ]),
    jersey: P({ group: 'cover', text: 'Concrete jersey barrier (+X run)' }, () => [
        { slot: 'self', geometry: profileZ([[-0.32, 0], [0.32, 0], [0.3, 0.08], [0.12, 0.26], [0.08, 0.78], [-0.08, 0.78], [-0.12, 0.26], [-0.3, 0.08]], 0.98) }
    ]),
    bench: P({ group: 'cover', text: 'Park bench (back −Z)' }, () => [
        { slot: 'self', geometry: merge([...[0, 1, 2].map(i => box(1, 0.04, 0.12, 0, 0.42, -0.14 + i * 0.14)), ...[0, 1].map(i => box(1, 0.1, 0.035, 0, 0.56 + i * 0.16, -0.27).rotateX(-0.12))]) },
        { slot: 'iron', geometry: merge([box(0.05, 0.42, 0.5, -0.42, 0, -0.02), box(0.05, 0.42, 0.5, 0.42, 0, -0.02), box(0.05, 0.4, 0.05, -0.42, 0.42, -0.27), box(0.05, 0.4, 0.05, 0.42, 0.42, -0.27)]) }
    ]),
    bin: P({ group: 'cover', text: 'Wheelie bin' }, () => [
        { slot: 'self', geometry: sb(0.56, 0.86, 0.62, 0.05, 0, 0.06) },
        { slot: 'lid', geometry: merge([sb(0.6, 0.05, 0.68, 0.02, 0, 0.92), box(0.5, 0.05, 0.05, 0, 0.84, -0.33)]) },
        { slot: 'tyre', geometry: merge([disc(0.08, 0.06, 10, -0.24, 0.08, -0.26).rotateY(0), disc(0.08, 0.06, 10, 0.24, 0.08, -0.26)]).rotateY(Math.PI / 2).rotateY(-Math.PI / 2) }
    ]),
    pump: P({ group: 'cover', text: 'Fuel pump (explodes)' }, () => [
        { slot: 'plinth', geometry: sb(0.9, 0.12, 0.7, 0.03) },
        { slot: 'self', geometry: sb(0.62, 0.88, 0.42, 0.04, 0, 0.12) },
        { slot: 'screen', geometry: merge([box(0.36, 0.2, 0.02, 0, 0.66, 0.21), box(0.36, 0.2, 0.02, 0, 0.66, -0.21)]) },
        { slot: 'red', geometry: merge([box(0.64, 0.12, 0.44, 0, 0.88), box(0.12, 0.2, 0.08, 0.26, 0.4, 0.24)]) },
        { slot: 'tyre', geometry: new THREE.TorusGeometry(0.12, 0.012, 6, 12, Math.PI).translate(0.26, 0.4, 0.27) }
    ]),
    hedge: P({ group: 'foliage', text: 'Clipped box hedge (concealment, bullets pass)' }, () => [
        { slot: 'hedge', geometry: merge([sb(1.0, 0.8, 0.86, 0.14, 0, 0, 0, 2), blob(0.22, 1, 6, [1.6, 0.5, 1.1], 0.2).translate(0.05, 0.8, 0)]) }
    ]),
    shelf_unit: P({ group: 'furniture' }, () => [{ slot: 'frame', geometry: box(1, 1, 0.5) }]),
    hvac: P({ group: 'cover', text: 'Rooftop HVAC unit (half cover; +X along its long side)' }, () => [
        { slot: 'self', geometry: sb(0.96, 0.7, 0.86, 0.04) },
        { slot: 'frame', geometry: merge([...Array.from({ length: 6 }, (_, i) => box(0.9, 0.02, 0.012, 0, 0.12 + i * 0.09, 0.435)), box(0.98, 0.05, 0.88, 0, 0.7)]) },
        { slot: 'chrome', geometry: merge([cyl(0.3, 0.3, 0.04, 16, 0, 0.75), box(0.56, 0.015, 0.04, 0, 0.8), box(0.04, 0.015, 0.56, 0, 0.8)]) }
    ])
};

// ----------------------------------------------------------------------------------------- whole objects
function carBody() {
    // A compact hatch, 4 cells long (x ∈ [-2, 2]) and 2 wide (z ∈ [-1, 1]); front at +X.
    const lower = profileX([[-1.95, 0.22], [1.88, 0.22], [1.96, 0.36], [1.92, 0.62], [1.2, 0.74], [-1.6, 0.78], [-1.94, 0.72], [-1.98, 0.4]], 1.72, 0.06);
    const cabin = profileX([[-1.55, 0.74], [0.95, 0.74], [0.25, 1.3], [-1.25, 1.32], [-1.6, 1.0]], 1.5, 0.05);
    const wheels = [[-1.25, -0.8], [1.25, -0.8], [-1.25, 0.8], [1.25, 0.8]];
    return [
        { slot: 'carpaint', geometry: merge([lower, box(0.3, 0.04, 1.4, -0.55, 1.33)]) },
        { slot: 'glass_dark', geometry: cabin },
        { slot: 'tyre', geometry: merge(wheels.map(([x, z]) => disc(0.31, 0.22, 16, x, 0.31, z))) },
        { slot: 'chrome', geometry: merge(wheels.map(([x, z]) => disc(0.18, 0.24, 12, x, 0.31, z))) },
        { slot: 'frame', geometry: merge([box(0.12, 0.16, 1.7, 1.94, 0.2), box(0.12, 0.16, 1.7, -1.98, 0.22), box(3.4, 0.06, 0.04, 0, 0.27, 0.87), box(3.4, 0.06, 0.04, 0, 0.27, -0.87)]) },
        { slot: 'lamp', geometry: merge([box(0.05, 0.08, 0.3, 1.95, 0.52, 0.6), box(0.05, 0.08, 0.3, 1.95, 0.52, -0.6)]) },
        { slot: 'tail', geometry: merge([box(0.05, 0.1, 0.24, -1.97, 0.56, 0.66), box(0.05, 0.1, 0.24, -1.97, 0.56, -0.66)]) }
    ];
}
function container() {
    // 5 long (x ∈ [-2.5, 2.5]), 2 wide, 2 high; doors at +X.
    const ribs = [];
    for (let i = 0; i < 24; i++) ribs.push(box(0.08, 1.7, 0.04, -2.3 + i * 0.2, 0.12, 0.93), box(0.08, 1.7, 0.04, -2.3 + i * 0.2, 0.12, -0.93));
    return [
        { slot: 'self', geometry: merge([box(4.9, 1.84, 1.84, 0, 0.06), ...ribs, box(4.8, 0.08, 1.8, 0, 1.88)]) },
        { slot: 'frame', geometry: merge([...[[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([a, b]) => box(0.14, 1.96, 0.14, a * 2.39, 0, b * 0.9)), box(4.92, 0.08, 0.1, 0, 1.88, 0.92), box(4.92, 0.08, 0.1, 0, 1.88, -0.92), box(4.92, 0.12, 1.94)]) },
        { slot: 'chrome', geometry: merge([...[-0.6, -0.25, 0.25, 0.6].map(z => box(0.04, 1.6, 0.04, 2.47, 0.16, z))]) }
    ];
}
function dumpster() {
    // 2 long (x ∈ [-1, 1]), 1 wide.
    return [
        { slot: 'self', geometry: profileX([[-0.95, 0.12], [0.95, 0.12], [1.0, 0.86], [-1.0, 0.86]], 0.86, 0.03) },
        { slot: 'lid', geometry: merge([box(0.96, 0.05, 0.92, -0.49, 0.86).rotateX(0.04), box(0.96, 0.05, 0.92, 0.49, 0.86)]) },
        { slot: 'tyre', geometry: merge([[-0.8, -0.3], [0.8, -0.3], [-0.8, 0.3], [0.8, 0.3]].map(([x, z]) => disc(0.07, 0.05, 8, x, 0.07, z))) }
    ];
}
function treeRound(seed) {
    const r = rng(seed), blobs = [];
    for (let i = 0; i < 6; i++) {
        const a = r() * 6.28, d = 0.35 + r() * 0.45;
        blobs.push(blob(0.62 + r() * 0.3, 1, seed + i * 7, [1, 0.85, 1], 0.32).translate(Math.cos(a) * d, 3.1 + r() * 1.0, Math.sin(a) * d));
    }
    blobs.push(blob(0.85, 1, seed + 99, [1, 0.9, 1], 0.28).translate(0, 3.9, 0));
    return [
        { slot: 'bark', geometry: merge([cyl(0.1, 0.17, 2.8, 9), cyl(0.05, 0.08, 0.9, 6).rotateZ(0.6).translate(0.25, 2.1, 0), cyl(0.05, 0.08, 0.8, 6).rotateZ(-0.7).translate(-0.24, 2.3, 0.1)]) },
        { slot: 'leaves', geometry: merge(blobs) }
    ];
}
function treeConifer(seed) {
    const r = rng(seed), tiers = [];
    for (let i = 0; i < 5; i++) {
        const y = 0.9 + i * 0.85, rad = 1.05 - i * 0.18;
        tiers.push(new THREE.ConeGeometry(rad, 1.4, 9, 2).translate((r() - 0.5) * 0.08, y + 0.7, (r() - 0.5) * 0.08));
    }
    return [
        { slot: 'bark', geometry: cyl(0.08, 0.13, 1.6, 7) },
        { slot: 'needles', geometry: merge(tiers) }
    ];
}

// Tree species (PLAN-06 follow-up): organic crowns built from overlapping noisy blobs, each species with its own
// silhouette so streets, yards and parks do not repeat one shape. Gameplay canopies match these footprints.
function treeOak(seed) {
    const r = rng(seed), blobs = [];
    for (let i = 0; i < 11; i++) {
        const a = r() * 6.28, d = 0.45 + r() * 0.95;
        blobs.push(blob(0.6 + r() * 0.35, 1, seed + i * 11, [1, 0.72, 1], 0.36).translate(Math.cos(a) * d, 2.7 + r() * 0.9, Math.sin(a) * d));
    }
    blobs.push(blob(1.0, 1, seed + 77, [1.1, 0.7, 1.1], 0.3).translate(0, 3.5, 0));
    const bark = [cyl(0.15, 0.27, 2.4, 10)];
    for (let i = 0; i < 4; i++) { const a = i * 1.57 + r(); bark.push(cyl(0.05, 0.1, 1.2, 6).rotateZ(0.9).rotateY(a).translate(Math.cos(a) * 0.2, 1.9, Math.sin(a) * 0.2)); }
    return [{ slot: 'bark', geometry: merge(bark) }, { slot: 'leaves', geometry: merge(blobs) }];
}
function treeBirch(seed) {
    const r = rng(seed), blobs = [];
    for (let i = 0; i < 7; i++) blobs.push(blob(0.36 + r() * 0.2, 1, seed + i * 5, [1, 1.25, 1], 0.4).translate((r() - 0.5) * 0.6, 3.1 + i * 0.36, (r() - 0.5) * 0.6));
    return [{ slot: 'bark', geometry: merge([cyl(0.05, 0.09, 4.4, 8), cyl(0.03, 0.05, 1.1, 5).rotateZ(-0.5).translate(0.2, 2.6, 0)]) }, { slot: 'leaves', geometry: merge(blobs) }];
}
function treeOrnamental(seed) {
    const r = rng(seed), blobs = [blob(0.78, 1, seed, [1, 0.9, 1], 0.24).translate(0, 2.55, 0)];
    for (let i = 0; i < 4; i++) { const a = i * 1.57 + r() * 0.6; blobs.push(blob(0.4 + r() * 0.15, 1, seed + i * 3, [1, 0.9, 1], 0.3).translate(Math.cos(a) * 0.45, 2.35 + r() * 0.5, Math.sin(a) * 0.45)); }
    return [{ slot: 'bark', geometry: cyl(0.06, 0.1, 2.1, 8) }, { slot: 'leaves', geometry: merge(blobs) }];
}
function treeCypress(seed) {
    const r = rng(seed), blobs = [];
    for (let i = 0; i < 8; i++) blobs.push(blob(0.62 - i * 0.055, 1, seed + i * 9, [1, 1.35, 1], 0.22).translate((r() - 0.5) * 0.12, 1.3 + i * 0.6, (r() - 0.5) * 0.12));
    return [{ slot: 'bark', geometry: cyl(0.07, 0.12, 1.4, 7) }, { slot: 'needles', geometry: merge(blobs) }];
}

const objects = {
    car: P({ group: 'vehicle', text: 'Parked car, whole object (4 × 2 cells, front +X)', footprint: [4, 2], overhang: true }, () => carBody()),
    container: P({ group: 'vehicle', text: 'Shipping container (5 × 2 × 2 cells)', footprint: [5, 2], overhang: true }, () => container()),
    dumpster: P({ group: 'cover', text: 'Dumpster (2 × 1 cells)', footprint: [2, 1], overhang: true }, () => dumpster()),
    wreck: P({ group: 'vehicle', text: 'Burnt-out wreck fragment (a damaged vehicle cell)' }, () => [{ slot: 'wreck', geometry: merge([sb(0.94, 0.6, 0.9, 0.08, 0, 0.12), blob(0.2, 0, 3).translate(0.2, 0.75, 0.1)]) }]),
    tree_round: P({ group: 'foliage', text: 'Deciduous street tree (whole object)', overhang: true }, () => treeRound(17)),
    tree_conifer: P({ group: 'foliage', text: 'Conifer (whole object)', overhang: true }, () => treeConifer(29)),
    tree_oak: P({ group: 'foliage', text: 'Broad oak, wide low crown (whole object)', overhang: true }, () => treeOak(41)),
    tree_birch: P({ group: 'foliage', text: 'Birch, slender trunk and tall oval crown (whole object)', overhang: true }, () => treeBirch(53)),
    tree_ornamental: P({ group: 'foliage', text: 'Ornamental street tree, compact round head (whole object)', overhang: true }, () => treeOrnamental(61)),
    tree_cypress: P({ group: 'foliage', text: 'Columnar cypress (whole object)', overhang: true }, () => treeCypress(67))
};

// ----------------------------------------------------------------------------------------- decor (visual only)
const decor = {
    checkpoint_sign: P({group:'decor',text:'Checkpoint sign; visual only'}, () => [
        {slot:'iron',geometry:merge([box(.04,.9,.04,-.3),box(.04,.9,.04,.3)])},
        {slot:'canvas_white',geometry:box(.8,.3,.04,0,.6)},
        {slot:'red',geometry:box(.72,.05,.045,0,.72)}]),
    rooftop_vent: P({group:'decor',text:'Roof exhaust; visual only'}, () => [
        {slot:'frame',geometry:merge([box(.7,.12,.7),box(.4,.45,.4,0,.12),box(.6,.06,.6,0,.57)])}]),
    cable_spool: P({group:'decor',text:'Cable spool dressing; visual only'}, () => [
        {slot:'wood',geometry:merge([cyl(.36,.36,.06,12),cyl(.36,.36,.06,12,0,.6)])},
        {slot:'self_dark',geometry:cyl(.23,.23,.54,12,0,.06)}]),

    rug: P({ group: 'decor', text: 'Rug, 1 × 1 (scaled per instance)' }, () => [{ slot: 'rug', geometry: sb(1, 0.02, 1, 0.008, 0, 0.001) }]),
    coffee_table: P({ group: 'decor' }, () => [{ slot: 'wood', geometry: sb(0.9, 0.05, 0.5, 0.02, 0, 0.32) }, { slot: 'frame', geometry: merge(legs4(0.82, 0.42, 0.32, 0.03)) }]),
    floor_lamp: P({ group: 'decor', light: true }, () => [{ slot: 'frame', geometry: merge([cyl(0.12, 0.14, 0.03, 12), cyl(0.012, 0.012, 1.45, 6)]) }, { slot: 'shade', geometry: cyl(0.12, 0.17, 0.24, 14, 0, 1.4) }]),
    plant: P({ group: 'decor' }, () => [{ slot: 'pot', geometry: cyl(0.16, 0.12, 0.32, 12) }, { slot: 'leaves', geometry: merge([blob(0.24, 1, 11, [1, 1.2, 1], 0.35).translate(0, 0.55, 0)]) }]),
    plant_tall: P({ group: 'decor' }, () => [{ slot: 'pot', geometry: cyl(0.17, 0.13, 0.36, 12) }, { slot: 'bark', geometry: cyl(0.02, 0.025, 0.9, 5, 0, 0.3) }, { slot: 'leaves', geometry: merge([blob(0.26, 1, 21, [1, 1.3, 1], 0.4).translate(0, 1.25, 0), blob(0.18, 1, 23).translate(0.12, 0.95, 0.06)]) }]),
    tv: P({ group: 'decor' }, () => [{ slot: 'screen', geometry: box(0.95, 0.55, 0.04, 0, 0.1, -0.15) }, { slot: 'frame', geometry: merge([box(0.3, 0.02, 0.16, 0, 0, -0.15), box(0.05, 0.1, 0.03, 0, 0, -0.15)]) }]),
    wall_art: P({ group: 'decor', text: 'Framed print on a wall (+Z faces the room)' }, () => [{ slot: 'frame', geometry: box(0.7, 0.5, 0.03, 0, 0.2, -0.04) }, { slot: 'canvas', geometry: box(0.6, 0.4, 0.035, 0, 0.25, -0.03) }]),
    stool: P({ group: 'decor' }, () => [{ slot: 'self_dark', geometry: cyl(0.16, 0.16, 0.05, 12, 0, 0.62) }, { slot: 'chrome', geometry: merge([cyl(0.02, 0.02, 0.62, 6), cyl(0.15, 0.15, 0.02, 12)]) }]),
    nightstand: P({ group: 'decor', light: true }, () => [{ slot: 'wood', geometry: sb(0.42, 0.45, 0.38, 0.02, 0, 0.02, -0.25) }, { slot: 'shade', geometry: cyl(0.07, 0.1, 0.14, 10, 0, 0.62, -0.25) }, { slot: 'frame', geometry: cyl(0.01, 0.01, 0.16, 5, 0, 0.47, -0.25) }]),
    office_chair: P({ group: 'decor' }, () => [{ slot: 'self_dark', geometry: merge([sb(0.44, 0.08, 0.42, 0.03, 0, 0.42), sb(0.42, 0.45, 0.06, 0.03, 0, 0.5, 0.22)]) }, { slot: 'chrome', geometry: merge([cyl(0.025, 0.025, 0.4, 6, 0, 0.02), ...[0, 1, 2, 3, 4].map(i => box(0.03, 0.03, 0.28, 0, 0.03, 0.14).rotateY(i * 1.256))]) }]),
    monitor: P({ group: 'decor' }, () => [{ slot: 'screen', geometry: box(0.5, 0.3, 0.025, 0, 0.12, -0.15) }, { slot: 'frame', geometry: merge([box(0.18, 0.015, 0.12, 0, 0, -0.15), box(0.03, 0.14, 0.02, 0, 0, -0.17)]) }]),
    toilet: P({ group: 'decor' }, () => [{ slot: 'porcelain', geometry: merge([sb(0.36, 0.4, 0.44, 0.1, 0, 0, 0.0), sb(0.36, 0.34, 0.14, 0.03, 0, 0.36, -0.22)]) }]),
    shower: P({ group: 'decor' }, () => [{ slot: 'porcelain', geometry: box(0.86, 0.06, 0.86) }, { slot: 'glass', geometry: merge([box(0.86, 1.7, 0.015, 0, 0.06, 0.42), box(0.015, 1.7, 0.86, 0.42, 0.06, 0)]) }, { slot: 'chrome', geometry: merge([cyl(0.012, 0.012, 1.6, 5, -0.38, 0.1, -0.4), cyl(0.08, 0.08, 0.015, 10, -0.3, 1.66, -0.38)]) }]),
    cafe_table: P({ group: 'decor' }, () => [{ slot: 'worktop', geometry: cyl(0.32, 0.32, 0.04, 16, 0, 0.7) }, { slot: 'chrome', geometry: merge([cyl(0.025, 0.025, 0.7, 6), cyl(0.18, 0.2, 0.02, 12)]) }]),
    register: P({ group: 'decor' }, () => [{ slot: 'screen', geometry: merge([box(0.3, 0.12, 0.26, 0, 0, -0.1), box(0.26, 0.18, 0.02, 0, 0.12, -0.18)]) }]),
    streetlight: P({ group:'decor', light:true, text:'Curb-mounted LED road lantern; tapered mast, swept arm toward +Z' },()=>[
        {slot:'iron',geometry:merge([
            cyl(.047,.075,3.45,12),cyl(.13,.16,.18,12),box(.12,.25,.11,0,.18,0),
            new THREE.TubeGeometry(new THREE.CatmullRomCurve3([new THREE.Vector3(0,3.18,0),new THREE.Vector3(0,3.43,.18),new THREE.Vector3(0,3.52,.65),new THREE.Vector3(0,3.48,1.06)]),10,.038,6,false),
            sb(.25,.075,.46,.025,0,3.42,1.06)
        ])},
        {slot:'lamp',geometry:sb(.19,.018,.34,.009,0,3.409,1.09)}
    ]),
    floodlight: P({ group: 'decor', light: true }, () => [{ slot: 'iron', geometry: merge([cyl(0.06, 0.09, 4.4, 8), box(0.9, 0.06, 0.06, 0, 4.4, 0)]) }, { slot: 'lamp', geometry: merge([box(0.24, 0.2, 0.08, -0.32, 4.25, 0.06).rotateX(-0.3), box(0.24, 0.2, 0.08, 0.32, 4.25, 0.06).rotateX(-0.3)]) }]),
    mailbox: P({ group: 'decor' }, () => [{ slot: 'frame', geometry: box(0.06, 0.9, 0.06) }, { slot: 'self_dark', geometry: sb(0.22, 0.26, 0.4, 0.06, 0, 0.9) }]),
    hydrant: P({ group: 'decor' }, () => [{ slot: 'red', geometry: merge([cyl(0.1, 0.12, 0.5, 10), new THREE.SphereGeometry(0.1, 10, 6).translate(0, 0.5, 0), disc(0.05, 0.36, 8, 0, 0.32, 0).rotateY(Math.PI / 2)]) }]),
    flowers: P({ group: 'decor' }, () => [{ slot: 'leaves', geometry: blob(0.22, 1, 31, [1.4, 0.5, 1.4], 0.4).translate(0, 0.1, 0) }, { slot: 'flowers', geometry: merge([0, 1, 2, 3, 4].map(i => blob(0.05, 0, i + 3).translate(Math.cos(i * 1.3) * 0.2, 0.22, Math.sin(i * 1.3) * 0.2))) }]),
    shrub: P({ group: 'decor' }, () => [{ slot: 'hedge', geometry: blob(0.42, 1, 37, [1.2, 0.9, 1.1], 0.3).translate(0, 0.32, 0) }]),
    patio_set: P({ group: 'decor', text: 'Outdoor table with four chairs' }, () => [
        { slot: 'wood', geometry: merge([box(1.2, 0.05, 0.75, 0, 0.7), ...legs4(1.1, 0.65, 0.7, 0.05)]) },
        { slot: 'frame', geometry: merge([[-0.35, 0.62], [0.35, 0.62], [-0.35, -0.62], [0.35, -0.62]].flatMap(([x, z]) => [box(0.4, 0.04, 0.38, x, 0.42, z), box(0.4, 0.42, 0.04, x, 0.44, z + Math.sign(z) * 0.18), ...legs4(0.36, 0.34, 0.42, 0.025).map(g => g.translate(x, 0, z))])) }
    ]),
    umbrella: P({ group: 'decor' }, () => [{ slot: 'chrome', geometry: cyl(0.02, 0.02, 2.1, 6) }, { slot: 'canvas_white', geometry: new THREE.ConeGeometry(1.1, 0.35, 8, 1, true).translate(0, 2.1, 0) }]),
    drain: P({ group: 'decor' }, () => [{ slot: 'frame', geometry: box(0.5, 0.012, 0.32, 0, 0.002) }]),
    bollard: P({ group: 'decor' }, () => [{ slot: 'iron', geometry: merge([cyl(0.14, 0.18, 0.5, 10), cyl(0.2, 0.2, 0.06, 10, 0, 0.5)]) }]),
    bus_stop: P({ group: 'decor', text: 'Bus shelter (glass panels, roof, bench)', overhang: true }, () => [
        { slot: 'iron', geometry: merge([box(0.06, 2.2, 0.06, -1.4, 0, -0.5), box(0.06, 2.2, 0.06, 1.4, 0, -0.5), box(0.06, 2.2, 0.06, -1.4, 0, 0.4), box(0.06, 2.2, 0.06, 1.4, 0, 0.4)]) },
        { slot: 'glass', geometry: merge([box(2.8, 1.8, 0.02, 0, 0.2, -0.5), box(0.02, 1.8, 0.9, -1.4, 0.2, -0.05)]) },
        { slot: 'frame', geometry: merge([box(3.0, 0.08, 1.2, 0, 2.2), box(2.2, 0.05, 0.36, 0, 0.45, -0.3)]) }
    ]),
    gate_sign: P({ group: 'decor' }, () => [{ slot: 'iron', geometry: merge([box(0.06, 1.9, 0.06, -0.5), box(0.06, 1.9, 0.06, 0.5)]) }, { slot: 'canvas_white', geometry: box(1.1, 0.5, 0.03, 0, 1.4) }]),
    crane_leg: P({ group: 'decor', overhang: true }, () => [{ slot: 'steel_yellow', geometry: merge([box(0.4, 6, 0.4), box(0.3, 0.3, 3.2, 0, 5.8, 1.4), box(0.08, 4.2, 0.08, 0, 1.2, 1.2).rotateX(0.6)]) }]),
    price_sign: P({ group: 'decor', light: true }, () => [{ slot: 'iron', geometry: merge([box(0.12, 3.2, 0.12, -0.5), box(0.12, 3.2, 0.12, 0.5)]) }, { slot: 'canvas_white', geometry: box(1.4, 1.1, 0.12, 0, 2.6) }, { slot: 'lamp', geometry: box(1.2, 0.3, 0.13, 0, 2.7) }]),
    air_pump: P({ group: 'decor' }, () => [{ slot: 'red', geometry: sb(0.3, 1.1, 0.24, 0.04) }]),
    motel_sign: P({ group: 'decor', light: true }, () => [{ slot: 'iron', geometry: box(0.16, 4, 0.16) }, { slot: 'red', geometry: sb(1.6, 1.0, 0.18, 0.06, 0, 3.6) }, { slot: 'lamp', geometry: box(1.3, 0.25, 0.2, 0, 3.95) }]),
    canopy: P({ group: 'decor', text: 'Forecourt canopy roof, 1 × 1 (scaled per instance; carried by steel columns)' }, () => [
        { slot: 'lacquer', geometry: box(1, 0.36, 1, 0, 0.04) },
        { slot: 'red', geometry: box(1.004, 0.12, 1.004, 0, 0.18) },
        { slot: 'lamp', geometry: box(0.7, 0.02, 0.7, 0, 0.02) }
    ]),
    stepping: P({ group: 'decor' }, () => [{ slot: 'plinth', geometry: sb(0.5, 0.03, 0.4, 0.01, 0, 0.0) }]),
    // PLAN-04 dressing: story-beat props, clutter, world-edge cordons and facade details.
    cash_stack: P({ group: 'decor', text: 'Bundled cash on a table (story beat)' }, () => [{ slot: 'flowers', geometry: merge([box(0.18, 0.06, 0.1, -0.12, 0, -0.1), box(0.18, 0.06, 0.1, 0.1, 0, -0.06), box(0.18, 0.06, 0.1, -0.02, 0.06, -0.1)]) }]),
    rifle_rack: P({ group: 'decor', text: 'Rifles laid on a crate (arms cache beat)' }, () => [{ slot: 'iron', geometry: merge([box(0.8, 0.04, 0.08, 0, 0.02, -0.12), box(0.8, 0.04, 0.08, 0, 0.02, 0.06), box(0.12, 0.08, 0.1, 0.36, 0.02, -0.12), box(0.12, 0.08, 0.1, 0.36, 0.02, 0.06)]) }]),
    papers: P({ group: 'decor', text: 'Scattered papers (clutter noise)' }, () => [{ slot: 'canvas_white', geometry: merge([box(0.22, 0.004, 0.3, -0.15, 0.002, 0.1).rotateY(0.4), box(0.22, 0.004, 0.3, 0.12, 0.002, -0.12).rotateY(-0.7), box(0.22, 0.004, 0.3, 0.05, 0.006, 0.18).rotateY(1.2)]) }]),
    debris: P({ group: 'decor', text: 'Broken furniture and plaster (ransacked room)' }, () => [{ slot: 'wood', geometry: merge([box(0.5, 0.05, 0.08, -0.05, 0.02, 0).rotateY(0.6), box(0.36, 0.05, 0.08, 0.12, 0.05, 0.1).rotateY(-0.9)]) }, { slot: 'plinth', geometry: merge([blob(0.09, 0, 41).translate(0.2, 0.04, -0.2), blob(0.07, 0, 43).translate(-0.25, 0.03, 0.22)]) }]),
    cordon: P({ group: 'decor', text: 'Police sawhorse barrier at a closed road (world edge)' }, () => [{ slot: 'iron', geometry: merge([box(0.04, 0.9, 0.3, -0.42, 0, 0), box(0.04, 0.9, 0.3, 0.42, 0, 0)]) }, { slot: 'red', geometry: merge([box(1, 0.16, 0.04, 0, 0.62, 0.02), box(1, 0.12, 0.04, 0, 0.34, 0.02)]) }, { slot: 'lamp', geometry: box(0.1, 0.08, 0.1, -0.42, 0.92, 0) }]),
    wall_sign: P({ group: 'decor', light: true, text: 'Shop or street sign on a facade (+Z faces out); the board takes the building accent' }, () => [{ slot: 'canvas_white', geometry: sb(0.9, 0.36, 0.08, 0.02, 0, 0.3, 0) }, { slot: 'lamp', geometry: box(0.8, 0.06, 0.02, 0, 0.62, 0.045) }]),
    wall_vent: P({ group: 'decor', text: 'Louvred wall vent (+Z faces out)' }, () => [{ slot: 'frame', geometry: merge([box(0.5, 0.4, 0.04, 0, 0.2, 0), ...[0, 1, 2, 3].map(i => box(0.44, 0.03, 0.05, 0, 0.27 + i * 0.08, 0.02).rotateX(0.5))]) }])
};

const circulation={
    escape_rail:P({group:'circulation'},()=>[{slot:'self',geometry:merge([
        box(.045,.9,.045,-.47,0,.47),box(.045,.9,.045,.47,0,.47),
        box(.98,.045,.045,0,.87,.47),box(.98,.035,.045,0,.42,.47)
    ])}]),
    steel_post:P({group:'circulation'},()=>[{slot:'self',geometry:box(.15,1,.15)}]),
    grate:P({group:'circulation'},()=>[{slot:'self',geometry:merge([box(1,.1,.08,0,.9,-.45),box(1,.1,.08,0,.9,.45),...Array.from({length:7},(_,i)=>box(.035,.055,1,-.45+i*.15,.945,0))])}]),
};
const tacticalFurniture = {
    aid_station: P({group:'furniture',text:'Aid supply cabinet; destructible half cover'}, () => [
        {slot:'canvas_white',geometry:sb(.9,.85,.62,.025)},
        {slot:'red',geometry:merge([box(.28,.07,.02,0,.49,.32),box(.07,.28,.02,0,.385,.32)])},
        {slot:'frame',geometry:box(.92,.04,.64,0,.85)}]),
    tool_chest: P({group:'furniture',text:'Workshop drawers; destructible half cover'}, () => [
        {slot:'red',geometry:sb(.86,.78,.64,.02,0,.08)},
        {slot:'chrome',geometry:merge([.22,.4,.58,.76].map(y=>box(.6,.025,.025,0,y,.335)))},
        {slot:'frame',geometry:box(.9,.05,.68,0,.86)}]),
    server_lower: P({group:'furniture',text:'Server rack base; appliance collision'}, () => [
        {slot:'frame',geometry:sb(.78,1,.7,.02)},
        {slot:'screen',geometry:merge([.15,.4,.65,.9].map(y=>box(.62,.14,.02,0,y-.07,.36)))}]),
    server_upper: P({group:'furniture',text:'Server rack top; appliance collision'}, () => [
        {slot:'frame',geometry:sb(.78,1,.7,.02)},
        {slot:'screen',geometry:merge([.15,.4,.65,.9].map(y=>box(.62,.14,.02,0,y-.07,.36)))},
        {slot:'lamp',geometry:merge([.15,.4,.65,.9].map(y=>box(.03,.025,.025,.24,y,.375)))}]),
};
export const MODERN_PIECES = { ...TRAFFIC_PIECES, ...STREET_PROP_PIECES, ...tacticalFurniture, ...circulation, ...wallTrims, ...furniture, ...outdoor, ...objects, ...decor };
/** Pieces allowed to leave their cell (whole objects, tall decor, wall cupboards). */
export const MODERN_OVERHANG = new Set(Object.entries(MODERN_PIECES).filter(([, p]) => p.meta.overhang || p.meta.group === 'decor').map(([id]) => id));
/** Decor kinds that carry a light (LanternLights can follow them). */
export const DECOR_LIGHTS = new Set(Object.entries(decor).filter(([, p]) => p.meta.light).map(([id]) => id));
