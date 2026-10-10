import { InventoryPrep } from './ui/InventoryPrep.js';
import { Game } from './Game.js';
import { LocalSession } from './net/LocalSession.js';
import { OnlineSession } from './net/OnlineSession.js';
import { SQUADS } from '../../shared/content/units.js';
import { SCENARIOS, OPERATION_ID, operationFor } from '../../shared/session/Scenarios.js';
import { PLOT_FAMILIES, PLOT_IDS } from '../../shared/mapgen/PlotCatalogue.js';
import { OPERATION_OBJECTIVES, OPERATION_TIMES } from '../../shared/mapgen/Generator.js';
import { drawOperationPreview } from './ui/OperationPreview.js';

const $ = s => document.querySelector(s);
const esc = s => String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const params = new URLSearchParams(location.search);
const menu = $('#menu');
let game = null;

async function showMenu() {
    menu.classList.remove('hidden');
    const defaultServer = `ws://${location.hostname || 'localhost'}:2567`;
    const themes = [...new Set(SCENARIOS.map(s => s.theme))];
    const linked = params.get('map');
    const pick = linked === OPERATION_ID || !linked ? OPERATION_ID : SCENARIOS.some(s => s.id === linked) ? linked : SCENARIOS[0].id;
    const op = { plot: PLOT_IDS.includes(params.get('plot')) ? params.get('plot') : 'downtown', objective: OPERATION_OBJECTIVES.includes(params.get('objective')) ? params.get('objective') : '', timeOfDay: OPERATION_TIMES.includes(params.get('time')) ? params.get('time') : '' };
    menu.innerHTML = `
      <div class="menu-card">
        <h1>FIRETEAM</h1>
        <p class="tag">Present-day tactical operations · co-op</p>
        <section class="operation ${pick === OPERATION_ID ? 'on' : ''}" id="m-op" data-map="${OPERATION_ID}">
          <div class="op-head"><b>Generated operation</b><span>A new map every seed: a plot, its lots and buildings, interiors, cover along the line of advance, a tunnel flank and a fire escape — checked by the same gates as the authored maps.</span></div>
          <div class="plots">${PLOT_IDS.map(id => `<button class="plot ${id === op.plot ? 'on' : ''}" data-plot="${id}"><b>${esc(PLOT_FAMILIES[id].name)}</b><span>${esc(PLOT_FAMILIES[id].text)}</span></button>`).join('')}</div>
          <div class="row">
            <label>Objective <select id="m-objective"><option value="">Auto</option>${OPERATION_OBJECTIVES.map(o => `<option value="${o}" ${o === op.objective ? 'selected' : ''}>${o[0].toUpperCase() + o.slice(1)}</option>`).join('')}</select></label>
            <label>Time <select id="m-time"><option value="">Auto</option>${OPERATION_TIMES.map(t => `<option value="${t}" ${t === op.timeOfDay ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
            <button id="m-dice" title="Random seed" aria-label="Random seed">🎲</button>
            <button id="m-preview">Preview</button>
          </div>
          <div class="preview" id="m-preview-box" hidden><canvas id="m-canvas" aria-label="Operation map preview"></canvas><div class="op-info" id="m-op-info"></div></div>
        </section>
        <div class="maps" id="m-maps">${themes.map(t => `<div class="theme"><h4>${esc(t)}</h4>${SCENARIOS.filter(s => s.theme === t).map(s =>
            `<button class="map ${s.id === pick ? 'on' : ''}" data-map="${s.id}"><b>${esc(s.name)}</b><span>${esc(s.text)}</span></button>`).join('')}</div>`).join('')}</div>
        <div class="row">
          <label>Seed <input id="m-seed" type="number" value="${Number(params.get('seed')) || 1}" min="0" max="4294967295"></label>
          <label>Squad <select id="m-squad">${Object.keys(SQUADS).map(k => `<option>${k}</option>`).join('')}</select></label>
        </div>
        <label class="check"><input id="m-debug" type="checkbox" ${params.get('debug') ? 'checked' : ''}> Debug mode (F1 in battle: spawn, teleport, destroy, elements, overlays, AI stepping, operation generator)</label>
        <section id="m-inventory"></section>
        <div class="row buttons">
          <button id="m-local" class="primary">Play vs AI</button>
          <button id="m-host">Host online co-op</button>
        </div>
        <div class="row">
          <label>Server <input id="m-server" value="${defaultServer}"></label>
          <label>Room <input id="m-room" placeholder="room code"></label>
          <button id="m-join">Join</button>
        </div>
        <p class="status" id="m-status" role="status"></p>
        <p class="small">Online co-op needs <code>npm run server</code> running. Units are dealt to players round-robin; the squad ends its turn when every player has pressed End turn. Generated operations are rebuilt from the seed on every peer.</p>
      </div>`;
    const prep=new InventoryPrep($('#m-inventory'),$('#m-squad').value);
    $('#m-squad').onchange=()=>prep.reset($('#m-squad').value);
    let scenario = pick;
    const select = id => {
        scenario = id;
        menu.querySelectorAll('[data-map]').forEach(o => o.classList.toggle('on', o.dataset.map === id));
    };
    menu.querySelectorAll('button[data-map]').forEach(b => b.onclick = () => select(b.dataset.map));
    $('#m-op').onclick = e => { if (!e.target.closest('select, input, button[data-map]')) select(OPERATION_ID); };
    menu.querySelectorAll('[data-plot]').forEach(b => b.onclick = () => {
        op.plot = b.dataset.plot; select(OPERATION_ID);
        menu.querySelectorAll('[data-plot]').forEach(o => o.classList.toggle('on', o === b));
        if (!$('#m-preview-box').hidden) preview();
    });
    $('#m-objective').onchange = e => { op.objective = e.target.value; select(OPERATION_ID); };
    $('#m-time').onchange = e => { op.timeOfDay = e.target.value; select(OPERATION_ID); };
    $('#m-dice').onclick = () => { $('#m-seed').value = 1 + Math.floor(Math.random() * 99999); select(OPERATION_ID); if (!$('#m-preview-box').hidden) preview(); };
    const operation = () => ({ plot: op.plot, objective: op.objective || null, timeOfDay: op.timeOfDay || null });
    const desc = () => ({ scenario, seed: Number($('#m-seed').value) || 1, squad: $('#m-squad').value, debug: $('#m-debug').checked, inventories: prep.inventories(), ...(scenario === OPERATION_ID ? { operation: operation() } : {}) });
    const status = t => { $('#m-status').textContent = t; };
    const preview = async () => {
        select(OPERATION_ID);
        status('Generating the operation…');
        await new Promise(r => requestAnimationFrame(() => setTimeout(r, 0)));
        try {
            const t = performance.now(), data = operationFor(desc());
            $('#m-preview-box').hidden = false;
            drawOperationPreview($('#m-canvas'), data);
            const { layout, design } = data, critic = layout.critic;
            $('#m-op-info').innerHTML = `<b>${esc(design.mission.title)}</b> · ${esc(design.mission.kind)} · ${esc(design.mission.timeOfDay)}<br>${esc(design.mission.briefing)}<br>
                <span>${layout.buildings.length} buildings (${layout.buildings.map(b => b.storeys).join('/')} storeys) · ${layout.pockets.length} pockets · ${layout.layers ? `${layout.layers.kind}${layout.layers.drop ? ' + drop' : ''}` : 'no tunnel'} · ${design.encounters.reduce((n, e) => n + e.types.length, 0) + (layout.layers ? 1 : 0)} hostiles${critic ? ` · critic ${critic.total}` : ''} · ${Math.round(performance.now() - t)} ms</span>`;
            status('');
        } catch (err) { console.error(err); status(`Generation failed: ${err.message}`); }
    };
    $('#m-preview').onclick = preview;
    const launch = async make => {
        try {
            status(scenario === OPERATION_ID ? 'Generating the operation…' : 'Building the battlefield…');
            await new Promise(r => requestAnimationFrame(() => setTimeout(r, 0)));
            const session = await make();
            menu.classList.add('hidden');
            if (!game) game = new Game({ canvas: $('#view'), hudRoot: $('#hud'), cutinRoot: $('#cutin-layer'), floatRoot: $('#float-layer'), onExit: () => { session.leave?.(); showMenu(); } });
            await game.start(session);
            if (desc().debug && !game.debug.enabled) game.debug.enable(true);
            window.__game = game;
            if (session.roomId) game.hud.log(`Room code: ${session.roomId} — share it with your squadmates`);
        } catch (err) { console.error(err); status(`Failed: ${err.message}`); }
    };
    $('#m-local').onclick = () => launch(() => LocalSession.create(desc()));
    $('#m-host').onclick = () => launch(() => OnlineSession.connect({ url: $('#m-server').value, desc: desc() }));
    $('#m-join').onclick = () => launch(() => OnlineSession.connect({ url: $('#m-server').value, roomId: $('#m-room').value.trim() }));
}

// Deep link for quick testing: ?play=cedar-close&seed=3 (&debug=1 &auto=1 &cutins=off)
if (params.get('play')) {
    const operation = params.get('play') === OPERATION_ID ? { plot: params.get('plot'), objective: params.get('objective'), timeOfDay: params.get('time') } : undefined;
    LocalSession.create({ scenario: params.get('play'), seed: Number(params.get('seed')) || 1, squad: params.get('squad') || 'standard', debug: !!params.get('debug'), operation }).then(async session => {
        menu.classList.add('hidden');
        game = new Game({ canvas: $('#view'), hudRoot: $('#hud'), cutinRoot: $('#cutin-layer'), floatRoot: $('#float-layer'), onExit: showMenu });
        await game.start(session);
        if (params.get('cutins')) game.cutins.mode = params.get('cutins');
        if (params.get('auto')) { game.autoPlayer = true; game.maybeRunAi(); }
        window.__game = game;
    });
} else showMenu();
