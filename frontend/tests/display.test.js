import { DISPLAY_DEFAULTS, DISPLAY_KEY, applyDisplay, readDisplay, saveDisplay } from '../src/utils/display.js'

const memory = (initial) => {
  const data = new Map(initial ? [[DISPLAY_KEY, initial]] : [])
  return { getItem: (key) => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) }
}

afterEach(() => {
  applyDisplay(DISPLAY_DEFAULTS)
})

test('falls back to the defaults for missing, broken or unknown data', () => {
  expect(readDisplay(memory())).toEqual(DISPLAY_DEFAULTS)
  expect(readDisplay(memory('{not json'))).toEqual(DISPLAY_DEFAULTS)
  expect(readDisplay(memory('"text"'))).toEqual(DISPLAY_DEFAULTS)
  expect(readDisplay(memory(JSON.stringify({ size: 300, reduceMotion: 'yes', highContrast: 1 })))).toEqual(DISPLAY_DEFAULTS)
})

test('reads back what was saved', () => {
  const store = memory()
  expect(saveDisplay({ size: 125, reduceMotion: true, highContrast: false }, store)).toBe(true)
  expect(readDisplay(store)).toEqual({ size: 125, reduceMotion: true, highContrast: false })
})

test('survives a browser that refuses storage', () => {
  const blocked = {
    getItem: () => {
      throw new Error('blocked')
    },
    setItem: () => {
      throw new Error('blocked')
    },
  }
  expect(readDisplay(blocked)).toEqual(DISPLAY_DEFAULTS)
  expect(saveDisplay(DISPLAY_DEFAULTS, blocked)).toBe(false)
})

test('applies and clears the settings on the page root', () => {
  applyDisplay({ size: 110, reduceMotion: true, highContrast: true })
  const root = document.documentElement
  expect(root.style.zoom).toBe('1.1')
  expect(root.getAttribute('data-reduce-motion')).toBe('true')
  expect(root.getAttribute('data-contrast')).toBe('high')
  applyDisplay(DISPLAY_DEFAULTS)
  expect(root.style.zoom).toBe('')
  expect(root.hasAttribute('data-reduce-motion')).toBe(false)
  expect(root.hasAttribute('data-contrast')).toBe(false)
})
