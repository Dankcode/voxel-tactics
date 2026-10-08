// DOM HUD in the XCOM 2 layout: turn indicator on top, squad column on the left, the selected soldier's
// panel bottom-left, the ability bar bottom-centre with numbered slots, enemy target icons above it, the
// target panel (Phoenix Point body-part aim) on the right, banners, toasts, a cursor tooltip and the log.
import { WEAPONS, THROWABLES } from '../../../shared/content/weapons.js';
import { ABILITIES, CLASSES, ENEMIES } from '../../../shared/content/units.js';
import { FORMATIONS } from '../../../shared/content/formations.js';
import { alive } from '../../../shared/battle/Units.js';
import { ICONS } from './Icons.js';
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
                <div class="mission"><b></b><span></span></div>
                <div class="turnbox"><div class="round"></div><div class="phase"></div></div>
                <div class="tools">
                    <button data-act="rotL" title="Rotate camera (Q) · middle-drag to orbit">${ICONS.rotL}</button><button data-act="rotR" title="Rotate camera (E) · middle-drag to orbit">${ICONS.rotR}</button>
                    <button data-act="lvlDown" title="Cutaway down (PgDn)">${ICONS.down}</button><span class="level"></span><button data-act="lvlUp" title="Cutaway up (PgUp)">${ICONS.up}</button>
                    <button data-act="cutins" class="cutin-mode" title="Back-shot cut-ins"></button>
                    <button data-act="options" title="Options">${ICONS.gear}</button>
                    <button data-act="debug" class="debug-btn" title="Debug mode (F1)">${ICONS.bug}</button>
                    <button data-act="menu" title="Menu">${ICONS.menu}</button>
                </div></div>
            <div class="squad"></div>
            <div class="unitpanel hidden"></div>
            <div class="targets"></div>
            <div class="actionbar"><div class="slotname"></div><div class="slots"></div><button data-act="endTurn" class="endturn" title="End turn (Enter)"><span>END TURN</span><kbd>⏎</kbd></button></div>
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
    }
    reset() { this.el('.outcome').classList.add('hidden'); this.hidePanel(); this.squadSpent(false); }
    onClick(e) {
        const b = e.target.closest('[data-act]');
        if (!b || b.disabled) return;
        const g = this.game, act = b.dataset.act, arg = b.dataset.arg;
        e.stopPropagation();
        switch (act) {
            case 'rotL': g.scene.rotate(-1); break; case 'rotR': g.scene.rotate(1); break;
            case 'lvlUp': g.changeLevel(1); break; case 'lvlDown': g.changeLevel(-1); break;
            case 'cutins': g.cycleCutins(); break;
            case 'debug': g.debug.toggle(); break;
            case 'options': this.toggleOptions(); break;
            case 'opt': g.options[arg] = !g.options[arg]; this.renderOptions(); break;
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
            case 'cancel': g.cancel(); break;
            case 'formTpl': g.declareFormation(arg); this.hidePanel(); break;
            case 'doBreach': { const [i, entry] = arg.split(':'); g.doBreach(+i, entry); this.hidePanel(); break; }
            case 'endTurn': g.endTurn(); break;
            case 'closePanel': this.hidePanel(); break;
            case 'restart': g.restart(); break;
        }
        this.refresh();
    }
    hidePanel() { this.el('.panel').classList.add('hidden'); }
    toggleOptions() { this.el('.options').classList.toggle('hidden'); this.renderOptions(); }
    renderOptions() {
        const g = this.game, o = g.options, el = this.el('.options');
        if (el.classList.contains('hidden')) return;
        const row = (k, label) => `<button data-act="opt" data-arg="${k}" class="${o[k] ? 'on' : ''}">${o[k] ? '☑' : '☐'} ${label}</button>`;
        el.innerHTML = `<h4>Options</h4>${row('autoEndTurn', 'Auto end turn when the squad is spent')}${row('autoNext', 'Auto-select the next ready soldier')}${row('followCamera', 'Camera follows actions')}
            <h4>Camera</h4>${row('edgeScroll', 'Screen-edge scrolling')}<button data-act="proj" class="${g.scene.projection === 'ortho' ? 'on' : ''}">${g.scene.projection === 'ortho' ? '☑' : '☐'} Isometric (orthographic) view (V)</button>
            <div class="camhint" style="font-size:11px;opacity:.7;line-height:1.5;margin:4px 0 2px">WASD / arrows / screen edge pan · right-drag grab · middle-drag orbit · wheel zoom · Q/E rotate · H / Home centre on soldier · V isometric</div>
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
        el.style.transform = `translate(${x + 18}px, ${y + 14}px)`;
    }
    /** Build the ability slots for a unit (also used by number keys). */
    slotsFor(u) {
        const b = this.game.battle, mode = this.game.mode, s = [];
        const ap = u.ap;
        u.weapons.forEach(id => {
            const w = WEAPONS[id];
            if (w.kind === 'melee') s.push({ act: 'melee', arg: id, icon: ICONS.melee, name: w.name, cost: `${w.ap}`, disabled: ap < w.ap, on: mode.kind === 'melee' && mode.weaponId === id, tip: `<b>${w.name}</b> · ${w.ap} AP · melee an adjacent enemy` });
            else {
                const empty = (u.ammo[id] ?? 0) < (w.perShot || 1);
                s.push({ act: 'weapon', arg: id, icon: w.spread > 4 ? ICONS.shotgun : (w.range >= 14 ? ICONS.rifle : ICONS.fire), name: w.name, cost: `${b.shotAp(u, w)}`, sub: `${u.ammo[id] ?? 0}/${w.ammo}`, disabled: ap < b.shotAp(u, w) || empty,
                    on: mode.kind === 'shoot' && mode.weaponId === id && !mode.suppress, tip: `<b>${w.name}</b> · ${b.shotAp(u, w)} AP · ${w.damage} dmg${w.projectiles > 1 ? ` ×${w.projectiles}` : ''} · range ${w.range}${empty ? ' · <i class="flank">EMPTY — reload</i>' : ''}` });
            }
        });
        for (const [id, n] of Object.entries(u.items)) if (n > 0) { const t = THROWABLES[id]; s.push({ act: 'throw', arg: id, icon: ICONS.grenade, name: t.name, cost: `${t.ap}`, sub: `×${n}`, disabled: ap < t.ap, on: mode.kind === 'throw' && mode.itemId === id, tip: `<b>${t.name}</b> · ${t.ap} AP · radius ${t.radius}${t.element ? ` · ${t.element}` : ''}` }); }
        const ow = WEAPONS[u.weapons.find(id => WEAPONS[id].kind === 'ballistic')];
        if (ow) s.push({ act: 'overwatch', icon: ICONS.overwatch, name: 'Overwatch', cost: 'all', disabled: ap < ow.ap, on: mode.kind === 'overwatch', tip: '<b>Overwatch</b> · spend the rest of your AP to fire at the first enemy that moves in your cone' });
        if (ow?.ammo) s.push({ act: 'reload', icon: ICONS.reload, name: 'Reload', cost: `${ow.reloadAp}`, disabled: ap < ow.reloadAp || u.ammo[ow.id] === ow.ammo, tip: `<b>Reload</b> · ${ow.reloadAp} AP` });
        for (const a of u.abilities) { const ab = ABILITIES[a]; s.push({ act: 'ability', arg: a, icon: ICONS[a] || ICONS.ability, name: ab.name, cost: `${ab.ap || 0}`, sub: `${ab.wp} WP`, disabled: u.will < ab.wp || ap < (ab.ap || 0), tip: `<b>${ab.name}</b> · ${ab.wp} Will${ab.ap ? ` · ${ab.ap} AP` : ''}<br>${esc(ab.text)}` }); }
        const f = b.formations.of(u);
        s.push(f ? { act: 'formBreak', arg: f.id, icon: ICONS.formation, name: `Break ${FORMATIONS[f.template].name}`, cost: '0', tip: 'Dissolve the formation' }
            : { act: 'formation', icon: ICONS.formation, name: 'Formation', cost: '1', tip: '<b>Formation</b> (F) · Shield Line, Breach Stack, Crossfire' });
        if (b.breachPoints(u).length) s.push({ act: 'breach', icon: ICONS.breach, name: 'Breach', cost: '1', tip: '<b>Breach</b> (B) · stack up and storm the room; one free shot each' });
        if (this.game.nearestDoor(u)) s.push({ act: 'door', icon: ICONS.door, name: 'Door', cost: '0', tip: 'Open / close the adjacent door' });
        return s;
    }
    runSlot(i) {
        const s = this.slots[i], g = this.game; if (!s || s.disabled) return;
        const u = g.selectedUnit(); if (!u) return;
        switch (s.act) {
            case 'weapon': g.setMode(g.mode.kind === 'shoot' && g.mode.weaponId === s.arg ? { kind: 'move' } : { kind: 'shoot', weaponId: s.arg }); break;
            case 'melee': g.setMode({ kind: 'melee', weaponId: s.arg }); break;
            case 'throw': g.setMode({ kind: 'throw', itemId: s.arg }); break;
            case 'overwatch': g.setMode({ kind: 'overwatch' }); break;
            case 'reload': g.intent({ type: 'reload' }); break;
            case 'ability': g.useAbility(s.arg); break;
            case 'formation': this.showFormationPanel(); break;
            case 'formBreak': g.intent({ type: 'formation_break', formationId: s.arg }); break;
            case 'breach': this.showBreachPanel(); break;
            case 'door': g.toggleNearestDoor(); break;
        }
        this.refresh();
    }
    triggerSlot(n) { this.runSlot(n - 1); }
    tick() {}
    refresh() {
        const g = this.game, b = g.battle;
        if (!b) return;
        this.root.classList.toggle('enemy-phase', b.activeSide !== 'player');
        this.el('.mission b').textContent = b.mission.name;
        this.el('.mission span').textContent = b.mission.objective?.text || '';
        this.el('.round').textContent = `ROUND ${b.round}`;
        const phase = this.el('.phase');
        phase.textContent = b.outcome ? 'MISSION OVER' : b.activeSide === 'player' ? 'SQUAD PHASE' : 'ENEMY ACTIVITY';
        phase.className = `phase ${b.activeSide}`;
        this.el('.enemyturn').classList.toggle('hidden', !(b.activeSide !== 'player' && !b.outcome && !g.debug.manualEnemy));
        this.el('.level').textContent = Number.isFinite(g.cutLevel) ? `L${Math.round((g.cutLevel - 1) / 3)}` : 'ALL';
        this.el('.cutin-mode').textContent = `BACK SHOT · ${g.cutins.mode.toUpperCase()}`;
        this.el('.debug-btn').classList.toggle('on', g.debug.enabled);
        // Squad column.
        this.el('.squad').innerHTML = b.units.filter(u => u.side === 'player').map((u, i) => {
            const f = b.formations.of(u);
            const done = alive(u) && b.activeSide === 'player' && !g.canStillAct(u);
            return `<div class="card ${u.id === g.selected ? 'sel' : ''} ${u.dead ? 'dead' : ''} ${done ? 'done' : ''}" data-act="select" data-arg="${u.id}">
                <img src="/assets/characters/${u.art}/portrait.png" alt="">
                <div class="info"><div class="name">${esc(u.name)} <span class="owner">${u.owner !== 'player' ? esc(u.owner) : ''}</span></div>
                <div class="hp seg">${segs(u.hp, u.maxHp)}</div>
                <div class="pips">${pips(u.ap + u.moveOnlyAp, u.maxAp, 'ap')}${u.overwatch ? `<em class="ow">${ICONS.overwatch}</em>` : ''}${f ? `<em class="form">${FORMATIONS[f.template].name}</em>` : ''}</div></div>
                ${done ? '<div class="donetag">DONE</div>' : ''}${u.dead ? '<div class="donetag kia">KIA</div>' : ''}</div>`;
        }).join('');
        // Selected soldier panel.
        const u = g.selectedUnit();
        const up = this.el('.unitpanel');
        if (u) {
            up.classList.remove('hidden');
            const def = CLASSES[u.type] || ENEMIES[u.type] || {};
            const w = WEAPONS[u.weapon];
            up.innerHTML = `<img src="/assets/characters/${u.art}/portrait.png" alt="">
                <div class="uinfo"><div class="uname">${esc(u.name)}</div><div class="uclass">${esc(def.name || u.type)}${u.side === 'enemy' ? ' · <i class="flank">HOSTILE (debug)</i>' : ''}</div>
                <div class="hp seg big">${segs(u.hp, u.maxHp)}</div><div class="nums"><span>HP ${Math.max(0, u.hp)}/${u.maxHp}</span><span>AP ${u.ap}${u.moveOnlyAp ? `+${u.moveOnlyAp}` : ''}/${u.maxAp}</span><span>WILL ${u.will}/${u.maxWill}</span></div>
                <div class="pips">${pips(u.ap + u.moveOnlyAp, u.maxAp, 'ap big')}</div>
                <div class="stress" title="Stress ${u.stress}/100"><i style="width:${u.stress}%"></i></div>
                <div class="tags">${w ? `<span class="wpn">${esc(w.name)} ${w.ammo ? `${u.ammo[w.id] ?? 0}/${w.ammo}` : ''}</span>` : ''}${u.statuses.map(s => `<span>${s.id}</span>`).join('')}${Object.entries(u.parts).filter(([, p]) => p.disabled).map(([k]) => `<span class="dis">${k} ✕</span>`).join('')}${u.god ? '<span class="dbg">GOD</span>' : ''}</div></div>`;
        } else up.classList.add('hidden');
        // Ability bar.
        const canAct = u && g.controllable(u) && !b.outcome && !g.aiRunning;
        this.slots = canAct ? this.slotsFor(u) : [];
        this.el('.slots').innerHTML = this.slots.map((s, i) => `<button class="slot ${s.on ? 'on' : ''}" data-act="slot" data-arg="${i}" ${s.disabled ? 'disabled' : ''} data-tip="${esc(s.tip || s.name)}">
            <kbd>${i < 9 ? i + 1 : ''}</kbd>${s.icon}<span class="cost">${s.cost}</span>${s.sub ? `<span class="sub">${s.sub}</span>` : ''}</button>`).join('');
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
        const list = g.targetsFor(u, u.weapons.find(id => WEAPONS[id].kind === 'ballistic') || u.weapon);
        const cur = g.targetInfo?.target?.id;
        el.innerHTML = list.map(t => {
            const hit = cur === t.id && g.targetInfo ? pct(g.targetInfo.byPart[g.targetInfo.part] ?? 0) : '';
            return `<button class="tgt ${cur === t.id ? 'on' : ''}" data-act="target" data-arg="${t.id}" title="${esc(t.name)}"><img src="/assets/characters/${t.art}/portrait.png" alt=""><span>${hit}</span></button>`;
        }).join('');
    }
    renderTarget() {
        const g = this.game, t = g.targetInfo, el = this.el('.target');
        if (!t || g.mode.kind !== 'shoot') { el.classList.add('hidden'); return; }
        el.classList.remove('hidden');
        const u = t.target, w = WEAPONS[g.mode.weaponId];
        const main = t.byPart[t.part] ?? 0;
        el.innerHTML = `<div class="thead"><img src="/assets/characters/${u.art}/portrait.png" alt=""><div><div class="tname">${esc(u.name)}</div><div class="thp seg">${segs(u.hp, u.maxHp)}</div></div><div class="bigpct ${main < 0.35 ? 'low' : main < 0.65 ? 'mid' : 'high'}">${pct(main)}</div></div>
            <div class="tcover">${t.flanked ? '<b class="flank">FLANKED</b>' : `<b class="cov">${['NO COVER', 'HALF COVER', 'FULL COVER'][t.cover] || ''}</b>`} · ${t.distance.toFixed(1)} tiles${t.lean ? ` · lean ${t.lean}` : ''}${t.inRange ? '' : ' · <b class="flank">OUT OF RANGE</b>'}</div>
            <div class="parts">${PARTS.map(([k, label, key]) => `<button data-act="part" data-arg="${k}" class="${t.part === k ? 'on' : ''} ${u.parts[k].disabled ? 'dis' : ''}">
                <b>${label}</b><span>${pct(t.byPart[k] ?? 0)}</span><small>armor ${u.parts[k].armor} · ${u.parts[k].hp}/${u.parts[k].max}</small><kbd>${key}</kbd></button>`).join('')}</div>
            <div class="tsum">Any hit ${pct(t.anyHit)} · cover blocks ${pct(t.blocked)}${t.friendly > 0.01 ? ` · <b class="warn">friendly ${pct(t.friendly)}</b>` : ''}</div>
            <div class="mods">${t.mods.map(([k, v]) => `<span>${k} ×${v}</span>`).join('')}</div>
            <div class="tbtns"><button data-act="cancel" class="ghost">BACK <kbd>Esc</kbd></button><button data-act="fire" class="firebtn">${esc(w?.name?.toUpperCase() || 'FIRE')} · ${t.ap} AP <kbd>Space</kbd></button></div>`;
        this.renderTargets();
    }
    showFormationPanel() {
        const g = this.game, u = g.selectedUnit(); if (!u) return;
        const p = this.el('.panel'); p.classList.remove('hidden');
        p.innerHTML = `<h3>Formation <button data-act="closePanel">✕</button></h3><p>Leader: ${esc(u.name)}. Facing: toward the hovered tile (or camera forward). Nearby soldiers fill the slots; stragglers within 3 tiles move in for 1 AP.</p>` +
            Object.values(FORMATIONS).map(f => `<button data-act="formTpl" data-arg="${f.id}" class="wide"><b>${f.name}</b> (${f.min}–${f.max})<br><small>${esc(f.text)}</small></button>`).join('');
    }
    showBreachPanel() {
        const g = this.game, u = g.selectedUnit(); if (!u) return;
        const pts = g.battle.breachPoints(u);
        const stack = g.breachStack(u, pts[0]);
        const p = this.el('.panel'); p.classList.remove('hidden');
        const charge = g.battle.unitsOf(u.side).some(o => stack.includes(o.id) && o.items.breach_charge > 0);
        p.innerHTML = `<h3>Breach <button data-act="closePanel">✕</button></h3><p>Stack: ${stack.map(id => esc(g.battle.unit(id).name)).join(', ')} (1 AP each, one free shot each on entry; unalerted defenders are surprised).</p>` +
            pts.map((pt, i) => `<div class="bp">Door at ${pt.x},${pt.y} → room ${pt.roomId}
                <button data-act="doBreach" data-arg="${i}:door">Door entry</button>${charge ? `<button data-act="doBreach" data-arg="${i}:charge">Breach charge</button>` : ''}</div>`).join('');
    }
    showOutcome(o) {
        const el = this.el('.outcome'); el.classList.remove('hidden');
        const b = this.game.battle;
        const kills = b.units.filter(u => u.side === 'enemy' && u.dead).length;
        el.innerHTML = `<div class="ocard ${o.winner}"><h2>${o.winner === 'player' ? 'MISSION COMPLETE' : 'SQUAD LOST'}</h2>
            <div class="ostats"><div><b>${o.round}</b>rounds</div><div><b>${kills}</b>hostiles killed</div><div><b>${b.unitsOf('player').length}</b>soldiers standing</div><div><b>${b.stats.voxelsDestroyed}</b>voxels destroyed</div><div><b>${b.stats.breaches}</b>breaches</div></div>
            <button data-act="restart">REPLAY</button><button data-act="menu">MENU</button></div>`;
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
        case 'shoot': return `${WEAPONS[m.weaponId]?.name} — pick a target (Tab cycles, Z X C V G body part), Space fires`;
        case 'melee': return 'melee — click an adjacent enemy';
        case 'throw': return `throw ${THROWABLES[m.itemId].name} — click a tile`;
        case 'overwatch': return 'overwatch — click the direction to watch';
        default: return 'click a tile to move · <span class="blue">blue</span> keeps an action · <span class="yellow">yellow</span> is a dash';
    }
}
export { alive };
