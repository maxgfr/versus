import type { Family, Mode } from '../core/game.ts'
import type { Link } from '../core/net/link.ts'

/** Session-wide UI state (not persisted beyond the tab). */
export const ui: {
  mode: Mode
  filter: Family | 'all' | 'fav'
  link: Link | null
  /** Scoreboard values last shown, so returning home can roll from them. */
  shownScore: [number, number] | null
  scrollTop: number
} = {
  mode: '2p',
  filter: 'all',
  link: null,
  shownScore: null,
  scrollTop: 0,
}
