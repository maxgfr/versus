import type { Side } from '../../core/game.ts'
import { inQuad, lerp, outBack, outCubic, prog } from '../../core/fx/ease.ts'
import { frame, inFrame, textAngle } from '../../core/frame.ts'
import { banner, hudY, namePill, pips } from '../../core/hud.ts'
import type { Draw, Mood } from '../../core/render/draw.ts'
import { C, SIDE, alpha, mix, shade } from '../../core/render/palette.ts'
import { MID, W } from '../../core/stage.ts'
import { gaugeValue, type GaugeState, type Rounds } from '../../engines/reflex/index.ts'
import {
  FLY,
  LEAD,
  RING_AT,
  puckHeight,
  ringsBell,
  score,
  timeLeft,
  COUNTDOWN,
  type Swing,
} from './rules.ts'
import type { State } from './index.ts'

/*
 * The layout is written once in red's frame (red at the bottom, the tower
 * rising toward the midline) and placed for blue by `inFrame`. Text is turned
 * with `textAngle`, so every word stands upright for the player who reads it.
 * The two bells meet at the middle of the table, mouth to mouth.
 */

/** The strongman's tower: the bell hangs at the top, the puck rests at the foot. */
export const COL = { x: 500, rest: 1530, bellY: 946 }
/** Puck centre at full height: just under the bell's lip. */
export const PUCK_TOP = 1090
export const PUCK_R = 44
/** The gauge the player stops, beside the tower. */
export const GAUGE = { x: 850, y: 1300, h: 440 }
/** The strongman standing beside the foot of the tower. */
export const STRONG = { x: 236, y: 1470, r: 76 }
/** The strike pad at the foot of the tower. */
export const PAD = { x: 500, y: 1590 }
/** The mallet: pivot in the strongman's hands, head on a handle of this length. */
const PIVOT = { x: 320, y: 1478 }
const HANDLE = 206
const A_STRIKE = Math.atan2(PAD.y - 26 - PIVOT.y, PAD.x - PIVOT.x)
const A_REST = -1.75
const A_LOW = -1.45
const A_HIGH = -2.55
/** Seconds of the downswing, and of the recovery after it. */
const SLAM = 0.07
const BACK = 0.55

/** Tower board edges and bulbs. */
const BOARD = { x: COL.x - 78, w: 156, top: 1000, bot: 1572 }
const BULBS = 13
const BULB_Y0 = 1545
const BULB_Y1 = 1040

/** Puck centre (red frame) at height 0..1. */
export const puckY = (h: number): number => COL.rest - h * (COL.rest - PUCK_TOP)

const BRASS = '#f2b630'

/** Run `fn` in `side`'s frame with the tower rocked by `sway` (radians) about its foot. */
function swayed(g: Draw, side: Side, sway: number, fn: () => void): void {
  inFrame(g, side, () => {
    if (Math.abs(sway) < 1e-4) return fn()
    g.at(COL.x, BOARD.bot, sway, () => g.at(-COL.x, -BOARD.bot, 0, fn))
  })
}

/** Reused gauge for the interpolated needle (no allocation per frame). */
const ghost: GaugeState = { t: 0, speed: 1, stopped: null }

/** Needle value of `sw` at `ahead` s past its last step (while it swings). */
function needleAt(sw: Swing, ahead: number): number {
  if (sw.gauge.stopped !== null || ahead === 0) return gaugeValue(sw.gauge)
  ghost.t = Math.max(0, sw.gauge.t + ahead)
  ghost.speed = sw.gauge.speed
  return gaugeValue(ghost)
}

function field(g: Draw, glow: [number, number]): void {
  const v = g.stage.view
  g.fillView(C.ink)
  g.halves(shade(SIDE[0].main, -0.74), shade(SIDE[1].main, -0.74))
  // Floodlight over the bells.
  g.fillView(
    g.rad(W / 2, MID, 40, 900, [
      [0, alpha(C.white, 0.16)],
      [0.5, alpha(C.white, 0.04)],
      [1, alpha(C.white, 0)],
    ]),
  )
  // Mat dots: a little texture so the table does not read as flat.
  for (let y = Math.floor(v.y / 90) * 90; y < v.y + v.h; y += 90) {
    for (let x = Math.floor(v.x / 90) * 90; x < v.x + v.w; x += 90) {
      g.circle(x + 45, y + 45, 3, alpha(C.white, 0.06))
    }
  }
  // A half lights up in its team colour when it wins the round.
  for (const side of [0, 1] as Side[]) {
    if (glow[side] <= 0) continue
    const y0 = side === 0 ? MID : v.y - 2
    const y1 = side === 0 ? v.y + v.h + 2 : MID
    g.alpha(glow[side] * 0.22, () => g.rect(v.x - 2, y0, v.w + 4, y1 - y0, SIDE[side].main))
  }
  g.vignette(0.42)
}

/** Pool of light under each strongman and his tower. */
function stage(g: Draw, side: Side): void {
  inFrame(g, side, () => {
    g.ellipse(
      COL.x - 90,
      1560,
      420,
      150,
      g.rad(COL.x - 90, 1560, 0, 420, [
        [0, alpha(SIDE[side].light, 0.16)],
        [1, alpha(SIDE[side].light, 0)],
      ]),
    )
  })
}

/** The tower board with its marquee bulbs, lit up to `lit` (0..1). `chase` makes them run. */
function tower(g: Draw, side: Side, lit: number, chase: number, now: number, sway: number): void {
  const col = SIDE[side]
  swayed(g, side, sway, () => {
    const { x, w, top, bot } = BOARD
    // Drop shadow and body.
    g.rrect(x + 10, top + 14, w, bot - top, 30, alpha('#000000', 0.35))
    g.rrect(x - 6, top - 6, w + 12, bot - top + 12, 34, shade(col.main, -0.55))
    g.rrect(
      x,
      top,
      w,
      bot - top,
      28,
      g.lin(x, 0, x + w, 0, [
        [0, shade(col.main, -0.25)],
        [0.5, shade(col.main, -0.05)],
        [1, shade(col.main, -0.35)],
      ]),
    )
    // The slot the puck rides in.
    g.rrect(COL.x - 22, top + 50, 44, bot - top - 80, 22, shade(col.main, -0.7))
    g.rrect(COL.x - 22, top + 50, 10, bot - top - 80, 6, alpha('#000000', 0.25))
    // Height ticks across the slot.
    for (let i = 1; i < 4; i++) {
      const y = puckY(i / 4)
      g.line(COL.x - 52, y, COL.x - 32, y, alpha(C.white, 0.35), 6)
      g.line(COL.x + 32, y, COL.x + 52, y, alpha(C.white, 0.35), 6)
    }
    // Bulbs up both edges.
    for (let i = 0; i < BULBS; i++) {
      const k = i / (BULBS - 1)
      const y = lerp(BULB_Y0, BULB_Y1, k)
      const on = k <= lit + 0.001
      const run =
        chase > 0
          ? 0.5 + 0.5 * Math.sin(now * 22 - i * 1.3)
          : i === BULBS - 1
            ? 0.3 + 0.3 * Math.sin(now * 3)
            : 0
      for (const bx of [x + 20, x + w - 20]) {
        if (on || run > 0.5) {
          const c = run > 0.5 ? C.yellow : mix(col.light, C.yellow, k * 0.8)
          g.circle(bx, y, 20, alpha(c, 0.25))
          g.ball(bx, y, 11, c, 0.8)
        } else {
          g.circle(bx, y, 10, shade(col.main, -0.6))
          g.circle(bx - 3, y - 3, 3, alpha(C.white, 0.15))
        }
      }
    }
  })
}

/** The strike pad at the foot of the tower. `press` 0..1 pushes it down. */
function pad(g: Draw, side: Side, press: number): void {
  const p = Math.max(-0.4, Math.min(1.3, press))
  const lit = Math.max(0, Math.min(1, p))
  inFrame(g, side, () => {
    g.shadow(PAD.x, PAD.y + 30, 120 + p * 14, 24, 0.4)
    // Squashed wide and flat when struck, popping back up a touch after.
    const w = 220 * (1 + p * 0.1)
    g.tile(PAD.x - w / 2, PAD.y - 26 + p * 14, w, 58 - p * 14, 18, C.ink4, 14, lit)
    g.rrect(PAD.x - 54, PAD.y - 22 + p * 14, 108, 14, 7, alpha(C.yellow, 0.5 + lit * 0.5))
  })
}

/** The brass bell at the top of the tower. It pivots from its crown and rings with a damped wobble. */
function bell(g: Draw, side: Side, wobble: number, glow: number, sway: number): void {
  swayed(g, side, sway, () => {
    const cx = COL.x
    const cy = COL.bellY + 52
    if (glow > 0) {
      g.alpha(glow, () =>
        g.circle(
          cx,
          cy,
          200,
          g.rad(cx, cy, 0, 200, [
            [0, alpha(C.yellow, 0.9)],
            [1, alpha(C.yellow, 0)],
          ]),
        ),
      )
    }
    // Bracket from the tower to the bell.
    g.rrect(COL.x - 14, COL.bellY - 4, 28, 60, 8, shade(C.line, -0.2))
    g.at(COL.x, COL.bellY + 70, wobble, () => {
      g.circle(0, -70, 14, shade(BRASS, -0.35))
      const shape = (p: CanvasRenderingContext2D) => {
        // The bell hangs from its crown (toward the midline) with its mouth toward the puck.
        p.moveTo(-20, -60)
        p.bezierCurveTo(-20, -84, 20, -84, 20, -60)
        p.bezierCurveTo(42, -48, 66, -24, 70, 34)
        p.quadraticCurveTo(0, 50, -70, 34)
        p.bezierCurveTo(-66, -24, -42, -48, -20, -60)
        p.closePath()
      }
      g.path(
        shape,
        g.lin(-70, 0, 70, 0, [
          [0, shade(BRASS, -0.4)],
          [0.38, shade(BRASS, 0.25)],
          [0.6, BRASS],
          [1, shade(BRASS, -0.45)],
        ]),
        shade(BRASS, -0.62),
        6,
      )
      g.ellipse(0, 36, 70, 14, shade(BRASS, -0.5))
      g.ellipse(-26, -22, 9, 26, alpha('#ffffff', 0.55), 0.3)
      g.circle(Math.sin(wobble * 3) * 16, 44, 14, shade(C.ink, 0.15))
    })
  })
}

/** The puck in its slot, with a speed streak while it flies. */
function puck(
  g: Draw,
  side: Side,
  h: number,
  speed: number,
  land: number,
  leader: boolean,
  now: number,
  sway: number,
): void {
  swayed(g, side, sway, () => {
    const y = puckY(h)
    if (speed > 0.05 && COL.rest - y > 20) {
      const len = Math.min(40 + speed * 260, COL.rest - y)
      g.rrect(
        COL.x - PUCK_R * 0.7,
        y,
        PUCK_R * 1.4,
        len,
        PUCK_R * 0.7,
        g.lin(0, y, 0, y + len, [
          [0, alpha(SIDE[side].light, 0.7)],
          [1, alpha(SIDE[side].light, 0)],
        ]),
      )
    }
    if (leader) {
      const k = 0.5 + 0.5 * Math.sin(now * 10)
      g.ring(COL.x, y, PUCK_R + 16 + k * 6, C.yellow, 9)
    }
    // Stretched along the slot while it flies, squashed for a beat as it stops.
    const sy = 1 + speed * 0.4 - land * 0.28
    const sx = 1 - speed * 0.18 + land * 0.22
    g.at(
      COL.x,
      y,
      0,
      () => {
        g.ball(0, 0, PUCK_R, SIDE[side].main)
        g.ring(0, 0, PUCK_R - 2, alpha(shade(SIDE[side].main, -0.5), 0.6), 4)
      },
      sx,
      sy,
    )
  })
}

/** The landed height as a score tag next to the puck. */
function readout(g: Draw, side: Side, h: number, age: number): void {
  if (age < 0) return
  const pop = outBack(prog(age, 0, 0.3))
  const ring = ringsBell(h)
  inFrame(g, side, () => {
    const x = COL.x + 160
    const y = Math.max(puckY(h), PUCK_TOP + 20)
    g.at(
      x,
      y,
      textAngle(g, side),
      () => {
        const col = ring ? C.yellow : SIDE[side].main
        g.rrect(-74, -40, 148, 80, 40, alpha(C.ink, 0.88))
        g.rrect(-66, -32, 132, 64, 32, shade(col, -0.2))
        g.text(score(h), 0, 3, {
          size: 50,
          weight: 700,
          color: ring ? C.ink : C.white,
        })
      },
      pop,
    )
  })
}

/** The mallet angle at round time `rt`. It rises with the gauge, then slams on the stop. */
function malletAngle(sw: Swing, rt: number, v: number): number {
  // Lead-in: the mallet lifts off its rest toward the swing (anticipation).
  const wind =
    rt < LEAD ? lerp(A_REST, A_LOW, outCubic(prog(rt, LEAD * 0.4, LEAD))) : lerp(A_LOW, A_HIGH, v)
  if (sw.height < 0 || sw.missed) return wind
  const t = rt - sw.stopT
  const from = lerp(A_LOW, A_HIGH, sw.height)
  if (t < SLAM) return lerp(from, A_STRIKE, inQuad(t / SLAM))
  return lerp(A_STRIKE, A_REST, outCubic(prog(t, 0.45, 0.45 + BACK)))
}

function strongman(
  g: Draw,
  side: Side,
  mood: Mood,
  squash: number,
  angle: number,
  jump: number,
  breath: number,
) {
  const col = SIDE[side]
  inFrame(g, side, () => {
    const { x, r } = STRONG
    // The blob turns to face its reader; its feet, shadow and hop follow it.
    const ta = textAngle(g, side)
    const up = ta ? -1 : 1
    const y = STRONG.y - jump * up
    g.shadow(x, STRONG.y + up * r * 0.98, r * (1 - jump / 400), r * 0.26)
    g.blob(x, y, r, col.main, {
      mood,
      angle: ta,
      look: ta ? [-0.6, 0.5] : [0.6, -0.5],
      sx: 1 + squash * 0.14 - breath * 0.02,
      sy: 1 - squash * 0.16 + breath * 0.03,
    })
    // The mallet: wooden handle, a chunky head banded in team colour.
    const px = PIVOT.x
    // The hands ride the hop with the body, whichever way the blob faces.
    const py = PIVOT.y - jump * up + squash * 10
    const hx = px + Math.cos(angle) * HANDLE
    const hy = py + Math.sin(angle) * HANDLE
    g.line(
      px - Math.cos(angle) * 30,
      py - Math.sin(angle) * 30,
      hx,
      hy,
      shade(C.woodDark, -0.3),
      22,
    )
    g.line(px - Math.cos(angle) * 30, py - Math.sin(angle) * 30, hx, hy, C.wood, 13)
    g.at(hx, hy, angle, () => {
      g.rrect(-34, -58, 68, 116, 18, shade(C.woodDark, -0.25))
      g.rrect(
        -30,
        -54,
        60,
        108,
        15,
        g.lin(-30, 0, 30, 0, [
          [0, shade(C.wood, 0.25)],
          [1, shade(C.wood, -0.2)],
        ]),
      )
      g.rect(-30, -40, 60, 16, col.main)
      g.rect(-30, 24, 60, 16, col.main)
      g.rrect(-24, -50, 12, 100, 6, alpha('#ffffff', 0.2))
    })
    g.ball(px, py, 20, shade(col.main, 0.12), 0.6)
    // The lower hand grips below the face, so it never covers an eye (the
    // blob turns upright for the viewer when its player is the computer).
    g.ball(px - 20, py + 30, 18, shade(col.main, 0.05), 0.5)
  })
}

/** The gauge the player stops: a lit tube with the bell zone at the top and a yellow needle. */
function gauge(
  g: Draw,
  side: Side,
  sw: Swing,
  live: boolean,
  rt: number,
  now: number,
  v: number,
  ahead: number,
): void {
  const stopped = sw.height >= 0
  inFrame(g, side, () => {
    const { x, y, h } = GAUGE
    const w = 64
    const top = y - h / 2
    g.rrect(x - w / 2 - 16, top - 16, w + 32, h + 32, 34, alpha('#000000', 0.4))
    g.rrect(x - w / 2 - 12, top - 12, w + 24, h + 24, 30, C.ink2)
    g.rrect(
      x - w / 2,
      top,
      w,
      h,
      22,
      g.lin(0, top + h, 0, top, [
        [0, shade(C.green, -0.3)],
        [0.55, shade(C.yellow, -0.15)],
        [0.85, C.orange],
        [1, C.red],
      ]),
    )
    // The bell zone.
    const zone = h * (1 - RING_AT)
    g.rrect(x - w / 2, top, w, zone + 6, 14, alpha(C.white, 0.55 + 0.3 * Math.sin(now * 8)))
    g.emoji('🔔', x, top - 50, 58, textAngle(g, side) + Math.sin(now * 5) * 0.15)
    // Glass sheen.
    g.rrect(x - w / 2 + 8, top + 10, 12, h - 20, 6, alpha('#ffffff', 0.22))
    // Motion trail behind a swinging needle: fainter the further back.
    if (live && !stopped) {
      for (let i = 3; i >= 1; i--) {
        const gv = needleAt(sw, ahead - i * 0.03)
        const gy = top + h - gv * h
        g.rrect(x - w / 2 - 4, gy - 4, w + 8, 8, 4, alpha(C.yellow, 0.32 - i * 0.08))
      }
    }
    // The needle.
    const ny = top + h - v * h
    const settle = stopped ? Math.max(0, 1 - (rt - sw.stopT) / 0.3) : 0
    const nc = stopped ? C.white : C.yellow
    g.rrect(x - w / 2 - 10, ny - 6, w + 20, 12, 6, alpha(C.ink, 0.6))
    g.rrect(x - w / 2 - 6, ny - 4, w + 12, 8, 4, nc)
    g.poly(
      [x - w / 2 - 52, ny - 22, x - w / 2 - 52, ny + 22, x - w / 2 - 10, ny],
      alpha(C.ink, 0.7),
    )
    g.poly(
      [
        x - w / 2 - 46 - settle * 14,
        ny - 17,
        x - w / 2 - 46 - settle * 14,
        ny + 17,
        x - w / 2 - 14,
        ny,
      ],
      nc,
    )
    if (!live && !stopped) g.rrect(x - w / 2, top, w, h, 22, alpha(C.ink, 0.45))
  })
}

/** "READY" during the lead-in, "TAP!" once the gauge is live. Under the gauge, upright for its player. */
function hint(
  g: Draw,
  side: Side,
  text: string,
  now: number,
  live: boolean,
  urgent: boolean,
): void {
  inFrame(g, side, () => {
    const pulse = live ? 0.5 + 0.5 * Math.sin(now * (urgent ? 18 : 10)) : 0
    g.text(text, GAUGE.x - 10, GAUGE.y + GAUGE.h / 2 + 76, {
      size: 58 + pulse * 8,
      weight: 700,
      color: urgent ? mix(C.yellow, C.red, pulse) : live ? C.yellow : alpha(C.white, 0.75),
      stroke: alpha(C.ink, 0.9),
      strokeWidth: 12,
      angle: textAngle(g, side),
    })
  })
}

/** Mood for the strongman: effort while winding, awe on the bell, grin or sulk at the round's end. */
function moodFor(sw: Swing, rt: number, between: boolean, won: boolean | null): Mood {
  if (between) return won === null ? 'wow' : won ? 'grin' : 'sad'
  if (sw.height < 0) return rt < LEAD ? 'happy' : 'angry'
  if (ringsBell(sw.height) && rt - sw.stopT > FLY) return 'grin'
  return rt - sw.stopT < FLY ? 'wow' : 'happy'
}

/** The round result in each half (clear of the bells at the midline), and "Round N" at the start. */
function roundBanner(g: Draw, r: Rounds, now: number, over: boolean): void {
  if (over) return
  const sides: Side[] = g.flipTop ? [0, 1] : [g.stage.rot ? 1 : 0]
  for (const side of sides) {
    const p = frame(side, W / 2, 1400)
    if (r.phase === 'between' && r.text) {
      const k = outBack(prog(now - r.at, 0.25, 0.55))
      if (k > 0) banner(g, side, r.text, p.y, { size: 52, alpha: Math.min(1, k) })
    } else if (r.phase === 'play' && r.round > 1 && now - r.at < 1.1) {
      const a = 1 - Math.max(0, (now - r.at - 0.7) / 0.4)
      banner(g, side, `Round ${r.round}`, p.y, { size: 60, alpha: a })
    }
  }
}

/** Cosmetic, per-frame inputs from the game: interpolated time and spring values. */
export interface Look {
  /** Game time for this frame (the last step plus `ahead`). */
  now: number
  /** Seconds past the last fixed step (0 during hit-stop). */
  ahead: number
  /** Strike pad press, strongman squash, bell wobble (rad), tower sway, pip pulse 0..1. */
  pad: [number, number]
  body: [number, number]
  bell: [number, number]
  sway: [number, number]
  pulse: [number, number]
}

/** A soft flare on the pip just won, in its player's HUD row. */
function pipPulse(g: Draw, side: Side, wins: number, target: number, k: number): void {
  if (k <= 0.01 || wins <= 0) return
  const x = side === 0 ? W - 170 : 170
  g.forSide(side, x, hudY(g, side), () => {
    const px = target > 5 ? -40 : -((target - 1) * 46) / 2 + (wins - 1) * 46
    g.circle(px, 0, 15 + k * 22, alpha(SIDE[side].light, k * 0.45))
    g.ring(px, 0, 18 + (1 - k) * 30, alpha(C.yellow, k), 5)
  })
}

export function renderHammer(
  g: Draw,
  s: State,
  look: Look,
  o: {
    names: [string, string]
    over: boolean
    winner: Side | 'draw' | null
    bots: [boolean, boolean]
  },
): void {
  const now = look.now
  const r = s.rounds
  const between = r.phase === 'between'
  const rt = now - s.roundAt
  const since = now - r.at
  const won = (side: Side): boolean | null =>
    o.winner !== null
      ? o.winner === 'draw'
        ? null
        : o.winner === side
      : between && r.last !== null && r.last !== 'draw'
        ? r.last === side
        : null
  const glow: [number, number] = [0, 0]
  for (const side of [0, 1] as Side[]) {
    if (won(side))
      glow[side] = o.winner !== null ? 0.6 + 0.4 * Math.sin(now * 8) : 1 - prog(since, 0.2, 1.6)
  }
  field(g, glow)

  // Between rounds the pucks sink back to the foot of the tower.
  const drop = between && !o.over ? 1 - outCubic(prog(since, 0.9, 1.5)) : 1
  const heights = s.swings.map((sw) => puckHeight(sw, rt) * drop) as [number, number]
  // Once both pucks have landed, the higher readout wears a ring until the round is scored.
  const s0 = score(s.swings[0].height)
  const s1 = score(s.swings[1].height)
  const settled = s.settleAt >= 0 && s0 !== s1
  const leader: Side | null = settled && (!between || since < 0.9) ? (s0 > s1 ? 0 : 1) : null
  const live = r.phase === 'play' && rt >= LEAD && !o.over
  const ahead = live ? look.ahead : 0

  for (const side of [0, 1] as Side[]) {
    const sw = s.swings[side]
    const st = sw.height >= 0 ? rt - sw.stopT : -1
    const k = st - FLY
    const ringing = sw.height >= 0 && ringsBell(sw.height) && k >= 0
    const bellGlow = ringing ? Math.max(0, 0.9 - k * 1.2) : 0
    const flying = st >= 0 && st < FLY && !sw.missed
    const speed = flying ? (1 - st / FLY) ** 2 * sw.height : 0
    const land = sw.height > 0 && k >= 0 && k < 0.2 && !between ? 1 - k / 0.2 : 0
    const chase = (ringing && k < 1.4) || (won(side) && (between || o.over)) ? 1 : 0
    const sway = look.sway[side] * 0.012
    // Idle life: the bell sways a touch on its bracket, the strongman breathes.
    const idle = Math.sin(now * 1.4 + side * 2) * 0.03
    stage(g, side)
    tower(g, side, heights[side], chase, now, sway)
    pad(g, side, look.pad[side])
    puck(g, side, heights[side], speed, land, leader === side, now, sway)
    bell(g, side, look.bell[side] + idle, bellGlow, sway)
    if (sw.height >= 0 && !sw.missed && !(between && since > 0.9)) readout(g, side, sw.height, k)
    const w = won(side)
    const jump = w && (between || o.over) ? Math.abs(Math.sin(now * 7)) * 40 : 0
    const breath = Math.sin(now * 2.6 + side * 1.7)
    strongman(
      g,
      side,
      moodFor(sw, rt, between || o.over, w),
      look.body[side],
      malletAngle(sw, rt, needleAt(sw, ahead)),
      jump,
      breath,
    )
  }

  for (const side of [0, 1] as Side[]) {
    const sw = s.swings[side]
    gauge(g, side, sw, live, rt, now, needleAt(sw, ahead), ahead)
    // Online, each phone prompts only its own player; the rival's gauge still shows.
    const mine = g.viewer === null || side === g.viewer
    if (mine && r.phase === 'play' && sw.height < 0 && !o.over && !o.bots[side]) {
      const left = Math.ceil(timeLeft(sw, rt))
      const urgent = live && left <= COUNTDOWN
      hint(g, side, !live ? 'READY' : urgent ? `TAP! ${left}` : 'TAP!', now, live, urgent)
    }
  }

  for (const side of [0, 1] as Side[]) {
    namePill(g, side, o.names[side], {
      x: side === 0 ? 360 : W - 360,
      active: live && s.swings[side].height < 0,
    })
    pips(g, side, r.wins[side], r.target, { x: side === 0 ? W - 170 : 170 })
    pipPulse(g, side, r.wins[side], r.target, look.pulse[side])
  }
  roundBanner(g, r, now, o.over)
}
