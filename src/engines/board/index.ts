import { BaseGame, type Side } from '../../core/game.ts'
import { namePill } from '../../core/hud.ts'
import type { Ptr } from '../../core/input.ts'
import type { Draw } from '../../core/render/draw.ts'
import { C, SIDE, alpha, shade } from '../../core/render/palette.ts'
import { MID, W } from '../../core/stage.ts'

/**
 * Board engine: a shared board in the middle of the table, turns, a computer
 * that "thinks" visibly, and the grid maths every board game needs. The board
 * is shared, so in local 2P a tap on it is the current player's move whoever's
 * finger it is: exactly like a real board.
 */

export interface TurnState {
  turn: Side
}

export interface Geom {
  x: number
  y: number
  w: number
  h: number
  cols: number
  rows: number
  cell: number
}

/** Square-celled grid centred on (W/2, cy), as large as fits in maxW × maxH. */
export function geom(cols: number, rows: number, maxW = 880, maxH = 880, cy = MID): Geom {
  const cell = Math.min(maxW / cols, maxH / rows)
  const w = cell * cols
  const h = cell * rows
  return { x: (W - w) / 2, y: cy - h / 2, w, h, cols, rows, cell }
}

export function cellAt(g: Geom, px: number, py: number): { c: number; r: number } | null {
  const c = Math.floor((px - g.x) / g.cell)
  const r = Math.floor((py - g.y) / g.cell)
  if (c < 0 || r < 0 || c >= g.cols || r >= g.rows) return null
  return { c, r }
}

export function cellCenter(g: Geom, c: number, r: number): { x: number; y: number } {
  return { x: g.x + (c + 0.5) * g.cell, y: g.y + (r + 0.5) * g.cell }
}

/** The board as a raised toy slab with inset cells. `cellColor` lets games checker it. */
export function drawBoard(
  g: Draw,
  geo: Geom,
  face: string,
  o: {
    pad?: number
    depth?: number
    radius?: number
    cellColor?: (c: number, r: number) => string | null
    cellRadius?: number
    inset?: number
  } = {},
): void {
  const pad = o.pad ?? 28
  const depth = o.depth ?? 22
  g.shadow(W / 2, geo.y + geo.h + pad + depth + 10, geo.w * 0.55, 36, 0.4)
  g.tile(
    geo.x - pad,
    geo.y - pad,
    geo.w + pad * 2,
    geo.h + pad * 2 + depth,
    o.radius ?? 44,
    face,
    depth,
  )
  const inset = o.inset ?? 8
  for (let r = 0; r < geo.rows; r++) {
    for (let c = 0; c < geo.cols; c++) {
      const col = o.cellColor ? o.cellColor(c, r) : shade(face, -0.25)
      if (!col) continue
      g.rrect(
        geo.x + c * geo.cell + inset,
        geo.y + r * geo.cell + inset,
        geo.cell - inset * 2,
        geo.cell - inset * 2,
        o.cellRadius ?? 22,
        col,
      )
    }
  }
}

/** Highlight ring around a cell (selection, last move, hint). */
export function cellRing(
  g: Draw,
  geo: Geom,
  c: number,
  r: number,
  color: string = C.yellow,
  lw = 8,
): void {
  const inset = 6
  g.rrect(
    geo.x + c * geo.cell + inset,
    geo.y + r * geo.cell + inset,
    geo.cell - inset * 2,
    geo.cell - inset * 2,
    22,
    undefined,
    color,
    lw,
  )
}

/**
 * Base for turn-based games on a shared board. Subclasses implement `stepTurn`
 * (handle a human tap) and `botPlay` (choose and play a move); the base routes
 * taps to whoever's turn it is, paces the computer so it reads as thinking,
 * and draws the turn pills.
 */
export abstract class TurnGame<S extends TurnState> extends BaseGame<S> {
  /** Seconds the computer has been thinking this turn. */
  protected thinking = 0
  private thinkFor = 0.7
  private pendingBot: Promise<void> | null = null

  /** Delay before the computer plays, by difficulty (snappier when harder). */
  protected botDelay(): number {
    const d = this.ctx.difficulty
    return (d === 'easy' ? 0.9 : d === 'normal' ? 0.7 : 0.5) + this.ctx.rng.range(0, 0.35)
  }

  /** The tap the current player made this step, if they are human and it's theirs to make. */
  protected turnTap(): Ptr | undefined {
    const turn = this.s.turn
    if (this.isBot(turn)) return undefined
    const [a, b] = this.ctx.input.players
    if (this.ctx.mode === 'online') return this.ctx.input.player(turn).downs[0]
    if (this.ctx.mode === '1p') return a.downs[0]
    return a.downs[0] ?? b.downs[0]
  }

  protected abstract botPlay(): void | Promise<void>

  /** Called each step while it's a human's turn and nothing else is animating. */
  protected abstract stepTurn(dt: number, tap: Ptr | undefined): void

  /** Override to block input while a move animates. */
  protected busy(): boolean {
    return false
  }

  /** Runs every step before anything else, even while `busy()`: flying shells, falling pieces… */
  protected animate(_dt: number): void {}

  protected step(dt: number): void {
    this.animate(dt)
    if (this.busy()) {
      this.thinking = 0
      return
    }
    if (this.isBot(this.s.turn)) {
      if (this.pendingBot) return
      if (this.thinking === 0) this.thinkFor = this.botDelay()
      this.thinking += dt
      if (this.thinking >= this.thinkFor) {
        this.thinking = 0
        const r = this.botPlay()
        if (r instanceof Promise) {
          this.pendingBot = r.finally(() => (this.pendingBot = null))
        }
      }
      return
    }
    this.thinking = 0
    this.stepTurn(dt, this.turnTap())
  }

  /** Pills at both edges: the player to move glows. */
  protected drawTurns(g: Draw, text?: [string | undefined, string | undefined], live = true): void {
    for (const side of [0, 1] as Side[]) {
      const active = live && !this.over && this.s.turn === side
      const name = this.ctx.names[side]
      let label = text?.[side]
      if (!label && active)
        label = this.isBot(side)
          ? 'Thinking…'
          : this.ctx.mode === '2p'
            ? 'Your turn'
            : side === this.ctx.local
              ? 'Your turn'
              : `${name}'s turn`
      namePill(g, side, name, label ? { active, text: label } : { active })
    }
  }
}

/** Team-coloured backdrop used by most board games: dark floodlit table. */
export function tableBackdrop(g: Draw, tint: string = C.ink2): void {
  g.fillView(
    g.lin(0, 0, 0, 1800, [
      [0, shade(SIDE[1].main, -0.8)],
      [0.5, tint],
      [1, shade(SIDE[0].main, -0.8)],
    ]),
  )
  g.alpha(0.5, () =>
    g.fillView(
      g.rad(W / 2, MID, 100, 1100, [
        [0, alpha('#ffffff', 0.08)],
        [1, alpha('#000000', 0.5)],
      ]),
    ),
  )
}

// ---------- search ----------

export interface SearchSpec<S, M> {
  moves(s: S): M[]
  play(s: S, m: M): S
  /** Terminal value or heuristic, from `side`'s point of view. */
  evaluate(s: S, side: Side): number
  over(s: S): boolean
  turn(s: S): Side
}

/** Negamax with α-β pruning. Scores are from the side to move. */
export function negamax<S, M>(
  spec: SearchSpec<S, M>,
  s: S,
  depth: number,
  a = -Infinity,
  b = Infinity,
): number {
  const side = spec.turn(s)
  if (depth === 0 || spec.over(s)) return spec.evaluate(s, side)
  let best = -Infinity
  for (const m of spec.moves(s)) {
    const next = spec.play(s, m)
    // A move that keeps the turn (extra move) is not negated.
    const v =
      spec.turn(next) === side
        ? negamax(spec, next, depth - 1, a, b)
        : -negamax(spec, next, depth - 1, -b, -a)
    if (v > best) best = v
    if (best > a) a = best
    if (a >= b) break
  }
  return best
}

/** Best move by negamax; ties broken by `pick` (random) so the computer is not predictable. */
export function bestMove<S, M>(
  spec: SearchSpec<S, M>,
  s: S,
  depth: number,
  pick: (n: number) => number = () => 0,
): M | undefined {
  const side = spec.turn(s)
  let best = -Infinity
  let ties: M[] = []
  for (const m of spec.moves(s)) {
    const next = spec.play(s, m)
    const v =
      spec.turn(next) === side ? negamax(spec, next, depth - 1) : -negamax(spec, next, depth - 1)
    if (v > best + 1e-9) {
      best = v
      ties = [m]
    } else if (Math.abs(v - best) <= 1e-9) ties.push(m)
  }
  return ties[pick(ties.length)]
}

// ---------- off-thread thinking ----------

let worker: Worker | null = null
let seq = 0
const waiting = new Map<number, (m: unknown) => void>()

/**
 * Run a game's `ai.ts` `choose(state, difficulty, seed)` in a Web Worker so deep
 * searches (chess, reversi, checkers) never freeze the frame.
 */
export function think<M>(
  game: string,
  state: unknown,
  difficulty: string,
  seed: number,
): Promise<M> {
  if (!worker) {
    worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = (e: MessageEvent<{ id: number; move: unknown }>) => {
      waiting.get(e.data.id)?.(e.data.move)
      waiting.delete(e.data.id)
    }
  }
  const id = ++seq
  return new Promise<M>((resolve) => {
    waiting.set(id, resolve as (m: unknown) => void)
    worker?.postMessage({ id, game, state, difficulty, seed })
  })
}
