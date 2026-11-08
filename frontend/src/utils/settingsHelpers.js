// Shared by the lecturer and student Settings pages: the profile and password rules the API enforces
// (docs/API.md, "Profile" and "Auth"), kept in one place so both pages agree.

const hasControl = (text) => [...text].some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)
const PHONE = /^[0-9 +()-]{7,20}$/

export function validateProfile(values) {
  const errors = {}
  const name = values.full_name.trim()
  if (name.length < 2 || name.length > 120 || hasControl(name)) errors.full_name = 'Enter your full name (2 to 120 characters).'
  const phone = values.phone.trim()
  if (phone && !PHONE.test(phone)) errors.phone = 'Use 7 to 20 characters: digits, spaces, + - ( ).'
  return errors
}

export const baseValues = (me) => ({ full_name: me?.full_name ?? '', phone: me?.phone ?? '' })

// Only the fields that changed, as PATCH /me expects. An emptied phone becomes null (clears it).
export function changedPayload(me, values) {
  const base = baseValues(me)
  const payload = {}
  if (values.full_name.trim() !== base.full_name) payload.full_name = values.full_name.trim()
  if (values.phone.trim() !== base.phone) payload.phone = values.phone.trim() || null
  return payload
}

export function passwordChecks(current, next, confirm) {
  return [
    { id: 'len', label: 'At least 8 characters', met: next.length >= 8 },
    { id: 'letter', label: 'Contains a letter', met: /[A-Za-z]/.test(next) },
    { id: 'digit', label: 'Contains a digit', met: /\d/.test(next) },
    { id: 'diff', label: 'Different from the current password', met: next.length > 0 && next !== current },
    { id: 'match', label: 'Both new passwords match', met: confirm.length > 0 && next === confirm },
  ]
}

export const without = (object, key) => Object.fromEntries(Object.entries(object).filter(([name]) => name !== key))
export const detailsOf = (error) => (error && typeof error.details === 'object' && error.details ? error.details : {})
export const firstText = (value) => (Array.isArray(value) ? String(value[0] ?? '') : String(value ?? ''))

// ---------- profile photo (uploaded as a file, never typed as a link) ----------
export const PHOTO_MAX_BYTES = 2 * 1024 * 1024
export const PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp']
export const PHOTO_ACCEPT = PHOTO_TYPES.join(',')

// Quick checks before uploading. The server re-checks everything (type is decided
// from the file's bytes there), so this only saves a wasted trip.
export function checkPhotoFile(file) {
  if (!file) return 'Choose a photo first.'
  if (!PHOTO_TYPES.includes(file.type)) return 'Use a JPEG, PNG or WebP photo.'
  if (file.size === 0) return 'That file is empty.'
  if (file.size > PHOTO_MAX_BYTES) return 'The photo must be 2 MB or smaller.'
  return ''
}
