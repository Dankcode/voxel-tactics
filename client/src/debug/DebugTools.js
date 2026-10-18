// Debug mode: a drawer of tools for testing every system without playing it out.
//   ?debug=1 in the URL, the bug button in the top bar, or F1 toggles it.
//
// World tools act at the cursor (click on the map): inspect, teleport the selected unit, spawn any unit type,
// destroy voxels, place a material, explode, apply an element (fire / frost / water / wind / earth), smoke.
// Unit tools: +AP, heal/revive, kill, god mode, refill, stress, statuses, take control of the enemy side.
// Turn tools: end the active side, pause the AI and step it one action at a time, autoplay the squad, speed.
// View: fog, reveal rooms, cover / line-of-sight / room / reach overlays, lighting presets, render stats.
// Mission: restart, reseed, switch map.
//
// Everything that changes the battle is a `{ type: 'debug', op }` intent (shared/battle/DebugOps.js), so it
// animates like any other event and stays deterministic. Shortcuts while debug is on:
//   F1 drawer · F2 inspect · F3 teleport · F4 destroy · F6 explode · F7 ignite · F8 freeze · F9 step AI · F10 end side
import { coverAt, COVER } from '../../../shared/voxel/Cover.js';
import { materialById, MATERIALS } from '../../../shared/voxel/Materials.js';
import { castRay, blocksSight } from '../../../shared/voxel/Raycast.js';
import { alive } from '../../../shared/battle/Units.js';
import { CLASSES, ENEMIES } from '../../../shared/content/units.js';
import { STATUS_DEFS } from '../../../shared/elements/Elements.js';
import { reasonText } from '../ui/Reasons.js';
import { LocalSession } from '../net/LocalSession.js';
import { DEBUG_PROGRAMS, DEBUG_TIMES } from '../../../shared/mapgen/DebugGenerator.js';
import { PLOT_IDS } from '../../../shared/mapgen/PlotCatalogue.js';
import { OPERATION_OBJECTIVES, OPERATION_TIMES } from '../../../shared/mapgen/Generator.js';
import { THEMES, FIXTURES, OPERATION_ID } from '../../../shared/session/Scenarios.js';

const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const TOOLS = [
    ['inspect', 'Inspect', 'F2'], ['teleport', 'Teleport selected', 'F3'], ['destroy', 'Destroy voxels', 'F4'], ['place', 'Place material', ''],
    ['explode', 'Explode', 'F6'], ['pyro', 'Ignite (pyro)', 'F7'], ['cryo', 'Freeze (cryo)', 'F8'], ['hydro', 'Soak (hydro)', ''], ['anemo', 'Gust (anemo)', ''],
    ['geo', 'Quake (geo)', ''], ['smoke', 'Smoke', ''], ['spawn', 'Spawn unit', '']
];
const PLACEABLE = ['sandbag', 'drystone', 'fence', 'hay', 'crate', 'barrel_powder', 'barrel_water', 'cart', 'stall', 'rock', 'hedge', 'stone', 'timber', 'plaster', 'glass', 'water', 'ice', 'rubble', 'plank'];
const OVERLAYS = [['cover', 'Cover map'], ['los', 'Line of sight'], ['rooms', 'Rooms'], ['reach', 'Reach cost'], ['elements', 'Element field'], ['play', 'Line of play']];

export class DebugTools {
    constructor(game, hudRoot) {
        this.game = game;
        this.enabled = false; this.tool = null; this.tab = 'world';
        this.radius = 1; this.height = 1; this.power = 10; this.material = 'sandbag'; this.spawnType = 'cultist'; this.spawnSide = 'enemy';
        this.manualEnemy = false; this.paused = false; this.stepResolvers = [];
        this.overlay = null; this.lastOps = [];
        this.builderSeed = 1; this.builderProgram = 'office'; this.builderStoreys = 3; this.builderTime = 'day';
        this.opPlot = 'downtown'; this.opSeed = 1; this.opObjective = ''; this.opTime = '';
        this.builderBusy = false; this.builderMessage = ''; this.builderError = false;
        this.fps = 0; this.frames = 0; this.fpsT = performance.now();
        this.el = document.createElement('div'); this.el.className = 'dbg-drawer hidden';
        this.info = document.createElement('div'); this.info.className = 'dbg-info hidden';
        hudRoot.appendChild(this.el); hudRoot.appendChild(this.info);
        this.el.addEventListener('click', e => this.onClick(e));
        this.el.addEventListener('change', e => this.onChange(e));
        const tickFps = () => { this.frames++; const now = performance.now(); if (now - this.fpsT > 1000) { this.fps = this.frames * 1000 / (now - this.fpsT); this.frames = 0; this.fpsT = now; this.renderStats(); } requestAnimationFrame(tickFps); };
        requestAnimationFrame(tickFps);
        if (new URLSearchParams(location.search).get('debug')) this.enable(true);
    }
    get battle() { return this.game.battle; }
    onStart() {
        if (this.enabled && this.game.session?.local) this.battle.debugEnabled = true;
        this.overlay = null; this.game.overlays.clearDebugLayer();
        this.render();
    }
    enable(on) {
        this.enabled = on;
        this.el.classList.toggle('hidden', !on);
        this.info.classList.toggle('hidden', !on);
        document.body.classList.toggle('debug-on', on);
        if (this.battle && this.game.session?.local) this.battle.debugEnabled = on || this.battle.debugEnabled;
        if (!on) { this.setTool(null); this.manualEnemy = false; this.release(); }
        this.render();
        this.game.hud?.refresh();
    }
    toggle() { this.enable(!this.enabled); }
    release() { this.paused = false; const r = this.stepResolvers; this.stepResolvers = []; r.forEach(f => f()); }
    waitStep() { return new Promise(r => this.stepResolvers.push(r)); }
    step() { const r = this.stepResolvers.shift(); if (r) r(); }
    setTool(t) {
        this.tool = t;
        document.body.classList.toggle('dbg-tool', !!t);
        this.render();
    }
    // ------------------------------------------------------------------ intents
    async op(op, extra = {}) {
        const g = this.game;
        if (!this.battle.debugEnabled) { g.hud.toast('Debug intents are disabled for this battle (online rooms need debug mode)', 'warn'); return { ok: false }; }
        const r = await g.session.submit({ type: 'debug', op, by: g.session.playerId || 'player', ...extra });
        if (!r.ok) { g.hud.toast(`Debug ${op}: ${reasonText(r.reason)}`, 'warn'); return r; }
        this.lastOps.unshift(`${op}${extra.unitId ? ` ${extra.unitId}` : ''}${extra.material ? ` ${extra.material}` : ''}${extra.unitType ? ` ${extra.unitType}` : ''}`);
        this.lastOps.length = Math.min(this.lastOps.length, 8);
        g.player.enqueue(r.events || []);
        await g.player.whenIdle();
        g.settleViews();
        this.applyOverlay();
        return r;
    }
    // ------------------------------------------------------------------ input from Game
    onKey(e, key) {
        if (key === 'f1') { e.preventDefault(); this.toggle(); return true; }
        if (!this.enabled) return false;
        const map = { f2: 'inspect', f3: 'teleport', f4: 'destroy', f6: 'explode', f7: 'pyro', f8: 'cryo' };
        if (map[key]) { e.preventDefault(); this.setTool(this.tool === map[key] ? null : map[key]); return true; }
        if (key === 'f9') { e.preventDefault(); this.paused = true; this.step(); this.render(); return true; }
        if (key === 'f10') { e.preventDefault(); this.op('endSide').then(() => this.game.maybeRunAi()); return true; }
        if (key === 'escape' && this.tool) { this.setTool(null); return true; }
        return false;
    }
    onHover(p, unit) {
        if (!this.enabled) return;
        this.hover = { p, unit };
        this.renderInfo();
    }
    click(p, unit, e) {
        const g = this.game, sel = g.selectedUnit() || g.battle.unit(g.selected);
        const cell = p?.cell, v = p?.voxel;
        switch (this.tool) {
            case 'inspect': this.pinned = { p, unit }; this.renderInfo(); if (unit) g.select(unit.id); break;
            case 'teleport': if (sel && cell) this.op('teleport', { unitId: sel.id, to: cell }); break;
            case 'spawn': if (cell) this.op('spawn', { unitType: this.spawnType, side: this.spawnSide, to: cell, alerted: true }); break;
            case 'destroy': if (v) this.op('destroy', { at: v, radius: e.shiftKey ? this.radius + 1 : this.radius }); break;
            case 'place': if (cell) this.op('place', { at: { x: cell.x, y: cell.y, z: cell.z + 1 }, material: this.material, radius: this.radius - 1, height: this.height }); break;
            case 'explode': if (p) this.op('explode', { at: { x: p.point.x, y: p.point.y, h: p.point.h }, radius: this.radius + 1.5, power: this.power, damage: 6 }); break;
            case 'smoke': if (cell) this.op('smoke', { at: { x: cell.x + 0.5, y: cell.y + 0.5, h: cell.z + 1.5 }, radius: this.radius + 1.5 }); break;
            case 'pyro': case 'cryo': case 'hydro': case 'anemo': case 'geo':
                if (cell) this.op('element', { element: this.tool, at: { x: cell.x + 0.5, y: cell.y + 0.5, h: cell.z + 1 }, radius: this.radius + 1 });
                break;
        }
    }
    // ------------------------------------------------------------------ drawer UI
    onClick(e) {
        const b = e.target.closest('[data-d]'); if (!b) return;
        e.stopPropagation();
        if (this.builderBusy) return;
        const g = this.game, a = b.dataset.d, arg = b.dataset.arg;
        const sel = g.selectedUnit() || g.battle?.unit(g.selected);
        switch (a) {
            case 'close': this.enable(false); break;
            case 'tab': this.tab = arg; break;
            case 'tool': this.setTool(this.tool === arg ? null : arg); break;
            case 'unit-select': { const u = g.battle.unit(arg); if (u) { if (u.side === 'enemy' && u.side === g.battle.activeSide) this.manualEnemy = true; g.select(arg); g.focusUnit(u); } break; }
            case 'unit-op': { const [op, id, x] = arg.split(':'); this.op(op, { unitId: id, ...(op === 'status' ? { status: x } : {}), ...(op === 'ap' ? { amount: 4 } : {}) }); break; }
            case 'endSide': this.op('endSide').then(() => g.maybeRunAi()); break;
            case 'manualEnemy': this.manualEnemy = !this.manualEnemy; if (!this.manualEnemy && g.battle.activeSide === 'enemy') g.maybeRunAi(); g.refreshRange(); break;
            case 'pause': this.paused = !this.paused; if (!this.paused) this.release(); break;
            case 'step': this.paused = true; this.step(); break;
            case 'auto': g.autoPlayer = !g.autoPlayer; if (g.autoPlayer && g.battle.activeSide === 'player') g.maybeRunAi(); break;
            case 'speed': g.player.speed = g.player.speed >= 8 ? 1 : g.player.speed * 2; break;
            case 'fog': g.fog = !g.fog; g.voxelView.rebuildAll(); g.updateEnemyVisibility();g.overlays.showObjective(g.battle); break;
            case 'reveal': this.op('reveal'); break;
            case 'alert': this.op('alert'); break;
            case 'overlay': this.overlay = this.overlay === arg ? null : arg; this.applyOverlay(); break;
            case 'lighting': g.scene.setLighting(arg); break;
            case 'shadows': g.scene.renderer.shadowMap.enabled = !g.scene.renderer.shadowMap.enabled; g.scene.scene.traverse(o => { if (o.material) o.material.needsUpdate = true; }); break;
            case 'restart': g.restart(); break;
            case 'reseed': { const seed = ((g.session.desc?.seed ?? 1) + 1) >>> 0;
                if (g.session.desc?.debugMap) this.generateMap({ ...g.session.desc.debugMap, seed });
                else this.restartWith({ seed });
                break; }
            case 'map': this.restartWith({ ...JSON.parse(arg), debugMap: null }); break;
            case 'generate': this.generateMap(); break;
            case 'operation': this.generateOperation(); break;
            case 'operationNext': this.opSeed = (this.opSeed + 1) >>> 0; this.generateOperation(); break;
            case 'generateNext': this.builderSeed = (this.builderSeed + 1) >>> 0; this.generateMap(); break;
            case 'killVisible': for (const id of [...(g.battle.visible || [])]) this.op('kill', { unitId: id }); break;
            case 'healSquad': for (const u of g.battle.units.filter(u => u.side === 'player')) this.op('heal', { unitId: u.id }); break;
            case 'apSquad': for (const u of g.battle.unitsOf(g.battle.activeSide)) this.op('ap', { unitId: u.id, amount: 4 }); break;
            case 'god': if (sel) this.op('god', { unitId: sel.id }); break;
        }
        this.render();
        g.hud.refresh();
    }
    onChange(e) {
        const t = e.target, k = t.dataset.v; if (!k) return;
        this[k] = t.type === 'number' || t.type === 'range' || k === 'builderStoreys' ? Number(t.value) : t.value;
        this.render();
    }
    async restartWith(patch) {
        const g = this.game, desc = { ...(g.session.desc || {}), ...patch, debug: true };
        if (!g.session.local) { g.hud.toast('Map switching is local-only', 'warn'); return; }
        const s = await LocalSession.create(desc);
        await g.start(s);
    }
    // Public console entry point: await __game.debug.generateMap({ seed: 42, storeys: 4 }).
    async generateMap(options = {}) {
        if (this.builderBusy) throw Error('Map generation already in progress');
        if (!this.enabled || !this.game.session?.local) {
            this.game.hud.toast('Map builder requires local debug mode', 'warn');
            return null;
        }
        if (this.game.aiRunning || !this.game.player.idle()) {
            this.game.hud.toast('Wait for the current turn playback before generating a map', 'warn');
            return null;
        }
        const settings = { seed: this.builderSeed, program: this.builderProgram, storeys: this.builderStoreys, timeOfDay: this.builderTime, ...options };
        this.builderBusy = true; this.builderError = false; this.builderMessage = `Building seed ${settings.seed}…`; this.render();
        try {
            // Paint the busy state before the synchronous solver runs; retain the current battle on build failure.
            await new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve, 0)));
            await this.game.player.whenIdle();
            const session = await LocalSession.create({ ...this.game.session.desc, seed: settings.seed, debug: true, debugMap: settings });
            await this.game.start(session);
            this.builderSeed = settings.seed; this.builderProgram = settings.program;
            this.builderStoreys = settings.storeys; this.builderTime = settings.timeOfDay;
            const m = session.battle.mission;
            this.builderMessage = `Generated seed ${settings.seed} · ${m.metrics.pass ? 'all gates pass' : 'combat gates failing; inspect below'}`;
            return m.meta.debugGeneration;
        } catch (error) {
            this.builderError = true; this.builderMessage = `Seed ${settings.seed} failed: ${error.message}`;
            return null;
        } finally { this.builderBusy = false; this.render(); }
    }
    /** Generate and load a PLAN-04 operation (same descriptor the menu's game mode uses). */
    async generateOperation(options = {}) {
        if (this.builderBusy || !this.game.session?.local) return null;
        const operation = { plot: this.opPlot, objective: this.opObjective || null, timeOfDay: this.opTime || null, ...options };
        this.builderBusy = true; this.builderError = false; this.builderMessage = `Generating ${operation.plot} · seed ${this.opSeed}…`; this.render();
        try {
            await new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve, 0)));
            await this.game.player.whenIdle();
            const session = await LocalSession.create({ ...this.game.session.desc, scenario: 'operation', operation, seed: this.opSeed, debug: true, debugMap: null });
            await this.game.start(session);
            const m = session.battle.mission;
            this.builderMessage = `${m.name} · critic ${m.meta.critic?.total ?? '–'} · ${m.metrics.pass ? 'all gates pass' : 'gates failing'}`;
            return m;
        } catch (error) { this.builderError = true; this.builderMessage = `Operation failed: ${error.message}`; return null; }
        finally { this.builderBusy = false; this.render(); }
    }
    refresh() { if (this.enabled) { this.render(); this.applyOverlay(); } }
    render() {
        if (!this.enabled || !this.battle) return;
        const g = this.game, b = this.battle;
        const tabs = ['world', 'units', 'turn', 'view', 'mission'].map(t => `<button data-d="tab" data-arg="${t}" class="${this.tab === t ? 'on' : ''}">${t}</button>`).join('');
        let body = '';
        if (this.tab === 'world') {
            body = `<div class="grid">${TOOLS.map(([id, label, key]) => `<button data-d="tool" data-arg="${id}" class="${this.tool === id ? 'on' : ''}">${label}${key ? ` <kbd>${key}</kbd>` : ''}</button>`).join('')}</div>
                <label>Radius <input data-v="radius" type="range" min="0" max="5" value="${this.radius}"> ${this.radius}</label>
                <label>Height <input data-v="height" type="range" min="1" max="4" value="${this.height}"> ${this.height}</label>
                <label>Blast power <input data-v="power" type="range" min="0" max="30" value="${this.power}"> ${this.power}</label>
                <label>Material <select data-v="material">${PLACEABLE.map(m => `<option ${m === this.material ? 'selected' : ''}>${m}</option>`).join('')}</select></label>
                <label>Spawn <select data-v="spawnType">${[...Object.keys(ENEMIES), ...Object.keys(CLASSES)].map(m => `<option ${m === this.spawnType ? 'selected' : ''}>${m}</option>`).join('')}</select>
                    <select data-v="spawnSide">${['enemy', 'player'].map(s => `<option ${s === this.spawnSide ? 'selected' : ''}>${s}</option>`).join('')}</select></label>
                <p class="hint">${this.tool ? `Tool <b>${this.tool}</b>: click the map · right-click / Esc to drop it` : 'Pick a tool, then click the map.'}</p>`;
        } else if (this.tab === 'units') {
            body = `<div class="row"><button data-d="healSquad">Heal squad</button><button data-d="apSquad">+4 AP (active side)</button><button data-d="killVisible">Kill visible</button><button data-d="god">God (selected)</button></div>
                <table class="units"><tr><th>unit</th><th>hp</th><th>ap</th><th>pos</th><th></th></tr>${b.units.map(u => `<tr class="${u.side} ${u.dead ? 'dead' : ''} ${u.id === g.selected ? 'sel' : ''}">
                <td><a data-d="unit-select" data-arg="${u.id}">${esc(u.name)}</a>${u.god ? ' ★' : ''}${u.side === 'enemy' && !u.alerted ? ' 💤' : ''}</td><td>${Math.max(0, u.hp)}/${u.maxHp}</td><td>${u.ap}</td><td>${u.x},${u.y},${u.z}</td>
                <td class="ops"><button data-d="unit-op" data-arg="ap:${u.id}" title="+4 AP">+AP</button><button data-d="unit-op" data-arg="heal:${u.id}" title="Heal / revive">♥</button><button data-d="unit-op" data-arg="kill:${u.id}" title="Kill">✕</button><button data-d="unit-op" data-arg="refill:${u.id}" title="Refill ammo, items, Will">↻</button><button data-d="unit-op" data-arg="stress:${u.id}" title="+25 stress">ψ</button><button data-d="unit-op" data-arg="status:${u.id}:burning" title="Set on fire">🔥</button><button data-d="unit-op" data-arg="status:${u.id}:chilled" title="Chill">❄</button><button data-d="unit-op" data-arg="status:${u.id}:stunned" title="Stun">✶</button></td></tr>`).join('')}</table>
                <p class="hint">Statuses: ${Object.keys(STATUS_DEFS).join(', ')}</p>`;
        } else if (this.tab === 'turn') {
            body = `<p>Round ${b.round} · active side <b>${b.activeSide}</b>${g.aiRunning ? ' · AI running' : ''}</p>
                <div class="row"><button data-d="endSide">End ${b.activeSide} turn <kbd>F10</kbd></button><button data-d="manualEnemy" class="${this.manualEnemy ? 'on' : ''}">Control enemy side: ${this.manualEnemy ? 'ON' : 'off'}</button></div>
                <div class="row"><button data-d="pause" class="${this.paused ? 'on' : ''}">${this.paused ? 'AI paused' : 'Pause AI'}</button><button data-d="step">Step AI action <kbd>F9</kbd></button><button data-d="auto" class="${g.autoPlayer ? 'on' : ''}">Autoplay squad: ${g.autoPlayer ? 'ON' : 'off'}</button></div>
                <div class="row"><button data-d="speed">Playback ×${g.player.speed}</button><button data-d="alert">Alert all pods</button></div>
                <p class="hint">With "control enemy side" on, enemy units can be selected and ordered like your own during the enemy phase.</p>`;
        } else if (this.tab === 'view') {
            body = `<div class="row"><button data-d="fog" class="${g.fog ? 'on' : ''}">Fog of war: ${g.fog ? 'on' : 'off'}</button><button data-d="reveal">Reveal all rooms</button><button data-d="shadows">Shadows: ${g.scene.renderer.shadowMap.enabled ? 'on' : 'off'}</button></div>
                <h5>Overlays</h5><div class="row">${OVERLAYS.map(([id, l]) => `<button data-d="overlay" data-arg="${id}" class="${this.overlay === id ? 'on' : ''}">${l}</button>`).join('')}</div>
                <h5>Lighting</h5><div class="row">${['day', 'dusk', 'night'].map(l => `<button data-d="lighting" data-arg="${l}" class="${g.scene.lightingName === l ? 'on' : ''}">${l}</button>`).join('')}</div>
                <div class="stats"></div>`;
        } else if (this.tab === 'mission') {
            const m = b.mission.metrics || {};
            const gates = Object.entries(m.gates || {}).map(([k, ok]) => `<span class="${ok ? 'ok' : 'bad'}">${k}</span>`).join(' ');
            body = `<p><b>${esc(b.mission.name)}</b> · seed ${g.session.desc?.seed ?? '?'} · ${b.store.width}×${b.store.depth}×${b.store.height}</p>
                <div class="row"><button data-d="restart">Restart</button><button data-d="reseed">New seed</button></div>
                <h5>Operation generator (PLAN-04)</h5>
                <p class="hint">Plot → fields → district/lot/bay WFC → interiors → gates with local repair. ${b.mission.meta?.critic ? `Critic <b>${b.mission.meta.critic.total}</b> · ${Object.entries(b.mission.meta.critic.scores).map(([k, v]) => `${k} ${v}`).join(' · ')}` : ''}</p>
                <label>Plot <select aria-label="Operation plot" data-v="opPlot">${PLOT_IDS.map(p => `<option ${p === this.opPlot ? 'selected' : ''}>${p}</option>`).join('')}</select></label>
                <label>Seed <input aria-label="Operation seed" data-v="opSeed" type="number" min="0" max="4294967295" step="1" value="${this.opSeed}"></label>
                <label>Objective <select aria-label="Operation objective" data-v="opObjective"><option value="">auto</option>${OPERATION_OBJECTIVES.map(o => `<option ${o === this.opObjective ? 'selected' : ''}>${o}</option>`).join('')}</select></label>
                <label>Time <select aria-label="Operation time" data-v="opTime"><option value="">auto</option>${OPERATION_TIMES.map(t => `<option ${t === this.opTime ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
                <div class="row"><button data-d="operation" ${this.builderBusy || !g.session.local ? 'disabled' : ''}>Generate operation</button><button data-d="operationNext" ${this.builderBusy || !g.session.local ? 'disabled' : ''}>Next seed</button></div>
                ${b.mission.meta?.repairs?.length && b.mission.meta?.generatorVersion ? `<p class="hint">Repairs: ${esc(b.mission.meta.repairs.map(r => r.kind).join(', '))}</p>` : ''}
                <h5>Map builder (local)</h5>
                <p class="hint">Fresh architecture through the layout solver and voxel compiler. Restart replays it; new layout changes the seed.</p>
                <label>Seed <input aria-label="Map builder seed" data-v="builderSeed" type="number" min="0" max="4294967295" step="1" value="${this.builderSeed}"></label>
                <label>Building <select aria-label="Map builder building" data-v="builderProgram">${DEBUG_PROGRAMS.map(p => `<option ${p === this.builderProgram ? 'selected' : ''}>${p}</option>`).join('')}</select></label>
                <label>Storeys <select aria-label="Map builder storeys" data-v="builderStoreys">${[1,2,3,4].map(n => `<option ${n === this.builderStoreys ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
                <label>Time <select aria-label="Map builder time" data-v="builderTime">${DEBUG_TIMES.map(t => `<option ${t === this.builderTime ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
                <div class="row"><button data-d="generate" ${this.builderBusy || !g.session.local ? 'disabled' : ''}>Generate map</button><button data-d="generateNext" ${this.builderBusy || !g.session.local ? 'disabled' : ''}>New layout</button></div>
                <p role="status" class="${this.builderError ? 'bad' : 'hint'}">${esc(this.builderMessage)}</p>
                <div class="row">${THEMES.map(t => `<button data-d="map" data-arg='${JSON.stringify({ scenario: OPERATION_ID, operation: { plot: t.id } })}'>${esc(t.name)}</button>`).join('')}${FIXTURES.map(m => `<button data-d="map" data-arg='${JSON.stringify({ scenario: m.id })}' class="${b.mission.id === m.id ? 'on' : ''}">${esc(m.name)} (rig)</button>`).join('')}</div>
                <h5>Map metrics ${m.pass ? '<span class="ok">PASS</span>' : '<span class="bad">gates failing</span>'}</h5>
                <div class="metrics">cover ${pct(m.coverDensity)} · outdoor cover ${pct(m.outdoorCover)} · full ${pct(m.fullCoverShare)} · indoor ${pct(m.interiorShare)} · open square ${m.killingField} · sightline ${(m.sightlineMedian || 0).toFixed(0)} · lanes ${m.lanes} · breachable ${pct(m.breachability)} · destructible ${pct(m.destructibleCover)} · rooms ${m.rooms}</div>
                <div class="gates">${gates}</div>
                <h5>Weapons this battle</h5><table><tr><th>weapon</th><th>shots</th><th>hit</th><th>dmg</th><th>dmg/AP</th><th>kills</th></tr>${Object.entries(b.stats.weapons).map(([id, s]) => `<tr><td>${id}</td><td>${s.shots}</td><td>${s.projectiles ? pct(s.hits / s.projectiles) : '–'}</td><td>${s.damage}</td><td>${s.ap ? (s.damage / s.ap).toFixed(1) : '–'}</td><td>${s.kills}</td></tr>`).join('')}</table>
                <p class="hint">hash ${b.hash().slice(0, 24)} · voxels destroyed ${b.stats.voxelsDestroyed} · fires ${b.stats.fires}</p>`;
        }
        this.el.innerHTML = `<div class="dhead"><b>DEBUG</b>${b.debugEnabled ? '' : ' <span class="bad">(intents disabled online)</span>'}<button data-d="close">✕</button></div><div class="tabs">${tabs}</div><div class="dbody">${body}</div>
            <div class="ops">${this.lastOps.map(o => `<span>${esc(o)}</span>`).join('')}</div>`;
        this.renderStats();
    }
    renderStats() {
        const el = this.el.querySelector('.stats'); if (!el || !this.game.scene) return;
        const info = this.game.scene.renderer.info, vs = this.game.voxelView?.stats || {};
        el.innerHTML = `${this.fps.toFixed(0)} fps · ${info.render.calls} draw calls · ${(info.render.triangles / 1000).toFixed(0)}k tris · ${vs.meshes} chunk meshes · rebuild ${(vs.lastRebuildMs || 0).toFixed(1)} ms`;
    }
    renderInfo() {
        if (!this.enabled || !this.battle) return;
        const src = this.pinned && this.tool === 'inspect' ? this.pinned : this.hover;
        const b = this.battle, s = b.store, p = src?.p, u = src?.unit;
        if (!p?.cell && !u) { this.info.innerHTML = '<i>hover the map</i>'; return; }
        const c = p?.cell || { x: u.x, y: u.y, z: u.z };
        const mat = z => { const m = materialById(s.get(c.x, c.y, z)); return m.id ? `${m.key} <small>${s.hpAt(c.x, c.y, z)}hp</small>` : 'air'; };
        const cov = coverAt(s, c.x, c.y, c.z);
        const covTxt = ['n', 'e', 's', 'w'].map(d => `${d}:${['–', '½', '■'][cov[d]]}`).join(' ');
        const room = s.roomAt(c.x, c.y, c.z + 1);
        const f = b.field;
        const elem = [f.surfaceAt(c.x, c.y, c.z), f.isBurning(c.x, c.y, c.z) ? 'burning' : null, f.isSmoke(c.x, c.y, c.z + 1) ? 'smoke' : null].filter(Boolean).join(', ');
        const v = p?.voxel;
        this.info.innerHTML = `<b>${c.x}, ${c.y}, z${c.z}</b>${this.pinned && this.tool === 'inspect' ? ' 📌' : ''}<br>
            ground ${mat(c.z)} · +1 ${mat(c.z + 1)} · +2 ${mat(c.z + 2)}<br>
            ${v ? `voxel ${v.x},${v.y},${v.z} ${materialById(s.get(v.x, v.y, v.z)).key}<br>` : ''}
            cover ${covTxt} · room ${room}${elem ? ` · ${elem}` : ''}<br>
            ${u ? `<b>${esc(u.name)}</b> ${u.side} hp ${u.hp}/${u.maxHp} ap ${u.ap} ${u.alerted ? 'alert' : 'unaware'}${u.overwatch ? ' overwatch' : ''}` : ''}`;
    }
    // ------------------------------------------------------------------ overlays
    applyOverlay() {
        const g = this.game, o = g.overlays, b = this.battle, s = b?.store;
        o.clearDebugLayer();
        if (!this.enabled || !this.overlay || !b) return;
        const sel = g.selectedUnit() || b.unit(g.selected);
        const cells = [];
        const forEachSurface = fn => { for (let y = 0; y < s.depth; y++) for (let x = 0; x < s.width; x++) for (const sf of s.surfaces(x, y)) if (sf.headroom >= 2 && sf.z < g.cutLevel) fn(sf); };
        if (this.overlay === 'cover') {
            forEachSurface(sf => {
                const c = coverAt(s, sf.x, sf.y, sf.z), best = Math.max(c.n, c.e, c.s, c.w);
                if (best === COVER.FULL) cells.push({ ...sf, color: 0x2f80ed }); else if (best === COVER.HALF) cells.push({ ...sf, color: 0x7fd3ff });
            });
            o.showDebugTiles(cells, 0.45);
        } else if (this.overlay === 'rooms') {
            for (const r of b.mission.rooms) for (const [x, y] of r.cells) cells.push({ x, y, z: r.floorZ, color: [0xe57373, 0x81c784, 0x64b5f6, 0xffd54f, 0xba68c8, 0x4dd0e1, 0xff8a65][r.id % 7] });
            o.showDebugTiles(cells, 0.5);
        } else if (this.overlay === 'reach' && sel) {
            const r = b.reach(sel, 999);
            for (const [k, cost] of r.costs) { const n = r.nodes.get(k); const ap = b.apForCost(sel, cost); cells.push({ ...n, color: [0xffffff, 0x46c8ff, 0x3f7dff, 0xffc845, 0xff8a3d, 0xff5a4a, 0x8a3dff][Math.min(6, ap)] }); }
            o.showDebugTiles(cells, 0.35);
        } else if (this.overlay === 'los' && sel) {
            const segs = [], blocked = [];
            for (const t of b.units.filter(t => alive(t) && t.id !== sel.id)) {
                const a = b.eye(sel), z = b.chest(t);
                const r = castRay(s, a, z, { blocks: blocksSight });
                (r.hit ? blocked : segs).push([a, r.hit ? r.point : z]);
            }
            o.showDebugLines(segs, 0x58e08a); o.showDebugLines(blocked, 0xff5a4a);
        } else if (this.overlay === 'play') {
            // PLAN-04: the main route (cyan), flanks (amber), engagement pockets (red) and the tunnel (violet).
            const meta = b.mission.meta, G = meta.streetDatum ?? 1;
            for (const [x, y] of meta.lineOfPlay?.main || []) cells.push({ x, y, z: G, color: 0x4fd3ff });
            for (const f of meta.flanks || []) for (const [x, y] of f.cells) cells.push({ x, y, z: G, color: 0xffb347 });
            for (const p of meta.pockets || []) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) cells.push({ x: p.x + dx, y: p.y + dy, z: G, color: 0xff5a4a });
            for (const p of meta.underground?.route || []) if (g.cutLevel <= G) cells.push({ ...p, color: 0xb388ff });
            o.showDebugTiles(cells, 0.5);
        } else if (this.overlay === 'elements') {
            for (const [k, v] of b.field.surfaces) { const [x, y, z] = k.split(',').map(Number); cells.push({ x, y, z, color: { wet: 0x4fc3f7, frozen: 0xe1f5fe, burning: 0xff7043, oiled: 0x8d6e63, electrified: 0xfff176 }[v.effect] || 0xffffff }); }
            for (const k of b.field.fires.keys()) { const [x, y, z] = k.split(',').map(Number); cells.push({ x, y, z, color: 0xff3d00 }); }
            o.showDebugTiles(cells, 0.6);
        }
    }
}
const pct = v => `${Math.round((v || 0) * 100)}%`;
export { MATERIALS };
