/**
 * Two-player Ludo rules. Each side has four tokens. Progress is a number:
 * -1 in base, 0..51 around the 52-square track (0 = the side's start square),
 * 52..57 up the six-square home column (57 = home). A token only leaves base
 * on a six, may not overshoot home, and captures a rival that sits on a
 * non-safe track square it lands on. Pure logic, unit-tested.
 */
import type { Side } from '../../core/game.ts'

export const TOKENS = 4
export const TRACK = 52
export const BASE = -1
/** Progress of a token at home: the last square of the home column. */
export const FINISH = 57

/** Track squares as [col, row] on the 15 × 15 grid, clockwise, starting at the top arm's top-left. */
export const TRACK_CELLS: readonly (readonly [number, number])[] = [
  [6, 0],
  [7, 0],
  [8, 0],
  [8, 1],
  [8, 2],
  [8, 3],
  [8, 4],
  [8, 5],
  [9, 6],
  [10, 6],
  [11, 6],
  [12, 6],
  [13, 6],
  [14, 6],
  [14, 7],
  [14, 8],
  [13, 8],
  [12, 8],
  [11, 8],
  [10, 8],
  [9, 8],
  [8, 9],
  [8, 10],
  [8, 11],
  [8, 12],
  [8, 13],
  [8, 14],
  [7, 14],
  [6, 14],
  [6, 13],
  [6, 12],
  [6, 11],
  [6, 10],
  [6, 9],
  [5, 8],
  [4, 8],
  [3, 8],
  [2, 8],
  [1, 8],
  [0, 8],
  [0, 7],
  [0, 6],
  [1, 6],
  [2, 6],
  [3, 6],
  [4, 6],
  [5, 6],
  [6, 5],
  [6, 4],
  [6, 3],
  [6, 2],
  [6, 1],
]

/** Track index of each side's start square: red enters at the bottom-left corner, blue at the top-right. */
export const START: readonly [number, number] = [28, 2]

/** Track indices that are safe: each start square and the star eight squares on from it. */
export const SAFE: ReadonlySet<number> = new Set([
  START[0],
  (START[0] + 8) % TRACK,
  START[1],
  (START[1] + 8) % TRACK,
])

/** Home column squares for progress 52..57, as [col, row]. Red's runs up from the bottom arm, blue's down from the top. */
export const HOME_CELLS: readonly (readonly (readonly [number, number])[])[] = [
  [
    [7, 13],
    [7, 12],
    [7, 11],
    [7, 10],
    [7, 9],
    [7, 8],
  ],
  [
    [7, 1],
    [7, 2],
    [7, 3],
    [7, 4],
    [7, 5],
    [7, 6],
  ],
]

export type Tokens = [number[], number[]]

/** Track index a token with progress `prog` stands on, or null in base / home. */
export function trackOf(side: Side, prog: number): number | null {
  if (prog < 0 || prog >= TRACK) return null
  return (START[side] + prog) % TRACK
}

/** Progress after moving `face` from `prog`, or null if that move is illegal. */
export function landing(prog: number, face: number): number | null {
  if (prog === BASE) return face === 6 ? 0 : null
  if (prog >= FINISH) return null
  const to = prog + face
  return to <= FINISH ? to : null
}

/** Tokens of `side` that can legally move `face`. */
export function legalTokens(tok: Tokens, side: Side, face: number): number[] {
  return tok[side].flatMap((p, i) => (landing(p, face) === null ? [] : [i]))
}

export interface Step {
  tok: Tokens
  to: number
  /** Rival tokens sent back to base: [side, token]. */
  captured: [Side, number][]
}

/** Move token `i` of `side` by `face`, which must be legal. Returns the new tokens (the input is not changed). */
export function step(tok: Tokens, side: Side, i: number, face: number): Step {
  const next: Tokens = [tok[0].slice(), tok[1].slice()]
  const to = landing(next[side][i] ?? BASE, face)
  if (to === null) throw new Error(`illegal move: token ${i} by ${face}`)
  next[side][i] = to
  const captured: [Side, number][] = []
  const cell = trackOf(side, to)
  if (cell !== null && !SAFE.has(cell)) {
    const rival: Side = side === 0 ? 1 : 0
    next[rival].forEach((p, j) => {
      if (trackOf(rival, p) === cell) {
        captured.push([rival, j])
        next[rival][j] = BASE
      }
    })
  }
  return { tok: next, to, captured }
}

/** True when every token of `side` is home. */
export const won = (tok: Tokens, side: Side): boolean => tok[side].every((p) => p === FINISH)

/** Tokens of `side` at home. */
export const homeCount = (tok: Tokens, side: Side): number =>
  tok[side].filter((p) => p === FINISH).length
