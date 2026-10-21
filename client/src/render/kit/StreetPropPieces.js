// Real-street props (geo import maps, usable by any map). Same contract as ModernPieces: one cell ≈ 0.9 m, pivot at the
// cell-floor centre, FRONT is +Z (the side facing the street / the viewer), multi-cell objects authored around their
// footprint centre. Low-poly and rounded where it reads; slots come from KitLibrary.SLOTS.
//
//   traffic_signal     mast-arm signal: pole on the corner, arm out over the road along +Z, three signal heads
//   signal_post        pedestal signal with a pedestrian head (median islands, narrow corners)
//   stop_sign          octagonal stop sign on a post
//   street_sign        twin street-name blades on a post (an intersection corner)
//   utility_pole       wooden pole with a crossarm, insulators and a transformer can
//   storefront_awning  fabric awning over a shop front, projecting toward +Z (1 cell; runs repeat it)
//   shopping_cart      a cart left in a lot
//   cart_corral        3-cell pipe-rail cart return with a sign (half cover; solid voxels under it)
//   plaza_sign         shopping-centre pylon sign with tenant panels (tall, overhangs its cell)
import * as THREE from 'three';
import { box, softBox, merge, cyl, disc } from './Geo.js';

const P = (meta, build) => ({ meta, build });
const sb = (w, h, d, r, x = 0, y = 0, z = 0, seg = 1) => softBox(w, h, d, r, seg).translate(x, y + h / 2, z);
// a three-lamp signal head facing +Z, its box centred at (x, y, z)
const head = (x, y, z) => ({
    body: sb(0.3, 0.9, 0.24, 0.04, x, y - 0.45, z),
    visor: merge([0.28, 0, -0.28].map(o => box(0.26, 0.03, 0.16, x, y + o + 0.1, z + 0.18))),
    lamps: [0.28, 0, -0.28].map(o => disc(0.09, 0.03, 12, x, y + o, z + 0.13))
});
const octagon = (r, t) => { const s = new THREE.Shape(); for (let i = 0; i < 8; i++) { const a = Math.PI / 8 + i * Math.PI / 4; i ? s.lineTo(Math.cos(a) * r, Math.sin(a) * r) : s.moveTo(Math.cos(a) * r, Math.sin(a) * r); } return new THREE.ExtrudeGeometry(s, { depth: t, bevelEnabled: false }); };

export const STREET_PROP_PIECES = {
    traffic_signal: P({ group: 'decor', overhang: true, text: 'Mast-arm traffic signal: corner pole, arm over the road toward +Z, three heads; visual only' }, () => {
        const heads = [1.6, 3.0, 4.4].map(z => head(0, 5.4, z));
        return [
            { slot: 'post', geometry: merge([cyl(0.13, 0.17, 5.9, 12), cyl(0.3, 0.3, 0.12, 12), box(0.14, 0.14, 4.8, 0, 5.75, 2.35), box(0.05, 0.6, 0.05, 0, 5.2, 0.4).rotateX(-0.6)]) },
            { slot: 'self_dark', geometry: merge([...heads.map(h => h.body), ...heads.map(h => h.visor), box(0.25, 0.35, 0.18, 0.18, 2.6, 0.1)]) },
            { slot: 'red', geometry: merge(heads.map(h => h.lamps[0])) },
            { slot: 'steel_yellow', geometry: merge(heads.map(h => h.lamps[1])) },
            { slot: 'glow', geometry: merge(heads.map(h => h.lamps[2])) },
            { slot: 'canvas_white', geometry: box(1.1, 0.28, 0.04, 0, 5.85, 3.7) }
        ];
    }),
    signal_post: P({ group: 'decor', overhang: true, text: 'Pedestal signal with a pedestrian head; visual only' }, () => {
        const h = head(0, 3.1, 0.14);
        return [
            { slot: 'post', geometry: merge([cyl(0.08, 0.1, 3.3, 10), cyl(0.2, 0.2, 0.1, 10)]) },
            { slot: 'self_dark', geometry: merge([h.body, h.visor, sb(0.3, 0.32, 0.2, 0.03, 0, 1.6, 0.13), box(0.16, 0.2, 0.12, -0.12, 1.05, 0.08)]) },
            { slot: 'red', geometry: h.lamps[0] }, { slot: 'steel_yellow', geometry: h.lamps[1] }, { slot: 'glow', geometry: h.lamps[2] },
            { slot: 'lamp', geometry: box(0.22, 0.2, 0.02, 0, 1.66, 0.24) }
        ];
    }),
    stop_sign: P({ group: 'decor', overhang: true, text: 'Stop sign on a post (face toward +Z); visual only' }, () => [
        { slot: 'post', geometry: box(0.06, 2.2, 0.06) },
        { slot: 'red', geometry: octagon(0.33, 0.03).translate(0, 2.25, 0.05) },
        { slot: 'canvas_white', geometry: octagon(0.37, 0.025).translate(0, 2.25, 0.03) }
    ]),
    street_sign: P({ group: 'decor', overhang: true, text: 'Corner post with two street-name blades (along X and along Z); visual only' }, () => [
        { slot: 'post', geometry: merge([box(0.06, 2.9, 0.06), box(0.12, 0.08, 0.12, 0, 2.9)]) },
        { slot: 'accent', geometry: merge([box(1.25, 0.2, 0.03, 0.55, 2.62), box(0.03, 0.2, 1.25, 0, 2.38, 0.55)]) },
        { slot: 'canvas_white', geometry: merge([box(1.1, 0.05, 0.035, 0.55, 2.69), box(0.035, 0.05, 1.1, 0, 2.45, 0.55)]) }
    ]),
    utility_pole: P({ group: 'decor', overhang: true, text: 'Wooden utility pole: crossarm, insulators, transformer can; visual only' }, () => [
        { slot: 'wood', geometry: merge([cyl(0.13, 0.17, 9, 10), box(2.2, 0.12, 0.12, 0, 8.2), box(0.06, 0.06, 0.9, 0.55, 7.7, 0).rotateX(0.0)]) },
        { slot: 'porcelain', geometry: merge([-0.95, -0.4, 0.4, 0.95].map(x => cyl(0.05, 0.06, 0.16, 8, x, 8.32))) },
        { slot: 'iron', geometry: merge([cyl(0.28, 0.28, 0.8, 12, 0.32, 6.6), box(0.1, 0.4, 0.1, 0.16, 6.9)]) },
        { slot: 'self_dark', geometry: merge([box(0.03, 3.2, 0.03, 0.05, 0.1, 0.14)]) }
    ]),
    storefront_awning: P({ group: 'decor', overhang: true, text: 'Fabric shop awning projecting 1 cell toward +Z (place one per front cell); visual only' }, () => {
        const sloped = box(1, 0.04, 1.05, 0, 0, 0.52).rotateX(0.32).translate(0, 2.25, 0.05);
        return [
            { slot: 'canvas', geometry: merge([sloped, box(1, 0.24, 0.03, 0, 1.85, 1.0)]) },
            { slot: 'iron', geometry: merge([box(1, 0.04, 0.04, 0, 2.48, -0.45), box(0.03, 0.03, 1.0, -0.47, 2.15, 0.5).rotateX(0.32), box(0.03, 0.03, 1.0, 0.47, 2.15, 0.5).rotateX(0.32)]) }
        ];
    }),
    shopping_cart: P({ group: 'decor', text: 'Shopping cart (handle toward −Z); visual only' }, () => [
        { slot: 'chrome', geometry: merge([box(0.48, 0.34, 0.03, 0, 0.42, 0.3), box(0.48, 0.34, 0.03, 0, 0.42, -0.3), box(0.03, 0.34, 0.6, -0.24, 0.42), box(0.03, 0.34, 0.6, 0.24, 0.42), box(0.48, 0.02, 0.6, 0, 0.42), box(0.5, 0.03, 0.03, 0, 0.9, -0.42), box(0.03, 0.42, 0.03, -0.22, 0.12, 0.25), box(0.03, 0.42, 0.03, 0.22, 0.12, 0.25), box(0.03, 0.55, 0.03, -0.22, 0.12, -0.3), box(0.03, 0.55, 0.03, 0.22, 0.12, -0.3)]) },
        { slot: 'red', geometry: box(0.5, 0.04, 0.05, 0, 0.92, -0.42) },
        { slot: 'tyre', geometry: merge([[-0.2, 0.25], [0.2, 0.25], [-0.2, -0.3], [0.2, -0.3]].map(([x, z]) => disc(0.06, 0.04, 8, x, 0.06, z).rotateY(Math.PI / 2))) }
    ]),
    cart_corral: P({ group: 'street-cover', overhang: true, footprint: [3, 1], text: 'Cart return: pipe rails over 3 cells with a sign (concealment; rounds pass the rails)' }, () => [
        { slot: 'chrome', geometry: merge([...[-1.35, 1.35].flatMap(x => [box(0.06, 0.95, 0.06, x, 0, -0.38), box(0.06, 0.95, 0.06, x, 0, 0.38)]), box(2.8, 0.06, 0.06, 0, 0.92, -0.38), box(2.8, 0.06, 0.06, 0, 0.92, 0.38), box(2.8, 0.05, 0.05, 0, 0.45, -0.38), box(2.8, 0.05, 0.05, 0, 0.45, 0.38), box(0.06, 0.06, 0.82, -1.35, 0.92), box(0.06, 0.06, 0.82, 1.35, 0.92)]) },
        { slot: 'red', geometry: box(0.7, 0.4, 0.04, 1.35, 1.05, 0) },
        { slot: 'canvas_white', geometry: box(0.5, 0.08, 0.045, 1.35, 1.2, 0) }
    ]),
    plaza_sign: P({ group: 'decor', overhang: true, text: 'Shopping-centre pylon sign with tenant panels (faces ±Z); visual only' }, () => [
        { slot: 'self_dark', geometry: merge([sb(0.5, 6.2, 0.5, 0.06, -0.85), sb(0.5, 6.2, 0.5, 0.06, 0.85)]) },
        { slot: 'frame', geometry: merge([sb(2.4, 0.5, 0.6, 0.05, 0, 6.2), sb(2.3, 0.3, 0.45, 0.04, 0, 0.0)]) },
        { slot: 'red', geometry: box(2.0, 0.9, 0.42, 0, 5.15) },
        { slot: 'canvas_white', geometry: merge([box(2.0, 0.6, 0.42, 0, 4.4), box(2.0, 0.6, 0.42, 0, 3.7), box(2.0, 0.6, 0.42, 0, 3.0)]) },
        { slot: 'accent', geometry: merge([box(2.02, 0.05, 0.44, 0, 4.35), box(2.02, 0.05, 0.44, 0, 3.65), box(2.02, 0.05, 0.44, 0, 2.95)]) },
        { slot: 'lamp', geometry: box(1.7, 0.12, 0.44, 0, 5.75) }
    ])
};
export const STREET_PROP_TALL = Object.freeze(['traffic_signal', 'signal_post', 'utility_pole', 'plaza_sign', 'street_sign', 'stop_sign', 'storefront_awning']);
