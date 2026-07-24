import { LoaderCircle, TriangleAlert, X } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'

interface ConfirmationDialogProps {
  cancelLabel: string
  confirmLabel: string
  description: string
  onCancel: () => void
  onConfirm: () => Promise<void>
  title: string
}

export function ConfirmationDialog({
  cancelLabel,
  confirmLabel,
  description,
  onCancel,
  onConfirm,
  title
}: ConfirmationDialogProps) {
  const { t } = useTranslation()
  const [busy, setBusy] = useState(false)
  const titleId = useId()
  const descriptionId = useId()
  const cancelButtonRef = useRef<HTMLButtonElement>(null)
  const busyRef = useRef(busy)
  const onCancelRef = useRef(onCancel)

  busyRef.current = busy
  onCancelRef.current = onCancel

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null
    cancelButtonRef.current?.focus()

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busyRef.current) {
        onCancelRef.current()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      previouslyFocused?.focus()
    }
  }, [])

  const handleConfirm = async (): Promise<void> => {
    setBusy(true)
    try {
      await onConfirm()
    } finally {
      setBusy(false)
    }
  }

  return createPortal(
    <div className="modal-backdrop">
      <section
        aria-describedby={descriptionId}
        aria-labelledby={titleId}
        aria-modal="true"
        className="confirmation-dialog"
        role="alertdialog"
      >
        <div className="modal-header">
          <h2 id={titleId}>{title}</h2>
          <button
            aria-label={t('titlebar.close')}
            className="dialog-close-button icon-button"
            disabled={busy}
            onClick={onCancel}
            title={t('titlebar.close')}
            type="button"
          >
            <X size={17} />
          </button>
        </div>
        <div className="confirmation-content">
          <span className="confirmation-icon">
            <TriangleAlert size={20} />
          </span>
          <p id={descriptionId}>{description}</p>
        </div>
        <div className="modal-footer">
          <button
            className="secondary-button"
            disabled={busy}
            onClick={onCancel}
            ref={cancelButtonRef}
            type="button"
          >
            {cancelLabel}
          </button>
          <button
            className="danger-button"
            disabled={busy}
            onClick={() => void handleConfirm()}
            type="button"
          >
            {busy ? <LoaderCircle className="spin" size={15} /> : null}
            {confirmLabel}
          </button>
        </div>
      </section>
    </div>,
    document.body
  )
}
