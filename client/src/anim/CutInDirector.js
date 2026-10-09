// The Chaos Zero Nightmare-style "back shot": when a unit commits an action, the view cuts to an
// over-the-shoulder camera and the character's large 2D back-view illustration slides in from the
// lower left (layered, with parallax), the action name and hit chance show, then it cuts back.
// Presentation only — the battle has already resolved; this never blocks the server.
//
// Layers come from client/public/assets/characters/<art>/cutin.json (placeholders today).
import { PRESETS } from './CutInTimeline.js';
import { loadCharacterArt } from '../units/UnitView.js';

export const CUTIN_MODES = ['always', 'first', 'off'];

export class CutInDirector {
    constructor(root, cameraDirector) {
        this.root = root; this.cameraDirector = cameraDirector;
        this.mode = 'always';
        this.current = null;
        this.shownThisTurn = new Set();
        this.root.addEventListener('click', () => this.skip());
    }
    newTurn() { this.shownThisTurn.clear(); }
    skip() { if (this.current) this.current.t = this.current.timeline.duration; }
    /**
     * @param {{ units: {art, name}[], kind, title, subtitle, shooterPos, targetPos, side }} o
     * Returns a promise that resolves when the cut-in finishes (or immediately when disabled).
     */
    async play(o) {
        if (o.shooterPos && o.targetPos) this.cameraDirector.begin(o.shooterPos, o.targetPos);
        if (this.mode === 'off') return;
        const key = o.units.map(u => u.id).join(',');
        if (this.mode === 'first' && this.shownThisTurn.has(key)) return;
        this.shownThisTurn.add(key);
        const timeline = (PRESETS[o.kind] || PRESETS.shot)(o.side === 'enemy' ? 0.95 : undefined);
        const arts = await Promise.all(o.units.map(u => loadCharacterArt(u.art)));
        const el = document.createElement('div');
        el.className = `cutin cutin-${o.kind} side-${o.side}`;
        el.innerHTML = `<div class="bar top"></div><div class="bar bottom"></div><div class="flash"></div>
            <div class="figures"></div><div class="caption"><div class="title"></div><div class="sub"></div></div>`;
        el.querySelector('.title').textContent = o.title || '';
        el.querySelector('.sub').textContent = o.subtitle || '';
        const figures = el.querySelector('.figures');
        const layerEls = [];
        arts.forEach((art, i) => {
            const fig = document.createElement('div');
            fig.className = 'figure';
            fig.style.setProperty('--i', i);
            fig.style.height = `${Math.round((art.cutin.screenHeight || 0.6) * 100 * (o.units.length > 1 ? 0.8 : 1))}vh`;
            fig.style.aspectRatio = `${art.cutin.width} / ${art.cutin.height}`;
            for (const layer of art.cutin.layers) {
                const img = document.createElement('img');
                img.src = art.base + layer.image; img.draggable = false;
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
