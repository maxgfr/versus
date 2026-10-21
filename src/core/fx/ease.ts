export type Ease = (t: number) => number

export const linear: Ease = (t) => t
export const inQuad: Ease = (t) => t * t
export const outQuad: Ease = (t) => t * (2 - t)
export const inOutQuad: Ease = (t) => (t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t)
export const outCubic: Ease = (t) => 1 - (1 - t) ** 3
export const inCubic: Ease = (t) => t * t * t
export const inOutCubic: Ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2)
export const outBack: Ease = (t) => {
  const c1 = 1.70158
  const c3 = c1 + 1
  return 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2
}
export const outElastic: Ease = (t) =>
  t === 0 || t === 1 ? t : 2 ** (-10 * t) * Math.sin((t * 10 - 0.75) * ((2 * Math.PI) / 3)) + 1
export const outBounce: Ease = (t) => {
  const n = 7.5625
  const d = 2.75
  if (t < 1 / d) return n * t * t
  if (t < 2 / d) return n * (t -= 1.5 / d) * t + 0.75
  if (t < 2.5 / d) return n * (t -= 2.25 / d) * t + 0.9375
  return n * (t -= 2.625 / d) * t + 0.984375
}

export const clamp = (v: number, a: number, b: number): number => (v < a ? a : v > b ? b : v)
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t
/** 0..1 progress of `v` between a and b, clamped. */
export const prog = (v: number, a: number, b: number): number => clamp((v - a) / (b - a), 0, 1)
/** Frame-rate independent exponential approach. */
export const approach = (cur: number, target: number, rate: number, dt: number): number =>
  target + (cur - target) * Math.exp(-rate * dt)

/**
 * Critically-damped-ish spring around a rest value, for squash & stretch and
 * pop-in. `kick` adds velocity; read `value`.
 */
export class Spring {
  value: number
  v = 0
  constructor(
    public rest = 1,
    public k = 320,
    public damp = 14,
  ) {
    this.value = rest
  }
  kick(amount: number): void {
    this.v += amount
  }
  set(v: number): void {
    this.value = v
    this.v = 0
  }
  update(dt: number): number {
    const a = -this.k * (this.value - this.rest) - this.damp * this.v
    this.v += a * dt
    this.value += this.v * dt
    return this.value
  }
}
