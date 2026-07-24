import type { AppUpdateInfo } from '../types'
import { APP_VERSION } from './version'

const GITHUB_REPO = 'poneding/vetch'
const LATEST_RELEASE_URL = `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`

interface GithubReleaseResponse {
  tag_name?: string
  body?: string | null
  html_url?: string
  published_at?: string | null
  draft?: boolean
  prerelease?: boolean
}

/** Compare dotted semver-ish strings. Returns positive when left > right. */
export const compareVersions = (left: string, right: string): number => {
  const normalize = (value: string): number[] =>
    value
      .replace(/^v/i, '')
      .split(/[.+_-]/)
      .map((part) => {
        const digits = part.replace(/[^\d].*$/, '')
        return digits ? Number(digits) : 0
      })

  const leftParts = normalize(left)
  const rightParts = normalize(right)
  const length = Math.max(leftParts.length, rightParts.length)
  for (let index = 0; index < length; index += 1) {
    const leftValue = leftParts[index] ?? 0
    const rightValue = rightParts[index] ?? 0
    if (leftValue !== rightValue) {
      return leftValue - rightValue
    }
  }
  return 0
}

export const checkForAppUpdate = async (
  currentVersion: string = APP_VERSION
): Promise<AppUpdateInfo> => {
  const response = await fetch(LATEST_RELEASE_URL, {
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': `Vetch/${currentVersion}`
    }
  })
  if (!response.ok) {
    throw new Error(`Update check failed (${response.status})`)
  }

  const release = (await response.json()) as GithubReleaseResponse
  if (release.draft || release.prerelease) {
    return {
      currentVersion,
      latestVersion: currentVersion,
      updateAvailable: false,
      releaseNotes: '',
      htmlUrl: `https://github.com/${GITHUB_REPO}/releases`
    }
  }

  const latestVersion = (release.tag_name ?? '').replace(/^v/i, '').trim()
  if (!latestVersion) {
    throw new Error('Latest release has no version tag')
  }

  return {
    currentVersion,
    latestVersion,
    updateAvailable: compareVersions(latestVersion, currentVersion) > 0,
    releaseNotes: (release.body ?? '').trim(),
    htmlUrl: release.html_url ?? `https://github.com/${GITHUB_REPO}/releases/latest`,
    publishedAt: release.published_at ?? undefined
  }
}
