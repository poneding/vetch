import { Globe2, Info, Minus, Settings, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { controlWindow } from '../lib/backend'
import { AppIcon } from './AppIcon'

interface TitleBarProps {
  activePanel?: 'about' | 'settings' | null
  browserMediaCount?: number
  onOpenAbout: () => void
  onOpenBrowser?: () => void
  onOpenSettings: () => void
  platform: string
  updateAvailable?: boolean
}

export function TitleBar({
  activePanel = null,
  browserMediaCount = 0,
  onOpenAbout,
  onOpenBrowser,
  onOpenSettings,
  platform,
  updateAvailable = false
}: TitleBarProps) {
  const { t } = useTranslation()
  const isMacOS = platform.toLowerCase() === 'macos'

  const rightNavigationItems = [
    {
      key: 'browser',
      label: t('titlebar.openBrowser'),
      icon: Globe2,
      onClick: onOpenBrowser ?? (() => undefined),
      badge: browserMediaCount,
      dot: false
    },
    {
      key: 'settings',
      label: t('titlebar.openSettings'),
      icon: Settings,
      onClick: onOpenSettings,
      badge: 0,
      dot: false
    },
    {
      key: 'about',
      label: t('titlebar.openAbout'),
      icon: Info,
      onClick: onOpenAbout,
      badge: 0,
      dot: updateAvailable
    }
  ]

  return (
    <header className={isMacOS ? 'titlebar titlebar-macos' : 'titlebar'}>
      <div className="titlebar-drag-region" data-tauri-drag-region />
      <div className="titlebar-brand">
        <AppIcon size={22} />
        <span>Vetch</span>
      </div>
      <div className="titlebar-right" data-tauri-drag-region="false">
        <nav aria-label={t('titlebar.navigation')} className="titlebar-navigation">
          {rightNavigationItems.map(({ key, label, icon: Icon, onClick, badge, dot }) => (
            <button
              aria-label={label}
              aria-pressed={key === 'browser' ? undefined : activePanel === key}
              className="icon-button titlebar-nav-button"
              key={key}
              onClick={onClick}
              title={label}
              type="button"
            >
              <Icon size={17} strokeWidth={2} />
              {badge > 0 ? <span className="titlebar-nav-badge">{Math.min(badge, 99)}</span> : null}
              {dot ? <span className="titlebar-nav-dot" /> : null}
            </button>
          ))}
        </nav>
        {isMacOS ? null : (
          <div className="window-controls">
            <button
              aria-label={t('titlebar.minimize')}
              className="window-control"
              onClick={() => void controlWindow('minimize')}
              title={t('titlebar.minimize')}
              type="button"
            >
              <Minus size={16} />
            </button>
            <button
              aria-label={t('titlebar.close')}
              className="window-control window-control-close"
              onClick={() => void controlWindow('close')}
              title={t('titlebar.close')}
              type="button"
            >
              <X size={17} />
            </button>
          </div>
        )}
      </div>
    </header>
  )
}
