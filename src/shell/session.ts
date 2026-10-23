import { audio } from '../core/audio.ts'
import { Fx, type FxCmd } from '../core/fx/fx.ts'
import {
  matchLabel,
  type Game,
  type GameContext,
  type GameFactory,
  type MatchSpec,
  type Mode,
  type Result,
  type Side,
} from '../core/game.ts'
import { Input } from '../core/input.ts'
import { Loop } from '../core/loop.ts'
import type { Link } from '../core/net/link.ts'
import { Draw } from '../core/render/draw.ts'
import { clearSprites } from '../core/render/sprites.ts'
import { Rng } from '../core/rng.ts'
import { Stage } from '../core/stage.ts'
import { roomGame, save, store, toggleFavorite } from '../core/store.ts'
import type { GameMeta } from '../registry.ts'
import { h, onTap, reducedMotion, sleep } from './dom.ts'
import { icon } from './icons.ts'
import { segmented } from './settings.ts'

export interface SessionOpts {
  meta: GameMeta
  factory: GameFactory
  /** The game's match-length setting, if it has one. */
  match?: MatchSpec | undefined
  mode: Mode
  link: Link | null
  /** Guest only: the seed the host sent with the round. */
  seed?: number
  /** Called when the players leave (menu / quit). */
  onExit: () => void
  /** Tournament hook: a result was reached. When set, the result screen offers "Next". */
  onResult?: (r: Result) => void
  onNext?: () => void
  /** e.g. "Game 2 of 5" */
  banner?: string
  /** Guest only: the match length the host chose. */
  target?: number
  /** Computer vs computer, no ready screen, `speed`× time (end-to-end tests, card captures). */
  demo?: { speed: number; clean?: boolean }
}

type Phase = 'ready' | 'count' | 'play' | 'result'

interface Snap {
  s: unknown
  fx: FxCmd[]
  au: [string, number][]
}

/**
 * Runs one game on the shared canvas: ready screen, 3-2-1, fixed-step play,
 * pause, result, rematch. Online, the host simulates and streams snapshots;
 * the guest renders them and streams its touches back.
 */
export class Session {
  private root: HTMLElement
  private stage: Stage
  private input!: Input
  private fx = new Fx()
  private draw: Draw
  private loop: Loop
  private game!: Game
  private phase: Phase = 'ready'
  private paused = false
  private overlay: HTMLElement | null = null
  private pausePanel: HTMLElement | null = null
  private teams = false
  private ready: [boolean, boolean] = [false, false]
  /** This round's seed, re-sent to a guest who (re)joins mid-round. */
  private seed = 0
  private local: Side
  private guest: boolean
  private host: boolean
  private steps = 0
  private offs: (() => void)[] = []
  private rounds = 0
  private disposed = false
  /** Match length (see MatchSpec); 0 when the game has no setting. */
  private target = 0

  constructor(
    parent: HTMLElement,
    private o: SessionOpts,
  ) {
    this.guest = o.mode === 'online' && o.link?.role === 'guest'
    this.host = o.mode === 'online' && o.link?.role === 'host'
    this.local = this.guest ? 1 : 0
    const spec = o.match
    if (spec) {
      const saved = o.demo ? undefined : store.match[o.meta.id]
      this.target = clampTarget(spec, saved ?? spec.default)
    }
    if (o.target !== undefined) this.target = o.target
    this.root = h('div.screen.game-screen')
    parent.append(this.root)
    this.stage = new Stage(this.root)
    this.stage.setRotated(this.guest && !o.meta.upright)
    this.stage.resize()
    this.draw = new Draw(this.stage, o.mode === '2p')
    if (o.mode === 'online') this.draw.viewer = this.local
    this.fx.reduced = reducedMotion()
    audio.enabled = store.settings.sound
    audio.haptics = store.settings.haptics
    this.loop = new Loop(
      (dt) => this.step(dt),
      (a, fdt) => this.frame(a, fdt),
    )
    this.loop.onHidden = () => {
      if (this.phase === 'play' && !this.paused) this.pause(true)
    }
    const pauseBtn = h('button.pause-btn', { 'aria-label': 'Pause' }, icon('pause'))
    onTap(pauseBtn, () => this.pause(true))
    // Card captures want the bare game.
    if (!o.demo?.clean) this.root.append(pauseBtn)
    if (o.mode === 'online' && o.link) {
      roomGame(o.link.code, o.meta.id)
      this.wireNet(o.link)
    }
    this.newRound(o.seed)
    this.loop.start()
  }

  // ---------- rounds ----------

  private newRound(seed?: number): void {
    this.game?.destroy()
    this.input?.detach()
    this.fx.clear()
    const s = seed ?? (Math.random() * 2 ** 32) >>> 0
    this.seed = s
    delete document.body.dataset.result
    this.input = new Input(this.stage, this.o.mode, this.local)
    this.input.attach(this.stage.canvas)
    if (this.guest && this.o.link) {
      const link = this.o.link
      this.input.applyLocal = false
      this.input.tap = (k, id, x, y) => {
        if (this.phase === 'play' && !this.paused)
          link.send('in', [k, id, Math.round(x), Math.round(y)], k === 'm' ? `m${id}` : undefined)
      }
    }
    const ctx: GameContext = {
      stage: this.stage,
      input: this.input,
      fx: this.fx,
      audio,
      rng: new Rng(s),
      mode: this.o.mode,
      difficulty: store.settings.difficulty,
      bots: this.o.demo ? [true, true] : [false, this.o.mode === '1p' && this.o.meta.ai],
      teams: this.teams && this.o.mode === '2p',
      names: this.names(),
      local: this.local,
      seed: s,
      target: this.target,
    }
    this.game = this.o.factory()
    this.game.init(ctx)
    this.fx.outbox = this.host ? [] : null
    audio.outbox = this.host ? [] : null
    this.phase = 'ready'
    this.ready = [false, this.o.mode === '1p']
    this.steps = 0
    this.rounds++
    if (this.host) this.sendRound()
    if (this.o.demo) {
      this.loop.speed = this.o.demo.speed
      this.clearOverlay()
      this.phase = 'play'
      return
    }
    this.showReady()
  }

  private names(): [string, string] {
    const [r, b] = store.settings.names
    if (this.o.demo) return ['Computer', 'Computer']
    if (this.o.mode === '1p') return [r, this.o.meta.ai ? 'Computer' : 'Solo']
    return [r, b]
  }

  // ---------- loop ----------

  private step(dt: number): void {
    if (this.phase !== 'play' || this.paused || this.guest) return
    if (this.fx.hitstop > 0) {
      this.fx.hitstop--
      return
    }
    const g = this.game as Game & { time?: number }
    this.input.setNow(g.time ?? 0)
    this.game.update(dt)
    this.input.endStep()
    this.steps++
    if (this.host && this.o.link && this.steps % (this.o.link.relayed ? 6 : 2) === 0)
      this.broadcast(this.o.link)
    if (this.game.result) {
      if (this.host && this.o.link) this.broadcast(this.o.link)
      this.showResult(this.game.result)
    }
  }

  private frame(alpha: number, frameDt: number): void {
    const g = this.draw
    const c = this.stage.ctx
    g.t += frameDt
    this.fx.update(frameDt)
    this.stage.applyTransform()
    c.translate(this.fx.shakeX, this.fx.shakeY)
    // Hit-stop holds the simulation: hold the picture too, or interpolation
    // keeps sliding between the last two steps and the freeze jitters.
    this.game.render(g, this.fx.hitstop > 0 ? 1 : alpha)
    this.fx.render(g)
    this.fx.renderOverlay(g)
  }

  // ---------- online ----------

  private sendRound(): void {
    this.o.link?.send('round', { id: this.o.meta.id, seed: this.seed, target: this.target })
  }

  private broadcast(link: Link): void {
    const snap: Snap = { s: this.game.snapshot(), fx: this.fx.outbox ?? [], au: audio.outbox ?? [] }
    link.send('snap', snap)
    this.fx.outbox = []
    audio.outbox = []
  }

  private wireNet(link: Link): void {
    const on = (t: string, fn: (d: unknown) => void) => this.offs.push(link.on(t, fn))
    if (this.host) {
      on('in', (d) => {
        const [k, id, x, y] = d as ['d' | 'm' | 'u', number, number, number]
        this.input.remote(1, k, id, x, y)
      })
      on('ready', () => this.markReady(1))
      on('rematch', () => this.rematch())
      // The guest's screen just opened: tell it if red already tapped Ready.
      on('hi', () => {
        if (this.phase === 'ready' && this.ready[0]) link.send('ready')
      })
    } else {
      on('round', (d) => {
        const r = d as { id: string; seed: number; target?: number }
        if (r.id !== this.o.meta.id) return
        if (typeof r.target === 'number') this.target = r.target
        this.newRound(r.seed)
      })
      on('ready', () => this.markReady(0))
      on('count', () => void this.countdown())
      // The host reloaded and sits on the room screen: bring it back into this game.
      on('lobby', () => {
        if (this.phase !== 'result') link.send('pick', { id: this.o.meta.id })
      })
      link.send('hi')
      on('snap', (d) => {
        const sn = d as Snap
        this.game.restore(sn.s)
        for (const f of sn.fx) this.fx.apply(f)
        for (const [n, p] of sn.au) audio.play(n, p)
        if (this.phase === 'count' || this.phase === 'ready') {
          // Joined a round already under way.
          this.phase = 'play'
          this.clearOverlay()
        }
        if (this.game.result && this.phase === 'play') this.showResult(this.game.result)
      })
    }
    // A lost "ready" would leave both phones waiting: repeat it until the countdown.
    const again = window.setInterval(() => {
      if (this.phase === 'ready' && this.ready[this.local]) link.send('ready')
    }, 2000)
    this.offs.push(() => clearInterval(again))
    on('pause', () => this.pause(false))
    on('resume', () => this.resume(false))
    on('quit', () => {
      this.exit(false)
    })
    this.offs.push(
      link.watch((connected) => {
        if (!connected && this.phase === 'play')
          this.pause(false, 'Your friend lost the connection. Waiting for them to come back…')
        if (connected && this.paused && this.pausePanel) this.resume(true)
        // A friend who opens the invite (or comes back) lands in this game.
        if (connected && this.host && this.phase !== 'result') {
          this.sendRound()
          if (this.phase === 'ready') {
            this.ready[1] = false
            this.showReady()
          }
        }
      }),
    )
  }

  // ---------- overlays ----------

  private clearOverlay(): void {
    this.overlay?.remove()
    this.overlay = null
  }

  private showReady(): void {
    this.clearOverlay()
    const m = this.o.meta
    const mode = this.o.mode
    const [rn, bn] = this.names()
    const halfFor = (side: Side): HTMLElement => {
      const cls = side === 0 ? 'red' : 'blue'
      const pos = side === 0 ? 'bottom' : mode === '2p' ? 'top' : 'top-flat'
      const half = h(`div.half.${pos === 'top-flat' ? 'flat' : pos}.${cls}`)
      // The CPU / solo half in 1P.
      if (mode === '1p' && side === 1) {
        half.className = 'half solo'
        if (m.ai) {
          half.append(
            h('span.ready-team', { style: { color: 'var(--blue)' } }, 'Computer'),
            icon('cpu', 'big-ico'),
            segmented(
              [
                ['easy', 'Easy'],
                ['normal', 'Normal'],
                ['hard', 'Hard'],
              ],
              store.settings.difficulty,
              (v) => {
                store.settings.difficulty = v
                save()
                this.newRound()
              },
              'Computer difficulty',
            ),
          )
        } else {
          const rec = store.records[m.id]
          half.append(
            h('span.ready-team', { style: { color: 'var(--ink-6)' } }, 'Solo time trial'),
            h(
              'p.ready-rules',
              rec === undefined ? 'Set your first record.' : `Your best: ${fmtRecord(rec)}`,
            ),
          )
        }
        return half
      }
      // Online: the far half shows the other phone's status.
      const mine = mode !== 'online' || side === this.local
      half.append(
        h('span.ready-team', side === 0 ? rn : bn),
        h(
          'div.ready-head',
          h('span.ready-glyph', { 'aria-hidden': 'true' }, m.glyph),
          h('h2.ready-title', m.name),
        ),
        h('p.ready-rules', m.rules),
      )
      if (mine) {
        const label = mode === '1p' ? 'Play' : 'Ready'
        const b = h(`button.btn.big.tile.ready-btn.${cls}`, label)
        if (this.ready[side]) {
          b.classList.add('is-ready')
          b.textContent = 'Ready!'
        }
        onTap(b, () => {
          audio.unlock()
          if (this.ready[side]) return
          audio.play('pop')
          b.classList.add('is-ready')
          b.replaceChildren(icon('check'), 'Ready!')
          if (mode === 'online') this.o.link?.send('ready')
          this.markReady(side)
        })
        half.append(b)
      } else {
        half.append(
          h(
            'p.status',
            this.ready[side] ? 'Ready!' : h('span.spinner'),
            this.ready[side] ? '' : ` Waiting for ${side === 0 ? rn : bn}…`,
          ),
        )
      }
      return half
    }

    const strip = h('div.midstrip')
    const back = h('button.icon-btn.tile', { 'aria-label': 'Back to games' }, icon('close'))
    onTap(back, () => this.exit(true))
    strip.append(back)
    if (this.o.banner)
      strip.append(
        h(
          'span',
          { style: { fontWeight: '600', color: 'var(--ink-6)', padding: '0 6px' } },
          this.o.banner,
        ),
      )
    if (m.teams && mode === '2p') {
      strip.append(
        segmented(
          [
            ['1', '1 v 1'],
            ['2', '2 v 2'],
          ],
          this.teams ? '2' : '1',
          (v) => {
            this.teams = v === '2'
            this.newRound()
          },
          'Teams',
        ),
      )
    }
    const fav = () => (store.favorites.includes(m.id) ? icon('starFill') : icon('star'))
    const favBtn = h(
      'button.icon-btn.tile',
      { 'aria-label': 'Favourite', style: { color: 'var(--live)' } },
      fav(),
    )
    onTap(favBtn, () => {
      toggleFavorite(m.id)
      favBtn.replaceChildren(fav())
    })
    strip.append(favBtn)
    const spec = this.o.match
    if (spec) strip.append(this.matchStepper(spec))

    const top = halfFor(1)
    const bottom = halfFor(0)
    const ov = h('div.overlay.ready', top, strip, bottom)
    if (mode === 'online' && this.local === 1) {
      // The guest's own half goes at the bottom of their screen; the host's
      // sits above it, upright (nobody is across the table online).
      top.classList.replace('flat', 'bottom')
      bottom.classList.replace('bottom', 'flat')
      ov.replaceChildren(bottom, strip, top)
    }
    this.overlay = ov
    this.root.append(ov)
  }

  /** − value + : the match length, editable by the host / local players only. */
  private matchStepper(spec: MatchSpec): HTMLElement {
    const step = spec.step ?? 1
    const label = h('span.stepper-value', { 'aria-live': 'polite' }, matchLabel(spec, this.target))
    const set = (v: number) => {
      const n = clampTarget(spec, v)
      if (n === this.target) return
      this.target = n
      store.match[this.o.meta.id] = n
      save()
      audio.play('click')
      this.newRound()
    }
    const minus = h(
      'button.stepper-btn',
      { 'aria-label': 'Shorter match', disabled: this.target <= spec.min },
      '−',
    )
    const plus = h(
      'button.stepper-btn',
      { 'aria-label': 'Longer match', disabled: this.target >= spec.max },
      '+',
    )
    onTap(minus, () => set(this.target - step))
    onTap(plus, () => set(this.target + step))
    const el = h('div.stepper', { role: 'group', 'aria-label': 'Match length' }, minus, label, plus)
    // Only the host decides online; the guest sees the value.
    if (this.guest) el.classList.add('is-readonly')
    return el
  }

  private markReady(side: Side): void {
    if (this.phase !== 'ready' || this.ready[side]) return
    this.ready[side] = true
    if (this.o.mode === 'online') this.showReady()
    if (this.ready[0] && this.ready[1] && !this.guest) {
      if (this.host) this.o.link?.send('count')
      void this.countdown()
    }
  }

  private async countdown(): Promise<void> {
    if (this.phase !== 'ready') return
    this.phase = 'count'
    const round = this.rounds
    this.clearOverlay()
    const flip = this.o.mode === '2p'
    const el = h('div.count')
    this.root.append(el)
    for (const n of ['3', '2', '1', 'GO!']) {
      if (this.disposed || round !== this.rounds) break
      const mk = (top: boolean) => h(`div.half${top ? '.top' : ''}`, h('span.count-n', n))
      el.replaceChildren(...(flip ? [mk(true), mk(false)] : [h('div.half', h('span.count-n', n))]))
      audio.play(n === 'GO!' ? 'go' : 'count')
      await sleep(n === 'GO!' ? 450 : 650)
    }
    el.remove()
    if (this.disposed || round !== this.rounds) return
    if (this.phase === 'count') this.phase = 'play'
  }

  private showResult(r: Result): void {
    if (this.phase === 'result') return
    this.phase = 'result'
    this.input.player(0).releaseAll()
    this.input.player(1).releaseAll()
    const mode = this.o.mode
    const [rn, bn] = this.names()
    // Only human-vs-human games feed the red/blue scoreboard.
    if (mode !== '1p' && !this.o.demo && r.winner !== 'draw') {
      store.score[r.winner]++
    }
    store.plays[this.o.meta.id] = (store.plays[this.o.meta.id] ?? 0) + 1
    save()
    this.o.onResult?.(r)
    this.fx.confetti(r.winner === 'draw' ? undefined : r.winner)
    if (r.winner !== 'draw' && mode === '1p' && r.winner === 1 && this.o.meta.ai) audio.play('lose')

    const title =
      r.winner === 'draw'
        ? 'Draw!'
        : mode === '1p' && !this.o.meta.ai
          ? 'Done!'
          : mode === 'online'
            ? r.winner === this.local
              ? 'You win!'
              : `${r.winner === 0 ? rn : bn} wins`
            : `${r.winner === 0 ? rn : bn} wins!`
    const cls = r.winner === 'draw' ? 'win-draw' : r.winner === 0 ? 'win-red' : 'win-blue'
    document.body.dataset.result = String(r.winner)
    const mk = (top: boolean) => {
      const half = h(`div.half${top ? '.top' : ''}`)
      half.append(h('h2.result-title', title))
      if (r.score) half.append(h('div.result-score', `${r.score[0]} – ${r.score[1]}`))
      if (r.note) half.append(h('p.result-sub', r.note))
      const primary = h('button.btn.big.tile.white', this.o.onNext ? 'Next game' : 'Rematch')
      onTap(primary, () => (this.o.onNext ? this.o.onNext() : this.rematch()))
      const menu = h('button.btn.big.tile.ghost', this.o.onNext ? 'Quit' : 'Games')
      onTap(menu, () => this.exit(true))
      const canAct = !(this.guest && this.o.onNext)
      if (canAct) half.append(h('div.result-actions', menu, primary))
      return half
    }
    const flip = mode === '2p'
    const ov = h(`div.overlay.result.${cls}`, ...(flip ? [mk(true), mk(false)] : [mk(false)]))
    // Let the last frame and the confetti breathe before covering them.
    ov.animate([{ opacity: 0 }, { opacity: 1 }], {
      duration: 350,
      easing: 'ease-out',
      fill: 'both',
    })
    this.clearOverlay()
    this.overlay = ov
    this.root.append(ov)
  }

  private rematch(): void {
    if (this.guest) {
      this.o.link?.send('rematch')
      return
    }
    this.newRound()
  }

  // ---------- pause ----------

  private pause(notify: boolean, message?: string): void {
    if (this.phase !== 'play' && this.phase !== 'count') {
      if (this.phase === 'ready') this.exit(true)
      return
    }
    if (this.paused) return
    this.paused = true
    this.loop.paused = true
    if (notify && this.o.mode === 'online') this.o.link?.send('pause')
    const resume = h('button.btn.big.tile.live', icon('play'), 'Resume')
    onTap(resume, () => this.resume(true))
    const restart = h('button.btn.tile.ghost', icon('refresh'), 'Restart')
    onTap(restart, () => {
      this.closePause()
      this.rematch()
    })
    const quit = h('button.btn.tile.ghost', icon('close'), 'Quit game')
    onTap(quit, () => this.exit(true))
    const card = h(
      'div.pause-card',
      { role: 'dialog', 'aria-label': 'Paused' },
      h('h2', 'Paused'),
      h('p', message ?? this.o.meta.rules),
      resume,
      this.guest ? null : restart,
      quit,
    )
    this.pausePanel = h('div.pause-panel', card)
    this.root.append(this.pausePanel)
  }

  private closePause(): void {
    this.pausePanel?.remove()
    this.pausePanel = null
    this.paused = false
    this.loop.paused = false
  }

  private resume(notify: boolean): void {
    if (!this.paused) return
    this.closePause()
    if (notify && this.o.mode === 'online') this.o.link?.send('resume')
  }

  // ---------- teardown ----------

  private exit(notify: boolean): void {
    if (notify && this.o.mode === 'online') this.o.link?.send('quit')
    this.o.onExit()
  }

  destroy(): void {
    this.disposed = true
    this.loop.stop()
    this.input?.detach()
    this.game?.destroy()
    for (const off of this.offs) off()
    this.fx.clear()
    audio.outbox = null
    this.stage.destroy()
    clearSprites()
    this.root.remove()
  }
}

export function fmtRecord(v: number): string {
  // Records are seconds for races; show m:ss.t
  const m = Math.floor(v / 60)
  const s = v - m * 60
  return m > 0 ? `${m}:${s.toFixed(1).padStart(4, '0')}` : `${s.toFixed(1)} s`
}

function clampTarget(spec: MatchSpec, v: number): number {
  const step = spec.step ?? 1
  const n = Math.round((v - spec.min) / step) * step + spec.min
  return Math.max(spec.min, Math.min(spec.max, n))
}
