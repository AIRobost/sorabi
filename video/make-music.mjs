// 仮の音楽を計算で作る: 80BPM・8小節 (24秒) の、ベースとドラムだけのローファイ。
// 素材を使わずに波形を直接合成するので、権利上の制約がない。
// 使い方: node make-music.mjs   → public/music.wav
import { mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const SR = 44100
const BPM = 80
const BEAT = 60 / BPM
const BARS = 8
const LEN = Math.round(BARS * 4 * BEAT * SR)
const L = new Float32Array(LEN)
const R = new Float32Array(LEN)

// 再現できる乱数 (毎回同じ音になる)
let seed = 7
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296)

const add = (start, dur, fn, pan = 0) => {
  const s0 = Math.round(start * SR)
  const n = Math.round(dur * SR)
  const gl = Math.cos(((pan + 1) * Math.PI) / 4)
  const gr = Math.sin(((pan + 1) * Math.PI) / 4)
  for (let i = 0; i < n && s0 + i < LEN; i++) {
    if (s0 + i < 0) continue
    const v = fn(i / SR, i)
    L[s0 + i] += v * gl * Math.SQRT2
    R[s0 + i] += v * gr * Math.SQRT2
  }
}

// キック: 低い正弦波の音程を素早く下げる
const kick = (t, vel = 1) =>
  add(t, 0.45, (x) => {
    const f = 46 + 70 * Math.exp(-x * 26)
    return Math.sin(2 * Math.PI * (46 * x + (70 / 26) * (1 - Math.exp(-x * 26)))) * Math.exp(-x * 7.5) * 0.9 * vel * (f > 0 ? 1 : 1)
  })

// リムショット: 短い音程 + こもったノイズ
const rim = (t, vel = 1) => {
  let lp = 0
  add(
    t,
    0.16,
    (x) => {
      lp += (rnd() * 2 - 1 - lp) * 0.32
      return (Math.sin(2 * Math.PI * 410 * x) * 0.5 + Math.sin(2 * Math.PI * 760 * x) * 0.25 + lp * 0.9) * Math.exp(-x * 42) * 0.34 * vel
    },
    0.12,
  )
}

// ハイハット: 高域だけ残したごく短いノイズ
const hat = (t, vel = 1, pan = -0.2) => {
  let prev = 0
  add(
    t,
    0.07,
    (x) => {
      const n = rnd() * 2 - 1
      const hp = n - prev
      prev = n
      return hp * Math.exp(-x * 70) * 0.085 * vel
    },
    pan,
  )
}

// サブベース: 正弦波に少しだけ倍音を足し、丸い立ち上がりにする
const bass = (t, dur, freq, vel = 1) =>
  add(t, dur + 0.12, (x) => {
    const env = Math.min(1, x / 0.018) * (x < dur ? 1 : Math.exp(-(x - dur) * 30))
    const p = 2 * Math.PI * freq * x
    return (Math.sin(p) + 0.22 * Math.sin(2 * p) + 0.06 * Math.sin(3 * p)) * env * 0.5 * vel
  })

const N = { F1: 43.65, G1: 49.0, A1: 55.0, C2: 65.41, D2: 73.42, E2: 82.41 }
const SWING = 0.09 * BEAT // 裏拍を少し後ろへずらす

for (let bar = 0; bar < BARS; bar++) {
  const b = bar * 4 * BEAT
  const even = bar % 2 === 0
  const last = bar === BARS - 1

  // ドラム
  kick(b)
  if (!last) kick(b + 2.5 * BEAT + SWING, 0.82)
  if (even) kick(b + 1.75 * BEAT, 0.5)
  rim(b + 1 * BEAT)
  if (!last) rim(b + 3 * BEAT, 0.92)
  for (let i = 0; i < 8; i++) {
    if (last && i > 3) break
    const off = i % 2 ? SWING : 0
    hat(b + i * 0.5 * BEAT + off + (rnd() - 0.5) * 0.006, i % 2 ? 0.55 + rnd() * 0.2 : 1, i % 2 ? 0.25 : -0.2)
  }

  // ベース: 2小節で一巡する
  if (even) {
    bass(b, 1.4 * BEAT, N.A1)
    bass(b + 2.5 * BEAT + SWING, 0.7 * BEAT, N.A1, 0.85)
    bass(b + 3.5 * BEAT + SWING, 0.4 * BEAT, N.C2, 0.8)
  } else if (!last) {
    bass(b, 1.4 * BEAT, N.F1)
    bass(b + 2 * BEAT, 0.9 * BEAT, N.G1, 0.9)
    bass(b + 3.5 * BEAT + SWING, 0.4 * BEAT, N.E2, 0.7)
  } else {
    bass(b, 3.2 * BEAT, N.A1) // 最後は伸ばして終わる
  }
}

// レコードのノイズ: 薄い下地と、まばらな「パチッ」
let lp = 0
for (let i = 0; i < LEN; i++) {
  lp += (rnd() * 2 - 1 - lp) * 0.06
  const v = lp * 0.012
  L[i] += v
  R[i] += v
}
for (let i = 0; i < 110; i++) {
  const at = rnd() * BARS * 4 * BEAT
  add(at, 0.004, (x) => (rnd() * 2 - 1) * Math.exp(-x * 900) * (0.02 + rnd() * 0.05), rnd() * 2 - 1)
}

// 仕上げ: 高域を丸め、軽く歪ませて、頭と終わりをなめらかにする
const fadeOut = Math.round(1.6 * SR)
for (const ch of [L, R]) {
  let y = 0
  for (let i = 0; i < LEN; i++) {
    y += (ch[i] - y) * 0.42
    let v = Math.tanh(y * 1.5) * 0.82
    v *= Math.min(1, i / (0.01 * SR)) * Math.min(1, (LEN - i) / fadeOut)
    ch[i] = v
  }
}

// 16bit ステレオの WAV として書き出す
const data = Buffer.alloc(LEN * 4)
let peak = 0
let sum = 0
for (let i = 0; i < LEN; i++) {
  peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]))
  sum += L[i] * L[i]
  data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, L[i])) * 32767), i * 4)
  data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, R[i])) * 32767), i * 4 + 2)
}
const head = Buffer.alloc(44)
head.write('RIFF', 0)
head.writeUInt32LE(36 + data.length, 4)
head.write('WAVEfmt ', 8)
head.writeUInt32LE(16, 16)
head.writeUInt16LE(1, 20)
head.writeUInt16LE(2, 22)
head.writeUInt32LE(SR, 24)
head.writeUInt32LE(SR * 4, 28)
head.writeUInt16LE(4, 32)
head.writeUInt16LE(16, 34)
head.write('data', 36)
head.writeUInt32LE(data.length, 40)

const out = fileURLToPath(new URL('./public/music.wav', import.meta.url))
mkdirSync(fileURLToPath(new URL('./public/', import.meta.url)), { recursive: true })
writeFileSync(out, Buffer.concat([head, data]))
console.log(`${(LEN / SR).toFixed(2)}s  peak ${peak.toFixed(2)}  rms ${Math.sqrt(sum / LEN).toFixed(3)}  → ${out}`)
