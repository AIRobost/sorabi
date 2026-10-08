import type { Weather } from './weather'

export interface SkyState {
  cloud: number
  rain: number
  snow: number
  fog: number
  wind: number
  /** 雨・雪の傾き (進む向きの tan。正で右へ流れる) */
  slant: number
  thunder: number
}

// 天気コードだけが雨・雪を示していて降水量が0のときの下限に使う
const RAIN: Record<number, number> = { 51: 0.2, 53: 0.3, 55: 0.4, 56: 0.3, 57: 0.4, 61: 0.4, 63: 0.65, 65: 1, 66: 0.4, 67: 0.7, 80: 0.4, 81: 0.7, 82: 1, 95: 0.85, 96: 1, 99: 1 }
const SNOW: Record<number, number> = { 71: 0.35, 73: 0.65, 75: 1, 77: 0.4, 85: 0.5, 86: 1 }

// 風速 (0-1 に正規化済み) と風向から、降るものの傾きを決める。5m/sで15度ほど、15m/s以上で40度ほど。
// 画面は南向きの空なので、西風 (270度) は左へ流れる
export function slantOf(wind: number, dirDeg: number) {
  const s = Math.sin((dirDeg * Math.PI) / 180)
  return (s < 0 ? -1 : 1) * (0.45 + 0.55 * Math.abs(s)) * wind * 0.9
}

export function skyFromWeather(c: Weather['current']): SkyState {
  // 強さは降水強度に連動させる。雨は50mm/h、雪は5cm/hで最大
  const curve = (rate: number, full: number) => Math.min(1, Math.log2(1 + rate) / Math.log2(1 + full))
  const rain = Math.max(curve(c.rainRate, 50), RAIN[c.code] ? 0.12 : 0)
  const snow = Math.max(curve(c.snowRate, 5), SNOW[c.code] ? 0.15 : 0)
  const fog = c.code === 45 || c.code === 48 ? 0.85 : 0
  let cloud = c.cloud / 100
  if (rain > 0.05 || snow > 0.05) cloud = Math.max(cloud, 0.85)
  if (fog) cloud = Math.max(cloud, 0.6)
  const wind = Math.min(1, c.wind / 15)
  return { cloud, rain, snow, fog, wind, slant: slantOf(wind, c.windDir), thunder: c.code >= 95 ? 1 : 0 }
}

// 太陽の高度と方位 (南を0、西を正とするラジアン)
function sunPosition(ms: number, lat: number, lon: number) {
  const rad = Math.PI / 180
  const d = ms / 86400000 - 10957.5
  const g = (357.528 + 0.9856003 * d) * rad
  const lam = (280.46 + 0.9856474 * d + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * rad
  const eps = 23.439 * rad
  const ra = Math.atan2(Math.cos(eps) * Math.sin(lam), Math.cos(lam))
  const dec = Math.asin(Math.sin(eps) * Math.sin(lam))
  const gmst = 18.697374558 + 24.06570982441908 * d
  const ha = (gmst * 15 + lon) * rad - ra
  const phi = lat * rad
  const elev = Math.asin(Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(ha))
  const az = Math.atan2(Math.sin(ha), Math.cos(ha) * Math.sin(phi) - Math.tan(dec) * Math.cos(phi))
  return { elev, az }
}

const VERT = `attribute vec2 p; void main(){ gl_Position = vec4(p, 0.0, 1.0); }`

const FRAG = `
precision highp float;
uniform vec2 uRes;
uniform float uTime;
uniform vec2 uDrift;
uniform vec2 uSun;
uniform float uElev;
uniform float uCloud, uRain, uSnow, uFog, uFlash, uWind, uSlant;

float hash(vec2 p){
  vec3 p3 = fract(vec3(p.xyx) * .1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

// 周期つきバリューノイズ。ドリフト量を周期で折り返せるので長時間動かしても精度が落ちない
float noise(vec2 p, float per){
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3. - 2. * f);
  float a = hash(mod(i, per));
  float b = hash(mod(i + vec2(1., 0.), per));
  float c = hash(mod(i + vec2(0., 1.), per));
  float d = hash(mod(i + vec2(1., 1.), per));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

float fbm(vec2 p){
  float v = 0., a = .5, s = 1.;
  for (int i = 0; i < 5; i++) {
    v += a * noise(p * s + float(i) * 17.3, 512. * s);
    a *= .5; s *= 2.;
  }
  return v;
}

// 雨筋の1層。列ごとに落下速度、1本ごとに長さ・太さ・傾き・明るさを変え、
// 筋の途中にも光のムラを入れて、光を拾った水滴の透明感を出す
float rainLayer(vec2 uv, float asp, float sc, float sp, float seed, float dens, float soft){
  float sl = uSlant * (.82 + .4 * hash(vec2(seed, 3.)));
  sl *= 1. + .13 * sin(uTime * .6 + uv.y * 2.3 + seed);
  float x = (uv.x * asp + uv.y * sl) * sc;
  float cx = floor(x);
  float hc = hash(vec2(cx, seed));
  float y = uv.y * sc * .07 + uTime * sp * (.72 + .56 * hc) + hc * 31.;
  vec2 id = vec2(cx, floor(y));
  float fx = fract(x), fy = fract(y);
  float h1 = hash(id + seed), h2 = hash(id + seed + 7.3), h3 = hash(id + seed + 13.1);
  float w = mix(.03, .085, h3 * h3) * soft;
  float d = abs(fx + (fy - .5) * (h2 - .5) * .5 - .5 - (h1 - .5) * .4);
  float len = mix(.25, .95, h2);
  float prof = smoothstep(0., .05, fy) * (1. - smoothstep(len * .25, len, fy));
  float glint = mix(1., smoothstep(.25, .75, noise(vec2(fy * 15., h1 * 91.), 64.)), .8);
  float bright = mix(.22, 1., h3 * h3 * h3);
  return smoothstep(w, w * .15, d) * prof * glint * bright * step(1. - dens, h1);
}

float snowLayer(vec2 uv, float asp, float sc, float sp, float seed){
  vec2 p = vec2(uv.x * asp + uv.y * uSlant * .8, uv.y) * sc;
  p.y += uTime * sp;
  p.x += sin(uTime * .35 + p.y * .6 + seed) * .35 + uTime * .2;
  vec2 id = floor(p), f = fract(p) - .5;
  vec2 o = (vec2(hash(id + seed), hash(id + seed + 4.)) - .5) * .6;
  float r = .05 + .07 * hash(id + seed + 8.);
  return smoothstep(r, r * .15, length(f - o)) * step(1. - (.25 + .65 * uSnow), hash(id + seed + 2.));
}

void main(){
  vec2 uv = gl_FragCoord.xy / uRes;
  float asp = uRes.x / uRes.y;
  float day = smoothstep(-.14, .17, uElev);
  float tw = exp(-pow(uElev / .17, 2.));
  float wet = max(uRain, uSnow * .45);

  // 空のグラデーション
  float g = pow(1. - uv.y, 1.7);
  vec3 zen = mix(vec3(.008, .014, .045), vec3(.06, .24, .60), day);
  vec3 hor = mix(vec3(.03, .05, .12), vec3(.40, .62, .88), day);
  vec3 col = mix(zen, hor, g);

  // 薄明
  float sx = exp(-abs(uv.x - uSun.x) * asp * 1.3);
  col += tw * vec3(1., .42, .17) * exp(-uv.y * 2.1) * (.35 + .65 * sx) * 1.05;
  col += tw * vec3(.34, .12, .30) * exp(-uv.y * 1.1) * .3;

  // 星
  float night = 1. - smoothstep(-.22, -.02, uElev);
  vec2 sp = gl_FragCoord.xy / uRes.y * 170.;
  vec2 si = floor(sp);
  float sh = hash(si);
  vec2 so = (vec2(hash(si + 1.), hash(si + 2.)) - .5) * .6;
  float star = step(.986, sh) * smoothstep(.14, 0., length(fract(sp) - .5 - so));
  star *= .55 + .45 * sin(uTime * (1. + sh * 3.) + sh * 40.);
  col += star * night * (.35 + .65 * uv.y) * (1. - uCloud);

  // 太陽
  vec2 sd = vec2((uv.x - uSun.x) * asp, uv.y - uSun.y);
  float d2 = dot(sd, sd);
  float sunVis = smoothstep(-.09, .02, uElev);
  vec3 sunCol = mix(vec3(1., .5, .22), vec3(1., .95, .84), smoothstep(0., .35, uElev));
  float sun = exp(-d2 * 900.) * 1.1 + exp(-d2 * 28.) * .32 + exp(-sqrt(d2) * 2.2) * .2;
  col += sunCol * sun * sunVis * (1. - uCloud * .88);

  // 曇天の色調
  float ov = smoothstep(.35, 1., uCloud);
  vec3 gray = mix(vec3(.032, .037, .052), vec3(.47, .52, .58), day) * (.72 + .4 * g) * (1. - .38 * wet);
  gray += tw * vec3(.24, .09, .05) * exp(-uv.y * 3.);
  col = mix(col, gray, ov * .86);

  // 雲
  float h = uv.y * .85 + .3;
  vec2 cp = vec2((uv.x - .5) * asp / h, 1.6 / h) * 1.1 + uDrift;
  float th = mix(.72, .29, uCloud);
  float n = fbm(cp);
  float dens = smoothstep(th, th + .28, n);
  vec2 ld = normalize(uSun - uv + vec2(0., .001)) * .22;
  float lit = clamp((n - fbm(cp + ld)) * 2.6 + .55, 0., 1.);
  vec3 cDay = mix(vec3(.40, .45, .53), vec3(1., .98, .96), lit);
  cDay = mix(cDay, vec3(.25, .28, .33) + .22 * lit, wet * .75);
  vec3 cNight = mix(vec3(.028, .033, .048), vec3(.085, .095, .135), lit);
  vec3 cc = mix(cNight, cDay, day) + tw * vec3(.9, .34, .14) * lit * .55;
  col = mix(col, cc, dens * (.55 + .4 * uCloud) * mix(.45, 1., smoothstep(0., .25, uv.y)));

  // 雷光
  col += uFlash * vec3(.6, .68, .9) * (.2 + .8 * dens) * (.45 + .55 * uv.y);

  // 霧
  float fn = fbm(vec2(uv.x * asp * 1.5, uv.y * 2.5) + uDrift * vec2(2., .3) + 40.);
  vec3 fogc = mix(vec3(.055, .065, .085), vec3(.70, .73, .77), day);
  col = mix(col, fogc, uFog * clamp(.5 + .5 * fn - uv.y * .25, 0., 1.));

  // 豪雨・吹雪では視界が白く煙る
  float heavy = smoothstep(.55, 1., max(uRain, uSnow));
  if (heavy > 0.) {
    float veil = fbm(vec2(uv.x * asp * 1.2 + uv.y * .5, uv.y * .7) + uDrift * vec2(9., 2.) + vec2(uTime * .05, uTime * .11));
    vec3 vc = mix(vec3(.07, .08, .1), mix(vec3(.5, .54, .6), vec3(.6, .64, .7), step(uRain, uSnow)), day);
    col = mix(col, vc, heavy * (.25 + .45 * veil));
  }

  // 雨
  if (uRain > .002) {
    // 風の息で濃淡のムラをつくる
    float mura = .45 + 1.1 * noise(vec2(uv.x * asp * 1.6 + uTime * .12, uv.y * 1.1 - uTime * .25), 64.);
    float dens = (.26 + .66 * uRain) * mura;
    float mid = smoothstep(.25, .7, uRain);
    float r = rainLayer(uv, asp, 150., 9., 11., dens, 1.) * .3
            + rainLayer(uv, asp, 100., 8., 5., dens, 1.) * .45
            + rainLayer(uv, asp, 64., 7., 0., dens, 1.1) * .65;
    // 手前の層は色がわずかに分かれて見える (水滴のプリズム)
    vec2 ca = vec2(.0011, 0.);
    vec3 near = vec3(
      rainLayer(uv + ca, asp, 38., 6., 21., dens * .8, 1.35),
      rainLayer(uv, asp, 38., 6., 21., dens * .8, 1.35),
      rainLayer(uv - ca, asp, 38., 6., 21., dens * .8, 1.35)) * .9 * mid;
    near += vec3(
      rainLayer(uv + ca * 1.6, asp, 21., 5.2, 33., dens * .6, 1.7),
      rainLayer(uv, asp, 21., 5.2, 33., dens * .6, 1.7),
      rainLayer(uv - ca * 1.6, asp, 21., 5.2, 33., dens * .6, 1.7)) * heavy;
    vec3 rc = (vec3(r) * vec3(.78, .85, .98) + near * vec3(1., .98, 1.05)) * (.7 + .5 * mura);
    col += rc * smoothstep(0., .15, uRain) * mix(.7, .8, day);
  }

  // 雪
  if (uSnow > .002) {
    float s = snowLayer(uv, asp, 7., .55, 0.) * .9
            + snowLayer(uv, asp, 12., .7, 3.) * .7
            + snowLayer(uv, asp, 20., .9, 7.) * .5
            + snowLayer(uv, asp, 34., 1.2, 13.) * .32;
    col += s * smoothstep(0., .15, uSnow) * mix(.45, .9, day);
  }

  // 周辺減光とディザ
  vec2 v = uv - .5;
  col *= 1. - .3 * dot(v, v);
  col += (hash(gl_FragCoord.xy + fract(uTime) * 61.) - .5) / 170.;
  gl_FragColor = vec4(col, 1.);
}`

const UNIFORMS = ['uRes', 'uTime', 'uDrift', 'uSun', 'uElev', 'uCloud', 'uRain', 'uSnow', 'uFog', 'uFlash', 'uWind', 'uSlant'] as const
const CLEAR: SkyState = { cloud: 0, rain: 0, snow: 0, fog: 0, wind: 0, slant: 0, thunder: 0 }

export class Sky {
  /** 時刻の取得元。デモ用に差し替えられる */
  now: () => number = Date.now

  private gl: WebGLRenderingContext | null = null
  private u = {} as Record<(typeof UNIFORMS)[number], WebGLUniformLocation | null>
  private cur = { ...CLEAR }
  private target = { ...CLEAR }
  private snapped = false
  private lat = 35.68
  private lon = 139.76
  private drift = [Math.random() * 512, Math.random() * 512]
  private time = 0
  private flash = 0
  private nextStrike = 0
  private last = 0

  constructor(private canvas: HTMLCanvasElement) {
    canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault()
      this.gl = null
    })
    canvas.addEventListener('webglcontextrestored', () => this.init())
    this.init()
    requestAnimationFrame(this.frame)
  }

  /** 太陽高度の sin。地平線で0、真上で1 */
  sunElev() {
    return Math.sin(sunPosition(this.now(), this.lat, this.lon).elev)
  }

  setPlace(lat: number, lon: number) {
    this.lat = lat
    this.lon = lon
  }

  setTarget(s: SkyState) {
    this.target = { ...s }
    if (!this.snapped) {
      this.cur = { ...s }
      this.snapped = true
    }
  }

  private init() {
    const gl = this.canvas.getContext('webgl', { antialias: false, alpha: false })
    if (!gl) return
    const compile = (type: number, src: string) => {
      const s = gl.createShader(type)!
      gl.shaderSource(s, src)
      gl.compileShader(s)
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'shader')
      return s
    }
    const prog = gl.createProgram()!
    gl.attachShader(prog, compile(gl.VERTEX_SHADER, VERT))
    gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FRAG))
    gl.bindAttribLocation(prog, 0, 'p')
    gl.linkProgram(prog)
    gl.useProgram(prog)
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer())
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)
    gl.enableVertexAttribArray(0)
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)
    for (const name of UNIFORMS) this.u[name] = gl.getUniformLocation(prog, name)
    this.gl = gl
  }

  private frame = (t: number) => {
    requestAnimationFrame(this.frame)
    const gl = this.gl
    if (!gl) return
    const dt = Math.min(0.1, (t - this.last) / 1000 || 0)
    this.last = t

    // 天気の変化は数十秒かけてなじませる
    const k = 1 - Math.exp(-dt / 7)
    for (const key of Object.keys(this.cur) as (keyof SkyState)[]) this.cur[key] += (this.target[key] - this.cur[key]) * k
    const c = this.cur

    this.time = (this.time + dt) % 3600
    this.drift[0] = (this.drift[0] + dt * (0.006 + 0.022 * c.wind)) % 512
    this.drift[1] = (this.drift[1] + dt * 0.0015) % 512

    this.flash *= Math.exp(-dt * 7)
    if (c.thunder > 0.5 && t > this.nextStrike) {
      this.flash = 0.6 + Math.random() * 0.4
      this.nextStrike = t + (Math.random() < 0.4 ? 110 : 4000 + Math.random() * 11000)
    }

    const dpr = Math.min(window.devicePixelRatio || 1, 1.5)
    const w = Math.round(this.canvas.clientWidth * dpr)
    const h = Math.round(this.canvas.clientHeight * dpr)
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w
      this.canvas.height = h
      gl.viewport(0, 0, w, h)
    }

    const sun = sunPosition(this.now(), this.lat, this.lon)
    const u = this.u
    gl.uniform2f(u.uRes, w, h)
    gl.uniform1f(u.uTime, this.time)
    gl.uniform2f(u.uDrift, this.drift[0], this.drift[1])
    gl.uniform2f(u.uSun, 0.5 + (sun.az / Math.PI) * 0.9, (sun.elev / (Math.PI / 2)) * 0.95)
    gl.uniform1f(u.uElev, Math.sin(sun.elev))
    gl.uniform1f(u.uCloud, c.cloud)
    gl.uniform1f(u.uRain, c.rain)
    gl.uniform1f(u.uSnow, c.snow)
    gl.uniform1f(u.uFog, c.fog)
    gl.uniform1f(u.uFlash, this.flash)
    gl.uniform1f(u.uWind, c.wind)
    gl.uniform1f(u.uSlant, c.slant)
    gl.drawArrays(gl.TRIANGLES, 0, 3)
  }
}
