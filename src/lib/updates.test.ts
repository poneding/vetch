import { describe, expect, it } from 'vitest'
import { compareVersions } from './updates'

describe('compareVersions', () => {
  it('orders semver versions', () => {
    expect(compareVersions('0.2.0', '0.1.0')).toBeGreaterThan(0)
    expect(compareVersions('0.1.0', '0.2.0')).toBeLessThan(0)
    expect(compareVersions('v1.0.0', '1.0.0')).toBe(0)
    expect(compareVersions('1.2.3', '1.2.2')).toBeGreaterThan(0)
  })
})
