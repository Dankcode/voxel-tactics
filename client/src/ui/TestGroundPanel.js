// Test ground (admin build): set up any map with a chosen squad and hostile roster, preview the placements, launch,
// save setups, share them as links, and reopen recent after-action reports.
import { SCENARIOS, OPERATION_ID, sanitizeDesc, createBattle } from '../../../shared/session/Scenarios.js';
import { CLASSES, ENEMIES, SQUADS } from '../../../shared/content/units.js';
import { WEAPONS } from '../../../shared/content/weapons.js';
import { PLOT_FAMILIES, PLOT_IDS } from '../../../shared/mapgen/PlotCatalogue.js';
import { OPERATION_OBJECTIVES } from '../../../shared/mapgen/Generator.js';
import { TEST_PRESETS, TEST_LIMITS, TEST_TIMES, ENEMY_TYPES } from '../../../shared/session/TestGround.js';
import { reportText } from '../../../shared/session/BattleReport.js';
import { drawMissionPreview, styleOf } from './MissionPreview.js';
import { reportMarkup } from './BattleReportView.js';
import { loadScenarios, saveScenario, deleteScenario, loadReports, clearReports, loadLastSetup, encodeSetup, downloadJson } from './TestGroundStore.js';

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const cap = s => s[0].toUpperCase() + s.slice(1);
const MAX_SQUAD = 6;

export const DEFAULT_SETUP = Object.freeze({
    scenario: 'proving-grounds', seed: 1, plot: 'downtown', opObjective: '', opTime: '',
    squad: [...SQUADS.standard], useMapHostiles: false, roster: { ...TEST_PRESETS.patrol.enemies }, podSize: 3,
    alerted: false, objective: 'map', rounds: '', timeOfDay: '', autopilot: false, debug: false
});

/** Panel state → scenario descriptor (validated by sanitizeDesc before use). */
export function setupToDesc(c) {
    const desc = { scenario: c.scenario, seed: Number(c.seed) || 1, squad: c.squad.slice(), debug: !!c.debug };
    if (c.scenario === OPERATION_ID) desc.operation = { plot: c.plot, objective: c.opObjective || null, timeOfDay: c.opTime || null };
    desc.test = {
        enemies: c.useMapHostiles ? null : ENEMY_TYPES.filter(t => c.roster[t] > 0).map(type => ({ type, count: c.roster[type] })),
        podSize: c.podSize, alerted: !!c.alerted, objective: c.objective, rounds: c.rounds ? Number(c.rounds) : null, timeOfDay: c.timeOfDay || null
    };
    return desc;
}
/** Descriptor (from a report, a link or a saved setup) → panel state. */
export function descToSetup(desc = {}, client = {}) {
    const t = desc.test || {};
    const roster = {};
    for (const e of t.enemies || []) roster[e.type] = e.count;
    return {
        ...DEFAULT_SETUP,
        scenario: desc.scenario === OPERATION_ID || SCENARIOS.some(s => s.id === desc.scenario) ? desc.scenario : DEFAULT_SETUP.scenario,
        seed: desc.seed ?? 1, plot: desc.operation?.plot || 'downtown', opObjective: desc.operation?.objective || '', opTime: desc.operation?.timeOfDay || '',
        squad: Array.isArray(desc.squad) ? desc.squad.slice(0, MAX_SQUAD) : [...(SQUADS[desc.squad] || SQUADS.standard)],
        useMapHostiles: !t.enemies, roster: t.enemies ? roster : { ...DEFAULT_SETUP.roster }, podSize: t.podSize || 3,
        alerted: !!t.alerted, objective: t.objective === 'eliminate' ? 'eliminate' : 'map', rounds: t.rounds || '', timeOfDay: t.timeOfDay || '',
        autopilot: !!client.autopilot, debug: !!desc.debug
    };
}
/** A report's scenario block → descriptor, so a recent report can be replayed or edited. */
export const reportToDesc = r => ({ scenario: r.scenario.id, seed: r.scenario.seed, squad: r.scenario.squad || 'standard', ...(r.scenario.operation ? { operation: r.scenario.operation } : {}), ...(r.scenario.test ? { test: r.scenario.test } : {}) });

export class TestGroundPanel {
    /** @param root element; @param hooks { launch(desc, client), host(desc, client), status(text) } */
    constructor(root, hooks, setup = null) {
        this.root = root; this.hooks = hooks;
        this.c = structuredClone(setup || loadLastSetup()?.setup || DEFAULT_SETUP);
        this.c.roster ||= {};
        this.viewing = null;
        root.addEventListener('click', e => this.onClick(e));
        root.addEventListener('change', e => this.onChange(e));
        this.render();
    }
    get desc() { return setupToDesc(this.c); }
    total() { return ENEMY_TYPES.reduce((n, t) => n + (this.c.roster[t] || 0), 0); }

    render() {
        const c = this.c, maps = SCENARIOS, themes = [...new Set(maps.map(s => s.theme))], total = this.total();
        const op = c.scenario === OPERATION_ID;
        const enemyRow = t => {
            const e = ENEMIES[t], n = c.roster[t] || 0, st = styleOf(t);
            return `<div class="tg-enemy ${n ? 'on' : ''}"><span class="tg-mark" style="background:${st.color}">${st.letter}</span>
              <div><b>${esc(e.name)}</b><small>${esc(e.weapons.map(w => WEAPONS[w]?.name || w).join(' + '))} · ${esc(e.armor)} armour · aim ${Math.round(e.accuracy * 100)}</small></div>
              <div class="tg-step" role="group" aria-label="${esc(e.name)} count"><button data-tg="dec" data-arg="${t}" aria-label="One fewer ${esc(e.name)}" ${n ? '' : 'disabled'}>−</button><output>${n}</output><button data-tg="inc" data-arg="${t}" aria-label="One more ${esc(e.name)}" ${n >= TEST_LIMITS.perType || total >= TEST_LIMITS.total ? 'disabled' : ''}>+</button></div></div>`;
        };
        const scenarios = loadScenarios(), reports = loadReports();
        this.root.innerHTML = `
        <div class="tg-head"><b>Test ground</b><span>Admin build. Pick any map, set the squad and the hostile roster, then launch. Every battle ends with an after-action report; the last ${20} are kept below.</span></div>
        <div class="tg-grid">
          <div class="tg-col">
            <h4>Map</h4>
            <div class="row"><label>Map <select data-tg-field="scenario">
              <optgroup label="Generated"><option value="${OPERATION_ID}" ${op ? 'selected' : ''}>Generated operation</option></optgroup>
              ${themes.map(t => `<optgroup label="${esc(t)}">${maps.filter(s => s.theme === t).map(s => `<option value="${s.id}" ${s.id === c.scenario ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</optgroup>`).join('')}
            </select></label>
            <label class="tg-seed">Seed <input data-tg-field="seed" type="number" min="0" max="4294967295" value="${esc(c.seed)}"></label><button data-tg="dice" title="Random seed" aria-label="Random seed">🎲</button></div>
            ${op ? `<div class="row"><label>Plot <select data-tg-field="plot">${PLOT_IDS.map(id => `<option value="${id}" ${id === c.plot ? 'selected' : ''}>${esc(PLOT_FAMILIES[id].name)}</option>`).join('')}</select></label>
              <label>Map objective <select data-tg-field="opObjective"><option value="">Auto</option>${OPERATION_OBJECTIVES.map(o => `<option value="${o}" ${o === c.opObjective ? 'selected' : ''}>${cap(o)}</option>`).join('')}</select></label>
              <label>Map time <select data-tg-field="opTime"><option value="">Auto</option>${TEST_TIMES.map(t => `<option ${t === c.opTime ? 'selected' : ''}>${t}</option>`).join('')}</select></label></div>` : ''}
            <h4>Squad <span>${c.squad.length} / ${MAX_SQUAD}</span></h4>
            <div class="tg-squad">${c.squad.map((t, i) => `<div class="tg-slot"><span>${i + 1}</span><select data-tg-field="squad" data-arg="${i}" aria-label="Soldier ${i + 1} class">${Object.values(CLASSES).map(k => `<option value="${k.id}" ${k.id === t ? 'selected' : ''}>${esc(k.name)}</option>`).join('')}</select><button data-tg="removeSoldier" data-arg="${i}" aria-label="Remove soldier ${i + 1}" ${c.squad.length > 1 ? '' : 'disabled'}>✕</button></div>`).join('')}</div>
            <div class="tg-chips"><button data-tg="addSoldier" ${c.squad.length >= MAX_SQUAD ? 'disabled' : ''}>+ Soldier</button>${Object.keys(SQUADS).map(k => `<button data-tg="squadPreset" data-arg="${k}">${cap(k)} squad</button>`).join('')}</div>
            <h4>Rules</h4>
            <label class="check"><input type="checkbox" data-tg-field="alerted" ${c.alerted ? 'checked' : ''}> Hostiles start alerted (no first-contact scatter)</label>
            <div class="row"><label>Objective <select data-tg-field="objective"><option value="map" ${c.objective === 'map' ? 'selected' : ''}>Map objective</option><option value="eliminate" ${c.objective === 'eliminate' ? 'selected' : ''}>Eliminate every hostile</option></select></label>
              <label>Round limit <input data-tg-field="rounds" type="number" min="${TEST_LIMITS.rounds[0]}" max="${TEST_LIMITS.rounds[1]}" placeholder="none" value="${esc(c.rounds)}"></label></div>
            <div class="row"><label>Time of day <select data-tg-field="timeOfDay"><option value="">Map default</option>${TEST_TIMES.map(t => `<option ${t === c.timeOfDay ? 'selected' : ''}>${t}</option>`).join('')}</select></label></div>
            <label class="check"><input type="checkbox" data-tg-field="autopilot" ${c.autopilot ? 'checked' : ''}> Autopilot squad (AI plays both sides; watch and read the report)</label>
            <label class="check"><input type="checkbox" data-tg-field="debug" ${c.debug ? 'checked' : ''}> Debug tools in battle (F1)</label>
          </div>
          <div class="tg-col">
            <h4>Hostiles <span>${c.useMapHostiles ? 'map pods' : `${total} / ${TEST_LIMITS.total}`}</span></h4>
            <div class="tg-toggle" role="radiogroup" aria-label="Hostile roster">
              <button data-tg="useMap" data-arg="0" class="${c.useMapHostiles ? '' : 'on'}" role="radio" aria-checked="${!c.useMapHostiles}">Custom roster</button>
              <button data-tg="useMap" data-arg="1" class="${c.useMapHostiles ? 'on' : ''}" role="radio" aria-checked="${c.useMapHostiles}">Map's own pods</button></div>
            ${c.useMapHostiles ? '<p class="small">The map keeps its authored or generated pods. Rules on the left still apply.</p>' : `
            <div class="tg-roster">${ENEMY_TYPES.map(enemyRow).join('')}</div>
            <div class="tg-chips">${Object.entries(TEST_PRESETS).map(([k, p]) => `<button data-tg="preset" data-arg="${k}">${esc(p.name)}</button>`).join('')}<button data-tg="clearRoster">Clear</button></div>
            <div class="row"><label>Pod size <select data-tg-field="podSize">${[1, 2, 3, 4].map(n => `<option ${n === c.podSize ? 'selected' : ''}>${n}</option>`).join('')}</select></label></div>
            <p class="small">Pods mix the chosen types and take the map's pod positions first, then cover pockets, rooms and far ground — never within ${TEST_LIMITS.minSpawnDistance} tiles of the squad. The same seed always gives the same placement.</p>`}
          </div>
        </div>
        <div class="row buttons"><button data-tg="preview">Preview placements</button><button data-tg="launch" class="primary">Launch test</button><button data-tg="host">Host online test</button></div>
        <div class="tg-preview" ${this.previewHtml ? '' : 'hidden'}><canvas aria-label="Test map preview with spawns"></canvas><div class="tg-pinfo">${this.previewHtml || ''}</div></div>
        <div class="row tg-save"><label>Setup name <input data-tg-field="name" placeholder="e.g. Brute rush, night" value="${esc(this.name || '')}"></label><button data-tg="save">Save setup</button><button data-tg="link">Copy link</button></div>
        <details class="tg-list" ${scenarios.length ? 'open' : ''}><summary>Saved setups (${scenarios.length})</summary>${scenarios.length ? scenarios.map((s, i) => `<div class="tg-item"><div><b>${esc(s.name)}</b><small>${esc(this.summary(s.desc))}</small></div><button data-tg="load" data-arg="${i}">Load</button><button data-tg="delete" data-arg="${i}" aria-label="Delete ${esc(s.name)}">✕</button></div>`).join('') : '<p class="small">None yet.</p>'}</details>
        <details class="tg-list" ${reports.length ? 'open' : ''}><summary>Recent reports (${reports.length})</summary>${reports.length ? reports.map((r, i) => `<div class="tg-item ${r.outcome.winner}"><div><b>${r.outcome.winner === 'player' ? 'Won' : r.outcome.winner === 'enemy' ? 'Lost' : 'Ended'} · ${esc(r.scenario.name)}</b><small>${esc(r.run.at ? new Date(r.run.at).toLocaleString() : '')} · ${esc(r.outcome.reason)} · round ${r.outcome.rounds} · squad ${r.totals.player.standing}/${r.totals.player.units} · hostiles down ${r.totals.enemy.losses}/${r.totals.enemy.units}${r.scenario.test ? ' · test' : ''}</small></div><button data-tg="view" data-arg="${i}">View</button><button data-tg="replayReport" data-arg="${i}">Replay</button></div>`).join('') + '<div class="tg-chips"><button data-tg="clearReports">Clear reports</button></div>' : '<p class="small">Reports appear here after each battle.</p>'}</details>
        <div class="tg-modal" ${this.viewing ? '' : 'hidden'}>${this.viewing ? reportMarkup(this.viewing.report, { saved: true, canEdit: true, tab: this.viewing.tab }) : ''}</div>`;
        if (this.preview) drawMissionPreview(this.root.querySelector('.tg-preview canvas'), this.preview);
    }
    summary(desc) {
        const map = desc.scenario === OPERATION_ID ? `Generated ${desc.operation?.plot || ''}` : SCENARIOS.find(s => s.id === desc.scenario)?.name || desc.scenario;
        const t = desc.test || {};
        const roster = t.enemies ? t.enemies.map(e => `${e.count} ${ENEMIES[e.type]?.name || e.type}`).join(', ') : 'map pods';
        return `${map} · seed ${desc.seed} · ${Array.isArray(desc.squad) ? desc.squad.length : 4} soldiers · ${roster}${t.alerted ? ' · alerted' : ''}${t.objective === 'eliminate' ? ' · eliminate' : ''}${t.rounds ? ` · ${t.rounds} rounds` : ''}`;
    }
    validDesc() {
        try { return sanitizeDesc(this.desc); } catch (err) { this.hooks.status(`Setup problem: ${err.message}`); return null; }
    }
    clearPreview() { this.preview = null; this.previewHtml = ''; }

    onChange(e) {
        const f = e.target.dataset.tgField; if (!f) return;
        const v = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
        if (f === 'squad') this.c.squad[+e.target.dataset.arg] = v;
        else if (f === 'seed') this.c.seed = Math.max(0, Math.min(0xffffffff, Math.floor(Number(v) || 0)));
        else if (f === 'podSize') this.c.podSize = Number(v);
        else if (f === 'name') { this.name = v; return; }
        else this.c[f] = v;
        if (f !== 'autopilot' && f !== 'debug') this.clearPreview();
        this.render();
    }
    async onClick(e) {
        const b = e.target.closest('button'); if (!b) return;
        const act = b.dataset.tg, arg = b.dataset.arg, c = this.c;
        if (b.closest('.tg-modal')) return this.onReportAction(b.dataset.act, b.dataset.arg);
        if (!act) return;
        switch (act) {
            case 'dice': c.seed = 1 + Math.floor(Math.random() * 99999); break;
            case 'addSoldier': if (c.squad.length < MAX_SQUAD) c.squad.push('vanguard'); break;
            case 'removeSoldier': if (c.squad.length > 1) c.squad.splice(+arg, 1); break;
            case 'squadPreset': c.squad = [...SQUADS[arg]]; break;
            case 'inc': if ((c.roster[arg] || 0) < TEST_LIMITS.perType && this.total() < TEST_LIMITS.total) c.roster[arg] = (c.roster[arg] || 0) + 1; break;
            case 'dec': c.roster[arg] = Math.max(0, (c.roster[arg] || 0) - 1); break;
            case 'preset': c.roster = { ...TEST_PRESETS[arg].enemies }; c.useMapHostiles = false; break;
            case 'clearRoster': c.roster = {}; break;
            case 'useMap': c.useMapHostiles = arg === '1'; break;
            case 'preview': return this.runPreview();
            case 'launch': { const d = this.validDesc(); if (d) this.hooks.launch(d, { autopilot: c.autopilot }, structuredClone(c)); return; }
            case 'host': { const d = this.validDesc(); if (d) this.hooks.host(d, { autopilot: c.autopilot }, structuredClone(c)); return; }
            case 'save': {
                const d = this.validDesc(); if (!d) return;
                const name = (this.name || '').trim() || this.summary(d).slice(0, 48);
                this.hooks.status(saveScenario(name, d, { autopilot: c.autopilot }) ? `Saved “${name}”.` : 'Could not save: browser storage is unavailable.');
                break;
            }
            case 'link': {
                const d = this.validDesc(); if (!d) return;
                const url = `${location.origin}${location.pathname}?test=${encodeSetup({ desc: d, client: { autopilot: c.autopilot } })}`;
                try { await navigator.clipboard.writeText(url); this.hooks.status('Link copied — it launches this exact setup.'); } catch { this.hooks.status(url); }
                return;
            }
            case 'load': { const s = loadScenarios()[+arg]; if (s) { this.c = descToSetup(s.desc, s.client); this.name = s.name; this.hooks.status(`Loaded “${s.name}”.`); } break; }
            case 'delete': { const s = loadScenarios()[+arg]; if (s) deleteScenario(s.name); break; }
            case 'view': { const r = loadReports()[+arg]; if (r) this.viewing = { report: r, tab: 'squad' }; break; }
            case 'replayReport': { const r = loadReports()[+arg]; if (r) { const d = this.safe(reportToDesc(r)); if (d) this.hooks.launch(d, { autopilot: !!r.run.autopilot }, descToSetup(d, { autopilot: r.run.autopilot })); } return; }
            case 'clearReports': clearReports(); break;
            default: return;
        }
        if (['dice', 'addSoldier', 'removeSoldier', 'squadPreset', 'inc', 'dec', 'preset', 'clearRoster', 'useMap', 'load'].includes(act)) this.clearPreview();
        this.render();
    }
    safe(desc) { try { return sanitizeDesc(desc); } catch (err) { this.hooks.status(`Cannot replay: ${err.message}`); return null; } }
    onReportAction(act, arg) {
        const r = this.viewing?.report; if (!r) return;
        switch (act) {
            case 'rtab': this.viewing.tab = arg; break;
            case 'menu': this.viewing = null; break;
            case 'restart': { const d = this.safe(reportToDesc(r)); if (d) this.hooks.launch(d, { autopilot: !!r.run.autopilot }, descToSetup(d, { autopilot: r.run.autopilot })); return; }
            case 'reportEdit': this.c = descToSetup(reportToDesc(r), { autopilot: r.run.autopilot }); this.viewing = null; this.clearPreview(); break;
            case 'reportCopy': navigator.clipboard?.writeText(reportText(r)).then(() => this.hooks.status('Report summary copied.'), () => this.hooks.status('Copy failed.')); return;
            case 'reportJson': downloadJson(`report-${r.scenario.id}-${r.scenario.seed}.json`, r); return;
            default: return;
        }
        this.render();
    }
    async runPreview() {
        const d = this.validDesc(); if (!d) return;
        this.hooks.status(d.scenario === OPERATION_ID ? 'Generating the operation…' : 'Building the map…');
        await new Promise(r => requestAnimationFrame(() => setTimeout(r, 0)));
        try {
            const t = performance.now(), b = createBattle(d), enemies = b.units.filter(u => u.side === 'enemy'), squad = b.units.filter(u => u.side === 'player');
            const nearest = Math.min(...enemies.map(e => Math.min(...squad.map(p => Math.hypot(p.x - e.x, p.y - e.y)))));
            const counts = {};
            for (const e of enemies) counts[e.type] = (counts[e.type] || 0) + 1;
            this.preview = b;
            this.previewHtml = `<b>${esc(b.mission.name)}</b><span>${b.store.width}×${b.store.depth} · ${esc(b.mission.meta?.timeOfDay || 'day')} · ${esc(b.objective.kind)}${b.objective.turns ? ` · deadline round ${b.objective.turns}` : ''}</span>
              <span>${enemies.length} hostiles in ${new Set(enemies.map(e => e.group)).size} pods · nearest ${nearest.toFixed(1)} tiles from the squad</span>
              <ul class="tg-legend"><li><span class="tg-mark tg-mark-squad"></span>Squad spawn</li>${Object.entries(counts).map(([t, n]) => { const st = styleOf(t); return `<li><span class="tg-mark" style="background:${st.color}">${st.letter}</span>${esc(ENEMIES[t]?.name || t)} ×${n}</li>`; }).join('')}${b.objective.zone || b.objective.item ? '<li><span class="tg-mark tg-mark-obj">★</span>Objective</li>' : ''}</ul>
              <span class="tg-time">${Math.round(performance.now() - t)} ms</span>`;
            this.hooks.status('');
        } catch (err) { console.error(err); this.clearPreview(); this.hooks.status(`Preview failed: ${err.message}`); }
        this.render();
    }
}
