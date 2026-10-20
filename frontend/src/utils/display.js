// Per-device display preferences (interface size, reduced motion, high contrast).
// Stored in this browser only and applied to <html>, so every page follows them.

export const DISPLAY_KEY = 'slp-display'
export const SIZES = [100, 110, 125]
export const DISPLAY_DEFAULTS = { size: 100, reduceMotion: false, highContrast: false }

export function readDisplay(storage) {
  try {
    const store = storage ?? window.localStorage
    const raw = JSON.parse(store.getItem(DISPLAY_KEY) ?? 'null')
    if (!raw || typeof raw !== 'object') return { ...DISPLAY_DEFAULTS }
    return {
      size: SIZES.includes(raw.size) ? raw.size : DISPLAY_DEFAULTS.size,
      reduceMotion: raw.reduceMotion === true,
      highContrast: raw.highContrast === true,
    }
  } catch {
    return { ...DISPLAY_DEFAULTS }
  }
}

export function saveDisplay(prefs, storage) {
  try {
    ;(storage ?? window.localStorage).setItem(DISPLAY_KEY, JSON.stringify(prefs))
    return true
  } catch {
    return false
  }
}

export function applyDisplay(prefs, root) {
  const target = root ?? document.documentElement
  target.style.zoom = prefs.size === 100 ? '' : String(prefs.size / 100)
  if (prefs.reduceMotion) target.setAttribute('data-reduce-motion', 'true')
  else target.removeAttribute('data-reduce-motion')
  if (prefs.highContrast) target.setAttribute('data-contrast', 'high')
  else target.removeAttribute('data-contrast')
}
