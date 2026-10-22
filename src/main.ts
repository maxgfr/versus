import fredoka from '@fontsource-variable/fredoka/files/fredoka-latin-wght-normal.woff2?url'
import { audio } from './core/audio.ts'
import { save, store } from './core/store.ts'
import type { Link } from './core/net/link.ts'
import { findGame, isBuilt, loadGame } from './registry.ts'
import { h } from './shell/dom.ts'
import { home } from './shell/home.ts'
import { icon } from './shell/icons.ts'
import { beforeRoute, type Cleanup, go, route, startRouter } from './shell/router.ts'
import { Session } from './shell/session.ts'
import { sheet } from './shell/settings.ts'
import { ui } from './shell/state.ts'
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

/** A game: local (`#/play/<id>`) or in an online room (`#/online/CODE/play/<id>`). */
async function play(root: HTMLElement, id: string, code?: string): Promise<Cleanup> {
  const params = new URLSearchParams(location.hash.split('?')[1] ?? '')
  const demo = params.has('demo')
    ? { speed: Math.min(8, Number(params.get('speed')) || 1), clean: params.has('clean') }
    : undefined
  const meta = findGame(id)
  const back = code ? `/online/${code}` : '/'
  if (!meta || !isBuilt(id) || (code && !meta.online)) {
    go(back, true)
    return
  }
  let link: Link | null = null
  let pending: { seed: number; target?: number } | undefined
  if (code) {
    const online = await import('./shell/online.ts')
    link = online.room(code)
    // A reloaded page waits in the room; the host pulls it back into the game.
    if (!link.connected) {
      go(back, true)
      return
    }
    if (link.role === 'guest') pending = online.takePending()
  }
  const loading = h('div.loading', h('span.spinner'))
  root.append(loading)
  const [mod] = await Promise.all([loadGame(id), fontReady])
  loading.remove()
  const s = new Session(root, {
    meta,
    factory: mod.default,
    match: mod.match,
    mode: code ? 'online' : ui.local,
    link,
    ...(pending ? { seed: pending.seed } : {}),
    ...(pending?.target !== undefined ? { target: pending.target } : {}),
    ...(demo ? { demo, mode: '1p' as const } : {}),
    onExit: () => go(back),
  })
  return () => s.destroy()
}

route(/^\/play\/([\w-]+)(?:\?.*)?$/, (root, id) => play(root, id ?? ''))

route(/^\/online\/([A-Z]{4})\/play\/([\w-]+)$/, (root, code, id) => play(root, id ?? '', code))

route(/^\/online\/([A-Za-z]{4})$/, async (root, code = '') => {
  if (code !== code.toUpperCase()) {
    go(`/online/${code.toUpperCase()}`, true)
    return
  }
  return (await import('./shell/online.ts')).roomScreen(root, code)
})

route(/^\/online$/, async (root) => (await import('./shell/online.ts')).lobby(root))

// Online is a place: going anywhere else leaves the room.
beforeRoute((path) => {
  if (ui.link && !path.startsWith('/online'))
    void import('./shell/online.ts').then((m) => m.leaveRoom())
})

route(/^\/tournament$/, async (root) => (await import('./shell/tournament.ts')).tournament(root))

document.body.append(
  h('div.rotate', { 'aria-live': 'polite' }, icon('phone'), 'Turn your phone upright to play'),
)
startRouter(app)

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
  if (e.key === 'Escape' && !location.hash.includes('/play/')) go('/')
})
