import fredoka from '@fontsource-variable/fredoka/files/fredoka-latin-wght-normal.woff2?url'
import { audio } from './core/audio.ts'
import { save, store } from './core/store.ts'
import { findGame, isBuilt, loadGame } from './registry.ts'
import { h } from './shell/dom.ts'
import { home } from './shell/home.ts'
import { icon } from './shell/icons.ts'
import { go, route, startRouter } from './shell/router.ts'
import { Session } from './shell/session.ts'
import { sheet } from './shell/settings.ts'
import { ROOM_KEY, ui } from './shell/state.ts'
import { startUpdates } from './shell/updates.ts'
import './style.css'

// Self-hosted variable font, registered through the FontFace API so canvas
// text can wait for it instead of flashing the fallback.
const face = new FontFace('Fredoka', `url(${fredoka})`, { weight: '300 700', display: 'swap' })
document.fonts.add(face)
const fontReady = face.load().catch(() => face)

audio.enabled = store.settings.sound

// iOS: no pinch / double-tap zoom anywhere, the app is the whole screen.
for (const ev of ['gesturestart', 'gesturechange', 'gestureend']) {
  document.addEventListener(ev, (e) => e.preventDefault(), { passive: false })
}
document.addEventListener('dblclick', (e) => e.preventDefault(), { passive: false })
document.addEventListener('contextmenu', (e) => e.preventDefault())
// Unlock audio on the very first gesture.
window.addEventListener('pointerdown', () => audio.unlock(), { once: true, capture: true })

const app = document.getElementById('app') as HTMLElement

route(/^\/$/, (root) => home(root))

route(/^\/play\/([\w-]+)(?:\?.*)?$/, async (root, id) => {
  const params = new URLSearchParams(location.hash.split('?')[1] ?? '')
  const demo = params.has('demo')
    ? { speed: Math.min(8, Number(params.get('speed')) || 1), clean: params.has('clean') }
    : undefined
  const meta = findGame(id)
  if (!meta || !isBuilt(id)) {
    go('/', true)
    return
  }
  if (ui.mode === 'online' && (!meta.online || !ui.link?.connected)) {
    if (!ui.link?.connected) {
      go('/online', true)
      return
    }
    ui.mode = '2p'
  }
  const loading = h('div.loading', h('span.spinner'))
  root.append(loading)
  const [mod] = await Promise.all([loadGame(id), fontReady])
  loading.remove()
  let pending: { seed: number; target?: number } | undefined
  if (ui.mode === 'online' && ui.link?.role === 'guest') {
    pending = (await import('./shell/online.ts')).takePending()
  }
  const s = new Session(root, {
    meta,
    factory: mod.default,
    match: mod.match,
    mode: ui.mode,
    link: ui.mode === 'online' ? ui.link : null,
    ...(pending ? { seed: pending.seed } : {}),
    ...(pending?.target !== undefined ? { target: pending.target } : {}),
    ...(demo ? { demo, mode: '1p' as const } : {}),
    onExit: () => go('/'),
  })
  return () => s.destroy()
})

route(/^\/online(?:\/([A-Za-z]{4}))?$/, async (root, code) =>
  (await import('./shell/online.ts')).lobby(root, code),
)

route(/^\/tournament$/, async (root) => (await import('./shell/tournament.ts')).tournament(root))

document.body.append(
  h('div.rotate', { 'aria-live': 'polite' }, icon('phone'), 'Turn your phone upright to play'),
)
// A tab that was reloaded mid-session (iOS does this to Safari behind the
// share sheet) goes straight back into its online room.
let room: unknown = null
try {
  room = JSON.parse(sessionStorage.getItem(ROOM_KEY) ?? 'null')
} catch {
  // No storage: nothing to rejoin.
}
if (room && typeof room === 'object') {
  ui.mode = 'online'
  void import('./shell/online.ts')
    .then((m) => m.rejoin(room as Parameters<typeof m.rejoin>[0]))
    .finally(() => startRouter(app))
} else startRouter(app)

// ---------- iOS install guide (first Safari visit, not installed) ----------

const nav = navigator as Navigator & { standalone?: boolean }
const isIOS =
  /iP(hone|ad|od)/.test(navigator.userAgent) ||
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
const standalone =
  nav.standalone === true || window.matchMedia('(display-mode: standalone)').matches
if (isIOS && !standalone && !store.iosGuideSeen && !navigator.webdriver) {
  setTimeout(() => {
    // Only over the home screen, never on top of a game.
    if (location.hash !== '' && location.hash !== '#/') return
    store.iosGuideSeen = true
    save()
    sheet(app, 'Install versus', [
      h(
        'p.fine',
        { style: { fontSize: '17px', color: 'var(--ink-7)' } },
        'Play full screen and offline: tap ',
        icon('share'),
        ' Share in Safari, then ',
        h('b', 'Add to Home Screen'),
        '.',
      ),
      h('p.fine', 'It takes no space to speak of, and nothing is ever sent anywhere.'),
    ])
  }, 1200)
}

// ---------- service worker: precache everything, update itself ----------

if (import.meta.env.PROD && 'serviceWorker' in navigator) startUpdates()

// Keyboard shortcut for desktop testers: Escape goes home from anywhere but a game.
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !location.hash.startsWith('#/play/')) go('/')
})
