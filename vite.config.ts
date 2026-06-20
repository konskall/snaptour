import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

// Stamp public/sw.js with a per-build version (a hash of the emitted asset filenames) so
// every deploy gets fresh service-worker cache names. The SW's activate() then purges all
// non-matching caches — preventing unbounded cache growth and evicting stale stable-named
// assets (icons/manifest). Build-only; in dev the literal placeholder stays.
function swVersion(): Plugin {
  let version = 'dev';
  return {
    name: 'snaptour-sw-version',
    apply: 'build',
    generateBundle(_options, bundle) {
      const names = Object.keys(bundle).sort().join('|');
      version = createHash('sha256').update(names).digest('hex').slice(0, 8);
    },
    closeBundle() {
      const swPath = resolve(process.cwd(), 'dist/sw.js');
      if (existsSync(swPath)) {
        writeFileSync(swPath, readFileSync(swPath, 'utf8').replace(/__SW_VERSION__/g, version));
      }
    },
  };
}

export default defineConfig(({ mode }) => {
  // Load env file based on `mode` in the current working directory.
  // Set the third parameter to '' to load all env regardless of the `VITE_` prefix.
  const env = loadEnv(mode, '.', '');
  
  return {
    plugins: [react(), swVersion()],
    // This defines process.env variables so they work in the browser environment
    define: {
      'process.env.API_KEY': JSON.stringify(env.API_KEY || ""),
      // When set, the app routes Gemini calls through this proxy (key stays server-side).
      // Empty → fall back to the direct-key path, so nothing breaks until the proxy is wired.
      'process.env.GEMINI_PROXY_URL': JSON.stringify(env.GEMINI_PROXY_URL || ""),
      'process.env.FIREBASE_API_KEY': JSON.stringify(env.FIREBASE_API_KEY || ""),
      'process.env.FIREBASE_AUTH_DOMAIN': JSON.stringify(env.FIREBASE_AUTH_DOMAIN || ""),
      'process.env.FIREBASE_PROJECT_ID': JSON.stringify(env.FIREBASE_PROJECT_ID || ""),
      'process.env.FIREBASE_APP_ID': JSON.stringify(env.FIREBASE_APP_ID || ""),
      'process.env.FIREBASE_STORAGE_BUCKET': JSON.stringify(env.FIREBASE_STORAGE_BUCKET || ""),
      'process.env.FIREBASE_MESSAGING_SENDER_ID': JSON.stringify(env.FIREBASE_MESSAGING_SENDER_ID || "")
    },
    // Use relative base path for correct asset loading on GitHub Pages
    base: './',
    build: {
      rollupOptions: {
        output: {
          manualChunks(id: string) {
            if (id.includes('node_modules') && /[\\/]@?firebase[\\/]/.test(id)) {
              return 'firebase';
            }
          }
        }
      }
    },
    server: {
      port: 3000
    }
  };
});