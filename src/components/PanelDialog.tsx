import { X } from 'lucide-react'
import { type ReactNode, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'

interface PanelDialogProps {
  children: ReactNode
  onClose: () => void
  title: string
  variant: 'about' | 'settings'
}

export function PanelDialog({ children, onClose, title, variant }: PanelDialogProps) {
  const { t } = useTranslation()
  const closeButtonRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null
    closeButtonRef.current?.focus()
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      previouslyFocused?.focus()
    }
  }, [onClose])

  return (
    <div className="app-panel-backdrop">
      <section
        aria-label={title}
        aria-modal="true"
        className={`app-panel-dialog app-panel-${variant}`}
        role="dialog"
      >
        <button
          aria-label={t('titlebar.close')}
          className="app-panel-close dialog-close-button icon-button"
          onClick={onClose}
          ref={closeButtonRef}
          title={t('titlebar.close')}
          type="button"
        >
          <X size={18} />
        </button>
        <div className="app-panel-scroll">{children}</div>
      </section>
    </div>
  )
}
