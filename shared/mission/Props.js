// Voxel props: vibe-game decorations (tree, boulder, stall, fountain, lantern_cluster, banner, archway,
// shrub, plant, resource_node) and tactical clutter, each with a cover class. `z` is the surface they
// stand on (they occupy z+1 upward).
import { MAT } from '../voxel/Materials.js';

const put = (s, x, y, z, key) => { if (s.inBounds(x, y, z)) s.set(x, y, z, MAT[key]); };
const free = (s, x, y, z) => s.inBounds(x, y, z) && !s.isSolid(x, y, z);

export const PROPS = {
    tree(s, x, y, z) {
        for (let h = 1; h <= 3; h++) put(s, x, y, z + h, 'trunk');
        for (let dz = 3; dz <= 5; dz++) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
            if (Math.abs(dx) + Math.abs(dy) + (dz === 5 ? 1 : 0) > 2 || (dx === 0 && dy === 0 && dz < 4)) continue;
            if (free(s, x + dx, y + dy, z + dz)) put(s, x + dx, y + dy, z + dz, 'leaves');
        }
    },
    boulder(s, x, y, z) { for (const [dx, dy, h] of [[0, 0, 2], [1, 0, 1], [0, 1, 1], [1, 1, 2]]) for (let k = 1; k <= h; k++) put(s, x + dx, y + dy, z + k, 'rock'); },
    // Market stall: a two-cell counter; the client draws its posts and striped awning.
    stall(s, x, y, z) { put(s, x, y, z + 1, 'stall'); put(s, x + 1, y, z + 1, 'stall'); },
    fountain(s, x, y, z) {
        for (let dy = -1; dy <= 2; dy++) for (let dx = -1; dx <= 2; dx++) {
            const rim = dx === -1 || dy === -1 || dx === 2 || dy === 2;
            if (rim) put(s, x + dx, y + dy, z + 1, 'stone'); else { put(s, x + dx, y + dy, z, 'water'); }
        }
        put(s, x, y, z + 1, 'stone'); put(s, x, y, z + 2, 'stone');
    },
    // Street lamp: iron post with a lantern on top (a lone column of iron is drawn as a post).
    lantern_cluster(s, x, y, z) { put(s, x, y, z + 1, 'metal'); put(s, x, y, z + 2, 'metal'); put(s, x, y, z + 3, 'lantern'); },
    banner(s, x, y, z) { for (let h = 1; h <= 3; h++) put(s, x, y, z + h, 'trunk'); put(s, x + 1, y, z + 3, 'cloth'); },
    archway(s, x, y, z) { for (let h = 1; h <= 3; h++) { put(s, x, y, z + h, 'stone'); put(s, x + 3, y, z + h, 'stone'); } for (let dx = 0; dx <= 3; dx++) put(s, x + dx, y, z + 4, 'stone'); },
    shrub(s, x, y, z) { put(s, x, y, z + 1, 'hedge'); },
    plant(s, x, y, z) { put(s, x, y, z + 1, 'hedge'); },
    resource_node(s, x, y, z) { put(s, x, y, z + 1, 'crystal'); },
    crates(s, x, y, z) { put(s, x, y, z + 1, 'crate'); put(s, x + 1, y, z + 1, 'crate'); put(s, x, y, z + 2, 'crate'); },
    crate(s, x, y, z) { put(s, x, y, z + 1, 'crate'); },
    keg(s, x, y, z) { put(s, x, y, z + 1, 'barrel_powder'); },
    water_barrel(s, x, y, z) { put(s, x, y, z + 1, 'barrel_water'); },
    sandbags(s, x, y, z, len = 3, horizontal = true) { for (let i = 0; i < len; i++) put(s, x + (horizontal ? i : 0), y + (horizontal ? 0 : i), z + 1, 'sandbag'); },
    hedge_row(s, x, y, z, len = 4, horizontal = true) { for (let i = 0; i < len; i++) put(s, x + (horizontal ? i : 0), y + (horizontal ? 0 : i), z + 1, 'hedge'); },
    low_wall(s, x, y, z, len = 4, horizontal = true, key = 'drystone') { for (let i = 0; i < len; i++) put(s, x + (horizontal ? i : 0), y + (horizontal ? 0 : i), z + 1, key); },
    wall(s, x, y, z, len = 4, horizontal = true, key = 'stone', h = 2) { for (let i = 0; i < len; i++) for (let k = 1; k <= h; k++) put(s, x + (horizontal ? i : 0), y + (horizontal ? 0 : i), z + k, key); },
    cart(s, x, y, z, len = 2, horizontal = true) { for (let i = 0; i < 2; i++) put(s, x + (horizontal ? i : 0), y + (horizontal ? 0 : i), z + 1, 'cart'); },
    fence(s, x, y, z, len = 4, horizontal = true) { for (let i = 0; i < len; i++) put(s, x + (horizontal ? i : 0), y + (horizontal ? 0 : i), z + 1, 'fence'); },
    hay(s, x, y, z, len = 2, horizontal = true) { for (let i = 0; i < len; i++) put(s, x + (horizontal ? i : 0), y + (horizontal ? 0 : i), z + 1, 'hay'); }
};

/** Cover class a prop provides, for the map metrics and the AI's tile scoring. */
export const PROP_COVER = { tree: 'full', boulder: 'full', stall: 'half', fountain: 'half', lantern_cluster: 'none', banner: 'none', archway: 'full',
    shrub: 'concealment', plant: 'concealment', resource_node: 'half', crates: 'full', crate: 'half', keg: 'half', water_barrel: 'half', sandbags: 'half',
    hedge_row: 'concealment', low_wall: 'half', wall: 'full', cart: 'half', fence: 'half', hay: 'half' };

export function placeProp(store, type, x, y, z, ...args) {
    const fn = PROPS[type];
    if (!fn) return false;
    fn(store, x, y, z, ...args);
    return true;
}
