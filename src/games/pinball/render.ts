import type { Side } from '../../core/game.ts'
import { outBack, prog } from '../../core/fx/ease.ts'
import { banner } from '../../core/hud.ts'
import type { Draw } from '../../core/render/draw.ts'
import { C, SIDE, alpha, mix, shade } from '../../core/render/palette.ts'
import { H, MID, W } from '../../core/stage.ts'
import {
  BALL_R,
  BUMP_R,
  BUMPERS,
  FLIP_LEN,
  FLIP_R,
  PAUSE,
  RAILS,
  SLING_N,
  SLINGS,
  flipGeom,
  type Ball,
  type World,
} from './rules.ts'

/** What the frame needs beyond the world: interpolated positions and timing stamps. */
export interface Look {
  ball: Ball
  /** Interpolated flipper angles (red frame), index = side * 2 + lane. */
  angles: number[]
  trail: readonly { x: number; y: number }[]
  /** Game time (s), and the stamps of the last drain, serve and the match end. */
  now: number
  goalAt: number
  serveAt: number
  /** Who scored the last drain (-1 before any). */
  scorer: number
  endAt: number
  /** The match winner once decided (-1 while playing). */
  champ: number
  /** Points needed to win. */
  target: number
  /** Which sides are human (they get the opening how-to). */
  humans: readonly [boolean, boolean]
}

/** The playfield outline, clockwise: blue's drain mouth on top, red's at the bottom. */
const FIELD = [
  262, 178, 738, 178, 930, 330, 930, 780, 882, 830, 882, 970, 930, 1020, 930, 1470, 738, 1622, 262,
  1622, 70, 1470, 70, 1020, 118, 970, 118, 830, 70, 780, 70, 330,
]
/** Drain mouths: the gap between the catch walls, below red's flippers / above blue's. */
const CHUTE_X0 = 262
const CHUTE_X1 = 738
const MOUTH_Y = 1622
/** Scoreboard figure positions, each on its owner's half. */
const SCORE_Y = [1250, 550] as const
const BUMP_COL = C.purple
const STEEL = ['#ffffff', '#dfe6f4', '#8f9abb', '#2b3150'] as const

const other = (s: Side): Side => (s === 0 ? 1 : 0)
/** Mirror a red-frame y into blue's half. */
const sy = (side: Side, y: number): number => (side === 0 ? y : H - y)

export function render(g: Draw, w: World, look: Look): void {
  drawBackdrop(g, look)
  drawBed(g, w, look)
  for (const side of [0, 1] as Side[]) drawChute(g, side, w, look)
  drawScores(g, w, look)
  drawRails(g)
  for (let i = 0; i < SLINGS.length; i++) drawSling(g, i, w.slingLit[i] ?? 0)
  for (let i = 0; i < BUMPERS.length; i++) drawBumper(g, i, w.bumpLit[i] ?? 0)
  for (const f of w.flips)
    drawFlipper(g, f.side, f.lane, look.angles[f.side * 2 + f.lane] ?? f.a, f.up)
  if (w.phase === 'play') drawBall(g, look)
  else if (look.champ < 0) drawServe(g, w)
  drawOverlays(g, w, look)
}

// ---------- the cabinet ----------

function drawBackdrop(g: Draw, look: Look): void {
  g.fillView(
    g.lin(0, 0, 0, H, [
      [0, shade(C.blue, -0.84)],
      [0.5, C.ink],
      [1, shade(C.red, -0.84)],
    ]),
  )
  // The cabinet rim: a chunky dark lip around the playfield.
  g.poly(FIELD, undefined, shade(C.ink3, -0.2), 70)
  g.poly(FIELD, undefined, C.ink4, 40)
  g.poly(FIELD, undefined, alpha('#ffffff', 0.08), 4)
  if (look.champ >= 0) {
    // The winner's whole end of the cabinet lights up.
    const k = prog(look.now - look.endAt, 0, 0.6)
    const side = look.champ as Side
    const y0 = side === 0 ? H : 0
    g.alpha(k * (0.45 + 0.15 * Math.sin(g.t * 5)), () =>
      g.fillView(
        g.lin(0, y0, 0, MID, [
          [0, alpha(SIDE[side].main, 0.9)],
          [1, alpha(SIDE[side].main, 0)],
        ]),
      ),
    )
  }
}

/** Run `fn` clipped to a polygon. */
function clipPoly(g: Draw, pts: readonly number[], fn: () => void): void {
  const c = g.ctx
  c.save()
  c.beginPath()
  c.moveTo(pts[0] ?? 0, pts[1] ?? 0)
  for (let i = 2; i < pts.length; i += 2) c.lineTo(pts[i] ?? 0, pts[i + 1] ?? 0)
  c.closePath()
  c.clip()
  fn()
  c.restore()
}

function drawBed(g: Draw, w: World, look: Look): void {
  clipPoly(g, FIELD, () => {
    g.rect(
      60,
      170,
      880,
      1460,
      g.lin(0, 178, 0, 1622, [
        [0, shade(C.blue, -0.55)],
        [0.3, '#211a4a'],
        [0.5, '#1b1640'],
        [0.7, '#2a1838'],
        [1, shade(C.red, -0.55)],
      ]),
    )
    // Floodlight pool over the centre, and a soft lit band down the middle lane.
    g.fillView(
      g.rad(W / 2, MID, 40, 520, [
        [0, alpha('#ffffff', 0.12)],
        [1, alpha('#ffffff', 0)],
      ]),
    )
    // Dot lattice: the printed playfield texture.
    const c = g.ctx
    c.fillStyle = alpha('#ffffff', 0.08)
    c.beginPath()
    for (let y = 250; y < 1580; y += 64) {
      for (let x = 112 + ((y / 64) % 2) * 32; x < 900; x += 64) {
        c.moveTo(x + 3, y)
        c.arc(x, y, 3, 0, Math.PI * 2)
      }
    }
    c.fill()
    // Diagonal stripes in each team's end, like painted lane art.
    for (const side of [0, 1] as Side[]) {
      for (let i = 0; i < 6; i++) {
        const y = sy(side, 1430 - i * 46)
        g.alpha(0.06 - i * 0.008, () => g.line(70, y, 930, y, SIDE[side].main, 18, 'butt'))
      }
    }
    drawInserts(g, w, look)
  })
  // Centre ring around the middle bumper, and the midline.
  g.ring(W / 2, MID, 150, alpha('#ffffff', 0.1), 6)
  g.dashed(130, MID, 870, MID, alpha('#ffffff', 0.08), 4, [22, 18])
}

/** Arrow lights down the middle lane: they chase toward the end the ball is heading to. */
function drawInserts(g: Draw, w: World, look: Look): void {
  const heading: Side | -1 =
    w.phase !== 'play' ? -1 : look.ball.vy > 20 ? 0 : look.ball.vy < -20 ? 1 : -1
  for (const side of [0, 1] as Side[]) {
    const col = SIDE[side]
    for (let i = 0; i < 3; i++) {
      const y = sy(side, 1440 + i * 52)
      const dir = side === 0 ? 1 : -1
      const lit = heading === side && Math.floor(g.t * 9) % 3 === i
      const a = lit ? 1 : heading === side ? 0.4 : 0.18
      g.alpha(a, () => {
        if (lit) g.circle(W / 2, y + dir * 6, 46, alpha(col.main, 0.35))
        g.poly(
          [W / 2 - 36, y - dir * 14, W / 2, y + dir * 18, W / 2 + 36, y - dir * 14],
          undefined,
          lit ? col.light : col.main,
          12,
        )
      })
    }
  }
}

/** Each drain belongs to the player who defends it: a dark pit lit in their colour. */
function drawChute(g: Draw, side: Side, w: World, look: Look): void {
  const col = SIDE[side]
  const mouth = sy(side, MOUTH_Y)
  const far = side === 0 ? g.stage.view.y + g.stage.view.h + 4 : g.stage.view.y - 4
  const y0 = Math.min(mouth, far)
  const h = Math.abs(far - mouth)
  g.rect(
    CHUTE_X0,
    y0,
    CHUTE_X1 - CHUTE_X0,
    h,
    g.lin(0, mouth, 0, far, [
      [0, shade(col.main, -0.45)],
      [0.5, shade(col.main, -0.75)],
      [1, '#05040a'],
    ]),
  )
  // Danger: the rival is one drain from winning, so this mouth pulses.
  const danger = look.champ < 0 && w.score[other(side)] === look.target - 1
  const pulse = danger ? 0.5 + 0.5 * Math.sin(g.t * 7) : 0
  // Flash when the ball has just gone down this drain.
  const drained = look.scorer === other(side)
  const k = drained ? Math.max(0, 1 - (look.now - look.goalAt) / 0.9) : 0
  g.alpha(0.3 + pulse * 0.35 + k * 0.6, () =>
    g.rect(
      CHUTE_X0,
      y0,
      CHUTE_X1 - CHUTE_X0,
      h,
      g.lin(0, mouth, 0, far, [
        [0, mix(col.main, '#ffffff', k * 0.6)],
        [1, alpha(col.main, 0)],
      ]),
    ),
  )
  g.line(CHUTE_X0, mouth, CHUTE_X1, mouth, alpha(col.light, 0.35 + pulse * 0.5 + k * 0.5), 6)
}

function drawScores(g: Draw, w: World, look: Look): void {
  for (const side of [0, 1] as Side[]) {
    const pop = look.scorer === side ? Math.max(0, 1 - (look.now - look.goalAt) / 0.7) : 0
    const won = look.champ === side ? prog(look.now - look.endAt, 0, 0.5) : 0
    const size = 170 * (1 + outBack(pop) * 0.25 * pop + won * 0.15)
    const col = SIDE[side]
    g.forSide(side, W / 2, SCORE_Y[side], () => {
      if (pop > 0 || won > 0)
        g.circle(
          0,
          0,
          150 + pop * 40,
          g.rad(0, 0, 10, 150 + pop * 40, [
            [0, alpha(col.main, 0.35 * Math.max(pop, won))],
            [1, alpha(col.main, 0)],
          ]),
        )
      g.text(w.score[side], 0, 0, {
        size,
        weight: 700,
        color: alpha(mix(col.main, '#ffffff', pop * 0.5), 0.5 + Math.max(pop, won) * 0.5),
      })
      // First-to pips under the figure, toward the owner.
      const n = look.target
      const gap = Math.min(46, 300 / Math.max(1, n - 1))
      const r = Math.min(14, gap * 0.36)
      const x0 = -((n - 1) * gap) / 2
      for (let i = 0; i < n; i++) {
        const on = i < w.score[side]
        const x = x0 + i * gap
        if (on) {
          g.circle(x, 112, r + 2, shade(col.main, -0.45))
          g.circle(x, 110, r, col.main)
          g.circle(x - r * 0.3, 110 - r * 0.3, r * 0.35, alpha(C.white, 0.7))
        } else g.circle(x, 110, r, alpha(C.white, 0.12))
      }
    })
  }
}

function drawRails(g: Draw): void {
  for (const [ax, ay, bx, by] of RAILS) {
    const lo = Math.min(ay, by)
    const hi = Math.max(ay, by)
    // Side walls (and their pinches) in cyan neon; the rest takes the colour of its half.
    const wall = lo >= 330 && hi <= 1470
    const chute = lo >= 1622 || hi <= 178
    const col = wall ? C.cyan : (ay + by) / 2 > MID ? SIDE[0].main : SIDE[1].main
    if (chute) {
      g.line(ax, ay, bx, by, shade(col, -0.6), 30)
      g.line(ax, ay, bx, by, shade(col, -0.2), 10)
      continue
    }
    g.line(ax, ay, bx, by, shade(C.ink, 0.15), 36)
    g.line(ax, ay, bx, by, alpha(col, 0.3), 28)
    g.line(ax, ay, bx, by, col, 11)
    g.line(ax, ay, bx, by, alpha('#ffffff', 0.6), 3)
  }
  // Chrome posts where rails meet.
  const posts: [number, number][] = [
    [70, 330],
    [70, 1470],
    [70, 780],
    [70, 1020],
  ]
  for (const [x, y] of posts) {
    for (const [px, py] of [
      [x, y],
      [W - x, H - y],
    ] as [number, number][]) {
      g.circle(px, py + 4, 15, '#14121e')
      g.ball(px, py, 13, '#c9d0e4', 0.8)
    }
  }
}

/** A slingshot: a raised plastic wedge whose rubber face kicks toward the table. */
function drawSling(g: Draw, i: number, lit: number): void {
  const seg = SLINGS[i]
  const n = SLING_N[i]
  if (!seg || !n) return
  const [ax, ay, bx, by] = seg
  const [nx, ny] = n
  const col = SIDE[(i >> 1) as Side].main
  // The wedge's back point sits behind the face, toward the rail it guards.
  const mx = (ax + bx) / 2 - nx * 64
  const my = (ay + by) / 2 - ny * 64
  const ox = -nx * 12
  const oy = 12
  g.poly([ax, ay + oy, mx, my + oy, bx, by + oy], alpha('#000000', 0.35))
  g.poly([ax, ay, mx, my, bx, by], shade(col, -0.62), shade(col, -0.3), 6)
  g.poly(
    [
      ax + (mx - ax) * 0.25,
      ay + (my - ay) * 0.25,
      mx,
      my,
      bx + (mx - bx) * 0.25,
      by + (my - by) * 0.25,
    ],
    alpha(col, 0.22 + lit * 0.5),
  )
  // The rubber band bulges out when it fires.
  const bulge = lit * 16
  const cx = (ax + bx) / 2 + nx * bulge
  const cyy = (ay + by) / 2 + ny * bulge
  const band = (stroke: string, lw: number, dx = 0, dy = 0) =>
    g.path(
      (c) => {
        c.moveTo(ax + dx, ay + dy)
        c.quadraticCurveTo(cx + dx, cyy + dy, bx + dx, by + dy)
      },
      undefined,
      stroke,
      lw,
    )
  if (lit > 0) g.alpha(lit * 0.7, () => band(C.white, 40))
  band(shade(col, -0.55), 30, ox * 0.2, 6)
  band(mix(col, '#ffffff', lit * 0.75), 22)
  band(alpha('#ffffff', 0.55), 5, -nx * 5, -ny * 5)
  // Chrome posts at both ends of the band.
  for (const [px, py] of [
    [ax, ay],
    [bx, by],
  ] as [number, number][]) {
    g.circle(px, py + 4, 16, '#14121e')
    g.ball(px, py, 14, '#d4dbee', 0.9)
  }
}

/** A pop bumper: dark skirt with a neon ring, glossy mushroom cap that flares yellow when hit. */
function drawBumper(g: Draw, i: number, lit: number): void {
  const p = BUMPERS[i]
  if (!p) return
  const [x, y] = p
  const s = 1 + lit * lit * 0.16
  g.shadow(x + 8, y + 22, BUMP_R * 1.25, BUMP_R * 0.7, 0.5)
  // Halo.
  const halo = mix(BUMP_COL, C.yellow, lit)
  g.alpha(0.35 + lit * 0.65, () =>
    g.circle(
      x,
      y,
      BUMP_R * (2 + lit * 0.8),
      g.rad(x, y, BUMP_R * 0.8, BUMP_R * (2 + lit * 0.8), [
        [0, alpha(halo, 0.75)],
        [1, alpha(halo, 0)],
      ]),
    ),
  )
  g.at(
    x,
    y,
    0,
    () => {
      // Skirt: a dark base with a neon ring around the cap.
      g.circle(0, 14, BUMP_R + 18, '#0e0b18')
      g.circle(0, 0, BUMP_R + 18, shade(BUMP_COL, -0.55))
      g.ring(0, 0, BUMP_R + 12, mix(BUMP_COL, '#ffffff', 0.25 + lit * 0.7), 6)
      // The cap.
      const cap = mix(mix(BUMP_COL, C.pink, 0.35), C.yellow, lit)
      g.circle(0, 10, BUMP_R, shade(cap, -0.45))
      g.circle(
        0,
        0,
        BUMP_R,
        g.rad(
          0,
          0,
          BUMP_R * 0.05,
          BUMP_R,
          [
            [0, mix(cap, '#ffffff', 0.55 + lit * 0.4)],
            [0.6, cap],
            [1, shade(cap, -0.3)],
          ],
          -BUMP_R * 0.3,
          -BUMP_R * 0.4,
        ),
      )
      g.star(0, 0, BUMP_R * 0.42, alpha('#ffffff', 0.85 + lit * 0.15), 5, 0.48, -Math.PI / 2 + i)
      g.alpha(0.55, () =>
        g.ellipse(-BUMP_R * 0.38, -BUMP_R * 0.52, BUMP_R * 0.34, BUMP_R * 0.16, '#fff', -0.6),
      )
    },
    s,
    s,
  )
}

/** A flipper: a tapered bat in its owner's colour with a rubber rim and a chrome pivot. */
function drawFlipper(g: Draw, side: Side, lane: 0 | 1, a: number, up: boolean): void {
  const { px, py, ang } = flipGeom({ side, lane, a, w: 0, up })
  const col = SIDE[side]
  const r0 = FLIP_R + 6
  const r1 = FLIP_R - 6
  const L = FLIP_LEN
  const bat = (r0x: number, r1x: number) => (c: CanvasRenderingContext2D) => {
    c.arc(0, 0, r0x, Math.PI / 2, (Math.PI * 3) / 2)
    c.lineTo(L, -r1x)
    c.arc(L, 0, r1x, -Math.PI / 2, Math.PI / 2)
    c.closePath()
  }
  // Contact shadow, cast down-right on the bed.
  g.at(px + 8, py + 18, ang, () => g.path(bat(r0, r1), alpha('#000000', 0.35)))
  if (up)
    g.at(px, py, ang, () =>
      g.alpha(0.5, () => g.path(bat(r0 + 14, r1 + 14), alpha(col.light, 0.5))),
    )
  g.at(px, py, ang, () => {
    // Rubber rim, then the glossy body.
    g.path(bat(r0, r1), shade(col.main, -0.5))
    g.path(
      bat(r0 - 7, r1 - 7),
      g.lin(0, -r0, 0, r0, [
        [0, up ? col.light : mix(col.main, '#ffffff', 0.25)],
        [0.5, col.main],
        [1, shade(col.main, -0.3)],
      ]),
    )
    // Gloss streak along the top edge.
    g.line(r0 * 0.2, -r0 * 0.45, L - r1, -r1 * 0.45, alpha('#ffffff', up ? 0.7 : 0.45), 6)
  })
  g.circle(px, py + 4, FLIP_R * 0.62, shade(col.main, -0.6))
  g.ball(px, py, FLIP_R * 0.58, '#e6ecf6', 0.9)
  g.sideMark(side, px, py, 7, shade(col.main, -0.3))
}

// ---------- the ball ----------

function steelBall(g: Draw, x: number, y: number, r: number): void {
  g.shadow(x + 7, y + 16, r * 1.05, r * 0.65, 0.45)
  g.circle(
    x,
    y,
    r,
    g.rad(
      x,
      y,
      r * 0.08,
      r,
      [
        [0, STEEL[0]],
        [0.3, STEEL[1]],
        [0.72, STEEL[2]],
        [1, STEEL[3]],
      ],
      x - r * 0.35,
      y - r * 0.4,
    ),
  )
  // Reflection of the table in the lower half, and a sharp specular.
  const tint = y > MID ? SIDE[0].main : SIDE[1].main
  g.ellipse(x, y + r * 0.5, r * 0.72, r * 0.32, alpha(tint, 0.3))
  g.alpha(0.95, () => g.ellipse(x - r * 0.34, y - r * 0.42, r * 0.34, r * 0.18, '#ffffff', -0.6))
  g.alpha(0.35, () => g.circle(x + r * 0.32, y + r * 0.46, r * 0.16, '#ffffff'))
}

function drawBall(g: Draw, look: Look): void {
  const b = look.ball
  for (let i = 0; i < look.trail.length; i++) {
    const t = look.trail[i]
    if (!t) continue
    const f = (i + 1) / (look.trail.length + 1)
    g.alpha(f * 0.28, () => g.circle(t.x, t.y, BALL_R * (0.35 + 0.65 * f), C.cream))
  }
  const since = look.now - look.serveAt
  if (since < 0.45)
    g.alpha(1 - since / 0.45, () => g.ring(b.x, b.y, BALL_R * (1.4 + since * 5), C.yellow, 8))
  steelBall(g, b.x, b.y, BALL_R)
}

/** Between points the ball materialises at the serve spot, with arrows toward the receiver. */
function drawServe(g: Draw, w: World): void {
  const dir = w.server === 0 ? 1 : -1
  const x = W / 2
  const y = MID + dir * 120
  const k = prog(PAUSE - w.pause, 0.15, PAUSE * 0.8)
  if (k <= 0) return
  const pulse = 0.5 + 0.5 * Math.sin(g.t * 10)
  g.alpha(k * (0.5 + 0.4 * pulse), () => g.ring(x, y, BALL_R + 14 + pulse * 8, C.yellow, 7))
  for (let i = 0; i < 3; i++) {
    const lit = Math.floor(g.t * 8) % 3 === i
    const yy = y + dir * (78 + i * 42)
    g.alpha(k * (lit ? 1 : 0.35), () =>
      g.poly(
        [x - 26, yy - dir * 10, x, yy + dir * 14, x + 26, yy - dir * 10],
        undefined,
        C.yellow,
        10,
      ),
    )
  }
  const s = outBack(k)
  g.alpha(Math.min(1, k * 1.5), () => steelBall(g, x, y, BALL_R * s))
}

// ---------- words ----------

function drawOverlays(g: Draw, w: World, look: Look): void {
  // How to play: shown to humans for the first seconds of the match.
  const intro = 1 - prog(look.now, 3.2, 4)
  if (intro > 0 && w.score[0] + w.score[1] === 0) {
    for (const side of [0, 1] as Side[]) {
      if (!look.humans[side]) continue
      g.alpha(intro, () => {
        const y = sy(side, 1500)
        banner(g, side, 'Tap left / right to flip', y, { size: 36 })
        const bob = Math.sin(g.t * 6) * 10
        for (const lx of [175, 825]) {
          const x = side === 0 ? lx : W - lx
          g.forSide(side, x, y, () => g.emoji('👆', 0, bob, 64))
        }
      })
    }
  }
  if (look.champ >= 0) {
    const side = look.champ as Side
    const k = prog(look.now - look.endAt, 0.15, 0.6)
    if (k > 0) {
      // The loser's end dims so the winner's glow owns the table.
      const v = g.stage.view
      const top = side === 0 ? v.y : MID
      const bottom = side === 0 ? MID : v.y + v.h
      g.alpha(k * 0.4, () => g.rect(v.x, top, v.w, bottom - top, '#000000'))
      const y = sy(side, 1480)
      const s = outBack(k)
      g.at(
        W / 2,
        y,
        0,
        () =>
          g.at(-W / 2, -y, 0, () => banner(g, side, 'Winner!', y, { size: 76, color: C.yellow })),
        s,
        s,
      )
    }
    return
  }
  // Match point: called out on the serve to the side one drain from the win.
  if (w.phase === 'goal' && look.now > 1.5) {
    const k = prog(PAUSE - w.pause, 0, 0.25)
    for (const side of [0, 1] as Side[]) {
      if (w.score[side] !== look.target - 1) continue
      g.alpha(k, () =>
        banner(g, side, 'Match point', sy(side, 1460), { size: 48, color: C.yellow }),
      )
    }
  }
}
