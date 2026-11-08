import type { MatchSpec, Side } from '../../core/game.ts'
import type { Draw } from '../../core/render/draw.ts'
import type { BotPlan } from '../math-quiz/bot.ts'
import { noPresses, QuizRace, type State as RaceState } from '../math-quiz/race.ts'
import { drawOptions, drawSum } from '../math-quiz/render.ts'
import { TARGET, type Answer } from '../math-quiz/rules.ts'
import { planFlagBot } from './bot.ts'
import { drawFlag, FLAG_GAP, FLAG_PANEL, nameLabel } from './render.ts'
import { dealFlag, nextFlag, type FlagRace } from './rules.ts'

/** Match length: first to N points. */
export const match: MatchSpec = { unit: 'points', default: TARGET, min: 3, max: 21 }

type State = RaceState<Answer> & FlagRace

class FlagQuizGame extends QuizRace<Answer, State> {
  protected setup(): State {
    const rng = this.ctx.rng
    const state: State = { ...dealFlag(rng, rng.int(0, 2 ** 31 - 1), 0, 0), ...noPresses() }
    this.s = state
    this.planBots()
    return state
  }

  protected deal(): void {
    nextFlag(this.s, this.ctx.rng, this.time)
  }

  protected plan(side: Side): BotPlan {
    const s = this.s
    return planFlagBot(this.ctx.difficulty, this.ctx.rng, s.choices[side], s.q.answer)
  }

  protected drawQuestion(g: Draw): void {
    const s = this.s
    drawSum(g, s, this.time, this.ctx.names, () => drawFlag(g, s.q.answer), FLAG_PANEL, FLAG_GAP)
  }

  protected drawButtons(g: Draw, side: Side): void {
    drawOptions(g, this.s, side, this.time, nameLabel)
  }
}

export default () => new FlagQuizGame()
