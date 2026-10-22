import { Link, newCode, type Role } from '../core/net/link.ts'
import { audio } from '../core/audio.ts'
import { forgetRooms, type RecentRoom, rememberRoom, store } from '../core/store.ts'
import qrcode from 'qrcode-generator'
import { findGame, isBuilt } from '../registry.ts'
import { clear, h, onTap } from './dom.ts'
import { home, playOnline } from './home.ts'
import { icon } from './icons.ts'
import { go } from './router.ts'
import { ROOM_KEY, ui } from './state.ts'
import { toast } from './toast.ts'

/**
 * Online rooms. The address is the room: `#/online/CODE` is both the invite
 * link and the online home, `#/online/CODE/play/<game>` a game in it. Going
 * anywhere outside `#/online…` leaves the room.
 */

/** Guests follow the host: when the host starts a round, jump into that game. */
let pending: { seed: number; target?: number } | undefined

export function takePending(): { seed: number; target?: number } | undefined {
  const p = pending
  pending = undefined
  return p
}

type Saved = { code: string; role: Role }

/** The room this tab is in, kept across reloads (iOS reloads Safari behind the share sheet). */
function remember(room: Saved | null): void {
  try {
    if (room) sessionStorage.setItem(ROOM_KEY, JSON.stringify(room))
    else sessionStorage.removeItem(ROOM_KEY)
  } catch {
    // Private mode: a reload just joins as a guest again.
  }
}

function saved(): Saved | null {
  try {
    const r = JSON.parse(sessionStorage.getItem(ROOM_KEY) ?? 'null') as Saved | null
    return r && (r.role === 'host' || r.role === 'guest') ? r : null
  } catch {
    return null
  }
}

/** The room just left, so "Rejoin" gets the same seat back. */
let last: Saved | null = null

/** Rejoined from "Your rooms": go straight back into its last game once the friend is in. */
let resume: { code: string; id: string } | null = null

export const roomPath = (code: string): string => `/online/${code}`
const inGame = (code: string) => location.hash.startsWith(`#${roomPath(code)}/play/`)

function connect(code: string, role: Role): Link {
  ui.link?.leave()
  const link = new Link(code, role)
  ui.link = link
  remember({ code, role })
  rememberRoom(code, role)
  if (role === 'guest') {
    link.on('round', (d) => {
      const r = d as { id: string; seed: number; target?: number }
      const path = `${roomPath(code)}/play/${r.id}`
      if (location.hash === `#${path}`) return
      pending = r.target === undefined ? { seed: r.seed } : { seed: r.seed, target: r.target }
      go(path)
    })
  } else {
    // The guest picked a game (or is back in one after a reload): start it here,
    // the round pulls the guest in. A host already in a game keeps playing it.
    link.on('pick', (d) => {
      const g = findGame((d as { id?: string } | null)?.id ?? '')
      if (!g || !isBuilt(g.id) || !g.online || location.hash !== `#${roomPath(code)}`) return
      toast(`Your friend picked ${g.name}.`)
      go(`${roomPath(code)}/play/${g.id}`)
    })
  }
  link.on('quit', () => {
    if (inGame(code)) {
      go(roomPath(code))
      toast('Your friend left the game.')
    }
  })
  link.watch((c) => {
    if (c) {
      audio.play('coin')
      toast(
        inGame(code)
          ? 'Your friend is back.'
          : role === 'host'
            ? 'Friend connected! Pick a game.'
            : 'Connected! Pick a game.',
      )
    } else {
      toast('Your friend disconnected.')
    }
  })
  return link
}

/** The link for room `code`, joining it if this tab is not in it yet. */
export function room(code: string, role?: Role): Link {
  if (ui.link?.code === code) return ui.link
  const s = saved()
  const seat =
    role ??
    (s?.code === code ? s.role : null) ??
    (last?.code === code ? last.role : null) ??
    store.rooms.find((r) => r.code === code)?.role ??
    'guest'
  return connect(code, seat)
}

/** Leave the room (the router does this when the players go to a local screen). */
export function leaveRoom(): void {
  const link = ui.link
  if (!link) return
  last = { code: link.code, role: link.role }
  resume = null
  link.leave()
  ui.link = null
  remember(null)
  const code = link.code
  toast(`You left room ${code}.`, { label: 'Rejoin', run: () => go(roomPath(code)) }, 5000)
}

/**
 * The room rides in the query, not the #fragment: link previews and in-app
 * browsers (Messages, WhatsApp, Messenger…) often drop the fragment of a
 * shared link. main.ts turns `?r=CODE` back into `#/online/CODE`.
 */
function inviteUrl(code: string): string {
  return `${location.origin}${import.meta.env.BASE_URL}?r=${code}`
}

function qrImage(text: string): HTMLImageElement {
  const q = qrcode(0, 'M')
  q.addData(text)
  q.make()
  return h('img', { src: q.createDataURL(6, 0), alt: 'QR code to join this room' })
}

function page(root: HTMLElement, title: string): HTMLElement {
  const el = h('div.screen.page')
  const back = h('button.icon-btn.tile', { 'aria-label': 'Back' }, icon('back'))
  onTap(back, () => go('/'))
  const body = h('div')
  el.append(h('header.page-head', back, h('h1', title)), body)
  root.append(el)
  return body
}

/** `#/online`: create a room or type a code. */
export function lobby(root: HTMLElement): void {
  if (ui.link) {
    go(roomPath(ui.link.code), true)
    return
  }
  const body = page(root, 'Play online')
  const create = h('button.btn.big.tile.live', { style: { width: '100%' } }, 'Create a room')
  onTap(create, () => {
    audio.unlock()
    const code = newCode()
    room(code, 'host')
    go(roomPath(code))
  })
  const field = h('input.field.code-input', {
    maxlength: 4,
    placeholder: 'CODE',
    autocomplete: 'off',
    autocapitalize: 'characters',
    spellcheck: 'false',
    inputmode: 'text',
    enterkeyhint: 'go',
    'aria-label': 'Room code',
  })
  const join = h(
    'button.btn.big.tile.blue',
    { style: { width: '100%', marginTop: '12px' } },
    'Join',
  )
  const doJoin = () => {
    const v = field.value.trim().toUpperCase()
    if (!/^[A-Z]{4}$/.test(v)) {
      toast('Room codes are 4 letters.')
      return
    }
    audio.unlock()
    go(roomPath(v))
  }
  onTap(join, doJoin)
  field.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') doJoin()
  })
  body.append(
    ...recent(),
    h(
      'section.panel',
      h('h2', 'Host'),
      h('p', 'Create a room and send the link to your friend. You play Red.'),
      create,
    ),
    h(
      'section.panel',
      h('h2', 'Join'),
      h('p', 'Got a code from a friend? Type it here. You play Blue.'),
      field,
      join,
    ),
    h(
      'p.fine',
      'The two phones connect directly when they can; otherwise moves pass through a public relay. Nothing is stored anywhere.',
    ),
  )
}

function ago(t: number): string {
  const min = Math.round((Date.now() - t) / 60_000)
  if (min < 1) return 'just now'
  if (min < 60) return `${min} min ago`
  const hr = Math.round(min / 60)
  return hr < 24 ? `${hr} h ago` : `${Math.round(hr / 24)} d ago`
}

/** Rooms this phone was in: one tap back into the same seat. */
function recent(): HTMLElement[] {
  if (!store.rooms.length) return []
  const list = h('ul.rooms')
  const item = (r: RecentRoom) => {
    const game = r.game ? findGame(r.game) : undefined
    const open = h(
      'button.room-open',
      { 'aria-label': game ? `Back to ${game.name} in room ${r.code}` : `Rejoin room ${r.code}` },
      h('span.room-code', r.code),
      h(
        'span.room-meta',
        game ? `Back to ${game.name}` : r.role === 'host' ? 'You created it' : 'You joined',
        h('span.sub', ago(r.at)),
      ),
    )
    onTap(open, () => {
      audio.unlock()
      resume = game ? { code: r.code, id: game.id } : null
      room(r.code, r.role)
      go(roomPath(r.code))
    })
    const forget = h('button.icon-btn', { 'aria-label': `Forget room ${r.code}` }, icon('close'))
    onTap(forget, () => {
      forgetRooms(r.code)
      li.remove()
      if (!list.childElementCount) panel.remove()
    })
    const li = h('li', open, forget)
    return li
  }
  list.append(...store.rooms.map(item))
  const panel = h('section.panel', h('h2', 'Your rooms'), list)
  return [panel]
}

/** Waiting for the other phone: the code, the invite and its QR code. */
function waiting(root: HTMLElement, link: Link): void {
  const host = link.role === 'host'
  const body = page(root, 'Play online')
  const share = h('button.btn.tile.live', icon('share'), 'Send invite')
  onTap(share, async () => {
    const url = inviteUrl(link.code)
    try {
      if (navigator.share)
        // The link alone, so "Copy" in the share sheet gives a clean URL.
        await navigator.share({ url })
      else {
        await navigator.clipboard.writeText(url)
        toast('Invite link copied.')
      }
    } catch {
      // Share sheet dismissed.
    }
  })
  const leave = h('button.btn.tile.ghost', icon('close'), 'Leave room')
  onTap(leave, () => {
    leaveRoom()
    go('/online')
  })
  body.append(
    h(
      'section.panel',
      { style: { textAlign: 'center' } },
      h('h2', host ? 'Your room' : 'Joining room'),
      h('div.code', ...[...link.code].map((ch) => h('span', ch))),
      host ? h('div.qr', qrImage(inviteUrl(link.code))) : null,
      h('p.status', h('span.spinner'), host ? 'Waiting for your friend…' : 'Looking for the room…'),
    ),
    h('div.actions', host ? share : null, leave),
  )
}

/** `#/online/CODE`: joins the room; the game grid once both phones are in. */
export function roomScreen(root: HTMLElement, code: string): () => void {
  const link = room(code)
  let showing: boolean | null = null
  let cleanup: (() => void) | void
  const show = () => {
    if (showing === link.connected) return
    showing = link.connected
    if (typeof cleanup === 'function') cleanup()
    clear(root)
    if (link.connected) cleanup = home(root, 'online')
    else cleanup = waiting(root, link)
    const back = resume?.code === code ? findGame(resume.id) : undefined
    if (link.connected && back) {
      resume = null
      // After this screen is in place, not in the middle of routing to it.
      setTimeout(() => {
        if (location.hash === `#${roomPath(code)}`) playOnline(link, back)
      })
    }
  }
  show()
  const unwatch = link.watch(show)
  // A guest still in a game (this host reloaded under it) answers with a pick.
  // Repeated: a reloaded host's first messages can be lost while the guest's
  // link still points at the old page.
  const lobby = () => {
    if (link.role === 'host' && link.connected) link.send('lobby')
  }
  lobby()
  const ping = window.setInterval(lobby, 2000)
  return () => {
    clearInterval(ping)
    unwatch()
    if (typeof cleanup === 'function') cleanup()
  }
}
