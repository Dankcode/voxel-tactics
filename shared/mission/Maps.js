import {buildParkDistrict,buildMallDistrict,buildDrainageDistrict,buildTerraceHeights,buildSuburbDistrict,buildDowntownDistrict,buildDocksideDistrict,buildHighwayDistrict} from './LargeDistricts.js';
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
import { placeMapDefs } from './PlaceMaps.js';

export const MAPS = Object.freeze([
    {id:'park-district',name:'Civic District',theme:'Large districts',text:'96 × 72 rectangle: street-level shop rows, lots and yards solved as parcel mixes.',build:buildParkDistrict},
    {id:'mall-district',name:'Market Arcade',theme:'Large districts',text:'96 × 72 L footprint: merged shopping interiors, retail parcels with their lots and service paths.',build:buildMallDistrict},
    {id:'drainage-district',name:'Drainage Quarter',theme:'Large districts',text:'96 × 72 T footprint: turning water channels, dry banks, stair entrances and shortcut ladders.',build:buildDrainageDistrict},
    {id:'suburb-district',name:'Maple Heights',theme:'Large districts',text:'A suburb on two avenues: houses with driveways and fenced yards, semis, a fire station, sports court and corner shops.',build:buildSuburbDistrict},
    {id:'downtown-district',name:'Downtown Core',theme:'Large districts',text:'A dense grid of 2–3 storey shop rows, offices, plazas and a parking deck, joined by skybridges over busy streets.',build:buildDowntownDistrict},
    {id:'dockside-district',name:'Dockside Yards',theme:'Large districts',text:'A quay on deep water: warehouses with catwalks, container stacks, a scrapyard, bus depot and loading aprons.',build:buildDocksideDistrict},
    {id:'highway-district',name:'Interstate Strip',theme:'Large districts',text:'A four-lane highway strip: motel, gas stations, car dealership, car wash, diner drive-thru and a police compound.',build:buildHighwayDistrict},
    {id:'terrace-district',name:'Hillside Terraces',theme:'Large districts',text:'Three generated levels: sunken yards, a street terrace and high ground, joined by road ramps, stairs, split-level buildings and ladders.',build:buildTerraceHeights},
    {id:'sunken-junction',name:'Sunken Junction',theme:'Split-level districts',text:'Linked sunken boulevards with a T-junction, covered crossings, rounded retail and square industrial parcels.',build:buildSunkenJunction},
    {id:'sunken-boulevard',name:'Sunken Boulevard',theme:'Split-level districts',text:'A lower street passes beneath an upper boulevard, with road ramps and a covered crossing.',build:buildSunkenBoulevard},
    {id:'freight-terraces',name:'Freight Terraces',theme:'Split-level districts',text:'Low warehouses, raised loading decks, cargo lanes and a service catwalk.',build:buildFreightTerraces},
    {id:ARCHITECTURE_YARD_ID,name:"Architecture Yard",theme:"Training",text:"Walk through full glass, vault solid window sills, inspect window families and rounded facades.",build:buildArchitectureYard},
    // Real places: Geo-voxel exports imported by tools/places (layers → PlaceImport). Play with ?play=<id>&fixture=1.
    ...placeMapDefs(),
    ...MAP_PACKAGES.map(pkg => ({id:pkg.manifest.id,name:pkg.manifest.name,theme:pkg.manifest.theme,text:pkg.design.mission.briefing,concept:`/maps/${pkg.manifest.id}/${pkg.manifest.reference}`,build: options => buildPackagedMap(pkg, { ...options, strict: false })})),
    { id: CEDAR_CLOSE_ID, name: 'Cedar Close', theme: 'Suburbs', text: 'Two modern homes on a quiet close. Glass walls, gardens, a residential street.', build: buildCedarClose },
    { id: MAIN_STREET_ID, name: 'Main Street', theme: 'Downtown', text: 'Shops, a diner and an office block on a main road. Storefront glass, roadworks, a parking lot.', build: buildMainStreet },
    { id: HARBOR_ID, name: 'Harbor Yard', theme: 'Industrial', text: 'A container yard on the quay at night: stacked containers, a warehouse with roller doors, fuel drums.', build: buildHarbor },
    { id: ROUTE9_ID, name: 'Route 9 Stop', theme: 'Roadside', text: 'A gas station, a motel and its parking lot beside the highway. The pumps explode.', build: buildRoute9 },
    { id: PROVING_GROUNDS_ID, name: 'Training Facility', theme: 'Training', text: 'Every system in one map: firing range, bunker, fuel store, watchtower, pond, hill.', build: buildProvingGrounds }
]);

// Shared baseline for local play, co-op, and both agents' visual checks.
export const DEFAULT_MAP = 'burger-district';
// PLAN-10: players never pick these fixed maps any more — every battle is generated from a theme (Scenarios.THEMES).
// The registry stays for tests, the balance sim, tools and old links; only these two test rigs are offered, and only
// in the admin Test ground / debug panel.
export const FIXTURE_IDS = Object.freeze([PROVING_GROUNDS_ID, ARCHITECTURE_YARD_ID]);
// Old map ids → the generated theme closest to them (legacy links, saved setups, reports).
const LEGACY_PLOTS = { 'suburb-district': 'suburb', 'cedar-close': 'suburb', 'cedar-image': 'suburb', 'highway-district': 'suburb', 'route-9': 'suburb',
    'dockside-district': 'industrial', 'harbor-yard': 'industrial', 'freight-terraces': 'industrial', 'drainage-district': 'industrial', 'proving-grounds': 'industrial' };
const THEME_PLOTS = { Suburbs: 'suburb', Industrial: 'industrial', Downtown: 'downtown', Roadside: 'suburb' };
export function plotForMap(id) { const m = mapById(id); return LEGACY_PLOTS[id] || (m && THEME_PLOTS[m.theme]) || 'downtown'; }
export const mapById = id => MAPS.find(m => m.id === id) || null;
