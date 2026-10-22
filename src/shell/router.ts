import { clear } from './dom.ts'

export type Cleanup = (() => void) | void
export type Screen = (root: HTMLElement, ...args: string[]) => Cleanup | Promise<Cleanup>

const routes: [RegExp, Screen][] = []
let current: Cleanup = undefined
let root: HTMLElement
let token = 0
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
  window.addEventListener('popstate', () => void render())
  window.addEventListener('hashchange', () => void render())
  void render()
}

async function render(): Promise<void> {
  const my = ++token
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
