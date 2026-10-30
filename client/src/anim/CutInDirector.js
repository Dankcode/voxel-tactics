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
import { loadCharacterArt } from '../units/UnitView.js';
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
        const height=(cutin.screenHeight||1)*Math.min(view.height,view.width/aspect)*scale;
        return {left:0,top:view.height*(1-bars)-height,width:height*aspect,height,origin:'0% 100%'};
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
    /** A complete aiming character at the unit's world position; no screen-edge overlay. */
    async beginAim(unit, { shoulder = 'right', weaponId = unit.weapon } = {}) {
        const cur=this.aiming;
        if(cur?.unitId===unit.id&&cur.weaponId===weaponId){cur.shoulder=shoulder;return;}
        this.endAim();
        const view=this.unitView?.(unit.id);
        if(!view||view.model)return;
        const token=this.aiming={unitId:unit.id,weaponId,shoulder,view};
        const loaded=await loadCharacterArt(unit.art);
        if(this.aiming!==token)return;
        if(loaded.cutin.staticPose){
            token.art=loaded.cutin;
            token.figure=document.createElement('div');token.figure.className='static-aimshot';
            Object.assign(token.figure.style,{position:'fixed',pointerEvents:'none',zIndex:'3'});
            const content=paintFigure(token.figure,loaded);
            (document.getElementById('aimshot-layer')||this.root).appendChild(token.figure);
            token.weapon=new SpriteWeapon(content,loaded.cutin,unit,weaponId,this.cameraDirector.scene,loaded.base);
            this.placeAim();return;
        }
        if(!loaded.cutin.worldAim)return;
        token.world=new WorldAimSprite(view,loaded.cutin.worldAim,weaponId,loaded.base);
    }
    placeAim(target) {
        const a=this.aiming;
        if(a?.figure){
            const view=viewport(),p=backshotPlacement(a.art,null,view,{bars:0});
            Object.assign(a.figure.style,{left:p.left+'px',top:p.top+'px',width:p.width+'px',height:p.height+'px'});
            const aim=target?projectToScreen(this.cameraDirector.scene.camera,target,view):{x:view.width/2,y:view.height/2};
            a.weapon.update({aimUV:[(aim.x-p.left)/p.width,(aim.y-p.top)/p.height],aimDistance:target?this.cameraDirector.cam.position.distanceTo(target):20});
            this.cameraDirector.hidden=new Set([a.unitId]);return;
        }
        if(!a?.world?.ready)return;
        const camera=this.cameraDirector.scene.camera;
        a.worldSide=worldAimSide(camera,a.view.pos,target,a.worldSide||a.shoulder);
        a.world.update(camera,a.worldSide);
        this.cameraDirector.hidden=new Set([a.unitId]);
    }
    endAim() {
        this.aiming?.world?.dispose();this.aiming?.weapon?.dispose();this.aiming?.figure?.remove();this.aiming=null;
        if(!this.current)this.cameraDirector.hidden=new Set();
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
        const shooterHud = !!o.weaponId && ['shot','burst','heavy'].includes(o.kind);
        const el = document.createElement('div');
        el.className = `cutin cutin-${o.kind} side-${o.side}${shooterHud?' shooter-shot':''}`;
        el.innerHTML = `<div class="bar top"></div><div class="bar bottom"></div><div class="flash"></div>
            <div class="figures"></div><i class="cutin-crosshair"><span class="read"></span></i><div class="caption"><div class="title"></div><div class="sub"></div></div>`;
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
            const weapon = art.cutin.bakedWeapon ? null : new SpriteWeapon(content, art.cutin, o.units[i], o.weaponId || o.units[i].weapon, this.cameraDirector.scene, art.base);
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
            const pl = backshotPlacement({ ...cutin, muzzle }, aim, view, {bars:shooterHud?0:BAR_SHARE}), fig = figures.firstChild;
            if(cutin.staticPose)weapons[0]?.update({aimUV:[(aim.x-pl.left)/pl.width,(aim.y-pl.top)/pl.height],aimDistance:this.cameraDirector.cam.position.distanceTo(aimWorld)});
            const pivot = cutin.crosshair ? [cutin.mirror ? 1 - cutin.crosshair[0] : cutin.crosshair[0], cutin.crosshair[1]] : muzzle;
            layerEls[0].img.style.transformOrigin = `${pivot[0]*100}% ${pivot[1]*100}%`;
            Object.assign(fig.style, { left: `${pl.left}px`, top: `${pl.top}px`, width: `${pl.width}px`, height: `${pl.height}px` });
            const ch = el.querySelector('.cutin-crosshair'); ch.style.left = `${aim.x}px`; ch.style.top = `${aim.y}px`; ch.style.display = aim.behind ? 'none' : 'block';
            if(shooterHud){
                const distance=o.aimDistance??o.shooterPos.clone().add(new THREE.Vector3(0,1.55,0)).distanceTo(aimWorld);
                ch.style.setProperty('--aim-radius',`${projectedSpreadRadius(this.cameraDirector.cam,view.height,o.spread??1,distance)}px`);
                ch.querySelector('.read').textContent=`${distance.toFixed(1)} m`;
            }
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
                    l.img.style.transform = shooterHud?'none':`translateX(${x}%) scale(${scale})`;
                }
                if (this.cameraDirector.active) this.cameraDirector.apply(shooterHud?0:(s.dolly ?? 0));
                for (const weapon of weapons) weapon?.update({ recoil: (s.flash || 0) * .012 });
                place();
                if (cur.t >= timeline.duration) { resolve(); return; }
                requestAnimationFrame(step);
            };
            requestAnimationFrame(step);
        });
        // Keep the action camera through tracer/skill playback; EventPlayer returns to tactics when the queue drains.
        this.cameraDirector.hidden = new Set();
        document.body.classList.remove('cutin-active');
        weapons.forEach(w => w?.dispose());
        el.remove();
        if (this.current === cur) this.current = null;
    }
}
