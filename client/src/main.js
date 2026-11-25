import { reviewDispatch } from './ui/DispatchScreen.js';
import { InventoryPrep } from './ui/InventoryPrep.js';
import { TestGroundPanel } from './ui/TestGroundPanel.js';
import { loadCharacterArt } from './units/UnitView.js';
import { Game } from './Game.js';
import { LocalSession } from './net/LocalSession.js';
import { OnlineSession } from './net/OnlineSession.js';
import { SOLO_ONLY } from './net/Hosting.js';
import { SQUADS, CLASSES } from '../../shared/content/units.js';
import { SCENARIOS, OPERATION_ID, operationFor, plotForMap, sanitizeDesc } from '../../shared/session/Scenarios.js';
import { PLOT_FAMILIES, PLOT_IDS } from '../../shared/mapgen/PlotCatalogue.js';
import { OPERATION_OBJECTIVES, OPERATION_TIMES, OPERATION_FLOWS } from '../../shared/mapgen/Generator.js';
import { FLOW_LABELS } from '../../shared/mapgen/TerrainFeatures.js';
import { THEATER_OPERATIONS, theaterCatalog, regionalContracts, findTheaterOp, nextRecommendedOp, buildLaunchDescriptor } from '../../shared/campaign/OperationsTheater.js';
import { loadTheater, setActiveTheaterOp, resetTheater } from './net/CampaignStore.js';
import { drawOperationPreview } from './ui/OperationPreview.js';
import { decodeSetup } from './ui/TestGroundStore.js';
import { loading } from './ui/LoadingScreen.js';

const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const params = new URLSearchParams(location.search);
const BUILD = typeof __BUILD__ !== 'undefined' ? __BUILD__ : { commit: 'dev', time: '', dirty: false };
const menu = $('#menu');
let game = null;
let activePrep = null;

const PLOT_TAGS = {
    downtown: 'Urban · Multi-storey',
    industrial: 'Freight · Metal Roofs',
    suburb: 'Pitched Roofs · Gardens',
    harbor: 'Waterfront · Canals',
    winter_outpost: 'Alpine · Ice Ridges',
    old_quarter: 'Historic · Cobblestone',
    metro_hub: 'Subway + Skybridge',
    arid_compound: 'Desert · Terraces',
    canal_district: 'Waterway · Bridges & Quays',
    hillside_ridge: 'Highland · Stepped Bluffs',
    sunken_basin: 'Basin · Sunken Lower Field'
};
const CURATED_IDS = [
    'burger-district', 'cedar-close', 'main-street', 'harbor-yard', 'route-9', 'proving-grounds',
    'park-district', 'mall-district', 'dockside-district', 'terrace-district', 'architecture-yard'
];
const CURATED_MAPS = CURATED_IDS.map(id => SCENARIOS.find(s => s.id === id)).filter(Boolean);

const exitHandler = o => {
    const wasCampaign = !!game?.session?.desc?.campaignOpId;
    game?.pause?.();
    game?.session?.leave?.();
    if (game) game.autoPlayer = false;
    showMenu({ tab: o?.tab || (wasCampaign ? 'campaign' : 'play'), ...o });
};

function launchTheaterOp(op, { skipReview = true, debug = false } = {}) {
    if (!op) return;
    setActiveTheaterOp(op.id);
    const launchDesc = buildLaunchDescriptor(op, { squad: 'standard', extra: { debug } });
    return startBattle(() => LocalSession.create(launchDesc), {
        generating: true,
        debug,
        skipReview,
        loadingInfo: {
            title: `${op.code} · ${op.name}`,
            badges: [
                PLOT_FAMILIES[op.plot]?.name || op.plot,
                op.objective?.toUpperCase(),
                FLOW_LABELS[op.verticalFlow] || op.verticalFlow,
                `Seed ${op.seed}`
            ],
            briefing: op.briefing
        }
    });
}

function nextOpHandler(opId) {
    const state = loadTheater();
    const op = findTheaterOp(opId, state) || nextRecommendedOp(state);
    if (!op) { showMenu({ tab: 'campaign' }); return; }
    launchTheaterOp(op);
}

function ensureGame() {
    if (!game) {
        game = new Game({
            canvas: $('#view'),
            hudRoot: $('#hud'),
            cutinRoot: $('#cutin-layer'),
            floatRoot: $('#float-layer'),
            onExit: exitHandler,
            onNextOp: nextOpHandler
        });
    }
    return game;
}

async function showMenu(opts = {}) {
    loading.hide();
    activePrep?.dispose?.(); activePrep = null;
    game?.pause?.();
    menu.classList.remove('hidden');
    const defaultServer = `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}`;
    const linked = opts.desc?.scenario || params.get('map');
    const pick = OPERATION_ID;
    const op = {
        plot: PLOT_IDS.includes(opts.desc?.operation?.plot) ? opts.desc.operation.plot : PLOT_IDS.includes(params.get('plot')) ? params.get('plot') : linked && linked !== OPERATION_ID ? plotForMap(linked) : 'downtown',
        objective: OPERATION_OBJECTIVES.includes(params.get('objective')) ? params.get('objective') : (opts.desc?.operation?.objective || ''),
        verticalFlow: OPERATION_FLOWS.includes(params.get('flow')) ? params.get('flow') : (opts.desc?.operation?.verticalFlow || 'auto'),
        timeOfDay: OPERATION_TIMES.includes(params.get('time')) ? params.get('time') : (opts.desc?.operation?.timeOfDay || '')
    };
    const validTabs = ['campaign', 'play', 'curated', 'squad', 'test', ...(SOLO_ONLY ? [] : ['coop'])];
    const reqTab = opts.tab || params.get('tab');
    let tab = validTabs.includes(reqTab) ? reqTab : (opts.desc || params.get('plot') || linked ? 'play' : 'campaign');

    let theaterState = loadTheater();
    let catalog = theaterCatalog(theaterState);
    let contracts = regionalContracts(theaterState.day);
    let activeOp = findTheaterOp(theaterState.activeOpId, theaterState)
        || catalog.find(o => o.status === 'available')
        || catalog[0];

    const intelInit = !!(opts.desc?.intel ?? !!params.get('intel'));
    const debugInit = !!(opts.desc?.debug ?? !!params.get('debug'));
    const arsenalInit = !!opts.desc?.test;
    const advancedOpen = debugInit || arsenalInit || intelInit;
    const seedInit = Number(opts.desc?.seed ?? params.get('seed')) || 1 + Math.floor(Math.random() * 99999);

    menu.innerHTML = `
      <div class="menu-card">
        <header class="menu-header">
          <div>
            <h1>FIRETEAM</h1>
            <p class="tag">XCOM + Phoenix Point Ballistics · ${SOLO_ONLY ? 'Solo Tactical' : 'Solo & Co-op'}${SOLO_ONLY ? '' : ' · <a href="/staging.html">Co-op Lobby</a>'} · <a href="/campaign.html">HQ</a></p>
          </div>
          <div class="menu-actions">
            <button id="m-quick" class="quick" title="Boot into tactical play in one click">⚡ Quick Deploy</button>
            <button id="m-local" class="primary">▶ Deploy Mission</button>
            <button id="m-brief" title="Inspect squad & map topography before deploying">Briefing</button>
          </div>
        </header>

        <nav class="menu-tabs" role="tablist">
          <button data-tab="campaign" role="tab">Operations Theater <small>${theaterState.completedIds.length}/${THEATER_OPERATIONS.length}</small></button>
          <button data-tab="play" role="tab">Skirmish <small>${PLOT_IDS.length} biomes</small></button>
          <button data-tab="curated" role="tab">Curated <small>${CURATED_MAPS.length}</small></button>
          <button data-tab="squad" role="tab">Squad</button>
          <button data-tab="test" role="tab">Test Ground</button>
          ${SOLO_ONLY ? '' : '<button data-tab="coop" role="tab">Co-op</button>'}
        </nav>

        <div data-tab-panel="campaign" role="tabpanel">
          <div class="theater-bar">
            <div class="theater-stats">
              <span class="stat-pill">Day <b>${theaterState.day}</b></span>
              <span class="stat-pill">Materials <b>${theaterState.materials}</b></span>
              <span class="stat-pill">Intel <b>${theaterState.intel}</b></span>
              <span class="stat-pill">Supplies <b>${theaterState.supplies}</b></span>
              <span class="stat-pill">Roster <b>${theaterState.roster.filter(r => r.status === 'ready').length}/${theaterState.roster.length}</b> Ready</span>
            </div>
            <button id="m-theater-reset" title="Reset campaign progress">↺ Reset Campaign</button>
          </div>

          <div class="theater-grid">
            <div>
              <h4 class="op-section-title">Designated Campaign Operations</h4>
              <div class="op-track" id="m-op-track">
                ${catalog.map(c => `
                  <button class="op-card ${c.id === activeOp.id ? 'on' : ''}" data-op-id="${esc(c.id)}" ${c.unlocked ? '' : 'disabled'}>
                    <span class="op-code">${esc(c.code)} · ${esc(PLOT_FAMILIES[c.plot]?.name || c.plot)}</span>
                    <span class="op-name">${esc(c.name)}</span>
                    <span class="op-meta">${esc(c.objective.toUpperCase())} · ${esc(FLOW_LABELS[c.verticalFlow] || c.verticalFlow)}</span>
                    <span class="op-state ${esc(c.status)}">${c.status === 'completed' ? 'Secured' : c.status === 'available' ? 'Ready' : 'Locked'}</span>
                  </button>`).join('')}
              </div>

              <h4 class="op-section-title">Regional Contracts · Day ${theaterState.day}</h4>
              <div class="contracts-row" id="m-contracts-track">
                ${contracts.map(c => `
                  <button class="op-card ${c.id === activeOp.id ? 'on' : ''}" data-op-id="${esc(c.id)}">
                    <span class="op-code">${esc(c.code)} · ${esc(PLOT_FAMILIES[c.plot]?.name || c.plot)}</span>
                    <span class="op-name">${esc(c.name)}</span>
                    <span class="op-meta">${esc(c.objective.toUpperCase())} · ${esc(FLOW_LABELS[c.verticalFlow] || c.verticalFlow)}</span>
                    <span class="op-state available">Contract</span>
                  </button>`).join('')}
              </div>
            </div>

            <div class="theater-detail" id="m-theater-detail">
              <div id="m-th-head"></div>
              <canvas id="m-th-canvas" class="preview-canvas" width="320" height="266" aria-label="Selected operation map preview"></canvas>
              <div class="op-info" id="m-th-meta"></div>
              <div class="theater-deploy-row">
                <button id="m-deploy-op" class="primary">▶ Deploy Operation</button>
                <button id="m-brief-op">Inspect Squad &amp; Topo</button>
              </div>
            </div>
          </div>
        </div>

        <div data-tab-panel="play" role="tabpanel" hidden>
          <section class="operation on" id="m-op" data-map="${OPERATION_ID}">
            <div class="op-head"><b>Choose an Operational Environment &amp; Elevation Flow</b><span>11 procedural biomes with canals, bridges, stepped hillside ridges, sunken basins, district/room WFC, and ballistics combat.</span></div>
            <div class="plots">${PLOT_IDS.map(id => `<button class="plot ${id === op.plot ? 'on' : ''}" data-plot="${id}"><em class="ptag">${esc(PLOT_TAGS[id] || PLOT_FAMILIES[id].theme)}</em><b>${esc(PLOT_FAMILIES[id].name)}</b><span>${esc(PLOT_FAMILIES[id].text)}</span></button>`).join('')}</div>
            <div class="row">
              <label>Seed <input id="m-seed" type="number" value="${seedInit}" min="0" max="4294967295"></label>
              <button id="m-dice" title="Random seed" aria-label="Random seed">🎲</button>
              <label>Objective <select id="m-objective"><option value="">Auto</option>${OPERATION_OBJECTIVES.map(o => `<option value="${o}" ${o === op.objective ? 'selected' : ''}>${o[0].toUpperCase() + o.slice(1)}</option>`).join('')}</select></label>
              <label>Vertical Flow <select id="m-flow">${OPERATION_FLOWS.map(f => `<option value="${f}" ${f === op.verticalFlow ? 'selected' : ''}>${esc(FLOW_LABELS[f] || f)}</option>`).join('')}</select></label>
              <label>Time <select id="m-time"><option value="">Auto</option>${OPERATION_TIMES.map(t => `<option value="${t}" ${t === op.timeOfDay ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
              <button id="m-preview">Preview Map</button>
            </div>
            <div class="preview" id="m-preview-box"><canvas id="m-canvas" class="preview-canvas" width="320" height="266" aria-label="Operation map preview"></canvas><div class="op-info" id="m-op-info"></div></div>
          </section>
          <details class="toggles-details" ${advancedOpen ? 'open' : ''}>
            <summary>Advanced options &amp; rules</summary>
            <div class="toggles-box">
              <label class="check"><input id="m-debug" type="checkbox" ${debugInit ? 'checked' : ''}> Debug mode (F1 in battle: spawn, teleport, destroy, overlays, AI stepping)</label>
              <label class="check"><input id="m-arsenal" type="checkbox" ${arsenalInit ? 'checked' : ''}> Full arsenal for testing · all weapons, grenades and ammo</label>
              <label class="check"><input id="m-intel" type="checkbox" ${intelInit ? 'checked' : ''}> Intel co-op rules (experimental) · sensing roles, drones &amp; airstrike</label>
              <label id="m-support-row" ${intelInit ? '' : 'hidden'}>Match support <select id="m-support"><option value="carpet_bomb">Airstrike · three blasts in a square</option><option value="orbital_laser">Orbital Laser · long line cut</option></select></label>
            </div>
          </details>
        </div>

        <div data-tab-panel="curated" role="tabpanel" hidden>
          <p class="small">Authored showcase &amp; fixture maps. Click any map card to deploy directly with the configured squad and seed.</p>
          <div class="curated-grid">${CURATED_MAPS.map(m => `<button class="curated-card" data-curated="${esc(m.id)}"><em>${esc(m.theme)}</em><b>${esc(m.name)}</b><span>${esc(m.text)}</span></button>`).join('')}</div>
        </div>

        <div data-tab-panel="squad" role="tabpanel" hidden>
          <div class="row">
            <label>Squad preset <select id="m-squad">${Object.keys(SQUADS).map(k => `<option ${opts.desc?.squad === k ? 'selected' : ''}>${k}</option>`).join('')}</select></label>
          </div>
          <section id="m-inventory"></section>
        </div>

        <div data-tab-panel="test" role="tabpanel" hidden>
          <div id="m-testground" class="tg"></div>
        </div>

        ${SOLO_ONLY ? '' : `<div data-tab-panel="coop" role="tabpanel" hidden>
          <p class="small">Host or join an authoritative co-op match on this game server. Units are dealt round-robin across players.</p>
          <div class="row buttons"><button id="m-host" class="primary">Host Online Co-op</button></div>
          <div class="row">
            <label>Server <input id="m-server" value="${defaultServer}"></label>
            <label>Room <input id="m-room" placeholder="room code"></label>
            <button id="m-join">Join Room</button>
          </div>
        </div>`}

        <p class="status" id="m-status" role="status"></p>
        <p class="small build">Build ${esc(BUILD.commit)} · ${esc(BUILD.time)}${BUILD.dirty ? ' · uncommitted changes' : ''}</p>
      </div>`;

    const status = t => { const el = $('#m-status'); if (el) el.textContent = t; };
    const prep = new InventoryPrep($('#m-inventory'), $('#m-squad').value);
    activePrep = prep;
    if (opts.desc?.inventories && opts.desc.inventories.length <= prep.packs.length) {
        prep.packs = prep.packs.map((pack, i) => structuredClone(opts.desc.inventories[i] ?? pack));
        prep.render();
    }
    $('#m-squad').onchange = () => prep.reset($('#m-squad').value);
    $('#m-intel').onchange = e => { $('#m-support-row').hidden = !e.target.checked; };

    let theaterReq = 0;
    const renderTheaterDetail = () => {
        const thHead = $('#m-th-head'), thMeta = $('#m-th-meta'), thCanvas = $('#m-th-canvas');
        if (!activeOp || !thHead || !thCanvas) return;
        const bio = PLOT_FAMILIES[activeOp.plot];
        const rw = activeOp.reward || { materials: 0, intel: 0, supplies: 0 };
        thHead.innerHTML = `
          <h3>${esc(activeOp.code)} · ${esc(activeOp.name)}</h3>
          <div class="theater-chips">
            <span class="theater-chip">${esc(bio?.name || activeOp.plot)}</span>
            <span class="theater-chip">Objective: ${esc(activeOp.objective)}</span>
            <span class="theater-chip">${esc(FLOW_LABELS[activeOp.verticalFlow] || activeOp.verticalFlow)}</span>
            <span class="theater-chip">Reward: +${rw.materials} Mat · +${rw.intel} Intel · +${rw.supplies} Supply</span>
          </div>
          <p class="theater-brief">${esc(activeOp.briefing)}</p>`;
        const deployBtn = $('#m-deploy-op');
        if (deployBtn) deployBtn.textContent = `▶ Deploy ${activeOp.code}: ${activeOp.name}`;
        thMeta.innerHTML = '<span>Rendering operation topography…</span>';
        const myReq = ++theaterReq;
        requestAnimationFrame(() => setTimeout(() => {
            if (myReq !== theaterReq) return;
            try {
                const t0 = performance.now();
                const d = buildLaunchDescriptor(activeOp, { squad: $('#m-squad').value });
                const data = operationFor(d);
                if (myReq !== theaterReq) return;
                drawOperationPreview(thCanvas, data);
                const { layout, design } = data;
                const tFeats = (layout.terrain?.features || []).map(f => f.kind);
                thMeta.innerHTML = `<b>${esc(design.mission.title)}</b> · ${esc(design.mission.timeOfDay)}<br>
                    <span>${layout.buildings.length} buildings · terrain: ${tFeats.length ? esc([...new Set(tFeats)].join(', ')) : 'flat grid'} · flow: ${esc(layout.terrain?.flow || 'auto')} · ${Math.round(performance.now() - t0)} ms</span>`;
            } catch (err) {
                thMeta.innerHTML = `<span>Preview unavailable: ${esc(err.message)}</span>`;
            }
        }, 0));
    };

    menu.querySelectorAll('[data-op-id]').forEach(btn => btn.onclick = () => {
        const picked = findTheaterOp(btn.dataset.opId, theaterState);
        if (!picked) return;
        activeOp = picked;
        setActiveTheaterOp(picked.id);
        menu.querySelectorAll('[data-op-id]').forEach(b => b.classList.toggle('on', b === btn));
        renderTheaterDetail();
    });

    $('#m-deploy-op').onclick = () => launchTheaterOp(activeOp, { skipReview: true, debug: $('#m-debug')?.checked });
    $('#m-brief-op').onclick = () => launchTheaterOp(activeOp, { skipReview: false, debug: $('#m-debug')?.checked });
    $('#m-theater-reset').onclick = () => { resetTheater(); showMenu({ tab: 'campaign' }); };

    let scenario = pick;
    const select = () => { scenario = OPERATION_ID; menu.querySelectorAll('[data-map]').forEach(o => o.classList.toggle('on', o.dataset.map === scenario)); };
    select();

    const operation = () => ({
        plot: op.plot,
        objective: op.objective || null,
        verticalFlow: op.verticalFlow || 'auto',
        timeOfDay: op.timeOfDay || null
    });
    const desc = () => ({
        scenario,
        seed: Number($('#m-seed').value) || 1,
        squad: $('#m-squad').value,
        debug: $('#m-debug').checked,
        intel: $('#m-intel').checked,
        asyncCoop: $('#m-intel').checked,
        support: $('#m-support').value,
        inventories: prep.inventories(),
        ...($('#m-arsenal').checked ? { test: {} } : {}),
        ...(scenario === OPERATION_ID ? { operation: operation() } : {})
    });

    let skirmishReq = 0;
    const preview = async () => {
        select();
        status('Generating skirmish topography…');
        const myReq = ++skirmishReq;
        await new Promise(r => requestAnimationFrame(() => setTimeout(r, 0)));
        if (myReq !== skirmishReq) return;
        try {
            const t = performance.now(), data = operationFor(desc());
            if (myReq !== skirmishReq) return;
            drawOperationPreview($('#m-canvas'), data);
            const { layout, design } = data, critic = layout.critic;
            const feats = (layout.terrain?.features || []).map(f => f.kind);
            $('#m-op-info').innerHTML = `<b>${esc(design.mission.title)}</b> · ${esc(design.mission.kind)} · ${esc(design.mission.timeOfDay)}<br>${esc(design.mission.briefing)}<br>
                <span>${layout.buildings.length} buildings · ${feats.length ? `terrain: ${esc([...new Set(feats)].join(', '))} · ` : ''}flow: ${esc(layout.terrain?.flow || 'auto')} · ${design.encounters.reduce((n, e) => n + e.types.length, 0) + (layout.layers ? 1 : 0)} hostiles${critic ? ` · critic ${critic.total}` : ''} · ${Math.round(performance.now() - t)} ms</span>`;
            status('');
        } catch (err) { console.error(err); status(`Generation failed: ${err.message}`); }
    };

    menu.querySelectorAll('[data-plot]').forEach(b => b.onclick = () => {
        op.plot = b.dataset.plot; select();
        menu.querySelectorAll('[data-plot]').forEach(o => o.classList.toggle('on', o === b));
        preview();
    });
    $('#m-objective').onchange = e => { op.objective = e.target.value; select(); preview(); };
    $('#m-flow').onchange = e => { op.verticalFlow = e.target.value; select(); preview(); };
    $('#m-time').onchange = e => { op.timeOfDay = e.target.value; select(); preview(); };
    $('#m-dice').onclick = () => { $('#m-seed').value = 1 + Math.floor(Math.random() * 99999); select(); preview(); };
    $('#m-preview').onclick = preview;

    const setTab = next => {
        tab = validTabs.includes(next) ? next : 'campaign';
        menu.querySelectorAll('[data-tab]').forEach(b => b.classList.toggle('on', b.dataset.tab === tab));
        menu.querySelectorAll('[data-tab-panel]').forEach(p => { p.hidden = p.dataset.tabPanel !== tab; });
        const mainBtn = $('#m-local');
        if (mainBtn) mainBtn.textContent = tab === 'campaign' ? '▶ Deploy Campaign Op' : '▶ Play Skirmish';
        if (tab === 'campaign') renderTheaterDetail();
        if (tab === 'play') preview();
    };
    setTab(tab);
    menu.querySelectorAll('[data-tab]').forEach(b => { b.onclick = () => setTab(b.dataset.tab); });

    const launch = (make, { generating = scenario === OPERATION_ID, debug = desc().debug, autopilot = false, skipReview = true, loadingInfo = null } = {}) =>
        startBattle(make, { generating, debug, autopilot, skipReview, status, loadingInfo });

    $('#m-quick').onclick = () => {
        if (tab === 'campaign' && activeOp) return launchTheaterOp(activeOp, { skipReview: true, debug: $('#m-debug').checked });
        return launch(() => LocalSession.create({
            scenario: OPERATION_ID,
            seed: Number($('#m-seed').value) || 1,
            squad: 'standard',
            debug: $('#m-debug').checked,
            operation: operation()
        }), {
            generating: true,
            debug: $('#m-debug').checked,
            skipReview: true,
            loadingInfo: {
                title: PLOT_FAMILIES[op.plot]?.name || op.plot,
                badges: [PLOT_FAMILIES[op.plot]?.theme, FLOW_LABELS[op.verticalFlow] || op.verticalFlow, `Seed ${Number($('#m-seed').value) || 1}`]
            }
        });
    };
    $('#m-local').onclick = () => {
        if (tab === 'campaign' && activeOp) return launchTheaterOp(activeOp, { skipReview: true, debug: $('#m-debug').checked });
        return launch(() => LocalSession.create(desc()), {
            skipReview: true,
            loadingInfo: {
                title: PLOT_FAMILIES[op.plot]?.name || op.plot,
                badges: [PLOT_FAMILIES[op.plot]?.theme, op.objective || 'Auto', FLOW_LABELS[op.verticalFlow] || op.verticalFlow, `Seed ${Number($('#m-seed').value) || 1}`]
            }
        });
    };
    $('#m-brief').onclick = () => {
        if (tab === 'campaign' && activeOp) return launchTheaterOp(activeOp, { skipReview: false, debug: $('#m-debug').checked });
        return launch(() => LocalSession.create(desc()), { skipReview: false });
    };

    menu.querySelectorAll('[data-curated]').forEach(b => b.onclick = () => {
        const mapId = b.dataset.curated;
        launch(() => LocalSession.create({ scenario: mapId, seed: Number($('#m-seed').value) || 1, squad: $('#m-squad').value, debug: $('#m-debug').checked, inventories: prep.inventories(), ...($('#m-arsenal').checked ? { test: {} } : {}) }), { generating: false, debug: $('#m-debug').checked, skipReview: true, loadingInfo: { title: mapId, badges: ['Curated Fixture'] } });
    });

    new TestGroundPanel($('#m-testground'), {
        launch: (d, client) => launch(() => LocalSession.create(d), { generating: d.scenario === OPERATION_ID, debug: !!d.debug, autopilot: !!client?.autopilot, skipReview: true }),
        host: (d, client) => launch(() => OnlineSession.connect({ url: $('#m-server')?.value || defaultServer, desc: d, support: d.support }), { generating: d.scenario === OPERATION_ID, debug: !!d.debug, autopilot: !!client?.autopilot, skipReview: true }),
        status
    });

    if (!SOLO_ONLY) {
        $('#m-host').onclick = () => launch(() => OnlineSession.connect({ url: $('#m-server').value, desc: desc(), support: $('#m-support').value }), { skipReview: false });
        $('#m-join').onclick = () => launch(() => OnlineSession.connect({ url: $('#m-server').value, roomId: $('#m-room').value.trim(), support: $('#m-support').value }), { generating: false, debug: false, skipReview: false });
    }

    // Quietly pre-warm default soldier sprite atlases while sitting on the start screen.
    const warm = () => { for (const art of [...new Set(Object.values(CLASSES).map(c => c.art).filter(Boolean))]) loadCharacterArt(art).catch(() => {}); };
    if (typeof requestIdleCallback === 'function') requestIdleCallback(warm, { timeout: 1200 });
    else setTimeout(warm, 350);
}

/** Build a session, hide the menu and start the battle (Play and saved deep links). */
async function startBattle(make, { generating = false, debug = false, autopilot = false, skipReview = true, status = () => {}, loadingInfo = null } = {}) {
    try {
        status(generating ? 'Generating the operation…' : 'Building the battlefield…');
        await loading.show(generating ? 'generate' : 'world', loadingInfo || {});
        const session = await make();
        if (!skipReview) {
            loading.hide();
            if (!await reviewDispatch(menu, session)) {
                session.leave?.(); session.battle.light.dispose();
                await showMenu({ desc: session.desc }); return;
            }
        }
        const previewData = session.desc?.scenario === OPERATION_ID ? (() => { try { return operationFor(session.desc); } catch { return null; } })() : null;
        await loading.show('art', {
            title: loadingInfo?.title || session.battle?.mission?.name || '',
            badges: loadingInfo?.badges ?? [
                session.battle?.mission?.meta?.theme,
                session.battle?.mission?.objective?.kind,
                session.battle?.mission?.meta?.terrain?.flow && FLOW_LABELS[session.battle.mission.meta.terrain.flow]
            ].filter(Boolean),
            briefing: loadingInfo?.briefing ?? session.battle?.mission?.meta?.briefing ?? '',
            previewData
        });
        activePrep?.dispose?.(); activePrep = null;
        menu.classList.add('hidden');
        ensureGame();
        await game.start(session, { progress: stage => loading.show(stage) });
        loading.hide();
        if (debug && !game.debug.enabled) game.debug.enable(true);
        game.autoPlayer = !!autopilot;
        if (autopilot) game.maybeRunAi();
        window.__game = game;
        if (session.roomId) game.hud.log(`Room code: ${session.roomId} — share it with your squadmates`);
    } catch (err) { console.error(err); loading.hide(); status(`Failed: ${err.message}`); if (menu.classList.contains('hidden')) showMenu(); }
}

// PLAN-10: ?play=operation&plot=downtown is the generated game; &fixture=1 loads curated/fixed test maps directly.
const playId = params.get('play'), fixture = params.has('fixture') && playId !== OPERATION_ID;
const playOperation = () => fixture ? undefined : {
    plot: playId === OPERATION_ID ? params.get('plot') : plotForMap(playId),
    objective: params.get('objective'),
    verticalFlow: OPERATION_FLOWS.includes(params.get('flow')) ? params.get('flow') : undefined,
    timeOfDay: params.get('time')
};
if (params.get('staged') && !SOLO_ONLY) {
    const launch = JSON.parse(sessionStorage.getItem('fireteam.launch') || 'null');
    showMenu().then(() => launch ? startBattle(() => OnlineSession.connect(launch), { skipReview: false, status: text => { $('#m-status').textContent = text; } }) : $('#m-status').textContent = 'No staging seat found. Open the co-op briefing lobby.');
} else if (params.get('test')) {
    let setup = null;
    try { setup = decodeSetup(params.get('test')); setup.desc = sanitizeDesc(setup.desc); } catch (err) { console.error(err); setup = null; }
    if (setup) startBattle(() => LocalSession.create(setup.desc), { generating: setup.desc.scenario === OPERATION_ID, debug: !!setup.desc.debug, autopilot: !!setup.client?.autopilot || !!params.get('auto'), skipReview: !params.has('brief') });
    else showMenu();
} else if (playId && params.has('brief')) {
    showMenu().then(() => startBattle(() => LocalSession.create({ scenario: fixture ? playId : OPERATION_ID, operation: playOperation(), seed: Number(params.get('seed')) || 1, debug: !!params.get('debug') }), { generating: !fixture, skipReview: false }));
} else if (playId) {
    const operation = playOperation();
    const loadingBadges = fixture ? ['Curated Fixture'] : [PLOT_FAMILIES[operation?.plot]?.name || operation?.plot || 'Operation', FLOW_LABELS[operation?.verticalFlow] || null].filter(Boolean);
    loading.show('generate', { title: PLOT_FAMILIES[operation?.plot]?.name || playId, badges: loadingBadges }).then(() => LocalSession.create({ scenario: fixture ? playId : OPERATION_ID, seed: Number(params.get('seed')) || 1, squad: params.get('squad') || 'standard', debug: !!params.get('debug'), operation, ...(params.get('intel') ? { intel: true, asyncCoop: true, support: params.get('support') === 'orbital_laser' ? 'orbital_laser' : 'carpet_bomb' } : {}) }).then(async session => {
        activePrep?.dispose?.(); activePrep = null;
        menu.classList.add('hidden');
        ensureGame();
        const previewData = session.desc?.scenario === OPERATION_ID ? (() => { try { return operationFor(session.desc); } catch { return null; } })() : null;
        await loading.show('art', { title: session.battle?.mission?.name || '', briefing: session.battle?.mission?.meta?.briefing || '', previewData });
        await game.start(session, { progress: stage => loading.show(stage) });
        loading.hide();
        if (params.get('auto')) { game.autoPlayer = true; game.maybeRunAi(); }
        window.__game = game;
    })).catch(err => { console.error(err); showMenu(); });
} else showMenu();
