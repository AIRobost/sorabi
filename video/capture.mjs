// アプリの実際の描画を、1コマずつ正確に撮る。
// ページ内の時計 (Date / performance.now / タイマー / requestAnimationFrame / CSSアニメーション) を
// すべて仮想の時計に差し替え、1/30秒ずつ進めては撮影する。処理が重くてもコマ落ちしない。
//
// 使い方: アプリを npm run dev (既定 http://localhost:5183) で起動してから  node capture.mjs [開始コマ] [終了コマ]
import { mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import puppeteer from 'puppeteer-core'

const URL = process.env.SORABI_URL ?? 'http://localhost:5183/?capture'
const EDGE = process.env.BROWSER ?? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
const OUT = new globalThis.URL('./public/frames/', import.meta.url)
const FPS = 30
const DT = 1000 / FPS
const TOTAL = 720
const FROM = Number(process.argv[2] ?? 0)
const TO = Number(process.argv[3] ?? TOTAL)

const PLACE = { pref: '石川県', name: '金沢市', kana: 'かなざわし', lat: 36.578, lon: 136.6645, code: '17201' }
const DAY0 = Date.UTC(2026, 9, 8, 15) // 2026-10-09 00:00 JST
const H = 3600_000

// ---- ページに入れる仮想の時計 ----
function installClock(start) {
  let now = start
  let perf = 0
  let id = 1
  const timers = new Map()
  const rafs = new Map()
  const RealDate = Date
  class VDate extends RealDate {
    constructor(...a) {
      if (a.length === 0) super(now)
      else super(...a)
    }
    static now() {
      return now
    }
  }
  window.Date = VDate
  performance.now = () => perf
  window.setTimeout = (fn, ms = 0, ...a) => (timers.set(id, { t: perf + ms, fn, a }), id++)
  window.setInterval = (fn, ms = 0, ...a) => (timers.set(id, { t: perf + ms, fn, a, every: Math.max(1, ms) }), id++)
  window.clearTimeout = window.clearInterval = (i) => timers.delete(i)
  window.requestAnimationFrame = (fn) => (rafs.set(id, fn), id++)
  window.cancelAnimationFrame = (i) => rafs.delete(i)
  window.__setNow = (ms) => (now = ms)
  window.__step = (dt, dateScale = 1) => {
    perf += dt
    now += dt * dateScale
    for (;;) {
      let next = null
      for (const [i, t] of timers) if (t.t <= perf && (!next || t.t < next[1].t)) next = [i, t]
      if (!next) break
      const [i, t] = next
      if (t.every) t.t += t.every
      else timers.delete(i)
      t.fn(...t.a)
    }
    const cbs = [...rafs.values()]
    rafs.clear()
    for (const f of cbs) f(perf)
    // CSSのアニメーションとトランジションも、同じ刻みで手動で進める
    for (const a of document.getAnimations()) {
      if (a.__t === undefined) {
        a.pause()
        a.__t = 0
      }
      a.__t += dt
      const end = a.effect?.getComputedTiming().endTime ?? Infinity
      if (a.__t >= end) a.finish()
      else a.currentTime = a.__t
    }
  }
}

// ---- 天気データ (アプリ内部の形) ----
function weather({ day, temp, code, cloud = 0, rain = 0, snow = 0, wind = 1.2, dir = 250, sun, max = temp + 5, min = temp - 4 }) {
  const base = DAY0 + day * 24 * H
  return {
    fetchedAt: base,
    current: { temp, feels: temp - 1, humidity: 62, code, isDay: true, cloud, rainRate: rain, snowRate: snow, pressure: 1016, wind, windDir: dir, gust: wind * 1.6 },
    hourly: Array.from({ length: 24 }, (_, i) => ({ t: base + (18 + i) * H, temp: temp - 2 + Math.sin(i / 4) * 3, pop: rain || snow ? 80 : 0, code, isDay: i > 12 })),
    daily: Array.from({ length: 7 }, (_, i) => ({
      t: base + i * 24 * H,
      code: i ? 1 : code,
      max,
      min,
      pop: 0,
      uv: 4,
      sunrise: sun.rise + (day + i) * 24 * H,
      sunset: sun.set + (day + i) * 24 * H,
    })),
  }
}

const ease = (k) => k * k * (3 - 2 * k)
const diurnal = (ms) => 13 + 6 * Math.cos((((ms - DAY0) / H - 14) / 24) * 2 * Math.PI) // 14時に最高

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: true,
  args: ['--hide-scrollbars', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
})
const page = await browser.newPage()
page.on('pageerror', (e) => console.error('page error:', e.message))
await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 })
await page.evaluateOnNewDocument(installClock, DAY0 + 12 * H)
await page.evaluateOnNewDocument((place) => {
  localStorage.setItem('tenki.place', JSON.stringify(place))
  localStorage.setItem('tenki.design', '"a"')
  localStorage.setItem('tenki.neon', '0')
  localStorage.setItem('tenki.shimmer', 'true')
}, PLACE)
await page.goto(URL, { waitUntil: 'networkidle2' })
await page.addStyleTag({
  content: `
  /* 気温を1コマずつ差し替えるので、色の追従を遅らせない */
  .temp > span { transition: none !important; }
  /* デザインを切り替える瞬間だけ、移動のアニメーションを止めてカットにする */
  body.cut, body.cut * { transition: none !important; }
  * { cursor: none !important; }`,
})

// 使う文字の書体を先に読み込む (読み込み前のコマに代替書体が写らないように)
await page.evaluate(async () => {
  const text = '0123456789°:-.%/msmcmhPa 金沢市石川県快晴れ雨強い雪雷時々曇り最高低湿度風降水確率日の出入量月曜火水木金土更新設定詳細レベル大警報注意'
  const fonts = ['400 20px "Shippori Mincho"', '500 20px "Shippori Mincho"', '300 20px "Zen Kaku Gothic New"', '400 20px "Zen Kaku Gothic New"', '300 20px "Cormorant Garamond"', '400 20px "Cormorant Garamond"', '200 20px "Jost Variable"', '300 20px "Jost Variable"', '400 20px "Jost Variable"']
  await Promise.all(fonts.map((f) => document.fonts.load(f, text)))
})

// 太陽高度 (sin) が指定の値になる時刻を、午後の範囲で二分探索する
const timeAtElev = (target, from, to) =>
  page.evaluate(
    (target, from, to) => {
      for (let i = 0; i < 40; i++) {
        const mid = (from + to) / 2
        __setNow(mid)
        if (__sorabi.sky.sunElev() > target) from = mid
        else to = mid
      }
      return (from + to) / 2
    },
    target,
    from,
    to,
  )
const morningAtElev = (target, from, to) =>
  page.evaluate(
    (target, from, to) => {
      for (let i = 0; i < 40; i++) {
        const mid = (from + to) / 2
        __setNow(mid)
        if (__sorabi.sky.sunElev() < target) from = mid
        else to = mid
      }
      return (from + to) / 2
    },
    target,
    from,
    to,
  )

const sun = { rise: await morningAtElev(0, DAY0 + 3 * H, DAY0 + 9 * H), set: await timeAtElev(0, DAY0 + 12 * H, DAY0 + 21 * H) }
const duskStart = await timeAtElev(0.11, DAY0 + 12 * H, DAY0 + 21 * H) // ネオンが灯る前
const duskEnd = await timeAtElev(-0.1, DAY0 + 12 * H, DAY0 + 21 * H) // 全灯

const show = (w, opts = {}) =>
  page.evaluate(
    (w, { snap, alerts, cut, design, ring }) => {
      if (cut) document.body.classList.add('cut')
      if (design) __sorabi.applyDesign(design)
      __sorabi.show(w)
      if (snap) __sorabi.sky.snap()
      if (alerts !== undefined) __sorabi.renderAlerts(alerts)
      if (ring) __sorabi.drawRing()
    },
    w,
    opts,
  )
const step = (scale = 1) =>
  page.evaluate(
    (dt, scale) => {
      __step(dt, scale)
      __sorabi.tick()
      document.body.classList.remove('cut')
    },
    DT,
    scale,
  )
const call = (fn, ...args) => page.evaluate(fn, ...args)

const fair = { code: 1, cloud: 22, wind: 1.5, max: 19, min: 7 }

// ---- 助走: 入場アニメーションを終わらせ、夕暮れの直前で待つ ----
await call((t) => __setNow(t), duskStart)
await show(weather({ day: 0, temp: 11, sun, ...fair }), { snap: true })
for (let i = 0; i < 170; i++) await step(0)

mkdirSync(OUT, { recursive: true })
const t0 = Date.now()
for (let f = 0; f < TOTAL; f++) {
  let scale = 1

  if (f < 90) {
    // 1小節目: 夕暮れ。約50分を3秒で進め、ネオンが灯る
    scale = (duskEnd - duskStart) / 3000
  } else if (f < 270) {
    // 2〜3小節目: 24時間を6秒で。雲も速く流す
    if (f === 90) await call(() => (__sorabi.sky.speed = 26))
    scale = (24 * H) / 6000
    const now = duskEnd + (f - 90) * DT * scale
    if (f === 90 + Math.ceil((DAY0 + 24 * H - duskEnd) / (DT * scale))) await show(weather({ day: 1, temp: diurnal(now), sun, ...fair }))
    await call((t) => __sorabi.setTemp(t), diurnal(now))
  } else if (f < 450) {
    // 4〜5小節目: 雨 → 豪雨 → 雪 → 雷。2拍 (45コマ) ごとに切り替える
    const shot = Math.floor((f - 270) / 45)
    if ((f - 270) % 45 === 0) {
      await call(() => (__sorabi.sky.speed = 1))
      const shots = [
        [14, { temp: 17, code: 63, cloud: 100, rain: 6, wind: 5 }, null],
        [21, { temp: 19, code: 65, cloud: 100, rain: 38, wind: 9 }, { area: '金沢市', items: [{ name: 'レベル3 大雨警報', level: 30 }, { name: '雷注意報', level: 20 }] }],
        [22.5, { temp: -2, code: 73, cloud: 100, snow: 2.4, wind: 3 }, { area: '金沢市', items: [{ name: '大雪注意報', level: 20 }] }],
        [20, { temp: 24, code: 95, cloud: 100, rain: 30, wind: 7 }, { area: '金沢市', items: [{ name: '雷注意報', level: 20 }] }],
      ]
      const [hour, w, alerts] = shots[shot]
      await call((t) => __setNow(t), DAY0 + 24 * H + hour * H)
      await show(weather({ day: 1, sun, ...w }), { snap: true, alerts })
      await call((t) => __sorabi.setTemp(t), w.temp)
    }
    if (shot === 3 && [3, 9, 24].includes((f - 270) % 45)) await call(() => __sorabi.sky.strike())
  } else if (f < 540) {
    // 6小節目: 気温で色が変わる。2℃から35℃へ
    if (f === 450) {
      await call((t) => __setNow(t), DAY0 + 24 * H + 22 * H)
      await show(weather({ day: 1, temp: 2, code: 0, cloud: 0, sun, max: 35, min: 2 }), { snap: true, alerts: null })
    }
    await call((t) => __sorabi.setTemp(t), 2 + 33 * ease(Math.min(1, (f - 450) / 78)))
  } else {
    // 7〜8小節目: 墨 → 計 → 環。環のまま終わりの画面へ
    if (f === 540) {
      await call((t) => __setNow(t), DAY0 + 24 * H + 19.5 * H)
      await show(weather({ day: 1, temp: 12, sun, ...fair }), { snap: true, cut: true, design: 'a' })
      await call((t) => __sorabi.setTemp(t), 12)
    }
    if (f === 562) await show(weather({ day: 1, temp: 12, sun, ...fair }), { cut: true, design: 'b' })
    if (f === 585) await show(weather({ day: 1, temp: 12, sun, ...fair }), { cut: true, design: 'c' })
  }

  await step(scale)
  if (f >= FROM && f < TO) await page.screenshot({ path: fileURLToPath(new globalThis.URL(`f${String(f).padStart(4, '0')}.jpg`, OUT)), type: 'jpeg', quality: 93 })
  if (f % 30 === 29) console.log(`${f + 1}/${TOTAL}  ${((Date.now() - t0) / 1000).toFixed(0)}s`)
}
await browser.close()
