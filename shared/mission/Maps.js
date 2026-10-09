// Map registry: every playable battlefield, grouped by theme. Present-day settings only (no aliens yet);
// the opposing force is the Syndicate, a human crime organisation (shared/content/units.js FACTIONS).
import { buildCedarClose, CEDAR_CLOSE_ID } from './CedarClose.js';
import { buildProvingGrounds, PROVING_GROUNDS_ID } from './ProvingGrounds.js';
import { buildMainStreet, MAIN_STREET_ID } from './MainStreet.js';
import { buildHarbor, HARBOR_ID } from './Harbor.js';
import { buildRoute9, ROUTE9_ID } from './Route9.js';

import { buildImageMap } from '../mapgen/PackageBuilder.js';
import { GENERATED_SITES } from './generated/GeneratedSites.js';
import { CEDAR_IMAGE_SITE } from './generated/CedarImage.js';

export const MAPS = Object.freeze([
    ...GENERATED_SITES.map(site => ({id:site.id,name:site.name || site.id,theme:site.theme || 'Generated',text:'Reference design adapted to connected combat flow.',build: options => buildImageMap(site, options)})),
    { id: CEDAR_IMAGE_SITE.id, name: CEDAR_IMAGE_SITE.name, theme: 'Suburbs', text: 'Screenshot study: sidewalk approach, driveway flank and back-garden route at dusk.', build: options => buildImageMap(CEDAR_IMAGE_SITE, options) },
    { id: CEDAR_CLOSE_ID, name: 'Cedar Close', theme: 'Suburbs', text: 'Two modern homes on a quiet close. Glass walls, gardens, a residential street.', build: buildCedarClose },
    { id: MAIN_STREET_ID, name: 'Main Street', theme: 'Downtown', text: 'Shops, a diner and an office block on a main road. Storefront glass, roadworks, a parking lot.', build: buildMainStreet },
    { id: HARBOR_ID, name: 'Harbor Yard', theme: 'Industrial', text: 'A container yard on the quay at night: stacked containers, a warehouse with roller doors, fuel drums.', build: buildHarbor },
    { id: ROUTE9_ID, name: 'Route 9 Stop', theme: 'Roadside', text: 'A gas station, a motel and its parking lot beside the highway. The pumps explode.', build: buildRoute9 },
    { id: PROVING_GROUNDS_ID, name: 'Training Facility', theme: 'Training', text: 'Every system in one map: firing range, bunker, fuel store, watchtower, pond, hill.', build: buildProvingGrounds }
]);

export const DEFAULT_MAP = CEDAR_CLOSE_ID;
export const mapById = id => MAPS.find(m => m.id === id) || null;
