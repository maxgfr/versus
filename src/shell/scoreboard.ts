import { store } from '../core/store.ts'
import { h, onTap } from './dom.ts'
import { icon } from './icons.ts'
import { ui } from './state.ts'

/** Rolling scoreboard figures: each digit is a reel that spins to its new value. */
export function digits(value: number, from = value): HTMLElement {
  const el = h('span.digits', { role: 'img', 'aria-label': String(value) })
  const len = Math.max(String(value).length, String(from).length)
  const target = String(value).padStart(len, ' ')
  const start = String(from).padStart(len, ' ')
  const reels: [HTMLElement, number][] = []
  for (let i = 0; i < len; i++) {
    const reel = h('span.digit-reel', { 'aria-hidden': 'true' })
    // Index 0 is a blank (leading position), then 0-9.
    reel.append(h('span', ' '))
    for (let d = 0; d <= 9; d++) reel.append(h('span', String(d)))
    const s = start[i] === ' ' ? 0 : Number(start[i]) + 1
    const t = target[i] === ' ' ? 0 : Number(target[i]) + 1
    reel.style.transform = `translateY(${-s}em)`
    reels.push([reel, t])
    el.append(h('span.digit', reel))
  }
  if (from !== value) {
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        for (const [reel, t] of reels) reel.style.transform = `translateY(${-t}em)`
      }),
    )
  }
  return el
}

export function scoreboard(onTournament: () => void): HTMLElement {
  const [r, b] = store.score
  const [pr, pb] = ui.shownScore ?? store.score
  ui.shownScore = [r, b]
  const [rn, bn] = store.settings.names
  const team = (cls: string, name: string, v: number, from: number, lead: boolean) =>
    h(
      `div.sb-team.${cls}${lead ? '.lead' : ''}`,
      h('span.sb-name', h('i.mark'), h('span', name)),
      digits(v, from),
    )
  const mid = h(
    'button.sb-mid',
    { 'aria-label': 'Start a tournament' },
    icon('trophy'),
    'Tournament',
  )
  onTap(mid, onTournament)
  return h(
    'footer.scoreboard',
    { 'aria-label': `Score: ${rn} ${r}, ${bn} ${b}` },
    team('red', rn, r, pr, r > b),
    mid,
    team('blue', bn, b, pb, b > r),
  )
}
