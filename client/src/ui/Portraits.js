// Authored UI heads are separate from the procedural field-art pipeline.
const SQUAD_HEADS = new Set(['vanguard', 'grenadier', 'marksman', 'warden']);

export function portraitSrc(unit) {
    const art = unit.art || unit.type || 'test-soldier';
    const file = SQUAD_HEADS.has(art) ? 'head.png' : 'portrait.png';
    return `/assets/characters/${encodeURIComponent(art)}/${file}`;
}
