import { defineConfig } from 'vite';
import path from 'node:path';
import fs from 'node:fs';
import { execSync } from 'node:child_process';

// Stamp every page with the code it came from, so two runs that look different can be told apart:
// The shared server embeds Vite for live source on :2567; production on the same port is a snapshot.
function buildStamp(command) {
    const git = cmd => { try { return execSync(cmd, { cwd: __dirname, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch { return ''; } };
    return {
        commit: command === 'serve' ? `live source (${git('git rev-parse --short HEAD') || 'no git'})` : git('git rev-parse --short HEAD') || 'unknown',
        dirty: git('git status --porcelain -- . ../shared') !== '',
        time: new Date().toISOString().replace('T', ' ').slice(0, 16) + ' UTC'
    };
}

// The client imports the deterministic rules from ../shared, so Vite must be allowed to serve it.
export default defineConfig(({ command, mode }) => ({
    root: path.resolve(__dirname),
    define: { __SOLO_ONLY__: JSON.stringify(mode === 'solo'), __HAS_KIT_ART__: JSON.stringify(fs.existsSync(path.resolve(__dirname,'public/assets/kit/tileset-art.glb'))), __BUILD__: JSON.stringify(buildStamp(command)) },
    server: { fs: { allow: [path.resolve(__dirname, '..')] } },
    build: { rollupOptions: { input: { battle: path.resolve(__dirname, 'index.html'), staging: path.resolve(__dirname, 'staging.html'), campaign: path.resolve(__dirname, 'campaign.html') } }, outDir: 'dist', emptyOutDir: true, chunkSizeWarningLimit: 4000 }
}));
