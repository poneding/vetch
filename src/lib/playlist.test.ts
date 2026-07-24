import { describe, expect, it } from 'vitest'
import { normalizeMediaUrl } from './playlist'

describe('normalizeMediaUrl', () => {
  it('normalizes YouTube variants to the same key', () => {
    expect(normalizeMediaUrl('https://www.youtube.com/watch?v=abc123&si=xyz')).toBe(
      'youtube:abc123'
    )
    expect(normalizeMediaUrl('https://youtu.be/abc123')).toBe('youtube:abc123')
    expect(normalizeMediaUrl('https://www.youtube.com/shorts/abc123')).toBe('youtube:abc123')
  })

  it('normalizes Bilibili BV ids', () => {
    expect(normalizeMediaUrl('https://www.bilibili.com/video/BV1xx411c7mD?spm_id_from=333')).toBe(
      'bilibili:BV1XX411C7MD'
    )
  })
})
