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
import { WorldAimSprite, worldAimSide } from './WorldAimSprite.js';
import { PRESETS } from './CutInTimeline.js';
import { loadCharacterCutin } from '../units/UnitView.js';
import { projectedSpreadRadius } from '../ui/AimReticle.js';

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
    if(cutin.staticPose){
        const availableHeight=view.height*(1-bars);
        const height=Math.min((cutin.screenHeight||1)*Math.min(view.height,view.width/aspect)*scale,availableHeight);
        return {left:0,top:availableHeight-height,width:height*aspect,height,origin:'0% 100%'};
    }
    if (cutin.crosshair) {
        // Over-the-shoulder perspective art: the bore converges on `crosshair` (art fractions), placed on the aim point.
        const [cx, cy] = cutin.crosshair, x = cutin.mirror ? 1 - cx : cx;
        const height = (cutin.screenHeight || 1) * view.height * scale, width = height * aspect;
        return { left: aim.x - x * width, top: aim.y - cy * height, width, height, origin: `${(x * 100).toFixed(1)}% ${(cy * 100).toFixed(1)}%` };
    }
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
    /** 3D-only animations: 2D cut-in sprite overlays are disabled. */
    async beginAim() { this.endAim(); }
    tracerOrigin(fallback) { return fallback; }
    placeAim() {}
    endAim() {
        this.aiming?.world?.dispose?.();this.aiming?.weapon?.dispose?.();this.aiming?.figure?.remove?.();this.aiming=null;
        if(!this.current)this.cameraDirector.hidden=new Set();
    }
    skip() { if (this.current) this.current.t = this.current.timeline.duration; }
    /** 3D-only animations: never mount 2D sprite cut-in overlays. */
    async play() {}
}
