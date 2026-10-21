import type { Side } from '../../core/game.ts'
import { outBack, outCubic } from '../../core/fx/ease.ts'
import { banner, bigScore, hudY, namePill } from '../../core/hud.ts'
import type { Draw, Mood } from '../../core/render/draw.ts'
import { alpha, C, SIDE, shade } from '../../core/render/palette.ts'
import { H, MID, W } from '../../core/stage.ts'
import { ARENA, BLOB_R, inZone, type World, ZONE_EVERY, ZONE_R } from './rules.ts'

export interface Stick {
  bx: number
  by: number
  kx: number
  ky: number
}

export interface Look {
  names: [string, string]
  /** Crown seconds needed to win. */
  target: number
  sticks: [Stick | null, Stick | null]
  end: { at: number; winner: Side | 'draw' } | null
  /** Blob squash (1 = rest), cosmetic. */
  squash: [number, number]
  /** Meter pulse on each crown second, 0..1. */
  pulse: [number, number]
}

const CROWN = '👑'
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v)

/** The arena: a floodlit floor in a wooden ring, each end glowing in its owner's colour. */
function drawArena(g: Draw): void {
  g.fillView(
    g.lin(0, 0, 0, H, [
      [0, shade(C.blue, -0.82)],
      [0.5, C.ink],
      [1, shade(C.red, -0.82)],
    ]),
  )
  const { x0, y0, x1, y1, corner } = ARENA
  const w = x1 - x0
  const h = y1 - y0
  g.shadow(W / 2, y1 + 40, w * 0.55, 40, 0.5)
  g.rrect(x0 - 26, y0 - 26 + 14, w + 52, h + 52, corner + 26, shade(C.woodDark, -0.35))
  g.rrect(
    x0 - 26,
    y0 - 26,
    w + 52,
    h + 52,
    corner + 26,
    g.lin(x0, 0, x1, 0, [
      [0, shade(C.wood, -0.15)],
      [0.5, C.wood],
      [1, shade(C.wood, -0.2)],
    ]),
  )
  g.rrect(x0 + corner, y0 - 22, w - corner * 2, 8, 4, alpha(C.white, 0.25))
  g.rrect(
    x0,
    y0,
    w,
    h,
    corner,
    g.lin(0, y0, 0, y1, [
      [0, shade(C.blue, -0.55)],
      [0.5, shade(C.ink3, 0.02)],
      [1, shade(C.red, -0.55)],
    ]),
  )
  g.clip(x0, y0, w, h, corner, () => {
    // Floodlight pool and soft tiles.
    g.fillView(
      g.rad(W / 2, MID, 40, h * 0.62, [
        [0, alpha('#ffffff', 0.12)],
        [1, alpha('#ffffff', 0)],
      ]),
    )
    const c = g.ctx
    c.fillStyle = alpha('#000000', 0.14)
    c.beginPath()
    for (let y = y0 + 55; y < y1; y += 110)
      for (let x = x0 + 55 + (((y - y0) / 110) % 2) * 55; x < x1; x += 110) {
        c.moveTo(x + 5, y)
        c.arc(x, y, 5, 0, Math.PI * 2)
      }
    c.fill()
    g.line(x0, MID, x1, MID, alpha(C.white, 0.08), 6)
  })
  g.rrect(x0, y0, w, h, corner, undefined, alpha(C.white, 0.16), 6)
}

/** The crown zone: a glowing yellow pad that hops to its next spot, telegraphed beforehand. */
function drawZone(g: Draw, w: World): void {
  const hop = clamp01((w.t - w.from.at) / 0.5)
  const e = outCubic(hop)
  const zx = w.from.x + (w.zone.x - w.from.x) * e
  const zy = w.from.y + (w.zone.y - w.from.y) * e
  const pop = hop < 1 ? 0.6 + 0.4 * outBack(hop) : 1
  const r = ZONE_R * pop
  // Telegraph: the next spot pulses in for the last seconds before the jump.
  const soon = w.next ? clamp01(1 - w.zone.t / 2.5) : 0
  if (soon > 0 && w.next) {
    const n = w.next
    const p = 0.5 + 0.5 * Math.sin(g.t * 10)
    g.alpha(soon * (0.12 + 0.1 * p), () => g.circle(n.x, n.y, ZONE_R, C.yellow))
    g.at(n.x, n.y, g.t * 0.8, () =>
      g.alpha(soon * 0.8, () => dashedRing(g, ZONE_R, alpha(C.yellow, 0.85), 8)),
    )
    g.alpha(soon * 0.5, () => g.emoji(CROWN, n.x, n.y, 70))
  }
  const holder = w.holder
  const contested = holder === null && w.blobs.every((b) => inZone(b, w.zone))
  const col = contested ? C.white : holder === null ? C.yellow : SIDE[holder].main
  const p = 0.5 + 0.5 * Math.sin(g.t * (contested ? 16 : 4))
  // Pad: raised disc with a glow, filling with the holder's colour.
  g.alpha(0.5 + p * 0.25, () =>
    g.circle(
      zx,
      zy,
      r + 50,
      g.rad(zx, zy, r * 0.6, r + 50, [
        [0, alpha(col, 0.35)],
        [1, alpha(col, 0)],
      ]),
    ),
  )
  g.circle(zx, zy + 10, r, alpha('#000000', 0.25))
  g.circle(
    zx,
    zy,
    r,
    g.rad(
      zx,
      zy,
      10,
      r,
      [
        [0, alpha(col, 0.45)],
        [0.75, alpha(col, 0.22)],
        [1, alpha(col, 0.4)],
      ],
      zx - r * 0.3,
      zy - r * 0.3,
    ),
  )
  g.ring(zx, zy, r, contested ? (p > 0.5 ? C.white : C.yellow) : col, 12)
  g.ring(zx, zy, r * 0.62, alpha(col, 0.35), 5)
  // Timer: the yellow arc runs down to the next jump.
  const left = clamp01(w.zone.t / ZONE_EVERY)
  g.arc(zx, zy, r + 28, 0, Math.PI * 2, alpha(C.white, 0.1), 10)
  g.arc(
    zx,
    zy,
    r + 28,
    -Math.PI / 2,
    -Math.PI / 2 + Math.PI * 2 * left,
    soon > 0 ? (p > 0.5 ? C.yellow : C.white) : C.yellow,
    10,
  )
}

function dashedRing(g: Draw, r: number, color: string, lw: number): void {
  const c = g.ctx
  c.save()
  c.setLineDash([26, 20])
  c.lineWidth = lw
  c.strokeStyle = color
  c.beginPath()
  c.arc(0, 0, r, 0, Math.PI * 2)
  c.stroke()
  c.restore()
}

/** Where the crown sits: on the zone, or on the head of the blob holding it alone. */
function crownSpot(
  w: World,
  end: Look['end'],
): { x: number; y: number; size: number; on: Side | null } {
  const on = end ? (end.winner === 'draw' ? null : end.winner) : w.holder
  if (on !== null) {
    const b = w.blobs[on]
    return { x: b.x, y: b.y - BLOB_R * 1.05, size: end ? 120 : 92, on }
  }
  const hop = clamp01((w.t - w.from.at) / 0.5)
  const e = outCubic(hop)
  return {
    x: w.from.x + (w.zone.x - w.from.x) * e,
    y: w.from.y + (w.zone.y - w.from.y) * e - Math.sin(Math.PI * hop) * 160,
    size: 130,
    on: null,
  }
}

function drawCrown(g: Draw, w: World, end: Look['end']): void {
  const c = crownSpot(w, end)
  const bob = Math.sin(g.t * 3) * 8
  if (c.on === null) g.shadow(c.x, c.y + 70, 52, 16, 0.35)
  const tilt = c.on === null ? Math.sin(g.t * 2) * 0.08 : Math.sin(g.t * 6) * 0.12
  g.emoji(CROWN, c.x, c.y + (c.on === null ? bob - 20 : bob * 0.5), c.size, tilt)
  if (c.on !== null) {
    // A sparkle or two while crowned.
    const a = g.t * 4
    g.alpha(0.6 + 0.4 * Math.sin(a * 2), () =>
      g.star(c.x + Math.cos(a) * 70, c.y - 20 + Math.sin(a) * 26, 16, C.yellow),
    )
  }
}

/** A blob: squashes on bumps and along its motion, looks at the crown, shows its mood. */
function drawBlob(g: Draw, w: World, side: Side, look: Look): void {
  const b = w.blobs[side]
  const sp = Math.hypot(b.vx, b.vy)
  const k = Math.min(0.16, sp / 5000)
  const sq = look.squash[side] ?? 1
  const z = w.zone
  const lx = z.x - b.x
  const ly = z.y - b.y
  const ld = Math.hypot(lx, ly) || 1
  const inside = inZone(b, z)
  let mood: Mood = b.stun > 0 ? 'dizzy' : w.holder === side ? 'grin' : inside ? 'angry' : 'happy'
  if (look.end)
    mood = look.end.winner === side ? 'grin' : look.end.winner === 'draw' ? 'wow' : 'dizzy'
  // A little hop while crowned, or for the winner.
  const hop =
    (look.end && look.end.winner === side) || w.holder === side
      ? Math.abs(Math.sin(g.t * (look.end ? 9 : 6))) * (look.end ? 30 : 10)
      : 0
  g.shadow(b.x + 6, b.y + BLOB_R * 0.85, BLOB_R * (1 - hop / 200), BLOB_R * 0.32, 0.45)
  g.blob(b.x, b.y - hop, BLOB_R, SIDE[side].main, {
    mood,
    look: [lx / ld, ly / ld],
    sx: (1 + k) * (2 - sq),
    sy: (1 - k) * sq,
    outline: true,
  })
  // Reeling from a shove: stars circle the head.
  if (b.stun > 0)
    for (let i = 0; i < 3; i++) {
      const a = g.t * 7 + (i * Math.PI * 2) / 3
      g.star(b.x + Math.cos(a) * BLOB_R * 0.8, b.y - BLOB_R * 1.05 + Math.sin(a) * 18, 14, C.yellow)
    }
  // Side badge on the shoulder: red circle, blue square.
  const mx = b.x + BLOB_R * 0.78
  const my = b.y - hop - BLOB_R * 0.78
  g.sideMark(side, mx, my, 19, C.white)
  g.sideMark(side, mx, my, 13, SIDE[side].main)
}

/** Human's floating stick, faint, in the team colour. */
function drawStick(g: Draw, side: Side, s: Stick | null): void {
  if (!s) return
  const col = SIDE[side]
  g.alpha(0.55, () => {
    g.circle(s.bx, s.by, 110, alpha(col.dark, 0.3), alpha(col.light, 0.5), 5)
    g.ball(s.kx, s.ky, 50, col.main, 0.6)
  })
}

/** Crown meter at a side's HUD row: chunky glossy bar toward the target, crown at the end. */
function meter(
  g: Draw,
  side: Side,
  value: number,
  target: number,
  pulse: number,
  held: boolean,
): void {
  const y = hudY(g, side)
  const x = side === 0 ? W - 200 : 200
  const frac = clamp01(value / target)
  g.forSide(side, x, y, () => {
    const L = 230
    const h = 34
    g.rrect(-L / 2, -h / 2 + 5, L, h, h / 2, alpha('#000000', 0.35))
    g.rrect(-L / 2, -h / 2, L, h, h / 2, alpha(C.white, 0.12))
    if (frac > 0) {
      const fw = Math.max(h, L * frac)
      g.rrect(-L / 2, -h / 2, fw, h, h / 2, held ? SIDE[side].light : SIDE[side].main)
      g.rrect(-L / 2 + 6, -h / 2 + 4, fw - 12, h * 0.32, h * 0.16, alpha(C.white, 0.35))
    }
    const s = 1 + pulse * 0.35
    g.emoji(CROWN, L / 2 + 8, -4, 62 * s, frac >= 1 ? Math.sin(g.t * 8) * 0.2 : 0)
  })
}

export function render(g: Draw, w: World, look: Look): void {
  drawArena(g)
  drawZone(g, w)
  for (const side of [0, 1] as Side[]) drawStick(g, side, look.sticks[side])
  // Draw the blob further from the viewer's light first (top of the table), then the other.
  const order: Side[] = w.blobs[0].y < w.blobs[1].y ? [0, 1] : [1, 0]
  // Unclaimed, the crown sits on the pad under the blobs; claimed, it rides on a head.
  const worn = look.end ? look.end.winner !== 'draw' : w.holder !== null
  if (!worn) drawCrown(g, w, look.end)
  for (const side of order) drawBlob(g, w, side, look)
  if (worn) drawCrown(g, w, look.end)
  for (const side of [0, 1] as Side[]) {
    const held = w.holder === side && !look.end
    namePill(g, side, look.names[side], { x: W / 2, active: held })
    bigScore(g, side, Math.floor(w.crown[side]), { x: side === 0 ? 110 : W - 110 })
    meter(g, side, w.crown[side], look.target, look.pulse[side] ?? 0, held)
  }
  const end = look.end
  if (end) {
    const k = clamp01((w.t - end.at) / 0.35)
    if (end.winner === 'draw') banner(g, undefined, 'DRAW', MID, { alpha: k })
    else
      banner(g, end.winner, 'CROWNED!', end.winner === 0 ? MID + 330 : MID - 330, {
        alpha: k,
        size: 64 + (1 - k) * 30,
        color: C.yellow,
      })
  }
}
