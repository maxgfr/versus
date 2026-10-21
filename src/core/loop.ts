import { STEP } from './game.ts'

/**
 * Fixed-step simulation (60 Hz) with interpolated rendering. Stops itself when
 * the page is hidden so a backgrounded tab neither burns battery nor fast-forwards
 * the game when it comes back.
 */
export class Loop {
  private raf = 0
  private last = 0
  private acc = 0
  private running = false
  paused = false
  /** Simulation speed multiplier (tests run computer-vs-computer games fast). */
  speed = 1

  constructor(
    private step: (dt: number) => void,
    private draw: (alpha: number, frameDt: number) => void,
  ) {}

  start(): void {
    if (this.running) return
    this.running = true
    this.last = performance.now()
    this.acc = 0
    document.addEventListener('visibilitychange', this.onVisibility)
    this.raf = requestAnimationFrame(this.frame)
  }

  stop(): void {
    this.running = false
    cancelAnimationFrame(this.raf)
    document.removeEventListener('visibilitychange', this.onVisibility)
  }

  /** Called when the page is hidden; the shell decides whether to show the pause menu. */
  onHidden: (() => void) | null = null

  private onVisibility = (): void => {
    if (document.hidden) {
      cancelAnimationFrame(this.raf)
      this.onHidden?.()
    } else if (this.running) {
      this.last = performance.now()
      this.acc = 0
      this.raf = requestAnimationFrame(this.frame)
    }
  }

  private frame = (now: number): void => {
    if (!this.running) return
    this.raf = requestAnimationFrame(this.frame)
    // Clamp long frames (debugger, slow device) so we never spiral.
    const frameDt = Math.min(0.1, (now - this.last) / 1000)
    this.last = now
    if (!this.paused) {
      this.acc += frameDt * this.speed
      const max = 5 * this.speed
      let n = 0
      while (this.acc >= STEP && n < max) {
        this.step(STEP)
        this.acc -= STEP
        n++
      }
      if (n === max) this.acc = 0
    }
    this.draw(this.paused ? 1 : this.acc / STEP, frameDt)
  }
}
