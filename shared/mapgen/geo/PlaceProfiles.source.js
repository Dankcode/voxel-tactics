// PLAN-15: which real places feed which generator family, and the bake itself (used by tools/geo/place-profiles.mjs
// and by the test that keeps PlaceProfiles.generated.js in step with the catalog).
import { derivePlaceProfile, themeProfile } from './PlaceProfile.js';

/** Catalog theme → generator family. Landmarks are downtown neighbourhoods; a strip centre is the suburb's shops. */
export const THEME_FAMILY = Object.freeze({ Downtown: 'downtown', Landmark: 'downtown', 'Strip centre': 'suburb', Suburbs: 'suburb', Industrial: 'industrial' });

export function bakedProfiles(maps) {
    const byFamily = {};
    for (const g of maps) {
        const fam = THEME_FAMILY[g.theme]; if (!fam) continue;
        (byFamily[fam] ||= []).push(derivePlaceProfile(g.geo, { id: g.id }));
    }
    return Object.fromEntries(Object.entries(byFamily).sort(([a], [b]) => (a < b ? -1 : 1)).map(([f, list]) => [f, themeProfile(list)]));
}
