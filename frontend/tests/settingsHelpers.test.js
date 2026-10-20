import { baseValues, changedPayload, detailsOf, firstText, passwordChecks, validateProfile, without } from '../src/utils/settingsHelpers.js'

const ME = { full_name: 'Alex Chen', phone: '+1 555 382 9014', avatar_url: null }
const values = (patch = {}) => ({ ...baseValues(ME), ...patch })

test('accepts a valid profile and rejects the cases the API rejects', () => {
  expect(validateProfile(values())).toEqual({})
  expect(validateProfile(values({ full_name: 'A' })).full_name).toBeTruthy()
  expect(validateProfile(values({ full_name: 'x'.repeat(121) })).full_name).toBeTruthy()
  expect(validateProfile(values({ full_name: 'Alex\u0007Chen' })).full_name).toBeTruthy()
  expect(validateProfile(values({ phone: '12345' })).phone).toBeTruthy()
  expect(validateProfile(values({ phone: 'call me maybe' })).phone).toBeTruthy()
  expect(validateProfile(values({ phone: '' }))).toEqual({})
  expect(validateProfile(values({ avatar_url: 'http://x.com/a.png' })).avatar_url).toBeTruthy()
  expect(validateProfile(values({ avatar_url: 'not a link' })).avatar_url).toBeTruthy()
  expect(validateProfile(values({ avatar_url: 'https://x.com/a.png' }))).toEqual({})
})

test('sends only what changed and clears emptied optional fields with null', () => {
  expect(changedPayload(ME, values())).toEqual({})
  expect(changedPayload(ME, values({ full_name: '  Alex C  ' }))).toEqual({ full_name: 'Alex C' })
  expect(changedPayload(ME, values({ phone: '' }))).toEqual({ phone: null })
  expect(changedPayload({ ...ME, avatar_url: 'https://x.com/a.png' }, values({ avatar_url: '' }))).toEqual({ avatar_url: null })
})

test('baseValues turns missing fields into empty strings', () => {
  expect(baseValues(undefined)).toEqual({ full_name: '', phone: '', avatar_url: '' })
  expect(baseValues({ full_name: 'A B' })).toEqual({ full_name: 'A B', phone: '', avatar_url: '' })
})

test('password rules follow the server policy', () => {
  const met = (current, next, confirm) => Object.fromEntries(passwordChecks(current, next, confirm).map((check) => [check.id, check.met]))
  expect(met('', '', '')).toEqual({ len: false, letter: false, digit: false, diff: false, match: false })
  expect(met('Old12345', 'Old12345', 'Old12345')).toMatchObject({ len: true, letter: true, digit: true, diff: false, match: true })
  expect(met('Old12345', 'NewPass9', 'NewPass9')).toEqual({ len: true, letter: true, digit: true, diff: true, match: true })
  expect(met('Old12345', 'abcdefgh', 'abcdefgh')).toMatchObject({ digit: false })
  expect(met('Old12345', '12345678', '12345678')).toMatchObject({ letter: false })
  expect(met('Old12345', 'NewPass9', 'NewPass')).toMatchObject({ match: false })
})

test('small helpers cope with odd server answers', () => {
  expect(without({ a: 1, b: 2 }, 'a')).toEqual({ b: 2 })
  expect(detailsOf(null)).toEqual({})
  expect(detailsOf({ details: 'oops' })).toEqual({})
  expect(detailsOf({ details: { phone: 'bad' } })).toEqual({ phone: 'bad' })
  expect(firstText(['first', 'second'])).toBe('first')
  expect(firstText([])).toBe('')
  expect(firstText('plain')).toBe('plain')
  expect(firstText(undefined)).toBe('')
})
