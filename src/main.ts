import './fonts'
import './style.css'
import './designs.css'
import { fetchAlerts, type Alerts } from './alerts'
import { icon, iconFor } from './icons'
import { initPicker } from './picker'
import { loadPlaces, type Place } from './places'
import { Sky, skyFromWeather, slantOf, type SkyState } from './sky'
import { compass, describe, fetchWeather, type Weather } from './weather'

const REFRESH = 10 * 60 * 1000
const PANEL_IDLE = 90 * 1000
const DEFAULT: Place = { pref: '東京都', name: '千代田区', kana: 'ちよだく', lat: 35.6936, lon: 139.7624, code: '13101' }

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T
const TZ = 'Asia/Tokyo'
const fmt = (o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('ja-JP', { timeZone: TZ, ...o })
const timeFmt = fmt({ hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
const dateFmt = fmt({ month: 'long', day: 'numeric' })
const weekdayFmt = fmt({ weekday: 'long' })
const hourFmt = fmt({ hour: 'numeric', hourCycle: 'h23' })
const dayFmt = fmt({ weekday: 'short' })
const round = (n: number) => Math.round(n) || 0

function load<T>(key: string): T | null {
  try {
    return JSON.parse(localStorage.getItem(key) ?? 'null')
  } catch {
    return null
  }
}
function save(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // 保存できなくても表示は続ける
  }
}

const stage = $('stage')
const panel = $('panel')
const sky = new Sky($<HTMLCanvasElement>('sky'))

const firstRun = !load<Place>('tenki.place')
let place = load<Place>('tenki.place') ?? DEFAULT
let weather: Weather | null = null

// ?demo=clear|cloudy|rain|heavy|snow|blizzard|fog|thunder、?wind=風速(m/s)、?hour=0-23 で背景だけを確認できる
const params = new URLSearchParams(location.search)
const DEMOS: Record<string, Omit<SkyState, 'slant'>> = {
  clear: { cloud: 0.05, rain: 0, snow: 0, fog: 0, wind: 0.2, thunder: 0 },
  partly: { cloud: 0.45, rain: 0, snow: 0, fog: 0, wind: 0.3, thunder: 0 },
  cloudy: { cloud: 1, rain: 0, snow: 0, fog: 0, wind: 0.3, thunder: 0 },
  heavy: { cloud: 1, rain: 1, snow: 0, fog: 0, wind: 0.7, thunder: 0 },
  blizzard: { cloud: 1, rain: 0, snow: 1, fog: 0, wind: 0.9, thunder: 0 },
  rain: { cloud: 1, rain: 0.55, snow: 0, fog: 0, wind: 0.4, thunder: 0 },
  snow: { cloud: 0.95, rain: 0, snow: 0.8, fog: 0, wind: 0.2, thunder: 0 },
  fog: { cloud: 0.6, rain: 0, snow: 0, fog: 0.85, wind: 0.1, thunder: 0 },
  thunder: { cloud: 1, rain: 1, snow: 0, fog: 0, wind: 0.8, thunder: 1 },
}
const demoBase = DEMOS[params.get('demo') ?? '']
const demoWind = params.has('wind') ? Math.min(1, Number(params.get('wind')) / 15) : demoBase?.wind
const demo: SkyState | undefined = demoBase && { ...demoBase, wind: demoWind, slant: slantOf(demoWind, 250) }
if (params.has('hour')) {
  const offset = (Number(params.get('hour')) - Number(hourFmt.format(new Date()).replace(/\D/g, ''))) * 3600_000
  sky.now = () => Date.now() + offset
}

// ---- 描画 ----

// ネオンを1文字ずつ揺らがせるため、文字ごとに span に分ける。
// 文字数が同じ間は span を使い回し、進行中の揺らぎを途切れさせない
function setChars(el: HTMLElement, text: string) {
  const chars = [...text]
  if (el.children.length !== chars.length || el.childNodes.length !== chars.length) {
    el.replaceChildren(
      ...chars.map(() => {
        const s = document.createElement('span')
        s.className = 'nch'
        // 文字ごとに周期と位相をずらす
        s.style.setProperty('--d', `${(4 + Math.random() * 5).toFixed(2)}s`)
        s.style.setProperty('--o', `${(-Math.random() * 9).toFixed(2)}s`)
        return s
      }),
    )
  }
  chars.forEach((c, i) => {
    if (el.children[i].textContent !== c) el.children[i].textContent = c
  })
}

function tween(el: HTMLElement, to: number) {
  const from = Number(el.dataset.v ?? NaN)
  el.dataset.v = String(to)
  if (!Number.isFinite(from) || from === to) {
    setChars(el, String(to))
    return
  }
  const t0 = performance.now()
  const step = (t: number) => {
    if (el.dataset.v !== String(to)) return
    const k = Math.min(1, (t - t0) / 1400)
    setChars(el, String(round(from + (to - from) * (1 - (1 - k) ** 4))))
    if (k < 1) requestAnimationFrame(step)
  }
  requestAnimationFrame(step)
}

function renderPlace() {
  $('place-pref').textContent = place.pref + (place.gun ? ` ${place.gun}` : '')
  setChars($('place-name'), place.name)
  document.title = `${place.name}の天気 — Sorabi`
  $('settings-place-name').textContent = `${place.pref} ${place.gun ?? ''}${place.name}`
  sky.setPlace(place.lat, place.lon)
}

function renderClock() {
  // 確認用の ?hour= を付けたときは、時計も空と同じ時刻にそろえる
  const now = new Date(sky.now())
  $('time').textContent = timeFmt.format(now)
  $('date').textContent = `${dateFmt.format(now)} ${weekdayFmt.format(now)}`
}

function curve(pts: [number, number][]) {
  let d = `M${pts[0][0]},${pts[0][1]}`
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i]
    const p1 = pts[i]
    const p2 = pts[i + 1]
    const p3 = pts[i + 2] ?? p2
    d += `C${p1[0] + (p2[0] - p0[0]) / 6},${p1[1] + (p2[1] - p0[1]) / 6} ${p2[0] - (p3[0] - p1[0]) / 6},${p2[1] - (p3[1] - p1[1]) / 6} ${p2[0]},${p2[1]}`
  }
  return d
}

function renderHours(w: Weather) {
  const COL = 58
  const H = 52
  const temps = w.hourly.map((h) => h.temp)
  const lo = Math.min(...temps)
  const span = Math.max(...temps) - lo || 1
  const pts = w.hourly.map((h, i): [number, number] => [COL * (i + 0.5), 8 + (H - 16) * (1 - (h.temp - lo) / span)])
  $('hours').innerHTML = `
    <div class="hours-inner">
      <svg class="hours-curve" width="${COL * w.hourly.length}" height="${H}">
        <path d="${curve(pts)}" pathLength="1" />
        ${pts.map(([x, y]) => `<circle cx="${x}" cy="${y}" r="2.2" />`).join('')}
      </svg>
      ${w.hourly
        .map(
          (h, i) => `
        <div class="hour">
          <span class="hour-t">${i === 0 ? '今' : hourFmt.format(h.t)}</span>
          ${icon(iconFor(h.code, h.isDay))}
          <span class="hour-gap"></span>
          <span class="hour-temp">${round(h.temp)}°</span>
          <span class="hour-pop">${h.pop >= 10 ? `${h.pop}%` : ''}</span>
        </div>`,
        )
        .join('')}
    </div>`
}

function renderDays(w: Weather) {
  const lo = Math.min(...w.daily.map((d) => d.min))
  const span = Math.max(...w.daily.map((d) => d.max)) - lo || 1
  $('days').innerHTML = w.daily
    .map(
      (d, i) => `
      <div class="day" style="--i:${i}">
        <span class="day-name">${i === 0 ? '今日' : dayFmt.format(d.t)}</span>
        ${icon(iconFor(d.code, true))}
        <span class="day-pop">${d.pop >= 10 ? `${d.pop}%` : ''}</span>
        <span class="day-min">${round(d.min)}°</span>
        <span class="day-bar"><i style="left:${((d.min - lo) / span) * 100}%;width:${((d.max - d.min) / span) * 100}%"></i></span>
        <span class="day-max">${round(d.max)}°</span>
      </div>`,
    )
    .join('')
}

function renderMetrics(w: Weather) {
  const c = w.current
  const today = w.daily[0]
  const items: [string, string, string][] = [
    ['体感温度', String(round(c.feels)), '°'],
    ['湿度', String(round(c.humidity)), '%'],
    ['風', c.wind.toFixed(1), `m/s ${compass(c.windDir)}`],
    c.snowRate >= 0.1 ? ['降雪', c.snowRate.toFixed(1), 'cm/h'] : ['雨量', c.rainRate.toFixed(1), 'mm/h'],
    ['気圧', String(round(c.pressure)), 'hPa'],
    ['紫外線', String(round(today.uv)), '最大'],
    ['日の出', timeFmt.format(today.sunrise), ''],
    ['日の入', timeFmt.format(today.sunset), ''],
  ]
  $('metrics').innerHTML = items
    .map(([label, value, unit], i) => `<div class="metric" style="--i:${i}"><span>${label}</span><b>${value}<small>${unit}</small></b></div>`)
    .join('')
}

function renderRail(w: Weather) {
  const c = w.current
  const now = sky.now()
  const [today, tomorrow] = w.daily
  const sun: [string, number] =
    now < today.sunrise ? ['日の出', today.sunrise] : now < today.sunset ? ['日の入', today.sunset] : ['日の出', tomorrow.sunrise]
  const metrics: [string, string, string][] = [
    ['湿度', String(round(c.humidity)), '%'],
    ['風', c.wind.toFixed(1), 'm/s'],
    // 降っている間は確率より強さを見せる
    c.snowRate >= 0.1
      ? ['降雪', c.snowRate.toFixed(1), 'cm/h']
      : c.rainRate >= 0.1
        ? ['雨量', c.rainRate.toFixed(1), 'mm/h']
        : ['降水確率', String(w.hourly[0]?.pop ?? 0), '%'],
    [sun[0], timeFmt.format(sun[1]), ''],
  ]
  $('rail-metrics').innerHTML = metrics
    .map(([label, value, unit]) => `<div class="ri"><span>${label}</span><b>${value}<small>${unit}</small></b></div>`)
    .join('')
  $('rail-hours').innerHTML = w.hourly
    .slice(1, 7)
    .map((h) => `<div class="ri"><span>${hourFmt.format(h.t)}</span>${icon(iconFor(h.code, h.isDay))}<b>${round(h.temp)}°</b></div>`)
    .join('')
}

// 環は24時間の文字盤: 真夜中が下、正午が上で、時計回りに進む。
// 昼の時間帯は線を明るくし、現在時刻に印を置く。雨の見込みがある時間には内側へ青い目盛りが伸びる
function renderArc() {
  if (!weather || document.body.dataset.design !== 'c') return
  const { sunrise, sunset } = weather.daily[0]
  const now = sky.now()
  const frac = (t: number) => ((((t + 9 * 3600_000) % 86400_000) + 86400_000) % 86400_000) / 86400_000
  const at = (d: number, r: number) =>
    [500 - r * Math.sin(2 * Math.PI * d), 500 + r * Math.cos(2 * Math.PI * d)].map((v) => v.toFixed(1))
  const line = (cls: string, d: number, r1: number, r2: number, extra = '') => {
    const [x1, y1] = at(d, r1)
    const [x2, y2] = at(d, r2)
    return `<line class="${cls}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"${extra} />`
  }
  const [sr, ss, nw] = [frac(sunrise), frac(sunset), frac(now)]
  const R = 470

  const ticks = Array.from({ length: 24 }, (_, h) => line('ring-tick', h / 24, R, h % 6 ? R - 8 : R - 22)).join('')
  // 降水確率20%以上の時間だけ。長さと濃さが確率を表す
  const rain = weather.hourly
    .filter((h) => h.pop >= 20)
    .map((h) => line('ring-rain', frac(h.t), R - 30, R - 30 - h.pop * 0.42, ` opacity="${(0.3 + h.pop * 0.006).toFixed(2)}"`))
    .join('')
  const [rx, ry] = at(sr, R + 30)
  const [sx, sy] = at(ss, R + 30)
  const [dx, dy] = at(nw, R)
  const day = now >= sunrise && now <= sunset

  $('arc-svg').innerHTML = `
    <circle class="ring-night" cx="500" cy="500" r="${R}" pathLength="1" transform="rotate(90 500 500)" />
    <path class="ring-day" d="M${at(sr, R)}A${R} ${R} 0 ${ss - sr > 0.5 ? 1 : 0} 1 ${at(ss, R)}" />
    ${ticks}${rain}
    <text x="${rx}" y="${ry}" text-anchor="end" dominant-baseline="middle">${timeFmt.format(sunrise)}</text>
    <text x="${sx}" y="${sy}" dominant-baseline="middle">${timeFmt.format(sunset)}</text>
    <circle class="${day ? 'ring-sun' : 'ring-moon'}" cx="${dx}" cy="${dy}" r="${day ? 8 : 9}" />`
}

let ringTimer = 0
function drawRing() {
  const el = $('arc-svg').parentElement!
  el.classList.remove('draw')
  void el.offsetWidth
  el.classList.add('draw')
  // 演出が終わったら外す。残したままだと、毎分の描き直しのたびに演出がやり直されてしまう
  clearTimeout(ringTimer)
  ringTimer = window.setTimeout(() => el.classList.remove('draw'), 4200)
}

function render(w: Weather) {
  const today = w.daily[0]
  tween($('temp'), round(w.current.temp))
  setChars($('cond'), describe(w.current.code))
  $('range').innerHTML = `最高 <b>${round(today.max)}°</b><i></i>最低 <b>${round(today.min)}°</b>`
  renderRail(w)
  renderArc()
  renderHours(w)
  renderDays(w)
  renderMetrics(w)
  sky.setTarget(demo ?? skyFromWeather(w.current))
  renderNeon()
  if (!stage.classList.contains('in')) drawRing()
  stage.classList.add('in')
}

const ALERT_LABEL: Record<number, string> = { 20: '注意報', 30: '警報', 40: '危険警報', 50: '特別警報' }

function renderAlerts(a: Alerts | null) {
  const items = a?.items ?? []
  // 通常表示は重いものから3件まで。全件は詳細パネルに出す
  const chips = items.slice(0, 3).map((x) => `<span class="al" data-l="${x.level}"><i></i>${x.name}</span>`)
  if (items.length > 3) chips.push(`<span class="al al-more">ほか${items.length - 3}件</span>`)
  $('alerts').innerHTML = chips.join('')
  $('alerts-sec').hidden = !items.length
  $('alerts-title').textContent = `警報・注意報　${a?.area ?? ''}`
  $('alerts-list').innerHTML = items
    .map((x) => `<div class="al" data-l="${x.level}"><i></i><span>${x.name}</span><em>${ALERT_LABEL[x.level]}</em></div>`)
    .join('')
}

// ?alerts を付けると見た目の確認用に架空の警報を出す
const DEMO_ALERTS: Alerts = {
  area: '表示確認用',
  items: [
    { name: 'レベル4 大雨危険警報', level: 40 },
    { name: 'レベル3 土砂災害警報', level: 30 },
    { name: '暴風警報', level: 30 },
    { name: '雷注意報', level: 20 },
    { name: '波浪注意報', level: 20 },
  ],
}

async function refreshAlerts() {
  const target = place
  if (params.has('alerts')) return renderAlerts(DEMO_ALERTS)
  if (!target.code) return
  try {
    const a = await fetchAlerts(target.code)
    if (target === place) renderAlerts(a)
  } catch {
    // 取得できないときは直前の表示を残す
  }
}

function renderStatus(failed: boolean) {
  if (!weather) {
    $('updated').textContent = failed ? '取得できません・再試行中' : ''
    return
  }
  const at = timeFmt.format(weather.fetchedAt)
  $('updated').textContent = failed ? `オフライン・${at} 時点` : `${at} 更新`
}

// ---- 更新 ----

let timer = 0
let fails = 0

async function refresh() {
  clearTimeout(timer)
  refreshAlerts()
  const target = place
  let failed = false
  try {
    const w = await fetchWeather(target.lat, target.lon)
    if (target !== place) return
    weather = w
    fails = 0
    save('tenki.weather2', { lat: target.lat, lon: target.lon, w })
    render(w)
  } catch {
    if (target !== place) return
    failed = true
    fails++
  }
  renderStatus(failed)
  timer = window.setTimeout(refresh, failed ? Math.min(REFRESH, 30_000 * 2 ** (fails - 1)) : REFRESH)
}

async function selectPlace(p: Place) {
  place = p
  weather = null
  renderAlerts(null)
  save('tenki.place', p)
  stage.classList.remove('in')
  setPanel(false)
  await new Promise((r) => setTimeout(r, 450))
  if (place !== p) return
  renderPlace()
  refresh()
}

// ---- 詳細パネル ----

let panelTimer = 0
function setPanel(open: boolean) {
  document.body.classList.toggle('open', open)
  panel.setAttribute('aria-hidden', String(!open))
  clearTimeout(panelTimer)
  if (open) panelTimer = window.setTimeout(() => setPanel(false), PANEL_IDLE)
}
const isOpen = () => document.body.classList.contains('open')

stage.addEventListener('click', (e) => {
  if ((e.target as HTMLElement).closest('#place')) return
  if (settingsOpen()) return setSettings(false)
  setPanel(!isOpen())
})
$('panel-close').addEventListener('click', () => setPanel(false))
for (const type of ['pointermove', 'wheel', 'pointerdown'] as const)
  panel.addEventListener(type, () => isOpen() && setPanel(true), { passive: true })

// 縦ホイールで時間予報を横に送る
$('hours').addEventListener(
  'wheel',
  (e) => {
    if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return
    e.preventDefault()
    $('hours').scrollBy({ left: e.deltaY })
  },
  { passive: false },
)

// ---- 設定パネル ----

const settings = $('settings')
const settingsOpen = () => document.body.classList.contains('settings')
function setSettings(open: boolean) {
  document.body.classList.toggle('settings', open)
  settings.setAttribute('aria-hidden', String(!open))
  if (open) setPanel(false)
}
$('gear').addEventListener('click', (e) => {
  // 画面クリック (詳細の開閉) に伝えない
  e.stopPropagation()
  setSettings(!settingsOpen())
})
$('settings-close').addEventListener('click', () => setSettings(false))

// ---- デザイン切替 (1 / 2 / 3 キーでも切り替えられる) ----

const DESIGNS = ['a', 'b', 'c']
let designTimer = 0
function applyDesign(d: string) {
  document.body.dataset.design = d
  renderArc()
}
function setDesign(d: string, animate = true) {
  if (!DESIGNS.includes(d)) d = ['d', 'e', 'f'].includes(d) ? 'c' : 'a'
  save('tenki.design', d)
  for (const b of settings.querySelectorAll<HTMLElement>('[data-design]')) b.classList.toggle('on', b.dataset.design === d)
  clearTimeout(designTimer)
  if (!animate) {
    applyDesign(d)
    return
  }
  stage.classList.remove('in')
  designTimer = window.setTimeout(() => {
    applyDesign(d)
    if (weather) {
      stage.classList.add('in')
      drawRing()
    }
  }, 450)
}
settings.querySelector('.st-designs')!.addEventListener('click', (e) => {
  const d = (e.target as HTMLElement).closest<HTMLElement>('[data-design]')?.dataset.design
  if (d) setDesign(d)
})
setDesign(params.get('design') ?? load<string>('tenki.design') ?? 'a', false)

// ---- ネオン (夕方から気温の数字が点灯する。N キーか左端のボタンで色を変えられる) ----

const NEONS: [string, string | null][] = [
  ['自動 (気温で変わる)', null],
  ['白', '#ffffff'],
  ['黄', '#ffd24a'],
  ['赤', '#ff4d5e'],
  ['青', '#4da3ff'],
  ['桃', '#ff6ad5'],
  ['緑', '#5dffa8'],
]
// 自動のときは気温を色にする: 氷点下の青から、猛暑の赤まで
const TEMP_COLORS: [number, number[]][] = [
  [-5, [140, 215, 255]],
  [8, [90, 170, 255]],
  [16, [120, 255, 220]],
  [22, [255, 244, 214]],
  [28, [255, 196, 84]],
  [33, [255, 128, 64]],
  [38, [255, 64, 96]],
]
function tempColor(t: number) {
  const s = TEMP_COLORS
  const i = Math.max(1, s.findIndex(([at]) => t < at) < 0 ? s.length - 1 : s.findIndex(([at]) => t < at))
  const [t0, c0] = s[i - 1]
  const [t1, c1] = s[i]
  const k = Math.min(1, Math.max(0, (t - t0) / (t1 - t0)))
  return `rgb(${c0.map((v, j) => round(v + (c1[j] - v) * k)).join(' ')})`
}

let neon = load<number>('tenki.neon') ?? 0
let lit = false

// 灯っている間、ときどき1文字だけが不安定になる。大半は一瞬のまたたき、まれに接触不良のようなちらつき
// F キーか左端のボタンで、揺らぎとちらつきをまとめて止められる
let shimmer = load<boolean>('tenki.shimmer') ?? true

function pulse(el: HTMLElement | null | undefined, buzzRate: number) {
  if (!el || !shimmer || !lit || document.hidden || el.classList.contains('buzz') || el.classList.contains('blink')) return
  const kind = Math.random() < buzzRate ? 'buzz' : 'blink'
  el.classList.add(kind)
  el.addEventListener('animationend', () => el.classList.remove(kind), { once: true })
}

function glitch() {
  setTimeout(glitch, 5000 + Math.random() * 13000)
  const chars = stage.querySelectorAll<HTMLElement>('.nch')
  pulse(chars[Math.floor(Math.random() * chars.length)], 0.25)
}
setTimeout(glitch, 8000)

// 地名の2文字目だけは「調子の悪い管」として、ほかより頻繁にちらつく
function weakTube() {
  setTimeout(weakTube, 6000 + Math.random() * 10000)
  pulse($('place-name').children[1] as HTMLElement | undefined, 0.35)
}
setTimeout(weakTube, 5000)

function renderShimmer() {
  document.body.classList.toggle('no-shimmer', !shimmer)
  $('shimmer-label').textContent = shimmer ? 'オン' : 'オフ'
}
function toggleShimmer() {
  shimmer = !shimmer
  save('tenki.shimmer', shimmer)
  renderShimmer()
}
$('shimmer-btn').addEventListener('click', toggleShimmer)
renderShimmer()

function flicker() {
  stage.classList.remove('flick')
  void stage.offsetWidth
  stage.classList.add('flick')
}

function renderNeon() {
  // 太陽が約9度まで下がると灯りはじめ、日没後しばらくで全灯になる
  const k = Math.min(1, Math.max(0, (0.16 - sky.sunElev()) / 0.24))
  const strength = k * k * (3 - 2 * k)
  const [label, fixed] = NEONS[neon] ?? NEONS[0]
  document.body.style.setProperty('--neon', strength.toFixed(3))
  document.body.style.setProperty('--neon-c', fixed ?? tempColor(weather?.current.temp ?? 20))
  $('neon-label').textContent = label + (fixed ? '' : '。夜の数字と天気の色が、気温に合わせて青から赤へ変わります')
  ;[...$('neon-list').children].forEach((b, i) => b.classList.toggle('on', i === neon))
  const on = strength > 0.5
  if (on && !lit) flicker()
  lit = on
}

function setNeon(i: number) {
  neon = i
  save('tenki.neon', neon)
  renderNeon()
  if (lit) flicker()
}
const nextNeon = () => setNeon((neon + 1) % NEONS.length)
$('neon-list').innerHTML = NEONS.map(
  ([label, c], i) =>
    `<button data-neon="${i}" title="${label}" style="--c:${c ?? 'conic-gradient(#5aa9ff, #7dffd9, #fff4d6, #ffc454, #ff4060, #5aa9ff)'}"></button>`,
).join('')
$('neon-list').addEventListener('click', (e) => {
  const i = (e.target as HTMLElement).closest<HTMLElement>('[data-neon]')?.dataset.neon
  if (i) setNeon(Number(i))
})
setInterval(renderNeon, 30_000)
renderNeon()

// ---- 地点選択 ----

const picker = initPicker($('picker'), selectPlace)
$('settings-place').addEventListener('click', () => picker.open())
$('place').addEventListener('click', () => picker.open())
addEventListener('keydown', (e) => {
  if (!picker.isOpen && /^[1-3]$/.test(e.key)) setDesign(DESIGNS[Number(e.key) - 1])
  if (!picker.isOpen && e.key.toLowerCase() === 'n') nextNeon()
  if (!picker.isOpen && e.key.toLowerCase() === 'f') toggleShimmer()
  if (!picker.isOpen && e.key.toLowerCase() === 's') setSettings(!settingsOpen())
  if (e.key !== 'Escape') return
  if (picker.isOpen) picker.close()
  else if (settingsOpen()) setSettings(false)
  else setPanel(false)
})

// ---- 常時表示 ----

// 操作がなければカーソルを隠す
let idleTimer = 0
addEventListener('pointermove', () => {
  document.body.classList.remove('idle')
  clearTimeout(idleTimer)
  idleTimer = window.setTimeout(() => document.body.classList.add('idle'), 4000)
})

// 焼き付き対策: 文字の位置をごくゆっくり動かす
setInterval(() => {
  stage.style.setProperty('--sx', `${round((Math.random() - 0.5) * 12)}px`)
  stage.style.setProperty('--sy', `${round((Math.random() - 0.5) * 12)}px`)
}, 180_000)

let wakeLock: WakeLockSentinel | null = null
async function keepAwake() {
  if (document.visibilityState !== 'visible' || (wakeLock && !wakeLock.released)) return
  try {
    wakeLock = (await navigator.wakeLock?.request('screen')) ?? null
  } catch {
    // 非対応・拒否時はOSの設定に任せる
  }
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return
  keepAwake()
  if (!weather || Date.now() - weather.fetchedAt > REFRESH) refresh()
})
addEventListener('online', () => refresh())

// 4Kなど大きな画面でも密度が変わらないよう、短辺1080pxを基準に全体を拡大する
const BASE = 1080
function fit() {
  const z = Math.max(1, Math.min(innerWidth, innerHeight) / BASE)
  document.documentElement.style.setProperty('--z', z.toFixed(4))
}
addEventListener('resize', fit)
fit()

// ---- 起動 ----

renderPlace()
renderClock()
setInterval(renderClock, 1000)
setInterval(renderArc, 60_000)
keepAwake()

// 以前の版で保存した地点には市区町村コードがないので補う
if (!place.code) {
  const old = place
  loadPlaces().then((prefs) => {
    const row = prefs.find((p) => p.name === old.pref)?.cities.find((c) => c[0] === old.name)
    if (!row || place !== old) return
    place = { ...old, code: row[5] }
    save('tenki.place', place)
    refreshAlerts()
  })
}

const cached = load<{ lat: number; lon: number; w: Weather }>('tenki.weather2')
if (cached && cached.lat === place.lat && cached.lon === place.lon && Date.now() - cached.w.fetchedAt < 3 * 3600_000) {
  weather = cached.w
  render(cached.w)
  renderStatus(false)
}
// 紹介動画の撮影 (video/capture.mjs) では、天気を取得せず、外から状態を1コマずつ与える。
// そのための操作口を、?capture を付けたときだけ公開する
if (params.has('capture')) {
  Object.assign(window, {
    __sorabi: {
      sky,
      skyFromWeather,
      applyDesign,
      drawRing,
      renderClock,
      renderNeon,
      renderArc,
      renderAlerts,
      show(w: Weather) {
        weather = w
        render(w)
      },
      // 数字のアニメーションを挟まずに気温だけ差し替える
      setTemp(t: number) {
        if (!weather) return
        weather.current.temp = t
        // 進行中の数字のアニメーションを止める (目印を数値でなくすと、以後も即座に切り替わる)
        $('temp').dataset.v = 'x'
        setChars($('temp'), String(round(t)))
        renderNeon()
      },
      tick() {
        renderClock()
        renderNeon()
        renderArc()
        if (weather) renderRail(weather)
      },
    },
  })
} else refresh()

// 初めて開いたときは、まず表示する地点を選んでもらう (閉じれば東京のまま使える)
if (firstRun && !params.has('demo')) picker.open('表示する地点を選んでください。あとから設定で変更できます')

if (import.meta.env.PROD && 'serviceWorker' in navigator) navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`)
