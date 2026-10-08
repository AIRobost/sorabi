import { loadPlaces, nearest, REGIONS, search, toPlace, type Hit, type Place, type Pref } from './places'

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`)

export function initPicker(root: HTMLElement, onPick: (p: Place) => void) {
  root.innerHTML = `
    <div class="pk">
      <div class="pk-head">
        <label class="pk-search">
          <svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/></svg>
          <input id="pk-q" type="search" placeholder="地名を検索  さっぽろ / 札幌" autocomplete="off" spellcheck="false" />
        </label>
        <button id="pk-here" class="pill">
          <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><circle cx="12" cy="12" r="7.5"/><path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22"/></svg>
          現在地
        </button>
        <button id="pk-close" class="icon-btn" aria-label="閉じる">
          <svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>
        </button>
      </div>
      <div id="pk-msg" class="pk-msg"></div>
      <div id="pk-body" class="pk-body"></div>
    </div>`

  const input = root.querySelector<HTMLInputElement>('#pk-q')!
  const body = root.querySelector<HTMLElement>('#pk-body')!
  const msg = root.querySelector<HTMLElement>('#pk-msg')!
  let prefs: Pref[] = []
  let hits: Hit[] = []

  const show = (html: string) => {
    body.innerHTML = html
    body.scrollTop = 0
    // 入場アニメーションをやり直す
    body.classList.remove('in')
    void body.offsetWidth
    body.classList.add('in')
  }

  const showPrefs = () =>
    show(
      REGIONS.map(
        ([label, from, to], r) => `
        <section class="pk-region" style="--i:${r}">
          <h3>${label}</h3>
          <div class="pk-chips">
            ${prefs
              .slice(from, to)
              .map((p, i) => `<button data-pref="${from + i}">${esc(p.name)}</button>`)
              .join('')}
          </div>
        </section>`,
      ).join(''),
    )

  const cityButton = (h: Hit, i: number, withPref: boolean) => `
    <button class="pk-city" data-hit="${i}" style="--i:${Math.min(i, 24)}">
      <span class="pk-city-name">${esc(h.row[0])}</span>
      <span class="pk-city-sub">${esc((withPref ? h.pref.name + ' ' : '') + h.row[4] || h.row[1])}</span>
    </button>`

  const showCities = (pi: number) => {
    const pref = prefs[pi]
    hits = pref.cities.map((row) => ({ pref, row }))
    show(`
      <button class="pk-back" data-back>
        <svg viewBox="0 0 24 24"><path d="M14 8l-4 4 4 4"/></svg>${esc(pref.name)}
      </button>
      <div class="pk-grid">${hits.map((h, i) => cityButton(h, i, false)).join('')}</div>`)
  }

  const showResults = (q: string) => {
    hits = search(prefs, q)
    show(
      hits.length
        ? `<div class="pk-grid">${hits.map((h, i) => cityButton(h, i, true)).join('')}</div>`
        : `<p class="pk-empty">「${esc(q)}」に一致する市区町村が見つかりません</p>`,
    )
  }

  const close = () => {
    root.classList.remove('show')
    root.setAttribute('aria-hidden', 'true')
    input.blur()
  }

  const pick = (h: Hit) => {
    onPick(toPlace(h.pref, h.row))
    close()
  }

  input.addEventListener('input', () => {
    msg.textContent = ''
    if (input.value.trim()) showResults(input.value)
    else showPrefs()
  })
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.isComposing && input.value.trim() && hits[0]) pick(hits[0])
  })

  body.addEventListener('click', (e) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>('button')
    if (!el) return
    if (el.dataset.pref) showCities(Number(el.dataset.pref))
    else if (el.dataset.hit) pick(hits[Number(el.dataset.hit)])
    else if ('back' in el.dataset) showPrefs()
  })

  root.querySelector('#pk-close')!.addEventListener('click', close)
  root.addEventListener('click', (e) => {
    if (e.target === root) close()
  })

  root.querySelector('#pk-here')!.addEventListener('click', () => {
    if (!navigator.geolocation) {
      msg.textContent = 'このブラウザでは現在地を取得できません'
      return
    }
    msg.textContent = '現在地を取得しています…'
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        msg.textContent = ''
        pick(nearest(prefs, pos.coords.latitude, pos.coords.longitude))
      },
      (err) => {
        msg.textContent =
          err.code === err.PERMISSION_DENIED
            ? '位置情報の利用が許可されていません。ブラウザの設定を確認してください'
            : '現在地を取得できませんでした'
      },
      { timeout: 15000, maximumAge: 600000 },
    )
  })

  return {
    get isOpen() {
      return root.classList.contains('show')
    },
    close,
    async open(note = '') {
      root.classList.add('show')
      root.setAttribute('aria-hidden', 'false')
      input.value = ''
      msg.textContent = note
      try {
        prefs = await loadPlaces()
        showPrefs()
        input.focus()
      } catch {
        msg.textContent = '地名データを読み込めませんでした'
      }
    },
  }
}
