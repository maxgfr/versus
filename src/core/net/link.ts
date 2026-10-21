import { joinRoom, type JsonValue, type MessageAction, type Room } from 'trystero/nostr'

/**
 * One peer-to-peer link to the other phone. Signalling goes through public Nostr
 * relays (trystero); after the handshake, game traffic is a direct WebRTC data
 * channel. Messages are tagged JSON: `send('snap', …)`, `on('snap', fn)`.
 */

const APP_ID = 'versus-2p-games-v1'

export type Role = 'host' | 'guest'

type Handler = (data: unknown) => void

export class Link {
  private room: Room
  private action: MessageAction<JsonValue>
  private handlers = new Map<string, Set<Handler>>()
  peer: string | null = null
  private watchers = new Set<(connected: boolean) => void>()

  constructor(
    readonly code: string,
    readonly role: Role,
  ) {
    this.room = joinRoom({ appId: APP_ID }, 'room-' + code.toLowerCase())
    this.action = this.room.makeAction<JsonValue>('m')
    this.action.onMessage = (data, ctx) => {
      if (this.peer === null) this.peer = ctx.peerId
      if (ctx.peerId !== this.peer) return
      const [type, payload] = data as [string, unknown]
      const set = this.handlers.get(type)
      if (set) for (const h of set) h(payload)
    }
    this.room.onPeerJoin = (id) => {
      // Two phones per room: a third visitor is ignored.
      if (this.peer !== null && this.peer !== id) return
      this.peer = id
      for (const w of this.watchers) w(true)
    }
    this.room.onPeerLeave = (id) => {
      if (id !== this.peer) return
      this.peer = null
      for (const w of this.watchers) w(false)
    }
  }

  get connected(): boolean {
    return this.peer !== null
  }

  send(type: string, payload?: unknown): void {
    if (!this.peer) return
    void this.action
      .send([type, (payload ?? null) as JsonValue], { target: this.peer })
      .catch(() => {
        // A dropped frame is fine: snapshots supersede each other.
      })
  }

  /** Connection status changes. Returns an unsubscribe function. */
  watch(fn: (connected: boolean) => void): () => void {
    this.watchers.add(fn)
    return () => this.watchers.delete(fn)
  }

  on(type: string, fn: Handler): () => void {
    let set = this.handlers.get(type)
    if (!set) this.handlers.set(type, (set = new Set()))
    set.add(fn)
    return () => set.delete(fn)
  }

  leave(): void {
    this.handlers.clear()
    this.watchers.clear()
    void this.room.leave()
  }
}

/** 4 letters, no vowels-that-spell-words-by-accident ambiguity (no I/O/0/1). */
export function newCode(): string {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ'
  let s = ''
  const r = crypto.getRandomValues(new Uint8Array(4))
  for (const b of r) s += A[b % A.length]
  return s
}
