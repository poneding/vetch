import {
  Check,
  Download,
  FolderOpen,
  ListVideo,
  LoaderCircle,
  Music2,
  Video,
  X
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { probeUrl, selectDirectory } from '../lib/backend'
import { formatDuration } from '../lib/format'
import type { AppSettings, MediaInfo, MediaType, StartDownloadRequest } from '../types'
import { Combobox } from './Combobox'
import { EditableTitle } from './EditableTitle'
import { MediaThumbnail } from './MediaThumbnail'

interface DownloadDialogProps {
  open: boolean
  preferredTitle?: string
  referer?: string
  settings: AppSettings
  url: string
  onClose: () => void
  onStart: (requests: StartDownloadRequest[]) => Promise<void>
}

const isGenericMediaTitle = (title: string | undefined): boolean => {
  const normalized = title?.trim().toLowerCase() ?? ''
  return (
    !normalized ||
    normalized === 'untitled media' ||
    normalized === 'unknown' ||
    normalized === 'na' ||
    normalized === 'n/a'
  )
}

const resolveMediaTitle = (probedTitle: string | undefined, preferredTitle?: string): string => {
  const preferred = preferredTitle?.trim()
  if (preferred) {
    if (isGenericMediaTitle(probedTitle)) {
      return preferred
    }
    // Prefer the page title when probe only recovered a bare stream/file basename.
    const probed = probedTitle?.trim() ?? ''
    if (probed && preferred !== probed && !preferred.toLowerCase().includes(probed.toLowerCase())) {
      const looksLikeStreamBasename =
        !probed.includes(' ') &&
        (probed.includes('.m3u8') ||
          probed.includes('.mpd') ||
          probed.includes('.mp4') ||
          /^[a-z0-9._-]+$/i.test(probed))
      if (looksLikeStreamBasename) {
        return preferred
      }
    }
  }
  return probedTitle?.trim() || preferred || 'Untitled media'
}

export function DownloadDialog({
  open,
  preferredTitle,
  referer,
  settings,
  url,
  onClose,
  onStart
}: DownloadDialogProps) {
  const { t } = useTranslation()
  const [mediaInfo, setMediaInfo] = useState<MediaInfo | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [starting, setStarting] = useState(false)
  const [mediaType, setMediaType] = useState<MediaType>(settings.defaultMediaType)
  const [quality, setQuality] = useState<AppSettings['videoQuality']>(settings.videoQuality)
  const [videoContainer, setVideoContainer] = useState<AppSettings['videoContainer']>(
    settings.videoContainer
  )
  const [audioFormat, setAudioFormat] = useState<AppSettings['audioFormat']>(settings.audioFormat)
  const [downloadSubtitles, setDownloadSubtitles] = useState(settings.downloadSubtitles)
  const [customDownloadPath, setCustomDownloadPath] = useState('')
  const [customFilenameTemplate, setCustomFilenameTemplate] = useState('')
  const [selectedFormatId, setSelectedFormatId] = useState('')
  const [startTime, setStartTime] = useState('')
  const [endTime, setEndTime] = useState('')
  const [selectedEntryIds, setSelectedEntryIds] = useState<Set<string>>(new Set())
  const exactFormats = useMemo(() => {
    if (!mediaInfo || mediaInfo.isPlaylist) {
      return []
    }
    return mediaInfo.formats
      .filter((format) => {
        if (mediaType === 'audio') {
          return format.videoCodec === 'none' && format.audioCodec !== 'none'
        }
        return Boolean(format.height) && format.videoCodec !== 'none'
      })
      .sort((left, right) => (right.height ?? 0) - (left.height ?? 0))
  }, [mediaInfo, mediaType])

  useEffect(() => {
    if (!open) {
      return
    }
    setMediaInfo(null)
    setError('')
    setLoading(true)
    setMediaType(settings.defaultMediaType)
    setQuality(settings.videoQuality)
    setVideoContainer(settings.videoContainer)
    setAudioFormat(settings.audioFormat)
    setDownloadSubtitles(settings.downloadSubtitles)
    setCustomDownloadPath('')
    setCustomFilenameTemplate('')
    setSelectedFormatId('')
    setStartTime('')
    setEndTime('')
    setSelectedEntryIds(new Set())

    let active = true
    const loadMediaInfo = async (): Promise<void> => {
      try {
        const info = await probeUrl(url, referer, 'summary')
        if (active) {
          const resolvedTitle = resolveMediaTitle(info.title, preferredTitle)
          setMediaInfo({
            ...info,
            title: resolvedTitle,
            entries: info.entries.map((entry) => ({
              ...entry,
              title: resolveMediaTitle(entry.title, preferredTitle)
            }))
          })
          setSelectedEntryIds(new Set(info.entries.map((entry) => entry.id)))
        }
      } catch (probeError: unknown) {
        if (active) {
          setError(probeError instanceof Error ? probeError.message : t('dialog.loadFailed'))
        }
      } finally {
        if (active) {
          setLoading(false)
        }
      }
    }
    void loadMediaInfo()

    return () => {
      active = false
    }
  }, [open, preferredTitle, referer, settings, t, url])

  useEffect(() => {
    if (!open) {
      return
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !starting) {
        onClose()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose, open, starting])

  if (!open) {
    return null
  }

  const chooseFolder = async () => {
    const selection = await selectDirectory()
    if (selection) {
      setCustomDownloadPath(selection)
    }
  }

  const handleStart = async () => {
    if (!mediaInfo) {
      return
    }
    const commonOptions = {
      referer,
      mediaType,
      quality,
      videoContainer,
      audioFormat,
      formatId: selectedFormatId || undefined,
      downloadSubtitles,
      customDownloadPath: customDownloadPath || undefined,
      customFilenameTemplate: customFilenameTemplate || undefined,
      startTime: startTime || undefined,
      endTime: endTime || undefined
    }
    // Use a fresh instance id per download session. The platform playlist id is
    // stable across visits, so reusing it would merge separate downloads into one group.
    const playlistInstanceId = mediaInfo.isPlaylist ? crypto.randomUUID() : undefined
    const requests: StartDownloadRequest[] = mediaInfo.isPlaylist
      ? mediaInfo.entries
          .filter((entry) => selectedEntryIds.has(entry.id))
          .map((entry) => ({
            ...commonOptions,
            url: entry.url,
            title: entry.title,
            thumbnail: entry.thumbnail,
            duration: entry.duration,
            playlistId: playlistInstanceId,
            playlistTitle: mediaInfo.title,
            playlistUrl: mediaInfo.url || url
          }))
      : [
          {
            ...commonOptions,
            url: mediaInfo.url,
            title: mediaInfo.title,
            thumbnail: mediaInfo.thumbnail,
            uploader: mediaInfo.uploader,
            duration: mediaInfo.duration
          }
        ]

    setStarting(true)
    try {
      await onStart(requests)
      onClose()
    } catch (startError) {
      setError(startError instanceof Error ? startError.message : t('download.startFailed'))
    } finally {
      setStarting(false)
    }
  }

  const playlistItemCount = mediaInfo?.isPlaylist ? mediaInfo.entries.length : 0
  const itemCount = mediaInfo?.isPlaylist ? selectedEntryIds.size : 1
  const togglePlaylistEntry = (entryId: string) => {
    setSelectedEntryIds((current) => {
      const next = new Set(current)
      if (next.has(entryId)) {
        next.delete(entryId)
      } else {
        next.add(entryId)
      }
      return next
    })
  }

  return (
    <div
      aria-labelledby="download-dialog-title"
      aria-modal="true"
      className="modal-backdrop"
      role="dialog"
    >
      <div className="download-dialog">
        <div className="modal-header">
          <div className="modal-header-copy">
            <h2 id="download-dialog-title">{t('dialog.title')}</h2>
            {mediaInfo?.isPlaylist ? (
              <span className="playlist-label">
                <ListVideo size={14} />
                {t('dialog.playlist')} · {t('dialog.playlistItems', { count: playlistItemCount })}
              </span>
            ) : null}
          </div>
          <button
            aria-label={t('titlebar.close')}
            className="dialog-close-button icon-button"
            disabled={starting}
            onClick={onClose}
            title={t('titlebar.close')}
            type="button"
          >
            <X size={17} />
          </button>
        </div>

        {loading ? (
          <div className="dialog-loading">
            <LoaderCircle className="spin" size={24} />
            <span>{t('dialog.loading')}</span>
          </div>
        ) : null}

        {!loading && error ? <div className="inline-error">{error}</div> : null}

        {!loading && mediaInfo ? (
          <div className="dialog-content">
            <section className="media-preview">
              <MediaThumbnail height={76} src={mediaInfo.thumbnail} width={128}>
                <div className="media-preview-placeholder">
                  <Video size={24} />
                </div>
              </MediaThumbnail>
              <div>
                <EditableTitle
                  onSave={(nextTitle) => {
                    setMediaInfo((current) =>
                      current ? { ...current, title: nextTitle } : current
                    )
                  }}
                  title={mediaInfo.title}
                />
                <p>
                  {[mediaInfo.uploader, formatDuration(mediaInfo.duration)]
                    .filter(Boolean)
                    .join(' · ')}
                </p>
                {mediaInfo.isPlaylist ? (
                  <div className="playlist-preview-list">
                    {mediaInfo.entries.slice(0, 3).map((entry) => (
                      <span key={entry.id}>{entry.title}</span>
                    ))}
                    {mediaInfo.entries.length > 3 ? (
                      <span>+{mediaInfo.entries.length - 3}</span>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </section>

            <div className="dialog-form-grid">
              <label className="field field-wide">
                <span>{t('dialog.mediaType')}</span>
                <div className="segmented-control">
                  <button
                    aria-pressed={mediaType === 'video'}
                    onClick={() => {
                      setMediaType('video')
                      setSelectedFormatId('')
                    }}
                    type="button"
                  >
                    <Video size={16} />
                    {t('dialog.video')}
                  </button>
                  <button
                    aria-pressed={mediaType === 'audio'}
                    onClick={() => {
                      setMediaType('audio')
                      setSelectedFormatId('')
                    }}
                    type="button"
                  >
                    <Music2 size={16} />
                    {t('dialog.audio')}
                  </button>
                </div>
              </label>

              {mediaType === 'video' ? (
                <>
                  <div className="field">
                    <span>{t('dialog.quality')}</span>
                    <Combobox<AppSettings['videoQuality']>
                      ariaLabel={t('dialog.quality')}
                      onChange={setQuality}
                      options={[
                        { value: 'best', label: t('dialog.best') },
                        { value: '2160', label: '2160p' },
                        { value: '1440', label: '1440p' },
                        { value: '1080', label: '1080p' },
                        { value: '720', label: '720p' },
                        { value: '480', label: '480p' }
                      ]}
                      value={quality}
                    />
                  </div>
                  <div className="field">
                    <span>{t('dialog.container')}</span>
                    <Combobox<AppSettings['videoContainer']>
                      ariaLabel={t('dialog.container')}
                      onChange={setVideoContainer}
                      options={[
                        { value: 'auto', label: t('common.automatic') },
                        { value: 'mp4', label: 'MP4' },
                        { value: 'mkv', label: 'MKV' },
                        { value: 'webm', label: 'WebM' }
                      ]}
                      value={videoContainer}
                    />
                  </div>
                </>
              ) : (
                <div className="field field-wide">
                  <span>{t('dialog.audioFormat')}</span>
                  <Combobox<AppSettings['audioFormat']>
                    ariaLabel={t('dialog.audioFormat')}
                    onChange={setAudioFormat}
                    options={[
                      { value: 'mp3', label: 'MP3' },
                      { value: 'm4a', label: 'M4A' },
                      { value: 'opus', label: 'Opus' },
                      { value: 'wav', label: 'WAV' }
                    ]}
                    value={audioFormat}
                  />
                </div>
              )}

              {exactFormats.length > 0 ? (
                <div className="field field-wide">
                  <span>{t('dialog.exactFormat')}</span>
                  <Combobox<string>
                    ariaLabel={t('dialog.exactFormat')}
                    onChange={setSelectedFormatId}
                    options={[
                      { value: '', label: t('dialog.formatDefault') },
                      ...exactFormats.map((format) => ({
                        value: format.id,
                        label: t('dialog.formatOption', {
                          quality: format.height
                            ? `${format.height}p`
                            : (format.note ?? t('common.audio')),
                          extension: format.extension.toUpperCase(),
                          codec:
                            mediaType === 'video'
                              ? (format.videoCodec ?? t('common.unknown'))
                              : (format.audioCodec ?? t('common.unknown'))
                        })
                      }))
                    ]}
                    value={selectedFormatId}
                  />
                </div>
              ) : null}

              <fieldset className="time-range field-wide">
                <legend>{t('dialog.timeRange')}</legend>
                <label className="field">
                  <span>{t('dialog.startTime')}</span>
                  <input
                    className="text-input"
                    onChange={(event) => setStartTime(event.target.value)}
                    placeholder={t('dialog.timePlaceholder')}
                    spellCheck={false}
                    value={startTime}
                  />
                </label>
                <label className="field">
                  <span>{t('dialog.endTime')}</span>
                  <input
                    className="text-input"
                    onChange={(event) => setEndTime(event.target.value)}
                    placeholder={t('dialog.timePlaceholder')}
                    spellCheck={false}
                    value={endTime}
                  />
                </label>
              </fieldset>

              <label className="field field-wide">
                <span>{t('dialog.filename')}</span>
                <input
                  className="text-input"
                  onChange={(event) => setCustomFilenameTemplate(event.target.value)}
                  placeholder={t('dialog.filenamePlaceholder')}
                  spellCheck={false}
                  value={customFilenameTemplate}
                />
              </label>

              {mediaInfo.isPlaylist ? (
                <div className="playlist-selector field-wide">
                  <div className="playlist-selector-header">
                    <div>
                      <strong>{t('dialog.playlistSelection')}</strong>
                      <span>
                        {t('dialog.selectedItems', {
                          selected: selectedEntryIds.size,
                          total: playlistItemCount
                        })}
                      </span>
                    </div>
                    <div>
                      <button
                        className="quiet-button"
                        onClick={() =>
                          setSelectedEntryIds(new Set(mediaInfo.entries.map((entry) => entry.id)))
                        }
                        type="button"
                      >
                        {t('dialog.selectAll')}
                      </button>
                      <button
                        className="quiet-button"
                        onClick={() => setSelectedEntryIds(new Set())}
                        type="button"
                      >
                        {t('dialog.selectNone')}
                      </button>
                    </div>
                  </div>
                  <div className="playlist-entry-list">
                    {mediaInfo.entries.map((entry, index) => (
                      <div className="playlist-entry" key={entry.id}>
                        <input
                          aria-label={entry.title}
                          checked={selectedEntryIds.has(entry.id)}
                          onChange={() => togglePlaylistEntry(entry.id)}
                          type="checkbox"
                        />
                        <span>{index + 1}</span>
                        <EditableTitle
                          as="strong"
                          onSave={(nextTitle) => {
                            setMediaInfo((current) => {
                              if (!current) {
                                return current
                              }
                              return {
                                ...current,
                                entries: current.entries.map((item) =>
                                  item.id === entry.id ? { ...item, title: nextTitle } : item
                                )
                              }
                            })
                          }}
                          title={entry.title}
                        />
                        <small>{formatDuration(entry.duration)}</small>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}

              <label className="checkbox-field field-wide">
                <input
                  checked={downloadSubtitles}
                  onChange={(event) => setDownloadSubtitles(event.target.checked)}
                  type="checkbox"
                />
                <span className="custom-checkbox">
                  <Check size={13} />
                </span>
                <span>{t('dialog.subtitles')}</span>
              </label>

              <div className="field field-wide">
                <span>{t('dialog.location')}</span>
                <button className="path-picker" onClick={chooseFolder} type="button">
                  <FolderOpen size={16} />
                  <span>{customDownloadPath || t('dialog.defaultLocation')}</span>
                  <strong>{t('dialog.choose')}</strong>
                </button>
              </div>
            </div>
          </div>
        ) : null}

        <div className="modal-footer">
          <button className="secondary-button" disabled={starting} onClick={onClose} type="button">
            {t('dialog.cancel')}
          </button>
          <button
            className="primary-button"
            disabled={!mediaInfo || loading || starting || itemCount === 0}
            onClick={handleStart}
            type="button"
          >
            {starting ? <LoaderCircle className="spin" size={16} /> : <Download size={16} />}
            {mediaInfo?.isPlaylist
              ? t('dialog.startPlaylist', { count: itemCount })
              : t('dialog.start')}
          </button>
        </div>
      </div>
    </div>
  )
}
