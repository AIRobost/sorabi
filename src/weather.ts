export interface Weather {
  fetchedAt: number
  current: {
    temp: number
    feels: number
    humidity: number
    code: number
    isDay: boolean
    cloud: number
    /** 雨の強さ (mm/h) */
    rainRate: number
    /** 雪の強さ (cm/h) */
    snowRate: number
    pressure: number
    wind: number
    windDir: number
    gust: number
  }
  hourly: { t: number; temp: number; pop: number; code: number; isDay: boolean }[]
  daily: { t: number; code: number; max: number; min: number; pop: number; uv: number; sunrise: number; sunset: number }[]
}

const API = 'https://api.open-meteo.com/v1/forecast'

export async function fetchWeather(lat: number, lon: number): Promise<Weather> {
  const q = new URLSearchParams({
    latitude: lat.toFixed(4),
    longitude: lon.toFixed(4),
    current:
      'temperature_2m,relative_humidity_2m,apparent_temperature,is_day,rain,showers,snowfall,weather_code,cloud_cover,pressure_msl,wind_speed_10m,wind_direction_10m,wind_gusts_10m',
    hourly: 'temperature_2m,precipitation_probability,weather_code,is_day',
    daily:
      'weather_code,temperature_2m_max,temperature_2m_min,sunrise,sunset,precipitation_probability_max,uv_index_max',
    timezone: 'Asia/Tokyo',
    timeformat: 'unixtime',
    wind_speed_unit: 'ms',
    forecast_days: '8',
  })
  const res = await fetch(`${API}?${q}`, { signal: AbortSignal.timeout(15000) })
  if (!res.ok) throw new Error(`weather ${res.status}`)
  const j = await res.json()
  const c = j.current
  const h = j.hourly
  const d = j.daily
  const from = Date.now() - 3600_000
  const hourly: Weather['hourly'] = []
  for (let i = 0; i < h.time.length && hourly.length < 24; i++) {
    const t = h.time[i] * 1000
    if (t <= from) continue
    hourly.push({
      t,
      temp: h.temperature_2m[i],
      pop: h.precipitation_probability[i] ?? 0,
      code: h.weather_code[i],
      isDay: h.is_day[i] === 1,
    })
  }
  return {
    fetchedAt: Date.now(),
    current: {
      temp: c.temperature_2m,
      feels: c.apparent_temperature,
      humidity: c.relative_humidity_2m,
      code: c.weather_code,
      isDay: c.is_day === 1,
      cloud: c.cloud_cover,
      // 値は直近 interval 秒の積算なので、1時間あたりに直す
      rainRate: ((c.rain + c.showers) * 3600) / j.current.interval,
      snowRate: (c.snowfall * 3600) / j.current.interval,
      pressure: c.pressure_msl,
      wind: c.wind_speed_10m,
      windDir: c.wind_direction_10m,
      gust: c.wind_gusts_10m,
    },
    hourly,
    daily: (d.time as number[]).slice(0, 7).map((t, i) => ({
      t: t * 1000,
      code: d.weather_code[i],
      max: d.temperature_2m_max[i],
      min: d.temperature_2m_min[i],
      pop: d.precipitation_probability_max[i] ?? 0,
      uv: d.uv_index_max[i] ?? 0,
      sunrise: d.sunrise[i] * 1000,
      sunset: d.sunset[i] * 1000,
    })),
  }
}

// WMO 天気コード → 日本語
const LABELS: Record<number, string> = {
  0: '快晴',
  1: '晴れ',
  2: '晴れ時々曇り',
  3: '曇り',
  45: '霧',
  48: '霧氷',
  51: '弱い霧雨',
  53: '霧雨',
  55: '強い霧雨',
  56: '着氷性の霧雨',
  57: '着氷性の霧雨',
  61: '弱い雨',
  63: '雨',
  65: '強い雨',
  66: '着氷性の雨',
  67: '着氷性の雨',
  71: '弱い雪',
  73: '雪',
  75: '大雪',
  77: '霧雪',
  80: '弱いにわか雨',
  81: 'にわか雨',
  82: '激しいにわか雨',
  85: 'にわか雪',
  86: '強いにわか雪',
  95: '雷雨',
  96: 'ひょうを伴う雷雨',
  99: 'ひょうを伴う雷雨',
}

export const describe = (code: number) => LABELS[code] ?? '—'

const DIRS = ['北', '北北東', '北東', '東北東', '東', '東南東', '南東', '南南東', '南', '南南西', '南西', '西南西', '西', '西北西', '北西', '北北西']
export const compass = (deg: number) => DIRS[Math.round(deg / 22.5) % 16]
