/// <reference types="vitest/config" />
import { defineConfig, type Plugin } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'
import pkg from './package.json' with { type: 'json' }

// Project pages live under https://maxgfr.github.io/versus/, so every asset URL
// must be prefixed. Routing is hash-based, which keeps deep links working
// without a 404 fallback.
const BASE = '/versus/'

// Everything is self-hosted. The only outbound traffic is online play: Nostr
// relays (wss:) for signalling and STUN (https:/stun via WebRTC) to find the
// other phone. Injected at build time only — the dev server needs a websocket
// for HMR.
const CSP = [
  "default-src 'self'",
  "connect-src 'self' wss: https:",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "manifest-src 'self'",
  "worker-src 'self'",
  "frame-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ')

const contentSecurityPolicy = (): Plugin => ({
  name: 'versus:csp',
  apply: 'build',
  transformIndexHtml: {
    order: 'post',
    handler: (html) =>
      html.replace(
        '<head>',
        `<head>\n    <meta http-equiv="Content-Security-Policy" content="${CSP}" />`,
      ),
  },
})

export default defineConfig({
  base: BASE,
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  // Dev servers on an explicit port are agents' test servers: many of them edit
  // files at once, and hot reload would restart every probe on every save.
  server: process.argv.includes('--port') ? { hmr: false } : {},
  plugins: [
    contentSecurityPolicy(),
    VitePWA({
      registerType: 'prompt',
      injectRegister: null,
      includeAssets: ['favicon.svg', 'apple-touch-icon-180x180.png'],
      manifest: {
        name: 'versus — 2 player games',
        short_name: 'versus',
        description:
          'Over a hundred mini-games for two players face to face on one phone. Play against a friend, the computer, or online. Free and offline.',
        lang: 'en',
        dir: 'ltr',
        theme_color: '#14101f',
        background_color: '#14101f',
        display: 'standalone',
        orientation: 'portrait',
        start_url: `${BASE}`,
        scope: `${BASE}`,
        categories: ['games', 'entertainment'],
        icons: [
          { src: 'pwa-64x64.png', sizes: '64x64', type: 'image/png' },
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          {
            src: 'maskable-icon-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        // Every game chunk is precached: the whole arcade works in airplane mode.
        globPatterns: ['**/*.{js,css,html,svg,png,webp,ico,txt,woff2,webmanifest}'],
        navigateFallback: `${BASE}index.html`,
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
      },
    }),
  ],
  build: {
    target: 'es2022',
    // Card captures stay separate files, loaded lazily, never inlined into the home bundle.
    assetsInlineLimit: (file) => (file.includes('/thumbs/') ? false : undefined),
    cssMinify: 'lightningcss',
  },
  test: {
    environment: 'node',
    globals: true,
    include: ['src/**/*.test.ts'],
    // Computer-vs-computer matches are slow on a busy CI runner.
    testTimeout: 30_000,
  },
})
