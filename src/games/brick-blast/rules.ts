import type { Difficulty, Side } from '../../core/game.ts'
import type { Rng } from '../../core/rng.ts'
import { H, MID, W } from '../../core/stage.ts'

/**
 * Brick Blast: two independent breakout boards, one per half. Every rule is
 * written in red's frame (red's half is the bottom of the world, its midline
 * wall at y = MID, its edge at y = H). Blue's board is the same code mirrored by
 * `frame()` when it is drawn or fed input. Pure: no DOM, no Math.random.
 *
 * Breaking a brick sends a grey junk brick to the rival's wall. A ball that
 * falls past the paddle costs a life. Clear your wall first, or lose all your
 * lives, or when the clock runs out, break the most bricks.
 */

export const COLS = 8
export const CELL_W = W / COLS
export const CELL_H = 64
export const GRID_TOP = MID + 84
/** Rows the wall may grow into when junk lands on it. */
export const MAX_ROWS = 9
export const START_ROWS = 5
export const BRICK_W = CELL_W - 12
export const BRICK_H = CELL_H - 12
export const PADDLE_Y = 1640
export const PADDLE_H = 28
export const PADDLE_HALF = 110
/** Top paddle speed: fast enough to stay under a finger. */
export const PADDLE_SPEED = 4200
/** How much of the paddle's sideways speed turns into angle (english) on a hit. */
export const ENGLISH = 0.4
/** Extra ball speed a paddle swung at full speed adds (it fades back over ~1 s). */
export const DRIVE = 0.35
export const BALL_R = 22
export const LIVES = 3
/** Seconds between junk bricks dropping into a wall. */
export const JUNK_EVERY = 0.9
export const SPEED0 = 820
export const SPEED_MAX = 1500
const SPEED_UP = 1.015
/** Seconds without a launch before the ball goes on its own. */
const AUTO_LAUNCH = 1.6
/** Fixed sub-steps per step: keeps the ball from tunnelling through bricks. */
const SUB = 3

/**
 * Against the computer its level also sets the pace: the ball's serve speed and
 * top rally speed are scaled. Local 2P and online play at 1.
 */
export const TEMPO: Record<Difficulty, number> = { easy: 0.85, normal: 1, hard: 1.28 }

/** The tempo of a match, fixed once at setup. */
export function tempoOf(d: Difficulty, bots: readonly boolean[]): number {
  return bots.some(Boolean) ? TEMPO[d] : 1
}

export interface Brick {
  c: number
  r: number
  junk: boolean
  /** Game time the brick appeared (drives the drop-in animation). */
  at: number
}

export interface Ball {
  x: number
  y: number
  vx: number
  vy: number
  speed: number
  stuck: boolean
  /** Speed multiplier from a driven paddle hit, decaying back to 1. */
  boost: number
}

export interface Board {
  /** Paddle centre x (red frame). */
  px: number
  /** Paddle velocity (world units / s) over the last step: a swing puts english on the ball. */
  pvx: number
  ball: Ball
  bricks: Brick[]
  /** Junk bricks sent by the rival and not yet dropped into this wall. */
  queue: number
  /** Cooldown before the next junk drop. */
  junkT: number
  lives: number
  /** Bricks this player's ball has broken (junk included). */
  broken: number
  /** Seconds the ball has been stuck to the paddle. */
  serveT: number
  /** Ball pace multiplier (1 = normal), fixed for the match. */
  tempo: number
}

export interface Match {
  boards: [Board, Board]
  /** Match length in seconds. */
  limit: number
  t: number
}

/** What a side wants this step: paddle target x (red frame) or null, and a launch tap. */
export interface Cmd {
  x: number | null
  launch: boolean
}

export type Event =
  | { kind: 'brick'; side: Side; x: number; y: number; row: number; junk: boolean; sent: boolean }
  | { kind: 'paddle'; side: Side; x: number; y: number; off: number; drive: number }
  | { kind: 'wall'; side: Side; x: number; y: number }
  | { kind: 'junk'; side: Side; c: number; r: number }
  | { kind: 'lost'; side: Side; x: number; y: number; lives: number }
  | { kind: 'launch'; side: Side; drive: number }

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v)

export const brickRect = (c: number, r: number) => ({
  x: c * CELL_W + 6,
  y: GRID_TOP + r * CELL_H + 6,
  w: BRICK_W,
  h: BRICK_H,
})

export function startBricks(now = 0): Brick[] {
  const out: Brick[] = []
  for (let r = 0; r < START_ROWS; r++)
    for (let c = 0; c < COLS; c++) out.push({ c, r, junk: false, at: now })
  return out
}

export function serveBall(px: number, tempo = 1): Ball {
  return {
    x: px,
    y: PADDLE_Y - PADDLE_H / 2 - BALL_R,
    vx: 0,
    vy: 0,
    speed: SPEED0 * tempo,
    stuck: true,
    boost: 1,
  }
}

export function newBoard(tempo = 1): Board {
  return {
    px: W / 2,
    pvx: 0,
    ball: serveBall(W / 2, tempo),
    bricks: startBricks(),
    queue: 0,
    junkT: 0,
    lives: LIVES,
    broken: 0,
    serveT: 0,
    tempo,
  }
}

export function newMatch(limit: number, tempo = 1): Match {
  return { boards: [newBoard(tempo), newBoard(tempo)], limit, t: 0 }
}

/** Bricks still standing in a wall, counting junk on its way. */
export const remaining = (b: Board): number => b.bricks.length + b.queue

/**
 * Where a ball moving at (vx, vy) from (x, y) crosses the horizontal line
 * `targetY`, bouncing off the side walls. Null if it is not heading there.
 */
export function predictX(
  x: number,
  y: number,
  vx: number,
  vy: number,
  targetY: number,
): number | null {
  if (vy <= 0) return null
  const t = (targetY - y) / vy
  if (t < 0) return null
  const lo = BALL_R
  const span = W - 2 * BALL_R
  const p = (((x + vx * t - lo) % (2 * span)) + 2 * span) % (2 * span)
  return lo + (p > span ? 2 * span - p : p)
}

function stepPaddle(b: Board, cmd: Cmd, dt: number): void {
  const was = b.px
  if (cmd.x !== null) {
    const max = PADDLE_SPEED * dt
    b.px += clamp(cmd.x - b.px, -max, max)
  }
  b.px = clamp(b.px, PADDLE_HALF, W - PADDLE_HALF)
  b.pvx = (b.px - was) / dt
}

/** 0..1 how hard the paddle is being swung. */
const swing = (b: Board): number => Math.min(1, Math.abs(b.pvx) / PADDLE_SPEED)

/** The first brick the ball overlaps: bounces it and removes the brick. */
function hitBrick(b: Board, ball: Ball): { brick: Brick; cx: number; cy: number } | null {
  for (let i = 0; i < b.bricks.length; i++) {
    const br = b.bricks[i]
    if (!br) continue
    const rc = brickRect(br.c, br.r)
    const px = clamp(ball.x, rc.x, rc.x + rc.w)
    const py = clamp(ball.y, rc.y, rc.y + rc.h)
    const dx = ball.x - px
    const dy = ball.y - py
    const d2 = dx * dx + dy * dy
    if (d2 >= BALL_R * BALL_R) continue
    let nx: number
    let ny: number
    if (d2 > 1e-9) {
      const d = Math.sqrt(d2)
      nx = dx / d
      ny = dy / d
      ball.x = px + nx * BALL_R
      ball.y = py + ny * BALL_R
    } else {
      // Centre inside the brick (fast ball): leave through the nearest face.
      const l = ball.x - rc.x
      const r = rc.x + rc.w - ball.x
      const t = ball.y - rc.y
      const bt = rc.y + rc.h - ball.y
      const m = Math.min(l, r, t, bt)
      if (m === l) {
        nx = -1
        ny = 0
        ball.x = rc.x - BALL_R
      } else if (m === r) {
        nx = 1
        ny = 0
        ball.x = rc.x + rc.w + BALL_R
      } else if (m === t) {
        nx = 0
        ny = -1
        ball.y = rc.y - BALL_R
      } else {
        nx = 0
        ny = 1
        ball.y = rc.y + rc.h + BALL_R
      }
    }
    const vn = ball.vx * nx + ball.vy * ny
    if (vn < 0) {
      ball.vx -= 2 * vn * nx
      ball.vy -= 2 * vn * ny
    }
    b.bricks.splice(i, 1)
    return { brick: br, cx: rc.x + rc.w / 2, cy: rc.y + rc.h / 2 }
  }
  return null
}

/**
 * Advance one board by dt. Returns how many normal bricks were broken (each
 * one sends a junk brick to the rival). Events are appended to `out`.
 */
export function stepBoard(
  b: Board,
  side: Side,
  dt: number,
  cmd: Cmd,
  rng: Rng,
  out: Event[],
): number {
  stepPaddle(b, cmd, dt)
  const ball = b.ball
  if (ball.stuck) {
    ball.x = b.px
    ball.y = PADDLE_Y - PADDLE_H / 2 - BALL_R
    b.serveT += dt
    if (cmd.launch || b.serveT >= AUTO_LAUNCH) {
      // A moving paddle serves the way it is going; a still one serves at a slight random angle.
      const k = swing(b)
      const a =
        Math.abs(b.pvx) > 300 ? Math.sign(b.pvx) * (0.2 + 0.45 * k) : (rng.next() - 0.5) * 0.7
      ball.vx = Math.sin(a) * ball.speed
      ball.vy = -Math.cos(a) * ball.speed
      ball.boost = 1 + DRIVE * k * 0.5
      ball.stuck = false
      b.serveT = 0
      out.push({ kind: 'launch', side, drive: k })
    }
    return 0
  }
  let sent = 0
  const h = dt / SUB
  const top = PADDLE_Y - PADDLE_H / 2
  for (let i = 0; i < SUB; i++) {
    // A driven ball eases back to its rally speed.
    if (ball.boost !== 1) {
      ball.boost = 1 + (ball.boost - 1) * Math.exp(-1.6 * h)
      if (ball.boost < 1.002) ball.boost = 1
      const s = Math.hypot(ball.vx, ball.vy) || 1
      const v = ball.speed * ball.boost
      ball.vx = (ball.vx / s) * v
      ball.vy = (ball.vy / s) * v
    }
    ball.x += ball.vx * h
    ball.y += ball.vy * h
    if (ball.x < BALL_R) {
      ball.x = BALL_R
      ball.vx = Math.abs(ball.vx)
      out.push({ kind: 'wall', side, x: ball.x, y: ball.y })
    } else if (ball.x > W - BALL_R) {
      ball.x = W - BALL_R
      ball.vx = -Math.abs(ball.vx)
      out.push({ kind: 'wall', side, x: ball.x, y: ball.y })
    }
    if (ball.y < MID + BALL_R) {
      ball.y = MID + BALL_R
      ball.vy = Math.abs(ball.vy)
      out.push({ kind: 'wall', side, x: ball.x, y: ball.y })
    }
    if (
      ball.vy > 0 &&
      ball.y + BALL_R >= top &&
      ball.y - BALL_R <= PADDLE_Y + PADDLE_H / 2 &&
      Math.abs(ball.x - b.px) <= PADDLE_HALF + BALL_R
    ) {
      // Off-centre hits angle the ball; a swinging paddle adds english
      // (more angle the way it moves) and drives the ball faster.
      const off = clamp((ball.x - b.px) / PADDLE_HALF, -1, 1)
      const k = swing(b)
      const a = clamp(off * 1.05 + Math.sign(b.pvx) * k * ENGLISH, -1.2, 1.2)
      ball.boost = Math.max(ball.boost, 1 + DRIVE * k)
      const v = ball.speed * ball.boost
      ball.y = top - BALL_R
      ball.vx = Math.sin(a) * v
      ball.vy = -Math.cos(a) * v
      out.push({ kind: 'paddle', side, x: ball.x, y: top, off, drive: k })
    }
    const hit = hitBrick(b, ball)
    if (hit) {
      const { brick, cx, cy } = hit
      b.broken++
      ball.speed = Math.min(SPEED_MAX * b.tempo, ball.speed * SPEED_UP)
      const s = Math.hypot(ball.vx, ball.vy) || 1
      ball.vx = (ball.vx / s) * ball.speed * ball.boost
      ball.vy = (ball.vy / s) * ball.speed * ball.boost
      if (!brick.junk) sent++
      out.push({
        kind: 'brick',
        side,
        x: cx,
        y: cy,
        row: brick.r,
        junk: brick.junk,
        sent: !brick.junk,
      })
    }
    // A ball stuck in a near-horizontal loop would never reach the bricks.
    const v = ball.speed * ball.boost
    if (Math.abs(ball.vy) < v * 0.2) {
      ball.vy = (ball.vy < 0 ? -1 : 1) * v * 0.2
      ball.vx = (ball.vx < 0 ? -1 : 1) * Math.sqrt(v * v - ball.vy * ball.vy)
    }
    if (ball.y > H + BALL_R) {
      b.lives = Math.max(0, b.lives - 1)
      out.push({ kind: 'lost', side, x: ball.x, y: H - BALL_R, lives: b.lives })
      b.ball = serveBall(b.px, b.tempo)
      b.serveT = 0
      return sent
    }
  }
  return sent
}

/** Junk waiting in `b.queue` drops into a random empty cell of its wall, one every JUNK_EVERY. */
function dropJunk(b: Board, side: Side, dt: number, rng: Rng, now: number, out: Event[]): void {
  if (b.queue <= 0) {
    b.junkT = 0
    return
  }
  b.junkT -= dt
  if (b.junkT > 0) return
  const taken = new Set(b.bricks.map((k) => k.c + k.r * COLS))
  const free: [number, number][] = []
  // Never drop a brick on top of the ball: it would be swallowed or break at once.
  const ball = b.ball
  const clear = (c: number, r: number): boolean => {
    const rc = brickRect(c, r)
    const px = clamp(ball.x, rc.x - 8, rc.x + rc.w + 8)
    const py = clamp(ball.y, rc.y - 8, rc.y + rc.h + 8)
    return (ball.x - px) ** 2 + (ball.y - py) ** 2 > (BALL_R + 4) ** 2
  }
  for (let r = 0; r < MAX_ROWS; r++)
    for (let c = 0; c < COLS; c++) if (!taken.has(c + r * COLS) && clear(c, r)) free.push([c, r])
  if (free.length === 0) return
  const [c, r] = rng.pick(free)
  b.bricks.push({ c, r, junk: true, at: now })
  b.queue--
  b.junkT = JUNK_EVERY
  out.push({ kind: 'junk', side, c, r })
}

/** Advance the whole match by dt. `cmds[side]` is what that side asks for this step. */
export function step(m: Match, dt: number, cmds: [Cmd, Cmd], rng: Rng): Event[] {
  const out: Event[] = []
  m.t += dt
  const sent: [number, number] = [0, 0]
  for (const side of [0, 1] as Side[]) {
    const b = m.boards[side]
    sent[side] = stepBoard(b, side, dt, cmds[side], rng, out)
  }
  // Junk lands in the rival's wall.
  m.boards[1].queue += sent[0]
  m.boards[0].queue += sent[1]
  for (const side of [0, 1] as Side[]) dropJunk(m.boards[side], side, dt, rng, m.t, out)
  return out
}

/** The winner once the match is decided, else null. */
export function winner(m: Match): Side | 'draw' | null {
  const [a, b] = m.boards
  const lostA = a.lives <= 0
  const lostB = b.lives <= 0
  if (lostA && lostB) return 'draw'
  if (lostA) return 1
  if (lostB) return 0
  const clearedA = remaining(a) === 0
  const clearedB = remaining(b) === 0
  if (clearedA && clearedB) return 'draw'
  if (clearedA) return 0
  if (clearedB) return 1
  if (m.t >= m.limit) {
    if (a.broken !== b.broken) return a.broken > b.broken ? 0 : 1
    return 'draw'
  }
  return null
}
