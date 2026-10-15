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
/**
 * The back shot for a shoulder side. Right (default) is the art as drawn: the figure on the left of the screen, barrel
 * pointing right. Left (the soldier leans or steps out to the left, the camera looks over the left shoulder) uses the
 * art's `variants.left` from cutin.json when it has one (its own layers/size/muzzle, no mirroring); until that art
 * exists, the right-hand art is mirrored (muzzle u → 1 − u). Returns { cutin, mirror, shoulder }.
 */
export function sideCutin(cutin, shoulder = 'right') {
    if (shoulder !== 'left') return { cutin, mirror: false, shoulder: 'right' };
    const v = cutin.variants?.left;
    if (v) return { cutin: { ...cutin, ...v, variants: undefined }, mirror: false, shoulder: 'left' };
    const [u, y] = cutin.muzzle || DEFAULT_MUZZLE;
    return { cutin: { ...cutin, muzzle: [1 - u, y] }, mirror: true, shoulder: 'left' };
}
/** Project a three.js world point to CSS pixels of the viewport. */
export function projectToScreen(camera, point, view) {
    const p = point.clone().project(camera);
    return { x: (p.x + 1) * view.width / 2, y: (1 - p.y) * view.height / 2, behind: p.z > 1 };
}
/** Aiming back shot layout: static in the bottom-left corner just past the squad rail, whole figure visible. */
export const AIM_SHOT = Object.freeze({ heightShare: 0.46, maxWidthShare: 0.42, gap: 12, followTau: 0.2, maxLean: 9, maxBend: 7, bendPerPx: 0.012 });
export function aimBackshotLayout(cutin, view, railRight = 0, shoulder = 'right') {
    const aspect = (cutin.width || 512) / (cutin.height || 768);
    let height = view.height * AIM_SHOT.heightShare, width = height * aspect;
    if (width > view.width * AIM_SHOT.maxWidthShare) { width = view.width * AIM_SHOT.maxWidthShare; height = width / aspect; }
    // Left shoulder: the mirror image, static in the bottom-right corner.
    const left = shoulder === 'left' ? Math.max(0, view.width - width - AIM_SHOT.gap) : Math.max(0, railRight + AIM_SHOT.gap);
    return { left, top: view.height - height, width, height };
}
/**
 * How the static figure leans toward the (lagged) crosshair: it pivots at its feet so the barrel swings toward the
 * crosshair (lean, clamped), and its upper body trails the crosshair's motion while it moves (inertia, bend).
 * lag/vel are the crosshair position and velocity after the follow spring (CSS px, px/s). Degrees out.
 */
export function aimBackshotPose(cutin, layout, lag, vel = { x: 0, y: 0 }, neutral = null) {
    const [u, v] = cutin.muzzle || DEFAULT_MUZZLE;
    const pivot = { x: layout.left + layout.width / 2, y: layout.top + layout.height };
    const muzzle = { x: layout.left + u * layout.width, y: layout.top + v * layout.height };
    // Upright when the crosshair is at `neutral` (the screen centre in play; the barrel line by default).
    const n = neutral || muzzle;
    const rest = Math.atan2(n.y - pivot.y, n.x - pivot.x), want = Math.atan2(lag.y - pivot.y, lag.x - pivot.x);
    let d = (want - rest) * 180 / Math.PI; d = ((d + 540) % 360) - 180;
    const clamp = (x, m) => Math.max(-m, Math.min(m, x));
    // CSS skewX(+) with a bottom origin moves the top left: a crosshair moving right leaves the upper body trailing.
    return { lean: clamp(d * 0.5, AIM_SHOT.maxLean), bend: clamp(vel.x * AIM_SHOT.bendPerPx, AIM_SHOT.maxBend) };
}
/** One step of the critically damped follow spring (the slight delay behind the crosshair). */
export function followStep(state, target, dt, tau = AIM_SHOT.followTau) {
    if (!state.pos) { state.pos = { ...target }; state.vel = { x: 0, y: 0 }; return state; }
    const w = 2 / tau, n = Math.max(1, Math.ceil(dt / 0.008)), h = dt / n;
    for (let i = 0; i < n; i++) for (const c of ['x', 'y']) {
        const a = w * w * (target[c] - state.pos[c]) - 2 * w * state.vel[c];
        state.vel[c] += a * h; state.pos[c] += state.vel[c] * h;
    }
    return state;
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
     * the mouse. It stands still in the bottom-left corner; `placeAim(screenAim)` (every frame, crosshair CSS position)
     * makes it lean toward the crosshair with a slight delay and bend with the crosshair's motion.
     */
    async beginAim(unit, { shoulder = 'right' } = {}) {
        if (this.aiming?.unitId === unit.id && this.aiming.shoulder === shoulder) return;
        const last = this.aiming?.unitId === unit.id ? this.aiming.last : null;
        this.endAim();
        const token = this.aiming = { unitId: unit.id, shoulder, el: null, art: null, last };
        const loaded = await loadCharacterArt(unit.art);
        if (this.aiming !== token) return;
        const side = sideCutin(loaded.cutin, shoulder), art = { ...loaded, cutin: side.cutin };
        token.mirror = side.mirror;
        const el = document.createElement('div');
        el.className = 'cutin cutin-aim'; el.style.pointerEvents = 'none';
        el.innerHTML = '<div class="figures aligned"><div class="figure" data-aligned="1"></div></div>';
        const fig = el.querySelector('.figure');
        fig.style.aspectRatio = `${art.cutin.width} / ${art.cutin.height}`;
        for (const layer of art.cutin.layers) {
            if (layer.blend) continue;                     // muzzle-flash layers only belong to the shot
            const img = document.createElement('img'); img.src = art.base + layer.image; img.draggable = false;
            if (side.mirror) img.style.transform = 'scaleX(-1)';
            fig.appendChild(img);
        }
        // Under the HUD (buttons and portraits stay on top), above the 3D view.
        this.aimLayer().appendChild(el);
        token.el = el; token.art = art;
        this.cameraDirector.hidden = new Set([unit.id]);
        if (token.last) this.placeAim(token.last);
    }
    aimLayer() {
        let layer = document.getElementById('aimshot-layer');
        if (!layer) {
            layer = document.createElement('div'); layer.id = 'aimshot-layer';
            const hud = document.getElementById('hud');
            (hud?.parentNode || this.root.parentNode || document.body).insertBefore(layer, hud || this.root);
        }
        return layer;
    }
    placeAim(screenAim) {
        const a = this.aiming; if (!a) return;
        a.last = screenAim;
        if (!a.el || !screenAim) return;
        // Static in the bottom-left corner past the squad rail; it only leans and bends to follow the crosshair.
        const now = performance.now(), dt = a.t ? Math.min(0.05, (now - a.t) / 1000) : 0; a.t = now;
        const view = viewport(), rail = Math.max(0, ...[...document.querySelectorAll('#hud .squad-head')].map(e => e.getBoundingClientRect().right));
        const layout = aimBackshotLayout(a.art.cutin, view, rail, a.shoulder);
        followStep(a.follow ||= {}, screenAim, dt);
        const pose = aimBackshotPose(a.art.cutin, layout, a.follow.pos, a.follow.vel, { x: view.width / 2, y: view.height / 2 });
        Object.assign(a.el.querySelector('.figure').style, { left: `${layout.left}px`, top: `${layout.top}px`, width: `${layout.width}px`, height: `${layout.height}px`,
            transformOrigin: '50% 100%', transform: `rotate(${pose.lean.toFixed(2)}deg) skewX(${pose.bend.toFixed(2)}deg)` });
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
        const shoulder = o.shoulder === 'left' ? 'left' : 'right';
        if (o.shooterPos && o.targetPos) this.cameraDirector.begin(o.shooterPos, o.targetPos, 'action', { side: shoulder });
        // Every camera switch uses the back shot (no first-only / off modes any more).
        const key = o.units.map(u => u.id).join(',');
        this.shownThisTurn.add(key);
        // The look point of the action camera is the aim point (targetPos + 1.1 up); the barrel goes there.
        const aimWorld = o.targetPos ? o.targetPos.clone().add(new THREE.Vector3(0, 1.1, 0)) : null;
        const timeline = (PRESETS[o.kind] || PRESETS.shot)(o.side === 'enemy' ? 0.95 : undefined);
        const sides = (await Promise.all(o.units.map(u => loadCharacterArt(u.art)))).map(a => ({ art: a, ...sideCutin(a.cutin, shoulder) }));
        const arts = sides.map(x => ({ ...x.art, cutin: x.cutin }));
        const el = document.createElement('div');
        el.className = `cutin cutin-${o.kind} side-${o.side} shoulder-${shoulder}`;
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
            if (sides[i].mirror) fig.style.transform = 'scaleX(-1)';
            for (const layer of art.cutin.layers) {
                const img = document.createElement('img');
                img.src = art.base + layer.image; img.draggable = false;
                // A mirrored figure flips the whole box, so the zoom origin is the barrel tip in the unflipped art.
                if (aligned) img.style.transformOrigin = backshotPlacement(sides[i].mirror ? sides[i].art.cutin : art.cutin, { x: 0, y: 0 }, viewport()).origin;
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
                    // Left shoulder: slides in from the right.
                    // (A mirrored figure flips the slide with it.)
                    const x = (1 - (s.slide ?? 1)) * (shoulder === 'left' && !sides[l.i].mirror ? 110 : -110) * l.parallax;
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
