import { useTranslation } from 'react-i18next'
import { AppIcon } from './AppIcon'

export function BrowserStart() {
  const { t } = useTranslation()

  return (
    <main className="browser-start">
      <AppIcon size={64} />
      <h1>Vetch</h1>
      <p>{t('browser.title')}</p>
    </main>
  )
}
