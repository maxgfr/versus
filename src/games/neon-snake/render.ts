import type { Side } from '../../core/game.ts'
import { banner, namePill } from '../../core/hud.ts'
import { clamp, outBack } from '../../core/fx/ease.ts'
import type { Draw } from '../../core/render/draw.ts'
import { alpha, C, mix, SIDE, shade } from '../../core/render/palette.ts'
import { H, MID, W } from '../../core/stage.ts'
import { drawRounds } from '../../engines/reflex/index.ts'
import type { State } from './index.ts'
import {
  BLOCK_Y0,
  BLOCK_Y1,
  CELL,
  COLS,
  COUNT,
  cellCentre,
  type Dot,
  DX,
  DY,
  reverse,
  ROWS,
  type Snake,
  TICK,
  X0,
  Y0,
} from './rules.ts'

/** A joystick's visuals, copied into the state so the online guest can draw it. */
export interface StickLook {
  side: Side
  on: boolean
  bx: number
  by: number
  kx: number
  ky: number
  r: number
}

const BW = COLS * CELL
const BH = ROWS * CELL
const DEAD = '#3b3552'

function table(g: Draw, now: number, speed: number): void {
  g.fillView(
    g.rad(W / 2, H / 2, 150, 1300, [
      [0, '#261c52'],
      [1, '#07050f'],
    ]),
  )
  const v = g.stage.view
  g.rect(v.x - 2, v.y - 2, v.w + 4, Y0 - v.y + 2, alpha(C.blue, 0.14))
  g.rect(v.x - 2, Y0 + BH, v.w + 4, v.y + v.h - Y0 - BH + 2, alpha(C.red, 0.14))
  // The plate: a dark glass slab with a lip, tinted toward each player's end.
  g.rrect(X0 - 18, Y0 - 12, BW + 36, BH + 36, 30, '#04030a')
  g.rrect(
    X0 - 18,
    Y0 - 18,
    BW + 36,
    BH + 36,
    30,
    g.lin(0, Y0, 0, Y0 + BH, [
      [0, '#121038'],
      [0.5, '#0a081a'],
      [1, '#1d0c25'],
    ]),
  )
  // A dot grid at the cell corners, gently breathing, livelier as the round speeds up.
  const a = 0.13 + 0.1 * speed + 0.04 * Math.sin(now * (2 + speed * 4))
  for (let i = 1; i < COLS; i++)
    for (let j = 1; j < ROWS; j++) g.circle(X0 + i * CELL, Y0 + j * CELL, 2.6, alpha(C.cyan, a))
  // Edges: each player's end glows in their colour, the sides are plain rails.
  for (const [y, col] of [
    [Y0 - 4, SIDE[1].main],
    [Y0 + BH + 4, SIDE[0].main],
  ] as const) {
    g.line(X0, y, X0 + BW, y, alpha(col, 0.32), 26)
    g.line(X0, y, X0 + BW, y, col, 8)
    g.line(X0, y, X0 + BW, y, alpha('#ffffff', 0.55), 2)
  }
  g.line(X0 - 4, Y0, X0 - 4, Y0 + BH, alpha(C.white, 0.28), 6)
  g.line(X0 + BW + 4, Y0, X0 + BW + 4, Y0 + BH, alpha(C.white, 0.28), 6)
}

/** The wall blocks at mid-height on both edges: raised dark slabs with a neon rim. */
function blocks(g: Draw): void {
  for (const col of [0, COLS - 1]) {
    const x = X0 + col * CELL
    const y = Y0 + BLOCK_Y0 * CELL
    const h = (BLOCK_Y1 - BLOCK_Y0 + 1) * CELL
    g.rrect(x - 4, y - 4, CELL + 8, h + 8, 14, alpha(C.white, 0.12))
    g.tile(x, y, CELL, h + 10, 12, '#3a3459', 10)
    g.rrect(x + 2, y + 2, CELL - 4, h - 12, 10, undefined, alpha(C.cyan, 0.45), 3)
  }
}

/** Glowing orbs: the one yellow thing on the board, with a sparkle orbiting each. */
function dots(g: Draw, cells: Dot[], now: number): void {
  for (const d of cells) {
    // Pop in where it appears.
    const born = d.t === undefined ? 1 : clamp((now - d.t) / 0.35, 0, 1)
    if (born <= 0) continue
    const k = outBack(born)
    const c = cellCentre(d)
    g.at(c.x, c.y, 0, () => dot(g, d, now), k)
  }
}

/** One orb, centred on the origin. */
function dot(g: Draw, d: Dot, now: number): void {
  const pulse = 0.5 + 0.5 * Math.sin(now * 5 + d.x * 1.3 + d.y * 0.7)
  g.circle(
    0,
    0,
    CELL * 0.75,
    g.rad(0, 0, 2, CELL * 0.75, [
      [0, alpha(C.yellow, 0.45 + 0.2 * pulse)],
      [1, alpha(C.yellow, 0)],
    ]),
  )
  g.ball(0, 0, CELL * (0.31 + 0.03 * pulse), C.yellow, 1)
  const oa = now * 3 + d.x
  g.star(Math.cos(oa) * CELL * 0.42, Math.sin(oa) * CELL * 0.42, 7, '#fff8d0', 4, 0.4)
}

/**
 * One snake: a tapered, glossy neon tube through its cells (head interpolated
 * between ticks), a bulge that travels down after each meal, and a head with
 * eyes. A crashed snake drains to grey from the head back.
 */
function snake(
  g: Draw,
  s: Snake,
  o: { p: number; len: number; now: number; eatT: number; won: boolean; moving: boolean },
): void {
  const { now, eatT, len } = o
  const base = SIDE[s.side].main
  const pts = s.body.map(cellCentre)
  const head = pts[0]
  if (!head) return
  // The head glides toward the cell it will enter (the queued turn if any);
  // the tail slides off its last cell unless the snake just grew.
  const p = s.alive && o.moving ? o.p : 0
  const nd = s.want !== reverse(s.dir) ? s.want : s.dir
  const hx = head.x + (DX[nd] ?? 0) * CELL * p
  const hy = head.y + (DY[nd] ?? 0) * CELL * p
  const line = [{ x: hx, y: hy }, ...pts.slice(1)]
  const grew = now - s.grewT < len
  const tail = pts[pts.length - 1]
  const pre = pts[pts.length - 2]
  if (p > 0 && !grew && tail && pre && line.length > 1)
    line[line.length - 1] = { x: tail.x + (pre.x - tail.x) * p, y: tail.y + (pre.y - tail.y) * p }
  // A crashed body shudders for a moment.
  const shudder = s.alive ? 0 : Math.max(0, 1 - (now - s.diedT) * 2.5)
  if (shudder > 0)
    for (let i = 0; i < line.length; i++) {
      const q = line[i]
      if (q)
        line[i] = {
          x: q.x + Math.sin(now * 70 + i * 1.7) * 7 * shudder,
          y: q.y + Math.cos(now * 63 + i * 2.3) * 7 * shudder,
        }
    }
  const n = line.length
  const deadK = s.alive ? 0 : clamp((now - s.diedT) * 1.6, 0, 1)
  const colAt = (i: number) => {
    // Grey creeps from head to tail.
    const k = clamp(deadK * 1.6 - (i / Math.max(1, n - 1)) * 0.6, 0, 1)
    return mix(base, DEAD, k)
  }
  const age = now - eatT
  const widthAt = (i: number) => {
    const taper = 0.86 - 0.3 * (i / Math.max(1, n - 1))
    const bump = age >= 0 && age < n * len ? 0.32 * Math.exp(-((age / len - i) ** 2) / 0.9) : 0
    // The winner's body ripples with light.
    const wave = o.won ? 0.08 * Math.max(0, Math.sin(now * 9 - i * 0.6)) : 0
    return CELL * taper * (1 + bump + wave)
  }
  const c = g.ctx
  c.save()
  c.lineJoin = 'round'
  c.lineCap = 'round'
  // Halo, one path so it does not stack at the joints.
  g.alpha(s.alive ? 1 : 1 - deadK * 0.7, () =>
    g.path(
      (q) => {
        q.moveTo(hx, hy)
        for (let i = 1; i < n; i++) q.lineTo(line[i]?.x ?? hx, line[i]?.y ?? hy)
      },
      undefined,
      // The faster the round, the brighter the trail glows.
      alpha(base, 0.22 + 0.14 * clamp(TICK / len - 1, 0, 1) + (o.won ? 0.12 : 0)),
      CELL * 1.25,
    ),
  )
  // Rim, then body, tail first so the head sits on top.
  for (let pass = 0; pass < 2; pass++)
    for (let i = n - 1; i >= 1; i--) {
      const a = line[i - 1]
      const b = line[i]
      if (!a || !b) continue
      const w = widthAt(i)
      const col = colAt(i)
      if (pass === 0) {
        g.line(a.x, a.y, b.x, b.y, shade(col, -0.45), w + 8)
      } else {
        g.line(a.x, a.y, b.x, b.y, col, w)
        g.circle(b.x, b.y, w * 0.18, alpha('#ffffff', 0.35))
      }
    }
  // Gloss along the top-left of the tube.
  g.path(
    (q) => {
      q.moveTo(hx - 6, hy - 7)
      for (let i = 1; i < n; i++) q.lineTo((line[i]?.x ?? hx) - 6, (line[i]?.y ?? hy) - 7)
    },
    undefined,
    alpha('#ffffff', 0.32 * (1 - deadK)),
    CELL * 0.12,
  )
  c.restore()
  // Head: gulps on a meal, squashes into a turn, breathes while waiting.
  const ang = Math.atan2(DY[nd] ?? 0, DX[nd] ?? 0)
  const turn = now - s.turnT
  const squash = s.alive && turn >= 0 && turn < 0.2 ? Math.sin((turn / 0.2) * Math.PI) * 0.18 : 0
  const breathe = s.alive && !o.moving ? Math.sin(now * 3 + s.side * 1.7) * 0.04 : 0
  const hr = CELL * 0.54 * (1 + breathe + (age >= 0 && age < 0.18 ? 0.25 * (1 - age / 0.18) : 0))
  const hcol = colAt(0)
  if (s.alive)
    g.circle(
      hx,
      hy,
      hr * 2,
      g.rad(hx, hy, hr * 0.5, hr * 2, [
        [0, alpha(base, 0.45)],
        [1, alpha(base, 0)],
      ]),
    )
  g.at(
    hx,
    hy,
    ang,
    () => {
      g.circle(0, 3, hr + 3, shade(hcol, -0.45))
      g.ball(0, 0, hr, hcol, 0.9)
    },
    1 - squash * 0.6,
    1 + squash,
  )
  g.at(hx, hy, ang, () => {
    // Tongue flicks out now and then.
    if (s.alive && Math.sin(now * 4 + s.side * 2) > 0.75) {
      g.line(hr * 0.8, 0, hr * 1.5, 0, C.pink, 4)
      g.line(hr * 1.5, 0, hr * 1.8, -6, C.pink, 3)
      g.line(hr * 1.5, 0, hr * 1.8, 6, C.pink, 3)
    }
    for (const sy of [-1, 1]) {
      const ex = hr * 0.25
      const ey = sy * hr * 0.42
      g.circle(ex, ey, hr * 0.3, '#fff')
      if (s.alive) {
        g.circle(ex + hr * 0.1, ey, hr * 0.17, C.ink)
        g.circle(ex + hr * 0.04, ey - hr * 0.06, hr * 0.06, '#fff')
      } else {
        const k = hr * 0.16
        g.line(ex - k, ey - k, ex + k, ey + k, C.ink, 4)
        g.line(ex - k, ey + k, ex + k, ey - k, C.ink, 4)
      }
    }
  })
}

/** Online, each phone draws only its own player's controls. */
const mine = (g: Draw, side: Side): boolean => g.viewer === null || g.viewer === side

function sticks(g: Draw, looks: StickLook[]): void {
  for (const k of looks) {
    if (!k.on || !mine(g, k.side)) continue
    const col = SIDE[k.side]
    g.alpha(0.9, () => {
      g.circle(k.bx, k.by, k.r, alpha(col.dark, 0.35), alpha(col.light, 0.5), 5)
      g.ball(k.kx, k.ky, k.r * 0.45, col.main, 0.6)
    })
  }
}

export function renderNeon(
  g: Draw,
  s: State,
  now: number,
  names: [string, string],
  over: boolean,
  humans: readonly [boolean, boolean],
  frac = 0,
): void {
  const len = s.b.len || TICK
  const speed = clamp((TICK - len) / (TICK - 0.08), 0, 1)
  table(g, now, speed)
  blocks(g)
  dots(g, s.b.dots, now)
  const r0 = s.rounds
  const moving = r0.phase === 'play' && now >= s.b.go
  const p = clamp((s.b.acc + frac / 60) / len, 0, 1)
  // The dead snake first, so the living one passes over it.
  const order = [...s.b.snakes].sort((a, b) => Number(a.alive) - Number(b.alive))
  for (const sn of order)
    snake(g, sn, {
      p,
      len,
      now,
      eatT: s.eatT[sn.side] ?? -9,
      won: r0.phase === 'between' && r0.last === sn.side,
      moving,
    })
  sticks(g, s.ctl)
  const r = s.rounds
  if (r.round === 1 && r.phase === 'play' && now - r.at < 3.4)
    for (const side of [0, 1] as const) {
      if (!humans[side] || s.ctl[side]?.on || !mine(g, side)) continue
      const y = side === 0 ? MID + 640 : MID - 640
      g.alpha(Math.min(1, (3.4 - (now - r.at)) * 2) * 0.95, () =>
        g.sideText(side, 'Swipe to steer', W / 2, y, {
          size: 46,
          weight: 700,
          color: C.white,
          stroke: alpha(C.ink, 0.8),
        }),
      )
    }
  const alive = (side: Side) => s.b.snakes[side].alive
  for (const side of [0, 1] as const) {
    const len = s.b.snakes[side].body.length
    namePill(g, side, names[side], {
      active: alive(side),
      text: alive(side) ? `${names[side]} · ${len}` : 'Crashed',
    })
  }
  drawRounds(g, r, now, { over: true })
  if (over) return
  if (r.phase === 'between' && r.text) {
    banner(g, undefined, r.text, MID, { size: 56, alpha: Math.min(1, (now - r.at) * 4) })
    return
  }
  // The first round starts on the shell's countdown; later ones get their own.
  if (r.phase !== 'play' || r.round === 1) return
  const e = now - r.at
  if (e < 0.8) banner(g, undefined, `Round ${r.round}`, MID, { size: 64 })
  else if (e < COUNT - 0.4) {
    const digit = ['3', '2', '1'][Math.floor((e - 0.8) / 0.4)] ?? '1'
    const pop = 1 + 0.25 * Math.max(0, 1 - ((e - 0.8) % 0.4) / 0.15)
    banner(g, undefined, digit, MID, { size: 150 * pop })
  } else if (e < COUNT) banner(g, undefined, 'GO!', MID, { size: 110, color: C.yellow })
}
