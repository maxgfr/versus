import { inFrame, textAngle } from '../../core/frame.ts'
import type { Side } from '../../core/game.ts'
import { outBack } from '../../core/fx/ease.ts'
import { banner, hudY, namePill } from '../../core/hud.ts'
import type { Draw } from '../../core/render/draw.ts'
import { alpha, C, mix, shade, SIDE } from '../../core/render/palette.ts'
import { H, MID, W } from '../../core/stage.ts'
import {
  HEAD_R,
  headAt,
  type Hippo,
  MARBLE_R,
  MOUTH_AT,
  mouthOf,
  MOUTH_R,
  POND,
  REACH,
  type World,
} from './rules.ts'

export interface Look {
  names: [string, string]
  /** Squash of each hippo's head (1 = rest). */
  chomp: [number, number]
  /** Match length in marbles. */
  target: number
  /** Seconds the frame sits before the last step (smooth marbles). */
  back?: number
  /** The decided match (stamped in state), for the ending. */
  end: { at: number; winner: Side | 'draw' } | null
}

const MARBLE_COLORS = [C.yellow, C.green, C.cyan, C.purple, C.orange, C.pink, C.white]

export const marbleColor = (id: number): string =>
  MARBLE_COLORS[id % MARBLE_COLORS.length] ?? C.white

/** Hippo hide: the team colour, softened toward lilac so it reads as a toy animal. */
const hide = (side: Side): string => mix(SIDE[side].main, '#b9a7ff', 0.18)
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v)

/** Table, team docks and the pond: a toy plastic basin with a chunky rim. */
function drawPond(g: Draw, w: World): void {
  g.fillView(
    g.lin(0, 0, 0, H, [
      [0, shade(C.blue, -0.8)],
      [0.5, C.ink],
      [1, shade(C.red, -0.8)],
    ]),
  )
  // Each hippo's dock: a big half-disc of its team colour at its edge.
  for (const side of [0, 1] as Side[]) {
    const y = side === 0 ? H + 60 : -60
    g.circle(
      W / 2,
      y,
      560,
      g.rad(W / 2, y, 120, 560, [
        [0, alpha(SIDE[side].main, 0.42)],
        [1, alpha(SIDE[side].main, 0.06)],
      ]),
    )
    g.ring(W / 2, y, 560, alpha(SIDE[side].light, 0.25), 6)
  }
  const { x, y, r } = POND
  g.shadow(x, y + r + 30, r * 1.02, 60, 0.45)
  // Rim: cream plastic with a lip and a gloss line.
  g.circle(x, y + 16, r + 36, shade(C.sand, -0.45))
  g.circle(
    x,
    y,
    r + 36,
    g.lin(0, y - r, 0, y + r, [
      [0, shade(C.cream, 0.1)],
      [1, shade(C.sand, -0.12)],
    ]),
  )
  g.arc(x, y, r + 24, Math.PI * 1.1, Math.PI * 1.9, alpha('#ffffff', 0.55), 6)
  // Water: deep at the edge, bright and shallow in the middle.
  g.circle(
    x,
    y,
    r,
    g.rad(x, y, 30, r, [
      [0, shade(C.teal, 0.22)],
      [0.55, shade(C.teal, -0.18)],
      [1, shade(C.blue, -0.45)],
    ]),
  )
  g.clip(x - r, y - r, r * 2, r * 2, r, () => {
    // Inner shadow from the rim, team tint on each side's half.
    g.rect(
      x - r,
      y - r,
      r * 2,
      r * 2,
      g.lin(0, y - r, 0, y + r, [
        [0, alpha(SIDE[1].main, 0.16)],
        [0.5, alpha(SIDE[1].main, 0)],
        [0.5, alpha(SIDE[0].main, 0)],
        [1, alpha(SIDE[0].main, 0.16)],
      ]),
    )
    g.fillView(
      g.rad(x - 150, y - 190, 20, 420, [
        [0, alpha('#ffffff', 0.16)],
        [1, alpha('#ffffff', 0)],
      ]),
    )
    // Lazy ripples.
    for (let i = 0; i < 4; i++) {
      const a = g.t * 0.3 + i * 1.7
      const rr = 150 + i * 90 + Math.sin(g.t + i) * 10
      g.ring(
        x + Math.cos(a) * 60,
        y + Math.sin(a * 0.7) * 60,
        rr,
        alpha('#ffffff', 0.05 + 0.02 * Math.sin(g.t * 2 + i)),
        5,
      )
    }
    // Reach of each hippo: the arc its mouth can sweep.
    for (const side of [0, 1] as Side[]) {
      const hp = w.hippos[side]
      g.ring(hp.bx, hp.by, REACH + HEAD_R * MOUTH_AT, alpha(SIDE[side].light, 0.16), 5)
    }
  })
  g.ring(x, y, r, alpha('#000000', 0.25), 8)
}

/** The hopper in the middle: a dot for every marble still to come, the next one pops out. */
function drawHopper(g: Draw, w: World): void {
  const left = w.target - w.released
  const R = 72
  g.circle(POND.x, POND.y, R + 22, alpha(C.ink, 0.35))
  g.ring(POND.x, POND.y, R + 22, alpha(C.yellow, left > 0 ? 0.6 : 0.2), 5)
  const n = w.target
  const dot = Math.max(4, Math.min(10, (Math.PI * 2 * R) / n / 2.6))
  for (let i = 0; i < n; i++) {
    const a = -Math.PI / 2 + (i / n) * Math.PI * 2
    const on = i < left
    g.circle(
      POND.x + Math.cos(a) * R,
      POND.y + Math.sin(a) * R,
      dot,
      on ? marbleColor(w.released + 1 + (left - 1 - i)) : alpha(C.white, 0.12),
    )
  }
  // Countdown to the next release: a filling yellow core.
  if (left > 0) {
    const k = clamp01(1 - w.spawnT / 1.1)
    g.circle(POND.x, POND.y, 14 + k * 22, alpha(C.yellow, 0.25 + k * 0.5))
  }
}

function drawMarbles(g: Draw, w: World, back: number): void {
  for (const m0 of w.marbles) {
    // Drawn a fraction of a step back along its path: smooth at any refresh rate.
    const m = back > 0 ? { id: m0.id, x: m0.x - m0.vx * back, y: m0.y - m0.vy * back } : m0
    // Fresh marbles pop out of the hopper.
    const age = w.t - w.lastSpawn
    const fresh = m.id === w.nextId - 1 && age < 0.3
    const s = fresh ? 0.4 + 0.6 * outBack(clamp01(age / 0.3)) : 1
    g.shadow(m.x + 6, m.y + 12, MARBLE_R * 0.95 * s, MARBLE_R * 0.6 * s, 0.35)
    g.ball(m.x, m.y, MARBLE_R * s, marbleColor(m.id), 1)
  }
}

/**
 * A hippo seen from above: a big body on its dock, a neck that stretches as
 * the head lunges, and a head with ears, eyes, a wide muzzle, and a mouth full
 * of teeth while it chomps. Drawn in the hippo's own frame (forward = -y).
 */
function drawHippo(g: Draw, side: Side, h: Hippo, chomp: number, look: Look, now: number): void {
  const col = hide(side)
  const dark = shade(col, -0.32)
  const light = shade(col, 0.28)
  const head = headAt(h)
  const open = h.phase === 'out' || h.phase === 'hold'
  const end = look.end
  const happy = end ? end.winner === side : false
  const sad = end ? end.winner !== side && end.winner !== 'draw' : false
  const bounce = happy ? Math.abs(Math.sin(now * 8)) * 16 : 0
  const fwd = side === 0 ? 0 : Math.PI
  // Body on the dock, behind the head.
  g.at(h.bx, h.by - (side === 0 ? bounce : -bounce), fwd, () => {
    g.shadow(10, 96, 170, 70, 0.4)
    for (const sx of [-1, 1]) {
      g.ellipse(sx * 150, 10, 46, 34, dark)
      g.ellipse(sx * 140, 150, 46, 34, dark)
    }
    g.ellipse(0, 76, 168, 138, dark)
    g.ellipse(
      0,
      66,
      164,
      132,
      g.rad(
        0,
        66,
        20,
        170,
        [
          [0, light],
          [0.7, col],
          [1, shade(col, -0.12)],
        ],
        -40,
        20,
      ),
    )
    g.alpha(0.4, () => g.ellipse(-50, 30, 70, 36, '#ffffff', -0.3))
    // Team badge on the back.
    g.sideMark(side, 0, 110, 22, alpha(C.white, 0.85))
  })
  // Neck: from the body to the head, stretching on a lunge.
  const ang = Math.atan2(h.dy, h.dx) + Math.PI / 2
  const rest = { x: h.bx, y: h.by + h.fy * 40 }
  const nl = Math.hypot(head.x - rest.x, head.y - rest.y)
  if (nl > 10) {
    g.line(rest.x, rest.y, head.x, head.y, dark, 118)
    g.line(rest.x, rest.y, head.x, head.y, col, 104)
  }
  // Head: squashes on a chomp, stretches forward while lunging.
  const k = chomp
  g.at(
    head.x,
    head.y,
    ang,
    () => {
      g.shadow(8, 34, HEAD_R * 1.05, HEAD_R * 0.8, 0.35)
      const lip = shade(col, -0.5)
      // Ears at the back corners.
      for (const sx of [-1, 1]) {
        g.ellipse(sx * 64, 62, 22, 28, dark, sx * 0.5)
        g.ellipse(sx * 64, 62, 11, 15, alpha(C.pink, 0.7), sx * 0.5)
      }
      // Skull: the back of the head, where the eyes sit.
      g.ellipse(0, 26, 84, 74, dark)
      g.ellipse(
        0,
        20,
        82,
        72,
        g.rad(
          0,
          20,
          8,
          84,
          [
            [0, light],
            [1, col],
          ],
          -24,
          0,
        ),
      )
      if (open) {
        // Jaws wide: dark mouth with a tongue, tusks at the corners, lower lip out front.
        g.ellipse(0, -78, 92, 70, lip)
        g.ellipse(0, -78, 84, 62, shade(C.ink, 0.05))
        g.ellipse(0, -62, 52, 30, C.pink)
        g.ellipse(0, -70, 6, 20, alpha(shade(C.pink, -0.3), 0.6))
        for (const sx of [-1, 1]) {
          g.poly([sx * 52, -120, sx * 70, -118, sx * 62, -96], '#ffffff')
          g.poly([sx * 54, -34, sx * 72, -36, sx * 62, -58], '#ffffff')
        }
        g.ellipse(0, -142, 88, 22, dark)
        g.ellipse(0, -146, 84, 18, col)
        // Upper jaw pulled back over the skull.
        g.ellipse(0, -20, 96, 42, dark)
        g.ellipse(0, -24, 94, 40, light)
        for (const sx of [-1, 1]) g.ellipse(sx * 30, -34, 10, 7, lip)
      } else {
        // Wide muzzle in front: the widest part of a hippo.
        g.ellipse(0, -48, 104, 66, dark)
        g.ellipse(
          0,
          -54,
          102,
          62,
          g.rad(
            0,
            -54,
            10,
            104,
            [
              [0, shade(light, 0.1)],
              [1, col],
            ],
            -30,
            -80,
          ),
        )
        for (const sx of [-1, 1]) {
          g.ellipse(sx * 32, -88, 12, 8, lip)
          g.ellipse(sx * 32, -90, 5, 3, alpha('#ffffff', 0.3))
        }
        // Lip line round the front of the muzzle.
        g.at(0, -54, 0, () => g.arc(0, 0, 86, Math.PI + 0.75, -0.75, alpha(lip, 0.6), 5), 1.18, 0.7)
      }
      // Eyes on bumps on top of the head, looking forward (squinting with joy at the end).
      for (const sx of [-1, 1]) {
        const ex = sx * 42
        const ey = open ? 30 : 22
        g.circle(ex, ey + 4, 26, dark)
        g.circle(ex, ey, 25, col)
        if (happy) {
          g.arc(ex, ey + 6, 13, Math.PI + 0.3, -0.3, C.ink, 7)
          continue
        }
        g.circle(ex, ey, 20, '#ffffff')
        g.circle(ex, ey - 6, 11, C.ink)
        g.circle(ex - 4, ey - 10, 4, '#ffffff')
        if (sad) g.line(ex - 18, ey - 22 + sx * 6, ex + 18, ey - 22 - sx * 6, lip, 7)
      }
    },
    1 + (1 - k) * 0.5,
    k,
  )
  // Mouth zone while chomping: a bright ring where marbles get eaten.
  if (open) {
    const m = mouthOf(h)
    g.ring(m.x, m.y, MOUTH_R, alpha(SIDE[side].light, 0.45), 6)
  }
}

/** Each side's tray of eaten marbles beside its hippo, with the count. Red frame, mirrored for blue. */
function drawTray(g: Draw, side: Side, h: Hippo, pulse: number): void {
  const y = hudY(g, 0)
  inFrame(g, side, () => {
    const x0 = 40
    const tw = 270
    const th = 132
    const ty = y - th / 2 - 72
    g.rrect(x0, ty + 8, tw, th, 30, alpha('#000000', 0.35))
    g.rrect(x0, ty, tw, th, 30, alpha(shade(SIDE[side].main, -0.6), 0.9))
    g.rrect(x0, ty, tw, th, 30, undefined, alpha(SIDE[side].light, 0.35), 4)
    // Empty slots, three rows of eight, show it is a tray for marbles.
    for (let row = 0; row < 3; row++)
      for (let i = 0; i < 8; i++)
        g.circle(x0 + 26 + i * 31, ty + th - 26 - row * 38, 13, alpha('#000000', 0.25))
    // Marbles in rows of eight, newest last; older ones pack under.
    const per = 8
    const show = h.ate.slice(-24)
    show.forEach((id, i) => {
      const row = Math.floor(i / per)
      const col = i % per
      g.ball(x0 + 26 + col * 31, ty + th - 26 - row * 38, 15, marbleColor(id), 0.7)
    })
    // The count, big, upright for its player.
    g.text(h.eaten, x0 + tw / 2, ty - 50, {
      size: 84 * (1 + pulse * 0.3),
      weight: 700,
      color: SIDE[side].main,
      drop: alpha('#000000', 0.35),
      angle: textAngle(g, side),
    })
  })
}

export function render(g: Draw, w: World, look: Look, pulse: [number, number] = [0, 0]): void {
  drawPond(g, w)
  drawHopper(g, w)
  drawMarbles(g, w, look.back ?? 0)
  for (const side of [0, 1] as Side[])
    drawHippo(g, side, w.hippos[side], look.chomp[side] ?? 1, look, w.t)
  // Pond rim over the marbles keeps them visually inside.
  g.ring(POND.x, POND.y, POND.r + 2, alpha(C.white, 0.08), 6)

  for (const side of [0, 1] as Side[]) {
    drawTray(g, side, w.hippos[side], pulse[side])
    // Name on the player's right, clear of the hippo.
    namePill(g, side, look.names[side], { x: side === 0 ? W - 195 : 195 })
  }
  const end = look.end
  if (end) {
    const k = clamp01((w.t - end.at) / 0.35)
    if (end.winner === 'draw') banner(g, undefined, 'DRAW', MID, { alpha: k })
    else
      banner(g, end.winner, 'HUNGRIEST HIPPO!', end.winner === 0 ? MID + 260 : MID - 260, {
        alpha: k,
        size: 58 + (1 - k) * 30,
        color: C.yellow,
      })
  }
}
