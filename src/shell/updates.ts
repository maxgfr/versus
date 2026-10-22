import { toast } from './toast.ts'

/**
 * Service worker updates. An installed app on iOS resumes from the background
 * without looking for a new version, so the app checks whenever it comes back
 * to the foreground (and every 30 min), and applies an update by itself as
 * soon as no game is in progress. Settings can also check on demand.
 */

const UPDATED_KEY = 'versus.updated'
let reg: ServiceWorkerRegistration | undefined
let pending = false
let reload: ((reloadPage?: boolean) => Promise<void>) | null = null
const found = new Set<() => void>()

const inGame = () => location.hash.includes('/play/')

function apply(): void {
  // Never reload under a game: wait until the players leave it.
  if (!pending || !reload || inGame()) return
  pending = false
  try {
    sessionStorage.setItem(UPDATED_KEY, '1')
  } catch {
    // No storage: just no "updated" note.
  }
  void reload(true)
}

function check(): void {
  if (reg && navigator.onLine) void reg.update().catch(() => {})
}

export function startUpdates(): void {
  try {
    if (sessionStorage.getItem(UPDATED_KEY)) {
      sessionStorage.removeItem(UPDATED_KEY)
      setTimeout(() => toast('Updated to the latest version.'), 600)
    }
  } catch {
    // No storage.
  }
  void import('virtual:pwa-register').then(({ registerSW }) => {
    reload = registerSW({
      onNeedRefresh() {
        pending = true
        for (const f of found) f()
        apply()
      },
      onOfflineReady() {
        toast('Ready to play offline.')
      },
      onRegisteredSW(_url, r) {
        reg = r
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'visible') check()
        })
        setInterval(check, 30 * 60 * 1000)
      },
    })
    window.addEventListener('hashchange', apply)
  })
}

export type UpdateCheck = 'updating' | 'latest' | 'offline' | 'unavailable'

/** Look for a new version now; 'updating' means the page is about to reload. */
export async function checkForUpdate(): Promise<UpdateCheck> {
  if (!reg) return 'unavailable'
  if (!navigator.onLine) return 'offline'
  if (pending) {
    apply()
    return 'updating'
  }
  let done: (v: boolean) => void = () => {}
  const ready = new Promise<boolean>((r) => (done = r))
  const hit = () => done(true)
  found.add(hit)
  const timer = setTimeout(() => done(false), 15_000)
  try {
    await reg.update()
    // Nothing installing or waiting once the script is fetched: no new version.
    const fresh = reg.installing || reg.waiting ? await ready : pending
    return fresh ? 'updating' : 'latest'
  } catch {
    return 'offline'
  } finally {
    clearTimeout(timer)
    found.delete(hit)
  }
}
