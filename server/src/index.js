// Voxel Tactics server: Express + Colyseus 0.15 (the backend pattern carried over from vibe-game),
// hosting lockstep co-op mission rooms. Static client build is served too when present.
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import express from 'express';
import colyseus from 'colyseus';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { MissionRoom } from './MissionRoom.js';

const { Server, matchMaker } = colyseus;
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PORT = Number(process.env.PORT) || 2567;

const app = express();
app.use(express.json());
app.get('/health', (_, res) => res.json({ ok: true }));
app.get('/rooms', async (_, res) => res.json(await matchMaker.query({ name: 'mission' })));
const dist = path.join(ROOT, 'client/dist');
if (fs.existsSync(dist)) { app.use(express.static(dist)); warnIfStale(); }
else console.log('No client build: run `npm run play` (build + server) or use `npm run dev` on :5173.');

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
server.listen(PORT, () => console.log(`voxel-tactics server on :${PORT} (ws + http)`));
