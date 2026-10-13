import {buildParkDistrict,buildMallDistrict,buildDrainageDistrict} from './LargeDistricts.js';
import { buildSunkenBoulevard,buildFreightTerraces,buildSunkenJunction } from './ConnectingDistricts.js';
// Map registry: every playable battlefield, grouped by theme. Present-day settings only (no aliens yet);
// the opposing force is the Syndicate, a human crime organisation (shared/content/units.js FACTIONS).
import { buildArchitectureYard, ARCHITECTURE_YARD_ID } from './ArchitectureYard.js';
import { buildCedarClose, CEDAR_CLOSE_ID } from './CedarClose.js';
import { buildProvingGrounds, PROVING_GROUNDS_ID } from './ProvingGrounds.js';
import { buildMainStreet, MAIN_STREET_ID } from './MainStreet.js';
import { buildHarbor, HARBOR_ID } from './Harbor.js';
import { buildRoute9, ROUTE9_ID } from './Route9.js';

import { buildPackagedMap } from '../mapgen/PackageBuilder.js';
import { MAP_PACKAGES } from './generated/PackageCatalog.js';

export const MAPS = Object.freeze([
    {id:'park-district',name:'Park District',theme:'Large districts',text:'96 × 72 rectangle: raised rounded park, broad steps, dense retail and park-side offices.',build:buildParkDistrict},
    {id:'mall-district',name:'Market Arcade',theme:'Large districts',text:'96 × 72 L footprint: merged shopping interiors, close retail parcels and a terraced park.',build:buildMallDistrict},
    {id:'drainage-district',name:'Drainage Quarter',theme:'Large districts',text:'96 × 72 T footprint: turning water channels, dry banks, stair entrances and shortcut ladders.',build:buildDrainageDistrict},
    {id:'sunken-junction',name:'Sunken Junction',theme:'Split-level districts',text:'Linked sunken boulevards with a T-junction, covered crossings, rounded retail and square industrial parcels.',build:buildSunkenJunction},
    {id:'sunken-boulevard',name:'Sunken Boulevard',theme:'Split-level districts',text:'A lower street passes beneath an upper boulevard, with road ramps and a covered crossing.',build:buildSunkenBoulevard},
    {id:'freight-terraces',name:'Freight Terraces',theme:'Split-level districts',text:'Low warehouses, raised loading decks, cargo lanes and a service catwalk.',build:buildFreightTerraces},
    {id:ARCHITECTURE_YARD_ID,name:"Architecture Yard",theme:"Training",text:"Walk through full glass, vault solid window sills, inspect window families and rounded facades.",build:buildArchitectureYard},
    ...MAP_PACKAGES.map(pkg => ({id:pkg.manifest.id,name:pkg.manifest.name,theme:pkg.manifest.theme,text:pkg.design.mission.briefing,concept:`/maps/${pkg.manifest.id}/${pkg.manifest.reference}`,build: options => buildPackagedMap(pkg, { ...options, strict: false })})),
    { id: CEDAR_CLOSE_ID, name: 'Cedar Close', theme: 'Suburbs', text: 'Two modern homes on a quiet close. Glass walls, gardens, a residential street.', build: buildCedarClose },
    { id: MAIN_STREET_ID, name: 'Main Street', theme: 'Downtown', text: 'Shops, a diner and an office block on a main road. Storefront glass, roadworks, a parking lot.', build: buildMainStreet },
    { id: HARBOR_ID, name: 'Harbor Yard', theme: 'Industrial', text: 'A container yard on the quay at night: stacked containers, a warehouse with roller doors, fuel drums.', build: buildHarbor },
    { id: ROUTE9_ID, name: 'Route 9 Stop', theme: 'Roadside', text: 'A gas station, a motel and its parking lot beside the highway. The pumps explode.', build: buildRoute9 },
    { id: PROVING_GROUNDS_ID, name: 'Training Facility', theme: 'Training', text: 'Every system in one map: firing range, bunker, fuel store, watchtower, pond, hill.', build: buildProvingGrounds }
]);

export const DEFAULT_MAP = CEDAR_CLOSE_ID;
export const mapById = id => MAPS.find(m => m.id === id) || null;
