import type { Difficulty } from './game.ts'

// Everything persisted lives under one key. Storage can be missing (private
// mode, blocked site data), so every access is guarded and the app always runs
// on defaults.

export interface Settings {
  sound: boolean
  haptics: boolean
  difficulty: Difficulty
  names: [string, string]
  /** Keep a list of the online rooms this phone created or joined. */
  rememberRooms: boolean
}

/** An online room this phone was in, so it can find its way back. */
export interface RecentRoom {
  code: string
  role: 'host' | 'guest'
  at: number
  /** The last game played there, so the players can go straight back to it. */
  game?: string
}

export interface Saved {
  v: 1
  settings: Settings
  /** Global tally across every game: red, blue. */
  score: [number, number]
  favorites: string[]
  /** Best solo time / score per game id. */
  records: Record<string, number>
  plays: Record<string, number>
  /** Match length chosen per game (see MatchSpec). */
  match: Record<string, number>
  iosGuideSeen: boolean
  /** Newest first. */
  rooms: RecentRoom[]
}

const KEY = 'versus:v1'

const defaults = (): Saved => ({
  v: 1,
  settings: {
    sound: true,
    haptics: true,
    difficulty: 'normal',
    names: ['Red', 'Blue'],
    rememberRooms: true,
  },
  score: [0, 0],
  favorites: [],
  records: {},
  plays: {},
  match: {},
  iosGuideSeen: false,
  rooms: [],
})

function load(): Saved {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return defaults()
    const parsed = JSON.parse(raw) as Partial<Saved>
    const d = defaults()
    return { ...d, ...parsed, settings: { ...d.settings, ...parsed.settings } }
  } catch {
    return defaults()
  }
}

export const store: Saved = load()

export function save(): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(store))
  } catch {
    // Storage full or blocked: the session keeps working in memory.
  }
}

export function toggleFavorite(id: string): boolean {
  const i = store.favorites.indexOf(id)
  if (i >= 0) store.favorites.splice(i, 1)
  else store.favorites.unshift(id)
  save()
  return i < 0
}

/** Lower is better for times, so the caller says which way records go. */
export function submitRecord(id: string, value: number, lowerIsBetter: boolean): boolean {
  const prev = store.records[id]
  const better = prev === undefined || (lowerIsBetter ? value < prev : value > prev)
  if (better) {
    store.records[id] = value
    save()
  }
  return better
}

export function resetScores(): void {
  store.score = [0, 0]
  save()
}

const MAX_ROOMS = 6

export function rememberRoom(code: string, role: RecentRoom['role']): void {
  if (!store.settings.rememberRooms) return
  const game = store.rooms.find((r) => r.code === code)?.game
  const room: RecentRoom = game
    ? { code, role, at: Date.now(), game }
    : { code, role, at: Date.now() }
  store.rooms = [room, ...store.rooms.filter((r) => r.code !== code)]
  store.rooms.length = Math.min(store.rooms.length, MAX_ROOMS)
  save()
}

/** A game started in room `code`: it becomes the one to go back to. */
export function roomGame(code: string, game: string): void {
  const r = store.rooms.find((x) => x.code === code)
  if (!r) return
  r.game = game
  r.at = Date.now()
  save()
}

/** Forget one room, or all of them. */
export function forgetRooms(code?: string): void {
  store.rooms = code ? store.rooms.filter((r) => r.code !== code) : []
  save()
}
