// DOM HUD: top bar, squad cards, action bar, target panel (body-part hit chances), formation and breach
// panels, event log and the debug / balance panel.
import { WEAPONS, THROWABLES } from '../../../shared/content/weapons.js';
import { ABILITIES } from '../../../shared/content/units.js';
import { FORMATIONS } from '../../../shared/content/formations.js';
import { alive } from '../../../shared/battle/Units.js';

const PARTS = [['head', 'Head', 'Z'], ['torso', 'Torso', 'X'], ['armL', 'L Arm', 'C'], ['armR', 'R Arm', 'V'], ['legs', 'Legs', 'G']];
const pct = v => `${Math.round(v * 100)}%`;
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export class Hud {
    constructor(root, game) {
        this.root = root; this.game = game;
        root.innerHTML = `
            <div class="topbar"><div class="mission"></div><div class="turn"></div><div class="objective"></div>
                <div class="tools">
                    <button data-act="rotL" title="Rotate (Q)">⟲</button><button data-act="rotR" title="Rotate (E)">⟳</button>
                    <button data-act="lvlDown" title="Cutaway down (PgDn)">▼</button><span class="level"></span><button data-act="lvlUp" title="Cutaway up (PgUp)">▲</button>
                    <button data-act="cutins" class="cutin-mode"></button><button data-act="debug" title="Debug & balance (\`)">⚙</button><button data-act="menu">Menu</button>
                </div></div>
            <div class="squad"></div>
            <div class="actionbar"><div class="mode"></div><div class="actions"></div></div>
            <div class="target hidden"></div>
            <div class="panel hidden"></div>
            <div class="log"></div>
            <div class="debug hidden"></div>
            <div class="banner"></div>
            <div class="outcome hidden"></div>
            <div class="help">LMB select / move / fire · RMB cancel · 1–4 weapons · Z X C V G aim at head/torso/arms/legs · T throw · O overwatch · R reload · F formation · B breach · Alt+click free-aim at voxels · Q/E rotate · PgUp/PgDn cutaway · Tab next unit · Enter end turn</div>`;
        this.el = sel => root.querySelector(sel);
        root.addEventListener('click', e => this.onClick(e));
        this.lines = [];
    }
    onClick(e) {
        const b = e.target.closest('[data-act]');
        if (!b) return;
        const g = this.game, act = b.dataset.act, arg = b.dataset.arg;
        e.stopPropagation();
        switch (act) {
            case 'rotL': g.scene.rotate(-1); break; case 'rotR': g.scene.rotate(1); break;
            case 'lvlUp': g.changeLevel(1); break; case 'lvlDown': g.changeLevel(-1); break;
            case 'cutins': g.cycleCutins(); break; case 'debug': this.toggle('.debug'); this.renderDebug(); break;
            case 'menu': g.exitToMenu(); break;
            case 'select': g.select(arg); break;
            case 'weapon': g.setMode({ kind: 'shoot', weaponId: arg }); break;
            case 'melee': g.setMode({ kind: 'melee', weaponId: arg }); break;
            case 'throw': g.setMode({ kind: 'throw', itemId: arg }); break;
            case 'overwatch': g.setMode({ kind: 'overwatch' }); break;
            case 'reload': g.intent({ type: 'reload' }); break;
            case 'ability': g.useAbility(arg); break;
            case 'formation': this.showFormationPanel(); break;
            case 'formTpl': g.declareFormation(arg); this.hidePanel(); break;
            case 'formBreak': g.intent({ type: 'formation_break', formationId: arg }); break;
            case 'breach': this.showBreachPanel(); break;
            case 'doBreach': { const [i, entry] = arg.split(':'); g.doBreach(+i, entry); this.hidePanel(); break; }
            case 'door': g.toggleNearestDoor(); break;
            case 'part': g.fireAtPart(arg); break;
            case 'endTurn': g.endTurn(); break;
            case 'closePanel': this.hidePanel(); break;
            case 'dbg': g.debugAction(arg); this.renderDebug(); break;
            case 'restart': g.restart(); break;
        }
        this.refresh();
    }
    toggle(s) { this.el(s).classList.toggle('hidden'); }
    hidePanel() { this.el('.panel').classList.add('hidden'); }
    log(text, cls = '') {
        this.lines.push(`<div class="${cls}">${esc(text)}</div>`);
        if (this.lines.length > 9) this.lines.shift();
        this.el('.log').innerHTML = this.lines.join('');
    }
    banner(text, cls) {
        const b = this.el('.banner');
        b.textContent = text; b.className = `banner show ${cls || ''}`;
        clearTimeout(this.bannerTimer);
        this.bannerTimer = setTimeout(() => { b.className = 'banner'; }, 1400);
    }
    refresh() {
        const g = this.game, b = g.battle;
        if (!b) return;
        this.el('.mission').textContent = b.mission.name;
        this.el('.turn').innerHTML = `Round ${b.round} · <b class="${b.activeSide}">${b.activeSide === 'player' ? 'YOUR TURN' : 'ENEMY ACTIVITY'}</b>`;
        this.el('.objective').textContent = b.mission.objective?.text || '';
        this.el('.level').textContent = Number.isFinite(g.cutLevel) ? `L${g.cutLevel}` : 'all';
        this.el('.cutin-mode').textContent = `Back shot: ${g.cutins.mode}`;
        // Squad cards.
        this.el('.squad').innerHTML = b.units.filter(u => u.side === 'player').map(u => {
            const f = b.formations.of(u);
            return `<div class="card ${u.id === g.selected ? 'sel' : ''} ${u.dead ? 'dead' : ''}" data-act="select" data-arg="${u.id}">
                <img src="/assets/characters/${u.art}/portrait.png" alt="">
                <div class="info"><div class="name">${esc(u.name)} <span class="owner">${u.owner !== 'player' ? esc(u.owner) : ''}</span></div>
                <div class="hp"><i style="width:${100 * Math.max(0, u.hp) / u.maxHp}%"></i><span>${Math.max(0, u.hp)}/${u.maxHp}</span></div>
                <div class="pips">${pips(u.ap + u.moveOnlyAp, u.maxAp, 'ap')} ${pips(u.will, u.maxWill, 'wp')}</div>
                <div class="stress"><i style="width:${u.stress}%"></i></div>
                <div class="tags">${u.statuses.map(s => `<span>${s.id}</span>`).join('')}${u.overwatch ? '<span class="ow">overwatch</span>' : ''}${f ? `<span class="form">${FORMATIONS[f.template].name} ${f.cohesion}</span>` : ''}${Object.entries(u.parts).filter(([, p]) => p.disabled).map(([k]) => `<span class="dis">${k}✕</span>`).join('')}</div></div></div>`;
        }).join('');
        // Action bar.
        const u = g.selectedUnit();
        const mode = g.mode;
        this.el('.mode').textContent = u ? `${u.name} — ${modeText(mode)}` : (b.activeSide === 'player' ? 'Select a soldier' : '');
        if (!u || b.activeSide !== 'player' || b.outcome) { this.el('.actions').innerHTML = b.activeSide === 'player' && !b.outcome ? '<button data-act="endTurn" class="end">End turn ⏎</button>' : ''; this.renderTarget(); return; }
        const parts = [];
        u.weapons.forEach((id, i) => {
            const w = WEAPONS[id];
            if (w.kind === 'melee') parts.push(`<button data-act="melee" data-arg="${id}" class="${mode.kind === 'melee' ? 'on' : ''}">${i + 1}. ${w.name}<small>${w.ap} AP</small></button>`);
            else parts.push(`<button data-act="weapon" data-arg="${id}" class="${mode.kind === 'shoot' && mode.weaponId === id ? 'on' : ''}">${i + 1}. ${w.name}<small>${b.shotAp(u, w)} AP · ${u.ammo[id] ?? 0}/${w.ammo}</small></button>`);
        });
        for (const [id, n] of Object.entries(u.items)) if (n > 0) { const t = THROWABLES[id]; parts.push(`<button data-act="throw" data-arg="${id}" class="${mode.kind === 'throw' && mode.itemId === id ? 'on' : ''}">${t.name} ×${n}<small>${t.ap} AP</small></button>`); }
        parts.push(`<button data-act="overwatch" class="${mode.kind === 'overwatch' ? 'on' : ''}">Overwatch<small>all AP</small></button>`);
        parts.push(`<button data-act="reload">Reload<small>1 AP</small></button>`);
        for (const a of u.abilities) { const ab = ABILITIES[a]; parts.push(`<button data-act="ability" data-arg="${a}" ${u.will < ab.wp ? 'disabled' : ''} title="${esc(ab.text)}">${ab.name}<small>${ab.wp} WP${ab.ap ? ` · ${ab.ap} AP` : ''}</small></button>`); }
        const f = b.formations.of(u);
        parts.push(f ? `<button data-act="formBreak" data-arg="${f.id}">Break ${FORMATIONS[f.template].name}</button>` : `<button data-act="formation">Formation…<small>F</small></button>`);
        if (b.breachPoints(u).length) parts.push(`<button data-act="breach" class="breach">Breach…<small>B</small></button>`);
        if (g.nearestDoor(u)) parts.push(`<button data-act="door">Door</button>`);
        parts.push('<button data-act="endTurn" class="end">End turn ⏎</button>');
        this.el('.actions').innerHTML = parts.join('');
        this.renderTarget();
    }
    renderTarget() {
        const t = this.game.targetInfo, el = this.el('.target');
        if (!t) { el.classList.add('hidden'); return; }
        el.classList.remove('hidden');
        const u = t.target;
        el.innerHTML = `<div class="tname">${esc(u.name)} <span>${u.hp}/${u.maxHp} HP</span></div>
            <div class="tcover">${t.flanked ? '<b class="flank">FLANKED</b>' : ['No cover', 'Half cover', 'Full cover'][t.cover] || ''} · ${t.distance.toFixed(1)} tiles · spread ${t.spread.toFixed(2)}°${t.lean ? ` · lean ${t.lean}` : ''}</div>
            <div class="parts">${PARTS.map(([k, label, key]) => `<button data-act="part" data-arg="${k}" class="${t.part === k ? 'on' : ''} ${u.parts[k].disabled ? 'dis' : ''}">
                <b>${label}</b><span>${pct(t.byPart[k] ?? 0)}</span><small>arm ${u.parts[k].armor} · ${u.parts[k].hp}/${u.parts[k].max}</small><kbd>${key}</kbd></button>`).join('')}</div>
            <div class="tsum">Any hit ${pct(t.anyHit)} · blocked by cover ${pct(t.blocked)}${t.friendly > 0.01 ? ` · <b class="warn">friendly ${pct(t.friendly)}</b>` : ''} · ${t.ap} AP</div>
            <div class="mods">${t.mods.map(([k, v]) => `<span>${k} ×${v}</span>`).join('')}</div>`;
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
        const charge = g.battle.unitsOf('player').some(o => stack.includes(o.id) && o.items.breach_charge > 0);
        p.innerHTML = `<h3>Breach <button data-act="closePanel">✕</button></h3><p>Stack: ${stack.map(id => esc(g.battle.unit(id).name)).join(', ')} (1 AP each, one free shot each on entry; unalerted defenders are surprised).</p>` +
            pts.map((pt, i) => `<div class="bp">Door at ${pt.x},${pt.y} → room ${pt.roomId}
                <button data-act="doBreach" data-arg="${i}:door">Door entry</button>${charge ? `<button data-act="doBreach" data-arg="${i}:charge">Breach charge</button>` : ''}</div>`).join('');
    }
    showOutcome(o) {
        const el = this.el('.outcome'); el.classList.remove('hidden');
        const b = this.game.battle;
        el.innerHTML = `<h2>${o.winner === 'player' ? 'MISSION COMPLETE' : 'SQUAD LOST'}</h2><p>Round ${o.round}. Voxels destroyed: ${b.stats.voxelsDestroyed}. Breaches: ${b.stats.breaches}.</p>
            <button data-act="restart">Replay</button><button data-act="menu">Menu</button>`;
    }
    renderDebug() {
        const g = this.game, b = g.battle, el = this.el('.debug');
        if (el.classList.contains('hidden') || !b) return;
        const m = b.mission.metrics || {};
        const ws = Object.entries(b.stats.weapons).map(([id, s]) => `<tr><td>${WEAPONS[id]?.name || id}</td><td>${s.shots}</td><td>${s.projectiles ? pct(s.hits / s.projectiles) : '–'}</td><td>${s.damage}</td><td>${s.ap ? (s.damage / s.ap).toFixed(1) : '–'}</td><td>${s.kills}</td><td>${s.voxels || 0}</td></tr>`).join('');
        const gates = Object.entries(m.gates || {}).map(([k, ok]) => `<span class="${ok ? 'ok' : 'bad'}">${k}</span>`).join(' ');
        el.innerHTML = `<h3>Debug &amp; balance</h3>
            <div class="row"><button data-act="dbg" data-arg="fog">Fog: ${g.fog ? 'on' : 'off'}</button><button data-act="dbg" data-arg="auto">Autoplay squad: ${g.autoPlayer ? 'on' : 'off'}</button>
            <button data-act="dbg" data-arg="speed">Speed ×${g.player.speed}</button><button data-act="dbg" data-arg="rooms">Reveal rooms</button><button data-act="dbg" data-arg="ap">+4 AP</button><button data-act="dbg" data-arg="kill">Kill visible</button></div>
            <h4>Map metrics ${m.pass ? '<span class="ok">PASS</span>' : '<span class="bad">gates failing</span>'}</h4>
            <div class="metrics">cover ${pct(m.coverDensity || 0)} · full ${pct(m.fullCoverShare || 0)} · indoor ${pct(m.interiorShare || 0)} · open square ${m.killingField} · sightline ${(m.sightlineMedian || 0).toFixed(0)} · lanes ${m.lanes} · breachable ${pct(m.breachability || 0)} · destructible ${pct(m.destructibleCover || 0)} · rooms ${m.rooms}</div>
            <div class="gates">${gates}</div>
            <h4>Weapons this battle</h4><table><tr><th>weapon</th><th>shots</th><th>proj hit</th><th>dmg</th><th>dmg/AP</th><th>kills</th><th>voxels</th></tr>${ws}</table>
            <div class="metrics">voxels destroyed ${b.stats.voxelsDestroyed} · fires ${b.stats.fires} · breaches ${b.stats.breaches} · reactions ${b.stats.reactions} · chunk rebuild ${g.voxelView.stats.lastRebuildMs.toFixed(1)} ms · hash ${b.hash().slice(0, 17)}</div>`;
    }
}

function pips(n, max, cls) { let s = ''; for (let i = 0; i < Math.max(max, n); i++) s += `<i class="${cls} ${i < n ? 'on' : ''}"></i>`; return `<span class="pipset">${s}</span>`; }
function modeText(m) {
    switch (m.kind) {
        case 'shoot': return `aim ${WEAPONS[m.weaponId].name} — click an enemy (body part keys Z X C V G), Alt+click a voxel`;
        case 'melee': return 'melee — click an adjacent enemy';
        case 'throw': return `throw ${THROWABLES[m.itemId].name} — click a tile`;
        case 'overwatch': return 'overwatch — click the direction to watch';
        default: return 'move — click a tile';
    }
}
export { alive };
