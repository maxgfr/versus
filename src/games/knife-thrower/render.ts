import { inFrame } from '../../core/frame.ts'
import { clamp, outBack, outCubic } from '../../core/fx/ease.ts'
import type { Side } from '../../core/game.ts'
import type { Draw } from '../../core/render/draw.ts'
import { alpha, C, SIDE, shade } from '../../core/render/palette.ts'
import { H } from '../../core/stage.ts'
import { FLY, type Flying, KNIVES, LOG, type Log, ORIGIN, type State } from './rules.ts'

/**
 * Everything is drawn in red's frame (log above the thrower, knives flying up)
 * and placed for blue with `inFrame`, so both halves are the same picture.
 */

const STEEL = '#dfe6f2'
const BARK = '#5a3518'
const GRAIN = '#e2b277'

/** Knife length from tip to pommel, and where the blade meets the guard. */
const BLADE = 78
const HILT = 150

/** The floodlit floor: each half washed in its team colour, a pool of light under each log. */
export function drawTable(g: Draw): void {
  g.fillView(
    g.lin(0, 0, 0, H, [
      [0, shade(SIDE[1].main, -0.78)],
      [0.47, shade(C.woodDark, -0.82)],
      [0.53, shade(C.woodDark, -0.82)],
      [1, shade(SIDE[0].main, -0.78)],
    ]),
  )
  for (const side of [0, 1] as Side[]) {
    inFrame(g, side, () => {
      g.circle(
        LOG.x,
        LOG.y,
        520,
        g.rad(LOG.x, LOG.y, 60, 520, [
          [0, alpha(shade(SIDE[side].main, 0.2), 0.3)],
          [0.6, alpha(SIDE[side].main, 0.08)],
          [1, alpha(SIDE[side].main, 0)],
        ]),
      )
      // Throwing lane from the thrower to the log.
      g.rrect(
        ORIGIN.x - 54,
        LOG.y + LOG.r + 60,
        108,
        ORIGIN.y - LOG.y - LOG.r - 10,
        54,
        alpha(C.ink, 0.18),
      )
    })
  }
  g.midline(alpha(C.white, 0.12))
  g.vignette(0.35)
}

/** One knife with its tip at (0, 0), the blade running down +y to the guard, handle below. */
export function knife(g: Draw, side: Side, shine = 1): void {
  const col = SIDE[side]
  // Blade: a long leaf, steel with a bright edge.
  g.path(
    (c) => {
      c.moveTo(0, 0)
      c.quadraticCurveTo(13, 20, 11, BLADE)
      c.lineTo(-11, BLADE)
      c.quadraticCurveTo(-12, 26, 0, 0)
      c.closePath()
    },
    g.lin(-11, 0, 11, 0, [
      [0, shade(STEEL, -0.35)],
      [0.45, STEEL],
      [1, '#ffffff'],
    ]),
    shade(STEEL, -0.55),
    2,
  )
  g.alpha(0.8 * shine, () => g.line(4, 12, 6, BLADE - 6, '#ffffff', 3))
  // Guard and handle in the thrower's colour, banded like a toy.
  g.rrect(-22, BLADE - 2, 44, 13, 6, C.ink3)
  g.rrect(-20, BLADE - 1, 40, 5, 3, alpha('#ffffff', 0.18))
  g.rrect(-12, BLADE + 10, 24, HILT - BLADE - 22, 10, col.main, shade(col.dark, -0.3), 3)
  g.rrect(-8, BLADE + 14, 6, HILT - BLADE - 32, 3, alpha('#ffffff', 0.3))
  for (const k of [0.35, 0.68]) {
    const y = BLADE + 10 + (HILT - BLADE - 22) * k
    g.rrect(-12, y - 3, 24, 6, 3, shade(col.dark, -0.2))
  }
  g.circle(0, HILT - 8, 12, shade(col.dark, -0.15))
  g.circle(-3, HILT - 11, 4, alpha('#ffffff', 0.5))
}

/** Where a stuck knife's tip sits, measured from the log centre. */
const TIP = LOG.r - 36

/** The log's end grain at rotation `a`: bark, rings, cracks and knots that turn with it. */
function logFace(g: Draw, side: Side, a: number, r: number): void {
  g.circle(0, 10, r + 4, shade(BARK, -0.45))
  // Bark: lumpy rim that turns with the log.
  g.circle(0, 0, r, BARK)
  for (let i = 0; i < 26; i++) {
    const t = a + (i / 26) * Math.PI * 2
    g.circle(
      Math.sin(t) * r * 0.97,
      Math.cos(t) * r * 0.97,
      r * (0.07 + (i % 3) * 0.012),
      shade(BARK, (i % 2) * 0.12 - 0.06),
    )
  }
  // End grain.
  const face = r * 0.88
  g.circle(
    0,
    0,
    face,
    g.rad(0, 0, face * 0.05, face, [
      [0, shade(GRAIN, 0.25)],
      [0.65, GRAIN],
      [1, shade(C.wood, -0.15)],
    ]),
  )
  // Growth rings, a little off-centre so the spin reads.
  const ox = Math.sin(a) * r * 0.05
  const oy = Math.cos(a) * r * 0.05
  for (const k of [0.2, 0.36, 0.52, 0.68, 0.82]) {
    g.ring(ox * (1 - k), oy * (1 - k), face * k, alpha(C.woodDark, 0.22 + k * 0.12), 3 + k * 2)
  }
  // Cracks and knots.
  for (const off of [0.4, 2.6, 4.4]) {
    const t = a + off
    g.line(
      Math.sin(t) * face * 0.28,
      Math.cos(t) * face * 0.28,
      Math.sin(t + 0.08) * face * 0.96,
      Math.cos(t + 0.08) * face * 0.96,
      alpha(shade(C.woodDark, -0.4), 0.5),
      4,
    )
  }
  for (const [off, d, kr] of [
    [1.5, 0.6, 0.09],
    [3.6, 0.45, 0.06],
    [5.4, 0.74, 0.05],
  ] as const) {
    const t = a + off
    const kx = Math.sin(t) * face * d
    const ky = Math.cos(t) * face * d
    g.circle(kx, ky, r * kr * 1.5, alpha(C.woodDark, 0.35))
    g.circle(kx, ky, r * kr, shade(C.woodDark, -0.35))
  }
  // Bullseye with the owner's mark: red a circle, blue a square.
  g.circle(0, 0, 40, shade(SIDE[side].dark, -0.2))
  g.circle(0, 0, 34, C.white)
  g.sideMark(side, 0, 0, 20, SIDE[side].main)
  // Light from the top-left.
  g.alpha(0.35, () => g.arc(0, 0, r * 0.93, Math.PI * 1.05, Math.PI * 1.45, '#ffffff', 6))
}

/** Knives stuck at log-relative angles, turned with the log (angle 0 = nearest the thrower). */
function stuckKnives(g: Draw, side: Side, angles: readonly number[], a: number): void {
  for (const phi of angles) {
    g.at(0, 0, -(phi + a), () => g.at(0, TIP, 0, () => knife(g, side)))
  }
}

/** A log's whole picture in red's frame: arrival pop, jolt on a hit, the burst when a stage is cleared. */
export function drawLog(g: Draw, l: Log, side: Side, now: number, dim = 0): void {
  // A cleared log has burst; the next one pops in when the pause ends.
  if (l.burst.length > 0) drawBurst(g, l, side, now - l.clearAt)
  else drawWhole(g, l, side, now, dim)
}

/** The log in one piece. */
function drawWhole(g: Draw, l: Log, side: Side, now: number, dim: number): void {
  const born = now - l.bornAt
  const pop = l.bornAt > 0 ? outBack(clamp(born / 0.4, 0, 1)) : 1
  if (pop <= 0.01) return
  const hit = now - l.hitAt
  const jolt = hit >= 0 && hit < 0.25 ? Math.exp(-hit * 22) * 14 : 0
  const fail = now - l.failAt
  const shake = fail >= 0 && fail < 0.35 ? Math.sin(fail * 70) * 10 * (1 - fail / 0.35) : 0
  const r = LOG.r
  g.shadow(LOG.x + 14, LOG.y + r * 0.62, r * 1.05 * pop, r * 0.36 * pop, 0.5)
  g.at(
    LOG.x + shake,
    LOG.y - jolt,
    0,
    () => {
      logFace(g, side, l.a, r)
      stuckKnives(g, side, l.stuck, l.a)
      if (hit >= 0 && hit < 0.12) {
        g.alpha((1 - hit / 0.12) * 0.3, () => g.circle(0, 0, r * 0.88, '#ffffff'))
      }
      if (fail >= 0 && fail < 0.4) {
        g.alpha((1 - fail / 0.4) * 0.45, () => g.circle(0, 0, r, C.red))
      }
      if (dim > 0) g.alpha(dim * 0.55, () => g.circle(0, 0, r + 4, C.ink))
    },
    pop,
  )
}

/** The log splits into wedges and the knives spin away. `t` is seconds since the clear. */
function drawBurst(g: Draw, l: Log, side: Side, t: number): void {
  const k = outCubic(clamp(t / 0.9, 0, 1))
  const fade = 1 - clamp((t - 0.6) / 0.6, 0, 1)
  if (fade <= 0) return
  const r = LOG.r
  const n = 6
  g.alpha(fade, () => {
    for (let i = 0; i < n; i++) {
      const mid = l.a + ((i + 0.5) / n) * Math.PI * 2
      const dist = k * (170 + (i % 3) * 40)
      const cx = LOG.x + Math.sin(mid) * dist
      const cy = LOG.y + Math.cos(mid) * dist
      g.at(cx, cy, k * (i % 2 ? 1.6 : -1.3), () => {
        g.path(
          (c) => {
            c.moveTo(0, 0)
            c.arc(0, 0, r, Math.PI / 2 - mid - Math.PI / n, Math.PI / 2 - mid + Math.PI / n)
            c.closePath()
          },
          i % 2 ? GRAIN : shade(GRAIN, -0.1),
          BARK,
          10,
        )
      })
    }
    l.burst.forEach((phi, i) => {
      const ang = phi + l.a
      const dist = TIP + k * (170 + (i % 4) * 30)
      const x = LOG.x + Math.sin(ang) * dist
      const y = LOG.y + Math.cos(ang) * dist
      g.at(x, y, -ang + k * (i % 2 ? 7 : -6), () => knife(g, side))
    })
  })
  // The bullseye pops last as a ring of light.
  g.alpha(1 - clamp(t / 0.5, 0, 1), () => g.ring(LOG.x, LOG.y, 40 + k * 260, SIDE[side].light, 14))
}

/** A thrown knife on its way up to the near rim. */
export function drawFlying(g: Draw, f: Flying, side: Side, now: number): void {
  const p = clamp(1 - (f.at - now) / FLY, 0, 1)
  const tipY0 = ORIGIN.y - 70
  const tipY1 = LOG.y + TIP
  const y = tipY0 + (tipY1 - tipY0) * p
  g.alpha(0.35, () => {
    for (let i = 1; i <= 3; i++)
      g.line(
        ORIGIN.x - 6 + i * 3,
        y + 40 + i * 30,
        ORIGIN.x - 6 + i * 3,
        y + 90 + i * 34,
        alpha(C.white, 0.6),
        4,
      )
  })
  g.at(ORIGIN.x, y, 0, () => knife(g, side))
}

/** The knife that clashed: it spins off the log and falls away. `t` is seconds since the clash. */
export function drawBounce(g: Draw, side: Side, t: number, dir: number): void {
  if (t < 0 || t > 0.8) return
  const x = ORIGIN.x + dir * 420 * t
  const y = LOG.y + LOG.r + 30 + 260 * t + 900 * t * t
  g.alpha(1 - t / 0.8, () => g.at(x, y, Math.PI + dir * t * 16, () => knife(g, side, 0.5)))
}

/** The knife waiting in the thrower's hand; it slides in as the throw cools down. */
export function drawReady(g: Draw, side: Side, cool: number, live: boolean, t: number): void {
  if (!live) return
  const k = 1 - clamp(cool / 0.28, 0, 1)
  if (k <= 0) return
  const y = ORIGIN.y - 70 + (1 - outBack(k)) * 70
  if (k >= 1) {
    g.alpha(0.3 + 0.15 * Math.sin(t * 6), () =>
      g.ellipse(ORIGIN.x, ORIGIN.y + 20, 60, 22, C.yellow),
    )
  }
  g.alpha(k, () => g.at(ORIGIN.x, y, 0, () => knife(g, side)))
}

/** The yellow notch on the near rim: where the next knife will land. */
export function drawMarker(g: Draw, ready: boolean, t: number): void {
  const y = LOG.y + LOG.r + 28
  const bob = ready ? Math.sin(t * 6) * 4 : 0
  g.poly(
    [ORIGIN.x - 26, y + 24 + bob, ORIGIN.x + 26, y + 24 + bob, ORIGIN.x, y + bob],
    ready ? C.yellow : alpha(C.yellow, 0.35),
  )
}

/** Knives still to stick this stage, as a column of small knives beside the log. */
export function drawQuiver(g: Draw, side: Side, l: Log): void {
  const need = KNIVES[l.stage - 1] ?? 7
  const used = l.pause > 0 ? need : l.stuck.length
  const x = 92
  const y0 = 1650
  const gap = 36
  for (let i = 0; i < need; i++) {
    const y = y0 - i * gap
    const left = i >= used
    g.at(
      x,
      y,
      Math.PI / 2,
      () => {
        if (left) knife(g, side, 0.6)
        else g.alpha(0.22, () => knife(g, side, 0))
      },
      0.4,
    )
  }
}

export function drawState(g: Draw, s: State, side: Side, now: number): void {
  const l = s.logs[side]
  drawLog(g, l, side, now)
  for (const f of s.flying) if (f.side === side) drawFlying(g, f, side, now)
}
