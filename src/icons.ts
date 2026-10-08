const CLOUD = '<path d="M7 15h10a3.5 3.5 0 0 0 .4-6.98A5.5 5.5 0 0 0 6.6 9.2 3 3 0 0 0 7 15z"/>'

const PATHS = {
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4L7 17M17 7l1.4-1.4"/>',
  moon: '<path d="M19.5 14.2A8 8 0 1 1 9.8 4.5a6.3 6.3 0 0 0 9.7 9.7z"/>',
  partly:
    '<circle cx="8.5" cy="8.5" r="3"/><path d="M8.5 2.8v1.4M2.8 8.5h1.4M4.5 4.5l1 1M12.5 4.5l-1 1"/><path d="M10 19h7.5a3 3 0 0 0 .3-5.98A4.6 4.6 0 0 0 9.3 14 2.6 2.6 0 0 0 10 19z"/>',
  cloud: '<path d="M7 18h10a4 4 0 0 0 .5-7.97A6 6 0 0 0 6.2 11.6 3.3 3.3 0 0 0 7 18z"/>',
  rain: CLOUD + '<path d="M8.5 18l-1 2.5M12.5 18l-1 2.5M16.5 18l-1 2.5"/>',
  snow: CLOUD + '<path d="M8 18.5v.01M12 18.5v.01M16 18.5v.01M10 21v.01M14 21v.01"/>',
  thunder: CLOUD + '<path d="M12.5 15.5l-2 3h3l-2 3"/>',
  fog: '<path d="M4 9h16M6 13h12M4 17h16"/>',
}

export type IconName = keyof typeof PATHS

export const icon = (name: IconName) => `<svg viewBox="0 0 24 24" class="wi">${PATHS[name]}</svg>`

export function iconFor(code: number, isDay: boolean): IconName {
  if (code <= 1) return isDay ? 'sun' : 'moon'
  if (code === 2) return isDay ? 'partly' : 'cloud'
  if (code === 3) return 'cloud'
  if (code <= 48) return 'fog'
  if (code >= 95) return 'thunder'
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'snow'
  return 'rain'
}
