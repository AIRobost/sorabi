export interface Place {
  pref: string
  name: string
  gun?: string
  /** 市区町村コード (5桁) */
  code?: string
  kana: string
  lat: number
  lon: number
}

// [名前, よみ, 緯度, 経度, 郡, 市区町村コード]
type Row = [string, string, number, number, string, string]
export interface Pref {
  name: string
  kana: string
  cities: Row[]
}

export const REGIONS: [string, number, number][] = [
  ['北海道・東北', 0, 7],
  ['関東', 7, 14],
  ['中部', 14, 23],
  ['近畿', 23, 30],
  ['中国', 30, 35],
  ['四国', 35, 39],
  ['九州・沖縄', 39, 47],
]

let cache: Promise<Pref[]> | undefined
export const loadPlaces = (): Promise<Pref[]> =>
  (cache ??= fetch(`${import.meta.env.BASE_URL}places.json`).then((r) => {
    if (!r.ok) throw new Error('places')
    return r.json()
  }))

export const toPlace = (p: Pref, r: Row): Place => ({
  pref: p.name,
  name: r[0],
  kana: r[1],
  lat: r[2],
  lon: r[3],
  gun: r[4] || undefined,
  code: r[5],
})

// 全角半角・カタカナ・「ヶ/ケ」の揺れを吸収して、ひらがな基準で比較する
export const normalize = (s: string) =>
  s
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60))
    .replace(/[ゖゕ]/g, 'け')

export interface Hit {
  pref: Pref
  row: Row
}

export function search(prefs: Pref[], query: string, limit = 60): Hit[] {
  const q = normalize(query)
  if (!q) return []
  const hits: { hit: Hit; score: number }[] = []
  for (const pref of prefs) {
    const pn = normalize(pref.name)
    const prefHit = pn.startsWith(q) || pref.kana.startsWith(q)
    for (const row of pref.cities) {
      const name = normalize(row[0])
      const kana = row[1]
      let score = -1
      if (name.startsWith(q)) score = 0
      else if (kana.startsWith(q)) score = 1
      else if (name.includes(q)) score = 2
      else if (kana.includes(q)) score = 3
      else if ((pn + normalize(row[4]) + name).includes(q)) score = 4
      else if (prefHit) score = 5
      if (score >= 0) hits.push({ hit: { pref, row }, score })
    }
  }
  hits.sort((a, b) => a.score - b.score)
  return hits.slice(0, limit).map((h) => h.hit)
}

export function nearest(prefs: Pref[], lat: number, lon: number): Hit {
  const kx = Math.cos((lat * Math.PI) / 180)
  let best: Hit | undefined
  let bd = Infinity
  for (const pref of prefs)
    for (const row of pref.cities) {
      const dy = row[2] - lat
      const dx = (row[3] - lon) * kx
      const d = dx * dx + dy * dy
      if (d < bd) {
        bd = d
        best = { pref, row }
      }
    }
  return best!
}
