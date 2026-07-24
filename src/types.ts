export type ThemeMode = 'light' | 'dark' | 'system'
export type MediaType = 'video' | 'audio'
export type DownloadStatus =
  | 'pending'
  | 'downloading'
  | 'processing'
  | 'paused'
  | 'completed'
  | 'error'
  | 'cancelled'

export interface AppSettings {
  downloadPath: string
  maxConcurrentDownloads: number
  theme: ThemeMode
  language: 'en' | 'zh-CN'
  oneClickDownload: boolean
  defaultMediaType: MediaType
  videoQuality: 'best' | '2160' | '1440' | '1080' | '720' | '480'
  videoContainer: 'auto' | 'mp4' | 'mkv' | 'webm'
  audioFormat: 'mp3' | 'm4a' | 'opus' | 'wav'
  filenameTemplate: string
  createUploaderFolder: boolean
  downloadSubtitles: boolean
  embedSubtitles: boolean
  embedMetadata: boolean
  embedChapters: boolean
  embedThumbnail: boolean
  notificationsEnabled: boolean
  launchAtLogin: boolean
  hideDockIcon: boolean
  proxy: string
  cookiesPath: string
  configPath: string
  browserForCookies:
    | 'none'
    | 'chrome'
    | 'chromium'
    | 'edge'
    | 'firefox'
    | 'safari'
    | 'brave'
    | 'opera'
    | 'vivaldi'
    | 'whale'
  browserCookiesProfile: string
  preferredAudioLanguage: string
  /** When true, check GitHub Releases for a newer version on startup. */
  autoCheckUpdates: boolean
}

export interface MediaFormat {
  id: string
  extension: string
  width?: number
  height?: number
  fps?: number
  videoCodec?: string
  audioCodec?: string
  fileSize?: number
  note?: string
}

export interface PlaylistEntry {
  id: string
  title: string
  url: string
  thumbnail?: string
  duration?: number
}

export interface MediaInfo {
  id: string
  title: string
  url: string
  thumbnail?: string
  duration?: number
  uploader?: string
  description?: string
  isPlaylist: boolean
  entries: PlaylistEntry[]
  formats: MediaFormat[]
}

export interface DownloadProgress {
  percent: number
  speed?: string
  eta?: string
  downloadedBytes?: number
  totalBytes?: number
}

export interface DownloadItem {
  id: string
  url: string
  referer?: string
  title: string
  thumbnail?: string
  uploader?: string
  mediaType: MediaType
  status: DownloadStatus
  progress: DownloadProgress
  filePath?: string
  fileSize?: number
  /** Predicted extension while downloading (e.g. mp3, mp4). */
  expectedExtension?: string
  /** Exact directory chosen for this download attempt. */
  downloadDirectory?: string
  error?: string
  log: string
  createdAt: number
  startedAt?: number
  completedAt?: number
  duration?: number
  playlistId?: string
  playlistTitle?: string
  /** Original playlist page URL used for manual refresh / 追更. */
  playlistUrl?: string
}

export interface StartDownloadRequest {
  url: string
  referer?: string
  title?: string
  thumbnail?: string
  uploader?: string
  duration?: number
  playlistId?: string
  playlistTitle?: string
  /** Original playlist page URL; stored so the group can refresh later. */
  playlistUrl?: string
  mediaType: MediaType
  quality?: AppSettings['videoQuality']
  videoContainer?: AppSettings['videoContainer']
  audioFormat?: AppSettings['audioFormat']
  formatId?: string
  downloadSubtitles?: boolean
  customDownloadPath?: string
  customFilenameTemplate?: string
  startTime?: string
  endTime?: string
}

export interface BrowserMediaCandidate {
  id: string
  url: string
  pageUrl: string
  title: string
  mimeType?: string
  kind: 'hls' | 'dash' | 'video' | 'audio'
  source: string
  duration?: number
  contentLength?: number
  score: number
  detectedAt: number
}

export interface BrowserStateSnapshot {
  pageUrl: string
  title: string
  loading: boolean
  mediaPanelOpen: boolean
  candidates: BrowserMediaCandidate[]
}

export interface RuntimeInfo {
  version: string
  platform: string
  architecture: string
  ytDlpReady: boolean
  ffmpegReady: boolean
}

export const defaultSettings: AppSettings = {
  downloadPath: '',
  maxConcurrentDownloads: 3,
  theme: 'system',
  language: 'en',
  oneClickDownload: true,
  defaultMediaType: 'video',
  videoQuality: 'best',
  videoContainer: 'auto',
  audioFormat: 'mp3',
  filenameTemplate: '%(title)s.%(ext)s',
  createUploaderFolder: false,
  downloadSubtitles: false,
  embedSubtitles: false,
  embedMetadata: true,
  embedChapters: true,
  embedThumbnail: false,
  notificationsEnabled: true,
  launchAtLogin: false,
  hideDockIcon: false,
  proxy: '',
  cookiesPath: '',
  configPath: '',
  browserForCookies: 'none',
  browserCookiesProfile: '',
  preferredAudioLanguage: '',
  autoCheckUpdates: true
}

export interface AppUpdateInfo {
  currentVersion: string
  latestVersion: string
  updateAvailable: boolean
  releaseNotes: string
  htmlUrl: string
  publishedAt?: string
}
