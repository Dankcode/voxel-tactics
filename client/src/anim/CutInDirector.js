// The Chaos Zero Nightmare-style "back shot": when a unit commits an action, the view cuts to an
// over-the-shoulder camera and the character's large 2D back-view illustration slides in from the
// lower left (layered, with parallax), the action name and hit chance show, then it cuts back.
// Presentation only — the battle has already resolved; this never blocks the server.
//
// Layers come from client/public/assets/characters/<art>/cutin.json (placeholders today).
//
// The back shot is used on every switch to the shoulder camera: while aiming (a persistent, unobtrusive back shot
// that follows the crosshair) and when an action is committed (the full cut-in). The art is placed so its barrel tip
// (cutin.json `muzzle`, fractions of the art) sits on the crosshair; the figure fills the lower left of the screen
// and the rest stays clear.
import * as THREE from 'three';
import { PRESETS } from './CutInTimeline.js';
import { loadCharacterArt } from '../units/UnitView.js';

export const CUTIN_MODES = ['always'];
/** Fallback barrel tip for art without a `muzzle` entry. */
export const DEFAULT_MUZZLE = [0.98, 0.35];
/** Letterbox bar height as a share of the viewport (matches .cutin .bar). */
export const BAR_SHARE = 0.11;

/**
 * Screen placement of a back-shot figure whose barrel tip must land on `aim` (CSS px).
 * Height is the art's screenHeight × viewport, grown only as far as needed for the figure to reach the letterbox
 * (no floating bottom edge), and capped so it never fills the screen. Returns { left, top, width, height, origin }.
 */
export function backshotPlacement(cutin, aim, view, { bars = BAR_SHARE, scale = 1, fit = true } = {}) {
    const [u, v] = cutin.muzzle || DEFAULT_MUZZLE;
    const aspect = (cutin.width || 512) / (cutin.height || 768);
    const floorY = view.height * (1 - bars);
    let height = (cutin.screenHeight || 0.6) * view.height * scale;
    if (fit && v < 1) height = Math.max(height, (floorY - aim.y) / (1 - v));
    height = Math.min(height, view.height * 0.9);
    const width = height * aspect;
    return { left: aim.x - u * width, top: aim.y - v * height, width, height, origin: `${(u * 100).toFixed(1)}% ${(v * 100).toFixed(1)}%` };
}
/** Project a three.js world point to CSS pixels of the viewport. */
export function projectToScreen(camera, point, view) {
    const p = point.clone().project(camera);
    return { x: (p.x + 1) * view.width / 2, y: (1 - p.y) * view.height / 2, behind: p.z > 1 };
}
const viewport = () => ({ width: globalThis.innerWidth || 1280, height: globalThis.innerHeight || 720 });

export class CutInDirector {
    constructor(root, cameraDirector) {
        this.root = root; this.cameraDirector = cameraDirector;
        this.mode = 'always';
        this.current = null;
        this.aiming = null;
        this.shownThisTurn = new Set();
        this.root.addEventListener('click', () => this.skip());
    }
    newTurn() { this.shownThisTurn.clear(); }
    /**
     * Aiming back shot: shown whenever the shoulder camera is up for aiming. No bars, caption or flash; it never takes
     * the mouse. `place(screenAim)` is called every frame with the crosshair's CSS position.
     */
    async beginAim(unit) {
        if (this.aiming?.unitId === unit.id) return;
        this.endAim();
        const token = this.aiming = { unitId: unit.id, el: null, art: null, last: null };
        const art = await loadCharacterArt(unit.art);
        if (this.aiming !== token) return;
        const el = document.createElement('div');
        el.className = 'cutin cutin-aim'; el.style.pointerEvents = 'none';
        el.innerHTML = '<div class="figures aligned"><div class="figure" data-aligned="1"></div></div>';
        const fig = el.querySelector('.figure');
        fig.style.aspectRatio = `${art.cutin.width} / ${art.cutin.height}`;
        const origin = backshotPlacement(art.cutin, { x: 0, y: 0 }, viewport()).origin;
        for (const layer of art.cutin.layers) {
            if (layer.blend) continue;                     // muzzle-flash layers only belong to the shot
            const img = document.createElement('img'); img.src = art.base + layer.image; img.draggable = false;
            img.style.transformOrigin = origin; fig.appendChild(img);
        }
        this.root.appendChild(el);
        token.el = el; token.art = art;
        this.cameraDirector.hidden = new Set([unit.id]);
        if (token.last) this.placeAim(token.last);
    }
    placeAim(screenAim) {
        const a = this.aiming; if (!a) return;
        a.last = screenAim;
        if (!a.el || !screenAim) return;
        // Aiming: smaller, no growth to the screen edge (its lower edge fades out instead), so the view stays clear.
        const pl = backshotPlacement(a.art.cutin, screenAim, viewport(), { bars: 0, scale: 0.75, fit: false });
        Object.assign(a.el.querySelector('.figure').style, { left: `${pl.left}px`, top: `${pl.top}px`, width: `${pl.width}px`, height: `${pl.height}px` });
    }
    endAim() {
        if (!this.aiming) return;
        this.aiming.el?.remove();
        this.aiming = null;
        if (!this.current) this.cameraDirector.hidden = new Set();
    }
    skip() { if (this.current) this.current.t = this.current.timeline.duration; }
    /**
     * @param {{ units: {art, name}[], kind, title, subtitle, shooterPos, targetPos, side }} o
     * Returns a promise that resolves when the cut-in finishes (or immediately when disabled).
     */
    async play(o) {
        this.endAim();
        if (o.shooterPos && o.targetPos) this.cameraDirector.begin(o.shooterPos, o.targetPos);
        // Every camera switch uses the back shot (no first-only / off modes any more).
        const key = o.units.map(u => u.id).join(',');
        this.shownThisTurn.add(key);
        // The look point of the action camera is the aim point (targetPos + 1.1 up); the barrel goes there.
        const aimWorld = o.targetPos ? o.targetPos.clone().add(new THREE.Vector3(0, 1.1, 0)) : null;
        const timeline = (PRESETS[o.kind] || PRESETS.shot)(o.side === 'enemy' ? 0.95 : undefined);
        const arts = await Promise.all(o.units.map(u => loadCharacterArt(u.art)));
        const el = document.createElement('div');
        el.className = `cutin cutin-${o.kind} side-${o.side}`;
        el.innerHTML = `<div class="bar top"></div><div class="bar bottom"></div><div class="flash"></div>
            <div class="figures"></div><i class="cutin-crosshair"></i><div class="caption"><div class="title"></div><div class="sub"></div></div>`;
        el.querySelector('.title').textContent = o.title || '';
        el.querySelector('.sub').textContent = o.subtitle || '';
        const figures = el.querySelector('.figures');
        const layerEls = [];
        const aligned = arts.length === 1 && !!aimWorld && this.cameraDirector.active;
        if (aligned) figures.classList.add('aligned');
        arts.forEach((art, i) => {
            const fig = document.createElement('div');
            fig.className = 'figure';
            if (aligned) fig.dataset.aligned = '1';
            fig.style.setProperty('--i', i);
            fig.style.height = `${Math.round((art.cutin.screenHeight || 0.6) * 100 * (o.units.length > 1 ? 0.8 : 1))}vh`;
            fig.style.aspectRatio = `${art.cutin.width} / ${art.cutin.height}`;
            for (const layer of art.cutin.layers) {
                const img = document.createElement('img');
                img.src = art.base + layer.image; img.draggable = false;
                if (aligned) img.style.transformOrigin = backshotPlacement(art.cutin, { x: 0, y: 0 }, viewport()).origin;
                if (layer.blend) img.style.mixBlendMode = layer.blend;
                fig.appendChild(img);
                layerEls.push({ img, parallax: layer.parallax ?? 1, i });
            }
            figures.appendChild(fig);
        });
        this.root.appendChild(el);
        this.cameraDirector.hidden = new Set(o.units.map(u => u.id));
        document.body.classList.add('cutin-active');
        const cur = { timeline, t: 0, el };
        const place = () => {
            if (!aligned) return;
            const view = viewport(), aim = projectToScreen(this.cameraDirector.cam, aimWorld, view);
            const pl = backshotPlacement(arts[0].cutin, aim, view), fig = figures.firstChild;
            Object.assign(fig.style, { left: `${pl.left}px`, top: `${pl.top}px`, width: `${pl.width}px`, height: `${pl.height}px` });
            const ch = el.querySelector('.cutin-crosshair'); ch.style.left = `${aim.x}px`; ch.style.top = `${aim.y}px`; ch.style.display = aim.behind ? 'none' : 'block';
        };
        this.current = cur;
        await new Promise(resolve => {
            let last = performance.now();
            const step = now => {
                const dt = Math.min(0.05, (now - last) / 1000); last = now;
                cur.t += dt;
                const s = timeline.sample(Math.min(cur.t, timeline.duration));
                el.style.setProperty('--bars', s.bars ?? 1);
                el.querySelector('.flash').style.opacity = s.flash ?? 0;
                el.querySelector('.caption').style.opacity = s.text ?? 1;
                for (const l of layerEls) {
                    const x = (1 - (s.slide ?? 1)) * -110 * l.parallax;
                    const scale = 1 + ((s.push ?? 1) - 1) * l.parallax;
                    l.img.style.transform = `translateX(${x}%) scale(${scale})`;
                }
                if (this.cameraDirector.active) this.cameraDirector.apply(s.dolly ?? 0);
                place();
                if (cur.t >= timeline.duration) { resolve(); return; }
                requestAnimationFrame(step);
            };
            requestAnimationFrame(step);
        });
        // Keep the action camera through tracer/skill playback; EventPlayer returns to tactics when the queue drains.
        this.cameraDirector.hidden = new Set();
        document.body.classList.remove('cutin-active');
        el.remove();
        if (this.current === cur) this.current = null;
    }
}
