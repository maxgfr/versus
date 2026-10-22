/** Tiny DOM builder: h('button.btn.primary', { onclick }, 'Play'). */
type Child = Node | string | number | null | undefined | false
type Attrs = Record<string, unknown>

export function h<K extends keyof HTMLElementTagNameMap>(
  sel: K | `${K}.${string}` | `${K}#${string}`,
  attrs?: Attrs | Child,
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const [tagAndId, ...classes] = sel.split('.')
  const [tag, id] = (tagAndId ?? 'div').split('#')
  const el = document.createElement(tag as K)
  if (id) el.id = id
  if (classes.length) el.className = classes.join(' ')
  if (attrs && (typeof attrs !== 'object' || attrs instanceof Node)) {
    children.unshift(attrs as Child)
  } else if (attrs) {
    for (const [k, v] of Object.entries(attrs as Attrs)) {
      if (v === undefined || v === null || v === false) continue
      if (k.startsWith('on') && typeof v === 'function') {
        el.addEventListener(k.slice(2), v as EventListener)
      } else if (k === 'style' && typeof v === 'object') {
        for (const [prop, val] of Object.entries(v as Record<string, string>)) {
          if (prop.startsWith('--')) el.style.setProperty(prop, val)
          else (el.style as unknown as Record<string, string>)[prop] = val
        }
      } else if (k === 'class') {
        el.className += (el.className ? ' ' : '') + String(v)
      } else if (k in el && typeof v !== 'string') {
        ;(el as unknown as Record<string, unknown>)[k] = v
      } else {
        el.setAttribute(k, v === true ? '' : String(v))
      }
    }
  }
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue
    el.append(c instanceof Node ? c : String(c))
  }
  return el
}

export function clear(el: Element): void {
  while (el.firstChild) el.removeChild(el.firstChild)
}

// Where each finger went down, and the last two scrolls (the page or a list): tracked on
// the document so a button re-rendered mid-press (the other player got ready) still sees it.
const downs = new Map<number, { x: number; y: number; t: number }>()
let lastScroll = -Infinity
let prevScroll = -Infinity
const capture = { capture: true, passive: true }
document.addEventListener(
  'pointerdown',
  (e) => downs.set(e.pointerId, { x: e.clientX, y: e.clientY, t: performance.now() }),
  capture,
)
document.addEventListener('pointercancel', (e) => downs.delete(e.pointerId), capture)
document.addEventListener(
  'scroll',
  () => {
    prevScroll = lastScroll
    lastScroll = performance.now()
  },
  capture,
)

/** Pointer-down activation: on a shared table phone, click's 300 ms feel is too slow and multi-touch swallows clicks. */
export function onTap(el: HTMLElement, fn: (e: PointerEvent) => void): void {
  el.addEventListener('pointerup', (e) => {
    const down = downs.get(e.pointerId)
    if (!down) return
    if (e.pointerType === 'mouse' && e.button !== 0) return
    // A drag, a scroll, or a touch that only stopped a momentum scroll is not a tap.
    if (Math.hypot(e.clientX - down.x, e.clientY - down.y) > 10) return
    // Momentum is a stream of scrolls; a lone one (a restored or scripted scroll
    // position) just before the press is not.
    if (lastScroll > down.t || prevScroll > down.t - 100) return
    const r = el.getBoundingClientRect()
    if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom)
      return
    fn(e)
  })
  // Keyboard users still get click (Enter / Space).
  el.addEventListener('click', (e) => {
    if ((e as MouseEvent).detail === 0) fn(e as unknown as PointerEvent)
  })
}

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

export function reducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}
