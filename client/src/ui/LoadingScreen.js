// Upgraded tactical deployment loading screen: native <progress>, 4-step live checklist,
// mission badges, briefing snippet, and live top-down preview map canvas when operation data is ready.
import { drawOperationPreview } from './OperationPreview.js';

const TIPS = [
    'Explosions and gunfire carry. Enemies who hear them come looking for the source.',
    'Elevated crests and upper floors boost sightlines and force enemies uphill into crossfire.',
    'Canal Bridges stay passable for full fireteams; stone stairs descend to wadeable canal flanking lanes.',
    'Enemy techs send search drones ahead of their pods. A drone falls to a single hit.',
    'Aim with the reticle: bullet spread and recoil decide projectile paths toward each body part.',
    'Blue moves keep an action for a shot or grenade; yellow moves spend all AP on repositioning.',
    'Ground-floor windows and half-destroyed walls can be vaulted to bypass guarded doorways.',
    'Two-stage recovery missions let you extract at the designated lower field after grabbing the intel.'
];

const STAGES = {
    generate: ['Generating terrain & district layout', 0.18],
    art: ['Loading character sprites & effects', 0.48],
    world: ['Compiling voxel structures & elevation', 0.74],
    squad: ['Deploying squad & tactical HUD', 0.92],
    done: ['Battlefield ready', 1]
};
const STEP_ORDER = ['generate', 'art', 'world', 'squad'];
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const nextPaint = () => new Promise(r => requestAnimationFrame(() => r()));

export class LoadingScreen {
    constructor(root = document.getElementById('loading')) {
        this.root = root || document.body.appendChild(Object.assign(document.createElement('div'), { id: 'loading' }));
        this.root.classList.add('loading-screen');
        if (!this.root.querySelector('.ld-progress')) {
            this.root.innerHTML = `<div class="ld-card">
                <div class="ld-head"><div><p class="ld-eyebrow">FIRETEAM · TACTICAL DEPLOYMENT</p><h2 class="ld-title">Preparing Operation</h2></div><div class="ld-badges"></div></div>
                <div class="ld-body">
                    <div class="ld-meta">
                        <progress class="ld-progress" value="0.05" max="1"></progress>
                        <p class="ld-stage" role="status"></p>
                        <ol class="ld-steps">
                            <li data-step="generate">Generating terrain &amp; district WFC</li>
                            <li data-step="art">Loading unit sprites &amp; VFX</li>
                            <li data-step="world">Compiling voxel geometry &amp; elevation</li>
                            <li data-step="squad">Deploying squad &amp; tactical HUD</li>
                        </ol>
                        <p class="ld-brief"></p>
                    </div>
                    <div class="ld-preview-wrap" hidden><canvas class="ld-preview" width="240" height="200" aria-label="Operation tactical map preview"></canvas></div>
                </div>
                <p class="ld-tip"></p>
            </div>`;
        }
        this.shown = !this.root.classList.contains('hidden');
        if (this.shown) this.root.querySelector('.ld-tip').textContent = TIPS[Math.floor(Math.random() * TIPS.length)];
    }

    /** Show (or advance) the loading overlay with optional badges, briefing, and live minimap preview. */
    async show(stage = 'generate', { title = null, badges = null, briefing = null, previewData = null } = {}) {
        if (this.shown && stage === this.lastStage && title === null && !previewData && !badges && !briefing) return;
        this.lastStage = stage;
        const [text, frac] = STAGES[stage] || [stage, null];
        if (!this.shown) {
            this.root.querySelector('.ld-tip').textContent = TIPS[Math.floor(Math.random() * TIPS.length)];
            const wrap = this.root.querySelector('.ld-preview-wrap');
            if (wrap) wrap.hidden = true;
            this.root.classList.remove('hidden', 'out');
            this.shown = true;
        }
        if (title !== null) this.root.querySelector('.ld-title').textContent = title || 'Preparing Operation';
        if (badges !== null) {
            const box = this.root.querySelector('.ld-badges');
            if (box) box.innerHTML = (Array.isArray(badges) ? badges : []).filter(Boolean).map(b => `<span class="ld-badge">${esc(b)}</span>`).join('');
        }
        if (briefing !== null) {
            const el = this.root.querySelector('.ld-brief');
            if (el) el.textContent = briefing || '';
        }
        if (previewData?.layout) {
            const wrap = this.root.querySelector('.ld-preview-wrap');
            const canvas = this.root.querySelector('.ld-preview');
            if (wrap && canvas) {
                wrap.hidden = false;
                try { drawOperationPreview(canvas, previewData); } catch {}
            }
        }
        const stageEl = this.root.querySelector('.ld-stage');
        if (stageEl) stageEl.textContent = `${text}…`;
        const prog = this.root.querySelector('.ld-progress');
        if (prog && frac !== null) prog.value = frac;

        const idx = stage === 'done' ? STEP_ORDER.length : STEP_ORDER.indexOf(stage);
        this.root.querySelectorAll('.ld-steps li').forEach(li => {
            const si = STEP_ORDER.indexOf(li.dataset.step);
            li.classList.toggle('done', idx >= 0 && si < idx);
            li.classList.toggle('active', si === idx);
        });
        await nextPaint();
    }

    hide() {
        this.lastStage = null;
        if (!this.shown) { this.root.classList.add('hidden'); return; }
        const prog = this.root.querySelector('.ld-progress');
        if (prog) prog.value = 1;
        this.root.querySelectorAll('.ld-steps li').forEach(li => {
            li.classList.add('done');
            li.classList.remove('active');
        });
        this.root.classList.add('out');
        this.shown = false;
        setTimeout(() => { if (!this.shown) this.root.classList.add('hidden'); }, 350);
    }
}

export const loading = typeof document !== 'undefined' ? new LoadingScreen() : null;
