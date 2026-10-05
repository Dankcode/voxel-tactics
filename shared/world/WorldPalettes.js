import {
    BURG_THEME_IDS,
    getBurgTheme,
    normalizeBurgThemeId
} from './BurgThemeCatalog.js';

/**
 * World-level colour families used by procedural terrain.
 *
 * A generated cell only needs to store a palette id and a visual variant. The
 * six variants are deliberately finite so CanvasTextures can be shared rather
 * than creating a unique material for every coordinate in a large world.
 */

export const VISUAL_VARIANT_COUNT = 6;
export const DEFAULT_WORLD_PALETTE_ID = 'meadow';

const variant = (topColor, sideColor, accentColor, highlightColor) => Object.freeze({
    topColor,
    sideColor,
    accentColor,
    highlightColor
});

const palette = (id, label, variants) => Object.freeze({
    id,
    label,
    variants: Object.freeze(variants)
});

/**
 * Original, high-saturation storybook palettes. Every family has exactly six
 * coherent variants (0..5), giving WFC biomes their own identity while still
 * allowing neighboring tiles to share materials.
 */
const BASE_WORLD_PALETTES = Object.freeze({
    meadow: palette('meadow', 'Sunlit Meadow', [
        variant(0x69dc55, 0x76503a, 0xc9f064, 0xf2ffa0),
        variant(0x7fe25a, 0x7f5438, 0xacef56, 0xf7ff9b),
        variant(0x54d66a, 0x674b3b, 0x91ed73, 0xd9ffa0),
        variant(0x91df50, 0x83563c, 0xdff16b, 0xffffa8),
        variant(0x5fcb50, 0x6b4837, 0x7fe75e, 0xc8ff89),
        variant(0x87d96b, 0x805c40, 0xc5e982, 0xf1ffb0)
    ]),
    forest: palette('forest', 'Emerald Forest', [
        variant(0x2eb45e, 0x4b4935, 0x66dc67, 0xb5f58b),
        variant(0x219d55, 0x3d4235, 0x52cb5f, 0x9de97e),
        variant(0x38bd60, 0x594a35, 0x7cde65, 0xc5f48a),
        variant(0x269d69, 0x3d4740, 0x4fce82, 0x9bedaf),
        variant(0x45b951, 0x604d34, 0x91d85f, 0xd4f28b),
        variant(0x1fa064, 0x39443d, 0x5bcf78, 0xa5ef9c)
    ]),
    coast: palette('coast', 'Turquoise Coast', [
        variant(0x25cbd4, 0x0a739b, 0x72efe1, 0xd2fff7),
        variant(0x26bfe5, 0x096b9e, 0x6ce7f6, 0xc9faff),
        variant(0x36d6c3, 0x0f8191, 0x8df3d5, 0xdefff3),
        variant(0x19b6d7, 0x075f8d, 0x55dcec, 0xbff7ff),
        variant(0x31c9eb, 0x0b73aa, 0x87eaff, 0xd9f8ff),
        variant(0x2bd3b4, 0x0b7d7c, 0x84efd0, 0xd8fff0)
    ]),
    path: palette('path', 'Honey Path', [
        variant(0xf2c86d, 0xa76b3f, 0xffe29a, 0xffffc4),
        variant(0xe9b95f, 0x945c3b, 0xf9d382, 0xffedac),
        variant(0xf5d58b, 0xb17846, 0xffe9aa, 0xffffcf),
        variant(0xdcae68, 0x865940, 0xf0c982, 0xffe7ae),
        variant(0xefc47e, 0xa36a48, 0xffdc9d, 0xffefbd),
        variant(0xe5ca8c, 0x9b7450, 0xf7dfa7, 0xfff2c8)
    ]),
    desert: palette('desert', 'Sunset Desert', [
        variant(0xffd35f, 0xc8793d, 0xffed91, 0xffffc0),
        variant(0xffbf5c, 0xbb6740, 0xffdc7e, 0xfff2ae),
        variant(0xffdf76, 0xcf8846, 0xffefa0, 0xffffcd),
        variant(0xf6b85d, 0xae6241, 0xffcf79, 0xffe8a2),
        variant(0xffc978, 0xc56d4b, 0xffe19b, 0xfff3bf),
        variant(0xedc96b, 0xa9763f, 0xffe58c, 0xfff7b7)
    ]),
    savanna: palette('savanna', 'Golden Savanna', [
        variant(0xbad94f, 0x7d5834, 0xe8ea61, 0xffff9d),
        variant(0xa8cf4d, 0x73513a, 0xd4df57, 0xf4f98d),
        variant(0xc8dc55, 0x895c36, 0xf1e86a, 0xffffa5),
        variant(0x9fc65b, 0x694e3b, 0xcadb6b, 0xecf59a),
        variant(0xd2d75a, 0x8b623b, 0xf4df6c, 0xfff9a0),
        variant(0xb2ce68, 0x765a41, 0xd9de78, 0xf6f4a8)
    ]),
    jungle: palette('jungle', 'Blooming Jungle', [
        variant(0x18b969, 0x31523c, 0x53e480, 0xa6f7a3),
        variant(0x12a85d, 0x29483b, 0x3ad37b, 0x8beea1),
        variant(0x27c263, 0x3a5738, 0x6fe978, 0xb8f99c),
        variant(0x0eaa77, 0x284b43, 0x43d99b, 0x91f1bd),
        variant(0x31b74e, 0x48543a, 0x85dc5f, 0xcaf28a),
        variant(0x17b883, 0x2d5046, 0x58dfaa, 0xa4f6cf)
    ]),
    wetland: palette('wetland', 'Luminous Wetland', [
        variant(0x63b983, 0x3d695b, 0x83db9b, 0xc6f2b4),
        variant(0x54a879, 0x365f58, 0x6bc997, 0xafe5bd),
        variant(0x75bd73, 0x466b50, 0xa0d78a, 0xd9efb0),
        variant(0x4eae91, 0x315f60, 0x71d5b4, 0xb9eee0),
        variant(0x79ae68, 0x526748, 0xaac77d, 0xe0e5a3),
        variant(0x59b5a0, 0x386568, 0x79d8c8, 0xc2f4eb)
    ]),
    taiga: palette('taiga', 'Blue Spruce Taiga', [
        variant(0x4fa888, 0x465556, 0x76cab0, 0xb7e9cf),
        variant(0x429579, 0x3d4d52, 0x63b9a0, 0xa3ddc2),
        variant(0x5baa83, 0x535a50, 0x82c69e, 0xc0e5bb),
        variant(0x3e9691, 0x3b5059, 0x5dbdc1, 0xa6e1e5),
        variant(0x649d77, 0x56584c, 0x8abd91, 0xc9deaf),
        variant(0x4c9e9e, 0x40535b, 0x70c3c8, 0xb2e6e8)
    ]),
    tundra: palette('tundra', 'Aurora Tundra', [
        variant(0xdaf7f2, 0x86bdc7, 0xb3eee8, 0xffffff),
        variant(0xd7edff, 0x86afd0, 0xaed8f5, 0xf9ffff),
        variant(0xeee5ff, 0xa89fcf, 0xd6c7f5, 0xffffff),
        variant(0xd4f3ed, 0x7eb9b1, 0xa9e2d7, 0xf5ffff),
        variant(0xf1e7f4, 0xb39dbd, 0xdcc8e4, 0xffffff),
        variant(0xdbeefa, 0x8dacbf, 0xb9d8e9, 0xfbffff)
    ]),
    alpine: palette('alpine', 'Wildflower Alpine', [
        variant(0x9ebda0, 0x66736b, 0xc5d99d, 0xf0efc2),
        variant(0x91b4a4, 0x5b6d6d, 0xb5d4b2, 0xe5f0d0),
        variant(0xb2bd91, 0x766f62, 0xddd39b, 0xffefc2),
        variant(0x8eaeb6, 0x596c7a, 0xb6ccd6, 0xe7f1f5),
        variant(0xa9b798, 0x6d7165, 0xd3d0aa, 0xf5efd1),
        variant(0x9aa5b3, 0x606779, 0xc6c5dd, 0xeeebff)
    ]),
    crystal: palette('crystal', 'Prismatic Crystal', [
        variant(0x8f6be8, 0x4d438e, 0x52dce5, 0xe2d5ff),
        variant(0x647ee8, 0x3d4b91, 0x63c9f2, 0xd5e8ff),
        variant(0xbb64df, 0x70408d, 0xf08edb, 0xffd6f4),
        variant(0x5e9fe1, 0x38648b, 0x58e1d0, 0xcffff5),
        variant(0xd16bc5, 0x82446f, 0xff9fbd, 0xffd9e7),
        variant(0x7470dc, 0x45447e, 0x8ee0ef, 0xdafaff)
    ])
});

/**
 * Architecture palettes are generated from the five manifest-authoritative burg
 * themes. Each palette remains six variants wide, so a large town can vary its
 * paving and masonry without creating coordinate-specific materials.
 */
export const BURG_THEME_STREET_PALETTES = Object.freeze(Object.fromEntries(
    BURG_THEME_IDS.map((themeId) => {
        const theme = getBurgTheme(themeId);
        return [theme.streetPaletteId, createBurgThemeStreetPalette(theme)];
    })
));

export const BURG_THEME_STREET_PALETTE_IDS = Object.freeze(
    BURG_THEME_IDS.map((themeId) => getBurgTheme(themeId).streetPaletteId)
);

export const WORLD_PALETTES = Object.freeze({
    ...BASE_WORLD_PALETTES,
    ...BURG_THEME_STREET_PALETTES
});

export const WORLD_PALETTE_IDS = Object.freeze(Object.keys(WORLD_PALETTES));

export function getBurgThemeStreetPaletteId(themeId, fallback = null) {
    const normalizedThemeId = normalizeBurgThemeId(themeId, null);
    return normalizedThemeId
        ? getBurgTheme(normalizedThemeId).streetPaletteId
        : fallback;
}

function createBurgThemeStreetPalette(theme) {
    const wall = colorNumber(theme.themePalette.wallColor);
    const trim = colorNumber(theme.themePalette.trimColor);
    const accent = colorNumber(theme.themePalette.accentColor);
    const roofs = theme.themePalette.roofColors.map((color) => colorNumber(color));
    const roof = (index) => roofs[index % roofs.length];
    const light = 0xffffff;

    return palette(theme.streetPaletteId, `${theme.label} Streets`, [
        variant(mixColor(wall, accent, 0.08), mixColor(trim, wall, 0.24), accent, mixColor(wall, light, 0.36)),
        variant(mixColor(wall, roof(0), 0.13), mixColor(trim, roof(0), 0.16), roof(0), mixColor(wall, light, 0.28)),
        variant(mixColor(wall, trim, 0.10), mixColor(trim, wall, 0.14), mixColor(accent, roof(1), 0.24), mixColor(wall, light, 0.43)),
        variant(mixColor(wall, accent, 0.17), mixColor(trim, accent, 0.12), roof(1), mixColor(accent, light, 0.42)),
        variant(mixColor(wall, roof(2), 0.16), mixColor(trim, roof(2), 0.19), mixColor(accent, roof(2), 0.22), mixColor(wall, light, 0.32)),
        variant(mixColor(wall, trim, 0.18), mixColor(trim, wall, 0.30), accent, mixColor(wall, light, 0.48))
    ]);
}

function colorNumber(value) {
    if (Number.isFinite(value)) return Math.max(0, Math.min(0xffffff, Math.trunc(value)));
    const parsed = Number.parseInt(String(value || '').replace(/^#/, ''), 16);
    return Number.isFinite(parsed) ? parsed : 0;
}

function mixColor(from, to, amount) {
    const ratio = Math.max(0, Math.min(1, Number(amount) || 0));
    const channel = (shift) => Math.round(
        ((from >> shift) & 0xff) * (1 - ratio) + ((to >> shift) & 0xff) * ratio
    );
    return (channel(16) << 16) | (channel(8) << 8) | channel(0);
}

const PALETTE_ALIASES = Object.freeze({
    grass: 'meadow',
    grassland: 'meadow',
    plains: 'meadow',
    prairie: 'meadow',
    woodland: 'forest',
    woods: 'forest',
    shore: 'coast',
    coastal: 'coast',
    ocean: 'coast',
    sea: 'coast',
    road: 'path',
    roads: 'path',
    trail: 'path',
    plaza: 'path',
    arid: 'desert',
    dunes: 'desert',
    sand: 'desert',
    steppe: 'savanna',
    rainforest: 'jungle',
    tropical: 'jungle',
    swamp: 'wetland',
    marsh: 'wetland',
    bog: 'wetland',
    boreal: 'taiga',
    coniferous: 'taiga',
    snow: 'tundra',
    ice: 'tundra',
    polar: 'tundra',
    mountain: 'alpine',
    mountains: 'alpine',
    highland: 'alpine',
    crystalline: 'crystal',
    magical: 'crystal'
});

export function normalizeWorldPaletteId(value, fallback = null) {
    if (typeof value !== 'string') return fallback;
    const normalized = value.trim().toLowerCase().replace(/[\s_-]+/g, '-');
    if (WORLD_PALETTES[normalized]) return normalized;
    return PALETTE_ALIASES[normalized] || fallback;
}

export function getWorldPalette(paletteId, fallback = DEFAULT_WORLD_PALETTE_ID) {
    const normalized = normalizeWorldPaletteId(paletteId, fallback);
    return WORLD_PALETTES[normalized] || WORLD_PALETTES[DEFAULT_WORLD_PALETTE_ID];
}

export function getWorldPaletteVariants(paletteId, fallback = DEFAULT_WORLD_PALETTE_ID) {
    return getWorldPalette(paletteId, fallback).variants;
}

export function normalizeWorldVisualVariant(value, fallback = null) {
    let parsed = null;
    if (Number.isFinite(value)) {
        parsed = Math.trunc(value);
    } else if (typeof value === 'string' && value.trim()) {
        const text = value.trim();
        parsed = Number.parseInt(text, text.length === 1 ? 36 : 10);
    }
    if (!Number.isFinite(parsed)) return fallback;
    return ((parsed % VISUAL_VARIANT_COUNT) + VISUAL_VARIANT_COUNT) % VISUAL_VARIANT_COUNT;
}

export function resolveWorldPaletteVariant(
    paletteId,
    visualVariant = 0,
    fallback = DEFAULT_WORLD_PALETTE_ID
) {
    const paletteDefinition = getWorldPalette(paletteId, fallback);
    const index = normalizeWorldVisualVariant(visualVariant, 0);
    return {
        paletteId: paletteDefinition.id,
        visualVariant: index,
        ...paletteDefinition.variants[index]
    };
}
