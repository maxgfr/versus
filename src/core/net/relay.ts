/**
 * Fallback transport for when the two phones cannot open a direct WebRTC
 * link (common between two iPhones on one Wi-Fi: Safari hides local
 * addresses and many home routers will not loop traffic back through their
 * public address). Messages then go through public MQTT brokers over
 * WebSocket. Nothing is stored; both phones publish to every broker they
 * reach and drop the duplicates.
 *
 * A minimal MQTT 3.1.1 client: CONNECT, SUBSCRIBE and QoS 0 PUBLISH only.
 */

const BROKERS = ['wss://broker.emqx.io:8084/mqtt', 'wss://broker.hivemq.com:8884/mqtt']

/** What travels on the topic. `k`: h = hello / heartbeat, m = message, b = bye. */
interface Packet {
  f: string
  n: number
  k: 'h' | 'm' | 'b'
  d?: unknown
}

const enc = new TextEncoder()
const dec = new TextDecoder()

function str(s: string): Uint8Array<ArrayBuffer> {
  const b = enc.encode(s)
  const out = new Uint8Array(b.length + 2)
  out[0] = b.length >> 8
  out[1] = b.length & 255
  out.set(b, 2)
  return out
}

function packet(type: number, ...parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const body = parts.reduce((n, p) => n + p.length, 0)
  const len: number[] = []
  let x = body
  do {
    let byte = x % 128
    x = Math.floor(x / 128)
    if (x > 0) byte |= 128
    len.push(byte)
  } while (x > 0)
  const out = new Uint8Array(1 + len.length + body)
  out[0] = type
  out.set(len, 1)
  let o = 1 + len.length
  for (const p of parts) {
    out.set(p, o)
    o += p.length
  }
  return out
}

class Broker {
  private ws: WebSocket | null = null
  private buf = new Uint8Array(0)
  private ping = 0
  private retry = 0
  private closed = false
  ready = false

  constructor(
    private url: string,
    private topic: string,
    private id: string,
    private onMessage: (text: string) => void,
    private onReady: () => void,
  ) {
    this.open()
  }

  private open(): void {
    if (this.closed) return
    let ws: WebSocket
    try {
      ws = new WebSocket(this.url, 'mqtt')
    } catch {
      return
    }
    ws.binaryType = 'arraybuffer'
    this.ws = ws
    ws.onopen = () => {
      const flags = new Uint8Array([0, 4, 77, 81, 84, 84, 4, 2, 0, 30])
      ws.send(packet(0x10, flags, str(this.id.slice(0, 23))))
    }
    ws.onmessage = (e) => this.read(new Uint8Array(e.data as ArrayBuffer))
    ws.onclose = () => {
      this.ready = false
      clearInterval(this.ping)
      if (this.closed) return
      // Back off up to 30 s; iOS drops sockets of backgrounded pages.
      this.retry = Math.min(30_000, (this.retry || 1000) * 2)
      setTimeout(() => this.open(), this.retry)
    }
    ws.onerror = () => ws.close()
  }

  private read(chunk: Uint8Array): void {
    const all = new Uint8Array(this.buf.length + chunk.length)
    all.set(this.buf)
    all.set(chunk, this.buf.length)
    let o = 0
    while (o + 2 <= all.length) {
      let len = 0
      let mul = 1
      let i = o + 1
      let done = false
      while (i < all.length) {
        const b = all[i++] as number
        len += (b & 127) * mul
        mul *= 128
        if (!(b & 128)) {
          done = true
          break
        }
      }
      if (!done || i + len > all.length) break
      this.handle(all[o] as number, all.subarray(i, i + len))
      o = i + len
    }
    this.buf = all.slice(o)
  }

  private handle(type: number, body: Uint8Array): void {
    switch (type >> 4) {
      case 2: // CONNACK
        if (body[1] !== 0) return this.ws?.close()
        this.ws?.send(packet(0x82, new Uint8Array([0, 1]), str(this.topic), new Uint8Array([0])))
        break
      case 9: // SUBACK
        this.ready = true
        this.retry = 0
        this.ping = window.setInterval(() => this.ws?.send(new Uint8Array([0xc0, 0])), 20_000)
        this.onReady()
        break
      case 3: {
        // PUBLISH (QoS 0: no packet id)
        const tl = ((body[0] as number) << 8) | (body[1] as number)
        this.onMessage(dec.decode(body.subarray(2 + tl)))
        break
      }
    }
  }

  publish(text: string): void {
    if (this.ready) this.ws?.send(packet(0x30, str(this.topic), enc.encode(text)))
  }

  close(): void {
    this.closed = true
    clearInterval(this.ping)
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(new Uint8Array([0xe0, 0]))
    this.ws?.close()
  }
}

/**
 * One room on the relay. Finds the other phone by heartbeats, so it also
 * notices a phone that reloaded (new id) or went away (silence).
 */
export class Relay {
  readonly id = Math.random().toString(36).slice(2, 12)
  peer: string | null = null
  private brokers: Broker[] = []
  private seq = 0
  private seen = new Map<string, Set<number>>()
  private lastSeen = 0
  private timer = 0
  private beats = 0
  private closed = false
  private bye = () => this.send('b')

  constructor(
    room: string,
    private onPeer: (id: string | null) => void,
    private onData: (data: unknown) => void,
  ) {
    void this.start(room)
  }

  private async start(room: string): Promise<void> {
    const hash = await crypto.subtle.digest('SHA-256', enc.encode('versus-2p-games-v1/' + room))
    const hex = [...new Uint8Array(hash)]
      .slice(0, 12)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
    if (this.closed) return
    const topic = `versus2p/${hex}`
    this.brokers = BROKERS.map(
      (url) =>
        new Broker(
          url,
          topic,
          `vs-${this.id}`,
          (t) => this.receive(t),
          () => this.send('h'),
        ),
    )
    this.timer = window.setInterval(() => this.tick(), 2000)
    // A reload or a closed tab: let the other phone know at once.
    window.addEventListener('pagehide', this.bye)
  }

  private tick(): void {
    // Heartbeat: every 2 s while alone so the other phone finds us fast, 4 s after.
    if (this.peer === null || ++this.beats % 2 === 0) this.send('h')
    if (this.peer !== null && Date.now() - this.lastSeen > 9000) this.setPeer(null)
  }

  private setPeer(id: string | null): void {
    if (id === this.peer) return
    this.peer = id
    this.onPeer(id)
  }

  private send(k: Packet['k'], d?: unknown): void {
    const p: Packet = { f: this.id, n: ++this.seq, k }
    if (d !== undefined) p.d = d
    const text = JSON.stringify(p)
    for (const b of this.brokers) b.publish(text)
  }

  private receive(text: string): void {
    let p: Packet
    try {
      p = JSON.parse(text) as Packet
    } catch {
      return
    }
    if (!p || typeof p.f !== 'string' || p.f === this.id || typeof p.n !== 'number') return
    // Every broker delivers a copy: keep the first.
    let s = this.seen.get(p.f)
    if (!s) this.seen.set(p.f, (s = new Set()))
    if (s.has(p.n)) return
    s.add(p.n)
    if (s.size > 400) s.delete(s.values().next().value as number)
    if (p.k === 'b') {
      if (p.f === this.peer) this.setPeer(null)
      return
    }
    // Two phones per room: a third one is ignored while ours is alive.
    if (this.peer !== null && p.f !== this.peer) return
    this.lastSeen = Date.now()
    if (this.peer === null) {
      this.setPeer(p.f)
      this.send('h') // answer right away instead of on the next beat
    }
    if (p.k === 'm') this.onData(p.d)
  }

  /** Has at least one broker connection. */
  get online(): boolean {
    return this.brokers.some((b) => b.ready)
  }

  message(data: unknown): void {
    this.send('m', data)
  }

  close(): void {
    this.closed = true
    clearInterval(this.timer)
    window.removeEventListener('pagehide', this.bye)
    this.send('b')
    for (const b of this.brokers) b.close()
  }
}
