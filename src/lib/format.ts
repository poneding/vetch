export const formatBytes = (bytes?: number): string => {
  if (!bytes || bytes <= 0) {
    return ''
  }
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const order = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  return `${(bytes / 1024 ** order).toFixed(order === 0 ? 0 : 1)} ${units[order]}`
}

export const formatDuration = (seconds?: number): string => {
  if (!seconds || seconds <= 0) {
    return ''
  }
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const remainingSeconds = Math.floor(seconds % 60)
  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${remainingSeconds
      .toString()
      .padStart(2, '0')}`
  }
  return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`
}

export const formatDate = (timestamp: number): string => {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(timestamp)
}

export const sourceLabel = (url: string): string => {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

const MEDIA_FILE_EXTENSIONS = new Set([
  'mp3',
  'm4a',
  'aac',
  'flac',
  'wav',
  'opus',
  'ogg',
  'wma',
  'mp4',
  'mkv',
  'webm',
  'mov',
  'avi',
  'flv',
  'm4v',
  'ts',
  'm2ts'
])

const hasMediaExtension = (name: string): boolean => {
  const index = name.lastIndexOf('.')
  if (index <= 0 || index === name.length - 1) {
    return false
  }
  return MEDIA_FILE_EXTENSIONS.has(name.slice(index + 1).toLowerCase())
}

/** Prefer the on-disk basename (with extension) when a saved path is known. */
export const displayFileName = (item: {
  expectedExtension?: string
  filePath?: string
  title: string
}): string => {
  if (item.filePath) {
    const segments = item.filePath.split(/[/\\]/)
    const base = segments.at(-1)?.trim()
    if (base) {
      return base
    }
  }

  const title = item.title.trim()
  if (!title || hasMediaExtension(title)) {
    return item.title
  }

  const expected = item.expectedExtension?.trim().replace(/^\.+/, '').toLowerCase()
  if (expected) {
    return `${title}.${expected}`
  }
  return item.title
}

/** Parent directory of a file path, or the path itself when it has no parent. */
export const parentDirectory = (filePath: string): string => {
  const normalized = filePath.replace(/\\/g, '/')
  const index = normalized.lastIndexOf('/')
  if (index <= 0) {
    return filePath
  }
  // Keep Windows drive root like C:/
  if (index === 2 && normalized[1] === ':') {
    return filePath.slice(0, index + 1)
  }
  return filePath.slice(0, index)
}

export const normalizeThumbnailUrl = (value?: string): string | undefined => {
  if (!value) {
    return undefined
  }
  try {
    const url = new URL(value)
    if (url.protocol === 'http:') {
      url.protocol = 'https:'
    }
    return url.protocol === 'https:' ? url.toString() : undefined
  } catch {
    return undefined
  }
}

export const isValidMediaUrl = (value: string): boolean => {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}
