import { describe, expect, test } from 'vitest'
import { PHOTO_ACCEPT, PHOTO_MAX_BYTES, checkPhotoFile } from '../src/utils/settingsHelpers.js'

const file = (type, size) => ({ type, size })

describe('checkPhotoFile', () => {
  test('accepts JPEG, PNG and WebP up to 2 MB', () => {
    for (const type of ['image/jpeg', 'image/png', 'image/webp']) {
      expect(checkPhotoFile(file(type, 1000))).toBe('')
      expect(checkPhotoFile(file(type, PHOTO_MAX_BYTES))).toBe('')
    }
  })

  test('rejects any other type', () => {
    for (const type of ['image/gif', 'image/svg+xml', 'application/pdf', 'text/plain', '']) {
      expect(checkPhotoFile(file(type, 1000))).toBe('Use a JPEG, PNG or WebP photo.')
    }
  })

  test('rejects empty and oversized files', () => {
    expect(checkPhotoFile(file('image/png', 0))).toBe('That file is empty.')
    expect(checkPhotoFile(file('image/png', PHOTO_MAX_BYTES + 1))).toBe(
      'The photo must be 2 MB or smaller.',
    )
  })

  test('asks for a file when none was chosen', () => {
    expect(checkPhotoFile(undefined)).toBe('Choose a photo first.')
  })

  test('the file picker only offers the allowed types', () => {
    expect(PHOTO_ACCEPT).toBe('image/jpeg,image/png,image/webp')
  })
})