import type { Side } from '../../core/game.ts'
import { frame, inFrame, textAngle } from '../../core/frame.ts'
import { outBack, outCubic, prog } from '../../core/fx/ease.ts'
import { banner, namePill, pips } from '../../core/hud.ts'
import type { Draw } from '../../core/render/draw.ts'
import { C, SIDE, alpha, mix, shade } from '../../core/render/palette.ts'
import { MID, W } from '../../core/stage.ts'
import type { Rounds } from '../../engines/reflex/index.ts'
import { canThrow, heatOf, LIMIT_B, LIMIT_R, speedOf, type Potato } from './rules.ts'
import type { State } from './index.ts'

/*
 * A dark kitchen table with a stone lane down the middle. Each player's oven
 * mitt waits at their catch point. The potato is drawn upright for whoever
 * holds it, and gets redder, faster and more panicked as it heats up.
 */

const CATCH_Y = LIMIT_R

function field(g: Draw, glow: [number, number]): void {
  const v = g.stage.view
  g.fillView(C.ink)
  g.halves(shade(SIDE[0].main, -0.76), shade(SIDE[1].main, -0.76))
  // Kitchen tiles, barely there.
  const t = 120
  for (let y = Math.floor(v.y / t) * t; y < v.y + v.h; y += t) {
    g.rect(v.x - 2, y, v.w + 4, 4, alpha('#000000', 0.25))
  }
  for (let x = Math.floor(v.x / t) * t; x < v.x + v.w; x += t) {
    g.rect(x, v.y - 2, 4, v.h + 4, alpha('#000000', 0.25))
  }
  for (const side of [0, 1] as Side[]) {
    if (glow[side] <= 0) continue
    const y0 = side === 0 ? MID : v.y - 2
    const y1 = side === 0 ? v.y + v.h + 2 : MID
    g.alpha(glow[side] * 0.25, () => g.rect(v.x - 2, y0, v.w + 4, y1 - y0, SIDE[side].main))
  }
  g.fillView(
    g.rad(W / 2, MID, 60, 900, [
      [0, alpha('#ffd9a8', 0.14)],
      [1, alpha('#ffd9a8', 0)],
    ]),
  )
  g.vignette(0.45)
}

/** The lane the potato travels: a stone groove with each team's catch zone at its end. */
function lane(g: Draw, heat: number): void {
  const top = LIMIT_B - 130
  const bot = LIMIT_R + 130
  g.rrect(W / 2 - 104, top + 14, 208, bot - top, 104, alpha('#000000', 0.4))
  g.rrect(W / 2 - 100, top, 200, bot - top, 100, C.ink3)
  g.rrect(
    W / 2 - 84,
    top + 16,
    168,
    bot - top - 32,
    84,
    g.lin(W / 2 - 84, 0, W / 2 + 84, 0, [
      [0, shade(C.ink2, -0.2)],
      [0.5, C.ink2],
      [1, shade(C.ink2, -0.3)],
    ]),
  )
  // The groove warms up with the potato.
  if (heat > 0)
    g.alpha(heat * 0.35, () =>
      g.rrect(W / 2 - 84, top + 16, 168, bot - top - 32, 84, alpha(C.orange, 0.5)),
    )
  for (const side of [0, 1] as Side[]) {
    const y = side === 0 ? LIMIT_R : LIMIT_B
    g.circle(W / 2, y, 96, alpha(SIDE[side].main, 0.22))
    g.ring(W / 2, y, 96, alpha(SIDE[side].main, 0.6), 6)
  }
  g.dashed(W / 2, LIMIT_B + 110, W / 2, LIMIT_R - 110, alpha(C.white, 0.14), 6, [20, 22])
  g.rect(W / 2 - 100, MID - 4, 200, 8, alpha(C.white, 0.3))
}

/** An oven mitt at a player's catch point, in their frame. */
function mitt(
  g: Draw,
  side: Side,
  o: { ready: boolean; squash: number; soot: number; wave: number; now: number },
): void {
  const col = SIDE[side].main
  inFrame(g, side, () => {
    const x = W / 2 + 30
    const y = CATCH_Y + 140
    if (o.ready) {
      const k = 0.5 + 0.5 * Math.sin(o.now * 10)
      g.alpha(0.6 + k * 0.4, () => g.ring(W / 2, CATCH_Y, 112 + k * 12, C.yellow, 12))
    }
    g.shadow(x + 10, y + 110, 110, 28, 0.45)
    g.at(
      x,
      y,
      -0.12 + o.wave,
      () => {
        const fill = mix(col, '#2a2020', o.soot * 0.7)
        const mittShape = (p: CanvasRenderingContext2D) => {
          // Palm and fingers as one rounded lobe, thumb to the left, cuff at the bottom.
          p.moveTo(-80, 90)
          p.lineTo(-84, 0)
          p.bezierCurveTo(-130, -6, -150, -70, -112, -88)
          p.bezierCurveTo(-90, -98, -74, -70, -70, -50)
          p.bezierCurveTo(-74, -130, -40, -150, 0, -150)
          p.bezierCurveTo(56, -150, 86, -120, 84, -40)
          p.lineTo(80, 90)
          p.closePath()
        }
        g.path(mittShape, C.ink, C.ink, 16)
        g.path(
          mittShape,
          g.lin(-90, 0, 90, 0, [
            [0, shade(fill, 0.15)],
            [0.6, fill],
            [1, shade(fill, -0.3)],
          ]),
        )
        // Quilting.
        g.ctx.save()
        g.path(mittShape)
        g.ctx.clip()
        for (let i = -4; i <= 4; i++) {
          g.line(i * 40 - 120, -160, i * 40 + 120, 100, alpha('#000000', 0.12), 4)
          g.line(i * 40 + 120, -160, i * 40 - 120, 100, alpha('#000000', 0.12), 4)
        }
        g.ctx.restore()
        g.ellipse(-30, -100, 34, 18, alpha('#ffffff', 0.3), -0.3)
        // Cuff.
        g.rrect(-96, 70, 192, 64, 22, C.ink)
        g.rrect(-90, 76, 180, 52, 18, C.cream)
        g.rect(-90, 94, 180, 14, shade(col, -0.1))
        if (o.soot > 0) {
          g.alpha(o.soot, () => {
            g.circle(-20, -60, 40, alpha('#000000', 0.45))
            g.circle(30, -20, 30, alpha('#000000', 0.35))
          })
        }
      },
      0.9 * (1 + o.squash * 0.1),
      0.9 * (1 - o.squash * 0.12),
    )
  })
}

/** The potato, upright for the player who holds it. */
function potato(g: Draw, pot: Potato, now: number, squash: number, flying: boolean): void {
  const heat = heatOf(pot.throws)
  const x = W / 2
  const y = pot.y
  // Speed ghosts behind it while it flies.
  if (flying) {
    const v = speedOf(pot.throws)
    for (let i = 3; i >= 1; i--) {
      const gy = y - pot.dir * v * 0.028 * i
      g.circle(x, gy, 66 - i * 10, alpha(mix(C.orange, C.red, heat), 0.16 * (4 - i) * (0.4 + heat)))
    }
  }
  // Heat glow, pulsing faster the hotter it gets.
  const pulse = 0.7 + 0.3 * Math.sin(now * (5 + 16 * heat))
  const glowCol = mix(C.yellow, C.red, heat)
  g.alpha(0.25 + 0.6 * heat * pulse, () =>
    g.circle(
      x,
      y,
      190,
      g.rad(x, y, 20, 190, [
        [0, glowCol],
        [1, alpha(glowCol, 0)],
      ]),
    ),
  )
  // Flames licking around it once it is really hot.
  if (heat > 0.45) {
    const n = 7
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + now * 2
      const f = 0.5 + 0.5 * Math.sin(now * 20 + i * 1.7)
      const r0 = 74
      const r1 = 100 + f * 40 * heat
      const bx = x + Math.cos(a) * r0
      const by = y + Math.sin(a) * r0 * 1.1
      g.poly(
        [
          bx + Math.cos(a + 1.4) * 18,
          by + Math.sin(a + 1.4) * 18,
          x + Math.cos(a) * r1,
          y + Math.sin(a) * r1 * 1.1,
          bx + Math.cos(a - 1.4) * 18,
          by + Math.sin(a - 1.4) * 18,
        ],
        alpha(i % 2 ? C.orange : C.yellow, 0.85),
      )
    }
  }
  const angle = g.orient(pot.holder)
  const shake = Math.sin(now * (14 + 30 * heat)) * (0.6 + heat * 2) * 2
  g.at(
    x + shake,
    y,
    angle,
    () => {
      const skin = mix('#b07a40', '#d4552f', heat * 0.8)
      g.ellipse(6, 16, 80, 96, alpha('#000000', 0.3))
      g.ellipse(0, 0, 78, 94, C.ink)
      g.ellipse(
        0,
        0,
        71,
        87,
        g.rad(-22, -30, 10, 100, [
          [0, shade(skin, 0.35)],
          [0.6, skin],
          [1, shade(skin, -0.45)],
        ]),
      )
      for (const [dx, dy, r] of [
        [-30, 36, 5],
        [28, 44, 4],
        [42, 6, 5],
        [-44, -6, 4],
        [8, -54, 4],
      ] as const) {
        g.circle(dx, dy, r, alpha('#4a2c14', 0.45))
      }
      g.ellipse(-26, -46, 20, 12, alpha('#ffffff', 0.35), -0.5)
      // Face: calm, then worried, then panicking.
      const look = heat > 0.5 ? Math.sin(now * 12) * 0.5 : 0
      for (const sx of [-1, 1]) {
        g.circle(sx * 25, -12, 17 + heat * 3, '#ffffff', alpha(C.ink, 0.6), 3)
        g.circle(sx * 25 + look * 6, -12, 7.5 - heat * 2, C.ink)
        g.circle(sx * 25 + look * 6 + 2.5, -15, 2.5, '#ffffff')
        if (heat > 0.25) g.line(sx * 12, -40, sx * 38, -34 - heat * 10, C.ink, 5)
      }
      if (heat > 0.6) {
        g.ellipse(0, 36, 16, 20, C.ink)
        g.ellipse(0, 44, 9, 7, '#ff6b8a')
      } else if (heat > 0.25) {
        g.path(
          (c) => {
            c.moveTo(-16, 36)
            c.quadraticCurveTo(-8, 28, 0, 36)
            c.quadraticCurveTo(8, 44, 16, 36)
          },
          undefined,
          C.ink,
          5,
        )
      } else {
        g.path(
          (c) => {
            c.moveTo(-14, 30)
            c.quadraticCurveTo(0, 42, 14, 30)
          },
          undefined,
          C.ink,
          5,
        )
      }
      // Sweat drops.
      if (heat > 0.3) {
        const d = (now * 1.6) % 1
        g.alpha(1 - d, () => g.ellipse(52, -40 + d * 40, 7, 10, '#8fd8ff'))
        g.alpha(1 - ((d + 0.5) % 1), () =>
          g.ellipse(-56, -30 + ((d + 0.5) % 1) * 40, 6, 9, '#8fd8ff'),
        )
      }
    },
    1 + squash * 0.2,
    1 - squash * 0.16,
  )
}

/** Steam wisps rising off a hot potato (pure function of time). */
function steam(g: Draw, y: number, heat: number, now: number): void {
  if (heat <= 0.1) return
  for (let i = 0; i < 4; i++) {
    const t = (now * 0.9 + i / 4) % 1
    const x = W / 2 + Math.sin(now * 3 + i * 2) * 30 + (i - 1.5) * 26
    g.alpha((1 - t) * heat * 0.5, () => g.circle(x, y - 80 - t * 120, 16 + t * 26, '#ffffff'))
  }
}

/** The blast: a smoke cloud and a scorch mark where the potato was. */
function blast(g: Draw, y: number, boomed: number, now: number): void {
  const t = now - boomed
  const k = prog(t, 0, 1.4)
  // Scorch mark stays.
  g.ellipse(W / 2, y, 150, 120, alpha('#000000', 0.45 * (1 - prog(t, 1.4, 2.2))))
  // Fireball, then smoke.
  const fb = 1 - prog(t, 0, 0.35)
  if (fb > 0) {
    g.alpha(fb, () =>
      g.circle(
        W / 2,
        y,
        120 + (1 - fb) * 160,
        g.rad(W / 2, y, 0, 280, [
          [0, '#fff3c4'],
          [0.4, C.yellow],
          [0.7, C.orange],
          [1, alpha(C.red, 0)],
        ]),
      ),
    )
  }
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + 0.4
    const r = 50 + outCubic(k) * 150
    g.alpha(0.75 * (1 - k), () =>
      g.circle(
        W / 2 + Math.cos(a) * r * 0.8,
        y + Math.sin(a) * r * 0.6 - k * 60,
        44 + k * 70,
        i % 2 ? '#3a2a20' : '#4d3a2c',
      ),
    )
  }
}

/** "TAP!" next to the mitt for the player who may throw now, upright for them. */
function prompt(g: Draw, side: Side, now: number): void {
  inFrame(g, side, () => {
    const pulse = 0.5 + 0.5 * Math.sin(now * 12)
    g.text('TAP!', W / 2 - 240, CATCH_Y - 20, {
      size: 84 + pulse * 10,
      weight: 700,
      color: C.yellow,
      stroke: alpha(C.ink, 0.9),
      strokeWidth: 16,
      angle: textAngle(g, side),
    })
  })
}

/** The round result in each half (clear of the lane's middle), and "Round N" at the start. */
function roundBanner(g: Draw, r: Rounds, now: number, over: boolean): void {
  if (over) return
  const sides: Side[] = g.flipTop ? [0, 1] : [g.stage.rot ? 1 : 0]
  for (const side of sides) {
    const p = frame(side, W / 2, MID + 260)
    if (r.phase === 'between' && r.text) {
      const k = outBack(prog(now - r.at, 0.5, 0.8))
      if (k > 0) banner(g, side, r.text, p.y, { size: 52, alpha: Math.min(1, k) })
    } else if (r.phase === 'play' && now - r.at < 1.4) {
      const a = 1 - Math.max(0, (now - r.at - 1) / 0.4)
      banner(g, side, r.round > 1 ? `Round ${r.round}` : 'Hot potato!', p.y, { size: 60, alpha: a })
    }
  }
}

export function renderPotato(
  g: Draw,
  s: State,
  now: number,
  o: { names: [string, string]; over: boolean; bots: [boolean, boolean] },
): void {
  const pot = s.pot
  const exploded = s.boomed >= 0
  const heat = exploded ? 0 : heatOf(pot.throws)
  const loser: Side | null = exploded ? (pot.y > MID ? 0 : 1) : null
  const glow: [number, number] = [0, 0]
  if (s.winner !== null) glow[s.winner] = 0.55 + 0.45 * Math.sin(now * 8)
  else if (loser !== null) glow[loser === 0 ? 1 : 0] = 1 - prog(now - s.boomed, 0.3, 1.6)
  field(g, glow)
  const ready = (side: Side) => !exploded && s.rounds.phase === 'play' && canThrow(pot, side, now)
  lane(g, heat)
  for (const side of [0, 1] as Side[]) {
    const thrown =
      s.thrower === side && s.throwAt >= 0 ? Math.max(0, 1 - (now - s.throwAt) / 0.2) : 0
    const caught =
      pot.held && pot.holder === side && !exploded ? Math.max(0, 1 - (now - s.landAt) / 0.2) : 0
    mitt(g, side, {
      ready: ready(side),
      squash: Math.max(thrown, caught),
      soot: loser === side ? 1 - prog(now - s.boomed, 1.6, 2.2) : 0,
      wave: s.winner === side ? Math.sin(now * 10) * 0.25 : 0,
      now,
    })
  }
  if (exploded) blast(g, pot.y, s.boomed, now)
  else if (s.rounds.phase === 'play') {
    steam(g, pot.y, heat, now)
    const sq = Math.max(
      s.throwAt >= 0 ? Math.max(0, 1 - (now - s.throwAt) / 0.14) : 0,
      pot.held ? Math.max(0, 1 - (now - s.landAt) / 0.16) : 0,
    )
    potato(g, pot, now, sq, !pot.held)
  }
  if (!o.over) {
    for (const side of [0, 1] as Side[]) if (ready(side) && !o.bots[side]) prompt(g, side, now)
  }
  for (const side of [0, 1] as Side[]) {
    namePill(g, side, o.names[side], { active: ready(side), x: side === 0 ? 270 : W - 270 })
    pips(g, side, s.rounds.wins[side], s.rounds.target, { x: side === 0 ? W - 170 : 170 })
  }
  roundBanner(g, s.rounds, now, o.over)
}
