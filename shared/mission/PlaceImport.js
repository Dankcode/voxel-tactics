// Place import — a real place built by Geo-voxel (github.com/Dankcode/Geo-voxel) turned into a playable mission.
//
// Geo-voxel owns everything real-world: the OSM/DEM fetch, framing, straightening, terrain, footprints, tenants and
// the road-paint plan. It exports them as `geo-voxels/layers@1` (layers.json, or map.json's `layers`). This module
// reads those layers and does only the game's part:
//
//   terrain    the exported heightfield as is (already plateaued, every neighbouring step ≤ 1 voxel)
//   streets    the exported land use (R/K/S) with each cell owned by its nearest centreline; kerb parking, trees,
//              lamps, signals and signs on the local ground
//   lots       the exported car parks → striped stall rows with planted islands
//   buildings  each exported building's cells (its wing rectangles, then the rest of its 'B' land) → ModernBuilder
//              wings, rooms, stairs, glazing and furniture; party walls shared; tenants become units; landmarks dressed
//   parcels    the open land is the game's: the district parcel fill runs on it with the place theme's mix weights
//              (yards, gardens, garages, sheds, back lots, service yards …) and may add a few small buildings
//   play       objective, insertion, cover repair and enemy pods along the line of play
//
// layers@1 extensions this reader also takes when present (Geo-voxel does not export them yet): a building's
// `footprint` ([[x, y]] cells), `heightM` and `osmParts` ([{ cells, minM, maxM, roofM, roofShape }]); top-level
// `furniture` ([{ kind, at: [x, y] }] in cells, e.g. real trees) and land-use codes G (lawn), P (plaza) and p (path).
import { GEO_PROGRAMS } from '../mapgen/geo/GeoPrograms.js';
import { createMap } from './modern/MapKit.js';
import { MAT } from '../voxel/Materials.js';
import { reachable, nodeKey } from '../world/PathSearch.js';
import { AGENT_PROFILES } from '../world/TraversalRules.js';
import { initDistrict, tag, tagAt, setGround, groundAt, put, frame as parcelFrame, registerCells, landUseSnapshot } from '../mapgen/district/Core.js';
import { fillDistrict, finishDistrict } from '../mapgen/district/District.js';
import { addStall, parkingLot, plantTree } from '../mapgen/district/Props.js';
import { remixParameters } from '../mapgen/DistrictRemix.js';
import { repairCover, tryPiece } from '../mapgen/district/CoverRepair.js';
import { coverAt, COVER } from '../voxel/Cover.js';
import { districtPods, zonedDistrictPods } from '../mapgen/district/Pods.js';
import { B } from '../content/balance.js';
import { STOREY, PROGRAMS } from './modern/ModernBuilder.js';
import { distToPolyline, distBox } from '../mapgen/geo/GeoGeometry.js';
import { buildFootprint, cleanMask, resolveParty, footprintIoU, largestRectangle, closeDeadExits } from '../mapgen/geo/GeoBuildings.js';
import { placeStreetVehicle } from '../mapgen/StreetDressing.js';
import { lotStripesToPaint } from '../mapgen/geo/GeoRoadPaint.js';
import { placeGeoProps } from '../mapgen/geo/GeoStreetProps.js';
import { dressLandmark, landmarkHeadroom, styleFamily, LANDMARK_MAX_HEIGHT } from '../mapgen/geo/GeoLandmark.js';

export const PLACE_GENERATOR_VERSION = 'place-import-1';
export const LAYERS_FORMAT = 'geo-voxels/layers@1';
/** Place theme → the district family whose parcel mixes fill the open land. */
export const THEME_FAMILY = Object.freeze({ Downtown: 'urban', Landmark: 'urban', 'Strip centre': 'retail', Suburbs: 'suburban', Industrial: 'industrial', Roadside: 'roadside', Mixed: 'mixed' });
/** Place theme → what happens to open land by default: 'parcels' (the game's parcel fill) or 'park' (lawn beyond the
 *  paved yards stays lawn — landmark grounds and malls; layers@1 does not tell a park from a vacant block). */
export const THEME_OPEN_LAND = Object.freeze({ Landmark: 'park' });

const k2 = (x, y) => `${x},${y}`;
const N4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const WALLS = { shop: 'brick', supermarket: 'brick', office: 'concrete_wall', warehouse: 'brick', diner: 'stucco', garage: 'brick', house: 'siding', bank: 'stone', museum: 'stone', chapel: 'stone', civic: 'stone', school: 'brick', library: 'brick', clinic: 'concrete_wall', hotel: 'brick' };
const ROLE = { R: 'road', K: 'kerb', S: 'sidewalk' };
const known = p => !!(p && (PROGRAMS[p] || GEO_PROGRAMS[p]));
/**
 * What the game makes of a real building: Geo-voxel's programme, refined from its tenants' OSM tags and its size into
 * the game's own building types (a pub is a bar, a laundry a laundromat, a small garage a lock-up, a big house a walk-up).
 */
export function gameProgram(program, { tenants = [], cells = 0 } = {}) {
    const tags = tenants.map(t => t?.tags || {});
    if (tags.some(t => /^(bar|pub|biergarten|nightclub)$/.test(t.amenity || ''))) return 'bar';
    if (tags.some(t => /^(laundry|dry_cleaning)$/.test(t.shop || ''))) return 'laundromat';
    if (tags.some(t => /^(convenience|kiosk|newsagent|alcohol|tobacco)$/.test(t.shop || ''))) return 'corner_store';
    if (program === 'garage' && cells && cells < 140) return 'lockup';
    if (program === 'house' && cells >= 420) return 'walkup';
    return program;
}
const slug = s => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);

/** The layers of a Geo-voxel export: a layers.json, or a map.json carrying them under `layers`. Validates the shape. */
export function readLayers(input) {
    const L = input?.layers && typeof input.layers === 'object' && !Array.isArray(input.layers) ? input.layers : input;
    if (!L || typeof L !== 'object') throw Error('place: no layers');
    if (!String(L.format || '').startsWith('geo-voxels/layers@1')) throw Error(`place: expected ${LAYERS_FORMAT}, got ${L.format || 'nothing'}`);
    const W = L.frame?.width, D = L.frame?.depth;
    if (!(W > 8 && D > 8)) throw Error('place: frame.width/depth missing');
    if (L.heightfield?.length !== W * D) throw Error(`place: heightfield has ${L.heightfield?.length} cells, frame is ${W}×${D}`);
    if (L.landUse?.codes?.length !== W * D) throw Error(`place: landUse.codes has ${L.landUse?.codes?.length} cells, frame is ${W}×${D}`);
    return L;
}

/**
 * Build the mission. opts: { layers (layers@1 or map.json), id, name, seed, objectiveName (building name, id or OSM id),
 *   theme ('Downtown' | 'Suburbs' | 'Strip centre' | 'Industrial' | 'Landmark' | 'Roadside'), family (district family
 *   override), programs ({ [building id]: program } — what the game makes of a building), maxStoreys (3),
 *   newBuildings ('auto' | n: small buildings the parcel fill may add on open land; 0 keeps the place as mapped),
 *   openLand ('parcels' | 'park'; default by theme), lotsToParcels (lot ids, or true for every lot, handed to the
 *   parcel fill instead of being striped as car parks), timeOfDay, audit, coverRepair, enforceGates }
 */
export function buildPlaceMission({ layers, id = 'place', name = 'Imported place', seed = 1, objectiveName = null, theme = 'Downtown', family = null, programs = {}, maxStoreys = 3, newBuildings = 'auto', openLand = null, lotsToParcels = [], timeOfDay = 'dusk', audit = true, coverRepair = true, enforceGates = false } = {}) {
    const L = readLayers(layers), F = L.frame, W = F.width, D = F.depth, codes = L.landUse.codes;
    const fam = family || THEME_FAMILY[theme] || 'urban', openMode = openLand || THEME_OPEN_LAND[theme] || 'parcels';
    const report = { source: L.format, theme, family: fam, size: [W, D], theta: F.theta ?? 0, buildings: [], dropped: [], storeys: [], roads: [], lots: [], landmarks: [], units: [], terrain: null };
    const inMapC = (x, y) => x >= 0 && y >= 0 && x < W && y < D;
    const code = (x, y) => (inMapC(x, y) ? codes[x + y * W] : null);
    const hf = { z: Int16Array.from(L.heightfield) };
    const inner = (x, y) => x >= 1 && y >= 1 && x < W - 1 && y < D - 1;

    // ------------------------------------------------------------------ buildings: cells per exported building
    const src = (L.buildings || []).filter(b => b && b.id);
    const owner = new Int32Array(W * D).fill(-1), queue = [];
    src.forEach((b, i) => {
        if (Array.isArray(b.footprint)) for (const [x, y] of b.footprint) { if (inMapC(x, y) && owner[x + y * W] < 0) { owner[x + y * W] = i; queue.push([x, y]); } }
        else for (const r of b.wings || []) for (let y = r.y0; y < r.y0 + r.d; y++) for (let x = r.x0; x < r.x0 + r.w; x++)
            if (code(x, y) === 'B' && owner[x + y * W] < 0) { owner[x + y * W] = i; queue.push([x, y]); }
    });
    // the rest of the building land (the outline beyond the wing rectangles) goes to the nearest building
    for (let q = 0; q < queue.length; q++) {
        const [x, y] = queue[q], o = owner[x + y * W];
        for (const [dx, dy] of N4) { const X = x + dx, Y = y + dy; if (code(X, Y) === 'B' && owner[X + Y * W] < 0) { owner[X + Y * W] = o; queue.push([X, Y]); } }
    }
    const cellsOf = src.map(() => []);
    for (let y = 0; y < D; y++) for (let x = 0; x < W; x++) { const o = owner[x + y * W]; if (o >= 0 && inner(x, y)) cellsOf[o].push([x, y]); }
    let strayB = 0; for (let i = 0; i < W * D; i++) if (codes[i] === 'B' && owner[i] < 0) strayB++;
    report.strayBuildingCells = strayB;

    const fps = [];
    src.forEach((b, i) => {
        const cells = cleanMask(cellsOf[i]);
        if (cells.length < 20) { report.dropped.push({ id: b.id, osm: b.osm || null, reason: 'footprint below one room' }); return; }
        const want = programs[b.id] || gameProgram(b.program, { tenants: b.tenants, cells: cells.length }), program = known(want) ? want : 'shop';
        const def = GEO_PROGRAMS[program] || null, observed = b.storeys || null;
        const storeys = Math.max(1, Math.min(maxStoreys, b.storeys || 2));
        if (observed && observed !== storeys) report.storeys.push({ id: b.id, observed, played: storeys });
        const info = { tags: b.name ? { name: b.name } : {}, facts: b.facts || null, landmark: !!b.landmark, tenants: b.tenants || [], parts: [], heightM: b.heightM || null };
        const fp = { id: slug(b.id) || `b${i}`, osm: b.osm || null, name: b.name || null, program, def, storeys, observed, baseZ: b.baseZ, front: b.front || null,
            cells, area: cells.length, exact: cells, info, osmParts: b.osmParts || [], wall: def?.wall || WALLS[program], floor: null, roof: def?.roof || null };
        // one building, several tenants (a strip of shop units): one unit each, cut evenly along the long axis
        const units = !programs[b.id] && info.tenants.length >= 2 ? splitUnits(fp, info.tenants) : null;
        if (units) { fps.push(...units); report.units.push({ id: b.id, units: units.map(u => u.name) }); }
        else fps.push(fp);
    });
    const usedIds = new Set(); for (const f of fps) { while (usedIds.has(f.id)) f.id += '-b'; usedIds.add(f.id); }
    const party = resolveParty(fps);
    for (const f of fps.slice()) { f.cells = cleanMask(f.cells); if (f.cells.length < 20) { report.dropped.push({ id: f.id, reason: 'footprint below one room' }); fps.splice(fps.indexOf(f), 1); } }
    const occupied = new Set(fps.flatMap(f => f.cells.map(([x, y]) => k2(x, y))));

    // ------------------------------------------------------------------ streets: the exported land use, owned by centrelines
    const roads = (L.roads || []).filter(r => r.line?.length >= 2).map(r => {
        const cls = r.cls ?? 1, link = !!r.link;
        return { kerbParking: !link && cls >= 1 && cls <= 2, id: r.id, name: r.name || null, cls, link, kind: cls >= 3 ? 'main' : cls >= 1 ? 'cross' : 'service', half: r.half ?? 3,
            sidewalk: cls >= 1 && !link ? 2 : 0, lanes: cls ? 2 : 1, line: r.line, maxspeed: null, oneway: r.oneway || 0 };
    });
    const roadLen = r => r._len ??= r.line.slice(1).reduce((s, p, i) => s + Math.hypot(p[0] - r.line[i][0], p[1] - r.line[i][1]), 0);
    const roadAt = new Map();
    for (let y = 0; y < D; y++) for (let x = 0; x < W; x++) {
        const role = ROLE[code(x, y)];
        if (!role || occupied.has(k2(x, y)) || !roads.length) continue;
        let best = null;
        for (const r of roads) {
            const d = distBox([x + 0.5, y + 0.5], r.line);
            if (!best || d < best.d - 1e-6 || Math.abs(d - best.d) <= 1e-6 && (r.cls > best.road.cls || r.cls === best.road.cls && roadLen(r) > roadLen(best.road))) best = { road: r, d };
        }
        roadAt.set(k2(x, y), { role, rank: { road: 3, kerb: 2, sidewalk: 1 }[role], road: best.road, d: best.d });
    }
    for (const r of roads) report.roads.push({ id: r.id, name: r.name, kind: r.kind, widthCells: +(2 * r.half).toFixed(1), cells: [...roadAt.values()].filter(v => v.road === r && v.role === 'road').length });

    // ------------------------------------------------------------------ lots, storefront walks, open land
    const lots = [], repurposed = new Set();
    for (const l of L.lots || []) {
        const cells = (l.cells || []).filter(([x, y]) => inner(x, y) && !occupied.has(k2(x, y)) && !roadAt.has(k2(x, y)));
        if (lotsToParcels === true || Array.isArray(lotsToParcels) && lotsToParcels.includes(l.id)) { for (const [x, y] of cells) repurposed.add(k2(x, y)); continue; }
        if (cells.length >= 30) lots.push({ id: slug(l.id || `lot-${lots.length}`), cells, implied: !!l.implied, name: l.name || null });
    }
    const lotCells = new Set(lots.flatMap(l => l.cells.map(([x, y]) => k2(x, y))));
    const walk = new Set(), landAt = new Map();
    const nearBuilding = (x, y, r) => { for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (occupied.has(k2(x + dx, y + dy))) return true; return false; };
    let open = 0;
    for (let y = 0; y < D; y++) for (let x = 0; x < W; x++) {
        const k = k2(x, y), c = code(x, y);
        if (occupied.has(k) || roadAt.has(k) || lotCells.has(k)) continue;
        if (c === 'W') { walk.add(k); continue; }
        if (c === 'G') landAt.set(k, 'green'); else if (c === 'P') landAt.set(k, 'plaza'); else if (c === 'p') landAt.set(k, 'path');
        else if (repurposed.has(k)) { landAt.set(k, 'open-paved'); open++; }                   // a car park the game re-parcels
        else if (openMode === 'park' && !nearBuilding(x, y, 3)) landAt.set(k, 'green');          // grounds stay lawn
        else { landAt.set(k, nearBuilding(x, y, 3) ? 'open-paved' : 'open-lawn'); open++; }   // the parcel fill's land
    }
    report.openLand = { mode: openMode, repurposedLots: repurposed.size, open, green: [...landAt.values()].filter(v => v === 'green').length, plaza: [...landAt.values()].filter(v => v === 'plaza').length, path: [...landAt.values()].filter(v => v === 'path').length, walk: walk.size };

    // ------------------------------------------------------------------ terrain: the exported heightfield; plateaus pinned
    const plateaus = new Map();
    const median = cs => { const zs = cs.map(([x, y]) => hf.z[x + y * W]).sort((a, b) => a - b); return zs[Math.floor(zs.length / 2)] ?? 1; };
    for (const f of fps) { const z = Number.isInteger(f.baseZ) ? f.baseZ : median(f.cells); plateaus.set(f.id, z); for (const [x, y] of f.cells) hf.z[x + y * W] = z; }
    for (const l of lots) { const z = median(l.cells); plateaus.set(l.id, z); for (const [x, y] of l.cells) hf.z[x + y * W] = z; }
    const gMin = Math.min(...hf.z), gMax = Math.max(...hf.z);
    report.terrain = { reliefVoxels: gMax - gMin, low: gMin, high: gMax };
    const headroom = Math.max(0, ...fps.map(f => f.info.landmark || styleFamily(f.info) ? landmarkHeadroom(f.info, { storeys: f.storeys, cell: F.cell || 0.9, storey: STOREY }) : 0));
    const H = Math.min(LANDMARK_MAX_HEIGHT + 2, Math.max(18, gMax + STOREY * maxStoreys + 5, gMax + STOREY * maxStoreys + headroom + 4));

    // ------------------------------------------------------------------ voxels: ground, streets, lots
    const m = createMap({ id, width: W, depth: D, height: H, seed, datum: 1, ground: 'paving' }), s = m.store;
    initDistrict(m, { contains: () => true, family: fam, seed });
    const d = m.district;
    d.notes.push(`place: ${L.format} · ${W}×${D} cells at ${F.cell || 0.9} m · theme ${theme} (${fam} parcels)`);
    d.roadKind ||= new Map();
    for (let y = 0; y < D; y++) for (let x = 0; x < W; x++) {
        const g = hf.z[x + y * W], r = roadAt.get(k2(x, y));
        for (let z = 1; z < g; z++) s.set(x, y, z, z === g - 1 ? MAT.soil : MAT.stone);
        const land = r ? null : landAt.get(k2(x, y));
        s.set(x, y, g, r ? (r.role === 'road' ? MAT.asphalt : r.role === 'kerb' ? MAT.concrete : MAT.paving) : land === 'green' || land === 'open-lawn' ? MAT.lawn : MAT.paving);
        setGround(m, x, y, g);
        if (r) {
            tag(m, x, y, r.role, { force: true });
            d.roadOwnership.set(k2(x, y), [{ tag: r.role, z: g }]);
            d.roadKind.set(k2(x, y), r.road.kind);
        } else if (land === 'green' || land === 'plaza' || land === 'path') tag(m, x, y, land, { force: true });
        // open land stays untagged ("plain"): the parcel fill below decides what it becomes
    }
    let realTrees = 0;
    for (const t of (L.furniture || []).filter(f => f.kind === 'tree' && Array.isArray(f.at))) {
        const x = Math.floor(t.at[0]), y = Math.floor(t.at[1]); if (!inMapC(x, y) || occupied.has(k2(x, y))) continue;
        const role = roadAt.get(k2(x, y))?.role, land = landAt.get(k2(x, y));
        if (role && role !== 'sidewalk' || !role && !land) continue;
        if (role === 'sidewalk') tag(m, x, y, 'verge', { force: true }); else if (!tagAt(m, x, y) || tagAt(m, x, y) === 'plain') tag(m, x, y, 'green', { force: true });
        if (plantTree(m, x, y, role === 'sidewalk' ? 'road:osm/street-tree' : 'place:osm/tree')) realTrees++;
        if (role === 'sidewalk') tag(m, x, y, 'sidewalk', { force: true });
    }
    report.realTrees = realTrees;
    for (const k of walk) { const [x, y] = k.split(',').map(Number); tag(m, x, y, 'plaza', { force: true }); }
    for (const l of lots) {
        const set = new Set(l.cells.map(([x, y]) => k2(x, y)));
        const box = { x0: Math.min(...l.cells.map(c => c[0])), y0: Math.min(...l.cells.map(c => c[1])), x1: Math.max(...l.cells.map(c => c[0])), y1: Math.max(...l.cells.map(c => c[1])) };
        const z = plateaus.get(l.id);
        for (const [x, y] of l.cells) { s.set(x, y, z, MAT.asphalt); tag(m, x, y, 'aisle', { force: true }); }
        let stalls = 0, sections = 0;
        for (let guard = 0; guard < (l.implied ? 24 : 6); guard++) {
            const r = largestRectangle(set, box);
            if (!r || r.w * r.d < 54) break;
            for (let y = r.y0; y < r.y0 + r.d; y++) for (let x = r.x0; x < r.x0 + r.w; x++) set.delete(k2(x, y));
            if (Math.min(r.w, r.d) < 6 || Math.max(r.w, r.d) < 9) { if (l.implied) continue; break; }
            const near = side => { const c = { n: [r.x0 + r.w / 2, r.y0 - 3], s: [r.x0 + r.w / 2, r.y0 + r.d + 3], w: [r.x0 - 3, r.y0 + r.d / 2], e: [r.x0 + r.w + 3, r.y0 + r.d / 2] }[side]; return roads.length ? Math.min(...roads.map(q => distToPolyline(c, q.line) - q.cls)) : 0; };
            const fronts = r.w >= r.d ? ['n', 's'] : ['e', 'w'];
            const PF = parcelFrame({ ...r, front: fronts.sort((a, b) => near(a) - near(b))[0] });
            for (let v = 0; v + 9 <= PF.V; v += 14) {
                const lot = parkingLot(m, PF, { u0: 0, v0: v, uw: PF.U, vd: Math.min(14, PF.V - v) }, { origin: `place:${l.id}/s${sections}-${v}`, z, islands: PF.U >= 18, frontage: v === 0 });
                stalls += lot.stalls.length;
            }
            sections++;
        }
        if (l.implied) {
            for (const st of d.stalls) if (st.origin?.startsWith(`place:${l.id}/`)) st.kind = 'retail';
            for (const [x, y] of l.cells) if (tagAt(m, x, y) === 'green' && s.topSolid(x, y) === z && !s.isSolid(x, y, z + 1) && !m.keep.has(k2(x, y))) put(m, x, y, z + 1, 'planter', `place:${l.id}/island-planter`);
        }
        // a kerbed, planted island every 6th stall along each row (fewer cars; trees and planters for cover)
        let islands = 0;
        const rows = new Map();
        for (const st of d.stalls.filter(q => q.origin?.startsWith(`place:${l.id}/`))) { const key = `${st.origin}|${st.axis}|${st.axis === 'y' ? st.y : st.x}`; if (!rows.has(key)) rows.set(key, []); rows.get(key).push(st); }
        for (const row of rows.values()) {
            row.sort((a, b) => (a.axis === 'y' ? a.x - b.x : a.y - b.y));
            row.forEach((st, i) => {
                if (i % 6 !== 3) return;
                d.stalls.splice(d.stalls.indexOf(st), 1);
                for (const [x, y] of st.cells) { d.stallCells.delete(k2(x, y)); tag(m, x, y, 'green', { force: true }); s.set(x, y, st.z, MAT.lawn); }
                const treeAt = st.cells[Math.floor(st.cells.length / 2)];
                for (const [x, y] of st.cells) if (x !== treeAt[0] || y !== treeAt[1]) put(m, x, y, st.z + 1, 'planter', `place:${l.id}/row-island`);
                plantTree(m, treeAt[0], treeAt[1], `place:${l.id}/row-island-tree`);
                islands++;
            });
        }
        report.lots.push({ id: l.id, name: l.name, implied: l.implied, cells: l.cells.length, sections, stalls: stalls - islands, islands });
    }

    // ------------------------------------------------------------------ buildings
    const roadDist = (x, y) => { let best = Infinity; for (const r of roads) if (r.cls >= 1) best = Math.min(best, distToPolyline([x + 0.5, y + 0.5], r.line) - r.half - r.cls * 1.5); return best; };
    const built = [];
    for (const f of fps.slice().sort((a, b) => a.storeys - b.storeys || b.area - a.area)) {
        const res = buildFootprint(m, {
            id: f.id, osm: f.osm, name: f.name, program: f.program, programDef: f.def || null, storeys: f.storeys, baseZ: plateaus.get(f.id), cells: f.cells, wall: f.wall || WALLS[f.program], floor: f.floor, roof: f.roof,
            frontScore: (side, cells) => {
                const [dx, dy] = { n: [0, -2], s: [0, 2], e: [2, 0], w: [-2, 0] }[side], ux = Math.sign(dx), uy = Math.sign(dy);
                if (cells.filter(([x, y]) => x + ux * 3 < 1 || y + uy * 3 < 1 || x + ux * 3 >= W - 1 || y + uy * 3 >= D - 1).length > 0.3 * cells.length) return -1e9;
                const lotFace = ['shop', 'supermarket', 'hardware', 'market', 'diner'].includes(f.program) ? cells.reduce((a, [x, y]) => { let n = 0; for (let t = 2; t < 26; t++) { const q = k2(x + ux * t, y + uy * t); if (lotCells.has(q) || roadAt.get(q)?.road.cls === 0) n++; } return a + n / 24; }, 0) / cells.length : 0;
                const road = -Math.min(...cells.map(([x, y]) => roadDist(x + dx, y + dy)));
                const unitEnd = f.unitAxis != null && (f.unitAxis === 0 ? (side === 'e' || side === 'w') : (side === 'n' || side === 's')) ? -1000 : 0;
                // Geo-voxel's own front (its door side) is preferred; the street and car-park rules break ties
                return (lotFace >= 0.3 ? 100 + 2 * lotFace * cells.length + 0.1 * road : road) + unitEnd + (side === f.front ? 60 : 0);
            }
        }, { occupied, party });
        for (const rec of res.records) for (let y = rec.y0; y < rec.y0 + rec.d; y++) for (let x = rec.x0; x < rec.x0 + rec.w; x++) tag(m, x, y, 'building', { force: true });
        for (const [x, y] of res.mass) tag(m, x, y, 'building', { force: true });
        for (const [x, y] of res.fringe || []) if (!roadAt.has(k2(x, y))) tag(m, x, y, 'plaza', { force: true });
        const iou = footprintIoU(f.cells, res);
        built.push({ f, res, iou });
        report.buildings.push({ id: f.id, osm: f.osm, name: f.name, program: f.program, storeys: f.storeys, observed: f.observed, baseZ: plateaus.get(f.id), cells: f.cells.length, wings: res.wings.length, massCells: res.mass.length, fringeCells: (res.fringe || []).length, wingDoors: res.doors.length, iou: +iou.toFixed(3), rooms: res.records.reduce((a, r) => a + r.rooms.length, 0) });
    }
    report.closedExits = closeDeadExits(m, m.buildings);
    // a later wing's door approach can clear furniture an earlier wing placed: drop the tile hints left on empty cells
    for (const [k, h] of Object.entries(m.hints)) {
        if (h.roller || h.cells) continue;
        const [x, y, z] = k.split(',').map(Number);
        if (!s.isSolid(x, y, z)) delete m.hints[k];
    }
    for (const { f, res } of built) if (f.info.landmark || styleFamily(f.info)) {
        const osmParts = (f.osmParts || []).filter(p => p.cells?.length);
        const dress = dressLandmark(m, { group: f.id, records: res.records, cells: f.cells, info: f.info, wall: f.wall || 'stone', osmParts });
        for (const r of res.records) r.landmark = dress.style || true;
        report.landmarks.push({ id: f.id, name: f.name, program: f.program, style: dress.style, facts: f.info.facts ? { style: f.info.facts.style, heritage: f.info.facts.heritage, inception: f.info.facts.inception } : null, parts: dress.parts.map(p => p.part), voxels: dress.voxels });
    }
    for (const { f } of built) for (const [x, y] of f.cells) setGround(m, x, y, plateaus.get(f.id));
    const mapped = m.buildings.length;

    // ------------------------------------------------------------------ objective, insertion and line of play
    const objB = built.find(b => objectiveName && (b.f.name === objectiveName || b.f.osm === String(objectiveName) || b.f.id === objectiveName || b.f.id === slug(objectiveName)))?.f
        || built.map(b => b.f).sort((a, b) => b.storeys - a.storeys || b.area - a.area)[0];
    const oc = objB ? [objB.cells.reduce((a, c) => a + c[0], 0) / objB.cells.length, objB.cells.reduce((a, c) => a + c[1], 0) / objB.cells.length] : [W / 2, D / 2];
    const standable = (x, y) => inMapC(x, y) && !occupied.has(k2(x, y)) && s.topSolid(x, y) === groundAt(m, x, y);
    const cand = [...roadAt.entries()].filter(([, v]) => v.road.cls >= 1 && (v.role === 'road' || v.role === 'sidewalk')).map(([k]) => k.split(',').map(Number))
        .filter(([x, y]) => (x <= 6 || y <= 6 || x >= W - 7 || y >= D - 7) && x >= 3 && y >= 3 && x < W - 3 && y < D - 3);
    cand.sort((a, b) => Math.hypot(b[0] - oc[0], b[1] - oc[1]) - Math.hypot(a[0] - oc[0], a[1] - oc[1]) || a[0] - b[0] || a[1] - b[1]);
    const ins = cand[0] || [3, Math.floor(D / 2)];
    const spawnCells = [];
    for (let r = 0; r < 6 && spawnCells.length < 6; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
        const x = ins[0] + dx, y = ins[1] + dy;
        if (spawnCells.length < 6 && Math.max(Math.abs(dx), Math.abs(dy)) === r && standable(x, y) && !spawnCells.some(c => c.x === x && c.y === y)) spawnCells.push({ x, y, z: groundAt(m, x, y) });
    }
    for (const c of spawnCells) m.reserve(c.x - 1, c.y - 1, c.x + 1, c.y + 1);
    tag(m, ins[0], ins[1], 'insertion', { force: false });
    const spawn = spawnCells[0], target = { x: Math.round(oc[0]), y: Math.round(oc[1]) };

    // ------------------------------------------------------------------ the game's parcels on the open land
    const extra = newBuildings === 'auto' ? Math.max(0, Math.min(6, Math.floor(open / 1100))) : Math.max(0, newBuildings | 0);
    const remix = remixParameters({ buildingCount: mapped, maxStoreys: 2, terrain: 'flat', skybridges: false, elevated: false, traffic: 'normal', pedestrian: 'normal', parts: fam === 'retail' || fam === 'industrial' || fam === 'suburban' || fam === 'roadside' || fam === 'urban' ? fam : 'mixed', merges: false, objective: 'eliminate', timeOfDay });
    remix.buildingCount = mapped + extra;
    const fill = fillDistrict(m, { seed, remix, family: fam, roads: [], spawn: null, target });
    const added = m.buildings.slice(mapped);
    for (const b of added) b.parcelBuilt = true;
    // open land no parcel took: lawn stays lawn, the paved apron by a building is its yard
    let leftover = 0;
    for (const [k, v] of landAt) {
        if (v !== 'open-lawn' && v !== 'open-paved') continue;
        const [x, y] = k.split(',').map(Number);
        if (tagAt(m, x, y) !== 'plain') continue;
        tag(m, x, y, s.get(x, y, groundAt(m, x, y)) === MAT.lawn ? 'green' : 'yard', { force: true }); leftover++;
    }
    report.parcels = { newBuildingCap: extra, newBuildings: added.map(b => ({ id: b.id, program: b.program, storeys: b.storeys })), leftoverOpen: leftover,
        mixes: Object.entries(fill.leaves.reduce((a, l) => (l.mix ? (a[l.mix] = (a[l.mix] || 0) + 1, a) : a), {})).sort((a, b) => b[1] - a[1]).map(([mix, n]) => ({ mix, n })) };

    // ------------------------------------------------------------------ street dressing on the local ground
    let stallCount = 0;
    for (const r of roads) if (r.cls >= 1 && r.half >= 3 && r.kerbParking) {
        for (let i = 1; i < r.line.length; i++) {
            const [ax, ay] = r.line[i - 1], [bx, by] = r.line[i], Ls = Math.hypot(bx - ax, by - ay); if (Ls < 12) continue;
            const ux = (bx - ax) / Ls, uy = (by - ay) / Ls, axis = Math.abs(ux) >= Math.abs(uy) ? 'x' : 'y';
            for (let t = 6, n = 0; t + 6 < Ls; t += 7, n++) {
                const side = n % 2 ? 1 : -1, off = r.half - 1.5;
                const x = Math.floor(ax + ux * t - uy * off * side), y = Math.floor(ay + uy * t + ux * off * side);
                if (!inMapC(x, y)) continue;
                const cells = Array.from({ length: 4 }, (_, k) => axis === 'x' ? [[x + k, y], [x + k, y + 1]] : [[x, y + k], [x + 1, y + k]]).flat();
                const zs = new Set(cells.map(([cx, cy]) => groundAt(m, cx, cy)));
                if (zs.size > 1 || !cells.every(([cx, cy]) => roadAt.get(k2(cx, cy))?.role === 'road' && roadAt.get(k2(cx, cy)).road === r)) continue;
                if (spawn && Math.hypot(x - spawn.x, y - spawn.y) < 10) continue;
                if (addStall(m, { x: Math.min(...cells.map(c => c[0])), y: Math.min(...cells.map(c => c[1])), axis, length: 4, width: 2, kind: 'kerb', types: ['car'], priority: 0.4, z: [...zs][0], origin: `road:${r.id}/kerb` })) stallCount++;
            }
        }
    }
    let trees = 0;
    for (const r of roads) if (r.sidewalk) {
        let acc = 0;
        for (let i = 1; i < r.line.length; i++) {
            const [ax, ay] = r.line[i - 1], [bx, by] = r.line[i], Ls = Math.hypot(bx - ax, by - ay); if (!Ls) continue;
            const ux = (bx - ax) / Ls, uy = (by - ay) / Ls;
            for (let t = 0; t < Ls; t += 1) {
                if ((acc + t) % 11 >= 1) continue;
                for (const side of [-1, 1]) {
                    const off = r.half + 1 + r.sidewalk - 0.5, x = Math.floor(ax + ux * t - uy * off * side), y = Math.floor(ay + uy * t + ux * off * side);
                    if (roadAt.get(k2(x, y))?.role !== 'sidewalk' || m.keep.has(k2(x, y))) continue;
                    tag(m, x, y, 'verge', { force: true });
                    const ok = plantTree(m, x, y, `road:${r.id}/street-tree`);
                    tag(m, x, y, 'sidewalk', { force: true });
                    if (ok) trees++;
                }
            }
            acc += Ls;
        }
    }
    const kerbVehicles = placeKerbVehicles(m, seed);
    // road paint: Geo-voxel's plan as exported, plus the car-park stripes (thin lines, not painted voxels)
    const quads = (L.paint?.quads || []).map(q => ({ c: q.c, z: q.z, color: q.color }));
    const marked = []; for (let y = 0; y < D; y++) for (let x = 0; x < W; x++) if (s.get(x, y, groundAt(m, x, y)) === MAT.road_mark) marked.push([x, y]);
    quads.push(...lotStripesToPaint(s, marked, MAT, (x, y) => groundAt(m, x, y)));
    const junctions = (L.paint?.junctions || []).filter(j => Number.isFinite(j.x) && Number.isFinite(j.y)).map(j => ({ x: j.x, y: j.y, r: j.r ?? 4, roads: j.roads || [] }));
    report.paint = { quads: quads.length, junctions: junctions.length };
    report.props = placeGeoProps(m, { roads, roadAt, junctions, lots, seed, furniture: (L.furniture || []).filter(f => Array.isArray(f.at)) });
    const axisAt = (x, y) => { const r = roadAt.get(k2(x, y)); if (!r) return null; let best = null; const Ln = r.road.line;
        for (let i = 1; i < Ln.length; i++) { const [ax, ay] = Ln[i - 1], [bx, by] = Ln[i], vx = bx - ax, vy = by - ay, l2 = vx * vx + vy * vy || 1, t = Math.max(0, Math.min(1, ((x + 0.5 - ax) * vx + (y + 0.5 - ay) * vy) / l2)), dd = Math.hypot(ax + vx * t - x - 0.5, ay + vy * t - y - 0.5); if (!best || dd < best.d) best = { d: dd, axis: Math.abs(vx) >= Math.abs(vy) ? 'x' : 'y' }; }
        return best?.axis || null; };
    report.cover = coverRepair && spawn ? batchCoverRepair(m, spawn, { axisAt }) : null;

    // ------------------------------------------------------------------ enemies, objective, finish
    const far = m.buildings.filter(b => b.rooms.length && (b.wing ?? 0) === 0).sort((a, b) => Math.hypot(b.x0 - spawn.x, b.y0 - spawn.y) - Math.hypot(a.x0 - spawn.x, a.y0 - spawn.y));
    const objRec = m.buildings.find(b => b.group === objB?.id && b.wing === 0);
    if (objRec) { far.splice(far.indexOf(objRec), 1); far.unshift(objRec); }
    const street = (() => { const c = [...roadAt.entries()].filter(([, v]) => v.role === 'road').map(([k]) => k.split(',').map(Number)).sort((a, b) => Math.hypot(a[0] - oc[0], a[1] - oc[1]) - Math.hypot(b[0] - oc[0], b[1] - oc[1]))[0]; return c ? { x: c[0], y: c[1], z: groundAt(m, c[0], c[1]) } : null; })();
    const roadCells = [...roadAt.entries()].filter(([, v]) => v.role === 'road').map(([k]) => { const [x, y] = k.split(',').map(Number); return { x, y, z: groundAt(m, x, y) }; }).filter((c, i) => i % 3 === 0);
    const enemy = (B.podSpacing ?? 0) > 0 && objRec
        ? zonedDistrictPods(m.buildings, { spawn, goal: { x: objRec.x0 + objRec.w / 2, y: objRec.y0 + objRec.d / 2 }, objective: objRec, roadCells, spacing: B.podSpacing, fallback: [street, street].filter(Boolean) })
        : districtPods(far, { fallback: [street, street].filter(Boolean), street });
    const objective = { kind: 'eliminate', text: objB ? `Clear the Syndicate out of ${objB.name || 'the block'} and the buildings around it.` : 'Clear the block.' };
    const lamps = [];
    for (const r of roads) if (r.cls >= 1) {
        let acc = 0;
        for (let i = 1; i < r.line.length; i++) {
            const [ax, ay] = r.line[i - 1], [bx, by] = r.line[i], Ls = Math.hypot(bx - ax, by - ay); if (!Ls) continue;
            const ux = (bx - ax) / Ls, uy = (by - ay) / Ls;
            for (let t = 0; t < Ls; t++) {
                if ((acc + t) % 14 >= 1) continue;
                const side = Math.floor((acc + t) / 14) % 2 ? 1 : -1, off = r.half + 1.5;
                const x = Math.floor(ax + ux * t - uy * off * side), y = Math.floor(ay + uy * t + ux * off * side);
                if (roadAt.get(k2(x, y))?.role !== 'sidewalk' || s.topSolid(x, y) !== groundAt(m, x, y)) continue;
                lamps.push({ kind: 'streetlight', x, y, z: groundAt(m, x, y) + 1, yaw: Math.atan2(uy * side, -ux * side), planned: true, route: r.id });
            }
            acc += Ls;
        }
    }
    m.lightRoutes = [];
    const result = m.finish({ name, spawns: { player: spawnCells, enemy }, objective, meta: {
        generatorVersion: PLACE_GENERATOR_VERSION, theme: `Real place · ${theme}`, lighting: timeOfDay, timeOfDay, remix,
        // the lanes gate measures routes to the street in front of the objective (the pods' centroid can sit inside a block)
        ...(street ? { lanesGoal: { x: street.x, y: street.y, z: street.z } } : {}),
        place: { format: L.format, cell: F.cell || 0.9, theta: F.theta ?? 0, origin: F.origin || null, crs: F.crs || null, window: F.window || null, theme, family: fam },
        streetObjects: fill.streetObjects, cutLevels: [4, 7, 10, 13, Infinity], defaultCut: gMax + 3,
        designDecisions: ['Terrain, streets, lots and building outlines come from Geo-voxel and are pinned.',
            'Outlines are cut into wings at their reflex corners; every wing is planned by the shared interior system and wings join through doorways.',
            `The open land is the game's: the ${fam} parcel mixes fill it, adding at most ${extra} small building${extra === 1 ? '' : 's'}.`]
    } });
    result.visual.decor.push(...lamps);
    result.visual.roadPaint = { version: 1, quads };
    report.streets = { kerbStalls: stallCount, trees, lamps: lamps.length, kerbVehicles };
    report.fill = { blocks: fill.blocks, leaves: fill.leaves.length, assigned: fill.leaves.filter(l => l.mix).length };
    let gates = null;
    result.meta.landUse = landUseSnapshot(m);
    if (audit) {
        gates = finishDistrict(result, m, fill, { enforce: enforceGates });
        const search = reachable(result.store, spawnCells[0], Infinity, AGENT_PROFILES.player);
        report.reach = m.buildings.map(b => ({ id: b.id, entered: b.rooms.some(r => r.cells.some(([x, y]) => search.costs.has(nodeKey({ x, y, z: r.floorZ })))) }));
    }
    result.meta.placeReport = report;
    result.meta.placeGates = gates;
    Object.defineProperty(report, 'streetLines', { value: roads.map(r => ({ id: r.id, name: r.name, kind: r.kind, line: r.line, half: r.half, oneway: r.oneway })) });
    return result;
}

/**
 * Cut one footprint into tenant units along its long axis, evenly, in the order Geo-voxel lists the tenants. Each
 * unit keeps the building's outline cells on its side and takes the tenant's name and use. null when a unit would be
 * too narrow to stand as a shop.
 */
function splitUnits(fp, tenants) {
    const xs = fp.cells.map(c => c[0]), ys = fp.cells.map(c => c[1]);
    const ax = Math.max(...xs) - Math.min(...xs) >= Math.max(...ys) - Math.min(...ys) ? 0 : 1;
    const lo = Math.min(...(ax ? ys : xs)), hi = Math.max(...(ax ? ys : xs)) + 1, n = tenants.length, step = (hi - lo) / n;
    if (step < 7) return null;
    const out = tenants.map((t, i) => {
        const a = i ? Math.round(lo + step * i) : -Infinity, b = i < n - 1 ? Math.round(lo + step * (i + 1)) : Infinity, inUnit = c => c[ax] >= a && c[ax] < b;
        const cells = fp.cells.filter(inUnit), name = t.name || `${fp.name || fp.id} unit ${i + 1}`;
        const use = gameProgram(t.use, { tenants: [t] }), program = known(use) ? use : fp.program;
        return { ...fp, id: slug(name) || `${fp.id}-u${i + 1}`, name, program, def: GEO_PROGRAMS[program] || null, wall: fp.wall, cells, area: cells.length, exact: cells.slice(),
            unitOf: fp.id, unitAxis: ax, info: { ...fp.info, landmark: false, tenants: [t] } };
    });
    return out.every(u => u.cells.length >= 40) ? out : null;
}

/** Fill the kerb stalls added after fillDistrict with parked cars (same noise model as the district fill). */
function placeKerbVehicles(m, seed) {
    const free = m.district.stalls.filter(st => st.kind === 'kerb' && !st.filled);
    let n = 0;
    free.forEach((st, i) => {
        if ((i * 7 + seed) % 5 > 1 || !m.car) return;   // ~40 % occupancy, deterministic
        const before = Object.keys(m.hints).length;
        m.car(st.x, st.y, st.axis, i % 2 ? 1 : -1, null, st.z);
        if (Object.keys(m.hints).length > before) { st.filled = true; n++; for (const [cx, cy] of st.cells) for (let z = st.z + 1; z <= st.z + 2; z++) if (m.store.isSolid(cx, cy, z)) m.district.origins.set(`${cx},${cy},${z}`, `vehicle:${st.origin}`); }
    });
    return n;
}

/**
 * PLAN-06 cover repair, batched for large real maps: one path search, then a piece at every worst gap that is not
 * within 4 cells of a piece already placed this pass (the stock rule's land-use pieces, via tryPiece), then the stock
 * repairCover with a small budget for whatever gap is left.
 */
function batchCoverRepair(m, spawn, { maxGap = 6, rounds = 8, axisAt = () => null, minShare = 0.215 } = {}) {
    const s = m.store, key = n => `${n.x},${n.y},${n.z}`, placed = [];
    for (let round = 0, shareRounds = 0; round < rounds + 6; round++) {
        const search = reachable(s, spawn, Infinity, AGENT_PROFILES.player);
        const nodes = [...search.nodes.values()].filter(n => s.roomAt(n.x, n.y, n.z + 1) < 0 && m.district.contains(n.x, n.y));
        const map = new Map(nodes.map(n => [key(n), n])), d = new Map(), q = [];
        for (const n of nodes) { const c = coverAt(s, n.x, n.y, n.z); if (Math.max(c.n, c.e, c.s, c.w) >= COVER.HALF) { d.set(key(n), 0); q.push(n); } }
        for (let i = 0; i < q.length; i++) { const n = q[i], v = d.get(key(n)); for (const [dx, dy] of N4) for (const dz of [0, 1, -1]) { const k = `${n.x + dx},${n.y + dy},${n.z + dz}`, o = map.get(k); if (o && !d.has(k)) { d.set(k, v + 1); q.push(o); } } }
        let far = nodes.map(n => ({ n, d: d.get(key(n)) ?? 99 })).filter(e => e.d > maxGap).sort((a, b) => b.d - a.d || a.n.x - b.n.x || a.n.y - b.n.y);
        let budget = Infinity;
        if (!far.length) {
            const all = [...search.nodes.values()].filter(n => s.roomAt(n.x, n.y, n.z + 1) < 0), share = d.size ? all.filter(n => d.get(key(n)) === 0).length / all.length : 0;
            if (share >= minShare || ++shareRounds > 6) break;
            budget = Math.ceil((minShare - share) * all.length / 9);
            far = nodes.map(n => ({ n, d: d.get(key(n)) ?? 99 })).filter(e => e.d >= 3).sort((a, b) => b.d - a.d || a.n.x - b.n.x || a.n.y - b.n.y);
        } else if (round >= rounds) break;
        let added = 0;
        const thisRound = [];
        for (const { n } of far) {
            if (added >= budget) break;
            if (thisRound.some(p => Math.abs(p.x - n.x) <= 6 && Math.abs(p.y - n.y) <= 6)) continue;
            const cand = [];
            for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) if (dx || dy) cand.push([n.x + dx, n.y + dy, Math.max(Math.abs(dx), Math.abs(dy))]);
            cand.sort((a, b) => (m.district.tags[a[0] + a[1] * m.district.W] === 'road') - (m.district.tags[b[0] + b[1] * m.district.W] === 'road') || a[2] - b[2] || a[0] - b[0] || a[1] - b[1]);
            const nt = m.district.tags[n.x + n.y * m.district.W];
            let done = nt === 'road' ? stalledCar(m, n, axisAt(n.x, n.y)) : nt === 'aisle' || nt === 'stall' ? cartCorral(m, n) : ['green', 'park', 'yard'].includes(nt) ? groundTree(m, n) : null;
            if (!done) for (const [cx, cy] of cand) { if (['aisle', 'stall'].includes(m.district.tags[cx + cy * m.district.W])) continue; done = tryPiece(m, cx, cy, n, false); if (done) break; }
            if (done) { thisRound.push(done); added++; }
        }
        placed.push(...thisRound);
        if (!added) break;
    }
    const finish = repairCover(m, { spawn, maxGap, budget: 12, traffic: 'none' });
    m.district.repairs = [...placed, ...finish];
    return { batched: placed.length, finished: finish.length };
}

/** A tree on lawn near node n (≤ 3 cells), never on a kept approach or right against another solid. */
function groundTree(m, n) {
    const s = m.store, d = m.district;
    for (let r = 1; r <= 3; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const x = n.x + dx, y = n.y + dy;
        if (x < 1 || y < 1 || x >= d.W - 1 || y >= d.D - 1 || !['green', 'park', 'yard'].includes(d.tags[x + y * d.W]) || m.keep.has(k2(x, y))) continue;
        const z = groundAt(m, x, y);
        if (s.topSolid(x, y) !== z || N4.some(([a, b]) => s.isSolid(x + a, y + b, z + 1))) continue;
        if (plantTree(m, x, y, 'repair:green/tree')) return { x: n.x, y: n.y, piece: 'tree', tag: 'green' };
    }
    return null;
}

/** A cart corral (3 pipe-rail voxels) on car-park aisle near node n, never sealing a lane (both sides stay aisle). */
function cartCorral(m, n) {
    const s = m.store, d = m.district, isAisle = (x, y) => x >= 1 && y >= 1 && x < d.W - 1 && y < d.D - 1 && d.tags[x + y * d.W] === 'aisle';
    for (let r = 0; r <= 3; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        for (const [ax, ay] of [[1, 0], [0, 1]]) {
            const cells = [0, 1, 2].map(j => [n.x + dx + ax * j, n.y + dy + ay * j]);
            const z = groundAt(m, cells[0][0], cells[0][1]);
            if (!cells.every(([x, y]) => isAisle(x, y) && groundAt(m, x, y) === z && s.topSolid(x, y) === z && !s.isSolid(x, y, z + 1) && !d.stallCells.has(k2(x, y)) && !m.keep.has(k2(x, y))
                && isAisle(x + ay, y + ax) && isAisle(x - ay, y - ax) && !s.isSolid(x + ay, y + ax, z + 1) && !s.isSolid(x - ay, y - ax, z + 1))) continue;
            if ([[cells[0][0] - ax, cells[0][1] - ay], [cells[2][0] + ax, cells[2][1] + ay]].some(([x, y]) => s.isSolid(x, y, z + 1))) continue;
            const vox = [];
            for (const [x, y] of cells) { put(m, x, y, z + 1, 'railing', 'repair:aisle/cart-corral'); vox.push([x, y, z + 1]); }
            m.object('cart_corral', vox, { axis: ax ? 'x' : 'y', dir: 1, size: [3, 1] });
            return { x: n.x, y: n.y, piece: 'cart_corral', tag: 'aisle' };
        }
    }
    return null;
}

/** PLAN-06's road repair piece (an abandoned car in a salvage slot) placed on the carriageway at a cover gap. */
function stalledCar(m, n, along = null) {
    const s = m.store, d = m.district;
    for (const axis of along ? [along] : ['x', 'y']) for (let o = -3; o <= 0; o++) for (let w = -1; w <= 0; w++) {
        const x0 = axis === 'x' ? n.x + o : n.x + w, y0 = axis === 'x' ? n.y + w : n.y + o;
        const cells = []; for (let i = 0; i < 4; i++) for (let j = 0; j < 2; j++) cells.push(axis === 'x' ? [x0 + i, y0 + j] : [x0 + j, y0 + i]);
        if (!cells.every(([x, y]) => x >= 0 && y >= 0 && x < d.W && y < d.D && d.tags[x + y * d.W] === 'road' && groundAt(m, x, y) === n.z && s.topSolid(x, y) === n.z && !d.stallCells.has(k2(x, y)) && !m.keep.has(k2(x, y)))) continue;
        const st = addStall(m, { x: x0, y: y0, axis, length: 4, kind: 'salvage', types: ['car'], priority: 1, z: n.z, origin: 'repair:road/stalled-car' });
        if (!st) continue;
        const v = placeStreetVehicle(m, 'car', st.x, st.y, { axis, z: n.z });
        if (!v) continue;
        const vc = []; for (const [x, y] of cells) for (let z = n.z + 1; z <= n.z + 3; z++) if (s.isSolid(x, y, z)) vc.push([x, y, z]);
        registerCells(m, vc, 'vehicle:repair');
        d.vehicles.push({ ...v, kind: 'salvage', origin: 'repair:road' });
        return { x: n.x, y: n.y, piece: 'car', tag: 'road' };
    }
    return null;
}
