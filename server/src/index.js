// Voxel Tactics server: Express + Colyseus 0.15 (the backend pattern carried over from vibe-game),
// hosting lockstep co-op mission rooms. Static client build is served too when present.
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import express from 'express';
import colyseus from 'colyseus';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { StagingRoom } from './StagingRoom.js';
import { MissionRoom } from './MissionRoom.js';

const { Server, matchMaker } = colyseus;
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PORT = Number(process.env.PORT) || 2567;
const development = process.argv.includes('--dev');

const app = express();
app.use(express.json());
app.get('/health', (_, res) => res.json({ ok: true }));
app.get('/rooms', async (_, res) => res.json(await matchMaker.query({ name: 'mission' })));
const dist = path.join(ROOT, 'client/dist');
if (development) {
    // One origin for the live UI, authored map packages, and multiplayer rules.
    // Vite owns only its HMR socket; gameplay HTTP and WebSockets use :2567.
    const { createServer } = await import('vite');
    const vite = await createServer({
        configFile: path.join(ROOT, 'client/vite.config.js'),
        server: { middlewareMode: true },
        appType: 'mpa'
    });
    app.use(vite.middlewares);
} else if (fs.existsSync(dist)) { app.use(express.static(dist)); warnIfStale(); }
else console.log('No client build: run `npm run play` (build + server) or `npm run dev` (live client + server).');

/** The page on this port is the last `npm run build`, while the rules here are live source: warn when they differ. */
function warnIfStale() {
    const newest = dir => { let t = 0; for (const e of fs.readdirSync(dir, { withFileTypes: true })) { const p = path.join(dir, e.name); t = Math.max(t, e.isDirectory() ? newest(p) : fs.statSync(p).mtimeMs); } return t; };
    try {
        const built = fs.statSync(path.join(dist, 'index.html')).mtimeMs;
        const source = Math.max(...['client/src', 'shared', 'client/public'].map(d => newest(path.join(ROOT, d))));
        if (source > built) console.warn('WARNING: client/dist is older than the source. This port serves that old build while the server runs the new rules, so online games can desync and look different from `npm run dev`. Run `npm run play` (build + server).');
    } catch { /* best effort */ }
}

const server = http.createServer(app);
const gameServer = new Server({ transport: new WebSocketTransport({ server }) });
gameServer.define('mission', MissionRoom);
gameServer.define('staging', StagingRoom);
server.listen(PORT, () => console.log(`Fireteam ${development ? 'live development' : 'production build'}: http://localhost:${PORT}/ (UI + maps + co-op)\nShared baseline: http://localhost:${PORT}/?play=burger-district&seed=1`));

if (PORT !== 5173) {
    // Keep old preview bookmarks on the shared environment, including their deep links.
    const legacy = http.createServer((req, res) => {
        const target = new URL(`http://${req.headers.host || 'localhost'}`);
        target.port = String(PORT);
        const destination = target.origin + (req.url?.startsWith('/') ? req.url : '/');
        res.writeHead(302, { Location: destination });
        res.end();
    });
    legacy.listen(5173, () => console.log('Old :5173 preview redirects to the shared environment.'));
    legacy.on('error', error => {
        if (error.code === 'EADDRINUSE') console.warn('Port 5173 still has another preview running. Stop it and restart the shared server to enable the redirect.');
        else console.error('Legacy preview redirect:', error.message);
    });
}
