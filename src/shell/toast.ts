import { h, onTap } from './dom.ts'

let current: HTMLElement | null = null
let timer = 0

/** One toast at a time, bottom centre, above the scoreboard. */
export function toast(text: string, action?: { label: string; run: () => void }, ms = 3200): void {
  current?.remove()
  clearTimeout(timer)
  const el = h('div.toast', { role: 'status' }, h('span', text))
  if (action) {
    const b = h('button.btn.live.tile', action.label)
    onTap(b, () => {
      el.remove()
      action.run()
    })
    el.append(b)
  }
  document.getElementById('app')?.append(el)
  current = el
  if (ms > 0) timer = window.setTimeout(() => el.remove(), ms)
}
