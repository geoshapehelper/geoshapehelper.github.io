import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { nodePolyfills } from 'vite-plugin-node-polyfills';

// `base: './'` makes the built site use relative asset paths, so it works when
// served from any subpath (e.g. https://user.github.io/geoshapehelper/) without
// having to hardcode the repo name. Override with VITE_BASE if you prefer.
//
// NOTE: mapshaper is made browser-safe by scripts/patch-mapshaper.mjs (run from
// `postinstall`), which stubs out a few Node-only requires it makes (iconv-lite,
// adm-zip, …) that otherwise crash the worker on load.
export default defineConfig({
  base: process.env.VITE_BASE ?? './',
  plugins: [
    react(),
    // mapshaper pulls in Node core modules (fs, path, stream, buffer, ...). We
    // never touch the real filesystem (all I/O is in-memory via applyCommands),
    // but the bundler still needs these symbols to resolve. node-stdlib-browser
    // shims satisfy them in the worker bundle.
    nodePolyfills({
      include: ['buffer', 'stream', 'util', 'path', 'fs', 'events', 'assert', 'url', 'os', 'zlib', 'crypto'],
      globals: { Buffer: true, global: true, process: true },
    }),
  ],
  worker: {
    format: 'es',
  },
  build: {
    target: 'es2020',
    chunkSizeWarningLimit: 4000,
  },
});
