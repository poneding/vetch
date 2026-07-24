/** Normalize media URLs so playlist refresh can dedupe across common site variants. */
export const normalizeMediaUrl = (url: string): string => {
  try {
    const parsed = new URL(url.trim())
    const host = parsed.hostname.replace(/^www\./i, '').toLowerCase()

    if (host === 'youtu.be') {
      const id = parsed.pathname.split('/').filter(Boolean)[0]
      if (id) {
        return `youtube:${id}`
      }
    }

    if (host === 'youtube.com' || host === 'm.youtube.com' || host === 'music.youtube.com') {
      const watchId = parsed.searchParams.get('v')
      if (watchId) {
        return `youtube:${watchId}`
      }
      const shortsMatch = parsed.pathname.match(/\/shorts\/([^/?#]+)/i)
      if (shortsMatch?.[1]) {
        return `youtube:${shortsMatch[1]}`
      }
    }

    if (host === 'bilibili.com' || host.endsWith('.bilibili.com')) {
      const bvMatch = parsed.pathname.match(/\/video\/(BV[\w]+)/i)
      if (bvMatch?.[1]) {
        return `bilibili:${bvMatch[1].toUpperCase()}`
      }
    }

    parsed.hash = ''
    // Drop tracking params that do not change the media identity.
    for (const key of [...parsed.searchParams.keys()]) {
      if (/^(utm_|si$|feature$|pp$)/i.test(key)) {
        parsed.searchParams.delete(key)
      }
    }
    return parsed.toString()
  } catch {
    return url.trim()
  }
}
