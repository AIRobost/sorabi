// 撮影済みのコマ (public/frames) に字幕と終わりの画面を重ねて、mp4 に書き出す。
// public/music.mp3 (なければ music.wav) を音楽として入れる。
// 使い方: node render.mjs [書き出すコマ番号]   コマ番号を付けると、その1枚だけを out/still-N.png に出す
import { existsSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { bundle } from '@remotion/bundler'
import { renderMedia, renderStill, selectComposition } from '@remotion/renderer'

const here = (p) => fileURLToPath(new URL(p, import.meta.url))
// 用意した曲 (music.mp3) があればそれを、なければ make-music.mjs で作った仮の曲 (music.wav) を使う
const inputProps = { music: ['music.mp3', 'music.wav'].find((f) => existsSync(here('./public/' + f))) ?? null, end: process.env.END ?? 'b' }
// 終わりの画面の文言は END=a|b|c で選ぶ (既定は b「空を、灯す。」)
mkdirSync(here('./out'), { recursive: true })

const serveUrl = await bundle({ entryPoint: here('./src/index.ts') })
const composition = await selectComposition({ serveUrl, id: 'Sorabi', inputProps })

const stills = process.argv.slice(2).map(Number)
if (stills.length) {
  for (const frame of stills) await renderStill({ composition, serveUrl, inputProps, frame, output: here(`./out/still-${frame}-${inputProps.end}.png`) })
} else {
  let last = -1
  await renderMedia({
    composition,
    serveUrl,
    inputProps,
    codec: 'h264',
    crf: 16,
    pixelFormat: 'yuv420p',
    outputLocation: here('./out/sorabi.mp4'),
    onProgress: ({ progress }) => {
      const p = Math.floor(progress * 10)
      if (p !== last) console.log(`${(last = p) * 10}%`)
    },
  })
  console.log(inputProps.music ? 'done (music: ' + inputProps.music + ')' : 'done (no music)')
}
