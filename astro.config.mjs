// @ts-check
import { defineConfig } from 'astro/config';
import svelte from '@astrojs/svelte';
import cloudflare from '@astrojs/cloudflare';
import tailwindcss from '@tailwindcss/vite';
import { nodePolyfills } from 'vite-plugin-node-polyfills';
import sitemap from '@astrojs/sitemap';

// https://astro.build/config
export default defineConfig({
  site: 'https://noot.smol.xyz',
  output: 'server',
  integrations: [svelte(), sitemap()],
  adapter: cloudflare(),
  server: {
    host: 'localhost',
    headers: {
      // Required for SharedArrayBuffer (Noir multiprocessing)
      'Cross-Origin-Embedder-Policy': 'require-corp',
      'Cross-Origin-Opener-Policy': 'same-origin',
    }
  },
  vite: {
    optimizeDeps: {
<<<<<<< HEAD
      include: ['snarkjs', 'buffer', 'process', 'events'],
      esbuildOptions: {
        target: 'esnext',
        supported: { 'top-level-await': true }
      }
    },
    ssr: {
      external: ['snarkjs', 'circomlibjs']
=======
      exclude: ['@noir-lang/backend_barretenberg', '@noir-lang/noir_js'],
      esbuildOptions: {
        target: 'esnext'
      }
    },
    // Fix for Noir in Vite SSR
    ssr: {
      noExternal: ['@noir-lang/backend_barretenberg', '@noir-lang/noir_js']
>>>>>>> farm-mainnet-real-triple-zk
    },
    plugins: [
      nodePolyfills({
        include: ['buffer', 'crypto', 'stream', 'util', 'process', 'vm', 'events', 'path'],
        globals: {
          Buffer: true,
          global: true,
          process: true,
        },
      }),
      tailwindcss()
    ],
    define: {
<<<<<<< HEAD
      self: 'globalThis',
      'process.env.NODE_DEBUG': 'false'
=======
      // Polyfill self for some browser libs running in worker/ssr
      self: 'globalThis'
    },
    build: {
      target: 'esnext'
>>>>>>> farm-mainnet-real-triple-zk
    }
  },
});
