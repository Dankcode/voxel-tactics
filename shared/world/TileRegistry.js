import {
    BURG_THEME_STREET_PALETTE_IDS,
    BURG_THEME_STREET_PALETTES,
    DEFAULT_WORLD_PALETTE_ID,
    VISUAL_VARIANT_COUNT,
    WORLD_PALETTE_IDS,
    WORLD_PALETTES,
    getBurgThemeStreetPaletteId,
    getWorldPalette,
    getWorldPaletteVariants,
    normalizeWorldPaletteId,
    normalizeWorldVisualVariant,
    resolveWorldPaletteVariant
} from './WorldPalettes.js';
import { getBurgTheme, normalizeBurgThemeId } from './BurgThemeCatalog.js';

export {
    BURG_THEME_STREET_PALETTE_IDS,
    BURG_THEME_STREET_PALETTES,
    DEFAULT_WORLD_PALETTE_ID,
    VISUAL_VARIANT_COUNT,
    WORLD_PALETTE_IDS,
    WORLD_PALETTES,
    getBurgThemeStreetPaletteId,
    getWorldPalette,
    getWorldPaletteVariants,
    normalizeWorldPaletteId,
    normalizeWorldVisualVariant,
    resolveWorldPaletteVariant
};

export const ELEMENTS = {
    VOID: 0,
    GEO: 1,
    HYDRO: 2,
    ANEMO: 3,
    CRYO: 4,
    PYRO: 5,
    STRUCTURE: 6
};

const paletteVariant = (topColor, sideColor, accentColor, highlightColor) => ({
    topColor,
    sideColor,
    accentColor,
    highlightColor
});

/**
 * Compact, reusable colour families sampled from the vibrant floating-island
 * concept.  A tile definition points at one family; Tile.js selects a member
 * with a stable matrix-coordinate hash, so replay variants gain colour without
 * changing collision, movement cost, or the matrix symbol vocabulary.
 */
export const TILE_VISUAL_PALETTES = Object.freeze({
    meadow: Object.freeze([
        paletteVariant(0x69cf4e, 0x80543a, 0xc7ef72, 0xe8ff9a),
        paletteVariant(0x7bd956, 0x755039, 0xa9e95c, 0xf0ff9f),
        paletteVariant(0x59c94b, 0x8b583d, 0x8fe04f, 0xd7ff83),
        paletteVariant(0x8ad95a, 0x714936, 0xd5ef68, 0xf4ffa8),
        paletteVariant(0x4fbd51, 0x684b3b, 0x7edb62, 0xcaff91),
        paletteVariant(0x92d464, 0x895d40, 0xc7e67b, 0xf4ffb0)
    ]),
    forest: Object.freeze([
        paletteVariant(0x3eae55, 0x624936, 0x77d85a, 0xb8ef7b),
        paletteVariant(0x2f9f4c, 0x594536, 0x66ca4d, 0xa4e56d),
        paletteVariant(0x4bb85b, 0x6f4c38, 0x8bdc63, 0xc8f38b),
        paletteVariant(0x399847, 0x514139, 0x5fc65a, 0x9cde71),
        paletteVariant(0x55b94e, 0x725039, 0x9dd862, 0xd4f28a),
        paletteVariant(0x379f5a, 0x5b473b, 0x73ca71, 0xaee597)
    ]),
    hill: Object.freeze([
        paletteVariant(0x70c95b, 0x76503a, 0xb8e86d, 0xe4fa96),
        paletteVariant(0x83d15a, 0x82543a, 0xd0ec6d, 0xf2ff9c),
        paletteVariant(0x62bd55, 0x6b4938, 0x9cdd62, 0xd3f58a),
        paletteVariant(0x8bcf69, 0x8a5c40, 0xc6e77b, 0xecfaa2),
        paletteVariant(0x5fbf64, 0x70483c, 0x8cda73, 0xcaf29a),
        paletteVariant(0x91ca5f, 0x86553c, 0xd6e67b, 0xf4f7a1)
    ]),
    mountain: Object.freeze([
        paletteVariant(0xaebc8c, 0x68725c, 0xd4dfae, 0xf1f2cf),
        paletteVariant(0x9fb78c, 0x626c5b, 0xbfd69c, 0xe2ebc1),
        paletteVariant(0xb8bd98, 0x777565, 0xddd6ae, 0xf4edcf),
        paletteVariant(0x94ac84, 0x586658, 0xb7ca95, 0xdbe5bd),
        paletteVariant(0xb2c49e, 0x707867, 0xd1e2af, 0xf0f5cf),
        paletteVariant(0x9da892, 0x62635e, 0xc5cbb2, 0xe5e6d2)
    ]),
    trail: Object.freeze([
        paletteVariant(0xeccf85, 0x845c38, 0xffecb0, 0xfff5cf),
        paletteVariant(0xf1d99a, 0x8e6340, 0xffe9a2, 0xfff6d4),
        paletteVariant(0xdfbd72, 0x785235, 0xf5dc91, 0xffedbb),
        paletteVariant(0xe9c584, 0x8b5940, 0xffdda0, 0xffedc5),
        paletteVariant(0xdaba7c, 0x745038, 0xf2d79b, 0xffebc8)
    ]),
    village: Object.freeze([
        paletteVariant(0xaacf68, 0x795139, 0xd7e980, 0xf1f7a8),
        paletteVariant(0xb9d876, 0x81563c, 0xe0ef8e, 0xf7fab2),
        paletteVariant(0x96c965, 0x704c39, 0xc8e47d, 0xeaf49f),
        paletteVariant(0xc2d680, 0x8b5b40, 0xe8e99a, 0xfcf5bb),
        paletteVariant(0x9fca73, 0x76513d, 0xcfe08c, 0xedf2ae),
        paletteVariant(0xb4ce67, 0x82543a, 0xe0e47c, 0xf8f7a2)
    ]),
    cobble: Object.freeze([
        paletteVariant(0xe9dcc0, 0x776d60, 0xffefd0, 0xfff8e4),
        paletteVariant(0xded5c2, 0x6d6b64, 0xf1e8d1, 0xfff7e7),
        paletteVariant(0xead7b5, 0x806d5c, 0xffe8bf, 0xfff4d7),
        paletteVariant(0xd9d8cc, 0x69716d, 0xf0eee2, 0xffffff),
        paletteVariant(0xe5cfbf, 0x79645e, 0xf6e0d5, 0xfff1e7),
        paletteVariant(0xdcd1b7, 0x716b5a, 0xf1e2bf, 0xfff5db)
    ]),
    plaza: Object.freeze([
        paletteVariant(0xf2e1bf, 0x7b6a58, 0xfff1d0, 0xfffae8),
        paletteVariant(0xead9c6, 0x74645e, 0xf8e8d9, 0xfff8ef),
        paletteVariant(0xf3dfcc, 0x81685d, 0xffebdc, 0xfff7ee),
        paletteVariant(0xe8dfd0, 0x6f706a, 0xf7f1e6, 0xffffff),
        paletteVariant(0xedd8b5, 0x7e6d55, 0xffe8c0, 0xfff5dc),
        paletteVariant(0xe4d0cf, 0x766363, 0xf5e1e2, 0xfff2f4)
    ]),
    garden: Object.freeze([
        paletteVariant(0x69c85d, 0x76513b, 0xd8ec68, 0xf3fa9a),
        paletteVariant(0x78d167, 0x80543c, 0xf0cc62, 0xffefa0),
        paletteVariant(0x58bd59, 0x684b3a, 0xe88cc8, 0xffc2ea),
        paletteVariant(0x86d26a, 0x82593d, 0xa78ce9, 0xd1c0ff),
        paletteVariant(0x62c970, 0x6e4d3c, 0x78cdeb, 0xb7edff),
        paletteVariant(0x73c95d, 0x7b5139, 0xf09b5f, 0xffcf8a)
    ]),
    water: Object.freeze([
        paletteVariant(0x22c7e3, 0x087da7, 0x79eff3, 0xd0ffff),
        paletteVariant(0x21b9df, 0x08709f, 0x63e4f1, 0xc3fbff),
        paletteVariant(0x27d2d7, 0x0b88a1, 0x80f0e2, 0xd5fff5),
        paletteVariant(0x1bb1d2, 0x086a94, 0x5ed8e9, 0xb9f8ff),
        paletteVariant(0x30c5ef, 0x0b79ad, 0x89e9ff, 0xd7f8ff),
        paletteVariant(0x2dcfd0, 0x07878e, 0x8ff1df, 0xd8fff5)
    ]),
    shallowWater: Object.freeze([
        paletteVariant(0x35cfd5, 0x087f9e, 0x8df5ec, 0xd6fff8),
        paletteVariant(0x42d7c0, 0x138c92, 0xa4f8df, 0xe5fff5),
        paletteVariant(0x2cc9dd, 0x087aa1, 0x82edf2, 0xd2fcff),
        paletteVariant(0x4fd5d0, 0x16889e, 0xa9f8ed, 0xe7fffa),
        paletteVariant(0x2dc8ba, 0x087e8a, 0x8ce8d4, 0xd6fff0),
        paletteVariant(0x4dcee0, 0x1885a5, 0xa4f0fb, 0xe3fbff)
    ]),
    coastalWater: Object.freeze([
        paletteVariant(0x21bdd2, 0x126f92, 0x74e4e5, 0xc8ffff),
        paletteVariant(0x19b0cc, 0x0a668e, 0x61d9df, 0xb9f7ff),
        paletteVariant(0x28c6c6, 0x117a8c, 0x7ce4d8, 0xccfff3),
        paletteVariant(0x16a8c6, 0x075f86, 0x55d3e2, 0xadf4ff),
        paletteVariant(0x2ab9df, 0x0f6c9c, 0x78ddf4, 0xc8f5ff),
        paletteVariant(0x22c7b9, 0x0b7a7f, 0x75e5cf, 0xc8fff0)
    ]),
    marsh: Object.freeze([
        paletteVariant(0x77a267, 0x4a7145, 0xa9c978, 0xd9e59a),
        paletteVariant(0x6f9a5f, 0x41693f, 0x98bd6b, 0xcfe091),
        paletteVariant(0x85aa68, 0x507748, 0xb5cc79, 0xe2e99f),
        paletteVariant(0x699768, 0x3f6650, 0x8cbd7b, 0xc5e2a2)
    ]),
    sand: Object.freeze([
        paletteVariant(0xffdd7b, 0xc88b42, 0xffeda7, 0xfff5c7),
        paletteVariant(0xf5cf72, 0xb97b3c, 0xffe39a, 0xffefbd),
        paletteVariant(0xffe18c, 0xcf9450, 0xffefb1, 0xfff7d2),
        paletteVariant(0xefc981, 0xb98248, 0xfbdd9d, 0xffedc0)
    ]),
    snow: Object.freeze([
        paletteVariant(0xf3fbff, 0xb7d9ea, 0xccefff, 0xffffff),
        paletteVariant(0xe5f7ff, 0x9fcde4, 0xb9e8ff, 0xffffff),
        paletteVariant(0xf4f1ff, 0xbabce5, 0xded6ff, 0xffffff),
        paletteVariant(0xdff5f4, 0x9fcfce, 0xbaebe8, 0xf8ffff)
    ]),
    lava: Object.freeze([
        paletteVariant(0xff7a26, 0xb83a18, 0xffd35a, 0xffffa1),
        paletteVariant(0xff5a2e, 0xa6241b, 0xffb532, 0xffe57a),
        paletteVariant(0xf58b2c, 0xb54b17, 0xffda62, 0xffffa9),
        paletteVariant(0xef4933, 0x92201d, 0xffa72f, 0xffd873)
    ]),
    stoneWall: Object.freeze([
        paletteVariant(0xb8c4ce, 0x7e8b99, 0xd9e2e8, 0xf7fbff),
        paletteVariant(0xc8c5b9, 0x8b897e, 0xe4e0d2, 0xfffcf0),
        paletteVariant(0xaebdb8, 0x748782, 0xd0ddd6, 0xf0f6ef),
        paletteVariant(0xc4b9b5, 0x8d7b78, 0xe6d5d1, 0xfff0ec)
    ]),
    townWall: Object.freeze([
        paletteVariant(0xc7c9bd, 0x747b7b, 0xe1e4da, 0xf4f6ef),
        paletteVariant(0xb8c1c4, 0x697579, 0xd7dfe0, 0xf0f4f3),
        paletteVariant(0xd2cbbd, 0x817b72, 0xe9e2d5, 0xf9f5ec),
        paletteVariant(0xb9c5ba, 0x6f7d73, 0xd8e3d8, 0xf1f7f0),
        paletteVariant(0xc8c2c5, 0x7d747b, 0xe2dce1, 0xf6f1f5),
        paletteVariant(0xc2c9d0, 0x707a86, 0xdde4eb, 0xf4f8fc)
    ]),
    storybookWall: Object.freeze([
        paletteVariant(0xf2ead8, 0xa9a18f, 0xfff7e8, 0xffffff),
        paletteVariant(0xf0dfc9, 0xa88f7b, 0xffedd8, 0xfff9eb),
        paletteVariant(0xeadedc, 0xa28e91, 0xf9e9ea, 0xfff8f7),
        paletteVariant(0xe5e7d1, 0x979b82, 0xf4f3df, 0xfffff3),
        paletteVariant(0xe8d6bd, 0x9d876e, 0xf9e5c9, 0xfff2df),
        paletteVariant(0xd9e3e4, 0x899da0, 0xeaf2f3, 0xfaffff)
    ]),
    timberWall: Object.freeze([
        paletteVariant(0xffb783, 0xb76548, 0xffd09b, 0xffe6b9),
        paletteVariant(0xeaa36f, 0x9c5542, 0xffc28b, 0xffdda8),
        paletteVariant(0xf1bb79, 0xa96a3e, 0xffd393, 0xffe8b0),
        paletteVariant(0xdf9b7b, 0x8e4d48, 0xf8b69a, 0xffd3bd),
        paletteVariant(0xf0aa86, 0xa7554c, 0xffc3a3, 0xffddc1),
        paletteVariant(0xe8b16c, 0x9a6536, 0xffcf87, 0xffe5a6)
    ]),
    wood: Object.freeze([
        paletteVariant(0xc1844d, 0x82512e, 0xe6ab66, 0xffd68c),
        paletteVariant(0xb87944, 0x72462a, 0xd99d5c, 0xf4c87d),
        paletteVariant(0xd09251, 0x8c5931, 0xecb06a, 0xffd58b),
        paletteVariant(0xaa7048, 0x67412d, 0xcc9064, 0xeeb98a)
    ]),
    stoneFloor: Object.freeze([
        paletteVariant(0xbec4bf, 0x7b8582, 0xdce2dc, 0xf7faf5),
        paletteVariant(0xc9c4b8, 0x888278, 0xe4ded0, 0xfffaea),
        paletteVariant(0xb7c5c8, 0x74858a, 0xd5e3e5, 0xf1fbfc),
        paletteVariant(0xc5babb, 0x877a7e, 0xe1d5d7, 0xfceff1)
    ]),
    paintedDoor: Object.freeze([
        paletteVariant(0x3f7f79, 0x28514d, 0x76c4ad, 0xb7edda),
        paletteVariant(0x3e6fa0, 0x294a6b, 0x70a9dc, 0xb6d8f4),
        paletteVariant(0x7f5197, 0x513461, 0xb783c8, 0xe2bbee),
        paletteVariant(0xb05d55, 0x733b37, 0xe68e78, 0xffc4a9)
    ])
});

export const TILE_DEFINITIONS = {
    [ELEMENTS.VOID]: {
        id: 'void',
        label: 'Void',
        walkable: false,
        habitats: [],
        topColor: 0x7d8796,
        sideColor: 0x5d6673,
        roughness: 0.95,
        pattern: 'blocked',
        visualPalette: 'stoneWall'
    },
    [ELEMENTS.GEO]: {
        id: 'geo',
        label: 'Grassland',
        walkable: true,
        habitats: ['meadow', 'forest-edge'],
        topColor: 0x55c94d,
        sideColor: 0x76513b,
        roughness: 0.76,
        moveCost: 1,
        pattern: 'grass',
        visualPalette: 'meadow'
    },
    [ELEMENTS.HYDRO]: {
        id: 'hydro',
        label: 'Water',
        walkable: false,
        habitats: ['shore'],
        topColor: 0x22c7e3,
        sideColor: 0x087da7,
        roughness: 0.35,
        moveCost: Infinity,
        waterDepth: 'deep',
        crossing: null,
        traversal: 'blocked',
        pattern: 'water',
        visualPalette: 'water'
    },
    [ELEMENTS.ANEMO]: {
        id: 'anemo',
        label: 'Sand',
        walkable: true,
        habitats: ['shore'],
        topColor: 0xffdd7b,
        sideColor: 0xc88b42,
        roughness: 0.78,
        moveCost: 1.08,
        pattern: 'sand',
        visualPalette: 'sand'
    },
    [ELEMENTS.CRYO]: {
        id: 'cryo',
        label: 'Snowfield',
        walkable: true,
        habitats: ['snow'],
        topColor: 0xf3fbff,
        sideColor: 0xb7d9ea,
        roughness: 0.32,
        moveCost: 1.18,
        pattern: 'ice',
        visualPalette: 'snow'
    },
    [ELEMENTS.PYRO]: {
        id: 'pyro',
        label: 'Lava',
        walkable: false,
        habitats: [],
        topColor: 0xff7a26,
        sideColor: 0xb83a18,
        roughness: 0.55,
        moveCost: Infinity,
        pattern: 'lava',
        visualPalette: 'lava'
    },
    [ELEMENTS.STRUCTURE]: {
        id: 'structure',
        label: 'Building Wall',
        walkable: false,
        habitats: [],
        topColor: 0xff9e78,
        sideColor: 0xa94e45,
        roughness: 0.7,
        moveCost: Infinity,
        pattern: 'building',
        visualPalette: 'storybookWall'
    }
};

const VARIANT_OVERRIDES = {
    [`${ELEMENTS.HYDRO}:4`]: {
        label: 'Brackish Water',
        topColor: 0x77a267,
        sideColor: 0x4a7145,
        pattern: 'marsh',
        visualPalette: 'marsh'
    },
    [`${ELEMENTS.HYDRO}:1`]: {
        label: 'Shallow Water',
        walkable: true,
        habitats: ['shore', 'shallow-water', 'ford'],
        topColor: 0x56e0dc,
        sideColor: 0x198fa8,
        moveCost: 1.6,
        waterDepth: 'shallow',
        crossing: 'ford',
        traversal: 'wade',
        pattern: 'waterShallow',
        visualPalette: 'shallowWater'
    },
    [`${ELEMENTS.HYDRO}:3`]: {
        label: 'Coastal Water',
        topColor: 0x21bdd2,
        sideColor: 0x126f92,
        pattern: 'waterCoastal',
        visualPalette: 'coastalWater'
    },
    [`${ELEMENTS.GEO}:1`]: {
        label: 'Forest Floor',
        topColor: 0x3eae55,
        sideColor: 0x624c37,
        moveCost: 1.2,
        pattern: 'forest',
        visualPalette: 'forest'
    },
    [`${ELEMENTS.GEO}:2`]: {
        label: 'Village Road',
        topColor: 0xe8c879,
        sideColor: 0x7e5b36,
        moveCost: 0.9,
        pattern: 'road',
        visualPalette: 'trail'
    },
    [`${ELEMENTS.GEO}:3`]: {
        label: 'Hill Ledge',
        topColor: 0x70c95b,
        sideColor: 0x6f4b39,
        moveCost: 1.28,
        pattern: 'hill',
        visualPalette: 'hill'
    },
    [`${ELEMENTS.GEO}:4`]: {
        label: 'Mountain Ledge',
        topColor: 0xaebc8c,
        sideColor: 0x69745c,
        moveCost: 1.45,
        pattern: 'stone',
        visualPalette: 'mountain'
    },
    [`${ELEMENTS.GEO}:5`]: {
        label: 'Village Ground',
        topColor: 0xb9cf72,
        sideColor: 0x73513c,
        moveCost: 0.96,
        pattern: 'villageGround',
        visualPalette: 'village'
    },
    [`${ELEMENTS.GEO}:6`]: {
        label: 'City Cobblestone',
        topColor: 0xe6d8b8,
        sideColor: 0x756b5c,
        moveCost: 0.88,
        pattern: 'cityCobble',
        visualPalette: 'cobble'
    },
    [`${ELEMENTS.GEO}:7`]: {
        label: 'City Plaza Stone',
        topColor: 0xf0dfb9,
        sideColor: 0x7a6b58,
        moveCost: 0.86,
        pattern: 'plazaStone',
        visualPalette: 'plaza'
    },
    [`${ELEMENTS.GEO}:8`]: {
        label: 'Garden Ground',
        topColor: 0x6ac75d,
        sideColor: 0x76513b,
        moveCost: 1.05,
        pattern: 'gardenGround',
        visualPalette: 'garden'
    },
    [`${ELEMENTS.CRYO}:1`]: {
        label: 'Ice Lake',
        topColor: 0xb8f0ff,
        sideColor: 0x75bdd7,
        moveCost: 1.24,
        pattern: 'ice',
        visualPalette: 'snow'
    },
    [`${ELEMENTS.STRUCTURE}:0`]: {
        label: 'Stone Wall',
        topColor: 0xb5c0cc,
        sideColor: 0x7e8b99,
        pattern: 'blocked',
        visualPalette: 'stoneWall'
    },
    [`${ELEMENTS.STRUCTURE}:1`]: {
        label: 'Town Wall',
        topColor: 0xffc36e,
        sideColor: 0xd8893c,
        pattern: 'brick',
        visualPalette: 'townWall'
    },
    [`${ELEMENTS.STRUCTURE}:2`]: {
        label: 'Building Floor',
        walkable: true,
        topColor: 0xd7b98a,
        sideColor: 0xa7754f,
        moveCost: 0.95,
        pattern: 'floor',
        visualPalette: 'wood'
    },
    [`${ELEMENTS.STRUCTURE}:3`]: {
        label: 'Stone Building Wall',
        topColor: 0xf3ead8,
        sideColor: 0xa9a18f,
        pattern: 'masonry',
        visualPalette: 'storybookWall'
    },
    [`${ELEMENTS.STRUCTURE}:4`]: {
        label: 'Timber Building Wall',
        topColor: 0xffb783,
        sideColor: 0xb76548,
        pattern: 'timber',
        visualPalette: 'timberWall'
    },
    [`${ELEMENTS.STRUCTURE}:5`]: {
        label: 'Oak Doorway',
        walkable: true,
        topColor: 0x9b633a,
        sideColor: 0x6f4028,
        moveCost: 0.9,
        pattern: 'doorOak',
        visualPalette: 'wood'
    },
    [`${ELEMENTS.STRUCTURE}:6`]: {
        label: 'Stairs',
        walkable: true,
        topColor: 0xc8aa7a,
        sideColor: 0x8c6540,
        moveCost: 1.05,
        pattern: 'stairs',
        visualPalette: 'wood'
    },
    [`${ELEMENTS.STRUCTURE}:7`]: {
        label: 'Iron Doorway',
        walkable: true,
        topColor: 0x66717b,
        sideColor: 0x343b42,
        moveCost: 0.9,
        pattern: 'doorIron',
        visualPalette: 'stoneWall'
    },
    [`${ELEMENTS.STRUCTURE}:8`]: {
        label: 'Painted Doorway',
        walkable: true,
        topColor: 0x3f7f79,
        sideColor: 0x28514d,
        moveCost: 0.9,
        pattern: 'doorPainted',
        visualPalette: 'paintedDoor'
    },
    [`${ELEMENTS.STRUCTURE}:9`]: {
        label: 'Stone Stairs',
        walkable: true,
        topColor: 0xc5cbd1,
        sideColor: 0x7d8790,
        moveCost: 1.05,
        pattern: 'masonry',
        visualPalette: 'stoneFloor'
    },
    [`${ELEMENTS.STRUCTURE}:10`]: {
        label: 'Timber Stairs',
        walkable: true,
        topColor: 0xd59a63,
        sideColor: 0x895936,
        moveCost: 1.05,
        pattern: 'timber',
        visualPalette: 'wood'
    },
    [`${ELEMENTS.STRUCTURE}:11`]: {
        label: 'Wood Floor Boards',
        walkable: true,
        topColor: 0xc1844d,
        sideColor: 0x82512e,
        moveCost: 0.94,
        pattern: 'woodFloor',
        visualPalette: 'wood'
    },
    [`${ELEMENTS.STRUCTURE}:12`]: {
        label: 'Stone Floor Slabs',
        walkable: true,
        topColor: 0xbec4bf,
        sideColor: 0x7b8582,
        moveCost: 0.96,
        pattern: 'stoneFloor',
        visualPalette: 'stoneFloor'
    },
    [`${ELEMENTS.STRUCTURE}:13`]: {
        label: 'Walkable City Wall',
        walkable: true,
        topColor: 0xaab1b2,
        sideColor: 0x687173,
        moveCost: 1,
        pattern: 'cityWallTop',
        visualPalette: 'stoneWall'
    },
    [`${ELEMENTS.STRUCTURE}:14`]: {
        label: 'City Wall Stairs',
        walkable: true,
        topColor: 0xb8b9ad,
        sideColor: 0x70766f,
        moveCost: 1.08,
        pattern: 'wallStairs',
        visualPalette: 'stoneWall'
    }
};

const ARCHITECTURE_GEO_TEXTURES = new Set([2, 6, 7]);
const ARCHITECTURE_STRUCTURE_TEXTURES = new Set([0, 1, 3, 4, 13, 14]);

export function isArchitectureThemeSurface(element, textureValue = 0) {
    const normalizedTexture = Number.isFinite(Number(textureValue))
        ? Math.max(0, Math.floor(Number(textureValue)))
        : 0;
    if (element === ELEMENTS.GEO) return ARCHITECTURE_GEO_TEXTURES.has(normalizedTexture);
    if (element === ELEMENTS.STRUCTURE) return ARCHITECTURE_STRUCTURE_TEXTURES.has(normalizedTexture);
    return false;
}

export function resolveArchitectureThemePalette(element, textureValue = 0, architectureThemeId = null) {
    const normalizedThemeId = normalizeBurgThemeId(architectureThemeId, null);
    if (!normalizedThemeId || !isArchitectureThemeSurface(element, textureValue)) return null;
    const theme = getBurgTheme(normalizedThemeId);
    return theme ? {
        architectureThemeId: normalizedThemeId,
        paletteId: theme.streetPaletteId,
        theme
    } : null;
}

export function getTileDefinition(element, textureValue = 0, paletteId = null, architectureThemeId = null) {
    const base = TILE_DEFINITIONS[element] || TILE_DEFINITIONS[ELEMENTS.VOID];
    const override = VARIANT_OVERRIDES[`${element}:${textureValue}`] || {};
    const definition = { ...base, ...override };
    const normalizedArchitectureThemeId = normalizeBurgThemeId(architectureThemeId, null);
    const architecturePalette = resolveArchitectureThemePalette(
        element,
        textureValue,
        normalizedArchitectureThemeId
    );
    const worldPaletteId = normalizeWorldPaletteId(paletteId, null);
    const usesWorldPalette = !architecturePalette && Boolean(worldPaletteId) && ![
        ELEMENTS.VOID,
        ELEMENTS.STRUCTURE
    ].includes(element);
    const resolvedPaletteId = architecturePalette?.paletteId || (usesWorldPalette
        ? worldPaletteId
        : definition.visualPalette);
    return {
        ...definition,
        paletteId: resolvedPaletteId,
        architectureThemeId: normalizedArchitectureThemeId,
        architecturePaletteId: architecturePalette?.paletteId || null,
        worldPaletteId: usesWorldPalette ? worldPaletteId : null,
        visualVariants: architecturePalette || usesWorldPalette
            ? getWorldPaletteVariants(resolvedPaletteId)
            : TILE_VISUAL_PALETTES[definition.visualPalette] || TILE_VISUAL_PALETTES.stoneWall
    };
}

export function isTileWalkable(element, textureValue = 0) {
    return getTileDefinition(element, textureValue).walkable;
}

export function tileSupportsHabitat(element, textureValue, habitat) {
    return getTileDefinition(element, textureValue).habitats.includes(habitat);
}
