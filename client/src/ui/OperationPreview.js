// Top-down preview of a generated operation (PLAN-04 layout v3), drawn from the layout data on a canvas: ground,
// buildings shaded by storeys, cover pieces, world edges, the line of play, its flanks, engagement pockets, the
// tunnel, the insertion and the objective. Cheap enough to redraw on every menu change.
import { decodeGround } from '../../../shared/mapgen/Generator.js';

const GROUND = { concrete: '#c9cdc7', asphalt: '#59636a', road_mark: '#d9d6c4', paving: '#b8bdb6', lawn: '#8fa483', gravel: '#a9a397', deck: '#9a8268', soil: '#7a5a3c' };
const PIECE = { car: '#3d4f63', container: '#9c4b3a', jersey: '#e6e3da', planter: '#a7b2a9', crates: '#b98a4e', pallets: '#b08a5c', drums: '#8a2d1c', dumpster: '#3f6a4e', tree: '#3c7a3f', hedge: '#2f7d3a', fence: '#9a795b', low_wall: '#9b5a45', bench: '#8a6a48', bins: '#3d4a52', vending: '#d5dad7', sandbags: '#c2a86b', chainlink: '#8f989c', rubble: '#8a8378', bus_stop: '#5f7680' };
const EDGE = { barricade: '#f2c94c', facade: '#7d868b', wall: '#9b5a45', chainlink: '#8f989c', fence: '#9a795b' };

export function drawOperationPreview(canvas, op) {
    const { layout } = op, W = layout.width, D = layout.depth;
    const dpr = Math.min(2, globalThis.devicePixelRatio || 1), cssW = canvas.clientWidth || 320, s = cssW / W;
    canvas.width = Math.round(cssW * dpr); canvas.height = Math.round(D * s * dpr);
    canvas.style.height = `${D * s}px`;
    const g = canvas.getContext('2d'); g.setTransform(dpr * s, 0, 0, dpr * s, 0, 0);
    const mats = decodeGround(layout.ground.mat);
    for (let y = 0; y < D; y++) for (let x = 0; x < W; x++) { g.fillStyle = GROUND[mats[x + y * W]] || '#c9cdc7'; g.fillRect(x, y, 1.02, 1.02); }
    for (const e of layout.edges || []) { g.fillStyle = EDGE[e.kind] || '#777'; for (const [x, y] of e.cells) g.fillRect(x, y, 1, 1); }
    for (const p of layout.pieces || []) {
        g.fillStyle = PIECE[p.base] || '#666';
        if (p.base === 'car') { const [w, d] = p.axis === 'x' ? [4, 2] : [2, 4]; g.fillRect(p.x + 0.1, p.y + 0.1, w - 0.2, d - 0.2); continue; }
        if (p.base === 'container') { g.fillRect(p.x, p.y, 5, 2); continue; }
        if (p.base === 'tree') { g.beginPath(); g.arc(p.cells[0][0] + 0.5, p.cells[0][1] + 0.5, 1.2, 0, Math.PI * 2); g.fill(); continue; }
        for (const [x, y] of p.cells) g.fillRect(x + 0.08, y + 0.08, 0.84, 0.84);
    }
    for (const b of layout.buildings) {
        const t = Math.min(1, b.storeys / 4);
        g.fillStyle = b.objective ? `rgb(${120 + 60 * t},${70},${60})` : `rgb(${150 - 70 * t},${158 - 70 * t},${150 - 64 * t})`;
        g.fillRect(b.x0, b.y0, b.w, b.d);
        g.strokeStyle = '#1d2a24'; g.lineWidth = 0.18; g.strokeRect(b.x0 + 0.1, b.y0 + 0.1, b.w - 0.2, b.d - 0.2);
        g.fillStyle = '#fff'; g.font = '2.2px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
        g.fillText(`${b.storeys}F`, b.x0 + b.w / 2, b.y0 + b.d / 2);
        if (b.access?.module === 'fire_escape') {
            const side = b.access.side, off = b.access.offset, a = side === 'n' || side === 's' ? [1, 0] : [0, 1], o = { n: [0, -1], s: [0, 1], e: [1, 0], w: [-1, 0] }[side];
            const ox = side === 'e' ? b.x0 + b.w - 1 : side === 'w' ? b.x0 : b.x0 + off, oy = side === 's' ? b.y0 + b.d - 1 : side === 'n' ? b.y0 : b.y0 + off;
            g.fillStyle = '#e8b04a';
            for (let u = 0; u < 6; u++) for (let r = 1; r <= 2; r++) g.fillRect(ox + a[0] * u + o[0] * r + 0.15, oy + a[1] * u + o[1] * r + 0.15, 0.7, 0.7);
        }
    }
    const line = (pts, color, width, dash = []) => { if (!pts?.length) return; g.strokeStyle = color; g.lineWidth = width; g.setLineDash(dash); g.beginPath(); pts.forEach(([x, y], i) => (i ? g.lineTo(x + 0.5, y + 0.5) : g.moveTo(x + 0.5, y + 0.5))); g.stroke(); g.setLineDash([]); };
    if (layout.layers?.route) line(layout.layers.route.map(p => [p.x, p.y]), 'rgba(150,110,240,.75)', 0.6, [0.8, 0.6]);
    for (const f of layout.lineOfPlay?.flanks || []) line(f.path, 'rgba(255,170,60,.85)', 0.45, [1, 0.7]);
    line(layout.lineOfPlay?.main, 'rgba(40,190,255,.95)', 0.6);
    for (const p of layout.pockets || []) { g.strokeStyle = '#e5483d'; g.lineWidth = 0.4; g.beginPath(); g.arc(p.x + 0.5, p.y + 0.5, 2, 0, Math.PI * 2); g.stroke(); }
    const ins = layout.insertion; g.fillStyle = '#2bd47d'; g.beginPath(); g.arc(ins.x + 0.5, ins.y + 1, 1.6, 0, Math.PI * 2); g.fill();
    const obj = layout.objective?.cell; if (obj) { g.fillStyle = '#ffd34d'; g.beginPath(); for (let i = 0; i < 10; i++) { const r = i % 2 ? 0.9 : 2.1, a = -Math.PI / 2 + i * Math.PI / 5; g.lineTo(obj.x + 0.5 + Math.cos(a) * r, obj.y + 0.5 + Math.sin(a) * r); } g.fill(); }
}
