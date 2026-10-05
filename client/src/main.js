import { Game } from './Game.js';
import { LocalSession } from './net/LocalSession.js';
import { OnlineSession } from './net/OnlineSession.js';
import { SQUADS } from '../../shared/content/units.js';

const $ = s => document.querySelector(s);
const menu = $('#menu');
let game = null;

async function showMenu() {
    menu.classList.remove('hidden');
    let sites = [];
    try { sites = await (await fetch('/missions/sites/index.json')).json(); } catch { /* no baked sites */ }
    const defaultServer = `ws://${location.hostname || 'localhost'}:2567`;
    menu.innerHTML = `
      <div class="menu-card">
        <h1>VOXEL TACTICS</h1>
        <p class="tag">XCOM 2 × Phoenix Point on vibe-game's voxel world — test build (placeholder art)</p>
        <label>Battlefield
          <select id="m-scenario">
            <option value="proving-grounds">Proving Grounds — every system in one map</option>
            ${sites.map(s => `<option value="world:${s.id}">${s.name} (${s.type}, ${s.buildings} buildings) — generated</option>`).join('')}
          </select></label>
        <div class="row">
          <label>Seed <input id="m-seed" type="number" value="1" min="1"></label>
          <label>Squad <select id="m-squad">${Object.keys(SQUADS).map(k => `<option>${k}</option>`).join('')}</select></label>
        </div>
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
    const desc = () => {
        const v = $('#m-scenario').value;
        const [scenario, siteId] = v.startsWith('world:') ? ['world', v.slice(6)] : [v, null];
        return { scenario, siteId, seed: Number($('#m-seed').value) || 1, squad: $('#m-squad').value };
    };
    const status = t => { $('#m-status').textContent = t; };
    const launch = async make => {
        try {
            status('Building the battlefield…');
            const session = await make();
            menu.classList.add('hidden');
            if (!game) game = new Game({ canvas: $('#view'), hudRoot: $('#hud'), cutinRoot: $('#cutin-layer'), floatRoot: $('#float-layer'), onExit: () => { session.leave?.(); showMenu(); } });
            await game.start(session);
            if (session.roomId) game.hud.log(`Room code: ${session.roomId} — share it with your squadmates`);
        } catch (err) { console.error(err); status(`Failed: ${err.message}`); }
    };
    $('#m-local').onclick = () => launch(() => LocalSession.create(desc()));
    $('#m-host').onclick = () => launch(() => OnlineSession.connect({ url: $('#m-server').value, desc: desc() }));
    $('#m-join').onclick = () => launch(() => OnlineSession.connect({ url: $('#m-server').value, roomId: $('#m-room').value.trim() }));
}

// Deep link for quick testing: ?play=proving-grounds or ?play=world:burg-10&seed=3
const params = new URLSearchParams(location.search);
if (params.get('play')) {
    const v = params.get('play');
    const [scenario, siteId] = v.startsWith('world:') ? ['world', v.slice(6)] : [v, null];
    LocalSession.create({ scenario, siteId, seed: Number(params.get('seed')) || 1, squad: params.get('squad') || 'standard' }).then(async session => {
        menu.classList.add('hidden');
        game = new Game({ canvas: $('#view'), hudRoot: $('#hud'), cutinRoot: $('#cutin-layer'), floatRoot: $('#float-layer'), onExit: showMenu });
        await game.start(session);
        if (params.get('cutins')) game.cutins.mode = params.get('cutins');
        if (params.get('auto')) { game.autoPlayer = true; game.maybeRunAi(); }
        window.__game = game;
    });
} else showMenu();
