import { InventoryPrep } from './ui/InventoryPrep.js';
import { Game } from './Game.js';
import { LocalSession } from './net/LocalSession.js';
import { OnlineSession } from './net/OnlineSession.js';
import { SQUADS } from '../../shared/content/units.js';
import { SCENARIOS } from '../../shared/session/Scenarios.js';

const $ = s => document.querySelector(s);
const esc = s => String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const params = new URLSearchParams(location.search);
const menu = $('#menu');
let game = null;

async function showMenu() {
    menu.classList.remove('hidden');
    const defaultServer = `ws://${location.hostname || 'localhost'}:2567`;
    const themes = [...new Set(SCENARIOS.map(s => s.theme))];
    const pick = SCENARIOS.some(s => s.id === params.get('map')) ? params.get('map') : SCENARIOS[0].id;
    menu.innerHTML = `
      <div class="menu-card">
        <h1>FIRETEAM</h1>
        <p class="tag">Present-day tactical operations · co-op</p>
        <div class="maps" id="m-maps">${themes.map(t => `<div class="theme"><h4>${esc(t)}</h4>${SCENARIOS.filter(s => s.theme === t).map(s =>
            `<button class="map ${s.id === pick ? 'on' : ''}" data-map="${s.id}"><b>${esc(s.name)}</b><span>${esc(s.text)}</span></button>`).join('')}</div>`).join('')}</div>
        <div class="row">
          <label>Seed <input id="m-seed" type="number" value="1" min="1"></label>
          <label>Squad <select id="m-squad">${Object.keys(SQUADS).map(k => `<option>${k}</option>`).join('')}</select></label>
        </div>
        <label class="check"><input id="m-debug" type="checkbox" ${params.get('debug') ? 'checked' : ''}> Debug mode (F1 in battle: spawn, teleport, destroy, elements, overlays, AI stepping)</label>
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
        <p class="status" id="m-status"></p>
        <p class="small">Online co-op needs <code>npm run server</code> running. Units are dealt to players round-robin; the squad ends its turn when every player has pressed End turn.</p>
      </div>`;
    const prep=new InventoryPrep($('#m-inventory'),$('#m-squad').value);
    $('#m-squad').onchange=()=>prep.reset($('#m-squad').value);
    let scenario = pick;
    menu.querySelectorAll('[data-map]').forEach(b => b.onclick = () => {
        scenario = b.dataset.map;
        menu.querySelectorAll('[data-map]').forEach(o => o.classList.toggle('on', o === b));
    });
    const desc = () => ({ scenario, seed: Number($('#m-seed').value) || 1, squad: $('#m-squad').value, debug: $('#m-debug').checked, inventories:prep.inventories() });
    const status = t => { $('#m-status').textContent = t; };
    const launch = async make => {
        try {
            status('Building the battlefield…');
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
    LocalSession.create({ scenario: params.get('play'), seed: Number(params.get('seed')) || 1, squad: params.get('squad') || 'standard', debug: !!params.get('debug') }).then(async session => {
        menu.classList.add('hidden');
        game = new Game({ canvas: $('#view'), hudRoot: $('#hud'), cutinRoot: $('#cutin-layer'), floatRoot: $('#float-layer'), onExit: showMenu });
        await game.start(session);
        if (params.get('cutins')) game.cutins.mode = params.get('cutins');
        if (params.get('auto')) { game.autoPlayer = true; game.maybeRunAi(); }
        window.__game = game;
    });
} else showMenu();
