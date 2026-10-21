// PLAN-14: the loading screen between the menu and the battle. Map generation runs on the main thread, so every stage
// is painted (two animation frames) before the heavy work starts; the bar moves in steps, the tip rotates per load.
const TIPS = [
    'Explosions and gunfire carry. Enemies who hear them come looking for the source.',
    'Enemy techs send search drones ahead of their pods. A drone falls to a single hit.',
    'Scan reveals roughly where the enemy is: a circle around each contact, not the exact tile.',
    'Aim with the reticle: the body part under the crosshair is the part you shoot.',
    'Light rigs and recon packs make a soldier faster; heavy armour and raid packs slow them down.',
    'Blue moves keep an action for a shot; yellow moves spend everything on distance.',
    'Ground-floor windows and half-destroyed walls can be vaulted.',
    'The tunnel flank is quieter than the street. Use it to come up beside the objective.'
];
const STAGES = { generate: ['Generating the operation', 0.15], art: ['Loading textures and models', 0.45], world: ['Building the battlefield', 0.7], squad: ['Deploying the squad', 0.9], done: ['Ready', 1] };
const nextPaint = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => r())));

export class LoadingScreen {
    constructor(root = document.getElementById('loading')) {
        this.root = root || document.body.appendChild(Object.assign(document.createElement('div'), { id: 'loading' }));
        this.root.classList.add('loading-screen');
        if (!this.root.querySelector('.ld-bar')) this.root.innerHTML = `<div class="ld-card"><h1>FIRETEAM</h1><p class="ld-title"></p>
            <div class="ld-bar"><i></i></div><p class="ld-stage" role="status"></p><p class="ld-tip"></p></div>`;
        this.shown = !this.root.classList.contains('hidden');
        if (this.shown) this.root.querySelector('.ld-tip').textContent = TIPS[Math.floor(Math.random() * TIPS.length)];
    }
    /** Show (or advance) the screen. `stage` is a STAGES key or free text; resolves once painted. */
    async show(stage = 'generate', { title = null } = {}) {
        const [text, frac] = STAGES[stage] || [stage, null];
        if (!this.shown) { this.root.querySelector('.ld-tip').textContent = TIPS[Math.floor(Math.random() * TIPS.length)]; this.root.classList.remove('hidden', 'out'); this.shown = true; }
        if (title !== null) this.root.querySelector('.ld-title').textContent = title;
        this.root.querySelector('.ld-stage').textContent = `${text}…`;
        if (frac !== null) this.root.querySelector('.ld-bar i').style.width = `${Math.round(frac * 100)}%`;
        await nextPaint();
    }
    hide() {
        if (!this.shown) { this.root.classList.add('hidden'); return; }
        this.root.querySelector('.ld-bar i').style.width = '100%';
        this.root.classList.add('out'); this.shown = false;
        setTimeout(() => { if (!this.shown) this.root.classList.add('hidden'); }, 350);
    }
}
export const loading = typeof document !== 'undefined' ? new LoadingScreen() : null;
