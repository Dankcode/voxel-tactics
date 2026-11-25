// Dynamic multi-elevation terrain features: canals with bridges & recessed towpaths, multi-tier stepped ridges,
// sunken drainage basins, stairways, railings, and vertical tactical pads for bottom-to-top / top-to-bottom flows.
import { MAT, AIR } from '../voxel/Materials.js';
import { hashString } from '../util/Rng.js';

export const OPERATION_FLOWS = Object.freeze(['auto', 'high_to_low', 'low_to_high_to_low', 'bottom_to_top', 'top_to_bottom']);
export const FLOW_LABELS = Object.freeze({
    auto: 'Adaptive Flow',
    high_to_low: 'Hilltop -> Lower Field',
    low_to_high_to_low: 'Valley -> Ascent -> Lower Evac',
    bottom_to_top: 'Lower Basin -> Crest / Top',
    top_to_bottom: 'Upper Ridge -> Lower Compound'
});

const unit = s => (hashString(s) >>> 0) / 4294967296;

/** Return the walkable/surface z at (x, y) nearest `preferZ` (or highest valid surface if null). */
export function surfaceZAt(store, x, y, preferZ = null) {
    if (!store?.inBounds?.(x, y, 1)) return store?.datum ?? 4;
    const surfs = store.surfaces(x, y).filter(s => s.headroom >= 2 && s.info?.walkable !== false);
    if (surfs.length) {
        if (preferZ == null) return surfs[0].z;
        return surfs.reduce((a, b) => (Math.abs(b.z - preferZ) < Math.abs(a.z - preferZ) ? b : a)).z;
    }
    const top = store.topSolid(x, y);
    return top >= 0 ? top : (store.datum ?? 4);
}

/** Resolve effective vertical flow key from explicit setting + plot biome + seed. */
export function resolveVerticalFlow(flow, family, seed = 1) {
    if (flow && flow !== 'auto' && OPERATION_FLOWS.includes(flow)) return flow;
    const byFamily = {
        canal_district: ['low_to_high_to_low', 'high_to_low'],
        hillside_ridge: ['bottom_to_top', 'top_to_bottom'],
        sunken_basin: ['high_to_low', 'low_to_high_to_low'],
        arid_compound: ['bottom_to_top', 'auto'],
        winter_outpost: ['high_to_low', 'auto'],
        harbor: ['low_to_high_to_low', 'auto']
    }[family];
    if (!byFamily) return 'auto';
    return byFamily[Math.floor(unit(`${family}:${seed}:flow`) * byFamily.length)] || 'auto';
}

/**
 * Plan deterministic multi-elevation terrain features (height offsets, canals, bridges, stairs, highPad/lowerPad)
 * strictly clear of buildings, underground openings, and world edges.
 */
export function planTerrainFeatures({ plot, ground, buildings, layers = null, flow = 'auto', seed = 1 }) {
    const { W, D, family, insertion, objective, lots } = plot;
    const objCell = objective ? { x: (objective.lx + 1) * 8, y: (objective.ly + 1) * 8 } : { x: Math.floor(W / 2), y: Math.floor(D / 2) };
    const effectiveFlow = resolveVerticalFlow(flow, family, seed);

    const roadMask = new Uint8Array(W * D);
    for (const lot of lots || []) if (lot.road) {
        for (let y = lot.y0; y < lot.y0 + 8; y++) for (let x = lot.x0; x < lot.x0 + 8; x++) {
            if (x >= 0 && y >= 0 && x < W && y < D) roadMask[x + y * W] = 1;
        }
    }

    const nearBuilding = (x, y, pad = 2) => buildings.some(b =>
        x >= b.x0 - pad && x <= b.x0 + b.w - 1 + pad && y >= b.y0 - pad && y <= b.y0 + b.d - 1 + pad
    );
    const layerBlocked = (x, y, pad = 2) => {
        if (!layers) return false;
        const pts = [...(layers.openings || []).flatMap(o => [o.from, o.to]), ...(layers.entrances || []), layers.drop].filter(Boolean);
        return pts.some(p => Math.abs(p.x - x) <= pad && Math.abs(p.y - y) <= pad);
    };
    const isCellOpen = (x, y, { allowRoad = false, bPad = 2 } = {}) => {
        if (x < 2 || y < 2 || x >= W - 2 || y >= D - 2) return false;
        if (ground?.mat?.[x + y * W] === 'air') return false;
        if (!allowRoad && roadMask[x + y * W]) return false;
        if (nearBuilding(x, y, bPad)) return false;
        if (layerBlocked(x, y, 2)) return false;
        return true;
    };

    const features = [];
    const reserved = new Uint8Array(W * D);
    const markReserved = (x0, y0, w, d, m = 1) => {
        for (let y = Math.max(0, y0 - m); y <= Math.min(D - 1, y0 + d - 1 + m); y++) {
            for (let x = Math.max(0, x0 - m); x <= Math.min(W - 1, x0 + w - 1 + m); x++) reserved[x + y * W] = 1;
        }
    };

    const findRect = (rw, rd, anchor, { minDistToOther = null, other = null, allowRoad = false } = {}) => {
        let best = null;
        for (let y0 = 2; y0 <= D - 2 - rd; y0++) {
            for (let x0 = 2; x0 <= W - 2 - rw; x0++) {
                let ok = true;
                for (let dy = 0; dy < rd && ok; dy++) for (let dx = 0; dx < rw && ok; dx++) {
                    const x = x0 + dx, y = y0 + dy;
                    if (reserved[x + y * W] || !isCellOpen(x, y, { allowRoad, bPad: 2 })) ok = false;
                }
                if (!ok) continue;
                const cx = x0 + rw / 2, cy = y0 + rd / 2;
                if (other && minDistToOther != null && Math.hypot(cx - other.x, cy - other.y) < minDistToOther) continue;
                const score = Math.hypot(cx - anchor.x, cy - anchor.y) + unit(`${seed}:rect:${x0},${y0}`) * 1.5;
                if (!best || score < best.score) best = { x0, y0, w: rw, d: rd, cx, cy, score };
            }
        }
        return best;
    };

    // 1. Canal Quarter: cross-map sunken waterway with stone quays, stairs, and grounded stone bridges.
    if (family === 'canal_district') {
        const midY = Math.floor(D / 2);
        let bestRow = null;
        for (let off = 0; off <= Math.floor(D / 3); off++) {
            for (const cand of [midY - off, midY + off]) {
                if (cand < 4 || cand + 3 > D - 5) continue;
                let clear = true;
                for (let x = 2; x <= W - 3 && clear; x++) {
                    for (let dy = -1; dy <= 3 && clear; dy++) {
                        if (nearBuilding(x, cand + dy, 1) || layerBlocked(x, cand + dy, 1) || ground?.mat?.[x + (cand + dy) * W] === 'air') clear = false;
                    }
                }
                if (clear) { bestRow = cand; break; }
            }
            if (bestRow != null) break;
        }
        if (bestRow != null) {
            const bridges = [];
            let x = 3;
            while (x < W - 4) {
                if (roadMask[x + bestRow * W]) {
                    let end = x;
                    while (end + 1 < W - 3 && roadMask[(end + 1) + bestRow * W]) end++;
                    const mid = Math.floor((x + end) / 2);
                    const bw = Math.min(4, Math.max(3, end - x + 1));
                    bridges.push({ x0: Math.max(3, Math.min(W - 3 - bw, mid - Math.floor(bw / 2))), w: bw });
                    x = end + 1;
                } else x++;
            }
            if (!bridges.length) {
                bridges.push({ x0: Math.max(4, Math.floor(W * 0.28)), w: 3 }, { x0: Math.min(W - 8, Math.floor(W * 0.65)), w: 3 });
            }
            features.push({
                kind: 'canal', axis: 'x', y0: bestRow, width: 3, x0: 2, x1: W - 3,
                bridges: bridges.slice(0, 3),
                depth: 1
            });
            markReserved(2, bestRow - 1, W - 4, 5, 0);
        }
    }

    const needHill = family === 'hillside_ridge' || ['high_to_low', 'bottom_to_top', 'top_to_bottom'].includes(effectiveFlow);
    const needBasin = family === 'sunken_basin' || ['high_to_low', 'low_to_high_to_low', 'bottom_to_top', 'top_to_bottom'].includes(effectiveFlow);

    // 2. Stepped Hill / Elevated Ridge Plateau (+2..+3 above datum G).
    let highPad = null;
    if (needHill) {
        const hillAnchor = (effectiveFlow === 'high_to_low' || effectiveFlow === 'top_to_bottom') ? insertion : objCell;
        const avoidPt = (effectiveFlow === 'high_to_low' || effectiveFlow === 'top_to_bottom') ? objCell : null;
        const rect = findRect(8, 6, hillAnchor, { other: avoidPt, minDistToOther: avoidPt ? 14 : null })
            || findRect(6, 5, hillAnchor, { other: avoidPt, minDistToOther: avoidPt ? 12 : null })
            || findRect(5, 4, hillAnchor);
        if (rect) {
            const maxRise = rect.w >= 8 && rect.d >= 6 && (family === 'hillside_ridge' || effectiveFlow !== 'auto') ? 3 : 2;
            const feat = { kind: 'hill', ...rect, rise: maxRise };
            features.push(feat);
            markReserved(rect.x0, rect.y0, rect.w, rect.d, 1);
            highPad = {
                x0: rect.x0 + 2, y0: rect.y0 + 2,
                x1: rect.x0 + rect.w - 3, y1: rect.y0 + rect.d - 3,
                dz: maxRise >= 3 && rect.w >= 8 && rect.d >= 6 ? 3 : 2
            };
        }
    }

    // 3. Sunken Basin / Lower Field (-2 below datum G).
    let lowerPad = null;
    if (needBasin) {
        const basinAnchor = (effectiveFlow === 'bottom_to_top' || effectiveFlow === 'low_to_high_to_low') ? insertion : objCell;
        const avoidPt = (effectiveFlow === 'bottom_to_top') ? objCell : null;
        const rect = findRect(7, 6, basinAnchor, { other: avoidPt, minDistToOther: avoidPt ? 12 : null })
            || findRect(6, 5, basinAnchor)
            || findRect(5, 5, basinAnchor);
        if (rect) {
            const feat = { kind: 'basin', ...rect, depth: 2 };
            features.push(feat);
            markReserved(rect.x0, rect.y0, rect.w, rect.d, 1);
            lowerPad = {
                x0: rect.x0 + 1, y0: rect.y0 + 1,
                x1: rect.x0 + rect.w - 2, y1: rect.y0 + rect.d - 2,
                dz: -2
            };
        }
    }

    // Secondary flank terrace in highland/basin biomes if only one feature spawned so map variety shines.
    if (family === 'hillside_ridge' && features.filter(f => f.kind === 'hill').length < 2) {
        const r2 = findRect(6, 5, { x: W - hillAnchorX(highPad, W), y: D - hillAnchorY(highPad, D) });
        if (r2) {
            features.push({ kind: 'hill', ...r2, rise: 2 });
            markReserved(r2.x0, r2.y0, r2.w, r2.d, 1);
        }
    }

    // Build protection list (stairs, bridges, water) so WFC bays don't drop cars/trees on stairs or water.
    const protectedCoords = [];
    for (const f of features) {
        for (let y = f.y0; y < f.y0 + (f.d ?? f.width ?? 3); y++) {
            for (let x = f.x0; x < (f.x1 != null ? f.x1 + 1 : f.x0 + f.w); x++) {
                protectedCoords.push([x, y]);
            }
        }
    }

    return {
        version: 1,
        family,
        flow: effectiveFlow,
        requestedFlow: flow || 'auto',
        features,
        highPad,
        lowerPad,
        protectedCoords
    };
}

function hillAnchorX(pad, W) { return pad ? (pad.x0 + pad.x1) / 2 : W / 2; }
function hillAnchorY(pad, D) { return pad ? (pad.y0 + pad.y1) / 2 : D / 2; }

/** Material palette helper by plot family. */
function surfaceMatFor(family, role = 'top') {
    if (family === 'winter_outpost') return role === 'wall' ? MAT.stone : MAT.snow;
    if (family === 'arid_compound') return role === 'wall' ? MAT.drystone : MAT.sand;
    if (family === 'canal_district' || family === 'old_quarter') return role === 'wall' ? MAT.stone : MAT.cobble;
    if (family === 'hillside_ridge') return role === 'wall' ? MAT.stone : (role === 'crest' ? MAT.stone_floor : MAT.lawn);
    return role === 'wall' ? MAT.stone : MAT.concrete;
}

/**
 * Compile planned TerrainFeatures onto mission `m.store`. Updates `terrain.highPad.z` / `lowerPad.z`
 * and populates `terrain.heightMap` (`Int8Array` dz per cell) for OperationPreview + HUD.
 */
export function compileTerrainFeatures(m, terrain, layout) {
    if (!terrain?.features?.length) return null;
    const s = m.store, G = m.G, W = layout.width, D = layout.depth;
    const family = layout.plot?.family || 'downtown';
    const dzMap = new Array(W * D).fill(0);
    const kindMap = new Array(W * D).fill('flat');

    const clearAbove = (x, y, zFrom, zTo = zFrom + 4) => {
        for (let z = zFrom; z <= zTo && z < s.height; z++) {
            if (s.inBounds(x, y, z)) s.set(x, y, z, AIR);
        }
    };
    const isFootprintFree = (x, y) => !layout.buildings.some(b =>
        x >= b.x0 - 1 && x <= b.x0 + b.w && y >= b.y0 - 1 && y <= b.y0 + b.d
    ) && !m.keep?.has(`${x},${y}`);

    for (const f of terrain.features) {
        if (f.kind === 'canal') {
            const { x0, x1, y0, width } = f;
            const bridgeSet = new Set();
            for (const b of f.bridges || []) for (let x = b.x0; x < b.x0 + b.w; x++) bridgeSet.add(x);

            for (let x = x0; x <= x1; x++) {
                // Embankment curb sidewalks along canal edges at datum G.
                for (const ey of [y0 - 1, y0 + width]) {
                    if (s.inBounds(x, ey, G) && isFootprintFree(x, ey)) {
                        for (let z = 1; z < G; z++) s.set(x, ey, z, MAT.stone);
                        s.set(x, ey, G, MAT.cobble);
                        clearAbove(x, ey, G + 1, G + 3);
                    }
                }
                const onBridge = bridgeSet.has(x);
                for (let dy = 0; dy < width; dy++) {
                    const y = y0 + dy;
                    if (!s.inBounds(x, y, G) || !isFootprintFree(x, y)) continue;
                    // Solid bedrock & lower masonry foundation; bridge edges sit on solid stone piers.
                    s.set(x, y, 0, MAT.bedrock);
                    for (let z = 1; z < G - 1; z++) s.set(x, y, z, MAT.stone);
                    if (onBridge) {
                        for (let z = 1; z < G; z++) s.set(x, y, z, (dy === 0 || dy === width - 1) ? MAT.stone : MAT.stone);
                        s.set(x, y, G, MAT.stone_floor);
                        clearAbove(x, y, G + 1, G + 3);
                        dzMap[x + y * W] = 0;
                        kindMap[x + y * W] = 'bridge';
                    } else if (dy === 0) {
                        // Recessed towpath walkway along north bank at z = G - 1 (dry & walkable by all profiles).
                        s.set(x, y, G - 1, MAT.cobble);
                        clearAbove(x, y, G, G + 3);
                        dzMap[x + y * W] = -1;
                        kindMap[x + y * W] = 'quay';
                    } else {
                        // Wadeable shallow canal channel at z = G - 1.
                        s.set(x, y, G - 1, MAT.water);
                        clearAbove(x, y, G, G + 3);
                        dzMap[x + y * W] = -1;
                        kindMap[x + y * W] = 'canal';
                    }
                }
            }
            // Add stone stairs descending from both north & south embankments down into the canal towpaths/landings.
            const stairSpots = [];
            for (const b of f.bridges || []) {
                if (b.x0 - 2 >= x0) stairSpots.push(b.x0 - 2);
                if (b.x0 + b.w + 1 <= x1) stairSpots.push(b.x0 + b.w + 1);
            }
            for (const sx of stairSpots) {
                for (const dx of [0, 1]) {
                    const x = sx + dx;
                    if (x > x1 || bridgeSet.has(x)) continue;
                    // North bank stair (y0 - 1) -> north towpath (y0)
                    const ny = y0;
                    if (s.inBounds(x, ny, G + 2) && isFootprintFree(x, ny)) {
                        s.set(x, ny, G - 1, MAT.cobble);
                        s.set(x, ny - 1, G, MAT.stairs_stone);
                        clearAbove(x, ny - 1, G + 1, G + 3);
                        kindMap[x + (ny - 1) * W] = 'stair';
                    }
                    // South landing (y0 + width - 1) -> south bank stair (y0 + width)
                    const sy = y0 + width - 1;
                    if (s.inBounds(x, sy + 1, G + 2) && isFootprintFree(x, sy) && isFootprintFree(x, sy + 1)) {
                        s.set(x, sy, G - 1, MAT.cobble);
                        clearAbove(x, sy, G, G + 3);
                        s.set(x, sy + 1, G, MAT.stairs_stone);
                        clearAbove(x, sy + 1, G + 1, G + 3);
                        kindMap[x + (sy + 1) * W] = 'stair';
                    }
                }
            }
            // Also ensure low railings/quays along selected bank runs don't seal stair/bridge approaches.
        }

        if (f.kind === 'hill') {
            const { x0, y0, w, d, rise } = f;
            const wallM = surfaceMatFor(family, 'wall');
            const grassM = surfaceMatFor(family, 'top');
            const crestM = surfaceMatFor(family, 'crest');
            for (let dy = 0; dy < d; dy++) for (let dx = 0; dx < w; dx++) {
                const x = x0 + dx, y = y0 + dy;
                if (!s.inBounds(x, y, G + rise + 3) || !isFootprintFree(x, y)) continue;
                const edgeDist = Math.min(dx, dy, w - 1 - dx, d - 1 - dy);
                const tier = Math.min(rise, edgeDist >= 2 && rise >= 3 ? 3 : edgeDist >= 1 ? 2 : 1);
                const topZ = G + tier;
                for (let z = 1; z < topZ; z++) s.set(x, y, z, wallM);
                s.set(x, y, topZ, tier === rise ? crestM : grassM);
                clearAbove(x, y, topZ + 1, topZ + 3);
                dzMap[x + y * W] = tier;
                kindMap[x + y * W] = 'hill';
            }
            // Carve 2-wide walkable stone stairs cleanly along West/East and North/South ramps up every tier step!
            const mx = Math.floor(x0 + w / 2) - 1, my = Math.floor(y0 + d / 2) - 1;
            // South ascent (y from y0+d-1 inwards up each step)
            for (let step = 0; step < rise; step++) {
                const sy = y0 + d - 1 - step;
                if (sy < y0 + 1) break;
                const tz = G + step + 1;
                for (const sx of [mx, mx + 1]) {
                    if (!s.inBounds(sx, sy, tz + 3) || !isFootprintFree(sx, sy)) continue;
                    for (let z = 1; z < tz; z++) s.set(sx, sy, z, wallM);
                    s.set(sx, sy, tz, MAT.stairs_stone);
                    clearAbove(sx, sy, tz + 1, tz + 3);
                    dzMap[sx + sy * W] = step + 1;
                    kindMap[sx + sy * W] = 'stair';
                }
            }
            // North ascent (y from y0 inwards)
            for (let step = 0; step < rise; step++) {
                const sy = y0 + step;
                if (sy > y0 + d - 2) break;
                const tz = G + step + 1;
                for (const sx of [mx, mx + 1]) {
                    if (!s.inBounds(sx, sy, tz + 3) || !isFootprintFree(sx, sy)) continue;
                    for (let z = 1; z < tz; z++) s.set(sx, sy, z, wallM);
                    s.set(sx, sy, tz, MAT.stairs_stone);
                    clearAbove(sx, sy, tz + 1, tz + 3);
                    dzMap[sx + sy * W] = step + 1;
                    kindMap[sx + sy * W] = 'stair';
                }
            }
            // East/West flanking stair access from datum up to tier 1/2
            for (let step = 0; step < Math.min(2, rise); step++) {
                for (const sx of [x0 + step, x0 + w - 1 - step]) {
                    const tz = G + step + 1;
                    for (const sy of [my, my + 1]) {
                        if (!s.inBounds(sx, sy, tz + 3) || !isFootprintFree(sx, sy)) continue;
                        for (let z = 1; z < tz; z++) s.set(sx, sy, z, wallM);
                        s.set(sx, sy, tz, MAT.stairs_stone);
                        clearAbove(sx, sy, tz + 1, tz + 3);
                        dzMap[sx + sy * W] = step + 1;
                        kindMap[sx + sy * W] = 'stair';
                    }
                }
            }
            // Add tactical sandbag/drystone cover cleanly at outer crest corners only on very wide plateaus.
            if (w >= 8 && d >= 6) {
                const cz = G + rise;
                for (const [cx, cy] of [[x0 + 2, y0 + 2], [x0 + w - 3, y0 + d - 3]]) {
                    if (cx !== mx && cx !== mx + 1 && kindMap[cx + cy * W] !== 'stair' && s.isSolid(cx, cy, cz)) {
                        s.set(cx, cy, cz + 1, family === 'arid_compound' ? MAT.drystone : MAT.sandbag);
                    }
                }
            }
        }

        if (f.kind === 'basin') {
            const { x0, y0, w, d } = f;
            const floorM = MAT.stone_floor;
            const shelfM = MAT.cobble;
            const rimMx = Math.floor(x0 + w / 2) - 1;
            const midY = Math.floor(y0 + d / 2) - 1;
            for (let dy = 0; dy < d; dy++) for (let dx = 0; dx < w; dx++) {
                const x = x0 + dx, y = y0 + dy;
                if (!s.inBounds(x, y, G + 3) || !isFootprintFree(x, y)) continue;
                const onRim = dx === 0 || dy === 0 || dx === w - 1 || dy === d - 1;
                const depth = onRim ? 1 : 2;
                const botZ = G - depth;
                s.set(x, y, 0, MAT.bedrock);
                for (let z = 1; z < botZ; z++) s.set(x, y, z, MAT.stone);
                s.set(x, y, botZ, depth === 1 ? shelfM : floorM);
                clearAbove(x, y, botZ + 1, G + 3);
                dzMap[x + y * W] = -depth;
                kindMap[x + y * W] = 'basin';
            }
            // North & South 2-wide descending stairways: G - 1 step on rim (stairs_stone) -> G - 2 floor inside!
            for (const sx of [rimMx, rimMx + 1]) {
                for (const sy of [y0, y0 + d - 1]) {
                    if (s.inBounds(sx, sy, G + 2) && isFootprintFree(sx, sy)) {
                        s.set(sx, sy, G - 1, MAT.stairs_stone);
                        clearAbove(sx, sy, G, G + 3);
                        kindMap[sx + sy * W] = 'stair';
                    }
                }
            }
            // West & East 2-wide descending stairways as backup assault entries.
            for (const sy of [midY, midY + 1]) {
                for (const sx of [x0, x0 + w - 1]) {
                    if (s.inBounds(sx, sy, G + 2) && isFootprintFree(sx, sy)) {
                        s.set(sx, sy, G - 1, MAT.stairs_stone);
                        clearAbove(sx, sy, G, G + 3);
                        kindMap[sx + sy * W] = 'stair';
                    }
                }
            }
            // Low tactical jersey/sandbag cover inside basin floor corners (leaving stairs & center free).
            if (w >= 6 && d >= 5) {
                const bz = G - 2;
                for (const [cx, cy] of [[x0 + 2, y0 + 2], [x0 + w - 3, y0 + d - 3]]) {
                    if (s.isSolid(cx, cy, bz)) s.set(cx, cy, bz + 1, MAT.jersey);
                }
            }
        }
    }

    if (terrain.highPad) {
        const cx = Math.floor((terrain.highPad.x0 + terrain.highPad.x1) / 2);
        const cy = Math.floor((terrain.highPad.y0 + terrain.highPad.y1) / 2);
        terrain.highPad.z = surfaceZAt(s, cx, cy, G + (terrain.highPad.dz || 2));
    }
    if (terrain.lowerPad) {
        const cx = Math.floor((terrain.lowerPad.x0 + terrain.lowerPad.x1) / 2);
        const cy = Math.floor((terrain.lowerPad.y0 + terrain.lowerPad.y1) / 2);
        terrain.lowerPad.z = surfaceZAt(s, cx, cy, G + (terrain.lowerPad.dz || -2));
    }
    terrain.dz = dzMap;
    terrain.kindMap = kindMap;
    return terrain;
}
