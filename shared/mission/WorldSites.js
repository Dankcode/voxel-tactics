// Mission sites from vibe-game's world generator: run createFantasyWorldRowsAt at a burg and cut a
// compact, JSON-serialisable window (cells, building records, decorations). The site is what gets
// baked to client/public/missions/*.json and what WorldMission.js turns into a voxel battlefield.
import { createFantasyWorldRowsAt } from '../worldgen/MapData.js';
import { ACTIVE_WORLD } from '../worldgen/ActiveWorldData.js';

export const SITE_SCHEMA = 'voxel-tactics-site-v1';
const EDGE = { north: 'n', south: 's', east: 'e', west: 'w' };

export function listLocations() {
    return ACTIVE_WORLD.locations.map(l => ({ id: l.id, name: l.name, type: l.type, themeId: l.themeId, x: l.x, y: l.y, population: l.population, flags: l.flags }));
}

export function generateSite(locationId, { cols = 36, rows: rh = 30 } = {}) {
    const loc = ACTIVE_WORLD.locations.find(l => l.id === locationId) || ACTIVE_WORLD.locations[0];
    const rows = createFantasyWorldRowsAt(loc.x, loc.y);
    return siteFromRows(rows, { id: loc.id, name: loc.name, cols, rows: rh, location: loc });
}

/** Cut a window of `cols × rows` cells around the town centre. */
export function siteFromRows(rows, { id, name, cols = 34, rows: rh = 28, location = null } = {}) {
    const H = rows.length, W = rows[0].length;
    const ox = Math.floor(W / 2), oy = Math.floor(H / 2);
    const cx = rows.townCenter?.x ?? ox, cy = rows.townCenter?.y ?? oy;
    // Slide the window to contain as many whole buildings as possible (ties: nearest the centre).
    let c0 = 0, r0 = 0, bestScore = -Infinity;
    for (let wy = 0; wy <= H - rh; wy += 2) for (let wx = 0; wx <= W - cols; wx += 2) {
        let n = 0;
        for (const b of rows.buildings || []) {
            const bx = ox + b.x - wx, by = oy + b.y - wy;
            if (bx >= 1 && by >= 1 && bx + b.width <= cols - 1 && by + b.height <= rh - 1) n++;
        }
        const score = n * 100 - Math.hypot(wx + cols / 2 - cx, wy + rh / 2 - cy);
        if (score > bestScore) { bestScore = score; c0 = wx; r0 = wy; }
    }
    const cells = [];
    for (let y = 0; y < rh; y++) for (let x = 0; x < cols; x++) {
        const c = rows[r0 + y][c0 + x];
        cells.push([c.element | 0, c.texture | 0, c.building | 0, c.height | 0]);
    }
    const inside = (x, y) => x >= 0 && y >= 0 && x < cols && y < rh;
    const buildings = [];
    for (const b of rows.buildings || []) {
        const x = ox + b.x - c0, y = oy + b.y - r0;
        if (!inside(x, y) || !inside(x + b.width - 1, y + b.height - 1)) continue;
        const door = b.entryDoor || {};
        const side = EDGE[door.edge] || 's';
        buildings.push({
            id: b.id, name: b.name, x, y, w: b.width, h: b.height, stories: b.stories || 1, baseElevation: b.baseElevation || 0,
            archetype: b.archetype, activity: b.activity, wallTextureId: b.wallTextureId, roofStyle: b.roofStyle,
            architectureStyle: b.architectureStyle, facadeKit: b.facadeKit, themeId: b.architectureThemeId,
            entry: { side, offset: side === 'n' || side === 's' ? door.x ?? Math.floor(b.width / 2) : door.y ?? Math.floor(b.height / 2) }
        });
    }
    const decorations = [];
    for (const d of rows.decorations || []) {
        const x = ox + Math.round(d.x) - c0, y = oy + Math.round(d.y) - r0;
        if (inside(x, y)) decorations.push({ type: d.type, x, y });
    }
    return {
        schema: SITE_SCHEMA, id, name: name || rows.townName, cols, rows: rh, window: { c0, r0 },
        theme: rows.theme?.paletteId || null, architectureThemeId: rows.sourceTown?.architectureThemeId || null, biome: rows.sourceTown?.biome || null,
        generationVersion: rows.generationVersion, contentHash: rows.contentHash, location: location ? { x: location.x, y: location.y, type: location.type } : null,
        cells, buildings, decorations
    };
}
