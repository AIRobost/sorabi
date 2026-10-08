// 市区町村データ (漢字・よみ・代表座標) を生成して public/places.json に書き出す。
// 出典: Geolonia 住所データ (https://github.com/geolonia/japanese-addresses, CC BY 4.0)
// 使い方: node scripts/build-places.mjs [ローカルCSVパス]
import { createReadStream, writeFileSync, mkdirSync } from 'node:fs'
import { createInterface } from 'node:readline'
import { Readable } from 'node:stream'

const SRC = 'https://raw.githubusercontent.com/geolonia/japanese-addresses/master/data/latest.csv'
const OUT = new URL('../public/places.json', import.meta.url)

const toHira = (s) => s.replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60))
const median = (a) => {
  a.sort((x, y) => x - y)
  return a[a.length >> 1]
}

async function openInput() {
  const local = process.argv[2]
  if (local) return createReadStream(local)
  const res = await fetch(SRC)
  if (!res.ok) throw new Error(`download failed: ${res.status}`)
  return Readable.fromWeb(res.body)
}

const prefs = new Map()
const rl = createInterface({ input: await openInput(), crlfDelay: Infinity })
let first = true
for await (const line of rl) {
  if (first) {
    first = false
    continue
  }
  const c = line.split(',').map((v) => v.replace(/^"|"$/g, ''))
  const [prefCode, prefName, prefKana, , cityCode, cityName, cityKana] = c
  const lat = Number(c[c.length - 2])
  const lon = Number(c[c.length - 1])
  if (!cityCode || !Number.isFinite(lat) || !Number.isFinite(lon) || lat === 0) continue
  let pref = prefs.get(prefCode)
  if (!pref) prefs.set(prefCode, (pref = { name: prefName, kana: toHira(prefKana), cities: new Map() }))
  let city = pref.cities.get(cityCode)
  if (!city) pref.cities.set(cityCode, (city = { name: cityName, kana: cityKana, lats: [], lons: [] }))
  city.lats.push(lat)
  city.lons.push(lon)
}

// 「余市郡余市町」のような郡付き表記は、郡を分離して町村名で引けるようにする
function splitGun(name, kana) {
  const m = name.match(/^(.+?郡)(.+[町村])$/)
  if (!m) return { name, kana, gun: '' }
  const i = kana.lastIndexOf('グン')
  return { name: m[2], kana: i >= 0 ? kana.slice(i + 2) : kana, gun: m[1] }
}

const out = [...prefs.entries()]
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([, p]) => ({
    name: p.name,
    kana: p.kana,
    cities: [...p.cities.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([code, c]) => {
        const s = splitGun(c.name, c.kana)
        return [s.name, toHira(s.kana), +median(c.lats).toFixed(4), +median(c.lons).toFixed(4), s.gun, code]
      }),
  }))

mkdirSync(new URL('../public/', import.meta.url), { recursive: true })
writeFileSync(OUT, JSON.stringify(out))
const n = out.reduce((s, p) => s + p.cities.length, 0)
console.log(`${out.length} prefectures, ${n} municipalities`)
