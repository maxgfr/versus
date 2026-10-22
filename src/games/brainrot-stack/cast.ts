import { alpha, shade } from '../../core/render/palette.ts'
import { dome, ellipse, makeToy, poly, rect, rrect, type Toy } from './toy.ts'

/**
 * The brain-rot cast: nonsense mash-ups, all original. A shark walking in
 * sneakers, a crocodile with plane wings, a log holding a bat, a coffee cup
 * dancing on one leg, a spiky cactus elephant, a stone head, a banana with
 * cat ears, a toaster frog, a pizza-slice dog, a goose on a skateboard, a juice
 * box on legs and a wobbling brain jelly. Every outline is the physics shape,
 * built from convex parts; sizes and weights differ on purpose.
 */

const dot = (c: CanvasRenderingContext2D, x: number, y: number, r: number, col: string) => {
  c.beginPath()
  c.arc(x, y, r, 0, Math.PI * 2)
  c.fillStyle = col
  c.fill()
}

/** A crescent from `n` quads along an arc (each quad is convex). */
function crescent(
  cx: number,
  cy: number,
  r0: number,
  r1: number,
  a0: number,
  a1: number,
  n: number,
): number[][] {
  const out: number[][] = []
  for (let i = 0; i < n; i++) {
    const s = a0 + ((a1 - a0) * i) / n
    const e = a0 + ((a1 - a0) * (i + 1)) / n
    out.push(
      poly(
        cx + Math.cos(s) * r0,
        cy + Math.sin(s) * r0,
        cx + Math.cos(s) * r1,
        cy + Math.sin(s) * r1,
        cx + Math.cos(e) * r1,
        cy + Math.sin(e) * r1,
        cx + Math.cos(e) * r0,
        cy + Math.sin(e) * r0,
      ),
    )
  }
  return out
}

export const CAST: readonly Toy[] = [
  makeToy({
    name: 'sneaker shark',
    color: '#8fb3d9',
    density: 0.0012,
    parts: [
      { pts: rrect(0, 0, 190, 60, 26) },
      { pts: poly(-20, -26, 30, -26, 0, -82) },
      { pts: poly(-90, -10, -90, 12, -138, 34, -138, -36) },
      { pts: rrect(-40, 44, 56, 26, 10), color: '#ff8fb1' },
      { pts: rrect(44, 44, 56, 26, 10), color: '#ff8fb1' },
    ],
    eyes: [
      [56, -10],
      [74, -8],
    ],
    eyeR: 8,
    mouth: [80, 12],
    paint: (_g, c) => {
      c.beginPath()
      c.ellipse(10, 14, 74, 14, 0, 0, Math.PI * 2)
      c.fillStyle = alpha('#ffffff', 0.4)
      c.fill()
      c.strokeStyle = '#ffffff'
      c.lineWidth = 4
      for (const x of [-40, 44]) {
        c.beginPath()
        c.moveTo(x - 20, 40)
        c.lineTo(x + 20, 40)
        c.stroke()
      }
    },
  }),
  makeToy({
    name: 'crocodile plane',
    color: '#7ed957',
    density: 0.0011,
    parts: [
      { pts: rrect(0, 0, 180, 44, 16) },
      { pts: poly(86, -16, 140, -8, 140, 12, 86, 20) },
      { pts: poly(-60, -6, 60, -6, 50, 10, -50, 10), color: '#b0bec5' },
      { pts: rrect(0, 2, 250, 16, 8), color: '#b0bec5' },
      { pts: poly(-90, -14, -70, -14, -100, -64, -114, -60), color: '#b0bec5' },
    ],
    eyes: [[64, -18]],
    eyeR: 9,
    mouth: [118, 6],
    paint: (_g, c) => {
      dot(c, -30, -8, 6, shade('#7ed957', -0.25))
      dot(c, 0, -10, 6, shade('#7ed957', -0.25))
      dot(c, 30, -8, 6, shade('#7ed957', -0.25))
    },
  }),
  makeToy({
    name: 'log drummer',
    color: '#b07a4a',
    density: 0.0012,
    parts: [
      { pts: rrect(0, 0, 76, 180, 32) },
      { pts: rrect(0, 92, 112, 18, 8), color: '#8a5a32' },
      { pts: poly(24, -6, 34, -14, 84, -84, 74, -92), color: '#e8d2a6' },
    ],
    eyes: [
      [-14, -50],
      [12, -50],
    ],
    eyeR: 9,
    mouth: [0, -26],
    paint: (_g, c) => {
      c.strokeStyle = shade('#b07a4a', -0.3)
      c.lineWidth = 4
      for (const y of [20, 50, 80]) {
        c.beginPath()
        c.moveTo(-30, y)
        c.quadraticCurveTo(0, y + 8, 30, y)
        c.stroke()
      }
    },
  }),
  makeToy({
    name: 'cup ballerina',
    color: '#c9a27e',
    density: 0.0009,
    parts: [
      { pts: poly(-60, -50, 60, -50, 42, 34, -42, 34) },
      { pts: poly(-100, 34, 100, 34, 70, 52, -70, 52), color: '#ff9cc8' },
      { pts: rect(0, 82, 14, 60), color: '#ffe0cc' },
      { pts: rrect(0, 116, 66, 14, 6), color: '#ff9cc8' },
      { pts: ellipse(66, -16, 18, 22, 8) },
    ],
    eyes: [
      [-16, -22],
      [16, -22],
    ],
    eyeR: 9,
    mouth: [0, 4],
    paint: (_g, c) => {
      c.beginPath()
      c.ellipse(0, -46, 54, 10, 0, 0, Math.PI * 2)
      c.fillStyle = '#5b3a29'
      c.fill()
    },
  }),
  makeToy({
    name: 'cactus elephant',
    color: '#5fae64',
    density: 0.0014,
    parts: [
      { pts: rrect(-16, 0, 150, 92, 30) },
      { pts: ellipse(68, -20, 44, 40, 12) },
      { pts: poly(94, -10, 110, -4, 106, 62, 94, 62) },
      { pts: rect(-62, 54, 28, 24) },
      { pts: rect(22, 54, 28, 24) },
      { pts: ellipse(44, -22, 22, 30, 10), color: '#b9c2d6' },
      { pts: poly(-70, -40, -50, -40, -60, -78) },
      { pts: poly(-34, -44, -14, -44, -24, -84) },
      { pts: poly(2, -44, 22, -44, 12, -80) },
    ],
    eyes: [[80, -32]],
    eyeR: 9,
    mouth: [88, -6],
    paint: (_g, c) => {
      c.strokeStyle = shade('#5fae64', -0.25)
      c.lineWidth = 3
      for (const x of [-60, -30, 0, 30]) {
        c.beginPath()
        c.moveTo(x, -36)
        c.lineTo(x, 36)
        c.stroke()
      }
      dot(c, 0, -46, 8, '#ff7aa8')
    },
  }),
  makeToy({
    name: 'stone head',
    color: '#9ea7b8',
    density: 0.0017,
    parts: [
      { pts: poly(-54, -110, 54, -110, 62, 110, -62, 110) },
      { pts: rrect(0, -58, 128, 26, 10) },
      { pts: poly(-10, -48, 14, -48, 30, 18, -2, 18) },
    ],
    eyes: [
      [-26, -36],
      [30, -36],
    ],
    eyeR: 8,
    mouth: [6, 56],
    paint: (_g, c) => {
      c.fillStyle = shade('#9ea7b8', -0.2)
      c.fillRect(-40, 70, 80, 10)
      dot(c, -36, 0, 10, alpha('#000000', 0.08))
    },
  }),
  makeToy({
    name: 'banana cat',
    color: '#ffe066',
    density: 0.0008,
    parts: [
      ...crescent(0, -60, 70, 110, Math.PI * 0.2, Math.PI * 0.8, 4).map((pts) => ({ pts })),
      { pts: poly(-88, -10, -64, 4, -96, 26) },
      { pts: poly(-104, 2, -88, -16, -122, -22) },
    ],
    eyes: [
      [-14, 32],
      [12, 34],
    ],
    eyeR: 8,
    mouth: [0, 44],
    paint: (_g, c) => {
      dot(c, 64, -10, 7, '#6b4a1e')
      c.strokeStyle = shade('#ffe066', -0.25)
      c.lineWidth = 3
      c.beginPath()
      c.arc(0, -60, 92, Math.PI * 0.25, Math.PI * 0.75)
      c.stroke()
    },
  }),
  makeToy({
    name: 'toaster frog',
    color: '#c0c7d0',
    density: 0.0014,
    parts: [
      { pts: rrect(0, 0, 130, 90, 24) },
      { pts: ellipse(-34, -50, 22, 18, 10), color: '#7ed957' },
      { pts: ellipse(34, -50, 22, 18, 10), color: '#7ed957' },
      { pts: poly(-62, 30, -40, 30, -46, 62, -90, 62), color: '#7ed957' },
      { pts: poly(40, 30, 62, 30, 90, 62, 46, 62), color: '#7ed957' },
    ],
    eyes: [
      [-34, -52],
      [34, -52],
    ],
    eyeR: 11,
    mouth: [0, 8],
    paint: (_g, c) => {
      c.fillStyle = shade('#c0c7d0', -0.35)
      c.fillRect(-40, -40, 22, 6)
      c.fillRect(18, -40, 22, 6)
      c.fillStyle = '#ff7043'
      c.fillRect(56, -6, 10, 22)
    },
  }),
  makeToy({
    name: 'pizza dog',
    color: '#ffc94d',
    density: 0.001,
    parts: [
      { pts: poly(-80, -46, -80, 46, 110, 0) },
      { pts: rrect(-90, 0, 26, 100, 12), color: '#e8a24a' },
      { pts: poly(-60, -40, -36, -40, -56, -78), color: '#e8a24a' },
      { pts: poly(-28, -34, -6, -30, -14, -70), color: '#e8a24a' },
      { pts: poly(-100, 40, -86, 30, -128, 8), color: '#e8a24a' },
    ],
    eyes: [
      [-44, -12],
      [-20, -10],
    ],
    eyeR: 8,
    mouth: [-30, 12],
    paint: (_g, c) => {
      for (const [x, y] of [
        [10, -6],
        [44, 4],
        [-4, 22],
      ] as const)
        dot(c, x, y, 9, '#e0473b')
    },
  }),
  makeToy({
    name: 'skate goose',
    color: '#f4f1ea',
    density: 0.0009,
    parts: [
      { pts: ellipse(-10, 0, 62, 34, 12) },
      { pts: poly(30, -10, 50, -14, 62, -86, 46, -86) },
      { pts: ellipse(64, -92, 20, 16, 10) },
      { pts: poly(78, -96, 78, -84, 106, -88), color: '#ff9f43' },
      { pts: rrect(0, 44, 160, 14, 6), color: '#ff7043' },
      { pts: ellipse(-52, 58, 10, 10, 8), color: '#37474f' },
      { pts: ellipse(52, 58, 10, 10, 8), color: '#37474f' },
    ],
    eyes: [[68, -96]],
    eyeR: 7,
    mouth: [88, -84],
  }),
  makeToy({
    name: 'juice bot',
    color: '#ffb36b',
    density: 0.001,
    parts: [
      { pts: rrect(0, 0, 92, 130, 14) },
      { pts: poly(20, -64, 28, -64, 44, -120, 36, -122), color: '#ff5d8f' },
      { pts: rect(-30, 82, 18, 36), color: '#5b5f97' },
      { pts: rect(30, 82, 18, 36), color: '#5b5f97' },
      { pts: rrect(-34, 104, 34, 12, 6), color: '#5b5f97' },
      { pts: rrect(34, 104, 34, 12, 6), color: '#5b5f97' },
    ],
    eyes: [
      [-16, -26],
      [16, -26],
    ],
    eyeR: 10,
    mouth: [0, 2],
    paint: (_g, c) => {
      c.fillStyle = alpha('#ffffff', 0.55)
      c.fillRect(-46, 24, 92, 34)
      dot(c, 0, 41, 12, '#7ed957')
    },
  }),
  makeToy({
    name: 'brain jelly',
    color: '#ff9ec7',
    density: 0.0008,
    parts: [
      { pts: dome(0, -10, 74, 64, 20, 12) },
      { pts: poly(-80, 10, 80, 10, 64, 46, -64, 46), color: '#9dff5e' },
    ],
    eyes: [
      [-22, -14],
      [22, -14],
    ],
    eyeR: 10,
    mouth: [0, 30],
    paint: (_g, c) => {
      c.strokeStyle = shade('#ff9ec7', -0.25)
      c.lineWidth = 5
      c.beginPath()
      c.moveTo(0, -70)
      c.lineTo(0, -30)
      c.moveTo(-50, -40)
      c.quadraticCurveTo(-30, -60, -14, -44)
      c.moveTo(50, -40)
      c.quadraticCurveTo(30, -60, 14, -44)
      c.stroke()
    },
  }),
]
