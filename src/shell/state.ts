import type { Family, Mode } from '../core/game.ts'
import type { Link } from '../core/net/link.ts'

/** Session-wide UI state (not persisted beyond the tab). */
export const ui: {
  /** 1P or 2P on this phone (online is a place: `#/online/CODE`). */
  local: Exclude<Mode, 'online'>
  filter: Family | 'all' | 'fav'
  link: Link | null
  /** Scoreboard values last shown, so returning home can roll from them. */
  shownScore: [number, number] | null
  scrollTop: number
} = {
  local: '2p',
  filter: 'all',
  link: null,
  shownScore: null,
  scrollTop: 0,
}

/** sessionStorage key of the online room, so a reloaded tab rejoins it. */
export const ROOM_KEY = 'versus.room'
