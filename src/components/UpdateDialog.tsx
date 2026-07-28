import { ArrowUpCircle, LoaderCircle, X } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { renderSimpleMarkdown } from '../lib/markdown'
import { type AppUpdateProgress, installAppUpdate } from '../lib/updates'
import type { AppUpdateInfo } from '../types'

interface UpdateDialogProps {
  info: AppUpdateInfo
  onClose: () => void
  onDismiss: () => void
}

export function UpdateDialog({ info, onClose, onDismiss }: UpdateDialogProps) {
  const { t } = useTranslation()
  const [progress, setProgress] = useState<AppUpdateProgress | null>(null)
  const [error, setError] = useState('')
  const titleId = useId()
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const busyRef = useRef(false)
  const onCloseRef = useRef(onClose)
  const busy = progress !== null

  busyRef.current = busy
  onCloseRef.current = onClose

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null
    closeButtonRef.current?.focus()
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busyRef.current) {
        onCloseRef.current()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      previouslyFocused?.focus()
    }
  }, [])

  const handleUpdate = async (): Promise<void> => {
    setError('')
    setProgress({ downloadedBytes: 0, phase: 'downloading' })
    try {
      await installAppUpdate(setProgress)
    } catch {
      setProgress(null)
      setError(t('update.installFailed'))
    }
  }

  const notes =
    info.releaseNotes.trim().length > 0
      ? renderSimpleMarkdown(info.releaseNotes)
      : [<p key="empty">{t('update.noNotes')}</p>]
  const progressPercent =
    progress?.phase === 'downloading' && progress.totalBytes
      ? Math.min(100, Math.round((progress.downloadedBytes / progress.totalBytes) * 100))
      : null
  let actionLabel = t('update.updateNow')
  if (progress?.phase === 'downloading') {
    actionLabel =
      progressPercent === null
        ? t('update.preparing')
        : t('update.downloading', { progress: progressPercent })
  } else if (progress?.phase === 'installing') {
    actionLabel = t('update.installing')
  } else if (progress?.phase === 'relaunching') {
    actionLabel = t('update.relaunching')
  }

  return createPortal(
    <div className="modal-backdrop">
      <section
        aria-busy={busy}
        aria-labelledby={titleId}
        aria-modal="true"
        className="update-dialog"
        role="dialog"
      >
        <div className="modal-header">
          <h2 id={titleId}>{t('update.title')}</h2>
          <button
            aria-label={t('titlebar.close')}
            className="dialog-close-button icon-button"
            disabled={busy}
            onClick={onClose}
            ref={closeButtonRef}
            title={t('titlebar.close')}
            type="button"
          >
            <X size={17} />
          </button>
        </div>
        <div className="update-dialog-body">
          <div className="update-version-line">
            <ArrowUpCircle size={20} />
            <div>
              <strong>{t('update.available', { version: info.latestVersion })}</strong>
              <p>{t('update.current', { version: info.currentVersion })}</p>
            </div>
          </div>
          <div className="update-changelog" data-testid="update-changelog">
            <h3>{t('update.changelog')}</h3>
            <div className="update-changelog-content">{notes}</div>
          </div>
          {progress ? (
            <div aria-live="polite" className="update-progress">
              <span>{actionLabel}</span>
              {progressPercent === null ? null : (
                <progress aria-label={actionLabel} max={100} value={progressPercent} />
              )}
            </div>
          ) : null}
          {error ? (
            <p className="update-error" role="alert">
              {error}
            </p>
          ) : null}
        </div>
        <div className="modal-footer">
          <button className="secondary-button" disabled={busy} onClick={onDismiss} type="button">
            {t('update.later')}
          </button>
          <button
            className="primary-button"
            disabled={busy}
            onClick={() => void handleUpdate()}
            type="button"
          >
            {busy ? <LoaderCircle className="spin" size={16} /> : null}
            {actionLabel}
          </button>
        </div>
      </section>
    </div>,
    document.body
  )
}

interface UpdateCheckBusyProps {
  label: string
}

export function UpdateCheckBusy({ label }: UpdateCheckBusyProps) {
  return (
    <span className="update-check-busy">
      <LoaderCircle className="spin" size={14} />
      {label}
    </span>
  )
}
