import { defineConfig } from 'vite';
import path from 'node:path';
import { execSync } from 'node:child_process';

// Stamp every page with the code it came from, so two runs that look different can be told apart:
// `npm run dev` serves live source; `npm run build` (served by the game server on :2567) is a snapshot.
function buildStamp(command) {
    const git = cmd => { try { return execSync(cmd, { cwd: __dirname, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch { return ''; } };
    return {
        commit: command === 'serve' ? `live source (${git('git rev-parse --short HEAD') || 'no git'})` : git('git rev-parse --short HEAD') || 'unknown',
        dirty: git('git status --porcelain -- . ../shared') !== '',
        time: new Date().toISOString().replace('T', ' ').slice(0, 16) + ' UTC'
    };
}

// The client imports the deterministic rules from ../shared, so Vite must be allowed to serve it.
export default defineConfig(({ command }) => ({
    root: path.resolve(__dirname),
    define: { __BUILD__: JSON.stringify(buildStamp(command)) },
    server: { fs: { allow: [path.resolve(__dirname, '..')] } },
    build: { outDir: 'dist', emptyOutDir: true, chunkSizeWarningLimit: 4000 }
}));
