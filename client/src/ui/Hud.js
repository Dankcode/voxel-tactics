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
import { ABILITIES, CLASSES, ENEMIES, displayName } from '../../../shared/content/units.js';
import { FORMATIONS } from '../../../shared/content/formations.js';
import { alive } from '../../../shared/battle/Units.js';
import { inZone, extractionOpen, objectiveStatus } from '../../../shared/battle/Objectives.js';
import { ICONS, weaponIcon } from './Icons.js';
import { TERRAIN_CUES } from '../render/MaterialLibrary.js';
import { QUALITY, setQuality } from '../render/Quality.js';

const PARTS = [['head', 'Head', 'Z'], ['torso', 'Torso', 'X'], ['armL', 'L Arm', 'C'], ['armR', 'R Arm', 'V'], ['legs', 'Legs', 'G']];
const pct = v => `${Math.round(v * 100)}%`;
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export class Hud {
    constructor(root, game) {
        this.root = root; this.game = game;
        root.innerHTML = `
            <div class="topbar">
                <div class="map-marks" aria-label="Map markers">${['red','blue','green'].map(c=>`<button data-act="mark" data-arg="${c}" aria-label="Mark ${c} block" title="Mark ${c} block · click again on the same block to clear" style="--mark:${c==='red'?'#ff4949':c==='blue'?'#4c9cff':'#56ef93'}">!</button>`).join('')}</div>
                <div class="turnbox"><div class="round"></div><div class="phase"></div><div class="objstat hidden"></div><button data-act="endTurn" class="endturn" title="End turn (Enter)">END TURN</button></div>
                <div class="tools"><button data-act="options" title="Settings" aria-label="Settings">${ICONS.gear}</button></div>
            </div>
            <div class="camera-nav" aria-label="Camera controls">
                <button data-act="lvlUp" class="nav-up" title="Upper floor · Page Up" aria-label="Upper floor">${ICONS.up}</button>
                <button data-act="rotL" class="nav-left" title="Rotate left · Q" aria-label="Rotate left">${ICONS.rotL}</button>
                <span class="nav-cube" aria-hidden="true">${ICONS.cube}</span>
                <button data-act="rotR" class="nav-right" title="Rotate right · E" aria-label="Rotate right">${ICONS.rotR}</button>
                <button data-act="lvlDown" class="nav-down" title="Lower floor · Page Down" aria-label="Lower floor">${ICONS.down}</button>
                <span class="floor-label">Roof</span>
            </div>
            <div class="squad"></div>
            <div class="unitpanel hidden"></div><div class="equipment-overlay hidden"></div><div class="aim-reticle hidden" aria-label="Weapon accuracy reticle"><i class="reticle-ring outer"></i><i class="reticle-ring inner"></i><i class="reticle-cross"></i><span></span></div>
            <div class="targets"></div>
            <div class="actionbar"><div class="slotname"></div><div class="slots"></div></div>
            <div class="target hidden"></div>
            <div class="panel hidden"></div>
            <div class="options hidden"></div>
            <div class="log"></div>
            <div class="banner"><div class="b1"></div><div class="b2"></div></div>
            <div class="toast"></div>
            <div class="cursortip hidden"></div>
            <div class="enemyturn hidden"><i></i>ENEMY ACTIVITY</div>
            <div class="outcome hidden"></div>
            `;
        this.el = sel => root.querySelector(sel);

        root.addEventListener('click', e => this.onClick(e));
        root.addEventListener('mouseover', e => { const b = e.target.closest('.slot'); if (b) this.el('.slotname').innerHTML = b.dataset.tip || ''; });
        root.addEventListener('mouseout', e => { if (e.target.closest('.slot')) this.el('.slotname').innerHTML = this.activeSlotName || ''; });
        this.lines = [];
        this.slots = [];
        this.equipment=new EquipmentPanel(this.el('.equipment-overlay'),game);
        root.addEventListener('change',e=>{const k=e.target.dataset.setting;if(!k)return;const v=Number(e.target.value);game.options[k]=v;if(k==='turnSpeed')game.player.speed=v;if(k==='soundVolume')game.audio.setVolume(v);localStorage.setItem('tactics-settings',JSON.stringify(game.options));});
    }
    reset() { this.report = null; this.equipment.open=false;this.equipment.nested=null;this.equipment.selected=null;this.el('.outcome').classList.add('hidden'); this.hidePanel(); this.squadSpent(false); }
    onClick(e) {
        const b = e.target.closest('[data-act]');
        if (!b || b.disabled) return;
        const g = this.game, act = b.dataset.act, arg = b.dataset.arg;
        if(b.closest('.camera-nav'))b.blur();
        e.stopPropagation();
        switch (act) {
            case 'floorFollow': g.applyZoomCut();break;
            case 'chooseFloor': g.chooseFloor(arg==='roof'?Infinity:Number(arg));break;
            case 'inventory': this.equipment.toggle();break;
            case 'mark': g.setMode({kind:'mark',color:arg});break;
            case 'fireMode': {const u=g.selectedUnit(),w=WEAPONS[u.weapon],modes=fireModes(w);g.intent({type:'setFireMode',mode:modes[(modes.indexOf(fireMode(u,w))+1)%modes.length]});break;}
            case 'equipmentTab': this.equipmentTab=arg;break;
            case 'view': g.cameraDirector.end();g.scene.rig.setPreset(arg); break;
            case 'pan': g.scene.rig.glide=null;g.scene.rig.moveBy(...arg.split(',').map(Number));break;
            case 'tilt': g.cameraDirector.end();g.scene.rig.orbit(0,Number(arg)*40);break;
            case 'home': g.focusUnit(g.selectedUnit());break;
            case 'weapon': this.chooseWeapon(arg);break;
            case 'reloadWeapon': g.intent({type:'reload',weaponId:arg});break;
            case 'item': this.hidePanel();g.setMode({kind:THROWABLES[arg].kind==='gadget'?'gadget':THROWABLES[arg].placed?'breach':'throw',itemId:arg});if(THROWABLES[arg].placed)this.showBreachPanel();break;
            case 'equip': g.intent({type:'switchWeapon',weaponId:arg}); break;
            case 'rotL': g.cameraDirector.end();g.scene.rotate(-1); break; case 'rotR': g.cameraDirector.end();g.scene.rotate(1); break;
            case 'lvlUp': g.changeLevel(1); break; case 'lvlDown': g.changeLevel(-1); break;
            case 'debug': g.debug.toggle(); break;
            case 'options': this.toggleOptions(); break;
            case 'opt': g.options[arg] = !g.options[arg];localStorage.setItem('tactics-settings',JSON.stringify(g.options)); this.renderOptions(); break;
            case 'lighting': g.scene.setLighting(arg); g.options.lighting = arg; this.renderOptions(); break;
            case 'ao': g.scene.setAO(!g.scene.ao); this.renderOptions(); break;
            case 'proj': g.scene.toggleProjection(); this.renderOptions(); break;
            case 'quality': if (arg !== QUALITY.name) setQuality(arg); break;
            case 'cue': TERRAIN_CUES[arg].value = TERRAIN_CUES[arg].value ? 0 : 1; this.renderOptions(); break;
            case 'menu': g.exitToMenu(); break;
            case 'select': g.select(arg); break;
            case 'slot': this.runSlot(+arg); break;
            case 'target': g.targetById(arg); break;
            case 'part': g.setAimPart(arg); break;
            case 'fire': g.confirmFire(); break;
            case 'captureAim': g.captureAim(); break;
            case 'nextTarget': g.cycleTarget(1); break;
            case 'cancel': g.cancel(); break;
            case 'formTpl': g.declareFormation(arg); this.hidePanel(); break;
            case 'doBreach': { const [i, entry] = arg.split(':'); g.doBreach(+i, entry); this.hidePanel(); break; }
            case 'buildingCycle': g.cycleBuildingView(); break;
            case 'buildingView': g.setBuildingView(arg); break;
            case 'endTurn': g.endTurn(); break;
            case 'closePanel': this.hidePanel(); break;
            case 'restart': g.restart(); break;
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
    hidePanel() { this.el('.panel').classList.add('hidden'); }
    toggleOptions() { this.el('.options').classList.toggle('hidden'); this.renderOptions(); }
    renderOptions() {
        const g = this.game, o = g.options, el = this.el('.options');
        if (el.classList.contains('hidden')) return;
        const row = (k, label) => `<button data-act="opt" data-arg="${k}" class="${o[k] ? 'on' : ''}">${o[k] ? '☑' : '☐'} ${label}</button>`;
        el.innerHTML = `<h3>Settings <button data-act="options">✕</button></h3><h4>Gameplay</h4><label>Turn / animation speed<select data-setting="turnSpeed">${[.5,1,1.5,2,3].map(n=>`<option value="${n}" ${Number(o.turnSpeed||1)===n?'selected':''}>${n}×</option>`).join('')}</select></label><label>Camera rotation<select data-setting="rotateSpeed">${[.5,1,1.5,2].map(n=>`<option value="${n}" ${Number(o.rotateSpeed||1)===n?'selected':''}>${n}×</option>`).join('')}</select></label>${row('confirmMoves','Confirm movement destinations')}${row('showEnemyBars','Show enemy health')}<label>Aim sensitivity<select data-setting="aimSensitivity">${[.25,.5,.75,1].map(n=>`<option value="${n}" ${Number(o.aimSensitivity??.5)===n?'selected':''}>${n}×</option>`).join('')}</select></label>${row('aimSway','Reticle breathing')}<button data-act="debug">Test / debug tools (F1)</button><button data-act="inventory">Equipment and body status (I)</button><button data-act="menu">Return to menu</button>${row('autoEndTurn', 'Auto end turn when the squad is spent')}${row('autoNext', 'Auto-select the next ready soldier')}${row('followCamera', 'Camera follows actions')}
            <h4>Audio</h4><label>Sound effects volume<input type="range" data-setting="soundVolume" min="0" max="1" step="0.05" value="${o.soundVolume ?? 0.65}" aria-label="Sound effects volume"></label>
            <h4>Camera</h4>${row('edgeScroll', 'Screen-edge scrolling')}<button data-act="proj" class="${g.scene.projection === 'ortho' ? 'on' : ''}">${g.scene.projection === 'ortho' ? '☑' : '☐'} Isometric (orthographic) view (V)</button>
            <div class="camhint" style="font-size:11px;opacity:.7;line-height:1.5;margin:4px 0 2px">WASD / arrows / screen edge pan · right-drag grab · middle-drag orbit · wheel zoom · Q/E rotate · H / Home centre on soldier · V isometric</div>
            <h4>Buildings</h4><div class="row"><button data-act="buildingCycle" class="${o.buildingView==='exterior'?'on':''}" aria-pressed="${o.buildingView==='exterior'}">Show outside only</button></div><small>Wheel zoom: roof → upper floors → ground floor. Selected floors stay fixed while zooming. Auto floors restores zoom cutaways. Use the cube arrows for floor changes. I opens equipment.</small>
            <h4>Graphics</h4><button data-act="quality" data-arg="mobile" class="${QUALITY.name === 'mobile' ? 'on' : ''}">${QUALITY.name === 'mobile' ? '◉' : '○'} Mobile (light textures, fast)</button><button data-act="quality" data-arg="high" class="${QUALITY.name === 'high' ? 'on' : ''}">${QUALITY.name === 'high' ? '◉' : '○'} High (full textures, AO) — reloads</button>
            <h4>Readability</h4><button data-act="cue" data-arg="uGrid" class="${TERRAIN_CUES.uGrid.value ? 'on' : ''}">${TERRAIN_CUES.uGrid.value ? '☑' : '☐'} Debug tile grid</button><button data-act="cue" data-arg="uRim" class="${TERRAIN_CUES.uRim.value ? 'on' : ''}">${TERRAIN_CUES.uRim.value ? '☑' : '☐'} Ledge rims (orange = 2+ drop)</button><button data-act="ao" class="${g.scene.ao ? 'on' : ''}">${g.scene.ao ? '☑' : '☐'} Ambient occlusion</button>
            <h4>Lighting</h4><div class="row">${['day', 'dusk', 'night'].map(l => `<button data-act="lighting" data-arg="${l}" class="${g.scene.lightingName === l ? 'on' : ''}">${l}</button>`).join('')}</div>`;
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
        this.bannerTimer = setTimeout(() => { b.className = `banner ${cls || ''}`; }, 1500);
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
    /** Build the ability slots for a unit (also used by number keys). */
    slotsFor(u) {
        const b = this.game.battle, mode = this.game.mode, s = [];
        const ap = u.ap,w=WEAPONS[u.weapon];
        s.push({act:w.kind==='melee'?'melee':'weapon',arg:w.id,group:'weapon',icon:weaponIcon(w),name:w.kind==='melee'?'Melee':'Shoot',cost:String(b.shotAp(u,w)),sub:w.ammo?`${u.ammo[w.id]||0} − ${reserveAmmo(u,w)} · ${fireMode(u,w).toUpperCase()}`:'',on:mode.kind==='shoot',disabled:ap<b.shotAp(u,w)||(w.ammo&&u.ammo[w.id]<1),tip:`${w.name} · move the reticle (Tab snaps to an enemy) · Space fires`});
        const ow = WEAPONS[watchWeapon(u)];
        if (ow) s.push({ group:'weapon',act: 'overwatch', icon: ICONS.overwatch, name: 'Overwatch', cost: 'all', disabled: ap < ow.ap || (u.ammo[ow.id] ?? 0) < (ow.perShot || 1), on: mode.kind === 'overwatch', tip: '<b>Overwatch</b> · choose direction · all AP · <span style="color:#5ff2d6">Teal ≥65%</span> / <span style="color:#ffb347">Amber &lt;65%</span> estimated hit' });
        s.push({act:'reload',icon:ICONS.reload,name:'Reload',group:'weapon',cost:'1',disabled:w.boltAction||!w.ammo||ap<w.reloadAp||u.ammo[w.id]>=w.ammo||reserveAmmo(u,w)<1,tip:w.boltAction?'Bolt cycles loose rounds automatically':'Reload from carried loose rounds'});
        if(Object.values(u.items).some(n=>n>0))s.push({act:'grenades',group:'equipment',icon:ICONS.grenade,name:'Gear',cost:'',tip:'Grenades and medical equipment'});
        for (const a of [...u.abilities.filter(id=>!ABILITIES[id].intel||b.intelMode), ...(b.intelMode?[b.supportChoices[u.owner]||'carpet_bomb']:[])]) { const ab = ABILITIES[a]; s.push({group:ab.support||a==='rally'?'commander':['brace','demolish','suppress'].includes(a)?'equipment':'augmentation', act: 'ability', arg: a, icon: ICONS[a] || ICONS.ability, name: ab.name, on: mode.abilityId === a || (a === 'suppress' && !!mode.suppress), cost: `${ab.ap || 0}`, sub: `${ab.wp} WP`, disabled: (ab.support && (!b.detected || (b.personalTurns[u.owner]||0)<(b.supportReady[u.owner]||0))) || u.will < ab.wp || ap < (ab.ap || 0) || u.statuses.some(s => s.id === 'panicked') || (a === 'suppress' && (u.ammo.repeater ?? 0) < (WEAPONS.repeater.perShot || 1)), tip: `<b>${ab.name}</b> · ${ab.wp} Will${ab.ap ? ` · ${ab.ap} AP` : ''}<br>${esc(ab.text)}` }); }
        if(!b.intelMode){const wait=Math.max(0,(b.strikeReadyAt??1)-b.round);s.push({act:'ability',arg:'killstreak_strike',group:'commander',icon:ICONS.ability,name:'Strike',cost:wait?`IN ${wait}`:'READY',disabled:wait>0,tip:wait?`Commander strike · recharging, ready in ${wait} round${wait>1?'s':''}`:'Commander strike · ready · recharges 10 rounds after use'});}
        const f = b.formations.of(u);
        if (f) s.push({ group:'commander',act: 'formBreak', arg: f.id, icon: ICONS.formation, name: `Break ${FORMATIONS[f.template].name}`, cost: '0', tip: 'Dissolve the formation' });
        s.push(f && f.template !== 'crossfire'
            ? { group:'commander',act: 'formation', icon: ICONS.formation, name: 'Switch', cost: '0', tip: '<b>Switch formation</b> (F) · same members, new shape (no AP). Click a highlighted spot to trade places for free.' }
            : !f ? { group:'commander',act: 'formation', icon: ICONS.formation, name: 'Formation', cost: '0', tip: '<b>Formation</b> (F) · plan slots, then assemble your squad' } : null);
        if (!s.at(-1)) s.pop();
        if (b.breachPoints(u).length) s.push({ act: 'breach', icon: ICONS.breach, name: 'Breach', cost: '1', tip: '<b>Breach</b> (B) · stack up and storm the room; one free shot each' });
        const o = b.objective;
        if (o?.kind === 'recover' && !o.item.carrier && !o.item.secured && Math.max(Math.abs(o.item.x - u.x), Math.abs(o.item.y - u.y)) <= 1 && Math.abs(o.item.z - u.z) <= 1)
            s.push({ act: 'recover', icon: ICONS.ability, name: `Take ${o.item.label}`, cost: '1', disabled: ap < 1, tip: `<b>Recover</b> · 1 AP · pick up the ${esc(o.item.label.toLowerCase())}${o.zone ? ' — then get it to the extraction zone' : ''}` });
        if (o && extractionOpen(o) && inZone(o.zone, u))
            s.push({ act: 'extract', icon: ICONS.ability, name: 'Extract', cost: '1', disabled: ap < 1, tip: '<b>Extract</b> · 1 AP · leave the map from the extraction zone' });
        const door=this.game.nearestDoor(u);
        if(door) { const closed=b.store.get(door.x,door.y,door.z+1)===MAT.door; s.push({act:'door',icon:ICONS.door,name:closed?'Kick door':'Close door',cost:'1',disabled:ap<1,tip:closed?'Kick open the adjacent door · 1 AP · reveal the room':'Close the adjacent door · 1 AP'}); }
        s.push({act:'wait',icon:ICONS.overwatch,name:'Finish soldier',cost:'all',disabled:ap+u.moveOnlyAp<=0,tip:'Spend remaining AP and select the next ready soldier. End Turn starts the enemy phase.'});
        const groups=['weapon','equipment','augmentation','commander'];
        return s.sort((a,b)=>groups.indexOf(a.group||'equipment')-groups.indexOf(b.group||'equipment'));
    }
    runSlot(i) {
        const s = this.slots[i], g = this.game; if (!s || s.disabled) return;
        const u = g.selectedUnit(); if (!u) return;
        switch (s.act) {
            case 'grenades':this.showGearPanel();break;
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
    tick() {}
    refresh() {
        const g = this.game, b = g.battle;
        if (!b) return;
        this.el('.floor-label').textContent=navigationFloors(b.mission).find(f=>f.cut===g.cutLevel)?.label||'Roof';
        for(const button of this.root.querySelectorAll('[data-act="mark"]')){const active=g.mode.kind==='mark'&&g.mode.color===button.dataset.arg;button.classList.toggle('on',active);button.setAttribute('aria-pressed',String(active));}
        this.root.classList.toggle('enemy-phase', b.activeSide !== 'player');
        this.root.classList.toggle('intel-mode',b.intelMode);
        this.el('.turnbox .objstat').textContent = objectiveStatus(b.objective, id => b.unit(id)?.name || id);
        this.el('.round').textContent = b.asyncCoop ? `ENEMY BEAT ${b.round} · YOUR TURN ${(b.personalTurns[g.session.local?'player':g.session.playerId]||0)+1}` : `ROUND ${b.round}`;
        this.el('.endturn').textContent=b.asyncCoop?'END MY TURN':'END TURN';
        const phase = this.el('.phase');
        phase.textContent = b.outcome ? 'MISSION OVER' : b.activeSide === 'player' ? (b.asyncCoop ? 'INDEPENDENT TURNS' : 'SQUAD PHASE') : 'ENEMY ACTIVITY';
        phase.className = `phase ${b.activeSide}`;
        this.el('.enemyturn').classList.toggle('hidden', !(b.activeSide !== 'player' && !b.outcome && !g.debug.manualEnemy));
        // Squad column.
        this.el('.squad').innerHTML = b.units.filter(u=>u.side==='player').map((u,i)=>`<button class="squad-head ${u.id===g.selected?'sel':''} ${u.dead?'dead':''}" data-act="select" data-arg="${u.id}" aria-label="Select ${esc(u.name)}" title="${esc(u.name)} · ${u.hp}/${u.maxHp} HP · ${u.ap} AP"><img src="${portraitSrc(u)}" alt="${esc(u.name)}"><b>${u.hp}<small>/${u.maxHp}</small></b><span>${u.dead?'KIA':`${u.ap} AP`}</span>${u.overwatch?'<em>WATCH</em>':''}${!u.dead&&b.flankedBy(u).length?'<i class="flank-alert" title="Flanked by a visible enemy">!</i>':''}</button>`).join('')+`<button class="inventory-toggle" data-act="inventory" aria-label="Open inventory">${ICONS.backpack}<kbd>I</kbd></button>`;
        const u=g.selectedUnit();this.equipment.render(u);
        // Ability bar.
        const canAct = u && g.controllable(u) && !b.outcome && !g.aiRunning;
        this.slots = canAct ? this.slotsFor(u) : [];
        this.el('.slots').innerHTML = this.slots.map((s, i) => `<button class="slot ${s.on ? 'on' : ''} ${i>0&&s.group!==this.slots[i-1].group?'group-start':''}" aria-label="${esc(s.name)}" data-act="slot" data-arg="${i}" ${s.disabled ? 'disabled' : ''} data-tip="${esc(s.tip || s.name)}">
            <kbd>${i < 9 ? i + 1 : ''}</kbd>${s.icon}<span class="slot-label">${esc(s.name)}</span><span class="cost">${s.cost}</span>${s.sub ? `<span class="sub">${s.sub}</span>` : ''}</button>`).join('');
        if(u&&fireModes(WEAPONS[u.weapon]).length>1)this.el('.slots').insertAdjacentHTML('afterbegin',`<button class="mode-switch" data-act="fireMode" aria-label="Change fire mode">${fireMode(u,WEAPONS[u.weapon]).toUpperCase()} ↻</button>`);
        const active = this.slots.find(s => s.on);
        this.activeSlotName = active ? active.tip : (u && canAct ? `<b>${esc(u.name)}</b> · ${modeText(g.mode)}` : (b.activeSide !== 'player' ? '' : 'Select a soldier'));
        this.el('.slotname').innerHTML = this.activeSlotName;
        this.el('.actionbar').classList.toggle('hidden', !(b.activeSide === 'player' || g.debug.manualEnemy) || !!b.outcome);
        this.renderTargets();
        this.renderTarget();
    }
    renderTargets() {
        const g = this.game, u = g.selectedUnit(), el = this.el('.targets');
        if (!u || !g.controllable(u) || g.battle.outcome) { el.innerHTML = ''; return; }
        const list = g.targetsFor(u, g.mode.weaponId || watchWeapon(u));
        const cur = g.targetInfo?.target?.id;
        el.innerHTML = list.map(t => {
            return `<button class="tgt ${cur === t.id ? 'on' : ''}" data-act="target" data-arg="${t.id}" title="${esc(t.name)}"><img src="${portraitSrc(t)}" alt="${esc(t.name)}"></button>`;
        }).join('');
    }
    renderTarget(){
        const g=this.game,t=g.targetInfo,el=this.el('.target');
        if(g.mode.kind!=='shoot'){el.classList.add('hidden');return;}
        el.classList.remove('hidden');
        const u=g.selectedUnit(),w=WEAPONS[g.mode.weaponId],locked=g.aimPointer?.locked;
        const cost=t?.ap??(u&&w?g.battle.shotAp(u,w):0);
        el.innerHTML=`<header><b>${t?esc(t.target.name):'Free aim'}</b><span>${t?`${t.target.hp}/${t.target.maxHp} HP · ${t.distance.toFixed(1)} M`:'No target in range'}</span></header>
            ${t?`<div class="parts">${PARTS.map(([k,label,key])=>`<button data-act="part" data-arg="${k}" class="${t.part===k?'on':''}"><b>${label} <kbd>${key}</kbd></b><small>${t.target.parts[k].hp}/${t.target.parts[k].max} · ARM ${t.target.parts[k].armor}</small></button>`).join('')}</div>`:''}
            <p>${t?.blocked>.5?'Cover intercepts this angle. ':''}${locked?'Mouse captured · move to aim · click / Space to fire · wheel to zoom · Esc releases mouse':g.aimPointer?.unavailable?'Mouse capture is unavailable here. Drag in the scene or use arrow keys to aim; Space fires; wheel zooms.':'Select a target portrait to focus, or capture the mouse to aim freely.'}</p>
            <div class="tbtns">${g.targets?.length?'<button data-act="nextTarget">Next target <kbd>Tab</kbd></button>':''}${!locked?'<button data-act="captureAim">Aim with mouse</button>':''}</div>
            <div class="tbtns"><button data-act="cancel">${locked?'Release mouse':'Back'}</button><button data-act="fire">Fire · ${cost} AP <kbd>Space</kbd></button></div>`;
    }
    showGearPanel(){const u=this.game.selectedUnit(),p=this.el('.panel');p.classList.remove('hidden');p.innerHTML=`<h3>Equipment <button data-act="closePanel">✕</button></h3><div class="gear-quick">${Object.entries(u.items).filter(([id,n])=>n>0&&THROWABLES[id]).map(([id,n])=>`<button data-act="item" data-arg="${id}">${ICONS.grenade}<b>${esc(THROWABLES[id].name)}</b><small>${n} carried · ${THROWABLES[id].ap} AP</small></button>`).join('')}</div>`;}
    showFormationPanel() {
        const p=this.el('.panel');p.classList.toggle('hidden');if(p.classList.contains('hidden'))return;
        const cur=this.game.battle?.formations.of(this.game.selectedUnit());
        p.innerHTML=`<h3>Formation <button data-act="closePanel">✕</button></h3><p>${cur?`Switch the ${esc(FORMATIONS[cur.template].name)} to another shape (no AP, same members). Wide shapes cannot enter narrow spaces; switch to a file or break the formation there. Select a member and click a highlighted spot to trade places for free.`:'Choose a formation, then move at least one teammate onto a highlighted slot. Group movement uses the lowest remaining movement budget. Select a member and click a highlighted spot to trade places for free.'}</p>${Object.values(FORMATIONS).filter(f=>f.slots&&f.id!==cur?.template).map(f=>`<button data-act="formTpl" data-arg="${f.id}" class="wide"><b>${f.name}</b><small>${esc(f.text)}</small></button>`).join('')}`;
    }
    showBreachPanel() {
        const g = this.game, u = g.selectedUnit(); if (!u) return;
        const pts = g.battle.breachPoints(u);
        const stack = g.breachStack(u, pts[0]);
        const p = this.el('.panel'); p.classList.remove('hidden');
        const charge = g.battle.unitsOf(u.side).some(o => stack.includes(o.id) && o.items.breach_charge > 0);
        p.innerHTML = `<h3>Breach <button data-act="closePanel">✕</button></h3><p>Stack: ${stack.map(id => esc(g.battle.unit(id).name)).join(', ')} (1 AP each, one free shot each on entry; unalerted defenders are surprised).</p>` +
            pts.map((pt, i) => `<div class="bp">${pt.entry==='floor'?'Floor slab':'Door'} at ${pt.x},${pt.y}${pt.roomId!=null?' → room '+pt.roomId:''}
                ${pt.entry==='floor'?`<button data-act="doBreach" data-arg="${i}:floor">Floor charge · 2×2 hole</button>`:`<button data-act="doBreach" data-arg="${i}:door">Door entry</button>`}${pt.entry!=='floor'&&charge ? `<button data-act="doBreach" data-arg="${i}:charge">Breach charge</button>` : ''}</div>`).join('');
    }
    /** After-action report (every battle). The old outcome card is folded into its header. */
    showReport(report, { saved = true, canEdit = true } = {}) {
        this.report = report; this.reportOpts = { saved, canEdit, tab: this.reportOpts?.tab || 'squad' };
        const el = this.el('.outcome'); el.classList.remove('hidden');
        el.innerHTML = reportMarkup(report, this.reportOpts);
    }
    reportTab(tab) { if (!this.report) return; this.reportOpts.tab = tab; this.showReport(this.report, this.reportOpts); }
    async copyReport() {
        try { await navigator.clipboard.writeText(reportText(this.report)); this.toast('Report summary copied'); }
        catch { this.toast('Copy failed: clipboard not available', 'warn'); }
    }
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
        case 'shoot': return `${WEAPONS[m.weaponId]?.name} — move the reticle (Tab snaps to the next enemy), Space fires`;
        case 'melee': return 'melee — click an adjacent enemy';
        case 'gadget': return 'Medical kit — click an injured adjacent ally';
        case 'throw': return `throw ${THROWABLES[m.itemId].name} — click a tile`;
        case 'ability': return `${ABILITIES[m.abilityId]?.name} — click ${ABILITIES[m.abilityId]?.targeting === 'ally' ? 'an injured ally (self allowed)' : 'an empty visible tile'}`;
        case 'overwatch': return 'overwatch — click the direction to watch';
        case 'mark': return `click a block to mark ${m.color} · click it again to clear · Esc exits`;
        default: return 'click a tile to move · <span class="blue">blue</span> keeps an action · <span class="yellow">yellow</span> is a dash';
    }
}
export { alive };
