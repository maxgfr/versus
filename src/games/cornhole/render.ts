import { clamp, outBack } from '../../core/fx/ease.ts'
import type { Side } from '../../core/game.ts'
import { banner } from '../../core/hud.ts'
import type { Draw } from '../../core/render/draw.ts'
import { alpha, C, SIDE, shade } from '../../core/render/palette.ts'
import { H, W } from '../../core/stage.ts'
import { drawTrajectory } from '../../engines/aim/index.ts'
import {
  BAG_R,
  BAGS_EACH,
  BOARD,
  type Bag,
  bagPoints,
  HOLE,
  type State,
  THROW,
  TO_WIN,
} from './rules.ts'

const PLANK = '#d9a066'
const LAWN = '#1f5a3a'

/** A backyard at night: dark lawn, a floodlight pool on the board, each end washed in its team colour. */
export function drawTable(g: Draw): void {
  g.fillView(shade(LAWN, -0.55))
  const v = g.stage.view
  // Mowing stripes across the lawn.
  for (let y = Math.floor(v.y / 150) * 150; y < v.y + v.h; y += 150) {
    if ((y / 150) % 2 === 0) g.rect(v.x - 2, y, v.w + 4, 150, alpha(shade(LAWN, -0.3), 0.6))
  }
  g.fillView(
    g.lin(0, 0, 0, H, [
      [0, alpha(SIDE[1].dark, 0.55)],
      [0.3, alpha(SIDE[1].dark, 0)],
      [0.7, alpha(SIDE[0].dark, 0)],
      [1, alpha(SIDE[0].dark, 0.55)],
    ]),
  )
  // Floodlight on the board.
  g.fillView(
    g.rad(W / 2, H / 2, 80, 760, [
      [0, alpha('#fff3d6', 0.16)],
      [1, alpha('#fff3d6', 0)],
    ]),
  )
  g.vignette(0.35)
}

/** Each player's pitch: a mat at their throwing spot with a foul line in their colour. */
function drawPitch(g: Draw, side: Side, active: boolean, t: number): void {
  const o = THROW[side] as { x: number; y: number }
  const col = SIDE[side]
  // The foul line sits in front of the thrower, toward the board.
  const lineY = side === 0 ? o.y - 96 : o.y + 96
  g.dashed(o.x - 330, lineY, o.x + 330, lineY, alpha(col.main, 0.6), 8, [30, 18])
  g.rrect(o.x - 140, o.y - 70, 280, 140, 40, alpha(shade(col.main, -0.55), 0.75))
  g.rrect(o.x - 140, o.y - 70, 280, 140, 40, undefined, alpha(col.main, active ? 0.8 : 0.3), 5)
  if (active) {
    g.alpha(0.25 + 0.15 * Math.sin(t * 5), () =>
      g.rrect(o.x - 152, o.y - 82, 304, 164, 50, undefined, col.light, 6),
    )
  }
}

/** The board: a raised wooden deck with painted team ends and a yellow ring round the hole. */
export function drawBoard(g: Draw, glow: number): void {
  const { x, y, w, h } = BOARD
  const lip = 26
  // Ground shadow and the board's thickness (light comes from the top of the screen).
  g.rrect(x + 22, y + 34, w, h, 30, alpha('#000000', 0.38))
  g.rrect(x - 6, y + lip - 6, w + 12, h + 6, 28, shade(C.woodDark, -0.35))
  for (const lx of [x + 40, x + w - 70])
    g.rrect(lx, y + h + 6, 30, lip - 4, 6, shade(C.woodDark, -0.55))
  g.rrect(
    x - 6,
    y - 6,
    w + 12,
    h + 12,
    28,
    g.lin(0, y, 0, y + h, [
      [0, shade(PLANK, 0.12)],
      [1, shade(PLANK, -0.08)],
    ]),
  )
  // Planks along the length.
  for (let i = 1; i < 5; i++) {
    const px = x + (w * i) / 5
    g.line(px, y + 4, px, y + h - 4, alpha(C.woodDark, 0.25), 3)
  }
  for (let i = 0; i < 9; i++) {
    const kx = x + 30 + ((i * 197) % (w - 60))
    const ky = y + 60 + ((i * 331) % (h - 120))
    g.ellipse(kx, ky, 10, 4, alpha(C.woodDark, 0.25))
  }
  // Painted ends: blue's at the top, red's at the bottom, with their marks.
  const band = 120
  g.clip(x - 6, y - 6, w + 12, h + 12, 28, () => {
    g.rect(x - 6, y - 6, w + 12, band, alpha(SIDE[1].dark, 0.85))
    g.rect(x - 6, y + h + 6 - band, w + 12, band, alpha(SIDE[0].dark, 0.85))
    g.rect(x - 6, y - 6 + band, w + 12, 10, alpha('#ffffff', 0.7))
    g.rect(x - 6, y + h - 4 - band, w + 12, 10, alpha('#ffffff', 0.7))
  })
  g.sideMark(1, x + w / 2, y + 54, 26, alpha('#ffffff', 0.85))
  g.sideMark(0, x + w / 2, y + h - 54, 26, alpha('#ffffff', 0.85))
  // Painted border.
  g.rrect(x + 16, y + 16, w - 32, h - 32, 16, undefined, alpha('#ffffff', 0.35), 5)
  // Gloss.
  g.alpha(0.18, () => g.rrect(x + 10, y + 8, w * 0.35, h - 16, 18, '#ffffff'))
  drawHole(g, glow)
}

function drawHole(g: Draw, glow: number): void {
  const { x, y, r } = HOLE
  if (glow > 0) g.alpha(glow, () => g.circle(x, y, r + 34, alpha(C.yellow, 0.35)))
  g.circle(x, y, r + 20, C.yellow)
  g.circle(x, y, r + 20, undefined, shade(C.yellow, -0.35), 4)
  g.circle(x, y, r + 6, shade(C.woodDark, -0.2))
  g.circle(
    x,
    y,
    r,
    g.rad(x, y + r * 0.3, 2, r * 1.1, [
      [0, '#0a0610'],
      [0.75, '#1c1220'],
      [1, '#3a2818'],
    ]),
  )
  // Inner wall lit from above.
  g.alpha(0.5, () => g.arc(x, y, r - 4, 0.2, Math.PI - 0.2, shade(C.woodDark, 0.1), 8))
}

/** A bean bag: red is a round pouch, blue a square pillow, both with stitched seams. */
export function bagShape(g: Draw, side: Side, r: number, rot: number, sx = 1, sy = 1): void {
  const col = SIDE[side]
  g.at(
    0,
    0,
    rot,
    () => {
      const fill = g.rad(
        0,
        0,
        r * 0.1,
        r * 1.1,
        [
          [0, shade(col.main, 0.35)],
          [0.6, col.main],
          [1, shade(col.main, -0.3)],
        ],
        -r * 0.3,
        -r * 0.35,
      )
      if (side === 0) {
        g.circle(0, r * 0.12, r, shade(col.dark, -0.35))
        g.circle(0, 0, r, fill)
        g.ctx.setLineDash([6, 6])
        g.circle(0, 0, r * 0.72, undefined, alpha('#ffffff', 0.55), 3)
        g.ctx.setLineDash([])
      } else {
        g.rrect(-r, -r + r * 0.12, r * 2, r * 2, r * 0.45, shade(col.dark, -0.35))
        g.rrect(-r, -r, r * 2, r * 2, r * 0.45, fill)
        g.ctx.setLineDash([6, 6])
        g.rrect(
          -r * 0.7,
          -r * 0.7,
          r * 1.4,
          r * 1.4,
          r * 0.25,
          undefined,
          alpha('#ffffff', 0.55),
          3,
        )
        g.ctx.setLineDash([])
      }
      g.alpha(0.45, () => g.ellipse(-r * 0.35, -r * 0.4, r * 0.32, r * 0.18, '#ffffff', -0.5))
    },
    sx,
    sy,
  )
}

/** One bag: a shadow on the ground, the bag lifted by its height, squashed when it lands. */
export function drawBag(g: Draw, b: Bag): void {
  const col = SIDE[b.side]
  const rot = b.rot ?? 0
  const r = BAG_R * 1.12
  if (b.st === 'hole') {
    // Drops into the hole: shrinks and darkens.
    const k = Math.max(0, 1 - b.since * 2.4)
    if (k <= 0) return
    g.alpha(k, () =>
      g.at(HOLE.x, HOLE.y + (1 - k) * 10, 0, () => bagShape(g, b.side, r * (0.45 + 0.55 * k), rot)),
    )
    g.alpha((1 - k) * 0.6, () => g.circle(HOLE.x, HOLE.y, HOLE.r * 0.6, shade(col.dark, -0.4)))
    return
  }
  const falling = b.st === 'off'
  const lift = falling ? 0 : Math.max(0, b.z)
  const k = 1 + lift / 360
  const fade = falling ? Math.max(0, 1 + b.z / 260) : 1
  if (fade <= 0) return
  const sink = falling ? Math.min(1, -b.z / 260) : 0
  // Contact shadow on the ground.
  g.alpha(fade * (0.45 / k), () => {
    const sr = r * (1.15 - Math.min(0.45, lift / 1200))
    g.ellipse(b.x + 6, b.y + 8, sr, sr * 0.7, '#000')
  })
  // Squash on landing.
  const land = b.st === 'slide' && b.since < 0.2 ? 1 - b.since / 0.2 : 0
  const sx = 1 + land * 0.28
  const sy = 1 - land * 0.22
  g.alpha(fade, () =>
    g.at(b.x - lift * 0.12, b.y - lift * 0.18 + sink * 30, 0, () =>
      bagShape(g, b.side, r * k * (1 - sink * 0.3), rot, sx, sy),
    ),
  )
}

/** Bags left to throw, as small bags along a player's edge. Used bags go dark. */
export function tossTray(g: Draw, side: Side, left: number, x: number, y: number): void {
  g.forSide(side, x, y, () => {
    const gap = 46
    const x0 = -((BAGS_EACH - 1) * gap) / 2
    for (let i = 0; i < BAGS_EACH; i++) {
      const on = i < left
      g.at(x0 + i * gap, 0, 0, () => {
        if (on) bagShape(g, side, 16, 0)
        else g.alpha(0.18, () => bagShape(g, side, 14, 0))
      })
    }
  })
}

export interface Look {
  /** Current aim for the side whose turn it is, null when idle. */
  aim: {
    dx: number
    dy: number
    power: number
    preview: { x: number; y: number; z: number }[]
  } | null
  /** Show the "pull back" hint for this side. */
  hint: [boolean, boolean]
  /** Sides whose banners are drawn: both in local 2P, the viewer's own otherwise. */
  readers: Side[]
  /** Who won, once the match is decided. */
  winner: Side | null
}

/** A banner in each reader's own space between the board and their pitch. */
function halfBanner(
  g: Draw,
  readers: Side[],
  text: string,
  o: { size?: number; color?: string; alpha?: number } = {},
): void {
  for (const side of readers) banner(g, side, text, side === 0 ? 1440 : 360, o)
}

export function render(g: Draw, s: State, look: Look, t: number): void {
  drawTable(g)
  const aiming = s.phase === 'aim' && look.winner === null
  for (const side of [0, 1] as Side[]) drawPitch(g, side, aiming && s.turn === side, t)
  const inAir = s.bags.some((b) => b.st === 'air')
  drawBoard(g, inAir ? 0.6 + 0.4 * Math.sin(t * 10) : 0)
  // Bags back to front so the lifted ones overlap the grounded ones.
  const order = [...s.bags].sort((a, b) => a.y - b.y)
  for (const b of order) drawBag(g, b)
  // The bag in hand, waiting at the throwing spot.
  if (aiming && s.tosses[s.turn] < BAGS_EACH) {
    const o = THROW[s.turn] as { x: number; y: number }
    const a = look.aim
    const pull = a ? a.power * 46 : 0
    const bx = o.x - (a ? a.dx * pull : 0)
    const by = o.y - (a ? a.dy * pull : 0)
    g.alpha(0.5 + 0.25 * Math.sin(t * 6), () => g.ring(bx, by, BAG_R * 1.9, C.yellow, 6))
    g.shadow(bx + 6, by + 10, BAG_R * 1.2, BAG_R * 0.7, 0.4)
    g.at(bx, by, 0, () => bagShape(g, s.turn, BAG_R * 1.12, s.turn === 0 ? 0 : 0.2))
    if (a) {
      // Aim arrow from the bag, length by power.
      const len = 60 + a.power * 150
      const ex = bx + a.dx * len
      const ey = by + a.dy * len
      g.line(bx + a.dx * 46, by + a.dy * 46, ex, ey, alpha(C.yellow, 0.9), 12)
      g.poly(
        [
          ex + a.dx * 26,
          ey + a.dy * 26,
          ex - a.dy * 20,
          ey + a.dx * 20,
          ex + a.dy * 20,
          ey - a.dx * 20,
        ],
        C.yellow,
      )
    }
  }
  if (look.aim && s.phase === 'aim') drawTrajectory(g, look.aim.preview, SIDE[s.turn].light)
  if (s.phase === 'score' || s.phase === 'over') {
    const since = s.now - s.scoredAt
    // Bags in the hole get their "3" in a ring round it, so several never overlap.
    let inHole = 0
    s.bags.forEach((b, i) => {
      const pts = bagPoints(b)
      const k = outBack(clamp((since - i * 0.08) / 0.3, 0, 1))
      const ring = b.st === 'hole' ? inHole++ : 0
      if (k <= 0) return
      const a = -Math.PI / 2 + ring * ((Math.PI * 2) / 8)
      const x = b.st === 'hole' ? HOLE.x + Math.cos(a) * (HOLE.r + 52) : b.x
      const y = b.st === 'hole' ? HOLE.y + Math.sin(a) * (HOLE.r + 52) : b.y - 64
      g.forSide(b.side, x, y, () => {
        g.text(pts, 0, 0, {
          size: 58 * k,
          weight: 700,
          color: pts > 0 ? SIDE[b.side].light : alpha(C.white, 0.5),
          stroke: alpha(C.ink, 0.85),
        })
      })
    })
  }
  for (const side of [0, 1] as Side[]) {
    const left = BAGS_EACH - s.tosses[side]
    tossTray(g, side, left, side === 0 ? W - 160 : 160, side === 0 ? 1730 : 70)
  }
  // Round title, then the round's result, then the winner.
  const sinceRound = s.now - s.roundAt
  if (look.winner !== null) {
    for (const side of look.readers) {
      const won = side === look.winner
      banner(
        g,
        side,
        won ? 'You win!' : `${SIDE[look.winner].name} wins`,
        side === 0 ? 1440 : 360,
        {
          size: 72,
          color: won ? C.yellow : SIDE[look.winner].light,
        },
      )
    }
  } else if ((s.phase === 'score' || s.phase === 'over') && s.roundPts) {
    const [a, b] = s.roundPts
    const gain = a - b
    const text = gain === 0 ? 'Even round' : `${gain > 0 ? 'Red' : 'Blue'} +${Math.abs(gain)}`
    const k = outBack(clamp((s.now - s.scoredAt - 0.3) / 0.3, 0, 1))
    if (k > 0)
      halfBanner(g, look.readers, text, {
        size: 76 * k,
        color: gain === 0 ? C.white : SIDE[gain > 0 ? 0 : 1].light,
      })
  } else if (sinceRound < 1.5) {
    halfBanner(g, look.readers, s.round === 1 ? `First to ${TO_WIN}` : `Round ${s.round}`, {
      size: 56,
      alpha: Math.min(1, (1.5 - sinceRound) * 3),
    })
  } else {
    for (const side of [0, 1] as Side[]) {
      if (!look.hint[side]) continue
      banner(g, side, 'Pull back, let go to throw', side === 0 ? 1440 : 360, {
        size: 38,
        alpha: 0.75 + 0.25 * Math.sin(t * 4),
      })
    }
  }
}
