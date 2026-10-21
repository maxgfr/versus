import type { Side } from '../../core/game.ts'
import { outBack, outCubic, prog } from '../../core/fx/ease.ts'
import type { Draw } from '../../core/render/draw.ts'
import { C, SIDE, alpha, mix, shade } from '../../core/render/palette.ts'
import { hash01, repeatX } from '../../engines/runner/index.ts'
import {
  BASE_Y,
  BIKE_X,
  type Bike,
  CLEAR,
  FLIP,
  frontClearance,
  heightAt,
  metres,
  slopeAt,
  type Terrain,
  WHEEL_R,
  WHEELBASE,
} from './rules.ts'
import { card, chip, countdown, scorePill } from './ui.ts'

type View = { x0: number; y0: number; x1: number; y1: number }

export interface LaneView {
  bike: Bike
  terrain: Terrain
  time: number
  phase: 'ready' | 'run' | 'over' | 'done'
  /** Seconds since the phase began. */
  since: number
  /** Seconds left in the ready beat, and its length. */
  readyLeft: number
  readyT: number
  run: number
  /** Metres of each finished run, this side. */
  history: readonly number[]
  /** The rival's live metres this run. */
  rival: number
  name: string
  bot: boolean
  winner: Side | 'draw' | null
  /** Best of both runs, each side ([this side, rival]). */
  best: readonly [number, number]
  /** Runs each side plays in the match. */
  runs: number
}

const L = WHEELBASE
/** Where cards sit: clear of the rider and the gauge. */
const CARD_X = 610
const CARD_Y = 330

/** Each team rides its own dusk: red at sunset, blue under the moon. */
const SKY: readonly [readonly [string, string, string], readonly [string, string, string]] = [
  ['#1b1433', '#6e2a57', '#ff8a5c'],
  ['#0f0d29', '#1f3f80', '#6fb6f5'],
]

function backdrop(g: Draw, side: Side, v: View, d: number, time: number): void {
  const [top, mid, low] = SKY[side]
  // The sky runs well under the base line: the hills dip below it.
  g.rect(
    v.x0,
    v.y0,
    v.x1 - v.x0,
    BASE_Y + 200 - v.y0,
    g.lin(0, v.y0, 0, BASE_Y - 60, [
      [0, top],
      [0.65, mid],
      [1, low],
    ]),
  )
  // Stars twinkle in the upper sky.
  repeatX(d * 0.02, 170, v.x0, v.x1, (x, i) => {
    const y = v.y0 + 40 + ((i * 71) % 9) * 34
    const tw = 0.5 + 0.5 * Math.sin(time * 2 + i * 1.7)
    g.circle(x + ((i * 37) % 90), y, 2.5 + tw * 2.5, alpha(C.white, 0.2 + 0.5 * tw))
  })
  // Sun (red) or moon (blue), barely moving, haloed.
  const sx = 800 - d * 0.008
  const sy = 300
  g.circle(sx, sy, 150, alpha(SIDE[side].light, 0.1))
  g.circle(sx, sy, 108, alpha(SIDE[side].light, 0.2))
  g.circle(sx, sy, 74, side === 0 ? '#ffd9a0' : '#eef6ff')
  if (side === 1) {
    g.circle(sx - 22, sy - 14, 14, alpha('#b9c9e6', 0.6))
    g.circle(sx + 20, sy + 22, 10, alpha('#b9c9e6', 0.5))
  } else g.alpha(0.5, () => g.ellipse(sx, sy + 30, 90, 8, mid))
  // Far ridge: a silhouette that scrolls slowly.
  const far = mix(SIDE[side].main, top, 0.62)
  repeatX(d * 0.1, 560, v.x0, v.x1, (x, i) => {
    const h = 200 + ((i * 97) % 5) * 34
    g.poly(
      [
        x - 90,
        BASE_Y + 40,
        x + 150,
        BASE_Y - h,
        x + 300,
        BASE_Y - h + 70,
        x + 470,
        BASE_Y - 50,
        x + 570,
        BASE_Y + 40,
      ],
      far,
    )
  })
  // Nearer ridge, a touch lighter, faster.
  const near = mix(SIDE[side].main, mid, 0.55)
  repeatX(d * 0.22, 420, v.x0, v.x1, (x, i) => {
    const h = 110 + ((i * 53) % 4) * 26
    g.poly(
      [x - 60, BASE_Y + 40, x + 140, BASE_Y - h, x + 260, BASE_Y - h + 30, x + 480, BASE_Y + 40],
      near,
    )
  })
}

/** The rolling hill the bike rides: grass over layered dirt, scrolling past, with scenery on top. */
function hills(g: Draw, v: View, d: number, t: Terrain, side: Side): void {
  const x0 = v.x0 - 20
  const x1 = v.x1 + 20
  const ground = (x: number) => BASE_Y - heightAt(t, d + (x - BIKE_X))
  // Scenery behind the track: posts and bushes standing on the hill line.
  repeatX(d, 330, x0, x1, (x, i) => {
    const k = hash01(17, i, 1)
    const gx = x + k * 120
    const gy = ground(gx)
    if (k < 0.4) {
      // A marker post with a reflector.
      g.rrect(gx - 7, gy - 92, 14, 96, 6, '#e9e2f5')
      g.rrect(gx - 7, gy - 92, 14, 22, 6, SIDE[side].main)
    } else {
      const r = 36 + k * 26
      g.circle(gx - r * 0.6, gy - r * 0.35, r * 0.75, shade(C.grass, -0.3))
      g.circle(gx + r * 0.3, gy - r * 0.5, r, shade(C.grass, -0.2))
      g.circle(gx + r * 0.1, gy - r * 0.7, r * 0.45, alpha(C.white, 0.1))
    }
  })
  const pts: number[] = []
  for (let x = x0; x <= x1; x += 12) pts.push(x, ground(x))
  const body = g.lin(0, BASE_Y - 80, 0, v.y1, [
    [0, '#a06d43'],
    [0.45, '#73482a'],
    [1, '#3b2214'],
  ])
  g.poly([...pts, x1, v.y1 + 20, x0, v.y1 + 20], body)
  // A darker band of soil follows the surface.
  const band: number[] = []
  for (let i = 0; i < pts.length; i += 2) band.push(pts[i] ?? 0, (pts[i + 1] ?? 0) + 70)
  g.ctx.save()
  g.ctx.beginPath()
  for (let i = 0; i < band.length; i += 2) {
    if (i === 0) g.ctx.moveTo(band[i] ?? 0, band[i + 1] ?? 0)
    else g.ctx.lineTo(band[i] ?? 0, band[i + 1] ?? 0)
  }
  g.ctx.strokeStyle = alpha('#2a160b', 0.25)
  g.ctx.lineWidth = 26
  g.ctx.stroke()
  g.ctx.restore()
  // Rocks scroll with the ground, so the speed reads.
  repeatX(d, 150, v.x0, v.x1, (x, i) => {
    const y = BASE_Y + 90 + ((i * 37) % 4) * 52
    const rx = x + ((i * 53) % 60)
    g.ellipse(rx, y + 4, 20 + ((i * 13) % 3) * 6, 9, alpha('#1e0f07', 0.4))
    g.ellipse(rx, y, 18 + ((i * 13) % 3) * 6, 9, alpha('#c79466', 0.35))
  })
  // Grass lip: dark under, bright on top, a highlight line.
  const trace = (dy: number) => {
    const c = g.ctx
    c.beginPath()
    for (let i = 0; i < pts.length; i += 2) {
      if (i === 0) c.moveTo(pts[i] ?? 0, (pts[i + 1] ?? 0) + dy)
      else c.lineTo(pts[i] ?? 0, (pts[i + 1] ?? 0) + dy)
    }
    c.lineJoin = 'round'
    c.lineCap = 'round'
  }
  const c = g.ctx
  c.save()
  trace(6)
  c.strokeStyle = C.grassDark
  c.lineWidth = 36
  c.stroke()
  trace(0)
  c.strokeStyle = C.grass
  c.lineWidth = 24
  c.stroke()
  trace(-8)
  c.strokeStyle = alpha('#c8ffb0', 0.45)
  c.lineWidth = 5
  c.stroke()
  c.restore()
}

function wheel(g: Draw, side: Side, x: number, y: number, spin: number): void {
  const r = WHEEL_R
  g.circle(x, y, r, '#17121f')
  // Knobbly tread.
  for (let k = 0; k < 12; k++) {
    const a = spin + (k * Math.PI) / 6
    g.circle(x + Math.cos(a) * (r - 2), y + Math.sin(a) * (r - 2), 6, '#2b2437')
  }
  g.circle(x, y, r * 0.66, shade(SIDE[side].main, -0.15))
  g.circle(x, y, r * 0.56, '#dcd8ea')
  for (let k = 0; k < 5; k++) {
    const a = spin + (k * Math.PI * 2) / 5
    g.line(x, y, x + Math.cos(a) * r * 0.54, y + Math.sin(a) * r * 0.54, '#8f86b3', 5)
  }
  g.circle(x, y, 11, SIDE[side].main)
  g.circle(x - 3, y - 3, 4, alpha(C.white, 0.8))
}

/** Exhaust puffs trailing from the pipe while the throttle is down. */
function exhaust(g: Draw, time: number, hard: boolean): void {
  for (let i = 0; i < 5; i++) {
    const k = (time * (hard ? 3.2 : 2) + i / 5) % 1
    g.circle(
      -40 - k * 170,
      -40 - k * 60 - Math.sin(k * 6 + i) * 8,
      12 + k * 30,
      alpha(C.white, 0.4 * (1 - k)),
    )
  }
}

/** The machine, in its own frame: rear axle at the origin, front axle at (L, 0), up is -y. */
function machine(g: Draw, side: Side, b: Bike, time: number, thr: boolean): void {
  const col = SIDE[side].main
  const dark = shade(col, -0.4)
  // Exhaust pipe and swing arm.
  g.line(-26, -36, 70, -46, '#a9a3bf', 12)
  g.line(-26, -36, -4, -38, '#6d6688', 14)
  g.line(0, 0, 86, -48, '#2a2338', 15)
  // Engine block with fins.
  g.rrect(52, -92, 86, 56, 14, '#3a3350')
  for (let k = 0; k < 4; k++) g.rect(60 + k * 19, -86, 9, 44, alpha('#000000', 0.25))
  g.rrect(56, -90, 78, 10, 5, alpha(C.white, 0.16))
  // Fork: chrome tubes from the front axle to the bars.
  g.line(L, 0, L - 34, -138, '#2a2338', 18)
  g.line(L - 3, -4, L - 34, -134, '#c9c4dc', 9)
  // Body: tank, side panel and tail in the team colour.
  g.path(
    (p) => {
      p.moveTo(-34, -96)
      p.lineTo(40, -112)
      p.bezierCurveTo(70, -150, 140, -150, 160, -122)
      p.lineTo(150, -94)
      p.lineTo(46, -86)
      p.lineTo(-10, -78)
      p.closePath()
    },
    g.lin(0, -150, 0, -80, [
      [0, shade(col, 0.25)],
      [0.5, col],
      [1, dark],
    ]),
    shade(col, -0.55),
    4,
  )
  g.alpha(0.55, () => g.ellipse(100, -132, 34, 8, '#fff', -0.12))
  g.sideMark(side, 100, -106, 13, C.white)
  // Seat.
  g.rrect(-28, -122, 86, 22, 11, '#1d1730')
  g.rrect(-22, -120, 70, 6, 3, alpha(C.white, 0.15))
  // Fenders over both wheels.
  g.arc(0, 0, WHEEL_R + 10, Math.PI * 1.08, Math.PI * 1.62, col, 10)
  g.arc(L, 0, WHEEL_R + 10, Math.PI * 1.25, Math.PI * 1.8, col, 10)
  // Headlight and bars.
  g.circle(L - 18, -118, 17, '#2a2338')
  g.circle(L - 16, -118, 12, thr ? C.yellow : '#fff3c4')
  if (thr) g.circle(L - 16, -118, 26 + Math.sin(time * 30) * 2, alpha(C.yellow, 0.25))
  g.line(L - 36, -140, L - 70, -152, '#2a2338', 10)
  g.rrect(L - 80, -160, 22, 16, 6, '#1d1730')
  // Wheels last.
  wheel(g, side, 0, 0, b.spin)
  wheel(g, side, L, 0, b.spin)
}

/** The rider, sat on the bike. Leans back while wheelieing. */
function rider(
  g: Draw,
  side: Side,
  b: Bike,
  time: number,
  mood: 'happy' | 'wow' | 'sad' | 'dizzy' | 'grin',
  lean: number,
): void {
  const col = SIDE[side].main
  const suit = shade(col, -0.25)
  const sway = b.thr && !b.end ? Math.sin(time * 16) * 2 : 0
  const hip = { x: 30, y: -128 }
  const sh = { x: 30 + 36 * Math.cos(1.2 + lean), y: -128 - 66 * Math.sin(1.2 + lean) + sway }
  // Leg: hip → knee → peg.
  g.line(hip.x, hip.y, 104, -108, shade(suit, -0.25), 24)
  g.line(104, -108, 78, -62, shade(suit, -0.25), 20)
  g.rrect(66, -66, 34, 16, 7, '#1d1730')
  // Torso.
  g.line(hip.x, hip.y, sh.x, sh.y, suit, 40)
  g.alpha(0.3, () => g.line(hip.x + 6, hip.y - 10, sh.x + 6, sh.y + 6, '#fff', 8))
  // Arm to the bars.
  g.line(sh.x, sh.y + 8, L - 74, -152, suit, 16)
  g.circle(L - 72, -152, 10, '#1d1730')
  // Head in a helmet: a blob with a visor band.
  const hx = sh.x + 8
  const hy = sh.y - 44
  g.blob(hx, hy, 38, col, {
    mood,
    look: [0.9, 0.1],
    cheeks: true,
    sx: b.thr ? 0.95 : 1,
    sy: b.thr ? 1.05 : 1,
  })
  g.arc(hx, hy, 40, Math.PI * 1.08, Math.PI * 1.92, shade(col, -0.35), 9)
  g.rrect(hx - 26, hy - 52, 30, 10, 5, alpha(C.white, 0.35))
}

function bikeAt(g: Draw, side: Side, b: Bike, t: Terrain, o: LaneView): void {
  const h = heightAt(t, b.d)
  const groundY = BASE_Y - h
  const since = b.endT >= 0 ? o.time - b.endT : 0
  let ax = BIKE_X
  let ay = groundY - WHEEL_R - b.y
  let pitch = b.phi
  let riderOff = { x: 0, y: 0, a: 0 }
  let mood: 'happy' | 'wow' | 'sad' | 'dizzy' | 'grin' = b.thr ? 'wow' : 'happy'
  if (b.started && !b.end && frontClearance(t, b) > CLEAR * 4 && b.thr) mood = 'grin'
  if (b.end === 'flipped') {
    // Over it goes: the bike rolls onto its back, the rider is thrown off behind.
    const k = outCubic(prog(since, 0, 0.7))
    pitch = b.phi + (Math.PI - 0.3 - b.phi) * k
    // Upside down, the bike rests on its seat and bars: lift the axle by the frame's height.
    ax = BIKE_X + L * 0.85 * k
    ay = groundY - WHEEL_R - b.y * (1 - k) - 88 * k - 60 * Math.sin(k * Math.PI)
    const ft = Math.min(since, 0.9)
    riderOff = { x: -320 * ft, y: -420 * ft + 900 * ft * ft, a: -since * 9 }
    mood = 'dizzy'
  } else if (b.end === 'dropped') {
    // The front slams down and bounces once.
    const k = prog(since, 0, 0.5)
    pitch = slopeAt(t, b.d) - 0.08 * Math.sin(k * Math.PI * 2) * (1 - k)
    mood = 'sad'
  } else if (b.end === 'capped') mood = 'grin'
  // Contact shadow on the ground.
  g.shadow(BIKE_X + L / 2, groundY + 8, 150 * Math.max(0.5, 1 - b.y / 300), 14, 0.35)
  const lean = Math.max(0, pitch - slopeAt(t, b.d)) * 0.3
  if (b.thr && !b.end) g.at(ax, ay, -pitch, () => exhaust(g, o.time, lean > 0.2))
  g.at(ax, ay, -pitch, () => {
    machine(g, side, b, o.time, b.thr && !b.end)
    if (b.end !== 'flipped') rider(g, side, b, o.time, mood, lean)
  })
  if (b.end === 'flipped') {
    // The thrown rider tumbles, never below the ground.
    const rx = BIKE_X + 40 + riderOff.x
    const gy = BASE_Y - heightAt(t, b.d + (rx - BIKE_X))
    const ry = Math.min(gy - 40, groundY - 220 + riderOff.y)
    g.shadow(rx, gy + 6, 40, 10, 0.3)
    g.at(rx, ry, riderOff.a, () => {
      g.blob(0, 0, 40, SIDE[side].main, { mood: 'dizzy', cheeks: true })
      g.arc(0, 0, 42, Math.PI * 1.08, Math.PI * 1.92, shade(SIDE[side].main, -0.35), 9)
    })
    if (since > 0.6) {
      // Stars circle the dazed rider.
      for (let k = 0; k < 3; k++) {
        const a = o.time * 4 + (k * Math.PI * 2) / 3
        g.star(rx + Math.cos(a) * 54, ry - 58 + Math.sin(a) * 14, 14, C.yellow, 5, 0.45, a)
      }
    }
  }
}

/** Wheelie balance: green is the sweet band, red is the flip. The bike's mark slides along it. */
function gauge(g: Draw, side: Side, w: number, live: boolean, time: number): void {
  const x0 = 300
  const len = 400
  const y = 172
  const wMin = -0.05
  const wMax = FLIP + 0.08
  const xOf = (a: number) => x0 + ((Math.max(wMin, Math.min(wMax, a)) - wMin) / (wMax - wMin)) * len
  g.rrect(x0 - 20, y - 30, len + 40, 60, 30, alpha(C.ink, 0.82))
  g.rrect(x0, y - 12, len, 24, 12, alpha(C.white, 0.12))
  g.rrect(xOf(0.15), y - 12, xOf(0.95) - xOf(0.15), 24, 12, alpha(C.green, 0.85))
  const danger = live && w > FLIP - 0.3
  const pulse = danger ? 0.7 + 0.3 * Math.sin(time * 24) : 0.85
  g.rrect(xOf(FLIP - 0.25), y - 12, xOf(wMax) - xOf(FLIP - 0.25), 24, 12, alpha(C.red, pulse))
  if (live) {
    const x = xOf(w)
    g.circle(x, y + 4, 22, alpha('#000000', 0.35))
    g.circle(x, y, 22, C.white)
    g.sideMark(side, x, y, 11, SIDE[side].main)
  }
}

/**
 * Run pips: filled once a run is banked, ringed in yellow for the run in play.
 * A longer row starts further left, so it stays clear of the metres pill.
 */
function runPips(g: Draw, side: Side, run: number, done: number, runs: number): void {
  const x0 = Math.min(185, 330 - (runs - 1) * 54)
  for (let i = 0; i < runs; i++) {
    const x = x0 + i * 54
    const y = 74
    const on = i < done
    g.circle(x, y + 4, 20, alpha('#000000', 0.3))
    g.circle(x, y, 20, on ? SIDE[side].main : alpha(C.ink, 0.7))
    if (on) g.circle(x - 6, y - 6, 6, alpha(C.white, 0.6))
    else if (i === run) g.ring(x, y, 22, C.yellow, 5)
    else g.ring(x, y, 19, alpha(C.white, 0.4), 4)
  }
}

export function drawLane(g: Draw, side: Side, v: View, o: LaneView): void {
  const b = o.bike
  backdrop(g, side, v, b.d, o.time)
  hills(g, v, b.d, o.terrain, side)
  bikeAt(g, side, b, o.terrain, o)

  // HUD row: runs, this run's metres, the rival's live metres.
  const m = metres(b.wheelie)
  const pop = b.wheelie > 900 ? 1 - prog((b.wheelie % 1000) / Math.max(1, b.v), 0, 0.25) : 0
  runPips(g, side, o.run, o.history.length, o.runs)
  scorePill(g, side, String(m), 'm', 500, 74, b.end ? 0 : Math.max(0, pop))
  const rs = (1 - side) as Side
  g.at(800, 74, 0, () => {
    const label = `${o.rival}`
    const w = g.measure(label, 40, 700) + 86
    g.rrect(-w / 2, -32, w, 64, 32, alpha(C.ink, 0.72))
    g.sideMark(rs, -w / 2 + 30, 0, 11, SIDE[rs].main)
    g.text(label, -w / 2 + 52, 3, { size: 40, weight: 700, align: 'left', color: SIDE[rs].light })
  })
  gauge(g, side, b.phi - slopeAt(o.terrain, b.d), o.phase === 'run' && !b.end, o.time)

  if (o.phase === 'ready') {
    if (o.run === 0) {
      // The shell has just counted 3-2-1: a short beat to read the one rule.
      card(
        g,
        side,
        o.bot ? 'Ready…' : 'Hold to wheelie',
        o.bot ? o.name : 'Let go before you flip!',
        CARD_Y,
        o.since,
        {
          x: CARD_X,
        },
      )
    } else
      countdown(
        g,
        side,
        o.readyLeft,
        o.readyT,
        `Run ${o.run + 1} of ${o.runs}`,
        CARD_Y - 30,
        CARD_X,
      )
  } else if (o.phase === 'run') {
    if (b.end) {
      const since = o.time - b.endT
      const label = b.end === 'flipped' ? 'Flipped!' : b.end === 'dropped' ? 'Front down!' : 'Time!'
      card(g, side, label, `${m} m`, CARD_Y, since - 0.35, {
        x: CARD_X,
        color: b.end === 'capped' ? C.yellow : C.white,
      })
    } else if (!b.started && !o.bot && o.since > 1.2) {
      // Nobody has lifted the front yet: point at the bike.
      g.emoji('👆', BIKE_X + 150, BASE_Y - 330 + Math.sin(o.time * 8) * 14, 96)
      chip(g, 'Hold anywhere on your half', CARD_X, CARD_Y - 40, { size: 38 })
    }
  } else if (o.phase === 'over') {
    const last = o.history[o.history.length - 1] ?? 0
    const best = Math.max(...o.history)
    const sub = o.history.length > 1 ? `Best ${best} m` : `Run ${o.run + 1} of ${o.runs}`
    card(g, side, `${last} m`, sub, CARD_Y, o.since, {
      x: CARD_X,
      color: last === best ? C.yellow : C.white,
    })
  } else if (o.phase === 'done' && o.winner !== null) {
    const won = o.winner === side
    const draw = o.winner === 'draw'
    const gap = Math.abs(o.best[0] - o.best[1])
    card(
      g,
      side,
      draw ? 'Dead heat!' : won ? (o.bot ? 'Computer wins!' : 'You win!') : 'Beaten!',
      draw ? `${o.best[0]} m each` : won ? `Best ${o.best[0]} m · by ${gap} m` : `${gap} m short`,
      CARD_Y,
      o.since,
      { x: CARD_X, color: won ? C.yellow : C.white, accent: won ? C.yellow : SIDE[side].main },
    )
    if (won) {
      const s = outBack(prog(o.since, 0.25, 0.6))
      g.emoji('🏆', CARD_X, CARD_Y - 170, 96 * s)
    }
  }
}
