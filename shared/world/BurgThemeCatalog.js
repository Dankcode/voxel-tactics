// Manifest-authoritative architecture themes shared by the offline FMG compilers and runtime.
//
// A burg's theme is selected in map-data-package/manifest.json and is never inferred from its
// culture, biome, name, or seed at runtime. Seeds only choose a deterministic visual variant
// inside the already-selected theme.

const THEME_DEFINITIONS = [
    {
        id: 'asian',
        label: 'Asian',
        streetPaletteId: 'asian-stone-lane',
        wallTextureId: 'asian-plaster-stone',
        styles: ['timber', 'stucco'],
        roofStyles: ['pagoda', 'tiled', 'hipped'],
        roofGeometries: ['swept-eaves', 'hipped'],
        facadeKits: ['asian-lacquered', 'asian-timber-screen', 'asian-courtyard'],
        castleKits: ['asian-tiered-citadel', 'asian-walled-palace'],
        themePalette: {
            roofColors: ['#d94b43', '#26766b', '#315a8c'],
            wallColor: '#f4e8cc',
            trimColor: '#4b3026',
            accentColor: '#e7b84b'
        }
    },
    {
        id: 'middle-eastern',
        label: 'Middle Eastern',
        streetPaletteId: 'middle-eastern-sandstone-lane',
        wallTextureId: 'middle-eastern-sandstone-plaster',
        styles: ['sandstone', 'stucco'],
        roofStyles: ['dome', 'terrace', 'flat'],
        roofGeometries: ['dome-and-parapet', 'flat-parapet'],
        facadeKits: ['middle-eastern-mashrabiya', 'middle-eastern-arcade', 'middle-eastern-bazaar'],
        castleKits: ['middle-eastern-citadel', 'middle-eastern-walled-palace'],
        themePalette: {
            roofColors: ['#2f8f83', '#3b6c8e', '#c9803d'],
            wallColor: '#e9c98f',
            trimColor: '#7b4931',
            accentColor: '#2f9b8f'
        }
    },
    {
        id: 'northern-european',
        label: 'Northern European',
        streetPaletteId: 'northern-european-cobble',
        wallTextureId: 'northern-european-granite',
        styles: ['timber', 'stone'],
        roofStyles: ['steep-gabled', 'slate', 'thatch'],
        roofGeometries: ['steep-gabled', 'turreted'],
        facadeKits: ['northern-half-timbered', 'northern-stave', 'northern-stone-guild'],
        castleKits: ['northern-crag-keep', 'northern-ring-fort'],
        themePalette: {
            roofColors: ['#34475a', '#5c2f35', '#6d5539'],
            wallColor: '#d8d3c7',
            trimColor: '#49382d',
            accentColor: '#4d86a8'
        }
    },
    {
        id: 'southern-european',
        label: 'Southern European',
        streetPaletteId: 'southern-european-paver',
        wallTextureId: 'southern-european-limestone-stucco',
        styles: ['stucco', 'stone'],
        roofStyles: ['clay', 'tiled', 'low-gabled'],
        roofGeometries: ['low-gabled', 'hipped'],
        facadeKits: ['southern-loggia', 'southern-painted-shutter', 'southern-courtyard'],
        castleKits: ['southern-hill-castle', 'southern-palazzo-fort'],
        themePalette: {
            roofColors: ['#c85f3e', '#d47b45', '#a74438'],
            wallColor: '#f0d9ad',
            trimColor: '#7a5638',
            accentColor: '#2f8f91'
        }
    },
    {
        id: 'egyptian',
        label: 'Egyptian',
        streetPaletteId: 'egyptian-sandstone-processional',
        wallTextureId: 'egyptian-cut-sandstone',
        styles: ['sandstone', 'stucco'],
        roofStyles: ['flat', 'pylon', 'terrace'],
        roofGeometries: ['flat-parapet', 'pylon'],
        facadeKits: ['egyptian-columned', 'egyptian-carved-stone', 'egyptian-courtyard'],
        castleKits: ['egyptian-pylon-fortress', 'egyptian-temple-citadel'],
        themePalette: {
            roofColors: ['#2a7f8e', '#b76532', '#d6a441'],
            wallColor: '#d8b66f',
            trimColor: '#80542d',
            accentColor: '#1f6f8c'
        }
    }
];

export const BURG_THEME_IDS = Object.freeze(THEME_DEFINITIONS.map((theme) => theme.id));

export const BURG_THEME_CATALOG = Object.freeze(Object.fromEntries(
    THEME_DEFINITIONS.map((theme) => [theme.id, freezeTheme(theme)])
));

const BURG_THEME_ID_SET = new Set(BURG_THEME_IDS);
const NORMALIZED_THEME_ALIASES = new Map(THEME_DEFINITIONS.flatMap((theme) => [
    [normalizeToken(theme.id), theme.id],
    [normalizeToken(theme.label), theme.id]
]));

export function isBurgThemeId(value) {
    return typeof value === 'string' && BURG_THEME_ID_SET.has(value);
}

export function normalizeBurgThemeId(value, fallback = null) {
    const source = value && typeof value === 'object'
        ? value.architectureThemeId ?? value.themeId ?? value.id
        : value;
    const normalized = NORMALIZED_THEME_ALIASES.get(normalizeToken(source));
    if (normalized) return normalized;
    if (fallback === null || fallback === undefined || fallback === '') return null;
    const fallbackSource = fallback && typeof fallback === 'object'
        ? fallback.architectureThemeId ?? fallback.themeId ?? fallback.id
        : fallback;
    return NORMALIZED_THEME_ALIASES.get(normalizeToken(fallbackSource)) || null;
}

export function getBurgTheme(value) {
    const themeId = normalizeBurgThemeId(value);
    return themeId ? BURG_THEME_CATALOG[themeId] : null;
}

/**
 * Resolve a deterministic building appearance inside a manifest-selected theme.
 *
 * Base style tokens are retained only when that theme explicitly allows them. They can never
 * move a building into another theme. An invalid theme is an authoring error and intentionally
 * throws instead of silently selecting a cross-culture fallback.
 */
export function resolveBurgThemeBuildingStyle(themeId, {
    district = 'residential',
    seed = 0,
    baseStyle = '',
    baseRoofStyle = '',
    baseArchitectureStyle = ''
} = {}) {
    const theme = getBurgTheme(themeId);
    if (!theme) throw new TypeError(`Unknown burg architecture theme: ${String(themeId)}`);
    const key = `${theme.id}:${district}:${seed}:${baseStyle}:${baseRoofStyle}:${baseArchitectureStyle}`;
    const style = theme.styles.includes(normalizeToken(baseStyle))
        ? normalizeToken(baseStyle)
        : choose(theme.styles, `${key}:style`);
    const roofStyle = theme.roofStyles.includes(normalizeToken(baseRoofStyle))
        ? normalizeToken(baseRoofStyle)
        : choose(theme.roofStyles, `${key}:roof-style`);
    const roofGeometry = choose(theme.roofGeometries, `${key}:roof-geometry`);
    const facadeKit = choose(theme.facadeKits, `${key}:facade`);
    const castleKit = choose(theme.castleKits, `${key}:castle`);
    return Object.freeze({
        architectureThemeId: theme.id,
        themeLabel: theme.label,
        style,
        roofStyle,
        roofGeometry,
        facadeKit,
        castleKit,
        themePalette: theme.themePalette,
        streetPaletteId: theme.streetPaletteId,
        wallTextureId: theme.wallTextureId
    });
}

export function serializeBurgThemeCatalog() {
    return Object.freeze(BURG_THEME_IDS.map((id) => {
        const theme = BURG_THEME_CATALOG[id];
        return Object.freeze({
            id: theme.id,
            label: theme.label,
            streetPaletteId: theme.streetPaletteId,
            wallTextureId: theme.wallTextureId
        });
    }));
}

export function validateBurgThemeCatalog(catalog = BURG_THEME_CATALOG) {
    const errors = [];
    if (!catalog || typeof catalog !== 'object' || Array.isArray(catalog)) {
        return { valid: false, errors: ['burg theme catalog must be an object.'] };
    }
    const ids = Object.keys(catalog);
    for (const themeId of BURG_THEME_IDS) {
        const theme = catalog[themeId];
        if (!theme) {
            errors.push(`burg theme catalog is missing ${themeId}.`);
            continue;
        }
        if (theme.id !== themeId) errors.push(`burg theme ${themeId}.id must equal its catalog key.`);
        if (typeof theme.label !== 'string' || !theme.label) errors.push(`burg theme ${themeId}.label is required.`);
        if (typeof theme.streetPaletteId !== 'string' || !theme.streetPaletteId) {
            errors.push(`burg theme ${themeId}.streetPaletteId is required.`);
        }
        if (typeof theme.wallTextureId !== 'string' || !theme.wallTextureId) {
            errors.push(`burg theme ${themeId}.wallTextureId is required.`);
        }
        for (const field of ['styles', 'roofStyles', 'roofGeometries', 'facadeKits', 'castleKits']) {
            if (!Array.isArray(theme[field]) || !theme[field].length ||
                !theme[field].every((value) => typeof value === 'string' && value)) {
                errors.push(`burg theme ${themeId}.${field} must be a non-empty string array.`);
            }
        }
        const palette = theme.themePalette;
        if (!palette || !Array.isArray(palette.roofColors) || !palette.roofColors.length) {
            errors.push(`burg theme ${themeId}.themePalette.roofColors is required.`);
        }
        for (const field of ['wallColor', 'trimColor', 'accentColor']) {
            if (!isHexColor(palette?.[field])) errors.push(`burg theme ${themeId}.themePalette.${field} must be a hex color.`);
        }
        for (const color of palette?.roofColors || []) {
            if (!isHexColor(color)) errors.push(`burg theme ${themeId}.themePalette.roofColors must contain hex colors.`);
        }
    }
    for (const id of ids) {
        if (!BURG_THEME_ID_SET.has(id)) errors.push(`burg theme catalog contains unknown theme ${id}.`);
    }
    return { valid: errors.length === 0, errors };
}

export function validateManifestBurgThemes(manifest, burgs = manifest?.burgs) {
    const errors = [];
    const catalog = manifest?.burg_theme_catalog;
    const mapping = manifest?.burg_theme_by_id;
    const records = Array.isArray(burgs) ? burgs : [];
    if (!Array.isArray(catalog)) {
        errors.push('manifest.burg_theme_catalog must be an array.');
    } else {
        const catalogIds = new Set();
        for (const [index, entry] of catalog.entries()) {
            const path = `manifest.burg_theme_catalog[${index}]`;
            if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
                errors.push(`${path} must be an object.`);
                continue;
            }
            if (!isBurgThemeId(entry.id)) errors.push(`${path}.id must be a canonical burg theme ID.`);
            if (catalogIds.has(entry.id)) errors.push(`${path}.id is duplicated.`);
            catalogIds.add(entry.id);
            const expectedLabel = BURG_THEME_CATALOG[entry.id]?.label;
            if (entry.label !== expectedLabel) errors.push(`${path}.label must be ${String(expectedLabel)}.`);
        }
        for (const themeId of BURG_THEME_IDS) {
            if (!catalogIds.has(themeId)) errors.push(`manifest.burg_theme_catalog is missing ${themeId}.`);
        }
        for (const themeId of catalogIds) {
            if (!BURG_THEME_ID_SET.has(themeId)) {
                errors.push(`manifest.burg_theme_catalog contains unknown theme ${String(themeId)}.`);
            }
        }
    }
    if (!mapping || typeof mapping !== 'object' || Array.isArray(mapping)) {
        errors.push('manifest.burg_theme_by_id must be an object.');
    }
    if (!records.length) errors.push('manifest.burgs must be a non-empty array.');

    const burgIds = new Set();
    const themeByBurgId = new Map();
    for (const [index, burg] of records.entries()) {
        const burgId = Number(burg?.id);
        const path = `manifest.burgs[${index}]`;
        if (!Number.isInteger(burgId) || burgId < 1) {
            errors.push(`${path}.id must be a positive integer.`);
            continue;
        }
        if (burgIds.has(burgId)) errors.push(`${path}.id is duplicated.`);
        burgIds.add(burgId);
        const themeId = mapping?.[String(burgId)];
        if (!isBurgThemeId(themeId)) {
            errors.push(`manifest.burg_theme_by_id.${burgId} must be a canonical burg theme ID.`);
            continue;
        }
        themeByBurgId.set(burgId, themeId);
    }
    for (const key of Object.keys(mapping || {})) {
        const burgId = Number(key);
        if (!Number.isInteger(burgId) || String(burgId) !== key || !burgIds.has(burgId)) {
            errors.push(`manifest.burg_theme_by_id contains unknown burg ID ${key}.`);
        }
    }
    return { valid: errors.length === 0, errors, themeByBurgId };
}

export function resolveManifestBurgTheme(manifest, burgId) {
    const id = Number(burgId);
    if (!Number.isInteger(id) || id < 1) throw new TypeError('burgId must be a positive integer.');
    const themeId = manifest?.burg_theme_by_id?.[String(id)];
    if (!isBurgThemeId(themeId)) {
        throw new TypeError(`Manifest has no valid architecture theme for burg ${id}.`);
    }
    return themeId;
}

function freezeTheme(theme) {
    return Object.freeze({
        ...theme,
        styles: Object.freeze([...theme.styles]),
        roofStyles: Object.freeze([...theme.roofStyles]),
        roofGeometries: Object.freeze([...theme.roofGeometries]),
        facadeKits: Object.freeze([...theme.facadeKits]),
        castleKits: Object.freeze([...theme.castleKits]),
        themePalette: Object.freeze({
            ...theme.themePalette,
            roofColors: Object.freeze([...theme.themePalette.roofColors])
        })
    });
}

function normalizeToken(value) {
    return String(value ?? '')
        .trim()
        .toLowerCase()
        .replace(/[_\s]+/g, '-')
        .replace(/-+/g, '-');
}

function choose(values, key) {
    return values[hashString(key) % values.length];
}

function hashString(value) {
    let hash = 2166136261;
    const source = String(value);
    for (let index = 0; index < source.length; index++) {
        hash ^= source.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
}

function isHexColor(value) {
    return /^#[0-9a-f]{6}$/i.test(String(value || ''));
}
