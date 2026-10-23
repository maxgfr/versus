import type { Side } from '../../core/game.ts'
import { banner, namePill } from '../../core/hud.ts'
import { clamp } from '../../core/fx/ease.ts'
import type { Draw } from '../../core/render/draw.ts'
import { alpha, C, mix, SIDE, shade } from '../../core/render/palette.ts'
import { H, MID, W } from '../../core/stage.ts'
import { drawRounds } from '../../engines/reflex/index.ts'
import type { State } from './index.ts'
import { type Bike, BLOCKS, CELL, COLS, COUNT, cellCentre, DX, DY, ROWS, X0, Y0 } from './rules.ts'

/** A turn button's look, copied into the state so the online guest can draw it. */
export interface TurnLook {
  side: Side
  lane: 0 | 1
  /** -1 turns left, +1 turns right. */
  turn: -1 | 1
  x: number
  y: number
  r: number
  on: boolean
}

const BOARD_H = ROWS * CELL
const BOARD_W = COLS * CELL

/** Each side's bikes: lane 0 in the side's colour, lane 1 a lighter tint. */
export function bikeColour(k: Pick<Bike, 'side' | 'lane'>): string {
  return k.lane === 0 ? SIDE[k.side].main : mix(SIDE[k.side].main, '#ffffff', 0.38)
}

function table(g: Draw, now: number): void {
  g.fillView(
    g.rad(W / 2, H / 2, 200, 1400, [
      [0, '#2b2556'],
      [1, '#080612'],
    ]),
  )
  const v = g.stage.view
  // Strips for the players' buttons, team-tinted.
  g.rect(v.x - 2, v.y - 2, v.w + 4, Y0 - v.y + 2, alpha(C.blue, 0.16))
  g.rect(v.x - 2, Y0 + BOARD_H, v.w + 4, v.y + v.h - Y0 - BOARD_H + 2, alpha(C.red, 0.16))
  // The board: a dark glass floor, tinted toward each end, with a faint neon grid.
  g.rrect(X0 - 16, Y0 - 16, BOARD_W + 32, BOARD_H + 32, 26, '#05040c')
  g.rect(
    X0,
    Y0,
    BOARD_W,
    BOARD_H,
    g.lin(0, Y0, 0, Y0 + BOARD_H, [
      [0, '#121035'],
      [0.5, '#0c0a20'],
      [1, '#1c0d24'],
    ]),
  )
  for (let i = 0; i <= COLS; i++)
    g.line(X0 + i * CELL, Y0, X0 + i * CELL, Y0 + BOARD_H, alpha(C.cyan, 0.075), 2)
  for (let j = 0; j <= ROWS; j++)
    g.line(X0, Y0 + j * CELL, X0 + BOARD_W, Y0 + j * CELL, alpha(C.cyan, 0.075), 2)
  // A scanline sweeping the floor, so it hums even when nothing moves.
  const sy = Y0 + ((now * 160) % BOARD_H)
  g.rect(
    X0,
    sy - 40,
    BOARD_W,
    40,
    g.lin(0, sy - 40, 0, sy, [
      [0, alpha(C.cyan, 0)],
      [1, alpha(C.cyan, 0.06)],
    ]),
  )
  // Walls glow in the colour of the side whose edge they are.
  for (const [y, col] of [
    [Y0, SIDE[1].main],
    [Y0 + BOARD_H, SIDE[0].main],
  ] as const) {
    g.line(X0, y, X0 + BOARD_W, y, alpha(col, 0.28), 26)
    g.line(X0, y, X0 + BOARD_W, y, col, 8)
    g.line(X0, y, X0 + BOARD_W, y, alpha('#ffffff', 0.5), 2)
  }
  g.line(X0, Y0, X0, Y0 + BOARD_H, alpha(C.white, 0.35), 8)
  g.line(X0 + BOARD_W, Y0, X0 + BOARD_W, Y0 + BOARD_H, alpha(C.white, 0.35), 8)
}

/** The fixed wall blocks: raised dark slabs with a neon rim. */
function blocks(g: Draw): void {
  for (const left of [true, false]) {
    const cs = BLOCKS.filter((c) => c.x < COLS / 2 === left)
    const x0 = Math.min(...cs.map((c) => c.x))
    const x1 = Math.max(...cs.map((c) => c.x)) + 1
    const y0 = Math.min(...cs.map((c) => c.y))
    const y1 = Math.max(...cs.map((c) => c.y)) + 1
    const x = X0 + x0 * CELL
    const y = Y0 + y0 * CELL
    const w = (x1 - x0) * CELL
    const h = (y1 - y0) * CELL
    g.rrect(x - 4, y - 4, w + 8, h + 8, 14, alpha(C.white, 0.12))
    g.tile(x, y, w, h + 10, 12, '#3a3459', 10)
    g.rrect(x + 2, y + 2, w - 4, h - 12, 10, undefined, alpha(C.cyan, 0.45), 3)
    for (let k = 1; k < 4; k++)
      g.line(x + 12, y + (h * k) / 4, x + w - 12, y + (h * k) / 4, alpha('#000000', 0.25), 4)
  }
}

/** Interpolated position of a bike between two ticks. */
function bikePos(k: Bike, p: number): { x: number; y: number } {
  const c = cellCentre(k.x, k.y)
  const t = k.alive ? p : 0.5
  return { x: c.x + (DX[k.dir] ?? 0) * CELL * t, y: c.y + (DY[k.dir] ?? 0) * CELL * t }
}

/**
 * The order a bike laid its trail cells in (spawn to head). The board only
 * stores who owns each cell, and stitching every pair of neighbours together
 * turns two runs of one trail lying side by side into a ladder. The order is
 * derived from the board (so the online guest gets the same picture): kept
 * per bike and extended by the cells laid since the last frame, and rebuilt
 * with a short search when it no longer fits (new round, a guest joining).
 */
const orderCache = new Map<number, number[]>()
/** Cell counts for which the search already gave up, so it is not rerun every frame. */
const orderFailed = new Map<number, number>()

function trailOrder(cells: readonly number[], k: Bike): number[] | null {
  const id = k.id + 1
  const head = k.y * COLS + k.x
  if (cells[head] !== id) return null
  let n = 0
  for (const c of cells) if (c === id) n++
  const nbrs = (i: number): number[] => {
    const x = i % COLS
    const y = (i - x) / COLS
    const out: number[] = []
    if (x > 0) out.push(i - 1)
    if (x < COLS - 1) out.push(i + 1)
    if (y > 0) out.push(i - COLS)
    if (y < ROWS - 1) out.push(i + COLS)
    return out.filter((j) => cells[j] === id)
  }
  const cached = orderCache.get(k.id)
  if (cached && cached.length <= n && cached.every((i) => cells[i] === id)) {
    const inPath = new Set(cached)
    const path = [...cached]
    // Cells laid since: walk on from the old head through cells not on the path yet.
    for (let guard = 0; path.length < n && guard < n; guard++) {
      const last = path[path.length - 1] as number
      const next = nbrs(last).filter((j) => !inPath.has(j))
      const pick =
        next.includes(head) && next.length > 1 && path.length < n - 1
          ? next.find((j) => j !== head)
          : next[0]
      if (pick === undefined) break
      path.push(pick)
      inPath.add(pick)
    }
    if (path.length === n && path[path.length - 1] === head) {
      orderCache.set(k.id, path)
      return path
    }
  }
  // Rebuild: a depth-first search from the head that must use every cell,
  // trying the most cornered neighbour first, with a step budget.
  const seen = new Set<number>([head])
  const path = [head]
  let budget = 40000
  const go = (): boolean => {
    if (path.length === n) return true
    if (--budget < 0) return false
    const at = path[path.length - 1] as number
    const next = nbrs(at)
      .filter((j) => !seen.has(j))
      .sort(
        (p, q) =>
          nbrs(p).filter((j) => !seen.has(j)).length - nbrs(q).filter((j) => !seen.has(j)).length,
      )
    for (const j of next) {
      seen.add(j)
      path.push(j)
      if (go()) return true
      path.pop()
      seen.delete(j)
    }
    return false
  }
  if (orderFailed.get(k.id) === n) return null
  if (!go()) {
    orderCache.delete(k.id)
    orderFailed.set(k.id, n)
    return null
  }
  path.reverse()
  orderCache.set(k.id, path)
  return path
}

/** Segments between consecutive trail cells (or every neighbour pair if the order is unknown). */
function trailSegments(cells: readonly number[], k: Bike): [number, number, number, number][] {
  const out: [number, number, number, number][] = []
  const order = trailOrder(cells, k)
  if (order) {
    for (let i = 1; i < order.length; i++) {
      const a = order[i - 1] as number
      const b = order[i] as number
      out.push([a % COLS, Math.floor(a / COLS), b % COLS, Math.floor(b / COLS)])
    }
    return out
  }
  const id = k.id + 1
  for (let y = 0; y < ROWS; y++)
    for (let x = 0; x < COLS; x++) {
      if (cells[y * COLS + x] !== id) continue
      if (x + 1 < COLS && cells[y * COLS + x + 1] === id) out.push([x, y, x + 1, y])
      if (y + 1 < ROWS && cells[(y + 1) * COLS + x] === id) out.push([x, y, x, y + 1])
    }
  return out
}

/**
 * Trails: one stroked path per bike (so the glow does not stack up at joints),
 * a soft halo, the solid wall, and a bright core. A bike that crashed when the
 * round ends dissolves (derezzes) to a faint ghost.
 */
function trails(g: Draw, s: State, now: number, p: number): void {
  const { cells, bikes } = s.b
  const r = s.rounds
  const c = g.ctx
  // A faster match (hard computer) glows a little hotter.
  const halo = s.tempo > 1 ? 0.32 : 0.22
  for (const k of bikes) {
    const col = bikeColour(k)
    const head = bikePos(k, p)
    const hc = cellCentre(k.x, k.y)
    const segs = trailSegments(cells, k)
    const build = (q: CanvasRenderingContext2D) => {
      for (const [ax, ay, bx, by] of segs) {
        const a = cellCentre(ax, ay)
        const b = cellCentre(bx, by)
        q.moveTo(a.x, a.y)
        q.lineTo(b.x, b.y)
      }
      // Up to the bike itself, so the wall grows smoothly behind it.
      q.moveTo(hc.x, hc.y)
      q.lineTo(head.x, head.y)
    }
    const fade = !k.alive && r.phase === 'between' ? Math.max(0.22, 1 - (now - r.at) * 1.4) : 1
    const flicker = fade < 1 && fade > 0.22 ? 0.75 + 0.25 * Math.sin(now * 50 + k.id) : 1
    g.alpha(fade * flicker, () => {
      c.save()
      c.lineJoin = 'round'
      c.lineCap = 'round'
      g.path(build, undefined, alpha(col, halo), CELL * 1.2)
      g.path(build, undefined, shade(col, -0.35), CELL * 0.72)
      g.path(build, undefined, col, CELL * 0.58)
      g.path(build, undefined, alpha('#ffffff', 0.6), CELL * 0.16)
      c.restore()
    })
  }
}

/** A light cycle seen from above, nose toward its heading, headlight beam ahead. */
function cycle(
  g: Draw,
  x: number,
  y: number,
  angle: number,
  col: string,
  now: number,
  k: number,
): void {
  g.at(x, y, angle, () => {
    // Headlight: the one yellow thing on the board for each bike.
    g.poly(
      [30, -9, 160, -50, 160, 50, 30, 9],
      g.rad(30, 0, 4, 140, [
        [0, alpha('#fff2a8', 0.42)],
        [1, alpha('#fff2a8', 0)],
      ]),
    )
    g.alpha(0.35 + 0.1 * Math.sin(now * 12 + k), () => g.rrect(-44, -30, 88, 60, 28, col))
    // Wheels.
    g.rrect(-36, -12, 22, 24, 9, C.ink)
    g.rrect(18, -12, 22, 24, 9, C.ink)
    // Body: a lipped capsule with a gloss strip and a dark canopy.
    g.rrect(-34, -17, 70, 36, 17, shade(col, -0.45))
    g.rrect(
      -34,
      -20,
      70,
      36,
      17,
      g.lin(0, -20, 0, 16, [
        [0, shade(col, 0.35)],
        [1, col],
      ]),
    )
    g.rrect(-22, -15, 34, 8, 4, alpha('#ffffff', 0.55))
    g.rrect(0, -11, 20, 20, 8, shade(col, -0.65))
    g.rrect(4, -8, 8, 6, 3, alpha('#ffffff', 0.5))
    g.circle(36, 0, 6, C.yellow)
    g.circle(-35, 0, 5, shade(col, -0.2))
  })
}

/** A bike that crashed: a dark, scorched husk where it stopped. */
function wreck(g: Draw, x: number, y: number, angle: number, col: string): void {
  g.at(x, y, angle + 0.35, () => {
    g.rrect(-30, -20, 62, 38, 16, '#231f36')
    g.rrect(-24, -15, 50, 26, 12, '#2f2a46')
    g.line(-16, -10, 16, 10, alpha(col, 0.85), 6)
    g.line(16, -10, -16, 10, alpha(col, 0.85), 6)
  })
}

function bikes(g: Draw, s: State, now: number, p: number, lean: number[]): void {
  for (const k of s.b.bikes) {
    const at = bikePos(k, p)
    const angle = Math.atan2(DY[k.dir] ?? 0, DX[k.dir] ?? 0)
    const col = bikeColour(k)
    if (!k.alive) wreck(g, at.x, at.y, angle, col)
    else cycle(g, at.x, at.y, angle - (lean[k.id] ?? 0), col, now, k.id)
  }
  // Each bike's marker (red circle, blue square) rides above it, upright for its player.
  for (const k of s.b.bikes) {
    if (!k.alive) continue
    const at = bikePos(k, p)
    g.forSide(k.side, at.x, at.y, () => g.sideMark(k.side, 0, 0, 8, C.white))
  }
}

/**
 * A round glossy button with a bent arrow (go straight, then turn), upright for
 * its side. Lane 1 (2 vs 2) is a lighter tint, like its bike.
 */
function turn(g: Draw, t: TurnLook): void {
  const col = t.lane === 0 ? SIDE[t.side].main : mix(SIDE[t.side].main, '#ffffff', 0.38)
  const depth = t.r * 0.16
  const press = t.on ? 1 : 0
  g.forSide(t.side, t.x, t.y, () => {
    if (t.on) g.circle(0, depth, t.r + 18, alpha(col, 0.3))
    g.circle(0, depth, t.r, shade(col, -0.45))
    g.circle(
      0,
      depth * press,
      t.r,
      g.rad(
        0,
        0,
        t.r * 0.1,
        t.r,
        [
          [0, shade(col, 0.3)],
          [1, col],
        ],
        -t.r * 0.3,
        -t.r * 0.4,
      ),
    )
    g.alpha(0.5, () =>
      g.ellipse(-t.r * 0.32, -t.r * 0.42 + depth * press, t.r * 0.3, t.r * 0.16, '#fff', -0.5),
    )
    // Bent arrow: up the stem, round the corner, arrowhead pointing sideways.
    const d = t.turn
    const k = t.r * 0.5
    const y = depth * press + k * 0.12
    const lw = t.r * 0.17
    g.ctx.save()
    g.ctx.lineJoin = 'round'
    g.path(
      (c) => {
        c.moveTo(-d * k * 0.45, y + k * 0.75)
        c.lineTo(-d * k * 0.45, y - k * 0.05)
        c.quadraticCurveTo(-d * k * 0.45, y - k * 0.4, -d * k * 0.05, y - k * 0.4)
        c.lineTo(d * k * 0.25, y - k * 0.4)
      },
      undefined,
      C.white,
      lw,
    )
    g.ctx.restore()
    g.poly(
      [d * k * 0.85, y - k * 0.4, d * k * 0.2, y - k * 0.95, d * k * 0.2, y + k * 0.15],
      C.white,
    )
  })
}

export function renderSnakes(
  g: Draw,
  s: State,
  now: number,
  names: [string, string],
  over: boolean,
  look: { p: number; lean: number[] },
): void {
  table(g, now)
  blocks(g)
  const p = clamp(look.p, 0, 1)
  trails(g, s, now, p)
  bikes(g, s, now, p, look.lean)
  // Online, each phone shows only its own player's buttons.
  for (const t of s.ctl) if (g.viewer === null || t.side === g.viewer) turn(g, t)
  const alive = (side: Side) => s.b.bikes.some((k) => k.side === side && k.alive)
  namePill(g, 0, names[0], { active: alive(0), text: alive(0) ? undefined : 'Crashed' })
  namePill(g, 1, names[1], { active: alive(1), text: alive(1) ? undefined : 'Crashed' })
  drawRounds(g, s.rounds, now, { over: true })
  if (over) return
  const r = s.rounds
  if (r.phase === 'between' && r.text) {
    banner(g, undefined, r.text, MID, { size: 56, alpha: Math.min(1, (now - r.at) * 4) })
    return
  }
  // The first round starts on the shell's countdown; later ones get their own.
  if (r.phase !== 'play' || r.round === 1) return
  const e = now - r.at
  if (e < 0.8) banner(g, undefined, `Round ${r.round}`, MID, { size: 64 })
  else if (e < COUNT - 0.4) {
    const n = Math.floor((e - 0.8) / 0.4)
    const digit = ['3', '2', '1'][n] ?? '1'
    const pop = 1 + 0.25 * Math.max(0, 1 - ((e - 0.8) % 0.4) / 0.15)
    banner(g, undefined, digit, MID, { size: 150 * pop })
  } else if (e < COUNT) banner(g, undefined, 'GO!', MID, { size: 110, color: C.yellow })
}
