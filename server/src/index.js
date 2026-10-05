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
if (fs.existsSync(dist)) app.use(express.static(dist));

const server = http.createServer(app);
const gameServer = new Server({ transport: new WebSocketTransport({ server }) });
gameServer.define('mission', MissionRoom);
server.listen(PORT, () => console.log(`voxel-tactics server on :${PORT} (ws + http)`));
