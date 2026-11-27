import { portraitSrc } from './Portraits.js';
import { EquipmentPanel } from './EquipmentPanel.js';
import { reserveAmmo } from '../../../shared/inventory/Equipment.js';
import { fireMode, fireModes } from '../../../shared/battle/FireControl.js';
import { navigationFloors } from '../render/FloorCutaway.js';
import { reportMarkup } from './BattleReportView.js';
import { reportText } from '../../../shared/session/BattleReport.js';
import { downloadJson } from './TestGroundStore.js';
import { packMarkup } from './InventoryPrep.js';
import { MAT } from '../../../shared/voxel/Materials.js';
import { watchWeapon, visionProfile } from '../../../shared/battle/WatchSector.js';
// Squad status, equipment workspace, skill dock and precision targeting.
import { WEAPONS, THROWABLES } from '../../../shared/content/weapons.js';
import { CALIBERS } from '../../../shared/content/calibers.js';
import { ABILITIES, BODY, PARTS, CLASSES, ENEMIES, displayName } from '../../../shared/content/units.js';
import { FORMATIONS } from '../../../shared/content/formations.js';
import { alive, partArmor } from '../../../shared/battle/Units.js';
import { coverAgainst, COVER } from '../../../shared/voxel/Cover.js';
import { inZone, extractionOpen, objectiveStatus } from '../../../shared/battle/Objectives.js';
import { ICONS, weaponIcon } from './Icons.js';
import { TERRAIN_CUES } from '../render/MaterialLibrary.js';
import { QUALITY, setQuality } from '../render/Quality.js';

const pct = v => `${Math.round(v * 100)}%`;
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function setHtml(el, html, { preserveScroll = false } = {}) {
    if (!el || el._html === html) return false;
    const top = preserveScroll ? el.scrollTop : 0;
    el._html = html;
    el.innerHTML = html;
    if (preserveScroll && top) el.scrollTop = top;
    return true;
}

export class Hud {
    constructor(root, game) {
        this.root = root; this.game = game;
        root.innerHTML = `
            <div class="topbar">
                <div class="map-marks" aria-label="Map markers">${['red','blue','green'].map(c=>`<button data-act="mark" data-arg="${c}" aria-label="Mark ${c} block" title="Mark ${c} block · click again on the same block to clear" style="--mark:${c==='red'?'#ff4949':c==='blue'?'#4c9cff':'#56ef93'}">!</button>`).join('')}</div>
                <div class="turnbox"><div class="round"></div><div class="phase"></div><div class="objstat hidden"></div><div class="ai-posture hidden"></div><button data-act="endTurn" class="endturn" title="End turn (Enter)">END TURN</button></div>
                <div class="tools"><button class="tool-btn" data-act="inventory" title="Open soldier inventory & body status (I)" aria-label="Inventory">${ICONS.backpack}<span>Inventory</span><kbd>I</kbd></button><button class="tool-btn speed-toggle" data-act="cycleSpeed" title="Turn & animation speed (Space during enemy turn)">1×</button><button class="tool-btn" data-act="options" title="Settings & controls" aria-label="Settings">${ICONS.gear}<span>Settings</span></button><button class="tool-btn" data-act="menu" title="Return to main menu" aria-label="Main Menu"><span>Menu</span></button></div>
            </div>
            <div class="camera-nav" aria-label="Camera controls">
                <button data-act="lvlUp" class="nav-up" title="Upper floor · Z / Page Up" aria-label="Upper floor">${ICONS.up}</button>
                <button data-act="rotL" class="nav-left" title="Rotate left · Q" aria-label="Rotate left">${ICONS.rotL}</button>
                <span class="nav-cube" aria-hidden="true">${ICONS.cube}</span>
                <button data-act="rotR" class="nav-right" title="Rotate right · E" aria-label="Rotate right">${ICONS.rotR}</button>
                <button data-act="lvlDown" class="nav-down" title="Lower floor · X / Page Down" aria-label="Lower floor">${ICONS.down}</button>
                <span class="floor-label">Roof</span>
            </div>
            <div class="squad"></div>
            <div class="unitcard hidden" aria-live="polite"></div>
            <div class="unit-callout"></div>
            <button class="autoend hidden" data-act="cancelAutoEnd" title="Cancel (Esc)"><b>ALL AP SPENT — ENDING TURN</b><i></i><small>click or Esc to stay</small></button>
            <div class="unitpanel hidden"></div><div class="equipment-overlay hidden"></div><div class="aim-reticle hidden" aria-label="Weapon accuracy reticle"><i class="reticle-ring outer"><em class="rt n"></em><em class="rt e"></em><em class="rt s"></em><em class="rt w"></em></i><i class="reticle-ring inner"></i><i class="reticle-core"></i><i class="recoil-climb"></i><span class="read"></span></div><div class="aim-cover-mark hidden" aria-hidden="true">✕</div>
            <div class="targets"></div>
            <div class="actionbar"><div class="slotname"></div><div class="bar-controls"><button class="mode-switch hidden" data-act="fireMode" aria-label="Change fire mode"></button></div><div class="slots"></div></div>
            <div class="target hidden"></div>
            <div class="panel hidden"></div>
            <div class="options hidden"></div>
            <div class="log"></div>
            <div class="banner"><div class="b1"></div><div class="b2"></div></div>
            <div class="toast"></div>
            <div class="cursortip hidden"></div>
            <div class="enemyturn hidden"><i></i><span>ENEMY ACTIVITY</span><button class="speed-pill" data-act="cycleSpeed" title="Fast-forward enemy turn (Space)">1×</button></div>
            <div class="outcome hidden"></div>
            `;
        this.el = sel => root.querySelector(sel);

        root.addEventListener('click', e => this.onClick(e));
        root.addEventListener('mouseover', e => {
            const b = e.target.closest('.slot');
            if (b && this._hoveredSlotIdx !== b.dataset.arg) {
                this._hoveredSlotIdx = b.dataset.arg;
                setHtml(this.el('.slotname'), b.dataset.tip || '');
            }
            const h = e.target.closest('.squad-head');
            if (h) game.views.get(h.dataset.arg)?.setHovered?.(true);
        });
        root.addEventListener('mouseout', e => {
            const b = e.target.closest('.slot');
            if (b && !b.contains(e.relatedTarget) && !e.relatedTarget?.closest?.('.slot')) {
                this._hoveredSlotIdx = null;
                setHtml(this.el('.slotname'), this.activeSlotName || '');
            }
            const h = e.target.closest('.squad-head');
            if (h) game.views.get(h.dataset.arg)?.setHovered?.(false);
        });
        this.lines = [];
        this.slots = [];
        this.openPanelKind = null;
        this._hoveredSlotIdx = null;
        this.equipment=new EquipmentPanel(this.el('.equipment-overlay'),game);
        // PLAN-15: one thing at a time — the soldier card steps aside while an action panel (gear, formation, breach) is open.
        const panel=this.el('.panel'),sync=()=>root.classList.toggle('panel-open',!panel.classList.contains('hidden'));
        if(globalThis.MutationObserver)new MutationObserver(sync).observe(panel,{attributes:true,attributeFilter:['class']});
        root.addEventListener('change',e=>{const k=e.target.dataset.setting;if(!k)return;const v=e.target.dataset.type==='string'?e.target.value:Number(e.target.value);game.options[k]=v;if(k==='turnSpeed')game.player.speed=v;if(k==='soundVolume')game.audio.setVolume(v);localStorage.setItem('tactics-settings',JSON.stringify(game.options));});
    }
    setHtml(el, html, opts) { return setHtml(el, html, opts); }
    updateFloorLabel() {
        const g = this.game, b = g?.battle;
        const el = this.el?.('.floor-label');
        if (!el || !b) return;
        const label = navigationFloors(b.mission).find(f => f.cut === g.cutLevel)?.label || 'Roof';
        if (el.textContent !== label) el.textContent = label;
    }
    updateSpeedButtons() {
        const g = this.game, spd = g.player?.speed || g.options?.turnSpeed || 1;
        for (const sb of this.root.querySelectorAll('[data-act="cycleSpeed"]')) {
            sb.textContent = `${spd}×`;
            sb.classList.toggle('fast', spd > 1);
        }
    }
    reset() { this.report = null; this.equipment.open=false;this.equipment.nested=null;this.equipment.selected=null;this.openPanelKind=null;this._hoveredSlotIdx=null;this.el('.outcome').classList.add('hidden'); this.hidePanel(); this.squadSpent(false); }
    onClick(e) {
        const b = e.target.closest('[data-act]');
        if (!b || b.disabled) return;
        const g = this.game, act = b.dataset.act, arg = b.dataset.arg;
        if(b.closest('.camera-nav'))b.blur();
        e.stopPropagation();
        switch (act) {
            case 'floorFollow': g.applyZoomCut();return;
            case 'chooseFloor': g.chooseFloor(arg==='roof'?Infinity:Number(arg));return;
            case 'inventory': this.equipment.toggle();return;
            case 'mark': g.setMode({kind:'mark',color:arg});return;
            case 'aimTarget': g.aimAtTarget?.(arg); return;
            case 'aimPart': g.aimAtPart?.(arg); return;
            case 'aimMode': g.setAimFireMode?.(arg); return;
            case 'fireMode': {const u=g.selectedUnit(),w=WEAPONS[u.weapon],modes=fireModes(w);g.intent({type:'setFireMode',mode:modes[(modes.indexOf(fireMode(u,w))+1)%modes.length]});return;}
            case 'equipmentTab': this.equipmentTab=arg;return;
            case 'view': g.cameraDirector.end();g.scene.rig.setPreset(arg); return;
            case 'pan': g.scene.rig.glide=null;g.scene.rig.moveBy(...arg.split(',').map(Number));return;
            case 'tilt': g.cameraDirector.end();g.scene.rig.orbit(0,Number(arg)*40);return;
            case 'home': g.focusUnit(g.selectedUnit());return;
            case 'weapon': this.chooseWeapon(arg);return;
            case 'reloadWeapon': g.intent({type:'reload',weaponId:arg});return;
            case 'item': this.hidePanel();g.setMode({kind:THROWABLES[arg].kind==='gadget'?'gadget':THROWABLES[arg].placed?'breach':'throw',itemId:arg});if(THROWABLES[arg].placed)this.showBreachPanel();return;
            case 'equip': g.intent({type:'switchWeapon',weaponId:arg}); return;
            case 'rotL': g.cameraDirector.end();g.scene.rotate(-1); return; case 'rotR': g.cameraDirector.end();g.scene.rotate(1); return;
            case 'lvlUp': g.changeLevel(1); return; case 'lvlDown': g.changeLevel(-1); return;
            case 'debug': g.debug.toggle(); return;
            case 'options': this.toggleOptions(); return;
            case 'cycleSpeed': g.cycleTurnSpeed?.(); this.updateSpeedButtons(); return;
            case 'opt': g.options[arg] = !g.options[arg];localStorage.setItem('tactics-settings',JSON.stringify(g.options)); this.renderOptions(); return;
            case 'lighting': g.scene.setLighting(arg); g.options.lighting = arg; this.renderOptions(); return;
            case 'ao': g.scene.setAO(!g.scene.ao); this.renderOptions(); return;
            case 'proj': g.scene.toggleProjection(); this.renderOptions(); return;
            case 'quality': if (arg !== QUALITY.name) setQuality(arg); return;
            case 'cue': TERRAIN_CUES[arg].value = TERRAIN_CUES[arg].value ? 0 : 1; this.renderOptions(); return;
            case 'menu': g.exitToMenu(); return;
            case 'select': g.select(arg); return;
            case 'nextReady': g.cycleUnit(1); return;
            case 'cancelAutoEnd': g.cancelAutoEnd(); return;
            case 'peekHome': g.setPeek(null); break;
            case 'slot': this.runSlot(+arg); return;
            case 'fire': g.confirmFire(); return;
            case 'captureAim': g.captureAim(); return;
            case 'cancel': g.cancel(); return;
            case 'formTpl': g.declareFormation(arg); this.hidePanel(); return;
            case 'formBreak': g.intent({ type: 'formation_break', formationId: arg }); this.hidePanel(); return;
            case 'doBreach': { const [i, entry] = arg.split(':'); g.doBreach(+i, entry); this.hidePanel(); return; }
            case 'buildingCycle': g.cycleBuildingView(); return;
            case 'buildingView': g.setBuildingView(arg); return;
            case 'endTurn': g.endTurn(); return;
            case 'closePanel': this.hidePanel(); return;
            case 'restart': g.restart(); return;
            case 'nextOp': g.deployNextOp(arg); return;
            case 'rtab': this.reportTab(arg); return;
            case 'reportCopy': this.copyReport(); return;
            case 'reportJson': if (this.report) downloadJson(`report-${this.report.scenario.id}-${this.report.scenario.seed}-${(this.report.run.at || '').replace(/[:.]/g, '-')}.json`, this.report); return;
            case 'reportEdit': g.exitToMenu({ tab: 'test', desc: g.session?.desc, client: { autopilot: g.autoPlayer } }); return;
        }
        this.refresh();
    }
    async chooseWeapon(id) {
        const g=this.game,u=g.selectedUnit();if(!u||!g.canAct())return;
        if(u.weapon!==id){const result=await g.intent({type:'switchWeapon',weaponId:id});if(!result.ok)return;}
        if(g.selected===u.id&&g.canAct())g.setMode({kind:WEAPONS[id].kind==='melee'?'melee':'shoot',weaponId:id});
    }
    hidePanel() { this.openPanelKind = null; this.el('.panel').classList.add('hidden'); }
    toggleOptions() {
        const el = this.el('.options');
        el.classList.toggle('hidden');
        this.renderOptions();
        this.root?.querySelector?.('[data-act="options"]')?.classList?.toggle?.('on', !el.classList.contains('hidden'));
    }
    renderOptions() {
        const g = this.game, o = g.options, el = this.el('.options');
        if (el.classList.contains('hidden')) return;
        const row = (k, label) => `<button data-act="opt" data-arg="${k}" class="${o[k] ? 'on' : ''}">${o[k] ? '☑' : '☐'} ${label}</button>`;
        const html = `<h3>Settings <button data-act="options">✕</button></h3><h4>Gameplay</h4><label>Turn / animation speed<select data-setting="turnSpeed">${[.5,1,1.5,2,3].map(n=>`<option value="${n}" ${Number(o.turnSpeed||1)===n?'selected':''}>${n}×</option>`).join('')}</select></label><label>Camera rotation<select data-setting="rotateSpeed">${[.5,1,1.5,2].map(n=>`<option value="${n}" ${Number(o.rotateSpeed||1)===n?'selected':''}>${n}×</option>`).join('')}</select></label>${row('confirmMoves','Confirm movement destinations')}${row('showEnemyBars','Show enemy health')}<label>Aim sensitivity<select data-setting="aimSensitivity">${[.25,.5,.75,1].map(n=>`<option value="${n}" ${Number(o.aimSensitivity??.5)===n?'selected':''}>${n}×</option>`).join('')}</select></label>${row('aimSway','Reticle breathing')}<label>Soldier name and AP tags<select data-setting="unitTags" data-type="string">${[['selected','Selected soldier'],['always','Whole squad'],['flash','Only briefly']].map(([v,l])=>`<option value="${v}" ${(o.unitTags||'selected')===v?'selected':''}>${l}</option>`).join('')}</select></label><button data-act="debug">Test / debug tools (F1)</button><button data-act="inventory">Equipment and body status (I)</button><button data-act="menu">Return to menu</button>${row('autoEndTurn', 'Auto end turn when the squad is spent')}${row('autoNext', 'Auto-select the next ready soldier')}${row('followCamera', 'Camera follows actions')}
            <h4>Audio</h4><label>Sound effects volume<input type="range" data-setting="soundVolume" min="0" max="1" step="0.05" value="${o.soundVolume ?? 0.65}" aria-label="Sound effects volume"></label>
            <h4>Camera</h4>${row('edgeScroll', 'Screen-edge scrolling')}<button data-act="proj" class="${g.scene.projection === 'ortho' ? 'on' : ''}">${g.scene.projection === 'ortho' ? '☑' : '☐'} Isometric (orthographic) view (V)</button>
            <div class="camhint" style="font-size:11px;opacity:.7;line-height:1.5;margin:4px 0 2px">Z / X floor up / down · WASD, arrows, screen edge pan · left or right-drag pan · middle-drag or Shift+right-drag orbit · wheel zoom-to-cursor cuts building interiors (max zoom shows 1st floor) · Q/E rotate · H / Home centre on soldier · V isometric · while aiming: A/D or Q/E rotate camera · W/S step cover · click canvas or drag/arrows aim · wheel zoom · Tab next target · click/Space fire · Esc back</div>
            <h4>Buildings</h4><div class="row"><button data-act="buildingCycle" class="${o.buildingView==='exterior'?'on':''}" aria-pressed="${o.buildingView==='exterior'}">Show outside only</button></div><small>Wheel zoom: roof → upper floors → ground floor (disregards manual floor buttons; max zoom always keeps the 1st floor & walls visible). Use the cube arrows for manual floor steps. I opens equipment.</small>
            <h4>Graphics</h4><button data-act="quality" data-arg="mobile" class="${QUALITY.name === 'mobile' ? 'on' : ''}">${QUALITY.name === 'mobile' ? '◉' : '○'} Mobile (light textures, fast)</button><button data-act="quality" data-arg="high" class="${QUALITY.name === 'high' ? 'on' : ''}">${QUALITY.name === 'high' ? '◉' : '○'} High (full textures, AO) — reloads</button>
            <h4>Readability</h4><button data-act="cue" data-arg="uGrid" class="${TERRAIN_CUES.uGrid.value ? 'on' : ''}">${TERRAIN_CUES.uGrid.value ? '☑' : '☐'} Debug tile grid</button><button data-act="cue" data-arg="uRim" class="${TERRAIN_CUES.uRim.value ? 'on' : ''}">${TERRAIN_CUES.uRim.value ? '☑' : '☐'} Ledge rims (orange = 2+ drop)</button><button data-act="ao" class="${g.scene.ao ? 'on' : ''}">${g.scene.ao ? '☑' : '☐'} Ambient occlusion</button>
            <h4>Lighting</h4><div class="row">${['day', 'dawn', 'overcast', 'dusk', 'night', 'night-ops'].map(l => `<button data-act="lighting" data-arg="${l}" class="${g.scene.lightingName === l ? 'on' : ''}">${l}</button>`).join('')}</div>`;
        setHtml(el, html, { preserveScroll: true });
    }
    log(text, cls = '') {
        this.lines.push(`<div class="${cls}">${esc(text)}</div>`);
        if (this.lines.length > 7) this.lines.shift();
        this.el('.log').innerHTML = this.lines.join('');
    }
    toast(text, cls = '') {
        const t = this.el('.toast');
        t.textContent = text; t.className = `toast show ${cls}`;
        clearTimeout(this.toastTimer);
        this.toastTimer = setTimeout(() => { t.className = 'toast'; }, 1800);
        this.log(text, cls);
    }
    banner(title, sub, cls) {
        const b = this.el('.banner');
        b.querySelector('.b1').textContent = title; b.querySelector('.b2').textContent = sub || '';
        b.className = `banner show ${cls || ''}`;
        clearTimeout(this.bannerTimer);
        this.bannerTimer = setTimeout(() => { b.className = `banner ${cls || ''}`; }, 850);
    }
    squadSpent(on) { this.spent = on; this.el('.endturn').classList.toggle('pulse', !!on); }
    cursorTip(x, y, html) {
        const el = this.el('.cursortip');
        if (x == null || !html) { el.classList.add('hidden'); return; }
        el.classList.remove('hidden');
        el.innerHTML = html;
        const bounds=this.root.getBoundingClientRect();
        const left=Math.max(8,Math.min(x+18,bounds.width-el.offsetWidth-8));
        const top=Math.max(8,Math.min(y+14,bounds.height-el.offsetHeight-8));
        el.style.transform = `translate(${left}px, ${top}px)`;
    }
    /** Build the ability slots for a unit (static fixed slots; unavailable actions stay visible and disabled). */
    slotsFor(u) {
        const b = this.game.battle, mode = this.game.mode, s = [];
        const ap = u.ap, w = WEAPONS[u.weapon];
        const armsOut = !!u.parts?.armL?.disabled && !!u.parts?.armR?.disabled && w.ap > 1 && w.id !== 'handcannon';
        s.push({ key: `weapon:${w.id}`, act: w.kind === 'melee' ? 'melee' : 'weapon', arg: w.id, group: 'weapon', icon: weaponIcon(w), name: w.kind === 'melee' ? 'Melee' : 'Shoot', cost: String(b.shotAp(u, w)), sub: w.ammo ? `${u.ammo[w.id] || 0} − ${reserveAmmo(u, w)} · ${fireMode(u, w).toUpperCase()}` : '', on: mode.kind === 'shoot' || mode.kind === 'melee', disabled: armsOut || ap < b.shotAp(u, w) || (w.ammo && u.ammo[w.id] < 1), tip: armsOut ? 'Both arms disabled — switch to sidearm' : `${w.name} · put the reticle on an enemy's body part · Space fires` });
        const owId = watchWeapon(u), ow = WEAPONS[owId];
        s.push({ key: 'overwatch:', group: 'weapon', act: 'overwatch', icon: ICONS.overwatch, name: 'Overwatch', cost: 'all', disabled: !ow || ap < ow.ap || (u.ammo[ow.id] ?? 0) < (ow.perShot || 1), on: mode.kind === 'overwatch', tip: ow ? '<b>Overwatch</b> · choose direction · all AP · <span style="color:#5ff2d6">Teal ≥65%</span> / <span style="color:#ffb347">Amber &lt;65%</span> estimated hit' : 'Overwatch · requires a ranged weapon' });
        s.push({ key: 'reload:', act: 'reload', icon: ICONS.reload, name: 'Reload', group: 'weapon', cost: String(w.reloadAp ?? 1), disabled: w.boltAction || !w.ammo || ap < w.reloadAp || u.ammo[w.id] >= w.ammo || reserveAmmo(u, w) < 1, tip: w.boltAction ? 'Bolt cycles loose rounds automatically' : 'Reload from carried loose rounds' });

        const itemCount = Object.values(u.items || {}).reduce((sum, n) => sum + (n > 0 ? n : 0), 0);
        const hasItems = itemCount > 0;
        s.push({ key: 'grenades:', act: 'grenades', group: 'equipment', icon: ICONS.grenade, name: 'Gear', cost: hasItems ? String(itemCount) : '0', on: this.openPanelKind === 'gear' || ['throw', 'gadget', 'breach'].includes(mode.kind), disabled: !hasItems, tip: hasItems ? 'Grenades and medical equipment' : 'No grenades or medical equipment remaining' });

        for (const a of [...(u.abilities || []).filter(id => !ABILITIES[id].intel || b.intelMode), ...(b.intelMode ? [b.supportChoices?.[u.owner] || 'carpet_bomb'] : [])]) {
            const ab = ABILITIES[a];
            s.push({ key: `ability:${a}`, group: ab.support || a === 'rally' ? 'commander' : ['brace', 'demolish', 'suppress'].includes(a) ? 'equipment' : 'augmentation', act: 'ability', arg: a, icon: ICONS[a] || ICONS.ability, name: ab.name, on: mode.abilityId === a || (a === 'suppress' && !!mode.suppress), cost: `${ab.ap || 0}`, sub: `${ab.wp} WP`, disabled: (ab.support && (b.personalTurns?.[u.owner] || 0) < (b.supportReady?.[u.owner] || 0)) || u.will < ab.wp || ap < (ab.ap || 0) || u.statuses?.some(st => st.id === 'panicked') || (a === 'suppress' && (u.ammo?.repeater ?? 0) < (WEAPONS.repeater.perShot || 1)), tip: `<b>${ab.name}</b> · ${ab.wp} Will${ab.ap ? ` · ${ab.ap} AP` : ''}<br>${esc(ab.text)}` });
        }
        // PLAN-14: Recon Scan — any soldier, one squad cooldown.
        if (u.side === 'player') {
            const sc = ABILITIES.recon_scan, wait = Math.max(0, (b.scanReadyAt ?? 1) - b.round);
            s.push({ key: 'ability:recon_scan', act: 'ability', arg: 'recon_scan', group: 'commander', icon: ICONS.recon_scan || ICONS.overwatch, name: sc.name, on: mode.abilityId === 'recon_scan', cost: wait ? `IN ${wait}` : `${sc.ap}`, sub: `${sc.wp} WP`, disabled: wait > 0 || u.will < sc.wp || ap < sc.ap, tip: `<b>${sc.name}</b> · ${sc.wp} Will · ${sc.ap} AP${wait ? ` · ready in ${wait} round${wait > 1 ? 's' : ''}` : ''}<br>${esc(sc.text)}` });
        }
        if (!b.intelMode) {
            const wait = Math.max(0, (b.strikeReadyAt ?? 1) - b.round);
            s.push({ key: 'ability:killstreak_strike', act: 'ability', arg: 'killstreak_strike', group: 'commander', icon: ICONS.ability, name: 'Strike', on: mode.abilityId === 'killstreak_strike', cost: wait ? `IN ${wait}` : 'READY', disabled: wait > 0, tip: wait ? `Commander strike · recharging, ready in ${wait} round${wait > 1 ? 's' : ''}` : 'Commander strike · any area on the map · press R to rotate · recharges 10 rounds after use' });
        }
        const f = b.formations?.of?.(u);
        s.push({
            key: 'formation:', group: 'commander', act: 'formation', icon: ICONS.formation,
            name: 'Formation', cost: '0', sub: f ? FORMATIONS[f.template].name : '',
            on: this.openPanelKind === 'formation',
            tip: f
                ? `<b>${esc(FORMATIONS[f.template].name)} formation</b> (F) · click to switch shape or break formation`
                : '<b>Formation</b> (F) · plan slots, then assemble your squad'
        });

        const door = this.game.nearestDoor?.(u);
        const closed = door ? b.store.get(door.x, door.y, door.z + 1) === MAT.door : false;
        s.push({
            key: 'door:', group: 'tactical', act: 'door', icon: ICONS.door,
            name: door ? (closed ? 'Kick door' : 'Close door') : 'Door',
            cost: '1', disabled: !door || ap < 1,
            tip: !door ? 'Move adjacent to a door to open or close it' : closed ? 'Kick open the adjacent door · 1 AP · reveal the room' : 'Close the adjacent door · 1 AP'
        });
        const canBreach = (b.breachPoints?.(u)?.length || 0) > 0;
        s.push({
            key: 'breach:', group: 'tactical', act: 'breach', icon: ICONS.breach,
            name: 'Breach', cost: '1', on: this.openPanelKind === 'breach', disabled: !canBreach || ap < 1,
            tip: canBreach ? '<b>Breach</b> (B) · stack up and storm the room; one free shot each' : 'Move adjacent to a door or breachable floor to breach'
        });
        const o = b.objective;
        if (o?.kind === 'recover' && !o.item.secured) {
            const nearItem = !o.item.carrier && Math.max(Math.abs(o.item.x - u.x), Math.abs(o.item.y - u.y)) <= 1 && Math.abs(o.item.z - u.z) <= 1;
            s.push({ key: 'recover:', group: 'tactical', act: 'recover', icon: ICONS.ability, name: `Take ${o.item.label}`, cost: '1', disabled: !nearItem || ap < 1, tip: `<b>Recover</b> · 1 AP · pick up the ${esc(o.item.label.toLowerCase())}${o.zone ? ' — then get it to the extraction zone' : ''}` });
        }
        if (o?.zone) {
            const canExtract = extractionOpen(o) && inZone(o.zone, u);
            s.push({ key: 'extract:', group: 'tactical', act: 'extract', icon: ICONS.ability, name: 'Extract', cost: '1', disabled: !canExtract || ap < 1, tip: '<b>Extract</b> · 1 AP · leave the map from the extraction zone' });
        }

        s.push({ key: 'wait:', group: 'end', act: 'wait', icon: ICONS.overwatch, name: 'Finish soldier', cost: 'all', disabled: ap + u.moveOnlyAp <= 0, tip: 'Spend remaining AP and select the next ready soldier. End Turn starts the enemy phase.' });
        const groups = ['weapon', 'equipment', 'tactical', 'augmentation', 'commander', 'end'];
        return s.sort((a, b) => groups.indexOf(a.group || 'equipment') - groups.indexOf(b.group || 'equipment'));
    }
    runSlot(i) {
        const s = this.slots[i], g = this.game; if (!s || s.disabled || !g.canAct()) return;
        const u = g.selectedUnit(); if (!u) return;
        switch (s.act) {
            case 'grenades': if (g.mode.kind === 'shoot') g.setMode({ kind: 'move' }); this.showGearPanel(); break;   // PLAN-15: never aim and gear at once
            case 'weapon': g.setMode(g.mode.kind === 'shoot' && g.mode.weaponId === s.arg ? { kind: 'move' } : { kind: 'shoot', weaponId: s.arg }); break;
            case 'melee': g.setMode({ kind: 'melee', weaponId: s.arg }); break;
            case 'throw': g.setMode({ kind: 'throw', itemId: s.arg }); break;
            case 'overwatch': g.setMode({ kind: 'overwatch' }); break;
            case 'wait': g.intent({type:'wait'}); break;
            case 'reload': g.intent({ type: 'reload' }); break;
            case 'ability': g.useAbility(s.arg); break;
            case 'formation': this.showFormationPanel(); break;
            case 'formBreak': g.intent({ type: 'formation_break', formationId: s.arg }); break;
            case 'breach': this.showBreachPanel(); break;
            case 'door': g.toggleNearestDoor(); break;
            case 'recover': g.intent({ type: 'recover' }); break;
            case 'extract': g.intent({ type: 'extract' }); break;
        }
        this.refresh();
    }
    triggerSlot(n) { this.runSlot(n - 1); }
    /** PLAN-15: with the gear panel open, number keys pick from it instead of the action bar. */
    pickPanelItem(n) {
        const p = this.el('.panel'); if (p.classList.contains('hidden')) return false;
        const items = [...p.querySelectorAll('.gear-quick [data-act="item"]')]; if (!items.length) return false;
        items[n - 1]?.click(); return true;
    }
    /** PLAN-15: a short "▶ NAME · CLASS" call-out whenever control passes to another soldier. */
    announceUnit(u) {
        const el = this.el('.unit-callout'); if (!el) return;
        el.innerHTML = `<b>▶ ${esc(u.name)}</b><span>${esc(displayName(u.type, this.game.battle?.intelMode))}</span>`;
        el.classList.remove('show'); void el.offsetWidth; el.classList.add('show');
        clearTimeout(this.calloutTimer); this.calloutTimer = setTimeout(() => el.classList.remove('show'), 1400);
    }
    /** PLAN-15: the auto end-turn countdown (0 hides it). */
    autoEndCountdown(ms) {
        const el = this.el('.autoend'); if (!el) return;
        el.classList.toggle('hidden', !ms);
        if (ms) { const bar = el.querySelector('i'); bar.style.transition = 'none'; bar.style.width = '100%'; void bar.offsetWidth; bar.style.transition = `width ${ms}ms linear`; bar.style.width = '0%'; }
    }
    /** PLAN-15: the active soldier card — portrait, name, AP pips, HP, Will, Stress, weapon rounds, gadgets, statuses. */
    renderUnitCard(u, canAct) {
        const el = this.el('.unitcard'), g = this.game, b = g.battle;
        if (!u || u.side !== 'player' || b.outcome || b.activeSide !== 'player') { el.classList.add('hidden'); return; }
        el.classList.remove('hidden'); el.classList.toggle('compact', g.mode.kind === 'shoot');
        const w = WEAPONS[u.weapon], max = Math.max(u.maxAp ?? 4, u.ap + (u.moveOnlyAp || 0));
        const pipsHtml = Array.from({ length: max }, (_, i) => `<i class="${i < u.ap ? 'ap' : i < u.ap + (u.moveOnlyAp || 0) ? 'move' : ''}"></i>`).join('');
        const frac = u.hp / Math.max(1, u.maxHp), hpCls = frac > 0.6 ? 'ok' : frac > 0.3 ? 'mid' : 'low';
        const ammo = w?.ammo ? `${u.ammo[w.id] ?? 0}/${w.ammo}<small> +${(() => { try { return reserveAmmo(u, w); } catch { return 0; } })()}</small>` : '';
        const gadgets = Object.entries(u.items || {}).filter(([id, n]) => n > 0 && THROWABLES[id]).map(([id, n]) => `<span title="${esc(THROWABLES[id].name)}">${ICONS.grenade}${n}</span>`).join('');
        const statuses = (u.statuses || []).map(s => `<em>${esc(s.id)}</em>`).join('');
        const state = u.overwatch ? 'ON WATCH' : (u.ap + (u.moveOnlyAp || 0)) <= 0 ? 'NO AP LEFT' : canAct ? '' : 'WAITING';
        const stress = Math.round(u.stress || 0);
        const will = `${u.will ?? 0}/${u.maxWill ?? u.will ?? 0}`;
        const stressCls = stress >= 75 ? 'high' : stress >= 40 ? 'mid' : '';
        const html = `<img src="${portraitSrc(u)}" alt=""><div class="uc-main"><div class="uc-name"><b>${esc(u.name)}</b><span>${esc(displayName(u.type, b.intelMode))}</span>${state ? `<strong>${state}</strong>` : ''}</div>
            <div class="uc-ap" title="Blue: AP that can still act · yellow: move only">${pipsHtml}<span>${u.ap}${u.moveOnlyAp ? `+${u.moveOnlyAp}` : ''} AP</span><span class="uc-wp" title="Will Points">${will} WP</span><span class="uc-stress ${stressCls}" title="Stress (${stress}%)">${stress}% STR</span></div>
            <div class="uc-hp ${hpCls}"><div class="segbar">${segs(u.hp, u.maxHp)}</div><span>${u.hp}/${u.maxHp} HP</span></div>
            <div class="uc-stressbar" title="Stress ${stress}%"><i style="width:${Math.min(100, stress)}%"></i></div>
            <div class="uc-kit">${w ? `<span class="uc-gun">${esc(w.name)} ${ammo}</span>` : ''}${gadgets}${statuses}</div></div>`;
        setHtml(el, html);
    }
    tick() {}
    refresh() {
        const g = this.game, b = g.battle;
        if (!b) return;
        if (this.updateFloorLabel) this.updateFloorLabel();
        else Hud.prototype.updateFloorLabel.call(this);
        for(const button of this.root.querySelectorAll('[data-act="mark"]')){const active=g.mode.kind==='mark'&&g.mode.color===button.dataset.arg;button.classList.toggle('on',active);button.setAttribute('aria-pressed',String(active));}
        this.root.classList.toggle('enemy-phase', b.activeSide !== 'player');
        this.root.classList.toggle('intel-mode',b.intelMode);
        const objText = objectiveStatus(b.objective, id => b.unit(id)?.name || id);
        const objEl = this.el('.turnbox .objstat');
        if (objEl) { objEl.textContent = objText; objEl.classList.toggle('hidden', !objText); }
        this.renderAiPosture(b);
        this.el('.round').textContent = b.asyncCoop ? `ENEMY BEAT ${b.round} · YOUR TURN ${(b.personalTurns[g.session.local?'player':g.session.playerId]||0)+1}` : `ROUND ${b.round}`;
        this.el('.endturn').textContent=b.asyncCoop?'END MY TURN':'END TURN';
        const phase = this.el('.phase');
        phase.textContent = b.outcome ? 'MISSION OVER' : b.activeSide === 'player' ? (b.asyncCoop ? 'INDEPENDENT TURNS' : 'SQUAD PHASE') : 'ENEMY ACTIVITY';
        phase.className = `phase ${b.activeSide}`;
        this.el('.enemyturn').classList.toggle('hidden', !(b.activeSide !== 'player' && !b.outcome && !g.debug.manualEnemy));
        this.setEnemyActivity?.(g.activeEnemyLabel || null);
        if (this.updateSpeedButtons) this.updateSpeedButtons();
        else Hud.prototype.updateSpeedButtons.call(this);
        // Squad column.
        const squadHtml = b.units.filter(u=>u.side==='player').map((u,i)=>`<button class="squad-head ${u.id===g.selected?'sel':''} ${u.dead?'dead':''} ${squadBadge(u).cls}" data-act="select" data-arg="${u.id}" aria-label="Select ${esc(u.name)}" title="${esc(u.name)} · ${u.hp}/${u.maxHp} HP · ${u.ap} AP"><img src="${portraitSrc(u)}" alt="${esc(u.name)}"><b>${u.hp}<small>/${u.maxHp}</small></b><span class="badge ${squadBadge(u).cls}">${squadBadge(u).text}</span><span class="pips">${Array.from({length:Math.max(u.maxAp??4,u.ap)},(_,i)=>`<i class="${i<u.ap?'on':''}"></i>`).join('')}</span>${!u.dead&&b.flankedBy(u).length?'<i class="flank-alert" title="Flanked by a visible enemy">!</i>':''}</button>`).join('')+(b.activeSide==='player'&&!b.outcome?`<button class="next-ready" data-act="nextReady" title="Next ready soldier (Tab)">NEXT ▸</button>`:'')+`<button class="inventory-toggle" data-act="inventory" aria-label="Open inventory">${ICONS.backpack}<span>INV</span><kbd>I</kbd></button>`;
        setHtml(this.el('.squad'), squadHtml);
        const u=g.selectedUnit();this.equipment.render(u);
        this.root?.querySelector?.('[data-act="inventory"]')?.classList?.toggle?.('on', !!this.equipment?.open);
        this.root?.querySelector?.('[data-act="options"]')?.classList?.toggle?.('on', !this.el('.options')?.classList?.contains?.('hidden'));
        // Ability bar: keep buttons static and patch DOM nodes in place so clicking/hovering never flashes.
        const showSlots = u && (u.side === 'player' || g.debug?.manualEnemy) && !b.outcome;
        const canAct = !!(showSlots && g.controllable(u) && !g.aiRunning);
        this.renderUnitCard(u, canAct);
        const rawSlots = showSlots ? this.slotsFor(u) : [];
        this.slots = canAct ? rawSlots : rawSlots.map(s => ({ ...s, disabled: true }));
        const ms = this.el('.mode-switch');
        const modes = u ? fireModes(WEAPONS[u.weapon]) : [];
        const hasModes = !!(u && modes.length > 1 && showSlots);
        if (ms && ms.classList) {
            ms.classList.toggle('hidden', !hasModes);
            if (hasModes) {
                const label = `${fireMode(u, WEAPONS[u.weapon]).toUpperCase()} ↻`;
                if (ms.textContent !== label) ms.textContent = label;
                ms.disabled = !canAct;
            }
        }
        this.renderSlots(this.el('.slots'), this.slots);
        const active = this.slots.find(s => s.on);
        this.activeSlotName = active ? active.tip : (u && canAct ? `<b>${esc(u.name)}</b> · ${modeText(g.mode)}` : (b.activeSide !== 'player' ? '' : 'Select a soldier'));
        const hoveredSlot = this._hoveredSlotIdx != null ? this.slots[+this._hoveredSlotIdx] : null;
        setHtml(this.el('.slotname'), hoveredSlot ? (hoveredSlot.tip || '') : this.activeSlotName);
        this.el('.actionbar').classList.toggle('hidden', !(b.activeSide === 'player' || g.debug.manualEnemy) || !!b.outcome);
        this.renderTargets();
        this.renderTarget();
    }
    renderSlots(container, slots) {
        if (!container) return;
        if (typeof document === 'undefined' || !container.appendChild) {
            const html = slots.map((s, i) => `<button class="slot ${s.on ? 'on' : ''} ${i > 0 && s.group !== slots[i - 1].group ? 'group-start' : ''}" aria-label="${esc(s.name)}" data-act="slot" data-arg="${i}" ${s.disabled ? 'disabled' : ''} data-tip="${esc(s.tip || s.name)}">
                <kbd>${i < 9 ? i + 1 : ''}</kbd><span class="slot-icon">${s.icon}</span><span class="slot-label">${esc(s.name)}</span><span class="cost">${s.cost}</span>${s.sub ? `<span class="sub">${s.sub}</span>` : ''}</button>`).join('');
            setHtml(container, html);
            return;
        }
        while (container.children.length > slots.length) container.lastElementChild?.remove?.() ?? container.removeChild?.(container.lastChild);
        while (container.children.length < slots.length) {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.dataset.act = 'slot';
            const kbd = document.createElement('kbd');
            const icon = document.createElement('span'); icon.className = 'slot-icon';
            const label = document.createElement('span'); label.className = 'slot-label';
            const cost = document.createElement('span'); cost.className = 'cost';
            const sub = document.createElement('span'); sub.className = 'sub';
            btn.append(kbd, icon, label, cost, sub);
            btn._parts = { kbd, icon, label, cost, sub };
            btn._state = {};
            container.appendChild(btn);
        }
        for (let i = 0; i < slots.length; i++) {
            const s = slots[i], btn = container.children[i], st = btn._state || (btn._state = {}), p = btn._parts;
            const cls = `slot${s.on ? ' on' : ''}${i > 0 && s.group !== slots[i - 1].group ? ' group-start' : ''}`;
            const tip = s.tip || s.name || '';
            const argStr = String(i);
            const kbdStr = i < 9 ? String(i + 1) : '';
            const subStr = s.sub || '';
            const dis = !!s.disabled;
            if (st.cls !== cls) { btn.className = cls; st.cls = cls; }
            if (st.dis !== dis) { btn.disabled = dis; st.dis = dis; }
            if (st.arg !== argStr) { btn.dataset.arg = argStr; st.arg = argStr; }
            if (st.name !== s.name) { btn.setAttribute?.('aria-label', s.name); p.label.textContent = s.name; st.name = s.name; }
            if (st.tip !== tip) { btn.dataset.tip = tip; st.tip = tip; }
            if (st.kbd !== kbdStr) { p.kbd.textContent = kbdStr; st.kbd = kbdStr; }
            if (st.icon !== s.icon) { p.icon.innerHTML = s.icon || ''; st.icon = s.icon; }
            if (st.cost !== s.cost) { p.cost.textContent = s.cost ?? ''; st.cost = s.cost; }
            if (st.sub !== subStr) { p.sub.textContent = subStr; st.sub = subStr; }
        }
    }
    setEnemyActivity(text = null) {
        const span = this.el('.enemyturn span');
        if (span) span.textContent = text || 'ENEMY ACTIVITY';
    }
    renderAiPosture(b) {
        const el = this.el('.turnbox .ai-posture'); if (!el) return;
        const ad = b.aiAdaptation || {};
        const tuning = b.aiTuning || {};
        const top = Object.entries(tuning).filter(([, v]) => v >= 1.08).sort((a, c) => c[1] - a[1]).slice(0, 3);
        const label = s => s.replace(/([A-Z])/g, ' $1').replace(/_/g, ' ').trim().toUpperCase();
        const biomeTag = ad.biome ? ad.biome.replace(/_/g, ' ').toUpperCase() : '';
        if (!biomeTag && !ad.liveWeight && !top.length) { el.classList.add('hidden'); return; }
        el.classList.remove('hidden');
        el.classList.toggle('adapted', (ad.liveWeight || 0) > 0 || (ad.shifts?.length || 0) > 0);
        if (ad.shifts?.length) {
            el.textContent = `AI ADAPTED · ${label(ad.shifts[0].key)}`;
        } else if (biomeTag) {
            el.textContent = top.length ? `AI: ${biomeTag} · ${label(top[0][0])}` : `AI: ${biomeTag}`;
        } else {
            el.textContent = `AI COUNTER · ${label(top[0][0])}`;
        }
        const tipParts = [];
        if (ad.biome) tipParts.push(`Biome posture: ${ad.biome.replace(/_/g, ' ')}`);
        if (ad.detected?.length) tipParts.push(`Detected habits: ${ad.detected.join(', ')}`);
        if (ad.liveWeight > 0) tipParts.push(`Live adaptation weight: ${Math.round(ad.liveWeight * 100)}%`);
        if (top.length) tipParts.push(`Active focus: ${top.map(([k, v]) => `${k} ×${v}`).join(', ')}`);
        el.title = tipParts.join(' · ');
    }
    /** Clickable visible hostile targets strip (also active in shoot mode for instant target switching). */
    renderTargets() {
        const el = this.el('.targets'), g = this.game, b = g.battle, u = g.selectedUnit?.();
        if (!el) return;
        if (!b || b.outcome || !u || (b.activeSide !== 'player' && !g.debug?.manualEnemy)) { setHtml(el, ''); return; }
        const list = g.visibleTargets?.(u) || b.enemiesOf(u).filter(t => alive(t) && g.isVisible?.(t));
        const activeId = g.aimPick?.unitId || g.framedTargetId;
        const s = g.shooterOf?.(u) || u;
        const html = list.map((t, i) => {
            const cov = b.store ? coverAgainst(b.store, t.x, t.y, t.z, s.x, s.y, s.z) : COVER.HALF;
            const flk = cov === COVER.NONE;
            const on = t.id === activeId;
            return `<button class="tgt ${on ? 'on' : ''} ${flk ? 'flk' : ''}" data-act="aimTarget" data-arg="${t.id}" title="${esc(t.name)} · ${t.hp}/${t.maxHp} HP${flk ? ' · FLANKED' : ''} · Click to frame (${i + 1})">
                <img src="${portraitSrc(t)}" alt="${esc(t.name)}"><span>${t.hp}<i>/${t.maxHp}</i></span>${flk ? '<em title="Flanked">!</em>' : ''}</button>`;
        }).join('');
        setHtml(el, html);
    }
    /** Phoenix Point free-aim tactical readout + physical recoil/trajectory telemetry + 5-part hitbox strip. */
    renderTarget(){
        const g=this.game,el=this.el('.target'),aiming=g.mode.kind==='shoot';
        this.root.classList.toggle('shooter-mode',aiming);
        if(!aiming){el.classList.add('hidden');return;}
        el.classList.remove('hidden');el.classList.remove('slim');
        const u=g.selectedUnit(),w=WEAPONS[g.mode.weaponId],locked=g.aimPointer?.locked;
        if(!u||!w){el.classList.add('hidden');return;}
        const cost=g.mode.suppress?ABILITIES.suppress.ap:g.battle.shotAp(u,w),ammo=u.ammo?.[w.id]||0;
        const res=(() => { try { return reserveAmmo(u,w); } catch { return 0; } })();
        const modes=fireModes(w),fm=g.mode.fireMode||fireMode(u,w);
        const tel=g.aimTelemetry?.(), rec=tel?.recoil;
        const peek=g.peekStatus?.();
        const focus=tel?(tel.focusUnit??null):((g.framedTargetId&&g.battle?.unit?.(g.framedTargetId))||null);
        const hitPct=tel?Math.round((tel.hit??0)*100):0;
        const firstPct=Math.round((tel?.firstRoundHit??tel?.hit??0)*100);
        const anyPct=Math.round((tel?.anyHit??tel?.hit??0)*100);
        const partPct=tel?Math.round((tel.partHit??0)*100):0;
        const hitCls=hitPct>=65?'high':hitPct>=35?'mid':'low';
        const activePart=g.aimPick?.unitId===focus?.id?g.aimPick?.part:(tel?.targetPart||'torso');
        const bodyList=focus?(focus.drone?['torso']:PARTS):[];
        const partRows=focus?bodyList.map(part=>{
            const ps=focus.parts?.[part];if(!ps)return '';
            const trajPct=tel?.parts?Math.round((tel.parts[part]||0)*100):null;
            const pc=trajPct==null?g.partChance?.(focus,part):null;
            const pctText=trajPct!=null?`${trajPct}%`:(pc?`${pc.part}%`:'');
            const arm=partArmor(focus,part);
            const active=activePart===part;
            return `<button class="part-btn ${active?'on':''} ${ps.disabled?'dis':''}" data-act="aimPart" data-arg="${part}">
                <b>${esc(BODY[part]?.label||part)}</b>
                <small>${ps.disabled?'DISABLED':`${ps.hp}/${ps.max} HP${arm?` · ARM ${arm}`:''}`}</small>
                <span>${pctText}</span></button>`;
        }).join(''):'';
        const modTags=(tel?.mods||[]).filter(([,v])=>v!==1).map(([k,v])=>`<span>${esc(k)} ×${v}</span>`).join('');
        const badges=[];
        if(g.mode.suppress)badges.push('<span class="badge-warn">SUPPRESSIVE FIRE</span>');
        if(tel?.outOfRange)badges.push(`<span class="badge-warn">OUT OF RANGE (${tel.distance.toFixed(1)}/${tel.weapon.maxRange}m)</span>`);
        if(tel?.blocked)badges.push('<span class="badge-warn">✕ COVER BLOCKED</span>');
        if((tel?.friendly??0)>0.05)badges.push(`<span class="badge-warn">ALLY IN LINE (${Math.round(tel.friendly*100)}%)</span>`);
        if((tel?.throughCover??0)>0.1&&(tel?.hit??0)>0)badges.push('<span class="badge-crit">PIERCING COVER</span>');
        if(focus&&tel?.flanked)badges.push('<span class="badge-crit">FLANKED · EXPOSED +15%</span>');
        if(focus&&activePart==='head'&&!focus.drone&&tel?.headshotMult>1)badges.push(`<span class="badge-crit">HEADSHOT ×${tel.headshotMult}</span>`);
        if((u.recoilHeat||0)>0.2)badges.push(`<span class="badge-warn">RECOIL HEAT +${(u.recoilHeat||0).toFixed(1)}</span>`);
        if(focus&&tel?.lethalChance>0.5)badges.push('<span class="badge-lethal">LETHAL</span>');
        else if(focus&&tel?.disableChance>0.35&&activePart!=='torso')badges.push(`<span class="badge-crit">DISABLE ${(BODY[activePart]?.label||activePart).toUpperCase()}</span>`);
        const vel=rec?.velocity||w.velocity||0;
        const caliberName=tel?.bullet?.caliberName||(w.caliber?CALIBERS[w.caliber]?.name:null);
        const hitSub=(tel?.rounds??1)>1
            ?`TRAJ · 1ST ${firstPct}% · ANY ${anyPct}%`
            :(tel?.weapon?.pellets??1)>1
                ?`PELLETS · ANY ${anyPct}%`
                :'TRAJECTORY';
        const bul=tel?.bullet;
        const dmgHtml=bul
            ?(bul.rounds>1
                ?`<b>${bul.netPerRound}×${bul.rounds}</b><small>BULLET DMG · ~${tel.expectedDamage} AVG</small>`
                :bul.pellets>1
                    ?`<b>${bul.netPerRound}</b><small>${bul.pellets} PELLETS · ~${tel.expectedDamage} AVG</small>`
                    :`<b>${bul.netPerRound}</b><small>BULLET DMG · ~${tel.expectedDamage} AVG</small>`)
            :`<b>~${tel?.expectedDamage??0}</b><small>EST DMG${partPct?` · ${partPct}% PART`:''}</small>`;
        const freeDmg=bul?` · ${bul.perRound}${bul.rounds>1?`×${bul.rounds}`:''} DMG`:'';
        const ballisticsRow=rec?`<div class="aim-ballistics">
                <div><b>${rec.baseSpread}°${rec.finalSpread>rec.baseSpread?`→${rec.finalSpread}°`:''}</b><small>SPREAD</small></div>
                <div><b>+${rec.totalClimbDeg}°</b><small>CLIMB</small></div>
                <div><b>${rec.dropMeters>0.02?`-${rec.dropMeters}m`:'FLAT'}</b><small>DROP</small></div>
                <div><b>${vel?`${vel} m/s`:'—'}</b><small>VEL</small></div></div>`:'';
        const html=`<div class="aim-top"><button class="aim-back" data-act="cancel" aria-label="${locked?'Release aim':'Back to tactics'}">${locked?'Release aim':'Back'} <kbd>Esc</kbd></button>
                ${peek?`<span class="peek-badge ${peek.peeking||peek.autoStep||peek.autoLean?'on':''}">${peek.autoStep?'STEP OUT':peek.autoLean?'LEAN':peek.peeking?'PEEKING':'HOME'}${peek.overwatch?` · ${peek.overwatch} OW`:''}</span>`:''}
                ${peek?.peeking?'<button class="aim-peek-home" data-act="peekHome">Step back</button>':''}</div>
            <div class="shooter-status"><div class="shooter-meta"><span class="shooter-weapon">${esc(w.name)}</span><small>${caliberName?`${esc(caliberName)} · `:''}${cost} AP${fm&&modes.length>1?` · ${fm.toUpperCase()}`:''}</small></div>
                <span class="shooter-ammo" aria-label="${ammo} loaded, ${res} reserve"><b>${ammo}</b><small>/${res}</small></span></div>
            ${modes.length>1&&!g.mode.suppress?`<div class="aim-modes">${modes.map(m=>`<button data-act="aimMode" data-arg="${m}" class="${m===fm?'on':''}">${m.toUpperCase()}</button>`).join('')}</div>`:''}
            ${ballisticsRow}
            ${badges.length?`<div class="aim-badges">${badges.join('')}</div>`:''}
            ${focus&&tel?`<div class="thead aim-forecast"><div class="tinfo"><div class="tname">${esc(focus.name)}</div><small>${focus.hp}/${focus.maxHp} HP · ${tel.distance.toFixed(1)} m</small></div>
                <div class="aim-nums"><div class="bigpct ${hitCls}">${hitPct}%<small>${hitSub}</small></div><div class="est-dmg">${dmgHtml}</div></div></div>
                <div class="parts aim-parts">${partRows}</div>`:tel?`<div class="aim-free-read"><b>FREE AIM · ${tel.distance.toFixed(1)} m${freeDmg}</b><span>${tel.blocked?'Cover / wall in trajectory':'Clear ballistic trajectory'}</span></div>`:''}
            ${modTags?`<div class="mods aim-mods">${modTags}</div>`:''}
            <div class="tbtns">${!locked&&!g.aimPointer?.unavailable?'<button data-act="captureAim">Aim</button>':''}<span class="aim-hint">A/D or Q/E: Rotate · Arrows: Reticle · Tab: Target · Wheel: Zoom</span><button data-act="fire" class="fire firebtn" ${ammo<1||u.ap<cost||tel?.outOfRange?'disabled':''}>Fire <kbd>Click / Space</kbd></button></div>`;
        setHtml(el, html, { preserveScroll: true });
    }
    showGearPanel(){
        const p=this.el('.panel');
        if(this.openPanelKind==='gear'&&!p.classList.contains('hidden')){this.hidePanel();return;}
        this.openPanelKind='gear';
        const u=this.game.selectedUnit();p.classList.remove('hidden');
        const tag=t=>t.heal?`Heal ${t.heal} HP`:t.smoke?'Smoke cover':t.element?`${t.damage||0} ${t.element}`:t.damage?`${t.damage} dmg`:'';
        setHtml(p,`<h3>Equipment <button data-act="closePanel">✕</button></h3><div class="gear-quick">${Object.entries(u.items).filter(([id,n])=>n>0&&THROWABLES[id]).map(([id,n],i)=>{const t=THROWABLES[id],sub=tag(t);return `<button data-act="item" data-arg="${id}" ${u.ap<t.ap?'disabled':''}><kbd>${i+1}</kbd>${ICONS.grenade}<b>${esc(t.name)}</b><small>${n} carried · ${t.ap} AP${sub?` · ${esc(sub)}`:''}</small></button>`;}).join('')}</div>`,{preserveScroll:true});
    }
    showFormationPanel() {
        const p=this.el('.panel');
        if(this.openPanelKind==='formation'&&!p.classList.contains('hidden')){this.hidePanel();return;}
        this.openPanelKind='formation';
        p.classList.remove('hidden');
        const cur=this.game.battle?.formations.of(this.game.selectedUnit());
        const breakBtn = cur ? `<button data-act="formBreak" data-arg="${cur.id}" class="wide"><b>Break ${esc(FORMATIONS[cur.template].name)}</b><small>Dissolve the formation (free)</small></button>` : '';
        setHtml(p,`<h3>Formation <button data-act="closePanel">✕</button></h3><p>${cur?`Switch the ${esc(FORMATIONS[cur.template].name)} to another shape (no AP, same members). Wide shapes cannot enter narrow spaces; switch to a file or break the formation there. Select a member and click a highlighted spot to trade places for free.`:'Choose a formation, then move at least one teammate onto a highlighted slot. Group movement uses the lowest remaining movement budget. Select a member and click a highlighted spot to trade places for free.'}</p>${breakBtn}${Object.values(FORMATIONS).filter(f=>f.slots&&f.id!==cur?.template).map(f=>`<button data-act="formTpl" data-arg="${f.id}" class="wide"><b>${f.name}</b><small>${esc(f.text)}</small></button>`).join('')}`,{preserveScroll:true});
    }
    showBreachPanel() {
        const g = this.game, u = g.selectedUnit(); if (!u) return;
        const p = this.el('.panel');
        if (this.openPanelKind === 'breach' && !p.classList.contains('hidden')) { this.hidePanel(); return; }
        this.openPanelKind = 'breach';
        const pts = g.battle.breachPoints(u);
        const stack = g.breachStack(u, pts[0]);
        p.classList.remove('hidden');
        const charge = g.battle.unitsOf(u.side).some(o => stack.includes(o.id) && o.items.breach_charge > 0);
        setHtml(p,`<h3>Breach <button data-act="closePanel">✕</button></h3><p>Stack: ${stack.map(id => esc(g.battle.unit(id).name)).join(', ')} (1 AP each, one free shot each on entry; unalerted defenders are surprised).</p>` +
            pts.map((pt, i) => `<div class="bp">${pt.entry==='floor'?'Floor slab':'Door'} at ${pt.x},${pt.y}${pt.roomId!=null?' → room '+pt.roomId:''}
                ${pt.entry==='floor'?`<button data-act="doBreach" data-arg="${i}:floor">Floor charge · 2×2 hole</button>`:`<button data-act="doBreach" data-arg="${i}:door">Door entry</button>`}${pt.entry!=='floor'&&charge ? `<button data-act="doBreach" data-arg="${i}:charge">Breach charge</button>` : ''}</div>`).join(''),{preserveScroll:true});
    }
    /** After-action report (every battle). The old outcome card is folded into its header. */
    showReport(report, { saved = true, canEdit = true, campaign = null } = {}) {
        this.report = report; this.reportOpts = { saved, canEdit, campaign, tab: this.reportOpts?.tab || 'squad' };
        const el = this.el('.outcome'); el.classList.remove('hidden');
        el.innerHTML = reportMarkup(report, this.reportOpts);
    }
    reportTab(tab) { if (!this.report) return; this.reportOpts.tab = tab; this.showReport(this.report, this.reportOpts); }
    async copyReport() {
        try { await navigator.clipboard.writeText(reportText(this.report)); this.toast('Report summary copied'); }
        catch { this.toast('Copy failed: clipboard not available', 'warn'); }
    }
}

/** PLAN-15 squad selector state: READY (full AP), n AP, WATCH, DONE or KIA. */
export function squadBadge(u) {
    if (u.dead) return { text: 'KIA', cls: 'kia' };
    if (u.overwatch) return { text: 'WATCH', cls: 'watch' };
    const left = u.ap + (u.moveOnlyAp || 0);
    if (left <= 0) return { text: 'DONE', cls: 'spent' };
    if (u.ap >= (u.maxAp ?? 4)) return { text: 'READY', cls: 'ready' };
    return { text: `${u.ap}${u.moveOnlyAp ? '+' + u.moveOnlyAp : ''} AP`, cls: 'partial' };
}
function segs(hp, max) {
    const n = Math.min(max, 40), per = max / n;
    let s = '';
    for (let i = 0; i < n; i++) s += `<i class="${hp > i * per + per / 2 - 1e-6 ? 'on' : ''}"></i>`;
    return s;
}
function pips(n, max, cls) { let s = ''; for (let i = 0; i < Math.max(max, n); i++) s += `<i class="${cls} ${i < n ? 'on' : ''}"></i>`; return `<span class="pipset">${s}</span>`; }
function modeText(m) {
    switch (m.kind) {
        case 'shoot': return `${WEAPONS[m.weaponId]?.name} — move the reticle, A/D rotates camera, W/S steps out, Space fires`;
        case 'melee': return 'melee — click an adjacent enemy · Right-click or Esc to cancel';
        case 'gadget': return 'Medkit — click an injured adjacent ally (or self) · Right-click or Esc to cancel';
        case 'throw': return `throw ${THROWABLES[m.itemId].name} — click a tile · Right-click or Esc to cancel`;
        case 'ability': return `${ABILITIES[m.abilityId]?.name} — click ${ABILITIES[m.abilityId]?.targeting === 'ally' ? 'an injured ally (self allowed)' : 'an empty visible tile'} · Right-click or Esc to cancel`;
        case 'overwatch': return 'overwatch — click the direction to watch · Right-click or Esc to cancel';
        case 'mark': return `click a block to mark ${m.color} · click it again to clear · Esc exits`;
        default: return 'click a tile to move · click an enemy to aim · <span class="blue">blue</span> keeps an action · <span class="yellow">yellow</span> is a dash';
    }
}
export { alive };
