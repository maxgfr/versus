import { frame, toLocal } from '../../core/frame.ts'
import { floatFor } from '../../core/fx/fx.ts'
import { BaseGame, type MatchSpec, type OptionSpec, type Side, STEP } from '../../core/game.ts'
import type { Draw } from '../../core/render/draw.ts'
import { C, SIDE } from '../../core/render/palette.ts'
import { tapRipple } from '../../engines/reflex/index.ts'
import { onDone, renderFreestyle, type Look, VOTE, voteAt, Y } from './render.ts'
import {
  advance,
  barAt,
  battleNew,
  beatAt,
  canVote,
  type Change,
  done,
  rapper,
  sixteenthAt,
  type State,
  type Verdict,
  wordIndex,
} from './rules.ts'
import { type Lang, THEME_IDS, THEMES } from './words.ts'

/** Verses each. */
export const match: MatchSpec = { unit: 'rounds', default: 2, min: 1, max: 4 }

export const options: OptionSpec[] = [
  {
    id: 'lang',
    label: 'Language',
    choices: [
      ['en', 'English'],
      ['fr', 'Français'],
    ],
    default: 'en',
  },
  {
    id: 'words',
    label: 'Imposed words',
    choices: [
      ['on', 'On'],
      ['off', 'Off'],
    ],
    default: 'on',
  },
  {
    id: 'theme',
    label: 'Theme',
    choices: [
      ['none', 'No theme'],
      ['random', 'Random'],
      ...THEME_IDS.map((id): [string, string] => [id, `${THEMES[id]?.en} · ${THEMES[id]?.fr}`]),
    ],
    default: 'none',
    wrap: true,
  },
]

/** Seconds a computer judge takes to make up its mind. */
const BOT_JUDGE = 1

class Freestyle extends BaseGame<State> {
  /** Last sixteenth note played (sound only, not synced). */
  private tick = -1
  private look: Look = { names: ['', ''], solo: false }

  protected setup(): State {
    const { ctx } = this
    const o = ctx.options ?? {}
    // 1P has no computer rival here: it is solo practice for red.
    this.look = { names: ctx.names, solo: ctx.mode === '1p' && !ctx.bots[1] }
    return battleNew(
      ctx.rng,
      {
        lang: (o.lang === 'fr' ? 'fr' : 'en') as Lang,
        words: o.words !== 'off',
        theme: o.theme ?? 'none',
      },
      ctx.target || match.default,
      this.look.solo,
    )
  }

  protected step(_dt: number): void {
    const s = this.s
    const { ctx } = this
    const t = this.time
    const bar = barAt(t)
    const word = wordIndex(s, bar)
    const change = advance(s, bar, t, this.look.solo)
    if (change) this.juice(change)
    else if (word !== wordIndex(s, barAt(t - STEP)) && word > 0) this.newWord()
    const n = sixteenthAt(t)
    if (n !== this.tick) {
      this.tick = n
      for (const [name, pitch] of beatAt(n, s.phase)) ctx.audio.play(name, pitch)
    }
    if (this.over) return
    if (s.phase === 'verdict' && !this.look.solo && (ctx.bots[0] || ctx.bots[1])) {
      if (t >= s.askedAt + BOT_JUDGE) this.verdict(ctx.rng.pick<Verdict>([0, 1, 'draw']))
      return
    }
    for (const side of [0, 1] as Side[]) {
      if (ctx.bots[side]) continue
      for (const p of ctx.input.player(side).downs) {
        const at = toLocal(side, p.x, p.y)
        if (s.phase === 'verse' && rapper(s) === side && onDone(at.x, at.y)) {
          if (done(s, side, bar)) {
            ctx.audio.play('swish')
            ctx.fx.ring(p.x, p.y, SIDE[side].light, 140)
          } else ctx.audio.play('tap', 0.8)
          continue
        }
        if (s.phase === 'verdict' && canVote(s, t)) {
          const v = voteAt(at.x, at.y)
          if (v !== null) {
            this.verdict(v)
            return
          }
        }
        tapRipple(ctx, side, p.x, p.y)
      }
    }
  }

  /** The bar ticked over into a new phase. */
  private juice(change: Change): void {
    const { fx, audio } = this.ctx
    const s = this.s
    if (change === 'verse') {
      const side = rapper(s) ?? 0
      audio.play('whoosh', 1.1)
      audio.buzz(20)
      fx.flash(SIDE[side].light, 0.18)
      const at = frame(side, 500, Y.mic)
      fx.ring(at.x, at.y, SIDE[side].light, 220)
      if ((s.words[s.verse] ?? []).length) this.newWord()
    } else if (change === 'switch') {
      audio.play('whoosh', 0.8)
    } else if (change === 'verdict') {
      audio.play('buzz', 0.8)
      audio.buzz(40)
      fx.flash(C.white, 0.3)
      fx.shake(0.25)
    } else if (change === 'over') {
      fx.flash(C.white, 0.3)
      this.finish(0, { note: `${s.bars} bars freestyled`, delay: 1.6 })
    }
  }

  /** A fresh imposed word lands on the rapper's half. */
  private newWord(): void {
    const side = rapper(this.s)
    if (side === null) return
    const at = frame(side, 500, Y.word)
    this.ctx.audio.play('pop', 1.1)
    this.ctx.fx.ring(at.x, at.y, C.yellow, 260)
    this.ctx.fx.burst(at.x, at.y, C.yellow, {
      count: 10,
      speed: 420,
      size: 8,
      life: 0.4,
      gravity: 0,
    })
  }

  private verdict(v: Verdict): void {
    const { fx } = this.ctx
    if (v !== 'draw') {
      const at = frame(v, 500, VOTE.y + VOTE.h / 2)
      fx.ring(at.x, at.y, SIDE[v].light, 320)
      fx.burst(at.x, at.y, C.yellow, {
        count: 36,
        speed: 900,
        size: 12,
        life: 0.9,
        kind: 'spark',
        colors: [C.yellow, C.white, SIDE[v].light],
      })
      floatFor(fx, v, this.s.lang === 'fr' ? 'Le boss du mic !' : 'Mic boss!')
    }
    this.finish(v, { delay: 1.6 })
  }

  render(g: Draw, a: number): void {
    const now = this.over ? this.time : this.time - (1 - a) * STEP
    renderFreestyle(g, this.s, Math.max(0, now), this.look)
  }
}

export default () => new Freestyle()
