import { hudY, namePill } from '../../core/hud.ts'
import type { Side } from '../../core/game.ts'
import type { Draw } from '../../core/render/draw.ts'
import { alpha, C, SIDE, shade } from '../../core/render/palette.ts'
import { clamp, outBack } from '../../core/fx/ease.ts'
import type { ControlLook } from '../../engines/arena/index.ts'
import type { Rounds } from '../../engines/reflex/index.ts'
import { MID, W } from '../../core/stage.ts'
import type { State } from './index.ts'
import { DASH_T, distC, FLOE, floeR, type Penguin, PR, type World } from './rules.ts'

const SEA = '#0f3d5e'
const BEAK = '#ff9f1c'
const FEATHER = '#1d2442'
/** Penguins are drawn a little larger than their collision disc (they are round toys). */
const S = 1.3

/** Cracks in the ice, as fractions of the floe's radius. */
const CRACKS: [number, number][][] = [
  [
    [0.12, -0.2],
    [0.3, -0.05],
    [0.42, -0.22],
  ],
  [
    [-0.35, 0.1],
    [-0.2, 0.3],
    [-0.28, 0.5],
  ],
  [
    [0.1, 0.45],
    [0.22, 0.28],
    [0.5, 0.2],
  ],
  [
    [-0.55, -0.3],
    [-0.4, -0.45],
  ],
]

/** Icebergs drifting outside the floe (fixed; they are scenery). */
const BERGS: [number, number, number][] = [
  [110, 420, 70],
  [890, 1400, 84],
  [96, 1290, 58],
  [900, 470, 62],
]

function sea(g: Draw, t: number): void {
  g.fillView(SEA)
  const v = g.stage.view
  // Each end of the sea is a team's: blue water at the top, red-lit water at the bottom.
  g.fillView(
    g.lin(0, v.y, 0, v.y + v.h, [
      [0, alpha(C.blue, 0.38)],
      [0.3, alpha(C.blue, 0)],
      [0.7, alpha(C.red, 0)],
      [1, alpha(C.red, 0.34)],
    ]),
  )
  for (let y = -200; y < 2000; y += 180) g.rect(v.x - 2, y, v.w + 4, 90, alpha('#1b5a84', 0.22))
  // Waves: short strokes that drift and bob.
  for (let i = 0; i < 30; i++) {
    const x = ((i * 137) % 1000) + Math.sin(t * 0.6 + i) * 16
    const y = ((i * 311) % 1800) + Math.sin(t * 1.1 + i * 2) * 5
    g.line(x - 26, y, x + 26, y, alpha('#8fd6f2', 0.14), 5)
  }
}

function bergs(g: Draw, t: number): void {
  for (const [x0, y0, s] of BERGS) {
    const x = x0 + Math.sin(t * 0.4 + y0) * 6
    const y = y0 + Math.cos(t * 0.5 + x0) * 4
    g.ellipse(x + 8, y + s * 0.5, s * 1.1, s * 0.4, alpha('#06263c', 0.6))
    const pts = [
      x - s,
      y + s * 0.2,
      x - s * 0.3,
      y - s * 0.9,
      x + s * 0.5,
      y - s * 0.7,
      x + s,
      y + s * 0.3,
      x + s * 0.4,
      y + s * 0.9,
      x - s * 0.7,
      y + s * 0.7,
    ]
    g.poly(
      pts.map((v, i) => (i % 2 ? v + 10 : v)),
      '#6fb3d6',
    )
    g.poly(
      pts,
      g.lin(x - s, y - s, x + s, y + s, [
        [0, '#ffffff'],
        [0.6, '#d7efff'],
        [1, '#9ad2ee'],
      ]),
      alpha('#4aa3cf', 0.8),
      4,
    )
  }
}

function floe(g: Draw, t: number): void {
  const R = floeR(t)
  const { cx, cy } = FLOE
  if (R <= 0) return
  // Meltwater foam, rippling round the edge.
  const foam = 0.5 + 0.5 * Math.sin(t * 3)
  g.circle(cx, cy + 14, R + 26 + foam * 6, alpha('#bdeaff', 0.22))
  g.circle(cx, cy + 14, R + 14, alpha('#7fd0f2', 0.5))
  // The slab's thickness: a darker blue wall under the top face.
  g.circle(cx, cy + 22, R, '#4f9cc4')
  g.circle(cx, cy + 12, R, '#7ec3e2')
  g.circle(
    cx,
    cy,
    R,
    g.rad(
      cx,
      cy,
      R * 0.08,
      R,
      [
        [0, '#ffffff'],
        [0.65, '#e3f6ff'],
        [1, '#a6dbf1'],
      ],
      cx - R * 0.3,
      cy - R * 0.35,
    ),
  )
  // Team halves of the ice, faint.
  g.circle(
    cx,
    cy,
    R,
    g.lin(0, cy - R, 0, cy + R, [
      [0, alpha(C.blue, 0.12)],
      [0.45, alpha(C.blue, 0)],
      [0.55, alpha(C.red, 0)],
      [1, alpha(C.red, 0.12)],
    ]),
  )
  g.ring(cx, cy, R - 3, alpha('#ffffff', 0.85), 5)
  for (const pts of CRACKS) {
    g.path(
      (c) => {
        const [x0, y0] = pts[0] ?? [0, 0]
        c.moveTo(cx + x0 * R, cy + y0 * R)
        for (const [x, y] of pts.slice(1)) c.lineTo(cx + x * R, cy + y * R)
      },
      undefined,
      alpha('#5aa6cc', 0.5),
      4,
    )
  }
  // Snow drifts with a soft shadow.
  for (let i = 0; i < 7; i++) {
    const a = i * 2.1 + 0.4
    const x = cx + Math.cos(a) * R * 0.62
    const y = cy + Math.sin(a) * R * 0.5
    g.ellipse(x + 3, y + 5, R * 0.06, R * 0.035, alpha('#7ec3e2', 0.4))
    g.ellipse(x, y, R * 0.06, R * 0.04, '#ffffff')
  }
}

function penguin(g: Draw, p: Penguin, side: Side, t: number, won: boolean): void {
  const col = SIDE[side]
  const k = p.fell >= 0 ? Math.min(1, (t - p.fell) / 0.7) : 0
  const sp = Math.hypot(p.vx, p.vy)
  // Fast penguins belly-slide (long and low); slow ones waddle.
  const slide = clamp((sp - 250) / 300, 0, 1)
  const waddle = Math.sin(p.walk * 0.13) * 0.14 * (1 - slide)
  const knocked = p.fell < 0 && t - p.bumpT < 0.35
  const kb = knocked ? Math.sin(((t - p.bumpT) / 0.35) * Math.PI) : 0
  // Teetering at the edge: flippers flap.
  const edge = p.fell < 0 && distC(p) > floeR(t) - PR * 1.6
  const flap = edge ? Math.sin(t * 30) * 0.5 : 0
  const hop = won ? Math.abs(Math.sin(t * 7)) * 18 : 0
  const s = 1 - 0.45 * k
  const sx = (1 + 0.25 * slide + 0.2 * kb) * S
  const sy = (1 - 0.12 * slide - 0.15 * kb) * S
  g.alpha(1 - k * 0.9, () => {
    if (k === 0) g.shadow(p.x + 6, p.y + 14, 34 * S, 24 * S, 0.35)
    g.at(
      p.x,
      p.y + k * 30 - hop,
      p.a + waddle,
      () => {
        // Feet and flippers.
        g.ellipse(-8, -19, 9, 5, BEAK, 0.2)
        g.ellipse(-8, 19, 9, 5, BEAK, -0.2)
        g.ellipse(-6, -29, 13, 7, FEATHER, -0.35 - flap - slide * 0.6)
        g.ellipse(-6, 29, 13, 7, FEATHER, 0.35 + flap + slide * 0.6)
        // Back and belly.
        g.ellipse(-4, 3, 31 * s, 26 * s, shade(FEATHER, -0.4))
        g.ellipse(
          -4,
          0,
          31 * s,
          26 * s,
          g.lin(-30, -26, 20, 26, [
            [0, shade(FEATHER, 0.25)],
            [1, FEATHER],
          ]),
        )
        g.ellipse(12, 0, 19 * s, 17 * s, '#f7fbff')
        g.ellipse(-14, -10, 10, 5, alpha('#ffffff', 0.25), -0.3)
        // Head, beak and eyes (wide open when knocked or teetering).
        g.circle(26, 0, 14 * s, FEATHER)
        g.poly([36, -6, 52, 0, 36, 6], BEAK, shade(BEAK, -0.4), 2)
        const er = knocked || edge ? 5.5 : 4
        g.circle(31, -6, er, '#ffffff')
        g.circle(31, 6, er, '#ffffff')
        g.circle(32.5, -6, knocked ? 1.4 : 2, C.ink)
        g.circle(32.5, 6, knocked ? 1.4 : 2, C.ink)
        // Scarf in the player's colour, and the side mark on the back.
        g.rrect(16, -18, 9, 36, 4, col.main)
        g.rrect(4, 10, 16, 7, 3, col.main)
        g.sideMark(side, -10, 0, 8, alpha(C.white, 0.9))
      },
      sx,
      sy,
    )
  })
  if (k > 0 && k < 1) {
    // Splash ripples where it went in.
    for (const r of [1, 1.6]) g.ring(p.x, p.y, 30 + k * 90 * r, alpha('#ffffff', (1 - k) * 0.7), 5)
  }
  if (k >= 1) {
    // A little bubble trail where it sank.
    for (let i = 0; i < 3; i++) {
      const b = (t * 0.8 + i / 3) % 1
      g.alpha(1 - b, () =>
        g.ring(p.x + Math.sin(i * 2 + t) * 10, p.y - b * 40, 4 + i * 2, '#e0f6ff', 3),
      )
    }
  }
}

function trail(g: Draw, p: Penguin, t: number): void {
  if (p.fell >= 0) return
  const sp = Math.hypot(p.vx, p.vy)
  const back = sp || 1
  const ux = -p.vx / back
  const uy = -p.vy / back
  // Skid marks on the ice when sliding fast.
  if (sp > 260)
    for (const off of [-14, 14])
      g.line(
        p.x - uy * off,
        p.y + ux * off,
        p.x - uy * off + ux * 70,
        p.y + ux * off + uy * 70,
        alpha('#8fcbe8', 0.5),
        5,
      )
  if (t >= p.dash + DASH_T * 2) return
  for (let i = 1; i <= 4; i++)
    g.circle(
      p.x + ux * i * 24,
      p.y + uy * i * 24,
      PR * S * (0.9 - i * 0.14),
      alpha('#ffffff', 0.4 - i * 0.08),
    )
}

function stick(g: Draw, c: ControlLook): void {
  const col = SIDE[c.side]
  g.alpha(c.on ? 0.95 : 0.6, () => {
    g.circle(c.bx, c.by, c.r, alpha(col.dark, 0.5), alpha(col.light, 0.55), 5)
    g.ball(c.kx, c.ky, c.r * 0.46, col.main, 0.6)
  })
}

function dashPad(g: Draw, c: ControlLook): void {
  const col = SIDE[c.side]
  const ready = c.ready >= 1
  const face = ready ? col.main : shade(col.main, -0.35)
  const depth = c.fr * 0.16
  const p = c.pressed ? depth : 0
  g.circle(c.fx, c.fy + depth, c.fr, shade(face, -0.45))
  g.circle(
    c.fx,
    c.fy + p,
    c.fr,
    g.rad(
      c.fx,
      c.fy,
      c.fr * 0.1,
      c.fr,
      [
        [0, shade(face, 0.3)],
        [1, face],
      ],
      c.fx - c.fr * 0.3,
      c.fy - c.fr * 0.4,
    ),
  )
  if (!ready)
    g.arc(
      c.fx,
      c.fy + p,
      c.fr + 10,
      -Math.PI / 2,
      -Math.PI / 2 + Math.PI * 2 * c.ready,
      alpha(C.white, 0.7),
      7,
    )
  g.alpha(ready ? 1 : 0.55, () =>
    g.forSide(c.side, c.fx, c.fy + p, () => g.emoji('💨', 0, 0, c.fr * 1.1)),
  )
}

/** Round wins as pips above the name pill (between the stick and the dash pad). */
function wins(g: Draw, side: Side, r: Rounds): void {
  const gap = 46
  g.forSide(side, W / 2, hudY(g, side, 150), () => {
    const x0 = -((r.target - 1) * gap) / 2
    for (let i = 0; i < r.target; i++) {
      const on = i < r.wins[side]
      g.circle(x0 + i * gap, 0, 18, alpha(C.ink, 0.6))
      g.circle(x0 + i * gap, 0, 15, on ? SIDE[side].main : alpha(C.white, 0.14))
      if (on) g.circle(x0 + i * gap - 4, -4, 5, alpha(C.white, 0.6))
    }
  })
}

/** A big word that pops in for both players (two copies in local 2P), stamped by state time. */
function stamp(g: Draw, title: string, sub: string, age: number, color: string, y = MID): void {
  if (age < 0) return
  const k = outBack(clamp(age / 0.34, 0, 1))
  const one = (angle: number, cy: number) =>
    g.at(W / 2, cy, angle, () =>
      g.at(
        0,
        0,
        -0.05 * (1 - k),
        () => {
          const tw = Math.max(g.measure(title, 92, 700), g.measure(sub, 38, 600)) + 110
          const h = sub ? 190 : 150
          g.rrect(-tw / 2, -h / 2 + 8, tw, h, 44, alpha('#000000', 0.4))
          g.rrect(-tw / 2, -h / 2, tw, h, 44, alpha(C.ink, 0.92))
          g.rrect(-tw / 2, -h / 2, tw, h, 44, undefined, alpha(color, 0.9), 6)
          g.text(title, 0, sub ? -22 : 4, {
            size: 92,
            weight: 700,
            color,
            drop: alpha('#000000', 0.45),
            maxWidth: 820,
          })
          if (sub)
            g.text(sub, 0, 52, {
              size: 38,
              weight: 600,
              color: alpha(C.white, 0.85),
              maxWidth: 820,
            })
        },
        k,
      ),
    )
  g.alpha(clamp(age * 6, 0, 1), () => {
    if (g.flipTop) {
      one(0, y + 150)
      one(Math.PI, y - 150)
    } else one(g.orient(), y)
  })
}

export function renderIce(
  g: Draw,
  s: State,
  now: number,
  names: [string, string],
  over: boolean,
): void {
  const w: World = s.w
  const r = s.rounds
  sea(g, w.t)
  bergs(g, w.t)
  floe(g, w.t)
  for (const side of [0, 1] as Side[]) trail(g, w.p[side], w.t)
  const won = (side: Side) => (r.phase === 'between' || over) && r.last === side
  // The penguin in the water is drawn first, under the one still standing.
  const order = ([0, 1] as Side[]).sort(
    (a, b) => (w.p[b].fell >= 0 ? 1 : 0) - (w.p[a].fell >= 0 ? 1 : 0),
  )
  for (const side of order) penguin(g, w.p[side], side, w.t, won(side))
  for (const c of s.ctl) stick(g, c)
  for (const c of s.ctl) dashPad(g, c)
  for (const side of [0, 1] as Side[]) {
    namePill(g, side, names[side], { active: won(side) })
    wins(g, side, r)
  }
  if (r.phase === 'play') {
    if (now - r.at < 1.3 && w.t < 1.3) {
      const a = 1 - clamp((now - r.at - 0.95) / 0.35, 0, 1)
      g.alpha(a, () =>
        stamp(g, r.round > 1 ? `Round ${r.round}` : 'Slide!', '', now - r.at, C.white),
      )
    }
    return
  }
  const last = r.last
  const col = last === 0 || last === 1 ? SIDE[last].light : C.white
  const sub =
    last === 'draw' || last === null
      ? 'Both in the sea: draw'
      : over
        ? `${names[last]} wins the match`
        : `${names[last]} stays dry`
  stamp(g, 'Splash!', sub, now - r.at - 0.3, col)
}
