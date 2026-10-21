import type { Mode } from '../core/game.ts'
import { store } from '../core/store.ts'
import { FAMILIES, builtGames, type GameMeta } from '../registry.ts'
import { cardArt, familyColor } from './art.ts'
import { h, onTap } from './dom.ts'
import { icon, type IconName } from './icons.ts'
import { go } from './router.ts'
import { scoreboard } from './scoreboard.ts'
import { openSettings } from './settings.ts'
import { ui } from './state.ts'
import { toast } from './toast.ts'

const MODES: [Mode, string, IconName][] = [
  ['1p', '1P', 'cpu'],
  ['2p', '2P', 'users'],
  ['online', 'Online', 'globe'],
]

function visible(g: GameMeta, mode: Mode): boolean {
  if (mode === 'online') return g.online
  return true
}

export function home(root: HTMLElement): () => void {
  const games = builtGames()
  const screen = h('div.screen.home')
  const scroller = h('main.scroller')
  const chipsEl = h('nav.chips', { 'aria-label': 'Game families' })
  const modesEl = h('div.modes', { role: 'group', 'aria-label': 'Players' })
  const art = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue
        const img = e.target as HTMLImageElement
        art.unobserve(img)
        const g = games.find((x) => x.id === img.dataset.id)
        if (g) void cardArt(g).then((u) => (img.src = u))
      }
    },
    { root: scroller, rootMargin: '400px 0px' },
  )

  const card = (g: GameMeta): HTMLElement => {
    const img = h('img', { alt: '', 'data-id': g.id, decoding: 'async' })
    art.observe(img)
    const fav = store.favorites.includes(g.id)
    const el = h(
      'button.card.tile',
      {
        'data-id': g.id,
        style: { '--fam': familyColor(g) } as unknown as Partial<CSSStyleDeclaration>,
      },
      h(
        'div.card-art',
        img,
        g.isNew && h('span.badge.new', 'NEW'),
        fav && h('span.fav-mark', { 'aria-label': 'Favourite' }, icon('starFill')),
      ),
      h('span.card-name', g.name),
    )
    onTap(el, () => pick(g))
    return el
  }

  const pick = (g: GameMeta) => {
    if (ui.mode === 'online') {
      const link = ui.link
      if (!link || !link.connected) {
        go('/online')
        return
      }
      if (link.role === 'guest') {
        toast('Your friend picks the game. Ask them!')
        return
      }
    }
    ui.scrollTop = scroller.scrollTop
    go(`/play/${g.id}`)
  }

  const renderModes = () => {
    modesEl.replaceChildren(
      ...MODES.map(([m, label, ic]) => {
        const b = h('button.mode', { 'aria-pressed': String(ui.mode === m) }, icon(ic), label)
        onTap(b, () => {
          if (ui.mode === m) return
          ui.mode = m
          renderModes()
          renderGrid(true)
          if (m === 'online' && !ui.link) go('/online')
        })
        return b
      }),
    )
  }

  const renderChips = () => {
    const pool = games.filter((g) => visible(g, ui.mode))
    const chip = (id: typeof ui.filter, label: string, n: number, lead?: Node) => {
      const b = h(
        'button.chip',
        { 'aria-pressed': String(ui.filter === id) },
        lead,
        label,
        h('span.n', n),
      )
      onTap(b, () => {
        if (ui.filter === id) return
        ui.filter = id
        renderChips()
        renderGrid(true)
      })
      return b
    }
    const favs = pool.filter((g) => store.favorites.includes(g.id)).length
    chipsEl.replaceChildren(
      chip('all', 'All', pool.length),
      ...(favs ? [chip('fav', 'Favourites', favs, icon('starFill'))] : []),
      ...FAMILIES.flatMap((f) => {
        const n = pool.filter((g) => g.family === f.id).length
        if (!n) return []
        const dot = h('span.dot', {
          style: { '--c': f.color } as unknown as Partial<CSSStyleDeclaration>,
        })
        return [chip(f.id, f.label, n, dot)]
      }),
    )
  }

  const banner = (): HTMLElement | null => {
    if (ui.mode !== 'online') return null
    const link = ui.link
    if (!link) return null
    const btn = h(
      'button.btn.ghost.tile',
      { style: { minHeight: '40px', padding: '0 14px', fontSize: '15px' } },
      'Room',
    )
    onTap(btn, () => go('/online'))
    if (!link.connected)
      return h(
        'div.online-banner.waiting',
        h('span.pulse'),
        h('span.grow', 'Room ', h('b', link.code), ' · waiting for your friend'),
        btn,
      )
    return h(
      'div.online-banner',
      h('span.pulse'),
      h(
        'span.grow',
        'Connected in ',
        h('b', link.code),
        link.role === 'host' ? ' · you are Red, pick a game' : ' · you are Blue, your friend picks',
      ),
      btn,
    )
  }

  const renderGrid = (animate: boolean) => {
    // FLIP: remember where each card was, re-render, then glide from there.
    const before = new Map<string, DOMRect>()
    if (animate)
      for (const el of scroller.querySelectorAll<HTMLElement>('.card'))
        before.set(el.dataset.id ?? '', el.getBoundingClientRect())
    const pool = games.filter((g) => visible(g, ui.mode))
    const list =
      ui.filter === 'all'
        ? pool
        : ui.filter === 'fav'
          ? pool.filter((g) => store.favorites.includes(g.id))
          : pool.filter((g) => g.family === ui.filter)
    const nodes: Node[] = []
    const b = banner()
    if (b) nodes.push(b)
    const favs = pool.filter((g) => store.favorites.includes(g.id))
    if (ui.filter === 'all' && favs.length) {
      nodes.push(
        h('h2.section-title', 'Favourites'),
        h('div.grid', ...favs.map(card)),
        h('h2.section-title', 'All games'),
      )
    }
    nodes.push(list.length ? h('div.grid', ...list.map(card)) : h('p.empty', 'No games here yet.'))
    scroller.replaceChildren(...nodes)
    if (!animate) return
    for (const el of scroller.querySelectorAll<HTMLElement>('.card')) {
      const prev = before.get(el.dataset.id ?? '')
      const now = el.getBoundingClientRect()
      if (prev) {
        const dx = prev.left - now.left
        const dy = prev.top - now.top
        if (dx || dy)
          el.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], {
            duration: 360,
            easing: 'cubic-bezier(0.16, 1, 0.3, 1)',
          })
      } else {
        el.animate(
          [
            { opacity: 0, transform: 'scale(0.92)' },
            { opacity: 1, transform: 'none' },
          ],
          { duration: 260, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' },
        )
      }
    }
  }

  const settingsBtn = h('button.icon-btn.tile', { 'aria-label': 'Settings' }, icon('gear'))
  onTap(settingsBtn, () => openSettings(screen, () => rebuild()))

  const top = h(
    'header.home-top',
    h(
      'h1.wordmark',
      { 'aria-label': 'versus' },
      h('span.w-r', 'ver'),
      h('span.w-vs', 'VS'),
      h('span.w-b', 'sus'),
    ),
    settingsBtn,
  )

  let board = scoreboard(() => go('/tournament'))
  const rebuild = () => {
    renderChips()
    renderGrid(false)
    const nb = scoreboard(() => go('/tournament'))
    board.replaceWith(nb)
    board = nb
  }

  renderModes()
  renderChips()
  renderGrid(false)
  screen.append(top, modesEl, chipsEl, scroller, board)
  root.append(screen)
  scroller.scrollTop = ui.scrollTop

  // Online status changes re-render the banner.
  const unwatch = ui.link?.watch(() => renderGrid(false))

  return () => {
    ui.scrollTop = scroller.scrollTop
    art.disconnect()
    unwatch?.()
  }
}
