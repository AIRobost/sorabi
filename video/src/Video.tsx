import '@fontsource/shippori-mincho/500.css'
import '@fontsource-variable/jost/wght.css'
import React from 'react'
import { AbsoluteFill, Audio, Img, continueRender, delayRender, interpolate, staticFile, useCurrentFrame } from 'remotion'

export const FPS = 30
export const DURATION = 720 // 24秒 = 80BPMで8小節 (1小節 = 90コマ)

const MINCHO = '"Shippori Mincho", serif'
const JOST = '"Jost Variable", sans-serif'
const EASE = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const
const out = (k: number) => 1 - (1 - k) ** 3

// 字幕。parts ごとに出るコマをずらせる (拍やネオンの点灯に合わせるため)
interface Caption {
  from: number
  to: number
  parts: { text: string; at: number }[]
  sub?: string
}
const CAPTIONS: Caption[] = [
  { from: 6, to: 86, parts: [{ text: '日が沈むと、', at: 6 }, { text: '気温が灯る。', at: 30 }] },
  { from: 100, to: 262, parts: [{ text: '空を、そのまま背景に。', at: 100 }] },
  { from: 280, to: 442, parts: [{ text: '雨も、', at: 280 }, { text: '雪も、', at: 360 }, { text: '雷も。', at: 405 }], sub: '降り方は、雨量と風に連動' },
  { from: 460, to: 534, parts: [{ text: '色は、気温。', at: 460 }] },
  { from: 546, to: 582, parts: [{ text: 'デザインは、三つ。', at: 546 }] },
]

const TEXT = CAPTIONS.flatMap((c) => [...c.parts.map((p) => p.text), c.sub ?? '']).join('') + 'Sorabi 空灯空を、灯す。あなたの街は、いま何色。'

// 書体が読み込まれるまで、コマの書き出しを待たせる
if (typeof document !== 'undefined') {
  const handle = delayRender('fonts')
  Promise.all([
    document.fonts.load(`500 60px ${MINCHO}`, TEXT),
    document.fonts.load(`300 40px ${JOST}`, 'Sorabi airobost.github.io/sorabi'),
    document.fonts.load(`200 40px ${JOST}`, 'Sorabi'),
  ]).finally(() => continueRender(handle))
}

const shadow = '0 0 4px rgba(0, 8, 30, 0.45), 0 2px 34px rgba(0, 8, 30, 0.6)'

// 1文字ずつ、ぼかしをほどきながら立ち上がる
const Chars: React.FC<{ text: string; start: number; frame: number }> = ({ text, start, frame }) => (
  <>
    {[...text].map((ch, i) => {
      const k = out(interpolate(frame, [start + i * 1.6, start + i * 1.6 + 16], [0, 1], EASE))
      return (
        <span key={i} style={{ display: 'inline-block', opacity: k, filter: `blur(${(1 - k) * 12}px)`, transform: `translateY(${(1 - k) * 18}px)` }}>
          {ch}
        </span>
      )
    })}
  </>
)

const CaptionLayer: React.FC<{ c: Caption }> = ({ c }) => {
  const frame = useCurrentFrame()
  if (frame < c.from || frame > c.to) return null
  const fade = interpolate(frame, [c.to - 12, c.to], [1, 0], EASE)
  return (
    <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', opacity: fade, filter: `blur(${(1 - fade) * 8}px)` }}>
      <div style={{ marginTop: -70, textAlign: 'center', color: '#fff', textShadow: shadow, fontFamily: MINCHO, fontWeight: 500 }}>
        <div style={{ fontSize: 62, letterSpacing: '0.24em', paddingLeft: '0.24em', whiteSpace: 'nowrap' }}>
          {c.parts.map((p, i) => (
            <Chars key={i} text={p.text} start={p.at} frame={frame} />
          ))}
        </div>
        {c.sub && (
          <div style={{ marginTop: 26, fontSize: 26, letterSpacing: '0.36em', paddingLeft: '0.36em', opacity: 0.86 }}>
            <Chars text={c.sub} start={c.parts[0].at + 14} frame={frame} />
          </div>
        )}
      </div>
    </AbsoluteFill>
  )
}

const END = 630

// 終わりの画面。文言の案を end で切り替える
//  a: 名前とURLだけ
//  b: ひとことを主役にする
//  c: 問いかけで終わる (返信を誘う)
export type EndStyle = 'a' | 'b' | 'c'

const EndCard: React.FC<{ end: EndStyle }> = ({ end }) => {
  const frame = useCurrentFrame()
  if (frame < END) return null
  const f = frame - END
  const veil = out(interpolate(f, [0, 26], [0, 1], EASE))
  const line = (delay: number) => {
    const k = out(interpolate(f, [delay, delay + 22], [0, 1], EASE))
    return { opacity: k, filter: `blur(${(1 - k) * 10}px)`, transform: `translateY(${(1 - k) * 16}px)` }
  }
  const url = (delay: number, top: number) => (
    <div style={{ ...line(delay), marginTop: top, fontFamily: JOST, fontWeight: 300, fontSize: 30, letterSpacing: '0.2em', paddingLeft: '0.2em', opacity: 0.9 }}>
      <span style={{ opacity: 0.86 }}>airobost.github.io/sorabi</span>
    </div>
  )
  const rule = (delay: number, h = 54, m = 40) => <div style={{ ...line(delay), width: 1, height: h, margin: `${m}px 0`, background: 'rgba(255,255,255,0.5)' }} />
  const wordmark = (delay: number, size: number) => (
    <div style={{ ...line(delay), display: 'flex', alignItems: 'baseline', gap: size * 0.5, lineHeight: 1 }}>
      <span style={{ fontFamily: JOST, fontWeight: 200, fontSize: size, letterSpacing: '0.24em' }}>Sorabi</span>
      <span style={{ fontFamily: MINCHO, fontWeight: 500, fontSize: size * 0.62, letterSpacing: '0.5em' }}>空灯</span>
    </div>
  )

  return (
    <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', backgroundColor: `rgba(3, 6, 16, ${veil * 0.74})`, color: '#fff', textAlign: 'center' }}>
      {end === 'a' && (
        <>
          <div style={{ ...line(6), fontFamily: JOST, fontWeight: 200, fontSize: 150, letterSpacing: '0.22em', paddingLeft: '0.22em', lineHeight: 1 }}>Sorabi</div>
          <div style={{ ...line(14), marginTop: 30, fontFamily: MINCHO, fontWeight: 500, fontSize: 40, letterSpacing: '1em', paddingLeft: '1em' }}>空灯</div>
          {rule(24, 60, 48)}
          {url(32, 0)}
        </>
      )}
      {end === 'b' && (
        <>
          <div style={{ ...line(6), fontFamily: MINCHO, fontWeight: 500, fontSize: 92, letterSpacing: '0.34em', paddingLeft: '0.34em', lineHeight: 1.2 }}>空を、灯す。</div>
          {rule(18, 54, 46)}
          {wordmark(26, 44)}
          {url(34, 30)}
        </>
      )}
      {end === 'c' && (
        <>
          <div style={{ ...line(6), fontFamily: MINCHO, fontWeight: 500, fontSize: 68, letterSpacing: '0.3em', paddingLeft: '0.3em', lineHeight: 1.2 }}>あなたの街は、いま何色。</div>
          {rule(20, 54, 46)}
          {wordmark(28, 44)}
          {url(36, 30)}
        </>
      )}
    </AbsoluteFill>
  )
}

export const Video: React.FC<{ music: string | null; end: EndStyle }> = ({ music, end }) => {
  const frame = useCurrentFrame()
  const blur = frame < END ? 0 : out(interpolate(frame - END, [0, 26], [0, 1], EASE)) * 26
  return (
    <AbsoluteFill style={{ backgroundColor: '#05070d' }}>
      <Img
        src={staticFile(`frames/f${String(Math.min(frame, DURATION - 1)).padStart(4, '0')}.jpg`)}
        style={{ width: '100%', height: '100%', filter: blur ? `blur(${blur}px)` : undefined, transform: blur ? `scale(${1 + blur / 400})` : undefined }}
      />
      {CAPTIONS.map((c, i) => (
        <CaptionLayer key={i} c={c} />
      ))}
      <EndCard end={end} />
      {music && <Audio src={staticFile(music)} volume={(f) => interpolate(f, [0, 8, DURATION - 30, DURATION], [0, 1, 1, 0], EASE)} />}
    </AbsoluteFill>
  )
}
