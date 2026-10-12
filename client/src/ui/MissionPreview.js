// Top-down preview of a compiled battle for the test ground: the voxel tops shaded by height, the squad spawns, every
// hostile (coloured and lettered by type, so colour is never the only cue) and the objective.
import { materialById } from '../../../shared/voxel/Materials.js';
import { ENEMIES } from '../../../shared/content/units.js';

export const ENEMY_STYLE = Object.freeze({
    cultist: { color: '#d64541', letter: 'G' },
    archer: { color: '#2f7fd8', letter: 'L' },
    pyromancer: { color: '#f08a24', letter: 'A' },
    brute: { color: '#7b3fbf', letter: 'E' },
    warden_foe: { color: '#2f3a36', letter: 'R' }
});
export const styleOf = type => ENEMY_STYLE[type] || { color: '#a33', letter: (ENEMIES[type]?.name || type)[0].toUpperCase() };

const rgb = hex => [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255];

export function drawMissionPreview(canvas, battle) {
    const store = battle.store, W = store.width, D = store.depth, H = store.height;
    const dpr = Math.min(2, globalThis.devicePixelRatio || 1), cssW = canvas.clientWidth || 360, s = cssW / W;
    canvas.width = Math.round(cssW * dpr); canvas.height = Math.round(D * s * dpr); canvas.style.height = `${D * s}px`;
    const g = canvas.getContext('2d');
    const img = g.createImageData(W, D);
    for (let y = 0; y < D; y++) for (let x = 0; x < W; x++) {
        const z = store.topSolid(x, y), i = (x + y * W) * 4;
        const [r, gg, b] = z < 0 ? [40, 40, 40] : rgb(materialById(store.get(x, y, z)).color ?? 0x888888);
        const shade = z < 0 ? 1 : 0.62 + 0.38 * Math.min(1, z / Math.max(8, H * 0.7));
        img.data[i] = r * shade; img.data[i + 1] = gg * shade; img.data[i + 2] = b * shade; img.data[i + 3] = 255;
    }
    // Draw the 1-pixel-per-cell image scaled up, then the markers in cell units.
    const tmp = Object.assign(document.createElement('canvas'), { width: W, height: D });
    tmp.getContext('2d').putImageData(img, 0, 0);
    g.imageSmoothingEnabled = false;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.drawImage(tmp, 0, 0, W * s, D * s);
    g.setTransform(dpr * s, 0, 0, dpr * s, 0, 0);
    const o = battle.objective;
    if (o.zone) { g.strokeStyle = '#ffd34d'; g.lineWidth = 0.35; g.setLineDash([0.8, 0.5]); g.strokeRect(o.zone.x0, o.zone.y0, o.zone.x1 - o.zone.x0 + 1, o.zone.y1 - o.zone.y0 + 1); g.setLineDash([]); }
    if (o.item) { g.fillStyle = '#ffd34d'; g.strokeStyle = '#3b2f00'; g.lineWidth = 0.15; star(g, o.item.x + 0.5, o.item.y + 0.5, 1.6); }
    const dot = (x, y, r, fill, letter) => {
        g.beginPath(); g.arc(x + 0.5, y + 0.5, r, 0, Math.PI * 2); g.fillStyle = fill; g.fill();
        g.lineWidth = 0.18; g.strokeStyle = '#fff'; g.stroke();
        if (letter) { g.fillStyle = '#fff'; g.font = `700 ${r * 1.3}px system-ui, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(letter, x + 0.5, y + 0.55); }
    };
    for (const u of battle.units.filter(u => u.side === 'player')) dot(u.x, u.y, 0.75, '#1f9e63', null);
    for (const u of battle.units.filter(u => u.side === 'enemy')) { const st = styleOf(u.type); dot(u.x, u.y, 0.82, st.color, st.letter); }
}
function star(g, cx, cy, r) {
    g.beginPath();
    for (let i = 0; i < 10; i++) { const rr = i % 2 ? r * 0.45 : r, a = -Math.PI / 2 + i * Math.PI / 5; g.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr); }
    g.closePath(); g.fill(); g.stroke();
}
