import { outBack, outBounce, outCubic } from '../../core/fx/ease.ts'
import { frame, frameAngle, inFrame } from '../../core/frame.ts'
import type { Side } from '../../core/game.ts'
import { hudY, namePill } from '../../core/hud.ts'
import type { Draw } from '../../core/render/draw.ts'
import { alpha, C, mix, shade, SIDE } from '../../core/render/palette.ts'
import { MID, W } from '../../core/stage.ts'
import {
  type Bubble,
  BUTTON,
  DROP_EVERY,
  NOZZLES,
  PEG_R,
  PEGS,
  RING_R,
  RINGS,
  type Ring,
  resting,
  SAND_Y,
  seatY,
  TANK,
  type Tank,
  TIP,
} from './rules.ts'

/** Everything the board needs, read from the state alone (the online guest renders only). */
export interface View {
  tanks: [Tank, Tank]
  pumps: [[boolean, boolean], [boolean, boolean]]
  time: number
  /** Seconds left on the clock. */
  remaining: number
  names: [string, string]
  bots: [boolean, boolean]
  over: boolean
  /** Game time the match was decided (-1 while it runs), why, and who won. */
  endAt: number
  endWhy: '' | 'all' | 'time'
  winner: Side | 'draw' | null
  /**
   * Online, a rival's tank would show upside down (its frame is turned for
   * the player across the table): these halves are turned back for this screen.
   */
  turned: [boolean, boolean]
}

/** Toy rings, one colour per ring (never red or blue: those belong to the players). */
const RING_COLORS = ['#ff6fb5', '#3edc8a', '#ff8b3d', '#b07bff', '#c6f24a', '#fff1dc'] as const
export const ringColor = (id: number): string =>
  RING_COLORS[(id - 1) % RING_COLORS.length] ?? C.orange

const WATER_TOP = '#4fd0ff'
const WATER_BOTTOM = '#0b3f86'
const SAND = '#f1d394'
const ROD = '#fff3e0'
const LW = 13

// ---------- rings ----------

/** Half an elliptical torus: `back` is the far half (seen from inside, darker), else the near half. */
function halfRing(
  g: Draw,
  x: number,
  y: number,
  ry: number,
  tilt: number,
  col: string,
  back: boolean,
): void {
  const rx = RING_R - LW / 2
  const [a0, a1] = back ? [Math.PI, Math.PI * 2] : [0, Math.PI]
  const arc = (dy: number, c: string, lw: number) =>
    g.path((p) => p.ellipse(x, y + dy, rx, ry, tilt, a0, a1), undefined, c, lw)
  if (back) {
    arc(0, shade(col, -0.32), LW)
    return
  }
  arc(5, shade(col, -0.45), LW)
  arc(0, col, LW)
  // Gloss along the top of the tube.
  g.path(
    (p) => p.ellipse(x, y - 3, rx, ry, tilt, Math.PI * 0.25, Math.PI * 0.6),
    undefined,
    alpha('#ffffff', 0.7),
    3.5,
  )
}

/** A ring seen side on: `k` is how open it looks (0.3 lying flat, 1 face on). */
function ring(g: Draw, x: number, y: number, col: string, k = 0.32, tilt = 0): void {
  const ry = (RING_R - LW / 2) * k
  halfRing(g, x, y, ry, tilt, col, true)
  halfRing(g, x, y, ry, tilt, col, false)
}

/** Rings tumble as they float: more open while rising fast, flat when they settle. */
function floating(g: Draw, r: Ring, time: number): void {
  const col = ringColor(r.id)
  if (resting(r)) {
    g.shadow(r.x, SAND_Y + 4, RING_R * 0.9, 7, 0.22)
    ring(g, r.x, r.y, col, 0.3)
    return
  }
  const wob = 0.5 + 0.5 * Math.sin(time * 1.9 + r.id * 2.1)
  const k = Math.min(0.95, 0.3 + wob * 0.22 + Math.min(0.4, Math.abs(r.vy) / 420))
  const tilt = Math.max(-0.45, Math.min(0.45, r.vx / 520 + Math.sin(time * 1.3 + r.id) * 0.08))
  ring(g, r.x, r.y, col, k, tilt)
}

function bubble(g: Draw, b: Bubble): void {
  g.circle(b.x, b.y, b.r, alpha('#ffffff', 0.14), alpha('#ffffff', 0.7), 3)
  g.circle(b.x - b.r * 0.35, b.y - b.r * 0.35, b.r * 0.24, alpha('#ffffff', 0.85))
}

// ---------- the tank (red's frame) ----------

/** Pipe from a pump button up to the tank (`out`), then along the sand to its nozzle (`in`). */
function pipe(g: Draw, p: 0 | 1, on: boolean, time: number, side: Side, part: 'out' | 'in'): void {
  const bx = BUTTON.x[p]
  const nx = NOZZLES[p]
  const y = TANK.floor - 14
  const pts: [number, number][] =
    part === 'out'
      ? [
          [bx, BUTTON.y],
          [bx, TANK.floor + 24],
        ]
      : [
          [bx, TANK.floor + 10],
          [bx, y],
          [nx, y],
          [nx, SAND_Y + 4],
        ]
  const team = SIDE[side].main
  const run = (col: string, lw: number) =>
    g.path(
      (c) => {
        c.lineJoin = 'round'
        c.lineCap = 'round'
        c.moveTo(pts[0]![0], pts[0]![1])
        for (const [x, yy] of pts.slice(1)) c.lineTo(x, yy)
      },
      undefined,
      col,
      lw,
    )
  run(shade(team, -0.6), 26)
  run(on ? shade(team, 0.15) : shade(team, -0.25), 14)
  if (on) {
    // Air rushing through the pipe.
    const c = g.ctx
    c.save()
    c.setLineDash([8, 20])
    c.lineDashOffset = -time * 280
    run(alpha('#ffffff', 0.9), 6)
    c.restore()
  }
}

/** The dispenser rail along the rim and the next ring hanging from it, with the time until it drops. */
function dispenser(g: Draw, t: Tank, time: number, side: Side): void {
  const { x0, x1, top } = TANK
  g.rrect(x0 + 20, top + 2, x1 - x0 - 40, 10, 5, shade(SIDE[side].main, -0.55))
  if (t.released >= RINGS) return
  const left = Math.max(0, t.nextAt - time)
  const f = Math.min(1, left / DROP_EVERY)
  const x = t.nextX
  const jig = f < 0.2 ? Math.sin(time * 40) * 3 : 0
  // Clip.
  g.rrect(x - 14, top - 2, 28, 20, 6, shade(C.white, -0.25))
  ring(g, x + jig, top + 30, ringColor(t.nextId), 0.42)
  // Countdown arc on the clip.
  g.arc(x, top + 8, 20, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * (1 - f), alpha(C.yellow, 0.9), 5)
}

/** A peg with its stack: back halves, rod, front halves, so the rod threads the rings. */
function peg(g: Draw, p: 0 | 1, t: Tank, time: number): void {
  const px = PEGS[p]
  const stack = t.stacks[p]
  const since = time - t.landAt[p]
  const n = stack.length
  // The newest ring slides down from the tip.
  const yOf = (i: number) => {
    const seat = seatY(i)
    if (i !== n - 1 || since > 0.45) return seat
    return TIP + (seat - TIP) * outBounce(Math.min(1, since / 0.45))
  }
  g.shadow(px, SAND_Y + 6, 30, 9, 0.3)
  for (let i = 0; i < n; i++) halfRing(g, px, yOf(i), 10, 0, ringColor(stack[i] ?? 1), true)
  // Rod with a lit side.
  g.rrect(px - PEG_R, TIP, PEG_R * 2, SAND_Y - TIP + 6, PEG_R, shade(ROD, -0.18))
  g.rrect(px - PEG_R + 3, TIP, PEG_R * 2 - 9, SAND_Y - TIP, PEG_R, ROD)
  g.rrect(px - PEG_R + 6, TIP + 16, 5, SAND_Y - TIP - 30, 3, alpha('#ffffff', 0.8))
  for (let i = 0; i < n; i++) halfRing(g, px, yOf(i), 10, 0, ringColor(stack[i] ?? 1), false)
  // Yellow tip: the target. It pops when a ring lands.
  const pop = since < 0.4 ? 1 + 0.5 * (1 - outCubic(since / 0.4)) : 1
  const pulse = 0.5 + 0.5 * Math.sin(time * 4 + p)
  g.alpha(0.18 + 0.12 * pulse, () => g.circle(px, TIP, (PEG_R + 14) * pop, C.yellow))
  g.ball(px, TIP, (PEG_R + 4) * pop, C.yellow, 0.8)
}

function tank(
  g: Draw,
  time: number,
  t: Tank,
  pumps: [boolean, boolean],
  side: Side,
  dim: number,
): void {
  const { x0, x1, top, surface, floor } = TANK
  const w = x1 - x0
  const h = floor - top
  const team = SIDE[side].main
  for (const p of [0, 1] as const) pipe(g, p, pumps[p], time, side, 'out')
  // Frame in the team colour.
  g.rrect(x0 - 26, top - 22, w + 52, h + 52, 58, shade(team, -0.62))
  g.rrect(x0 - 22, top - 22, w + 44, h + 44, 56, shade(team, -0.35))
  g.rrect(x0 - 22, top - 22, w + 44, h + 44, 56, undefined, alpha('#ffffff', 0.28), 4)

  g.clip(x0, top, w, h, 36, () => {
    // Air above the water.
    g.rect(x0, top, w, surface - top + 10, shade(team, -0.72))
    // Water.
    g.rect(
      x0,
      surface,
      w,
      floor - surface,
      g.lin(0, surface, 0, floor, [
        [0, WATER_TOP],
        [1, WATER_BOTTOM],
      ]),
    )
    // Light slanting down through the water.
    g.alpha(0.09, () => {
      for (let i = 0; i < 4; i++) {
        const sx = x0 + 100 + i * 190 + Math.sin(time * 0.6 + i) * 26
        g.poly([sx, surface, sx + 70, surface, sx + 170, floor, sx + 100, floor], C.white)
      }
    })
    // Sand, dipping into the two nozzle wells.
    g.path(
      (c) => {
        c.moveTo(x0, floor + 20)
        c.lineTo(x0, SAND_Y - 18)
        c.quadraticCurveTo(x0 + 140, SAND_Y - 14, NOZZLES[0] - 50, SAND_Y - 2)
        c.quadraticCurveTo(NOZZLES[0], SAND_Y + 14, NOZZLES[0] + 50, SAND_Y - 2)
        c.quadraticCurveTo(500, SAND_Y - 20, NOZZLES[1] - 50, SAND_Y - 2)
        c.quadraticCurveTo(NOZZLES[1], SAND_Y + 14, NOZZLES[1] + 50, SAND_Y - 2)
        c.quadraticCurveTo(x1 - 140, SAND_Y - 14, x1, SAND_Y - 18)
        c.lineTo(x1, floor + 20)
        c.closePath()
      },
      g.lin(0, SAND_Y - 20, 0, floor, [
        [0, SAND],
        [1, shade(SAND, -0.25)],
      ]),
    )
    for (let i = 0; i < 8; i++) {
      g.ellipse(x0 + 70 + i * 92, floor - 14 + (i % 2) * 5, 16, 5, shade(SAND, -0.18))
    }
    for (const p of [0, 1] as const) pipe(g, p, pumps[p], time, side, 'in')
    // Nozzle vents in the wells, lit while their pump blows.
    for (const p of [0, 1] as const) {
      const nx = NOZZLES[p]
      g.ellipse(nx, SAND_Y + 6, 30, 10, shade(team, -0.55))
      g.ellipse(nx, SAND_Y + 4, 22, 6, pumps[p] ? C.white : shade(team, -0.2))
    }
    dispenser(g, t, time, side)
    for (const p of [0, 1] as const) peg(g, p, t, time)
    for (const b of t.bubbles) if (b.y < SAND_Y - 4) bubble(g, b)
    for (const r of t.rings) floating(g, r, time)
    // Wavy surface over everything in the water.
    const pts: number[] = [x0 - 10, surface - 40]
    for (let x = x0 - 10; x <= x1 + 10; x += 20) {
      pts.push(x, surface + Math.sin(time * 2.4 + x * 0.02) * 5)
    }
    pts.push(x1 + 10, surface - 40)
    g.path(
      (c) => {
        c.moveTo(pts[2] ?? 0, pts[3] ?? 0)
        for (let i = 4; i < pts.length - 2; i += 2) c.lineTo(pts[i] ?? 0, pts[i + 1] ?? 0)
      },
      undefined,
      alpha('#ffffff', 0.75),
      5,
    )
    // Glass shine.
    g.rrect(x0 + 18, top + 50, 12, h - 140, 6, alpha('#ffffff', 0.16))
    g.rrect(x1 - 34, top + 80, 8, h - 260, 4, alpha('#ffffff', 0.1))
    if (dim > 0) g.alpha(dim, () => g.rect(x0, top, w, h, C.ink))
  })
}

// ---------- controls and HUD (world coordinates) ----------

/** A pump: a big domed button. The curly arrow shows which way its bubbles blow. */
function pumpButton(g: Draw, side: Side, p: 0 | 1, pressed: boolean, time: number): void {
  const col = SIDE[side].main
  const at = frame(side, BUTTON.x[p], BUTTON.y)
  const r = BUTTON.r
  const depth = 14
  const sink = pressed ? depth - 3 : 0
  if (pressed) {
    const pulse = 0.5 + 0.5 * Math.sin(time * 14)
    g.alpha(0.3 + pulse * 0.25, () => g.circle(at.x, at.y + sink, r + 16, col))
  }
  g.circle(at.x, at.y + depth, r, shade(col, -0.5))
  g.circle(
    at.x,
    at.y + sink,
    r,
    g.rad(
      at.x,
      at.y + sink,
      r * 0.1,
      r,
      [
        [0, shade(col, pressed ? 0.45 : 0.3)],
        [0.7, col],
        [1, shade(col, -0.2)],
      ],
      at.x - r * 0.3,
      at.y + sink - r * 0.4,
    ),
  )
  g.alpha(0.5, () =>
    g.ellipse(at.x - r * 0.3, at.y + sink - r * 0.45, r * 0.3, r * 0.16, '#fff', -0.5),
  )
  // The icon is drawn in the tank's frame, so its arrow matches the water on screen.
  g.at(at.x, at.y + sink, frameAngle(side), () => {
    const d = p === 0 ? 1 : -1
    g.circle(-r * 0.32 * d, r * 0.36, r * 0.11, undefined, '#ffffff', 5)
    g.circle(-r * 0.08 * d, r * 0.5, r * 0.07, undefined, '#ffffff', 4)
    g.path(
      (c) => {
        c.moveTo(-r * 0.12 * d, r * 0.22)
        c.quadraticCurveTo(-r * 0.12 * d, -r * 0.3, r * 0.3 * d, -r * 0.3)
      },
      undefined,
      '#ffffff',
      12,
    )
    g.poly([r * 0.26 * d, -r * 0.54, r * 0.56 * d, -r * 0.3, r * 0.26 * d, -r * 0.06], '#ffffff')
  })
}

/** Six ring slots between the pumps: filled in the colours of the rings landed. */
function tally(g: Draw, side: Side, t: Tank, time: number): void {
  const ids = [...t.stacks[0], ...t.stacks[1]]
  const gap = 46
  const y = Math.min(BUTTON.y - 40, hudY(g, 0) - 100)
  const last = Math.max(t.landAt[0], t.landAt[1])
  inFrame(g, side, () => {
    // A recessed track so the score reads as a row of slots, even when empty.
    const tw = (RINGS - 1) * gap + 64
    g.rrect(W / 2 - tw / 2, y - 26, tw, 52, 26, alpha(C.ink, 0.55))
    g.rrect(W / 2 - tw / 2, y - 26, tw, 52, 26, undefined, alpha(SIDE[side].main, 0.35), 3)
    for (let i = 0; i < RINGS; i++) {
      const x = W / 2 - ((RINGS - 1) * gap) / 2 + i * gap
      const id = ids[i]
      if (id === undefined) {
        g.path((c) => c.ellipse(x, y, 17, 9, 0, 0, Math.PI * 2), undefined, alpha(C.white, 0.3), 6)
        continue
      }
      const fresh = i === ids.length - 1 ? time - last : 9
      const s = fresh < 0.35 ? outBack(fresh / 0.35) : 1
      g.at(x, y, 0, () => ring(g, 0, 0, ringColor(id), 0.55), s * 0.75)
    }
  })
}

/** The clock: one copy for one viewer, two (one upside down) for local 2P. */
function timer(g: Draw, seconds: number): void {
  const s = Math.max(0, Math.ceil(seconds))
  const label = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
  const urgent = s <= 10
  const col = urgent ? C.yellow : C.white
  const beat = urgent ? 1 + 0.08 * Math.max(0, Math.cos((seconds % 1) * Math.PI * 2)) : 1
  const one = (angle: number, cy: number) =>
    g.at(
      W / 2,
      cy,
      angle,
      () => {
        g.rrect(-80, -27, 160, 54, 27, alpha(C.ink, 0.88))
        g.rrect(-80, -27, 160, 54, 27, undefined, alpha(col, urgent ? 0.6 : 0.18), 3)
        g.text(label, 0, 2, { size: 40, weight: 700, color: col })
      },
      beat,
    )
  if (g.flipTop) {
    one(0, MID + 32)
    one(Math.PI, MID - 32)
  } else one(g.orient(), MID)
}

/** The ending: a stamp on the winner's tank (all rings landed) or "Time!" across the middle. */
function ending(g: Draw, v: View): void {
  if (v.endAt < 0) return
  const t = v.time - v.endAt
  const s = outBack(Math.min(1, t / 0.4))
  const a = Math.min(1, t * 5)
  const stamp = (side: Side | undefined, x: number, y: number, text: string, color: string) =>
    g.forSide(side, x, y, () =>
      g.alpha(a, () =>
        g.at(
          0,
          0,
          -0.08,
          () => {
            const w = g.measure(text, 72, 700) + 90
            g.rrect(-w / 2, -62, w, 124, 40, shade(color, -0.55))
            g.rrect(-w / 2, -62, w, 124, 40, undefined, color, 8)
            g.text(text, 0, 4, { size: 72, weight: 700, color: C.white, drop: alpha('#000', 0.35) })
          },
          s,
        ),
      ),
    )
  if (v.endWhy === 'all' && v.winner !== null && v.winner !== 'draw') {
    const at = frame(v.winner, W / 2, (TANK.surface + TIP) / 2)
    if (v.turned[v.winner]) at.y = 2 * (v.winner === 0 ? MID + MID / 2 : MID / 2) - at.y
    stamp(v.winner, at.x, at.y, 'All 6!', C.yellow)
  } else if (g.flipTop) {
    stamp(0, W / 2, MID + 180, 'Time!', C.yellow)
    stamp(1, W / 2, MID - 180, 'Time!', C.yellow)
  } else stamp(undefined, W / 2, MID, 'Time!', C.yellow)
}

/** Draw `fn` for `side`, turned about the half's centre when that half is turned (see View). */
function facing(g: Draw, v: View, side: Side, fn: () => void): void {
  if (!v.turned[side]) return fn()
  const cy = side === 0 ? MID + MID / 2 : MID / 2
  g.at(W / 2, cy, Math.PI, () => g.at(-W / 2, -cy, 0, fn))
}

export function drawBoard(g: Draw, v: View): void {
  // Each half is tinted by the colour of the player who owns it, under a floodlight.
  g.halves(shade(C.red, -0.74), shade(C.blue, -0.74))
  for (const side of [0, 1] as Side[]) {
    const c = frame(side, W / 2, 1270)
    g.fillView(
      g.rad(c.x, c.y, 60, 700, [
        [0, alpha(mix(SIDE[side].main, '#ffffff', 0.4), 0.18)],
        [1, alpha(SIDE[side].main, 0)],
      ]),
    )
  }
  g.vignette(0.4)
  for (const side of [0, 1] as Side[]) {
    const lost = v.endAt >= 0 && v.winner !== null && v.winner !== 'draw' && v.winner !== side
    const dim = lost ? Math.min(0.35, (v.time - v.endAt) * 0.8) : 0
    facing(g, v, side, () => {
      inFrame(g, side, () => tank(g, v.time, v.tanks[side], v.pumps[side], side, dim))
      // Online, each phone shows only its own player's pumps.
      if (g.viewer === null || g.viewer === side) {
        pumpButton(g, side, 0, v.pumps[side][0], v.time)
        pumpButton(g, side, 1, v.pumps[side][1], v.time)
      }
      tally(g, side, v.tanks[side], v.time)
    })
  }
  for (const side of [0, 1] as Side[]) {
    const pumping = v.pumps[side][0] || v.pumps[side][1]
    const mine = g.viewer === null || g.viewer === side
    const hint = mine && !v.bots[side] && !v.over && v.time < 7 && !pumping
    namePill(g, side, v.names[side], {
      active: pumping && !v.over,
      ...(hint ? { text: 'Hold the pumps' } : {}),
    })
  }
  timer(g, v.remaining)
  ending(g, v)
}
