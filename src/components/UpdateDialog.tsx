import { ArrowUpCircle, LoaderCircle, X } from 'lucide-react'
import { useEffect, useId, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { openExternalUrl } from '../lib/backend'
import { renderSimpleMarkdown } from '../lib/markdown'
import type { AppUpdateInfo } from '../types'

interface UpdateDialogProps {
  info: AppUpdateInfo
  onClose: () => void
  onDismiss: () => void
}

export function UpdateDialog({ info, onClose, onDismiss }: UpdateDialogProps) {
  const { t } = useTranslation()
  const titleId = useId()
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null
    closeButtonRef.current?.focus()
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
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
    await openExternalUrl(info.htmlUrl)
  }

  const notes =
    info.releaseNotes.trim().length > 0
      ? renderSimpleMarkdown(info.releaseNotes)
      : [<p key="empty">{t('update.noNotes')}</p>]

  return createPortal(
    <div className="modal-backdrop">
      <section aria-labelledby={titleId} aria-modal="true" className="update-dialog" role="dialog">
        <div className="modal-header">
          <h2 id={titleId}>{t('update.title')}</h2>
          <button
            aria-label={t('titlebar.close')}
            className="dialog-close-button icon-button"
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
        </div>
        <div className="modal-footer">
          <button className="secondary-button" onClick={onDismiss} type="button">
            {t('update.later')}
          </button>
          <button className="primary-button" onClick={() => void handleUpdate()} type="button">
            {t('update.openRelease')}
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
