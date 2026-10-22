import { clear } from './dom.ts'

export type Cleanup = (() => void) | void
export type Screen = (root: HTMLElement, ...args: string[]) => Cleanup | Promise<Cleanup>

const routes: [RegExp, Screen][] = []
let current: Cleanup = undefined
let root: HTMLElement
let token = 0
/** The hash the last render was for. */
let shown = ''
let before: ((path: string) => void) | null = null

/** Runs before every screen change (main.ts leaves the online room this way). */
export function beforeRoute(fn: (path: string) => void): void {
  before = fn
}

export function route(pattern: RegExp, screen: Screen): void {
  routes.push([pattern, screen])
}

export function go(path: string, replace = false): void {
  const hash = '#' + path
  if (location.hash === hash) {
    void render()
    return
  }
  if (replace) history.replaceState(null, '', hash)
  else history.pushState(null, '', hash)
  void render()
}

export function startRouter(el: HTMLElement): void {
  root = el
  // A #fragment navigation (Back, a typed link) fires both events: render
  // once, or a lazy screen lands twice.
  const nav = () => {
    if (location.hash !== shown) void render()
  }
  window.addEventListener('popstate', nav)
  window.addEventListener('hashchange', nav)
  void render()
}

async function render(): Promise<void> {
  const my = ++token
  shown = location.hash
  const path = location.hash.replace(/^#/, '') || '/'
  if (typeof current === 'function') current()
  current = undefined
  clear(root)
  before?.(path)
  for (const [re, screen] of routes) {
    const m = path.match(re)
    if (m) {
      const c = await screen(root, ...m.slice(1).map((a) => decodeURIComponent(a ?? '')))
      // A newer navigation happened while this screen was loading.
      if (my !== token) {
        if (typeof c === 'function') c()
        return
      }
      current = c
      return
    }
  }
  go('/', true)
}
