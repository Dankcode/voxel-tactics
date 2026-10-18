import { reviewDispatch } from './ui/DispatchScreen.js';
import { InventoryPrep } from './ui/InventoryPrep.js';
import { Game } from './Game.js';
import { LocalSession } from './net/LocalSession.js';
import { OnlineSession } from './net/OnlineSession.js';
import { SQUADS } from '../../shared/content/units.js';
import { OPERATION_ID, operationFor, plotForMap } from '../../shared/session/Scenarios.js';
import { PLOT_FAMILIES, PLOT_IDS } from '../../shared/mapgen/PlotCatalogue.js';
import { OPERATION_OBJECTIVES, OPERATION_TIMES } from '../../shared/mapgen/Generator.js';
import { drawOperationPreview } from './ui/OperationPreview.js';
import { decodeSetup } from './ui/TestGroundStore.js';
import { sanitizeDesc } from '../../shared/session/Scenarios.js';

const $ = s => document.querySelector(s);
const esc = s => String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const params = new URLSearchParams(location.search);
// Which code this page was built from (vite.config.js): the shared :2567 server uses live source
// in development and the last build in production.
const BUILD = typeof __BUILD__ !== 'undefined' ? __BUILD__ : { commit: 'dev', time: '', dirty: false };
const menu = $('#menu');
let game = null;

async function showMenu(opts = {}) {
    menu.classList.remove('hidden');
    const defaultServer = `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}`;
    // PLAN-10: no fixed maps to pick — a theme and a seed; old map links open the closest theme.
    const linked = opts.desc?.scenario || params.get('map');
    const pick = OPERATION_ID;
    const op = { plot: PLOT_IDS.includes(opts.desc?.operation?.plot) ? opts.desc.operation.plot : PLOT_IDS.includes(params.get('plot')) ? params.get('plot') : linked && linked !== OPERATION_ID ? plotForMap(linked) : 'downtown', objective: OPERATION_OBJECTIVES.includes(params.get('objective')) ? params.get('objective') : '', timeOfDay: OPERATION_TIMES.includes(params.get('time')) ? params.get('time') : '' };
    menu.innerHTML = `
      <div class="menu-card">
        <h1>FIRETEAM</h1>
        <p class="tag">Present-day tactical operations · co-op</p><p><a href="/staging.html">Co-op briefing lobby</a> · <a href="/campaign.html">Campaign prototype</a></p>
        <div id="tab-play" role="tabpanel">
        <section class="operation ${pick === OPERATION_ID ? 'on' : ''}" id="m-op" data-map="${OPERATION_ID}">
          <div class="op-head"><b>Choose a theme</b><span>Every battle is a new map generated from the theme and the seed: streets, lots and buildings with full interiors, cover along the line of advance, a tunnel flank and fire escapes, all checked by the map gates. Roll the dice for a fresh one.</span></div>
          <div class="plots">${PLOT_IDS.map(id => `<button class="plot ${id === op.plot ? 'on' : ''}" data-plot="${id}"><b>${esc(PLOT_FAMILIES[id].name)}</b><span>${esc(PLOT_FAMILIES[id].text)}</span></button>`).join('')}</div>
          <div class="row">
            <label>Objective <select id="m-objective"><option value="">Auto</option>${OPERATION_OBJECTIVES.map(o => `<option value="${o}" ${o === op.objective ? 'selected' : ''}>${o[0].toUpperCase() + o.slice(1)}</option>`).join('')}</select></label>
            <label>Time <select id="m-time"><option value="">Auto</option>${OPERATION_TIMES.map(t => `<option value="${t}" ${t === op.timeOfDay ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
            <button id="m-dice" title="Random seed" aria-label="Random seed">🎲</button>
            <button id="m-preview">Preview</button>
          </div>
          <div class="preview" id="m-preview-box" hidden><canvas id="m-canvas" aria-label="Operation map preview"></canvas><div class="op-info" id="m-op-info"></div></div>
        </section>
        <div class="row">
          <label>Seed <input id="m-seed" type="number" value="${Number(opts.desc?.seed ?? params.get('seed')) || 1 + Math.floor(Math.random() * 99999)}" min="0" max="4294967295"></label>
          <label>Squad <select id="m-squad">${Object.keys(SQUADS).map(k => `<option ${opts.desc?.squad===k?'selected':''}>${k}</option>`).join('')}</select></label>
        </div>
        <label class="check"><input id="m-debug" type="checkbox" ${(opts.desc?.debug??!!params.get('debug')) ? 'checked' : ''}> Debug mode (F1 in battle: spawn, teleport, destroy, elements, overlays, AI stepping, operation generator)</label>
        <label class="check"><input id="m-arsenal" type="checkbox" ${opts.desc?.test?'checked':''}> Full arsenal for testing · all weapons and grenades, ammo and spare containers on the selected map</label>
        <label class="check"><input id="m-intel" type="checkbox" ${(opts.desc?.intel??!!params.get('intel')) ? 'checked' : ''}> Intel co-op rules (experimental) · sensing roles, drones, quiet cuts, precision shots, independent turns</label>
        <label id="m-support-row" ${params.get('intel') ? '' : 'hidden'}>Match support <select id="m-support"><option value="carpet_bomb">Airstrike · three blasts in a square</option><option value="orbital_laser">Orbital Laser · long line cut</option></select></label>
        <section id="m-inventory"></section>
        <div class="row buttons">
          <button id="m-local" class="primary">Play vs AI</button>
          <button id="m-host">Host online co-op</button>
        </div>
        </div>
        <div class="row">
          <label>Server <input id="m-server" value="${defaultServer}"></label>
          <label>Room <input id="m-room" placeholder="room code"></label>
          <button id="m-join">Join</button>
        </div>
        <p class="status" id="m-status" role="status"></p>
        <p class="small">Online co-op uses this same game server. Units are dealt to players round-robin; the squad ends its turn when every player has pressed End turn. With the experimental intel rules each player ends and refreshes their own turn, with an enemy response per completion; supports unlock after detection and recharge every 10 personal turns; sensor contacts are shared snapshots, not firing targets.</p>
        <p class="small build">Build ${esc(BUILD.commit)} · ${esc(BUILD.time)}${BUILD.dirty ? ' · uncommitted changes' : ''}</p>
      </div>`;
    $('#m-intel').onchange = e => { $('#m-support-row').hidden = !e.target.checked; };
    const prep=new InventoryPrep($('#m-inventory'),$('#m-squad').value);
    if(opts.desc?.inventories&&opts.desc.inventories.length<=prep.packs.length){prep.packs=prep.packs.map((pack,i)=>structuredClone(opts.desc.inventories[i]??pack));prep.render();}
    $('#m-squad').onchange=()=>prep.reset($('#m-squad').value);
    let scenario = pick;
    const select = id => { scenario = OPERATION_ID; menu.querySelectorAll('[data-map]').forEach(o => o.classList.toggle('on', o.dataset.map === scenario)); };
    select(pick);
    menu.querySelectorAll('[data-plot]').forEach(b => b.onclick = () => {
        op.plot = b.dataset.plot; select(OPERATION_ID);
        menu.querySelectorAll('[data-plot]').forEach(o => o.classList.toggle('on', o === b));
        if (!$('#m-preview-box').hidden) preview();
    });
    $('#m-objective').onchange = e => { op.objective = e.target.value; select(OPERATION_ID); };
    $('#m-time').onchange = e => { op.timeOfDay = e.target.value; select(OPERATION_ID); };
    $('#m-dice').onclick = () => { $('#m-seed').value = 1 + Math.floor(Math.random() * 99999); select(OPERATION_ID); if (!$('#m-preview-box').hidden) preview(); };
    const operation = () => ({ plot: op.plot, objective: op.objective || null, timeOfDay: op.timeOfDay || null });
    const desc = () => ({ scenario, seed: Number($('#m-seed').value) || 1, squad: $('#m-squad').value, debug: $('#m-debug').checked, intel: $('#m-intel').checked, asyncCoop: $('#m-intel').checked, support: $('#m-support').value, inventories: prep.inventories(), ...($('#m-arsenal').checked?{test:{}}:{}), ...(scenario === OPERATION_ID ? { operation: operation() } : {}) });
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
    const launch = (make, { generating = scenario === OPERATION_ID, debug = desc().debug, autopilot = false,skipReview } = {}) =>
        startBattle(make, { generating, debug, autopilot, skipReview, status });
    $('#m-local').onclick = () => launch(() => LocalSession.create(desc()));
    $('#m-host').onclick = () => launch(() => OnlineSession.connect({url:$('#m-server').value,desc:desc(),support:$('#m-support').value}));
    $('#m-join').onclick = () => launch(() => OnlineSession.connect({ url: $('#m-server').value, roomId: $('#m-room').value.trim(), support: $('#m-support').value }), { generating: false, debug: false });

}

/** Build a session, hide the menu and start the battle (Play and saved deep links). */
async function startBattle(make, { generating = false, debug = false, autopilot = false, skipReview = params.has('quick'), status = () => {} } = {}) {
    try {
        status(generating ? 'Generating the operation…' : 'Building the battlefield…');
        await new Promise(r => requestAnimationFrame(() => setTimeout(r, 0)));
        const session = await make();
        if(!skipReview&&!await reviewDispatch(menu,session)){session.leave?.();session.battle.light.dispose();await showMenu({desc:session.desc});return;}
        menu.classList.add('hidden');
        if (!game) game = new Game({ canvas: $('#view'), hudRoot: $('#hud'), cutinRoot: $('#cutin-layer'), floatRoot: $('#float-layer'), onExit: o => { game.session?.leave?.(); game.autoPlayer = false; showMenu(o); } });
        await game.start(session);
        if (debug && !game.debug.enabled) game.debug.enable(true);
        game.autoPlayer = !!autopilot;
        if (autopilot) game.maybeRunAi();
        window.__game = game;
        if (session.roomId) game.hud.log(`Room code: ${session.roomId} — share it with your squadmates`);
    } catch (err) { console.error(err); status(`Failed: ${err.message}`); if (menu.classList.contains('hidden')) showMenu(); }
}

// PLAN-10: ?play=operation&plot=downtown is the generated game; an old map id opens its closest theme instead, unless
// &fixture=1 asks for the fixed test map itself (debugging only).
const playId = params.get('play'), fixture = params.has('fixture') && playId !== OPERATION_ID;
const playOperation = () => fixture ? undefined : { plot: playId === OPERATION_ID ? params.get('plot') : plotForMap(playId), objective: params.get('objective'), timeOfDay: params.get('time') };
// Test-ground deep link: ?test=<setup> (made by "Copy link") launches that exact setup.
if (params.get('staged')) {
    const launch = JSON.parse(sessionStorage.getItem('fireteam.launch') || 'null');
    showMenu().then(() => launch ? startBattle(() => OnlineSession.connect(launch), {status: text => { $('#m-status').textContent=text; }}) : $('#m-status').textContent='No staging seat found. Open the co-op briefing lobby.');
} else if (params.get('test')) {
    let setup = null;
    try { setup = decodeSetup(params.get('test')); setup.desc = sanitizeDesc(setup.desc); } catch (err) { console.error(err); setup = null; }
    if (setup) startBattle(() => LocalSession.create(setup.desc), { generating: setup.desc.scenario === OPERATION_ID, debug: !!setup.desc.debug, autopilot: !!setup.client?.autopilot || !!params.get('auto') });
    else showMenu();
} else
// Deep link for quick testing: ?play=cedar-close&seed=3 (&debug=1 &auto=1)
if(playId&&params.has('brief')) {
    showMenu().then(()=>startBattle(()=>LocalSession.create({scenario:fixture?playId:OPERATION_ID,operation:playOperation(),seed:Number(params.get('seed'))||1,debug:!!params.get('debug')}),{generating:!fixture}));
} else if (playId) {
    const operation = playOperation();
    LocalSession.create({ scenario: fixture ? playId : OPERATION_ID, seed: Number(params.get('seed')) || 1, squad: params.get('squad') || 'standard', debug: !!params.get('debug'), operation, ...(params.get('intel') ? { intel: true, asyncCoop: true, support: params.get('support') === 'orbital_laser' ? 'orbital_laser' : 'carpet_bomb' } : {}) }).then(async session => {
        menu.classList.add('hidden');
        game = new Game({ canvas: $('#view'), hudRoot: $('#hud'), cutinRoot: $('#cutin-layer'), floatRoot: $('#float-layer'), onExit: showMenu });
        await game.start(session);
        if (params.get('auto')) { game.autoPlayer = true; game.maybeRunAi(); }
        window.__game = game;
    });
} else showMenu();
