// Dynamic multi-elevation terrain features: lot-aligned urban terraces (San Francisco hillside avenues,
// highland ridges, sunken valleys), sloped streets with parallel sidewalk stairs, public terrace staircases,
// and sunken canals with bridges and grounded stone bank stairs.
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

/** Kit stair yaw pointing toward the uphill unit vector (ux, uy). */
export function stairYawFor(ux, uy) {
    if (Math.abs(ux) >= Math.abs(uy)) return ux >= 0 ? 0 : Math.PI;
    return uy >= 0 ? -Math.PI / 2 : Math.PI / 2;
}

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
        hillside_avenue: ['bottom_to_top', 'top_to_bottom', 'high_to_low'],
        hillside_ridge: ['bottom_to_top', 'top_to_bottom'],
        sunken_basin: ['high_to_low', 'low_to_high_to_low'],
        arid_compound: ['bottom_to_top', 'auto'],
        winter_outpost: ['high_to_low', 'auto'],
        harbor: ['low_to_high_to_low', 'auto']
    }[family];
    if (!byFamily) return 'auto';
    return byFamily[Math.floor(unit(`${family}:${seed}:flow`) * byFamily.length)] || 'auto';
}

/** Look up planned terrace elevation delta at cell (x, y). */
export function elevationAt(terrain, x, y, width) {
    if (!terrain?.baseDz) return 0;
    const ix = Math.max(0, Math.min(width - 1, Math.floor(x)));
    const iy = Math.max(0, Math.floor(y));
    const idx = ix + iy * width;
    return idx >= 0 && idx < terrain.baseDz.length ? (terrain.baseDz[idx] || 0) : 0;
}

/**
 * Plan coherent lot-aligned urban elevation offsets (`Int8Array(LW * LD)`).
 * Buildings (and their attached wings) always remain on a uniform flat terrace level.
 */
export function planLotTerraces({ plot, buildings = [], flow = 'auto', seed = 1 }) {
    const { LW, LD, W, D, family, insertion, objective, lots, underground } = plot;
    const lotDz = new Int8Array(LW * LD);
    const effectiveFlow = resolveVerticalFlow(flow, family, seed);
    if (family === 'canal_district' || plot.picture) return lotDz;

    const wantElevation = ['hillside_avenue', 'hillside_ridge', 'sunken_basin'].includes(family)
        || (flow && flow !== 'auto' && OPERATION_FLOWS.includes(flow));
    if (!wantElevation) return lotDz;

    const minDz = underground ? 0 : -2;
    const insLx = Math.max(0, Math.min(LW - 1, Math.floor((insertion?.x ?? 0) / 8)));
    const insLy = Math.max(0, Math.min(LD - 1, Math.floor((insertion?.y ?? 0) / 8)));
    const objLx = objective ? objective.lx + 0.5 : (LW - 1) / 2;
    const objLy = objective ? objective.ly + 0.5 : (LD - 1) / 2;

    if (family === 'sunken_basin' && minDz <= -2) {
        // Perimeter rim at dz = 0, intermediate shelf at -1, recessed central valley at -2.
        const roadRows = new Set((lots || []).filter(l => l.road && l.road.e && l.road.w).map(l => l.ly));
        const rimRow = roadRows.size ? [...roadRows][0] : 1;
        const flipDown = rimRow <= Math.floor(LD / 2);
        for (let ly = 0; ly < LD; ly++) {
            const dist = flipDown ? (ly - rimRow) : (rimRow - ly);
            const band = dist <= 0 ? 0 : dist === 1 ? -1 : -2;
            for (let lx = 0; lx < LW; lx++) {
                // Keep outer lateral edges slightly proud when away from main basin center to frame the valley.
                const isSideRim = (lx === 0 || lx === LW - 1) && dist === 1;
                lotDz[lx + ly * LW] = Math.max(minDz, isSideRim ? 0 : band);
            }
        }
    } else if (family === 'hillside_avenue' || family === 'hillside_ridge' || effectiveFlow !== 'auto') {
        const climbX = Math.abs(objLx - insLx) >= Math.abs(objLy - insLy);
        const reverse = effectiveFlow === 'high_to_low' || effectiveFlow === 'top_to_bottom';
        // Step terraces across block boundaries so whole buildings remain inside one terrace band cleanly.
        if (climbX) {
            const leftToRight = insLx <= objLx ? !reverse : reverse;
            for (let lx = 0; lx < LW; lx++) {
                const pos = leftToRight ? lx : (LW - 1 - lx);
                const band = pos < 2 ? 0 : pos < 4 ? 1 : 2;
                for (let ly = 0; ly < LD; ly++) lotDz[lx + ly * LW] = band;
            }
        } else {
            const topToBottom = insLy <= objLy ? !reverse : reverse;
            for (let ly = 0; ly < LD; ly++) {
                const pos = topToBottom ? ly : (LD - 1 - ly);
                const band = pos === 0 ? 0 : pos <= 2 ? 1 : 2;
                for (let lx = 0; lx < LW; lx++) lotDz[lx + ly * LW] = band;
            }
        }
        // In low_to_high_to_low without underground, keep a lower valley terrace (-1) on the non-crest end.
        if (effectiveFlow === 'low_to_high_to_low' && minDz <= -1 && family !== 'hillside_avenue') {
            for (let i = 0; i < lotDz.length; i++) lotDz[i] = Math.max(minDz, lotDz[i] - 1);
        }
    }

    // Clamp buildings (and linked wings) onto a uniform flat terrace height so doorways sit flush.
    const groups = new Map();
    for (const b of buildings) {
        const rootId = b.wingOf || b.id;
        if (!groups.has(rootId)) groups.set(rootId, []);
        groups.get(rootId).push(b);
    }
    for (const members of groups.values()) {
        const anchor = members.find(b => !b.wingOf) || members[0];
        const cx = Math.max(0, Math.min(LW - 1, Math.floor((anchor.x0 + anchor.w / 2) / 8)));
        const cy = Math.max(0, Math.min(LD - 1, Math.floor((anchor.y0 + anchor.d / 2) / 8)));
        const dz = lotDz[cx + cy * LW];
        for (const b of members) {
            const x0 = Math.max(0, Math.floor(b.x0 / 8));
            const x1 = Math.min(LW - 1, Math.floor((b.x0 + b.w - 1) / 8));
            const y0 = Math.max(0, Math.floor(b.y0 / 8));
            const y1 = Math.min(LD - 1, Math.floor((b.y0 + b.d - 1) / 8));
            for (let ly = y0; ly <= y1; ly++) for (let lx = x0; lx <= x1; lx++) {
                if (!lots?.[lx + ly * LW]?.road) lotDz[lx + ly * LW] = dz;
            }
        }
    }

    // Verify required height contrast exists for elevation biomes.
    if (family === 'hillside_avenue' || family === 'hillside_ridge') {
        const maxV = Math.max(...lotDz);
        if (maxV < 2 && LW >= 4) {
            for (let ly = 0; ly < LD; ly++) for (let lx = Math.max(0, LW - 2); lx < LW; lx++) {
                if (!buildings.some(b => lx * 8 < b.x0 + b.w && (lx + 1) * 8 > b.x0 && ly * 8 < b.y0 + b.d && (ly + 1) * 8 > b.y0)) {
                    lotDz[lx + ly * LW] = 2;
                }
            }
        }
    }
    void W; void D;
    return lotDz;
}

/**
 * Plan deterministic multi-elevation terrain features: lot-aligned terraces, SF sloped streets with parallel
 * sidewalk stairs, public terrace staircases, canal crossings, highPad/lowerPad, and protected coords.
 */
export function planTerrainFeatures({ plot, ground, buildings, layers = null, flow = 'auto', seed = 1, lotDz = null }) {
    const { W, D, LW, LD, family, lots } = plot;
    const effectiveFlow = resolveVerticalFlow(flow, family, seed);
    const terraces = lotDz || planLotTerraces({ plot, buildings, flow: effectiveFlow, seed });
    const baseDz = new Int8Array(W * D);
    for (let ly = 0; ly < LD; ly++) for (let lx = 0; lx < LW; lx++) {
        const v = terraces[lx + ly * LW];
        if (!v) continue;
        for (let dy = 0; dy < 8; dy++) for (let dx = 0; dx < 8; dx++) {
            const x = lx * 8 + dx, y = ly * 8 + dy;
            if (x < W && y < D) baseDz[x + y * W] = v;
        }
    }

    const nearBuilding = (x, y, pad = 1) => buildings.some(b =>
        x >= b.x0 - pad && x <= b.x0 + b.w - 1 + pad && y >= b.y0 - pad && y <= b.y0 + b.d - 1 + pad
    );
    const layerBlocked = (x, y, pad = 2) => {
        if (!layers) return false;
        const pts = [...(layers.openings || []).flatMap(o => [o.from, o.to]), ...(layers.entrances || []), layers.drop].filter(Boolean);
        return pts.some(p => Math.abs(p.x - x) <= pad && Math.abs(p.y - y) <= pad);
    };
    const roadMask = new Uint8Array(W * D);
    for (const lot of lots || []) if (lot.road) {
        for (let dy = 0; dy < 8; dy++) for (let dx = 0; dx < 8; dx++) {
            if (lot.x0 + dx < W && lot.y0 + dy < D) roadMask[(lot.x0 + dx) + (lot.y0 + dy) * W] = 1;
        }
    }

    const features = [];
    const slopeMask = new Uint8Array(W * D);
    const markSlope = (x, y) => { if (x >= 0 && y >= 0 && x < W && y < D) slopeMask[x + y * W] = 1; };

    // 1. Detect adjacent lot height transitions -> SF sloped roads & pedestrian terrace stairs.
    const seenSeam = new Set();
    const lotAt = (lx, ly) => (lx >= 0 && ly >= 0 && lx < LW && ly < LD ? lots[lx + ly * LW] : null);
    for (let ly = 0; ly < LD; ly++) for (let lx = 0; lx < LW; lx++) {
        const a = lotAt(lx, ly); if (!a) continue;
        const za = terraces[lx + ly * LW];
        for (const [dx, dy, axis] of [[1, 0, 'x'], [0, 1, 'y']]) {
            const bx = lx + dx, by = ly + dy;
            const b = lotAt(bx, by); if (!b) continue;
            const zb = terraces[bx + by * LW];
            if (za === zb) continue;
            const seamKey = `${lx},${ly}->${bx},${by}`;
            if (seenSeam.has(seamKey)) continue;
            seenSeam.add(seamKey);

            const highLot = za > zb ? a : b;
            const lowLot = za > zb ? b : a;
            const zLow = Math.min(za, zb);
            const zHigh = Math.max(za, zb);
            const steps = Math.min(2, zHigh - zLow);
            // Direction from low lot toward high lot (uphill vector)
            const ux = Math.sign(highLot.lx - lowLot.lx);
            const uy = Math.sign(highLot.ly - lowLot.ly);
            const yaw = stairYawFor(ux, uy);

            const bothRoad = Boolean(a.road && b.road);
            if (bothRoad) {
                // San Francisco sloped road: center 4-cell carriageway uses road_slope/cobble_slope,
                // flanking 2-cell sidewalks on each side use parallel sidewalk_stair treads!
                const roadCells = [], stairCells = [];
                for (let step = 0; step < steps; step++) {
                    const depthOff = step;
                    for (let t = 0; t < 8; t++) {
                        // Place step cells along lowLot's edge nearest highLot.
                        const cx = axis === 'x'
                            ? (ux > 0 ? highLot.x0 - 1 - depthOff : highLot.x0 + 8 + depthOff)
                            : lowLot.x0 + t;
                        const cy = axis === 'y'
                            ? (uy > 0 ? highLot.y0 - 1 - depthOff : highLot.y0 + 8 + depthOff)
                            : lowLot.y0 + t;
                        const dzVal = zHigh - step;
                        const isCarriageway = t >= 2 && t <= 5;
                        const rec = { x: cx, y: cy, dz: dzVal, yaw };
                        if (isCarriageway) roadCells.push(rec); else stairCells.push(rec);
                        markSlope(cx, cy);
                    }
                }
                features.push({ kind: 'road_slope', axis, ux, uy, yaw, zLow, zHigh, roadCells, stairCells });
            } else {
                // Terrace seam between non-road lots or between a road and a block lot:
                // Build a clean 3-wide public stairway (away from buildings) + safety railing along open cliff.
                const stairs = [], rails = [];
                // Find open span along the seam for a 3-wide (fallback 2-wide) staircase (avoid buildings and driveways).
                let widthStair = 3;
                let candidates = [];
                for (const wCand of [3, 2]) {
                    candidates = [];
                    for (let t = 1; t <= 6 - wCand; t++) {
                        let ok = true;
                        for (let k = 0; k < wCand && ok; k++) {
                            const tx = axis === 'x' ? highLot.x0 : lowLot.x0 + t + k;
                            const ty = axis === 'y' ? highLot.y0 : lowLot.y0 + t + k;
                            const lxSide = axis === 'x' ? (ux > 0 ? highLot.x0 - 1 : highLot.x0 + 8) : tx;
                            const lySide = axis === 'y' ? (uy > 0 ? highLot.y0 - 1 : highLot.y0 + 8) : ty;
                            if (nearBuilding(tx, ty, 0) || nearBuilding(lxSide, lySide, 0) || layerBlocked(tx, ty, 1) || layerBlocked(lxSide, lySide, 1)) ok = false;
                            if (ground?.cls?.[lxSide + lySide * W] === 'driveway' || ground?.cls?.[tx + ty * W] === 'driveway') ok = false;
                        }
                        if (ok) candidates.push(t);
                    }
                    if (candidates.length) { widthStair = wCand; break; }
                }
                const stairStart = candidates.length ? candidates[Math.floor(unit(`${seed}:stair:${seamKey}`) * candidates.length)] : null;
                const stairOffsets = new Set(stairStart != null ? Array.from({ length: widthStair }, (_, k) => stairStart + k) : []);
                for (let t = 0; t < 8; t++) {
                    const edgeX = axis === 'x' ? (ux > 0 ? highLot.x0 : highLot.x0 + 7) : highLot.x0 + t;
                    const edgeY = axis === 'y' ? (uy > 0 ? highLot.y0 : highLot.y0 + 7) : highLot.y0 + t;
                    if (stairOffsets.has(t)) {
                        for (let step = 0; step < steps; step++) {
                            const sx = axis === 'x' ? (ux > 0 ? highLot.x0 - 1 - step : highLot.x0 + 8 + step) : highLot.x0 + t;
                            const sy = axis === 'y' ? (uy > 0 ? highLot.y0 - 1 - step : highLot.y0 + 8 + step) : highLot.y0 + t;
                            stairs.push({ x: sx, y: sy, dz: zHigh - step, yaw });
                            markSlope(sx, sy);
                        }
                    } else if (!nearBuilding(edgeX, edgeY, 1) && !roadMask[edgeX + edgeY * W]
                        && ground?.cls?.[edgeX + edgeY * W] !== 'driveway' && !layerBlocked(edgeX, edgeY, 1)) {
                        // Leave middle corners clear when lowLot is a road so street entrances stay open.
                        if (lowLot.road && t >= 2 && t <= 5) continue;
                        rails.push({ x: edgeX, y: edgeY, dz: zHigh });
                    }
                }
                if (stairs.length || rails.length) {
                    features.push({ kind: 'terrace_edge', zLow, zHigh, yaw, stairs, rails });
                }
            }
        }
    }

    // 2. Canal Quarter: cross-map sunken waterway with stone quays, stairs (with explicit yaw!), and stone bridges.
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
            const trimmedBridges = bridges.slice(0, 3);
            features.push({
                kind: 'canal', axis: 'x', y0: bestRow, width: 3, x0: 2, x1: W - 3,
                bridges: trimmedBridges, depth: 1
            });
            for (let cx = 2; cx <= W - 3; cx++) {
                for (let dy = -1; dy <= 3; dy++) markSlope(cx, bestRow + dy);
            }
        }
    }

    // 3. Locate tactical highPad and lowerPad (open 4x4 areas clear of buildings and slopes).
    const findPad = targetDz => {
        let best = null;
        for (const lot of lots || []) {
            if (lot.road) continue;
            if (terraces[lot.lx + lot.ly * LW] !== targetDz) continue;
            const x0 = lot.x0 + 2, y0 = lot.y0 + 2, x1 = lot.x0 + 5, y1 = lot.y0 + 5;
            let ok = x1 < W - 1 && y1 < D - 1;
            for (let y = y0; y <= y1 && ok; y++) for (let x = x0; x <= x1 && ok; x++) {
                if (nearBuilding(x, y, 0) || slopeMask[x + y * W] || layerBlocked(x, y, 1) || ground?.mat?.[x + y * W] === 'air') ok = false;
            }
            if (ok) { best = { x0, y0, x1, y1, dz: targetDz }; break; }
        }
        return best;
    };
    const maxDz = Math.max(...terraces), minPlannedDz = Math.min(...terraces);
    const highPad = maxDz > 0 ? findPad(maxDz) : null;
    const lowerPad = minPlannedDz < 0 ? findPad(minPlannedDz) : (family === 'hillside_avenue' || family === 'hillside_ridge' ? findPad(0) : null);

    const protectedCoords = [];
    for (let y = 0; y < D; y++) for (let x = 0; x < W; x++) {
        if (slopeMask[x + y * W]) protectedCoords.push([x, y]);
    }
    for (const pad of [highPad, lowerPad]) if (pad) {
        for (let y = pad.y0 + 1; y <= pad.y1 - 1; y++) for (let x = pad.x0 + 1; x <= pad.x1 - 1; x++) {
            protectedCoords.push([x, y]);
        }
    }

    return {
        version: 2,
        family,
        flow: effectiveFlow,
        requestedFlow: flow || 'auto',
        lotDz: terraces,
        baseDz,
        slopeMask,
        features,
        highPad,
        lowerPad,
        protectedCoords
    };
}

/** Surface slope material matching biome aesthetic. */
function roadSlopeMatFor(family) {
    return ['old_quarter', 'canal_district', 'hillside_ridge'].includes(family) ? MAT.cobble_slope : MAT.road_slope;
}

/**
 * Compile base terrace elevations BEFORE buildings, pieces, and edges are placed so every lot and street edge
 * starts cleanly at its terrace ground level `G + baseDz[x, y]`.
 */
export function compileTerrainBase(m, terrain, layout, mats) {
    if (!terrain?.baseDz) return;
    const s = m.store, G = m.G, W = layout.width, D = layout.depth;
    for (let y = 0; y < D; y++) for (let x = 0; x < W; x++) {
        const dz = terrain.baseDz[x + y * W] || 0;
        if (!dz) continue;
        const matKey = mats[x + y * W];
        if (!matKey || matKey === 'air') continue;
        const gz = Math.max(1, G + dz);
        s.set(x, y, 0, MAT.bedrock);
        for (let z = 1; z < gz; z++) s.set(x, y, z, MAT.concrete);
        s.set(x, y, gz, MAT[matKey] ?? MAT.concrete);
        for (let z = gz + 1; z <= G + 4 && z < s.height; z++) s.set(x, y, z, AIR);
    }
}

/**
 * Compile sloped roads, parallel sidewalk stairs, terrace staircases, retaining railings, and canals onto `m.store`.
 * Must run AFTER buildings, bay pieces, and world edges so hints & stairs sit cleanly on the final terrain.
 */
export function compileTerrainFeatures(m, terrain, layout) {
    if (!terrain) return null;
    const s = m.store, G = m.G, W = layout.width, D = layout.depth;
    const family = layout.plot?.family || 'downtown';
    const dzMap = terrain.baseDz ? Array.from(terrain.baseDz) : new Array(W * D).fill(0);
    const kindMap = new Array(W * D).fill('flat');
    for (let i = 0; i < dzMap.length; i++) if (dzMap[i] !== 0) kindMap[i] = dzMap[i] > 0 ? 'terrace_high' : 'terrace_low';

    const clearAbove = (x, y, zFrom, zTo = zFrom + 4) => {
        for (let z = zFrom; z <= zTo && z < s.height; z++) {
            if (s.inBounds(x, y, z)) s.set(x, y, z, AIR);
        }
    };
    const isFootprintFree = (x, y) => !layout.buildings.some(b =>
        x >= b.x0 && x < b.x0 + b.w && y >= b.y0 && y < b.y0 + b.d
    ) && !m.keep?.has(`${x},${y}`);

    const placeRamp = (x, y, z, matId, yaw, kindLabel) => {
        if (!s.inBounds(x, y, z + 3) || !isFootprintFree(x, y)) return;
        s.set(x, y, 0, MAT.bedrock);
        for (let k = 1; k < z; k++) s.set(x, y, k, MAT.stone);
        s.set(x, y, z, matId);
        m.ctx.hints[`${x},${y},${z}`] = { ...(m.ctx.hints[`${x},${y},${z}`] || {}), stairYaw: yaw };
        clearAbove(x, y, z + 1, z + 4);
        dzMap[x + y * W] = z - G;
        kindMap[x + y * W] = kindLabel;
    };

    const roadSlopeMat = roadSlopeMatFor(family);

    for (const f of terrain.features || []) {
        if (f.kind === 'road_slope') {
            for (const c of f.roadCells || []) {
                placeRamp(c.x, c.y, Math.max(1, G + c.dz), roadSlopeMat, c.yaw, 'road_slope');
            }
            for (const c of f.stairCells || []) {
                placeRamp(c.x, c.y, Math.max(1, G + c.dz), MAT.sidewalk_stair, c.yaw, 'stair');
            }
        } else if (f.kind === 'terrace_edge') {
            for (const st of f.stairs || []) {
                placeRamp(st.x, st.y, Math.max(1, G + st.dz), MAT.sidewalk_stair, st.yaw, 'stair');
            }
            for (const r of f.rails || []) {
                const rz = Math.max(1, G + r.dz);
                if (!s.inBounds(r.x, r.y, rz + 2) || !isFootprintFree(r.x, r.y)) continue;
                if (s.isSolid(r.x, r.y, rz) && s.get(r.x, r.y, rz + 1) === AIR) {
                    s.set(r.x, r.y, rz + 1, MAT.railing);
                }
            }
        } else if (f.kind === 'canal') {
            const { x0, x1, y0, width } = f;
            const bridgeSet = new Set();
            for (const b of f.bridges || []) for (let x = b.x0; x < b.x0 + b.w; x++) bridgeSet.add(x);

            for (let x = x0; x <= x1; x++) {
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
                    s.set(x, y, 0, MAT.bedrock);
                    for (let z = 1; z < G - 1; z++) s.set(x, y, z, MAT.stone);
                    if (onBridge) {
                        for (let z = 1; z < G; z++) s.set(x, y, z, MAT.stone);
                        s.set(x, y, G, MAT.stone_floor);
                        clearAbove(x, y, G + 1, G + 3);
                        dzMap[x + y * W] = 0;
                        kindMap[x + y * W] = 'bridge';
                    } else if (dy === 0) {
                        s.set(x, y, G - 1, MAT.cobble);
                        clearAbove(x, y, G, G + 3);
                        dzMap[x + y * W] = -1;
                        kindMap[x + y * W] = 'quay';
                    } else {
                        s.set(x, y, G - 1, MAT.water);
                        clearAbove(x, y, G, G + 3);
                        dzMap[x + y * W] = -1;
                        kindMap[x + y * W] = 'canal';
                    }
                }
            }
            const stairSpots = [];
            for (const b of f.bridges || []) {
                if (b.x0 - 2 >= x0) stairSpots.push(b.x0 - 2);
                if (b.x0 + b.w + 1 <= x1) stairSpots.push(b.x0 + b.w + 1);
            }
            for (const sx of stairSpots) {
                for (const dx of [0, 1]) {
                    const x = sx + dx;
                    if (x > x1 || bridgeSet.has(x)) continue;
                    // North bank stair (y0 - 1) climbs uphill toward North (0, -1 -> yaw +PI/2)
                    const ny = y0;
                    if (s.inBounds(x, ny, G + 2) && isFootprintFree(x, ny) && isFootprintFree(x, ny - 1)) {
                        s.set(x, ny, G - 1, MAT.cobble);
                        s.set(x, ny - 1, G, MAT.stairs_stone);
                        m.ctx.hints[`${x},${ny - 1},${G}`] = { ...(m.ctx.hints[`${x},${ny - 1},${G}`] || {}), stairYaw: stairYawFor(0, -1) };
                        clearAbove(x, ny - 1, G + 1, G + 3);
                        kindMap[x + (ny - 1) * W] = 'stair';
                    }
                    // South bank stair (y0 + width) climbs uphill toward South (0, +1 -> yaw -PI/2)
                    const sy = y0 + width - 1;
                    if (s.inBounds(x, sy + 1, G + 2) && isFootprintFree(x, sy) && isFootprintFree(x, sy + 1)) {
                        s.set(x, sy, G - 1, MAT.cobble);
                        clearAbove(x, sy, G, G + 3);
                        s.set(x, sy + 1, G, MAT.stairs_stone);
                        m.ctx.hints[`${x},${sy + 1},${G}`] = { ...(m.ctx.hints[`${x},${sy + 1},${G}`] || {}), stairYaw: stairYawFor(0, 1) };
                        clearAbove(x, sy + 1, G + 1, G + 3);
                        kindMap[x + (sy + 1) * W] = 'stair';
                    }
                }
            }
        }
    }

    if (terrain.highPad) {
        const cx = Math.floor((terrain.highPad.x0 + terrain.highPad.x1) / 2);
        const cy = Math.floor((terrain.highPad.y0 + terrain.highPad.y1) / 2);
        const expected = G + (terrain.highPad.dz ?? 2);
        const surfZ = surfaceZAt(s, cx, cy, expected);
        terrain.highPad.z = Math.abs(surfZ - expected) <= 1 ? surfZ : expected;
    }
    if (terrain.lowerPad) {
        const cx = Math.floor((terrain.lowerPad.x0 + terrain.lowerPad.x1) / 2);
        const cy = Math.floor((terrain.lowerPad.y0 + terrain.lowerPad.y1) / 2);
        const expected = G + (terrain.lowerPad.dz ?? -2);
        const surfZ = surfaceZAt(s, cx, cy, expected);
        terrain.lowerPad.z = Math.abs(surfZ - expected) <= 1 ? surfZ : expected;
    }
    terrain.dz = dzMap;
    terrain.kindMap = kindMap;
    return terrain;
}
