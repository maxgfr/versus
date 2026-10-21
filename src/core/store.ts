import type { Difficulty } from './game.ts'

// Everything persisted lives under one key. Storage can be missing (private
// mode, blocked site data), so every access is guarded and the app always runs
// on defaults.

export interface Settings {
  sound: boolean
  haptics: boolean
  difficulty: Difficulty
  names: [string, string]
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
}

const KEY = 'versus:v1'

const defaults = (): Saved => ({
  v: 1,
  settings: { sound: true, haptics: true, difficulty: 'normal', names: ['Red', 'Blue'] },
  score: [0, 0],
  favorites: [],
  records: {},
  plays: {},
  match: {},
  iosGuideSeen: false,
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
