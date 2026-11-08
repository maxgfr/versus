import type { MatchSpec, Side } from '../../core/game.ts'
import type { Draw } from '../../core/render/draw.ts'
import { drawEquation, drawOptions, drawSum } from './render.ts'
import { planBot, type BotPlan } from './bot.ts'
import { dealSum, effort, nextSum, TARGET, type Question } from './rules.ts'
import { noPresses, QuizRace, type State } from './race.ts'

/** Match length: first to N points. */
export const match: MatchSpec = { unit: 'points', default: TARGET, min: 3, max: 21 }

class MathQuizGame extends QuizRace<Question, State> {
  protected setup(): State {
    const state: State = { ...dealSum(this.ctx.rng, this.ctx.difficulty, 0, 0), ...noPresses() }
    this.s = state
    this.planBots()
    return state
  }

  /** 0..1 how close the leader is to winning: later sums get bigger. */
  private heat(): number {
    const lead = Math.max(this.s.score[0], this.s.score[1])
    return Math.min(1, Math.max(0, lead / Math.max(1, this.target - 1)))
  }

  protected deal(): void {
    nextSum(this.s, this.ctx.rng, this.ctx.difficulty, this.time, this.heat())
  }

  protected plan(side: Side): BotPlan {
    const s = this.s
    return planBot(this.ctx.difficulty, this.ctx.rng, s.choices[side], s.q.answer, effort(s.q))
  }

  protected drawQuestion(g: Draw): void {
    const s = this.s
    drawSum(g, s, this.time, this.ctx.names, () => drawEquation(g, s, this.time))
  }

  protected drawButtons(g: Draw, side: Side): void {
    drawOptions(g, this.s, side, this.time)
  }
}

export default () => new MathQuizGame()
