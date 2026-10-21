// Review slate for a built map: top material colour × hill shade × height lift, as a binary PPM (any image tool reads it).
import { materialById } from '../../shared/voxel/Materials.js';
const COL = { asphalt: [60, 62, 66], road_mark: [230, 220, 120], paving: [176, 172, 164], concrete: [150, 150, 146], lawn: [96, 150, 80], leaves: [70, 120, 60], glass: [120, 170, 200], brick: [150, 80, 60], concrete_wall: [130, 132, 135], stucco: [200, 185, 150], siding: [180, 190, 200], roof: [110, 70, 60], roof_metal: [140, 150, 160], car_body: [200, 40, 40], car_cabin: [60, 80, 120], steel_post: [90, 90, 95] };
export function slatePPM(store) {
    const s = store, W = s.width, D = s.depth, px = Buffer.alloc(W * D * 3);
    const top = (x, y) => s.topSolid(Math.max(0, Math.min(W - 1, x)), Math.max(0, Math.min(D - 1, y)));
    for (let y = 0; y < D; y++) for (let x = 0; x < W; x++) {
        const z = top(x, y), c = COL[materialById(s.get(x, y, z))?.key] || [170, 160, 150];
        const shade = Math.max(0.55, Math.min(1.25, 1 + 0.12 * (top(x - 1, y - 1) - top(x + 1, y + 1)))), lift = 0.85 + 0.15 * Math.min(1, (z - 1) / 14);
        for (let k = 0; k < 3; k++) px[(x + y * W) * 3 + k] = Math.max(0, Math.min(255, Math.round(c[k] * shade * lift)));
    }
    return Buffer.concat([Buffer.from(`P6 ${W} ${D} 255\n`), px]);
}
