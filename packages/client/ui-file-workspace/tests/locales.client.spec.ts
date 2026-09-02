/** Locale dictionary parity: both languages define exactly the same key set. */
import { describe, expect, it } from 'vitest'
import { en, zh } from '../src/client/locales.ts'

describe('fileWorkspace locales', () => {
  it('defines the same keys in Simplified Chinese and English', () => {
    expect(Object.keys(zh).sort()).toEqual(Object.keys(en).sort())
  })

  it('has no blank strings', () => {
    for (const value of [...Object.values(zh), ...Object.values(en)]) {
      expect(value.trim().length).toBeGreaterThan(0)
    }
  })
})
