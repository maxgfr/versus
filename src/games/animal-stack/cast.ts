import { alpha, shade } from '../../core/render/palette.ts'
import { dome, ellipse, makeToy, poly, rect, rrect, type Toy } from './toy.ts'

/**
 * The cast: toy animals with awkward silhouettes. Every outline below is the
 * physics shape, built from convex parts: the giraffe stands on two thin legs
 * under a long neck, the pufferfish rolls on its spikes, the crocodile is long
 * and low, the octopus wobbles on uneven tentacles, the star lands on its points.
 * Sizes and weights differ on purpose (a light pufferfish, a heavy hippo).
 */

const dot = (c: CanvasRenderingContext2D, x: number, y: number, r: number, col: string) => {
  c.beginPath()
  c.arc(x, y, r, 0, Math.PI * 2)
  c.fillStyle = col
  c.fill()
}

export const ANIMALS: readonly Toy[] = [
  makeToy({
    name: 'giraffe',
    color: '#ffd27a',
    density: 0.0011,
    parts: [
      { pts: rrect(0, 0, 136, 58, 18) },
      { pts: poly(22, -20, 54, -20, 62, -150, 34, -150) },
      { pts: rrect(58, -164, 64, 34, 14) },
      { pts: rect(-50, 50, 20, 48) },
      { pts: rect(52, 50, 20, 48) },
    ],
    eyes: [
      [52, -172],
      [72, -170],
    ],
    eyeR: 8,
    mouth: [80, -156],
    paint: (_g, c) => {
      const spot = shade('#ffd27a', -0.35)
      for (const [x, y, r] of [
        [-40, -6, 12],
        [-8, 10, 10],
        [22, -8, 11],
        [50, 6, 9],
        [44, -60, 8],
        [48, -110, 7],
      ] as const)
        dot(c, x, y, r, spot)
    },
  }),
  makeToy({
    name: 'pufferfish',
    color: '#ffcf5c',
    density: 0.0007,
    parts: [
      { pts: ellipse(0, 0, 62, 58, 14) },
      { pts: poly(-54, -4, -96, -34, -96, 30), color: '#ffb13b' },
      { pts: poly(-14, -54, 14, -54, 0, -84) },
      { pts: poly(-14, 54, 14, 54, 0, 84) },
      { pts: poly(30, -48, 50, -32, 56, -66) },
      { pts: poly(30, 48, 50, 32, 56, 66) },
      { pts: poly(-30, -48, -48, -30, -52, -64) },
    ],
    eyes: [
      [20, -16],
      [42, -14],
    ],
    eyeR: 10,
    mouth: [52, 14],
    paint: (_g, c) => {
      c.beginPath()
      c.ellipse(10, 26, 46, 26, 0, 0, Math.PI * 2)
      c.fillStyle = alpha('#ffffff', 0.45)
      c.fill()
    },
  }),
  makeToy({
    name: 'crocodile',
    color: '#7ed957',
    density: 0.0012,
    parts: [
      { pts: rrect(0, 0, 200, 46, 16) },
      { pts: poly(96, -18, 152, -8, 152, 12, 96, 22) },
      { pts: poly(-96, -16, -96, 22, -168, 14) },
      { pts: rect(-58, 30, 26, 22) },
      { pts: rect(54, 30, 26, 22) },
      { pts: ellipse(72, -22, 14, 11, 8) },
    ],
    eyes: [[72, -24]],
    eyeR: 9,
    mouth: [128, 6],
    paint: (_g, c) => {
      const bump = shade('#7ed957', -0.25)
      for (let x = -80; x <= 60; x += 28) dot(c, x, -12, 7, bump)
      c.beginPath()
      c.moveTo(100, 8)
      for (let x = 104; x < 150; x += 10) c.lineTo(x, x % 20 === 4 ? 2 : 8)
      c.strokeStyle = '#ffffff'
      c.lineWidth = 3
      c.stroke()
    },
  }),
  makeToy({
    name: 'octopus',
    color: '#c77dff',
    density: 0.0009,
    parts: [
      { pts: dome(0, 0, 70, 74, 24, 12) },
      { pts: poly(-64, 20, -40, 20, -46, 78, -62, 78) },
      { pts: poly(-28, 20, -6, 20, -10, 66, -26, 66) },
      { pts: poly(6, 20, 28, 20, 26, 72, 10, 72) },
      { pts: poly(40, 20, 64, 20, 62, 64, 46, 64) },
    ],
    eyes: [
      [-22, -22],
      [22, -22],
    ],
    eyeR: 12,
    mouth: [0, 4],
    paint: (_g, c) => {
      const s = alpha('#ffffff', 0.35)
      for (const [x, y] of [
        [-54, 60],
        [-18, 50],
        [18, 56],
        [54, 44],
      ] as const)
        dot(c, x, y, 5, s)
    },
  }),
  makeToy({
    name: 'snail',
    color: '#ffe0b0',
    density: 0.001,
    parts: [
      { pts: rrect(12, 34, 176, 30, 14) },
      { pts: ellipse(-14, -16, 60, 56, 14), color: '#f2a65a' },
      { pts: ellipse(90, 12, 22, 22, 10) },
      { pts: poly(86, -4, 96, -4, 108, -48, 100, -50) },
    ],
    eyes: [[104, -52]],
    eyeR: 9,
    mouth: [100, 18],
    paint: (_g, c) => {
      c.beginPath()
      for (let i = 0; i < 40; i++) {
        const a = i * 0.32
        const r = 6 + i * 1.15
        const x = -14 + Math.cos(a) * r
        const y = -16 + Math.sin(a) * r
        if (i === 0) c.moveTo(x, y)
        else c.lineTo(x, y)
      }
      c.strokeStyle = shade('#f2a65a', -0.35)
      c.lineWidth = 6
      c.stroke()
    },
  }),
  makeToy({
    name: 'ray',
    color: '#6fa8dc',
    density: 0.001,
    parts: [
      { pts: poly(-120, 0, -20, -30, 0, -32, 120, 0, 0, 26, -20, 24) },
      { pts: poly(-112, -4, -112, 4, -196, 2, -196, -2) },
    ],
    eyes: [
      [24, -12],
      [46, -10],
    ],
    eyeR: 7,
    mouth: [40, 8],
    paint: (_g, c) => {
      c.beginPath()
      c.ellipse(10, 6, 60, 12, 0, 0, Math.PI * 2)
      c.fillStyle = alpha('#ffffff', 0.35)
      c.fill()
    },
  }),
  makeToy({
    name: 'hedgehog',
    color: '#d9b08c',
    density: 0.0011,
    parts: [
      { pts: dome(0, 0, 80, 56, 22, 12) },
      { pts: poly(-74, -18, -50, -42, -92, -54), color: '#8a5a3b' },
      { pts: poly(-46, -44, -16, -54, -40, -84), color: '#8a5a3b' },
      { pts: poly(-12, -55, 20, -52, 4, -88), color: '#8a5a3b' },
      { pts: poly(24, -50, 50, -40, 44, -76), color: '#8a5a3b' },
      { pts: poly(74, -4, 74, 18, 108, 10) },
    ],
    eyes: [[56, -16]],
    eyeR: 8,
    mouth: [86, 10],
    paint: (_g, c) => {
      c.beginPath()
      c.ellipse(-20, -14, 56, 30, 0, Math.PI, Math.PI * 2)
      c.fillStyle = shade('#8a5a3b', 0.1)
      c.fill()
      dot(c, 108, 10, 7, '#3a2418')
    },
  }),
  makeToy({
    name: 'hippo',
    color: '#b39ddb',
    density: 0.0018,
    parts: [
      { pts: rrect(-12, 0, 170, 100, 26) },
      { pts: rrect(82, 16, 84, 76, 28) },
      { pts: rect(-62, 58, 32, 26) },
      { pts: rect(30, 58, 32, 26) },
      { pts: ellipse(62, -28, 12, 10, 8) },
    ],
    eyes: [
      [70, -10],
      [96, -8],
    ],
    eyeR: 9,
    mouth: [100, 34],
    paint: (_g, c) => {
      const n = shade('#b39ddb', -0.35)
      dot(c, 108, 18, 5, n)
      dot(c, 120, 18, 5, n)
      c.beginPath()
      c.ellipse(-20, 24, 60, 24, 0, 0, Math.PI * 2)
      c.fillStyle = alpha('#ffffff', 0.18)
      c.fill()
    },
  }),
  makeToy({
    name: 'penguin',
    color: '#4a5a80',
    density: 0.0011,
    parts: [
      { pts: ellipse(0, 0, 46, 72, 14) },
      { pts: poly(38, -32, 38, -16, 64, -24), color: '#ffb13b' },
      { pts: rect(-16, 74, 26, 12), color: '#ffb13b' },
      { pts: rect(16, 74, 26, 12), color: '#ffb13b' },
      { pts: poly(-42, -12, -40, 22, -66, 26) },
    ],
    eyes: [
      [10, -38],
      [28, -36],
    ],
    eyeR: 8,
    mouth: [52, -24],
    paint: (_g, c) => {
      c.beginPath()
      c.ellipse(8, 14, 30, 50, 0, 0, Math.PI * 2)
      c.fillStyle = '#f4f1ea'
      c.fill()
    },
  }),
  makeToy({
    name: 'elephant',
    color: '#b9c2d6',
    density: 0.0016,
    parts: [
      { pts: rrect(-16, 0, 150, 96, 36) },
      { pts: ellipse(70, -22, 48, 44, 12) },
      { pts: poly(98, -12, 116, -6, 112, 66, 98, 66) },
      { pts: rect(-62, 56, 30, 26) },
      { pts: rect(22, 56, 30, 26) },
      { pts: ellipse(42, -20, 24, 34, 10), color: shade('#b9c2d6', -0.15) },
    ],
    eyes: [[82, -34]],
    eyeR: 9,
    mouth: [90, -6],
  }),
  makeToy({
    name: 'sheep',
    color: '#f4f1ea',
    density: 0.0009,
    parts: [
      { pts: ellipse(-46, 0, 34, 32, 10) },
      { pts: ellipse(0, -18, 40, 36, 10) },
      { pts: ellipse(44, 0, 34, 32, 10) },
      { pts: ellipse(-20, 20, 32, 28, 10) },
      { pts: ellipse(24, 20, 32, 28, 10) },
      { pts: ellipse(76, -6, 22, 26, 10), color: '#4a4a5a' },
      { pts: rect(-44, 52, 16, 30), color: '#4a4a5a' },
      { pts: rect(42, 52, 16, 30), color: '#4a4a5a' },
    ],
    eyes: [
      [70, -12],
      [86, -10],
    ],
    eyeR: 7,
    mouth: [82, 6],
  }),
  makeToy({
    name: 'starfish',
    color: '#ff8a65',
    density: 0.001,
    parts: [
      { pts: ellipse(0, 0, 40, 40, 10, -Math.PI / 2, Math.PI * 1.5) },
      ...[0, 1, 2, 3, 4].map((i) => {
        const a = -Math.PI / 2 + (i * Math.PI * 2) / 5
        const b = a + Math.PI / 5
        const b2 = a - Math.PI / 5
        // Blunt tips: a sharp point would rock on the ground forever.
        const tx = -Math.sin(a) * 10
        const ty = Math.cos(a) * 10
        return {
          pts: poly(
            Math.cos(b) * 34,
            Math.sin(b) * 34,
            Math.cos(a) * 76 + tx,
            Math.sin(a) * 76 + ty,
            Math.cos(a) * 76 - tx,
            Math.sin(a) * 76 - ty,
            Math.cos(b2) * 34,
            Math.sin(b2) * 34,
          ),
        }
      }),
    ],
    eyes: [
      [-12, -6],
      [12, -6],
    ],
    eyeR: 8,
    mouth: [0, 12],
    paint: (_g, c) => {
      const s = alpha('#ffffff', 0.4)
      for (let i = 0; i < 5; i++) {
        const a = -Math.PI / 2 + (i * Math.PI * 2) / 5
        dot(c, Math.cos(a) * 52, Math.sin(a) * 52, 5, s)
      }
    },
  }),
  makeToy({
    name: 'caterpillar',
    color: '#9be07a',
    density: 0.0009,
    parts: [
      { pts: ellipse(-104, 4, 26, 26, 10) },
      { pts: ellipse(-56, -2, 28, 28, 10) },
      { pts: ellipse(-6, 4, 28, 28, 10) },
      { pts: ellipse(44, -2, 28, 28, 10) },
      { pts: ellipse(96, -8, 34, 34, 12), color: '#7ccf5c' },
      { pts: poly(86, -40, 92, -40, 84, -72, 80, -70) },
      { pts: poly(104, -40, 110, -40, 118, -70, 112, -72) },
    ],
    eyes: [
      [88, -14],
      [108, -14],
    ],
    eyeR: 8,
    mouth: [100, 8],
  }),
  makeToy({
    name: 'turtle',
    color: '#c5e1a5',
    density: 0.0013,
    parts: [
      { pts: dome(0, 0, 86, 62, 10, 12), color: '#5fae64' },
      { pts: rrect(0, 18, 160, 18, 8) },
      { pts: ellipse(100, 0, 26, 22, 10) },
      { pts: rect(-56, 34, 28, 20) },
      { pts: rect(54, 34, 28, 20) },
    ],
    eyes: [[106, -6]],
    eyeR: 8,
    mouth: [114, 8],
    paint: (_g, c) => {
      c.strokeStyle = shade('#5fae64', -0.3)
      c.lineWidth = 5
      c.beginPath()
      c.moveTo(-30, -48)
      c.lineTo(-48, -6)
      c.moveTo(30, -48)
      c.lineTo(48, -6)
      c.moveTo(-30, -48)
      c.lineTo(30, -48)
      c.moveTo(-48, -6)
      c.lineTo(48, -6)
      c.stroke()
    },
  }),
]
