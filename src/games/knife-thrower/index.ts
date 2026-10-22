import { floatFor } from '../../core/fx/fx.ts'
import { frame, inFrame } from '../../core/frame.ts'
import { BaseGame, type Difficulty, type MatchSpec, other, type Side } from '../../core/game.ts'
import { banner, hudY, namePill, pips } from '../../core/hud.ts'
import type { Draw } from '../../core/render/draw.ts'
import { C, SIDE } from '../../core/render/palette.ts'
import { W } from '../../core/stage.ts'
import { KnifeBot } from './bot.ts'
import {
  drawBounce,
  drawFlying,
  drawLog,
  drawMarker,
  drawQuiver,
  drawReady,
  drawTable,
} from './render.ts'
import {
  advance,
  CLEAR_PAUSE,
  type Event,
  LIVES,
  LOG,
  newState,
  PATTERNS,
  STAGES,
  type State,
  throwKnife,
} from './rules.ts'

/** Match length: stages to clear, chosen on the ready screen. */
export const match: MatchSpec = { unit: 'rounds', default: STAGES, min: 1, max: 6 }

/** What each stage's spin is called on its title card. */
const STAGE_NAME: Record<string, string> = {
  steady: 'Steady spin',
  flip: 'It flips!',
  wave: 'Wobbly!',
}

class KnifeThrower extends BaseGame<State> {
  private bots: [KnifeBot | null, KnifeBot | null] = [null, null]

  private get target(): number {
    return this.ctx.target || match.default
  }

  protected setup(): State {
    const d: Difficulty = this.ctx.difficulty
    this.bots = [
      this.isBot(0) ? new KnifeBot(0, d) : null,
      this.isBot(1) ? new KnifeBot(1, d) : null,
    ]
    return newState(this.ctx.rng, this.target)
  }

  protected step(dt: number): void {
    const s = this.s
    // Humans: every tap on their half throws a knife into their log.
    for (const side of [0, 1] as Side[]) {
      if (this.isBot(side)) continue
      if (this.ctx.input.player(side).downs.length > 0 && throwKnife(s, side)) this.onThrow(side)
    }
    for (const side of [0, 1] as Side[]) {
      if (this.bots[side]?.step(s, dt, this.ctx.rng)) this.onThrow(side)
    }
    for (const e of advance(s, dt, this.ctx.rng)) this.juice(e)
    if (s.ended && !this.over) {
      const out = s.logs[0].lives <= 0 ? 0 : s.logs[1].lives <= 0 ? 1 : null
      if (s.winner === 'draw') this.ctx.fx.confetti()
      this.finish(s.winner ?? 'draw', {
        score: [...s.cleared] as [number, number],
        // Say whose lives ran out: the score is stages cleared, so a 2–2 needs the reason.
        note:
          out === null
            ? 'All stages cleared'
            : s.logs[0].lives <= 0 && s.logs[1].lives <= 0
              ? 'Both out of lives'
              : `${this.ctx.names[out]} ran out of lives`,
        delay: 2.2,
      })
    }
  }

  /** The ending plays on: the clock runs for the tweens, the loser's log spins down. */
  protected override afterEnd(dt: number): void {
    const s = this.s
    s.now += dt
    if (s.winner === 0 || s.winner === 1) {
      const l = s.logs[other(s.winner)]
      l.a += l.w * dt
      l.w *= 0.97
    }
  }

  /** The world point where a side's knives meet its log's near rim. */
  private contact(side: Side): { x: number; y: number } {
    return frame(side, LOG.x, LOG.y + LOG.r)
  }

  private onThrow(_side: Side): void {
    this.ctx.audio.play('swish', 1.1 + this.ctx.rng.range(0, 0.15))
  }

  private juice(e: Event): void {
    const { fx, audio } = this.ctx
    const s = this.s
    switch (e.kind) {
      case 'stick': {
        const p = this.contact(e.side)
        // The last knives of a stage land harder: the count builds to the clear.
        const k = e.count / e.of
        audio.play('thud', 0.95 + e.count * 0.05)
        audio.play('tick', 1.3 + k * 0.4)
        audio.buzz(Math.round(6 + k * 10))
        fx.burst(p.x, p.y, C.wood, {
          count: 12,
          speed: 380,
          size: 10,
          life: 0.5,
          gravity: 0,
          drag: 3,
          spread: Math.PI * 1.2,
          dir: e.side === 0 ? Math.PI / 2 : -Math.PI / 2,
          kind: 'square',
          colors: [C.wood, '#e2b277', C.woodDark],
        })
        fx.sparks(p.x, p.y, C.white, Math.round(3 + k * 6))
        fx.shake(0.05 + k * 0.08)
        if (e.of - e.count === 1)
          fx.float('1 left!', p.x, frame(e.side, 0, 1520).y, C.yellow, 44, e.side)
        return
      }
      case 'fail': {
        const p = this.contact(e.side)
        audio.play('hit', 1.4)
        audio.play('error', 0.9)
        audio.buzz(60)
        fx.shake(0.4)
        fx.stop(5)
        fx.flash(C.red, 0.18)
        fx.sparks(p.x, p.y, C.yellow, 16)
        fx.ring(p.x, p.y, C.orange, 120)
        floatFor(fx, e.side, e.lives > 0 ? 'Clang! −1 life' : 'Out!', p.x, frame(e.side, 0, 1540).y)
        return
      }
      case 'cleared': {
        const c = frame(e.side, LOG.x, LOG.y)
        audio.play('explode', 1.35)
        audio.play('powerup', 1 + e.stage * 0.08)
        fx.burst(c.x, c.y, C.wood, {
          count: 30,
          speed: 620,
          size: 16,
          life: 0.8,
          gravity: 0,
          drag: 2.4,
          kind: 'square',
          colors: [C.wood, '#e2b277', '#5a3518'],
        })
        fx.burst(c.x, c.y, C.yellow, {
          count: 16,
          speed: 520,
          size: 26,
          life: 0.9,
          gravity: 0,
          drag: 2,
          kind: 'emoji',
          glyph: '⭐',
        })
        fx.ring(c.x, c.y, SIDE[e.side].light, 320)
        fx.flash(SIDE[e.side].main, 0.22)
        fx.shake(0.35)
        fx.stop(4)
        return
      }
      case 'win': {
        // A win by the rival running out of lives still ends with the winner's log bursting.
        const l = s.logs[e.side]
        if (l.burst.length === 0) {
          l.burst = l.stuck.length ? [...l.stuck] : [0]
          l.clearAt = s.now
          const c = frame(e.side, LOG.x, LOG.y)
          audio.play('explode', 1.2)
          fx.burst(c.x, c.y, C.wood, {
            count: 30,
            speed: 620,
            size: 16,
            life: 0.8,
            gravity: 0,
            drag: 2.4,
            kind: 'square',
            colors: [C.wood, '#e2b277', '#5a3518'],
          })
        }
        fx.confetti(e.side)
        fx.shake(0.3)
        return
      }
      case 'out':
        audio.play('lose', 1)
        return
    }
  }

  render(g: Draw, alpha = 1): void {
    const s = this.s
    // Between two steps: the logs keep turning and the knives keep flying smoothly.
    const back = (1 - alpha) / 60
    const now = s.now - (s.ended ? 0 : back)
    const t = this.time
    drawTable(g)
    for (const side of [0, 1] as Side[]) {
      const sl = s.logs[side]
      const l = s.ended ? sl : { ...sl, a: sl.a - sl.w * back }
      const lost = s.ended && s.winner === other(side)
      const live = !s.ended && l.pause === 0 && l.burst.length === 0
      inFrame(g, side, () => {
        drawQuiver(g, side, l)
        drawLog(g, l, side, now, lost ? Math.min(1, (now - Math.max(l.failAt, 0)) * 2) : 0)
        drawMarker(g, live && l.cool === 0, t)
        for (const f of s.flying) if (f.side === side) drawFlying(g, f, side, now)
        drawBounce(g, side, now - l.failAt, Math.floor(l.failAt * 997) % 2 ? 1 : -1)
        drawReady(g, side, l.cool, live, t)
      })
    }
    this.drawHud(g)
    this.drawBanners(g)
  }

  private drawHud(g: Draw): void {
    const s = this.s
    for (const side of [0, 1] as Side[]) {
      const l = s.logs[side]
      namePill(g, side, this.ctx.names[side], {
        active: s.ended && s.winner === side,
        text: `${this.ctx.names[side]} · stage ${Math.min(l.stage, s.target)}`,
      })
      pips(g, side, s.cleared[side], s.target)
      // Lives as hearts, left of the pill; the one just lost cracks.
      const y = hudY(g, side)
      g.forSide(side, side === 0 ? 130 : W - 130, y, () => {
        for (let i = 0; i < LIVES; i++) {
          const x = (i - (LIVES - 1) / 2) * 58
          const since = s.now - l.failAt
          if (i < l.lives) g.emoji('❤️', x, 0, 46)
          else if (i === l.lives && since >= 0 && since < 0.8) {
            const k = 1 + 0.4 * (1 - since / 0.8)
            g.emoji('💔', x + Math.sin(since * 60) * 5 * (1 - since / 0.8), 0, 46 * k)
          } else g.alpha(0.28, () => g.emoji('🤍', x, 0, 40))
        }
      })
    }
  }

  private drawBanners(g: Draw): void {
    const s = this.s
    const now = s.now
    for (const side of [0, 1] as Side[]) {
      const l = s.logs[side]
      const at = (y: number) => frame(side, 0, y).y
      if (s.ended) {
        const end = now - Math.max(l.clearAt, l.failAt, 0)
        if (end < 0.15) continue
        if (s.winner === side) banner(g, side, 'Winner!', at(LOG.y), { size: 80, color: C.yellow })
        else if (s.winner === 'draw')
          banner(g, side, l.lives <= 0 ? 'Both out!' : 'Dead heat!', at(LOG.y), {
            size: 64,
            color: C.yellow,
          })
        else if (s.winner !== null) {
          banner(g, side, l.lives <= 0 ? 'Out of lives' : 'Too slow!', at(LOG.y), {
            size: 56,
            color: C.white,
          })
        }
        continue
      }
      const sinceClear = now - l.clearAt
      if (l.pause > 0 && sinceClear < CLEAR_PAUSE) {
        const k = Math.min(1, sinceClear / 0.15)
        banner(g, side, 'Stage clear!', at(LOG.y), { size: 64 * (0.6 + 0.4 * k), color: C.yellow })
        continue
      }
      const born = now - l.bornAt
      const p = PATTERNS[l.stage - 1]
      const intro = l.stage === 1 ? now < 1.6 : born >= 0 && born < 1.3
      if (intro && p) {
        banner(g, side, `Stage ${l.stage} · ${STAGE_NAME[p.kind] ?? ''}`, at(LOG.y), {
          size: 46,
          alpha: Math.min(1, (l.stage === 1 ? 1.6 - now : 1.3 - born) * 3),
        })
      } else if (
        l.stage === 1 &&
        l.stuck.length === 0 &&
        !this.isBot(side) &&
        now < 9 &&
        // Online, each phone coaches only its own player.
        (g.viewer === null || g.viewer === side)
      ) {
        banner(g, side, 'Tap to throw', at(LOG.y), {
          size: 44,
          alpha: 0.75 + 0.25 * Math.sin(this.time * 4),
        })
      }
    }
  }
}

export default () => new KnifeThrower()
