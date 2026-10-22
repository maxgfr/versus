import { describe, expect, it } from 'vitest'
import type { GameContext, Mode } from '../../core/game.ts'
import { Fx } from '../../core/fx/fx.ts'
import { halfFrame, mirrorFx } from './frame.ts'

const ctxFor = (mode: Mode, rot: number) =>
  ({ mode, stage: { rot }, fx: new Fx() }) as unknown as GameContext

const frames = (mode: Mode) => [halfFrame(0, mode), halfFrame(1, mode)]

describe('mirrorFx', () => {
  it('mirrors effects in the half the online host sees turned (blue)', () => {
    const ctx = ctxFor('online', 0)
    mirrorFx(ctx, frames('online'))
    expect(ctx.fx.remap?.(100, 200)).toEqual([900, 700])
    expect(ctx.fx.remap?.(100, 1700)).toBeNull()
  })

  it('mirrors red on the rotated guest', () => {
    const ctx = ctxFor('online', Math.PI)
    mirrorFx(ctx, frames('online'))
    expect(ctx.fx.remap?.(100, 1700)).toEqual([900, 1000])
    expect(ctx.fx.remap?.(100, 200)).toBeNull()
  })

  it('leaves local 2P and 1P alone', () => {
    for (const mode of ['2p', '1p'] as const) {
      const ctx = ctxFor(mode, 0)
      mirrorFx(ctx, frames(mode))
      expect(ctx.fx.remap).toBeNull()
    }
  })
})
