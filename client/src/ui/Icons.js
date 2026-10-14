// Inline SVG icons for the HUD (stroke icons, currentColor). Placeholders in the same spirit as the art:
// swap any string for your own SVG.
const svg = (body, vb = '0 0 24 24') => `<svg viewBox="${vb}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

export const ICONS = {
    cube:svg('<path d="M12 2L22 7V17L12 22L2 17V7ZM2 7L12 12L22 7M12 12V22M12 2V12"/>'),
    helmet:svg('<path d="M3 15V11A9 9 0 0 1 21 11V16H15L12 20L9 16H3M3 12H21"/>'),
    armor:svg('<path d="M8 3L10 6H14L16 3L21 8L17 12V21H7V12L3 8Z"/><path d="M9 9H15V17H9Z"/>'),
    backpack:svg('<rect x="5" y="6" width="14" height="16" rx="3"/><path d="M9 6V3H15V6M5 13H19M9 16V19M15 16V19"/>'),

    fire: svg('<circle cx="12" cy="12" r="7"/><path d="M12 2v5M12 17v5M2 12h5M17 12h5"/><circle cx="12" cy="12" r="1.5" fill="currentColor"/>'),
    rifle: svg('<path d="M2 10H6V7H16V9H22V11H15L13 15H10L9 11H6L3 15H2ZM10 7V5H14V7M5 10V7M17 9V6"/>'),
    shotgun: svg('<path d="M2 12H6V8H22V11H12L10 15H7L6 12L3 16H2ZM12 8V6H22M13 11V13H18"/>'),
    pistol: svg('<path d="M4 7H21V11H13L10 20H5L8 11H4ZM14 11V14H11M5 7V5H9V7"/>'),
    sniper: svg('<path d="M2 12H8V9H20V11H23M8 12L6 17H3L4 12M11 12L12 16H15L14 12M12 9V5H18V9M10 6H20"/>'),
    melee: svg('<path d="M14.5 3.5l6 0 0 6-10 10-6-6z"/><path d="M4 20l3-3M7 14l3 3"/>'),
    grenade: svg('<circle cx="11" cy="14" r="6"/><path d="M11 8V5h3l2 2"/><path d="M17 4l2-1M18 7h2"/>'),
    overwatch: svg('<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>'),
    reload: svg('<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/>'),
    ability: svg('<path d="M12 3l2.6 5.6 6.1.7-4.5 4.2 1.2 6L12 16.6 6.6 19.5l1.2-6-4.5-4.2 6.1-.7z"/>'),
    formation: svg('<path d="M4 17l4-4 4 4 4-4 4 4"/><path d="M4 11l4-4 4 4 4-4 4 4"/>'),
    breach: svg('<rect x="6" y="3" width="12" height="18" rx="1"/><path d="M2 8l4 2M2 16l4-2M22 12h-4" /><path d="M12 8l2 4-2 4"/>'),
    door: svg('<rect x="6" y="3" width="12" height="18" rx="1"/><circle cx="15" cy="12" r="1" fill="currentColor"/>'),
    dash: svg('<path d="M5 12h10M11 6l6 6-6 6"/><path d="M3 8h4M3 16h4"/>'),
    rally: svg('<path d="M5 21V4M5 4h11l-2 4 2 4H5"/>'),
    suppress: svg('<path d="M3 12h12M3 7h9M3 17h9"/><path d="M17 8l4 4-4 4"/>'),
    rotL: svg('<path d="M4 12a8 8 0 1 0 2.3-5.7"/><path d="M4 4v5h5"/>'),
    rotR: svg('<path d="M20 12a8 8 0 1 1-2.3-5.7"/><path d="M20 4v5h-5"/>'),
    up: svg('<path d="M6 15l6-6 6 6"/>'),
    down: svg('<path d="M6 9l6 6 6-6"/>'),
    gear: svg('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.6 1.6 0 0 0-1-1.5 1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.6 1.6 0 0 0 1.5-1 1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z"/>'),
    bug: svg('<rect x="7" y="8" width="10" height="12" rx="5"/><path d="M12 8v12M9 5l1.5 2M15 5l-1.5 2M3 13h4M17 13h4M4 8l3 2M20 8l-3 2M4 19l3-2M20 19l-3-2"/>'),
    menu: svg('<path d="M4 6h16M4 12h16M4 18h16"/>')
};
export function weaponIcon(w){return ICONS[w.kind==='melee'?'melee':w.id==='handcannon'?'pistol':w.ammoType==='shotgun'?'shotgun':w.scoped?'sniper':'rifle'];}
