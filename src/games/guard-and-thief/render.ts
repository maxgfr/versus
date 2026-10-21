import { namePill } from '../../core/hud.ts'
import type { Side } from '../../core/game.ts'
import type { Draw } from '../../core/render/draw.ts'
import { alpha, C, SIDE, shade } from '../../core/render/palette.ts'
import { clamp, outBack, outCubic } from '../../core/fx/ease.ts'
import { type ControlLook, drawStrip, solidAt, solidCell } from '../../engines/arena/index.ts'
import { MID, W } from '../../core/stage.ts'
import type { State } from './index.ts'
import {
  GUARD_R,
  hidden,
  inShadow,
  type Level,
  type Loot,
  type Pawn,
  ROUND_T,
  THIEF_R,
  VIS,
  VIS_A,
  type World,
} from './rules.ts'

const LOOT_GLYPHS = ['🏺', '💎', '🖼️', '👑', '🗿']
const STONE = '#6d6585'

/** Red's HUD rows below the museum; blue's are the same turned about the centre. */
const ROW = { loot: 1556, clock: 1644 }
const SCORE = { x: 66, y: 1560 }

/** A point of red's layout, placed for `side` (blue's mirrors it through the centre). */
const at = (side: Side, x: number, y: number): [number, number] =>
  side === 0 ? [x, y] : [W - x, 1800 - y]

function floor(g: Draw, lv: Level, now: number): void {
  const gr = lv.grid
  const s = gr.cell
  g.fillView('#120e1c')
  drawStrip(g, gr.y0, gr.y0 + gr.rows * s)
  for (let r = 0; r < gr.rows; r++)
    for (let c = 0; c < gr.cols; c++) {
      if (solidCell(gr, c, r)) continue
      const x = gr.x0 + c * s
      const y = gr.y0 + r * s
      // Gallery parquet: warm boards, every other tile turned.
      const base = (r + c) % 2 === 0 ? '#3a3157' : '#342c4f'
      g.rect(x, y, s, s, base)
      for (let k = 1; k < 4; k++) {
        if ((r + c) % 2 === 0) g.rect(x + 4, y + k * 25 - 1, s - 8, 2, alpha('#000000', 0.16))
        else g.rect(x + k * 25 - 1, y + 4, 2, s - 8, alpha('#000000', 0.16))
      }
      g.rect(x + 3, y + 3, s - 6, 3, alpha(C.white, 0.05))
    }
  // Team ends of the gallery, faint.
  g.rect(
    gr.x0,
    gr.y0,
    gr.cols * s,
    gr.rows * s,
    g.lin(0, gr.y0, 0, gr.y0 + gr.rows * s, [
      [0, alpha(C.blue, 0.12)],
      [0.5, alpha(C.blue, 0)],
      [0.5, alpha(C.red, 0)],
      [1, alpha(C.red, 0.12)],
    ]),
  )
  // Shadows: dark pools where the thief can hide.
  for (let r = 0; r < gr.rows; r++)
    for (let c = 0; c < gr.cols; c++) {
      if (lv.shadow[r * gr.cols + c] !== 1) continue
      const x = gr.x0 + c * s + s / 2
      const y = gr.y0 + r * s + s / 2
      g.circle(
        x,
        y,
        s * 0.82,
        g.rad(x, y, 0, s * 0.82, [
          [0, 'rgba(6,4,14,0.95)'],
          [0.6, 'rgba(8,5,18,0.8)'],
          [1, 'rgba(8,5,18,0)'],
        ]),
      )
      // A few drifting motes, so a shadow reads as a place, not a hole.
      for (let i = 0; i < 3; i++) {
        const a = now * 0.7 + i * 2.1 + c
        g.circle(x + Math.cos(a) * 22, y + Math.sin(a * 1.3) * 18, 3, alpha('#9d6bff', 0.35))
      }
    }
}

/** Stone wall blocks with contact shadows and a gilded top edge. */
function walls(g: Draw, lv: Level): void {
  const gr = lv.grid
  const s = gr.cell
  for (let r = 0; r < gr.rows; r++)
    for (let c = 0; c < gr.cols; c++) {
      if (!solidCell(gr, c, r)) continue
      g.rect(gr.x0 + c * s + 8, gr.y0 + r * s + 14, s, s, alpha('#000000', 0.3))
    }
  for (let r = 0; r < gr.rows; r++)
    for (let c = 0; c < gr.cols; c++) {
      if (!solidCell(gr, c, r)) continue
      const x = gr.x0 + c * s
      const y = gr.y0 + r * s
      g.tile(x + 2, y - 8, s - 4, s + 6, 16, STONE, 14)
      g.rrect(x + 14, y + 6, s - 28, 7, 3, alpha(C.yellow, 0.35))
      g.rect(x + 22, y + 26, s - 44, 3, alpha('#000000', 0.12))
      g.rect(x + 22, y + 48, s - 44, 3, alpha('#000000', 0.12))
    }
  // Gold trim round the whole gallery.
  const w = gr.cols * s
  const h = gr.rows * s
  g.rrect(gr.x0 - 6, gr.y0 - 14, w + 12, h + 22, 14, undefined, alpha(C.yellow, 0.45), 6)
}

/** The guard's lantern: rays stop at walls, so the cone shows what is really seen. */
function cone(g: Draw, lv: Level, guard: Pawn, spotted: boolean, side: Side): void {
  const pts: number[] = [guard.x, guard.y]
  const n = 28
  for (let i = 0; i <= n; i++) {
    const a = guard.a - VIS_A + (2 * VIS_A * i) / n
    let x = guard.x
    let y = guard.y
    for (let d = 8; d <= VIS; d += 8) {
      const nx = guard.x + Math.cos(a) * d
      const ny = guard.y + Math.sin(a) * d
      if (solidAt(lv.grid, nx, ny)) break
      x = nx
      y = ny
    }
    pts.push(x, y)
  }
  const col = spotted ? C.yellow : SIDE[side].light
  const fill = g.rad(guard.x, guard.y, 10, VIS, [
    [0, alpha(col, spotted ? 0.5 : 0.34)],
    [1, alpha(col, spotted ? 0.12 : 0.04)],
  ])
  g.poly(pts, fill, alpha(col, spotted ? 0.85 : 0.35), 4)
}

/** A low marble plinth; it stays (empty) once its piece is stolen. */
function plinth(g: Draw, l: Loot): void {
  const empty = l.got >= 0
  g.shadow(l.x + 4, l.y + 30, 34, 11, 0.3)
  g.ellipse(l.x, l.y + 24, 32, 13, shade('#a9a1c4', -0.4))
  g.ellipse(l.x, l.y + 18, 32, 13, empty ? '#6f6890' : '#c4bddb')
  if (empty) g.ellipse(l.x, l.y + 18, 18, 6, alpha('#000000', 0.25))
}

/** A loot item on its plinth; once taken it flies to the thief's tally. */
function loot(g: Draw, l: Loot, i: number, now: number, wt: number, to: [number, number]): void {
  const glyph = LOOT_GLYPHS[i % LOOT_GLYPHS.length] ?? '💎'
  if (l.got >= 0) {
    const k = clamp((wt - l.got) / 0.55, 0, 1)
    if (k >= 1) return
    const e = outCubic(k)
    const x = l.x + (to[0] - l.x) * e
    const y = l.y + (to[1] - l.y) * e - Math.sin(k * Math.PI) * 140
    g.emoji(glyph, x, y, 80 - 30 * e)
    return
  }
  const p = 0.5 + 0.5 * Math.sin(now * 4.5 + i * 1.3)
  g.ring(l.x, l.y + 2, 46 + p * 8, alpha(C.yellow, 0.18 + p * 0.25), 5)
  g.emoji(glyph, l.x, l.y - 6 - p * 4, 74)
}

function actor(g: Draw, p: Pawn, side: Side, isThief: boolean, now: number, hide: boolean): void {
  const col = SIDE[side]
  const r = isThief ? THIEF_R : GUARD_R
  const bob = Math.sin(p.walk * 0.09) * 2.5
  const squash = 1 + Math.sin(p.walk * 0.18) * 0.04
  const look: [number, number] = [Math.cos(p.a), Math.sin(p.a)]
  if (hide) {
    // In the dark only two eyes glint.
    const blink = Math.sin(now * 2.3) > 0.94 ? 0.15 : 1
    g.alpha(0.22, () => g.blob(p.x, p.y, r * 1.25, col.main, { mood: 'grin', look }))
    for (const sx of [-1, 1]) {
      g.ellipse(p.x + sx * r * 0.45, p.y - r * 0.15, r * 0.22, r * 0.2 * blink, C.yellow)
      g.circle(p.x + sx * r * 0.45 + look[0] * 3, p.y - r * 0.15 + look[1] * 3, 3, C.ink)
    }
    g.ring(p.x, p.y, r * 1.7 + Math.sin(now * 6) * 3, alpha(C.white, 0.3), 3)
    return
  }
  g.shadow(p.x + 6, p.y + 14, r * 1.15, r * 0.6, 0.38)
  if (isThief) {
    g.blob(p.x, p.y + bob, r * 1.25, col.main, {
      mood: 'grin',
      look,
      sx: squash,
      sy: 1 / squash,
    })
    // Thief's mask across the eyes, with eye holes.
    g.rrect(p.x - r * 1.02, p.y + bob - r * 0.42, r * 2.04, r * 0.5, r * 0.22, C.ink)
    for (const sx of [-1, 1]) {
      g.circle(p.x + sx * r * 0.45, p.y + bob - r * 0.17, r * 0.2, '#fff')
      g.circle(p.x + sx * r * 0.45 + look[0] * 3, p.y + bob - r * 0.17 + look[1] * 3, 4, C.ink)
    }
  } else {
    g.blob(p.x, p.y + bob, r * 1.2, col.main, {
      mood: 'angry',
      look,
      sx: squash,
      sy: 1 / squash,
    })
    // Guard's cap with a peak and a gold badge.
    const cy = p.y + bob - r * 1.0
    g.rrect(p.x - r * 1.0, cy - r * 0.38, r * 2.0, r * 0.62, r * 0.28, shade(col.main, -0.55))
    g.rrect(p.x - r * 1.18, cy + r * 0.16, r * 2.36, r * 0.18, r * 0.09, shade(col.main, -0.7))
    g.star(p.x, cy - r * 0.06, r * 0.22, C.yellow)
  }
  // Side mark above the head, upright for its player.
  g.forSide(side, p.x, p.y + bob, () => g.sideMark(side, 0, -r * 2.15, 10, col.light))
}

function clock(g: Draw, remaining: number, side: Side, live: boolean): void {
  const sec = Math.max(0, Math.ceil(remaining))
  const label = `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`
  const urgent = live && sec <= 10
  const [x, y] = at(side, W / 2, ROW.clock)
  const pulse = urgent ? 1 + 0.06 * Math.sin(remaining * Math.PI * 2) : 1
  g.forSide(side, x, y, () =>
    g.at(
      0,
      0,
      0,
      () => {
        g.rrect(-96, -36, 192, 72, 26, alpha(C.ink, 0.85))
        g.text(label, 0, 3, { size: 50, weight: 700, color: urgent ? C.yellow : C.white })
      },
      pulse,
    ),
  )
}

/** Where loot item `i` sits in a side's tally row (world space). */
function slot(g: Draw, side: Side, i: number, n: number): [number, number] {
  const [x, y] = at(side, W / 2, ROW.loot)
  const off = (i - (n - 1) / 2) * 62
  const a = g.orient(side)
  return [x + Math.cos(a) * off, y + Math.sin(a) * off]
}

/** Loot tally for a side: what is left to steal; stolen pieces light up for the thief. */
function lootRow(g: Draw, side: Side, w: World): void {
  const [x, y] = at(side, W / 2, ROW.loot)
  const n = w.loot.length
  const thief = side === w.thief
  g.forSide(side, x, y, () => {
    g.rrect(-n * 33, -34, n * 66, 68, 34, alpha(C.ink, 0.6))
    w.loot.forEach((l, i) => {
      const lx = (i - (n - 1) / 2) * 62
      const got = l.got >= 0 && w.t - l.got > 0.55
      if (got && thief) g.circle(lx, 0, 30, alpha(C.yellow, 0.3))
      g.alpha(got ? (thief ? 1 : 0.28) : thief ? 0.35 : 0.9, () =>
        g.emoji(LOOT_GLYPHS[i % LOOT_GLYPHS.length] ?? '💎', lx, 0, 48),
      )
    })
  })
}

function score(g: Draw, side: Side, wins: number): void {
  const [x, y] = at(side, SCORE.x, SCORE.y)
  g.forSide(side, x, y, () => {
    g.disc(0, 0, 44, shade(SIDE[side].main, -0.35), 7)
    g.text(wins, 0, 2, { size: 56, weight: 700, color: C.white, drop: alpha('#000000', 0.35) })
  })
}

function pad(
  g: Draw,
  c: ControlLook,
  glyph: string,
  usable: boolean,
  glow: boolean,
  now: number,
): void {
  const col = SIDE[c.side]
  g.alpha(c.on ? 0.95 : 0.6, () => {
    g.circle(c.bx, c.by, c.r, alpha(col.dark, 0.5), alpha(col.light, 0.55), 5)
    g.ball(c.kx, c.ky, c.r * 0.46, col.main, 0.6)
  })
  const ready = usable && c.ready >= 1
  const face = ready || c.ready < 1 ? col.main : shade(col.main, -0.45)
  if (ready && glow) {
    const p = 0.5 + 0.5 * Math.sin(now * 7)
    g.circle(c.fx, c.fy, c.fr + 14 + p * 6, alpha(C.yellow, 0.2))
    g.ring(c.fx, c.fy, c.fr + 10, C.yellow, 6)
  }
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
  if (c.ready < 1)
    g.arc(
      c.fx,
      c.fy + p,
      c.fr + 10,
      -Math.PI / 2,
      -Math.PI / 2 + Math.PI * 2 * c.ready,
      alpha(C.white, 0.7),
      7,
    )
  g.alpha(usable ? 1 : 0.45, () =>
    g.forSide(c.side, c.fx, c.fy + p, () => g.emoji(glyph, 0, 0, c.fr * 1.1)),
  )
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

export function renderGuard(
  g: Draw,
  s: State,
  lv: Level,
  names: [string, string],
  now: number,
  over: boolean,
): void {
  const w = s.w
  const guardSide: Side = w.thief === 0 ? 1 : 0
  const guard = w.pawns[guardSide]
  const thief = w.pawns[w.thief]
  floor(g, lv, now)
  cone(g, lv, guard, w.t - guard.seen < 0.35, guardSide)
  walls(g, lv)
  for (const l of w.loot) plinth(g, l)
  w.loot.forEach((l, i) => {
    if (l.got < 0) loot(g, l, i, now, w.t, [0, 0])
  })
  const hide = hidden(w, w.thief)
  actor(g, guard, guardSide, false, now, false)
  actor(g, thief, w.thief, true, now, hide)
  // Stolen pieces fly over everything to the thief's tally.
  w.loot.forEach((l, i) => {
    if (l.got >= 0) loot(g, l, i, now, w.t, slot(g, w.thief, i, w.loot.length))
  })
  const canHide = s.phase === 'play' && !hide && inShadow(lv, thief.x, thief.y)
  for (const c of s.ctl)
    pad(
      g,
      c,
      c.side === w.thief ? '👻' : '💨',
      c.side === w.thief ? canHide : true,
      c.side === w.thief,
      now,
    )
  for (const side of [0, 1] as Side[]) {
    const role = side === w.thief ? 'Thief' : 'Guard'
    namePill(g, side, names[side], {
      text: `${names[side]} · ${role}`,
      active: s.phase === 'play' && side === w.thief,
    })
    clock(g, ROUND_T - w.t, side, s.phase === 'play')
    lootRow(g, side, w)
    score(g, side, s.score.wins[side])
  }
  if (s.phase === 'between' || over) {
    const won = w.won
    const title =
      won === w.thief ? 'Heist!' : w.winT >= ROUND_T ? 'Time!' : won === null ? '' : 'Caught!'
    const col = won === null ? C.white : SIDE[won].light
    const sub = over && won !== null ? `${names[won]} wins the match` : s.text
    if (title) stamp(g, title, sub, now - s.at - (title === 'Caught!' ? 0.3 : 0), col)
    return
  }
  if (now - s.at < 1.9) {
    const a = 1 - clamp((now - s.at - 1.5) / 0.4, 0, 1)
    g.alpha(a, () =>
      stamp(
        g,
        `${names[w.thief]} steals`,
        `Grab all ${w.loot.length} before the guard does`,
        now - s.at,
        SIDE[w.thief].light,
      ),
    )
  }
}
