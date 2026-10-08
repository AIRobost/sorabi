// 気象庁の警報・注意報 (2026年5月からの新形式 data/r8)。
// 出典: 気象庁ホームページ https://www.jma.go.jp/bosai/warning/

export interface Alert {
  name: string
  /** 20=注意報 30=警報 40=危険警報 50=特別警報 */
  level: number
}
export interface Alerts {
  area: string
  items: Alert[]
}

const BASE = 'https://www.jma.go.jp/bosai'

const leveled = (name: string, codes: [string, string, string, string]): [string, [string, number]][] => [
  [codes[0], [`レベル5 ${name}特別警報`, 50]],
  [codes[1], [`レベル4 ${name}危険警報`, 40]],
  [codes[2], [`レベル3 ${name}警報`, 30]],
  [codes[3], [`レベル2 ${name}注意報`, 20]],
]

const KINDS: Record<string, [string, number]> = Object.fromEntries([
  ...leveled('大雨', ['33', '43', '03', '10']),
  ...leveled('土砂災害', ['39', '49', '09', '29']),
  ...leveled('高潮', ['38', '48', '08', '19']),
  ['35', ['暴風特別警報', 50]],
  ['05', ['暴風警報', 30]],
  ['15', ['強風注意報', 20]],
  ['32', ['暴風雪特別警報', 50]],
  ['02', ['暴風雪警報', 30]],
  ['13', ['風雪注意報', 20]],
  ['36', ['大雪特別警報', 50]],
  ['06', ['大雪警報', 30]],
  ['12', ['大雪注意報', 20]],
  ['37', ['波浪特別警報', 50]],
  ['07', ['波浪警報', 30]],
  ['16', ['波浪注意報', 20]],
  ['14', ['雷注意報', 20]],
  ['17', ['融雪注意報', 20]],
  ['20', ['濃霧注意報', 20]],
  ['21', ['乾燥注意報', 20]],
  ['22', ['なだれ注意報', 20]],
  ['23', ['低温注意報', 20]],
  ['24', ['霜注意報', 20]],
  ['25', ['着氷注意報', 20]],
  ['26', ['着雪注意報', 20]],
])

interface Area {
  office: string
  code: string
  name: string
}

async function getJson(url: string) {
  const res = await fetch(url, { signal: AbortSignal.timeout(15000) })
  if (!res.ok) throw new Error(`${url} ${res.status}`)
  return res.json()
}

// 市区町村コード → 気象庁の発表区域と担当官署。一度引いたら保存しておく
async function resolveArea(cityCode: string): Promise<Area> {
  const key = `tenki.area.${cityCode}`
  try {
    const saved = JSON.parse(localStorage.getItem(key) ?? 'null')
    if (saved) return saved
  } catch {
    // 読めなければ引き直す
  }
  const table = await getJson(`${BASE}/common/const/area.json`)
  const keys = Object.keys(table.class20s)
  // 政令市の区は市単位で発表されるので、区のコードから市のコードへさかのぼる
  let match: string[] = []
  const n = Number(cityCode)
  for (let c = n; c >= n - 40 && !match.length; c = c === n ? Math.floor(n / 10) * 10 : c - 10)
    match = keys.filter((k) => k.startsWith(String(c).padStart(5, '0')))
  if (!match.length) throw new Error(`no area for ${cityCode}`)
  // 「釧路市釧路 / 釧路市阿寒」のように分割されている場合は先頭 (中心側) の区域を使う
  const code = match[0]
  const c20 = table.class20s[code]
  const area: Area = { code, name: c20.name, office: table.class10s[table.class15s[c20.parent].parent].parent }
  try {
    localStorage.setItem(key, JSON.stringify(area))
  } catch {
    // 保存できなくても続ける
  }
  return area
}

export async function fetchAlerts(cityCode: string): Promise<Alerts> {
  const area = await resolveArea(cityCode)
  const bulletins: any[] = await getJson(`${BASE}/warning/data/r8/${area.office}.json`)
  const found = new Map<string, Alert>()
  for (const b of bulletins)
    for (const item of b.warning?.class20Items ?? []) {
      if (item.areaCode !== area.code) continue
      for (const kind of item.kinds ?? []) {
        const def = KINDS[kind.code]
        if (!def || kind.status === '解除') continue
        found.set(kind.code, { name: def[0], level: def[1] })
      }
    }
  return { area: area.name, items: [...found.values()].sort((a, b) => b.level - a.level) }
}
