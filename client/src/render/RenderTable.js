// How each voxel material is drawn: which texture (client/public/assets/textures/pbr/<tex>.jpg + <tex>_n.jpg),
// how many voxels one texture tile spans, its surface response, and per-face overrides.
// Pure data (no THREE) so the chunk mesher can read it in a worker later.
//
//   tex        texture name (albedo + _n normal map)
//   scale      voxels per texture tile for world-space UVs (bigger = larger pattern)
//   uv         'world' (continuous across voxels) or 'face' (0..1 on every face — barrels, grass sides)
//   side       render key used for the side faces (grass → grass_side with its fringe)
//   rough/metal  MeshStandardMaterial roughness / metalness
//   normal     normal map strength
//   kind       'opaque' | 'glass' | 'water' (draw group and blending)
//   opacity, emissive (hex), emissiveIntensity, tint (hex multiplied into the texture), brightness (scalar boost)
//   macro      large-scale brightness variation to hide tiling on big flat areas (0 = none)
export const RENDER = {
    bedrock: { tex: 'bedrock', scale: 3, rough: 0.95, normal: 0.8 },
    soil: { tex: 'soil', scale: 2.5, rough: 1, normal: 0.8, macro: 0.12 },
    grass: { tex: 'grass', scale: 3, rough: 0.95, normal: 0.7, side: 'grass_side', macro: 0.16 },
    grass_side: { tex: 'grass_side', uv: 'face', rough: 1, normal: 0.8 },
    forest_floor: { tex: 'forest_floor', scale: 3, rough: 1, normal: 0.7, side: 'grass_side', macro: 0.16 },
    sand: { tex: 'sand', scale: 3, rough: 1, normal: 0.6, macro: 0.08 },
    snow: { tex: 'snow', scale: 3, rough: 0.8, normal: 0.6, macro: 0.05 },
    road: { tex: 'road', scale: 2.5, rough: 1, normal: 0.8, macro: 0.1 },
    cobble: { tex: 'cobble', scale: 2.5, rough: 0.9, normal: 1, macro: 0.08 },
    stone: { tex: 'stone', scale: 2.5, rough: 0.92, normal: 1 },
    city_wall: { tex: 'city_wall', scale: 3, rough: 0.95, normal: 1 },
    plaster: { tex: 'plaster', scale: 2.5, rough: 0.95, normal: 0.7 },
    timber: { tex: 'timber', scale: 2, rough: 0.85, normal: 1 },
    plank: { tex: 'plank', scale: 2, rough: 0.8, normal: 0.9 },
    stone_floor: { tex: 'stone_floor', scale: 3, rough: 0.85, normal: 0.8 },
    roof: { tex: 'roof', scale: 2, rough: 0.8, normal: 1.1 },
    glass: { tex: 'glass', scale: 1, rough: 0.08, normal: 0.3, kind: 'glass', opacity: 0.38 },
    door: { tex: 'door', scale: 2, rough: 0.8, normal: 1 },
    stairs_wood: { tex: 'stairs_wood', scale: 1.5, rough: 0.8, normal: 0.9 },
    stairs_stone: { tex: 'stairs_stone', scale: 2, rough: 0.9, normal: 1 },
    water: { tex: 'water', scale: 4, rough: 0.06, normal: 0.6, kind: 'water', opacity: 0.78 },
    deep_water: { tex: 'water', scale: 4, rough: 0.06, normal: 0.6, kind: 'water', opacity: 0.88, tint: 0x6f9fb2 },
    ice: { tex: 'ice', scale: 3, rough: 0.15, normal: 0.6, kind: 'glass', opacity: 0.86 },
    lava: { tex: 'lava', scale: 3, rough: 0.6, normal: 0.8, kind: 'water', opacity: 1, emissive: 0xff6a1f, emissiveIntensity: 1.6 },
    hedge: { tex: 'hedge', scale: 1.5, rough: 0.9, normal: 1, brightness: 1.25 },
    leaves: { tex: 'leaves', scale: 1.5, rough: 0.9, normal: 1, brightness: 1.2 },
    trunk: { tex: 'trunk', scale: 1, uv: 'face', rough: 0.95, normal: 1.1 },
    furniture: { tex: 'furniture', scale: 1, rough: 0.7, normal: 0.8 },
    shelf: { tex: 'shelf', scale: 1, rough: 0.7, normal: 0.8 },
    crate: { tex: 'crate', uv: 'face', rough: 0.85, normal: 1 },
    barrel_powder: { tex: 'barrel_powder', uv: 'face', rough: 0.7, normal: 1 },
    barrel_water: { tex: 'barrel_water', uv: 'face', rough: 0.7, normal: 1 },
    metal: { tex: 'metal', scale: 1.5, rough: 0.45, metal: 0.75, normal: 0.8 },
    rubble: { tex: 'rubble', scale: 1.5, rough: 1, normal: 1.1 },
    ash: { tex: 'ash', scale: 2, rough: 1, normal: 0.6 },
    sandbag: { tex: 'sandbag', uv: 'face', rough: 1, normal: 1.1 },
    crystal: { tex: 'crystal', scale: 1, rough: 0.1, normal: 0.6, kind: 'glass', opacity: 0.9, emissive: 0x58b8ff, emissiveIntensity: 0.6 },
    cloth: { tex: 'cloth', scale: 2, rough: 0.95, normal: 0.4 },
    hay: { tex: 'hay', uv: 'face', rough: 1, normal: 1 },
    lantern: { tex: 'lantern', uv: 'face', rough: 0.5, normal: 0.6, emissive: 0xffb347, emissiveIntensity: 1.4 }
};
export const FALLBACK = { tex: 'stone', scale: 2, rough: 0.9, normal: 1 };
export const renderFor = key => RENDER[key] || FALLBACK;
export const KIND_GROUP = { opaque: 0, glass: 1, water: 2 };
