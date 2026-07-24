import {
  ArrowUpCircle,
  CheckCircle2,
  Cpu,
  HardDrive,
  LoaderCircle,
  RefreshCw,
  ShieldCheck,
  XCircle
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { AppUpdateInfo, RuntimeInfo } from '../types'
import { AppIcon } from './AppIcon'

interface AboutPageProps {
  runtimeInfo: RuntimeInfo
  updateInfo?: AppUpdateInfo | null
  updateChecking?: boolean
  onCheckForUpdates: () => void
  onShowUpdate: () => void
}

interface EngineStatusProps {
  label: string
  ready: boolean
  readyLabel: string
  unavailableLabel: string
}

function EngineStatus({ label, ready, readyLabel, unavailableLabel }: EngineStatusProps) {
  return (
    <div className="engine-status">
      <div className="engine-name">
        {ready ? <CheckCircle2 size={18} /> : <XCircle size={18} />}
        <span>{label}</span>
      </div>
      <span className={ready ? 'status-pill status-success' : 'status-pill status-muted'}>
        {ready ? readyLabel : unavailableLabel}
      </span>
    </div>
  )
}

export function AboutPage({
  runtimeInfo,
  updateInfo = null,
  updateChecking = false,
  onCheckForUpdates,
  onShowUpdate
}: AboutPageProps) {
  const { t } = useTranslation()
  const hasUpdate = Boolean(updateInfo?.updateAvailable)

  return (
    <div className="page page-narrow about-page">
      <section className="about-intro">
        <AppIcon size={76} />
        <div>
          <h1>{t('about.title')}</h1>
          <p>{t('about.description')}</p>
          <div className="about-version-row">
            <span className={hasUpdate ? 'version-label has-update' : 'version-label'}>
              {t('about.version', { version: runtimeInfo.version })}
              {hasUpdate ? (
                <button
                  aria-label={t('update.available', {
                    version: updateInfo?.latestVersion ?? ''
                  })}
                  className="version-update-icon"
                  onClick={onShowUpdate}
                  title={t('update.available', { version: updateInfo?.latestVersion ?? '' })}
                  type="button"
                >
                  <ArrowUpCircle size={14} />
                </button>
              ) : null}
            </span>
            <button
              className="secondary-button icon-text-button about-check-update"
              disabled={updateChecking}
              onClick={onCheckForUpdates}
              type="button"
            >
              {updateChecking ? (
                <LoaderCircle className="spin" size={15} />
              ) : (
                <RefreshCw size={15} />
              )}
              {updateChecking ? t('update.checking') : t('update.check')}
            </button>
          </div>
        </div>
      </section>

      <section className="about-section">
        <div className="section-heading-with-icon">
          <Cpu size={20} />
          <div>
            <h2>{t('about.engine')}</h2>
            <p>{t('about.engineDescription')}</p>
          </div>
        </div>
        <div className="engine-grid">
          <EngineStatus
            label={t('about.ytDlp')}
            ready={runtimeInfo.ytDlpReady}
            readyLabel={t('about.ready')}
            unavailableLabel={t('about.notFound')}
          />
          <EngineStatus
            label={t('about.ffmpeg')}
            ready={runtimeInfo.ffmpegReady}
            readyLabel={t('about.ready')}
            unavailableLabel={t('about.notFound')}
          />
        </div>
        <div className="platform-line">
          <span>{t('about.platform')}</span>
          <strong>
            {runtimeInfo.platform} · {runtimeInfo.architecture}
          </strong>
        </div>
      </section>

      <section className="about-info-grid">
        <article className="about-info-item">
          <ShieldCheck size={21} />
          <div>
            <h2>{t('about.privacy')}</h2>
            <p>{t('about.privacyDescription')}</p>
          </div>
        </article>
        <article className="about-info-item">
          <HardDrive size={21} />
          <div>
            <h2>{t('about.license')}</h2>
            <p>{t('about.licenseDescription')}</p>
          </div>
        </article>
      </section>
    </div>
  )
}
