import { defineConfig } from 'vite';
import path from 'node:path';

// The client imports the deterministic rules from ../shared, so Vite must be allowed to serve it.
export default defineConfig({
    root: path.resolve(__dirname),
    server: { fs: { allow: [path.resolve(__dirname, '..')] } },
    build: { outDir: 'dist', emptyOutDir: true, chunkSizeWarningLimit: 4000 }
});
