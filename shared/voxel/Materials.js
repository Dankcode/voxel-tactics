// Voxel materials for the tactical layer.
//
// Every voxel stores one material id (0 = air). The element field reuses vibe-game's ELEMENTS
// (shared/world/TileRegistry.js), so the elemental rules in shared/elements/ can treat terrain,
// buildings and props the same way vibe-game treats its tiles.
//
//   solid       blocks movement and can be stood on
//   opaque      blocks line of sight
//   projectile  'block' stops a bullet, 'pass' lets it through, 'shatter' stops it but breaks (glass)
//   hp          damage the voxel absorbs before it is destroyed (Infinity = indestructible)
//   part        vibe-game BUILDING_PARTS code, read by the copied TraversalRules (2 door, 4 stairs)
import { ELEMENTS } from '../world/TileRegistry.js';

const M = [];
function def(key, o) {
    const id = M.length;
    const m = Object.freeze({
        id, key, label: o.label || key, element: o.element ?? ELEMENTS.GEO, color: o.color ?? 0xff00ff,
        hp: o.hp ?? 4, solid: o.solid ?? true, opaque: o.opaque ?? (o.solid ?? true),
        projectile: o.projectile ?? ((o.solid ?? true) ? 'block' : 'pass'), flammable: !!o.flammable,
        render: o.render ?? ((o.solid ?? true) ? 'solid' : 'none'), moveCost: o.moveCost ?? 1, traversal: o.traversal ?? null,
        liquid: !!o.liquid, part: o.part ?? 0, debris: o.debris ?? null, explosive: o.explosive ?? null,
        burnTo: o.burnTo ?? null, meltTo: o.meltTo ?? null, freezeTo: o.freezeTo ?? null, structural: o.structural ?? (o.solid ?? true),
        light: o.light ?? 0, concealment: o.concealment ?? 0, family: o.family ?? 'earth', walkable: o.walkable ?? (o.solid ?? true)
    });
    M.push(m);
    return m;
}

def('air', { solid: false, opaque: false, projectile: 'pass', render: 'none', hp: 0, structural: false, element: ELEMENTS.VOID, walkable: false });
def('bedrock', { label: 'Bedrock', color: 0x4b4640, hp: Infinity, family: 'stone' });
def('soil', { label: 'Soil', color: 0x7a5a3c, hp: 5, debris: 'rubble' });
def('grass', { label: 'Grass', color: 0x6dbb4c, hp: 5, debris: 'soil' });
def('forest_floor', { label: 'Forest floor', color: 0x3f8f45, hp: 5, debris: 'soil' });
def('sand', { label: 'Sand', element: ELEMENTS.ANEMO, color: 0xe6c773, hp: 3, moveCost: 1.15 });
def('snow', { label: 'Snow', element: ELEMENTS.CRYO, color: 0xeef6fb, hp: 2, moveCost: 1.2 });
def('road', { label: 'Road', color: 0xb49a76, hp: 6, family: 'stone' });
def('cobble', { label: 'Cobblestone', color: 0x9b958a, hp: 7, family: 'stone' });
def('stone', { label: 'Stone wall', color: 0xa8a29a, hp: 9, family: 'stone', debris: 'rubble' });
def('city_wall', { label: 'City wall', color: 0x8f8a82, hp: 14, family: 'stone', debris: 'rubble' });
def('plaster', { label: 'Plaster wall', element: ELEMENTS.STRUCTURE, color: 0xe8d7b4, hp: 6, family: 'stone', debris: 'rubble' });
def('timber', { label: 'Timber wall', element: ELEMENTS.STRUCTURE, color: 0x9a6a43, hp: 4, flammable: true, burnTo: 'ash', family: 'wood' });
def('plank', { label: 'Wood floor', element: ELEMENTS.STRUCTURE, color: 0xb0814f, hp: 4, flammable: true, burnTo: 'ash', family: 'wood' });
def('stone_floor', { label: 'Stone floor', element: ELEMENTS.STRUCTURE, color: 0xb9b2a6, hp: 8, family: 'stone' });
def('roof', { label: 'Roof tiles', element: ELEMENTS.STRUCTURE, color: 0xb4553f, hp: 3, family: 'wood', flammable: true, burnTo: 'ash' });
def('glass', { label: 'Window', element: ELEMENTS.STRUCTURE, color: 0xbfe6f2, hp: 1, opaque: false, projectile: 'shatter', render: 'glass', family: 'glass', structural: false });
def('door', { label: 'Door', element: ELEMENTS.STRUCTURE, color: 0x6f4526, hp: 4, solid: false, opaque: true, projectile: 'block', render: 'solid', flammable: true, part: 2, family: 'wood', structural: false, walkable: false });
def('door_open', { label: 'Open door', element: ELEMENTS.STRUCTURE, color: 0x6f4526, hp: 4, solid: false, opaque: false, projectile: 'pass', render: 'none', part: 2, family: 'wood', structural: false, walkable: false });
def('stairs_wood', { label: 'Wooden stairs', element: ELEMENTS.STRUCTURE, color: 0x8b5e3a, hp: 4, flammable: true, part: 4, burnTo: 'ash', family: 'wood' });
def('stairs_stone', { label: 'Stone stairs', element: ELEMENTS.STRUCTURE, color: 0x9d968c, hp: 8, part: 4, family: 'stone' });
def('water', { label: 'Shallow water', element: ELEMENTS.HYDRO, color: 0x3fb7d6, hp: Infinity, solid: false, opaque: false, projectile: 'pass', render: 'water', liquid: true, traversal: 'wade', moveCost: 1.8, freezeTo: 'ice', structural: false, walkable: true });
def('deep_water', { label: 'Deep water', element: ELEMENTS.HYDRO, color: 0x1d7fa6, hp: Infinity, solid: false, opaque: false, projectile: 'pass', render: 'water', liquid: true, traversal: 'blocked', freezeTo: 'ice', structural: false, walkable: false });
def('ice', { label: 'Ice', element: ELEMENTS.CRYO, color: 0xcdeffd, hp: 2, moveCost: 1.4, meltTo: 'water', render: 'glass', opaque: false, family: 'ice' });
def('lava', { label: 'Lava', element: ELEMENTS.PYRO, color: 0xff6a1f, hp: Infinity, solid: false, opaque: false, render: 'water', liquid: true, traversal: 'blocked', light: 2, structural: false, walkable: false });
def('hedge', { label: 'Hedge', color: 0x2f7d3a, hp: 2, solid: true, opaque: true, projectile: 'pass', flammable: true, render: 'foliage', concealment: 2, family: 'plant', structural: false });
def('leaves', { label: 'Leaves', color: 0x3c9a3f, hp: 1, solid: false, opaque: true, projectile: 'pass', flammable: true, render: 'foliage', concealment: 2, family: 'plant', structural: false, walkable: false });
def('trunk', { label: 'Tree trunk', color: 0x6a4a2c, hp: 6, flammable: true, burnTo: 'ash', family: 'wood' });
def('furniture', { label: 'Furniture', element: ELEMENTS.STRUCTURE, color: 0x8c5a33, hp: 3, flammable: true, burnTo: 'ash', family: 'wood', structural: false });
def('shelf', { label: 'Shelf', element: ELEMENTS.STRUCTURE, color: 0x6e4a2b, hp: 4, flammable: true, burnTo: 'ash', family: 'wood', structural: false });
def('crate', { label: 'Crate', element: ELEMENTS.STRUCTURE, color: 0xb98a4e, hp: 3, flammable: true, burnTo: 'ash', family: 'wood', structural: false });
def('barrel_powder', { label: 'Powder keg', element: ELEMENTS.PYRO, color: 0x8a2d1c, hp: 1, flammable: true, family: 'wood', structural: false,
    explosive: { radius: 2.6, power: 9, damage: 5, element: 'pyro' } });
def('barrel_water', { label: 'Water barrel', element: ELEMENTS.HYDRO, color: 0x3c6e8f, hp: 2, family: 'wood', structural: false,
    explosive: { radius: 1.8, power: 0, damage: 0, element: 'hydro' } });
def('metal', { label: 'Iron', color: 0x5b6168, hp: 16, family: 'metal' });
def('rubble', { label: 'Rubble', color: 0x8a8378, hp: 3, moveCost: 1.5, family: 'stone', structural: false });
def('ash', { label: 'Ash', color: 0x3d3a37, hp: 1, moveCost: 1.1, structural: false });
def('sandbag', { label: 'Sandbags', element: ELEMENTS.ANEMO, color: 0xc2a86b, hp: 6, family: 'earth', structural: false });
def('crystal', { label: 'Crystal node', element: ELEMENTS.CRYO, color: 0x8fd8ff, hp: 5, opaque: false, render: 'glass', family: 'ice', structural: false });
def('cloth', { label: 'Awning', element: ELEMENTS.STRUCTURE, color: 0xd9a441, hp: 1, solid: true, opaque: true, projectile: 'pass', flammable: true, burnTo: null, family: 'plant', structural: false });
def('lantern', { label: 'Lantern', element: ELEMENTS.PYRO, color: 0xffd36b, hp: 1, light: 3, family: 'metal', structural: false,
    explosive: { radius: 1.4, power: 1, damage: 1, element: 'pyro' } });

export const MATERIALS = Object.freeze(M);
export const MAT = Object.freeze(Object.fromEntries(M.map(m => [m.key, m.id])));
export const materialById = id => M[id] || M[0];
export const materialByKey = key => M[MAT[key]] || M[0];
export const AIR = 0;

/** How much a voxel of this material covers a body standing behind it. */
export function coverWeight(m) {
    if (!m || m.id === AIR) return 0;
    if (m.projectile === 'block' || m.projectile === 'shatter') return 1;
    return m.concealment ? 0.35 : 0;
}
