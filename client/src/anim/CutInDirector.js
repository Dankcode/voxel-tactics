// The Chaos Zero Nightmare-style "back shot": when a unit commits an action, the view cuts to an
// over-the-shoulder camera and the character's large 2D back-view illustration slides in from the
// lower left (layered, with parallax), the action name and hit chance show, then it cuts back.
// Presentation only — the battle has already resolved; this never blocks the server.
//
// Layers come from client/public/assets/characters/ranger-01/cutin.json.
//
// The back shot is used on every switch to the shoulder camera: while aiming (a persistent, unobtrusive back shot
// that follows the crosshair) and when an action is committed (the full cut-in). The art is placed so its barrel tip
// (cutin.json `muzzle`, fractions of the art) sits on the crosshair; the figure fills the lower left of the screen
// and the rest stays clear.
import * as THREE from 'three';
import { SpriteWeapon, sortedSpriteLayers, spriteLayerOrder } from './SpriteWeapon.js';
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
    // A torso painting cropped at the canvas edge must meet the screen edge, not float as a rectangle.
    if (cutin.cropEdges?.includes('left')) return { left: cutin.mirror ? view.width - width : 0,
        top: floorY - height, width, height, origin: `${u * 100}% ${v * 100}%` };
    return { left: aim.x - u * width, top: aim.y - v * height, width, height, origin: `${(u * 100).toFixed(1)}% ${(v * 100).toFixed(1)}%` };
}
/** The firing pose for the chosen shoulder. New ranger art mirrors the complete rig for left targets. */
export function sideCutin(cutin, shoulder = 'right') {
    const v = shoulder === 'left' ? cutin.variants?.left : null;
    return v ? { ...cutin, ...v, variants: undefined } : cutin;
}
/** Project a three.js world point to CSS pixels of the viewport. */
export function projectToScreen(camera, point, view) {
    const p = point.clone().project(camera);
    return { x: (p.x + 1) * view.width / 2, y: (1 - p.y) * view.height / 2, behind: p.z > 1 };
}
/** Aiming layout: cropped torso art meets the viewport edge; uncropped legacy art clears the squad rail. */
export const AIM_SHOT = Object.freeze({ heightShare: 0.46, maxWidthShare: 0.42, gap: 12, followTau: 0.32, leanPerDeg: 0.3, maxLean: 5, maxBend: 3.5, bendPerPx: 0.005,
    // Gun swing on the static figure: rad per screen width / height of crosshair offset, and per px/s of its motion.
    yawPerScreen: 0.16, pitchPerScreen: 0.1, yawPerVel: 0.00002, pitchPerVel: 0.000015 });
export function aimBackshotLayout(cutin, view, railRight = 0) {
    const aspect = (cutin.width || 512) / (cutin.height || 768);
    let height = view.height * AIM_SHOT.heightShare, width = height * aspect;
    const maxWidthShare = cutin.maxWidthShare || AIM_SHOT.maxWidthShare;
    if (width > view.width * maxWidthShare) { width = view.width * maxWidthShare; height = width / aspect; }
    const left = cutin.cropEdges?.includes('left') ? (cutin.mirror ? view.width - width : 0) : Math.max(0, railRight + AIM_SHOT.gap);
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
    return { lean: clamp(d * AIM_SHOT.leanPerDeg, AIM_SHOT.maxLean), bend: clamp(vel.x * AIM_SHOT.bendPerPx, AIM_SHOT.maxBend) };
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
function paintFigure(fig, art) {
    const content = document.createElement('div'); content.className = 'sprite-content';
    if (art.cutin.mirror) content.classList.add('sprite-mirrored');
    for (const layer of sortedSpriteLayers(art.cutin.layers)) {
        if (!layer.image || layer.blend) continue;
        const img = document.createElement('img'); img.src = art.base + layer.image; img.draggable = false;
        img.style.zIndex = String(spriteLayerOrder(layer));
        if (layer.bone) img.dataset.bone = layer.bone;
        content.appendChild(img);
    }
    fig.appendChild(content); return content;
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
     * moves its independent arms with the aiming spring while leaving the torso fixed.
     */
    async beginAim(unit, { shoulder = 'right', weaponId = unit.weapon } = {}) {
        const cur = this.aiming;
        if (cur?.unitId === unit.id) {
            if (cur.shoulder === shoulder && cur.weaponId === weaponId) { this.cameraDirector.hidden = new Set([unit.id]); return; }
            // Same sprite on both sides unless the art has a left-side aiming sprite: nothing to rebuild.
            if (!cur.art || !cur.hasLeft) { cur.shoulder = shoulder; this.cameraDirector.hidden = new Set([unit.id]); return; }
        }
        const last = this.aiming?.unitId === unit.id ? this.aiming.last : null;
        this.endAim();
        const token = this.aiming = { unitId: unit.id, weaponId, shoulder, el: null, art: null, last };
        // The shooter's own world sprite never shows in the shoulder view, not even while the back shot loads.
        this.cameraDirector.hidden = new Set([unit.id]);
        const loaded = await loadCharacterArt(unit.art);
        if (this.aiming !== token) return;
        token.hasLeft = !!loaded.cutin.variants?.left;
        // One sprite for aiming and firing: the shooting pose (mirrored for the left shoulder).
        const art = { ...loaded, cutin: sideCutin(loaded.cutin, token.shoulder) };
        const el = document.createElement('div');
        el.className = 'cutin cutin-aim'; el.style.pointerEvents = 'none';
        el.innerHTML = '<div class="figures aligned"><div class="figure" data-aligned="1"></div></div>';
        const fig = el.querySelector('.figure');
        fig.style.aspectRatio = `${art.cutin.width} / ${art.cutin.height}`;
        const content = paintFigure(fig, art);
        token.weapon = new SpriteWeapon(content, art.cutin, unit, weaponId, this.cameraDirector.scene, art.base);
        // Under the HUD (buttons and portraits stay on top), above the 3D view.
        this.aimLayer().appendChild(el);
        token.el = el; token.art = art;
        if (token.last) this.placeAim(token.last, token.motion);
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
    placeAim(screenAim, motion = { yaw: 0, pitch: 0 }) {
        const a = this.aiming; if (!a) return;
        a.last = screenAim; a.motion = motion;
        if (!a.el || !screenAim) return;
        // Keep the authored torso crop against its viewport edge.
        const now = performance.now(), dt = a.t ? Math.min(0.05, (now - a.t) / 1000) : 0; a.t = now;
        const view = viewport(), rail = Math.max(0, ...[...document.querySelectorAll('#hud .squad-head')].map(e => e.getBoundingClientRect().right));
        const layout = aimBackshotLayout(a.art.cutin, view, rail);

        const mirror = a.art.cutin.mirror ? -1 : 1;
        // The two independent arm chains follow the grip sockets, driven by actual aim lag.
        // Bending the whole card would also bend the torso and disconnect the shoulder illusion.
        const articulated = !!a.art.cutin.rig?.arms;
        a.weapon?.update({ yaw: mirror * motion.yaw, pitch: motion.pitch });
        let transform = 'none';
        if (!articulated) {
            followStep(a.follow ||= {}, screenAim, dt);
            const pose = aimBackshotPose(a.art.cutin, layout, a.follow.pos, a.follow.vel, { x: view.width / 2, y: view.height / 2 });
            transform = `rotate(${pose.lean.toFixed(2)}deg) skewX(${pose.bend.toFixed(2)}deg)`;
        }
        Object.assign(a.el.querySelector('.figure').style, { left: `${layout.left}px`, top: `${layout.top}px`, width: `${layout.width}px`, height: `${layout.height}px`,
            transformOrigin: '50% 100%', transform });
    }
    endAim() {
        if (!this.aiming) return;
        this.aiming.weapon?.dispose();
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
        // Same shoulder camera whatever side the shot leaves from; the side only picks a left-side sprite if one exists.
        if (o.shooterPos && o.targetPos) this.cameraDirector.begin(o.shooterPos, o.targetPos);
        // Every camera switch uses the back shot (no first-only / off modes any more).
        const key = o.units.map(u => u.id).join(',');
        this.shownThisTurn.add(key);
        // The look point of the action camera is the aim point (targetPos + 1.1 up); the barrel goes there.
        const aimWorld = o.targetPos ? o.targetPos.clone().add(new THREE.Vector3(0, 1.1, 0)) : null;
        const timeline = (PRESETS[o.kind] || PRESETS.shot)(o.side === 'enemy' ? 0.95 : undefined);
        const arts = (await Promise.all(o.units.map(u => loadCharacterArt(u.art)))).map(a => ({ ...a, cutin: sideCutin(a.cutin, shoulder) }));
        const el = document.createElement('div');
        el.className = `cutin cutin-${o.kind} side-${o.side}`;
        el.innerHTML = `<div class="bar top"></div><div class="bar bottom"></div><div class="flash"></div>
            <div class="figures"></div><i class="cutin-crosshair"></i><div class="caption"><div class="title"></div><div class="sub"></div></div>`;
        el.querySelector('.title').textContent = o.title || '';
        el.querySelector('.sub').textContent = o.subtitle || '';
        const figures = el.querySelector('.figures');
        const layerEls = [], weapons = [];
        const aligned = arts.length === 1 && !!aimWorld && this.cameraDirector.active;
        if (aligned) figures.classList.add('aligned');
        arts.forEach((art, i) => {
            const fig = document.createElement('div');
            fig.className = 'figure';
            if (aligned) fig.dataset.aligned = '1';
            fig.style.setProperty('--i', i);
            fig.style.height = `${Math.round((art.cutin.screenHeight || 0.6) * 100 * (o.units.length > 1 ? 0.8 : 1))}vh`;
            fig.style.aspectRatio = `${art.cutin.width} / ${art.cutin.height}`;
            const content = paintFigure(fig, art);
            const weapon = new SpriteWeapon(content, art.cutin, o.units[i], o.weaponId || o.units[i].weapon, this.cameraDirector.scene, art.base);
            weapons.push(weapon);
            // Animate the complete rig together so gloves never drift off the gun.
            const presentation = document.createElement('div'); presentation.className = 'sprite-presentation';
            fig.appendChild(presentation); presentation.appendChild(content);
            layerEls.push({ img: presentation, parallax: 1, i });
            figures.appendChild(fig);
        });
        this.root.appendChild(el);
        this.cameraDirector.hidden = new Set(o.units.map(u => u.id));
        document.body.classList.add('cutin-active');
        const cur = { timeline, t: 0, el };
        const place = () => {
            if (!aligned) return;
            const view = viewport(), aim = projectToScreen(this.cameraDirector.cam, aimWorld, view);
            const cutin = arts[0].cutin, liveMuzzle = weapons[0]?.targets?.muzzle;
            const muzzle = liveMuzzle ? [cutin.mirror ? 1 - liveMuzzle[0] : liveMuzzle[0], liveMuzzle[1]] : cutin.muzzle;
            const pl = backshotPlacement({ ...cutin, muzzle }, aim, view), fig = figures.firstChild;
            layerEls[0].img.style.transformOrigin = `${muzzle[0]*100}% ${muzzle[1]*100}%`;
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
                for (const weapon of weapons) weapon.update({ recoil: (s.flash || 0) * .012 });
                place();
                if (cur.t >= timeline.duration) { resolve(); return; }
                requestAnimationFrame(step);
            };
            requestAnimationFrame(step);
        });
        // Keep the action camera through tracer/skill playback; EventPlayer returns to tactics when the queue drains.
        this.cameraDirector.hidden = new Set();
        document.body.classList.remove('cutin-active');
        weapons.forEach(w => w.dispose());
        el.remove();
        if (this.current === cur) this.current = null;
    }
}
