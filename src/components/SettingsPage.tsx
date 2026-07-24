import { Cookie, Download, FileCog, FolderOpen, Globe2, MonitorCog, Network } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { selectConfigFile, selectCookiesFile, selectDirectory } from '../lib/backend'
import type { AppSettings, MediaType, ThemeMode } from '../types'
import { Combobox } from './Combobox'
import { Switch } from './Switch'

type SettingsTab = 'general' | 'download' | 'network'

interface SettingsPageProps {
  settings: AppSettings
  platform: string
  onChange: (settings: AppSettings) => void
}

interface SettingRowProps {
  children: React.ReactNode
  description: string
  title: string
}

function SettingRow({ children, description, title }: SettingRowProps) {
  return (
    <div className="setting-row">
      <div className="setting-copy">
        <div className="setting-label">{title}</div>
        <div className="setting-description">{description}</div>
      </div>
      <div className="setting-control">{children}</div>
    </div>
  )
}

export function SettingsPage({ settings, platform, onChange }: SettingsPageProps) {
  const { t } = useTranslation()
  const [activeTab, setActiveTab] = useState<SettingsTab>('general')

  const update = <Key extends keyof AppSettings>(key: Key, value: AppSettings[Key]) => {
    onChange({ ...settings, [key]: value })
  }

  const chooseDownloadDirectory = async () => {
    const path = await selectDirectory()
    if (path) {
      update('downloadPath', path)
    }
  }

  const chooseCookiesFile = async () => {
    const path = await selectCookiesFile()
    if (path) {
      update('cookiesPath', path)
    }
  }

  const chooseConfigFile = async () => {
    const path = await selectConfigFile()
    if (path) {
      update('configPath', path)
    }
  }

  const tabs = [
    { key: 'general' as const, label: t('settings.general'), icon: MonitorCog },
    { key: 'download' as const, label: t('settings.format'), icon: Download },
    { key: 'network' as const, label: t('settings.network'), icon: Network }
  ]

  return (
    <div className="page page-narrow settings-page">
      <div className="page-heading">
        <h1>{t('settings.title')}</h1>
        <p>{t('settings.description')}</p>
      </div>

      <div aria-label={t('settings.title')} className="settings-tabs" role="tablist">
        {tabs.map(({ key, label, icon: Icon }) => (
          <button
            aria-selected={activeTab === key}
            className="settings-tab"
            key={key}
            onClick={() => setActiveTab(key)}
            role="tab"
            type="button"
          >
            <Icon size={16} />
            {label}
          </button>
        ))}
      </div>

      {activeTab === 'general' ? (
        <section aria-label={t('settings.general')} className="settings-section">
          <SettingRow description={t('settings.themeDescription')} title={t('settings.theme')}>
            <div className="segmented-control compact">
              {(['system', 'light', 'dark'] as ThemeMode[]).map((theme) => (
                <button
                  aria-pressed={settings.theme === theme}
                  key={theme}
                  onClick={() => update('theme', theme)}
                  type="button"
                >
                  {t(`settings.${theme}`)}
                </button>
              ))}
            </div>
          </SettingRow>
          <SettingRow
            description={t('settings.languageDescription')}
            title={t('settings.language')}
          >
            <Combobox<AppSettings['language']>
              ariaLabel={t('settings.language')}
              onChange={(language) => update('language', language)}
              options={[
                { value: 'en', label: 'English' },
                { value: 'zh-CN', label: '简体中文' }
              ]}
              value={settings.language}
            />
          </SettingRow>
          <SettingRow
            description={t('settings.downloadLocationDescription')}
            title={t('settings.downloadLocation')}
          >
            <div className="path-control">
              <span title={settings.downloadPath}>
                {settings.downloadPath || t('common.automatic')}
              </span>
              <button
                aria-label={t('settings.chooseFolder')}
                className="secondary-button icon-text-button"
                onClick={chooseDownloadDirectory}
                type="button"
              >
                <FolderOpen size={16} />
                {t('settings.chooseFolder')}
              </button>
            </div>
          </SettingRow>
          <SettingRow
            description={t('settings.concurrentDescription')}
            title={t('settings.concurrent')}
          >
            <Combobox<number>
              ariaLabel={t('settings.concurrent')}
              onChange={(count) => update('maxConcurrentDownloads', count)}
              options={[1, 2, 3, 4, 5, 6, 8].map((count) => ({
                value: count,
                label: String(count)
              }))}
              value={settings.maxConcurrentDownloads}
            />
          </SettingRow>
          <SettingRow
            description={t('settings.notificationsDescription')}
            title={t('settings.notifications')}
          >
            <Switch
              checked={settings.notificationsEnabled}
              label={t('settings.notifications')}
              onChange={(checked) => update('notificationsEnabled', checked)}
            />
          </SettingRow>
          <SettingRow
            description={t('settings.autoCheckUpdatesDescription')}
            title={t('settings.autoCheckUpdates')}
          >
            <Switch
              checked={settings.autoCheckUpdates}
              label={t('settings.autoCheckUpdates')}
              onChange={(checked) => update('autoCheckUpdates', checked)}
            />
          </SettingRow>
          <SettingRow
            description={t('settings.launchAtLoginDescription')}
            title={t('settings.launchAtLogin')}
          >
            <Switch
              checked={settings.launchAtLogin}
              label={t('settings.launchAtLogin')}
              onChange={(checked) => update('launchAtLogin', checked)}
            />
          </SettingRow>
          {platform === 'macos' ? (
            <SettingRow
              description={t('settings.hideDockIconDescription')}
              title={t('settings.hideDockIcon')}
            >
              <Switch
                checked={settings.hideDockIcon}
                label={t('settings.hideDockIcon')}
                onChange={(checked) => update('hideDockIcon', checked)}
              />
            </SettingRow>
          ) : null}
        </section>
      ) : null}

      {activeTab === 'download' ? (
        <section aria-label={t('settings.format')} className="settings-section">
          <SettingRow
            description={t('settings.oneClickDescription')}
            title={t('settings.oneClick')}
          >
            <Switch
              checked={settings.oneClickDownload}
              label={t('settings.oneClick')}
              onChange={(checked) => update('oneClickDownload', checked)}
            />
          </SettingRow>
          <SettingRow
            description={t('settings.oneClickDescription')}
            title={t('settings.defaultType')}
          >
            <div className="segmented-control compact">
              {(['video', 'audio'] as MediaType[]).map((mediaType) => (
                <button
                  aria-pressed={settings.defaultMediaType === mediaType}
                  key={mediaType}
                  onClick={() => update('defaultMediaType', mediaType)}
                  type="button"
                >
                  {t(`common.${mediaType}`)}
                </button>
              ))}
            </div>
          </SettingRow>
          <SettingRow
            description={t('settings.oneClickDescription')}
            title={t('settings.videoQuality')}
          >
            <Combobox<AppSettings['videoQuality']>
              ariaLabel={t('settings.videoQuality')}
              onChange={(quality) => update('videoQuality', quality)}
              options={[
                { value: 'best', label: t('dialog.best') },
                { value: '2160', label: '2160p' },
                { value: '1440', label: '1440p' },
                { value: '1080', label: '1080p' },
                { value: '720', label: '720p' },
                { value: '480', label: '480p' }
              ]}
              value={settings.videoQuality}
            />
          </SettingRow>
          <SettingRow
            description={t('settings.oneClickDescription')}
            title={t('settings.videoContainer')}
          >
            <Combobox<AppSettings['videoContainer']>
              ariaLabel={t('settings.videoContainer')}
              onChange={(container) => update('videoContainer', container)}
              options={[
                { value: 'auto', label: t('common.automatic') },
                { value: 'mp4', label: 'MP4' },
                { value: 'mkv', label: 'MKV' },
                { value: 'webm', label: 'WebM' }
              ]}
              value={settings.videoContainer}
            />
          </SettingRow>
          <SettingRow
            description={t('settings.oneClickDescription')}
            title={t('settings.audioFormat')}
          >
            <Combobox<AppSettings['audioFormat']>
              ariaLabel={t('settings.audioFormat')}
              onChange={(format) => update('audioFormat', format)}
              options={[
                { value: 'mp3', label: 'MP3' },
                { value: 'm4a', label: 'M4A' },
                { value: 'opus', label: 'Opus' },
                { value: 'wav', label: 'WAV' }
              ]}
              value={settings.audioFormat}
            />
          </SettingRow>
          <SettingRow
            description={t('settings.filenameDescription')}
            title={t('settings.filename')}
          >
            <input
              aria-label={t('settings.filename')}
              className="setting-text-input text-input"
              onChange={(event) => update('filenameTemplate', event.target.value)}
              spellCheck={false}
              value={settings.filenameTemplate}
            />
          </SettingRow>
          <SettingRow
            description={t('settings.audioLanguageDescription')}
            title={t('settings.audioLanguage')}
          >
            <input
              aria-label={t('settings.audioLanguage')}
              className="setting-text-input text-input"
              onChange={(event) => update('preferredAudioLanguage', event.target.value)}
              placeholder={t('settings.audioLanguagePlaceholder')}
              spellCheck={false}
              value={settings.preferredAudioLanguage}
            />
          </SettingRow>
          <SettingRow
            description={t('settings.uploaderFolderDescription')}
            title={t('settings.uploaderFolder')}
          >
            <Switch
              checked={settings.createUploaderFolder}
              label={t('settings.uploaderFolder')}
              onChange={(checked) => update('createUploaderFolder', checked)}
            />
          </SettingRow>
          <SettingRow
            description={t('settings.subtitlesDescription')}
            title={t('settings.subtitles')}
          >
            <Switch
              checked={settings.downloadSubtitles}
              label={t('settings.subtitles')}
              onChange={(checked) => update('downloadSubtitles', checked)}
            />
          </SettingRow>
          <SettingRow
            description={t('settings.embedSubtitlesDescription')}
            title={t('settings.embedSubtitles')}
          >
            <Switch
              checked={settings.embedSubtitles}
              label={t('settings.embedSubtitles')}
              onChange={(checked) => update('embedSubtitles', checked)}
            />
          </SettingRow>
          <SettingRow
            description={t('settings.metadataDescription')}
            title={t('settings.metadata')}
          >
            <Switch
              checked={settings.embedMetadata}
              label={t('settings.metadata')}
              onChange={(checked) => update('embedMetadata', checked)}
            />
          </SettingRow>
          <SettingRow
            description={t('settings.chaptersDescription')}
            title={t('settings.chapters')}
          >
            <Switch
              checked={settings.embedChapters}
              label={t('settings.chapters')}
              onChange={(checked) => update('embedChapters', checked)}
            />
          </SettingRow>
          <SettingRow
            description={t('settings.thumbnailDescription')}
            title={t('settings.thumbnail')}
          >
            <Switch
              checked={settings.embedThumbnail}
              label={t('settings.thumbnail')}
              onChange={(checked) => update('embedThumbnail', checked)}
            />
          </SettingRow>
        </section>
      ) : null}

      {activeTab === 'network' ? (
        <section aria-label={t('settings.network')} className="settings-section">
          <SettingRow description={t('settings.proxyDescription')} title={t('settings.proxy')}>
            <div className="input-with-icon">
              <Globe2 size={16} />
              <input
                aria-label={t('settings.proxy')}
                className="text-input"
                onChange={(event) => update('proxy', event.target.value)}
                placeholder={t('settings.proxyPlaceholder')}
                spellCheck={false}
                value={settings.proxy}
              />
            </div>
          </SettingRow>
          <SettingRow
            description={t('settings.cookiesFileDescription')}
            title={t('settings.cookiesFile')}
          >
            <div className="path-control">
              <span title={settings.cookiesPath}>{settings.cookiesPath || t('settings.none')}</span>
              <button
                className="secondary-button icon-text-button"
                onClick={chooseCookiesFile}
                type="button"
              >
                <Cookie size={16} />
                {t('settings.chooseFile')}
              </button>
            </div>
          </SettingRow>
          <SettingRow
            description={t('settings.configFileDescription')}
            title={t('settings.configFile')}
          >
            <div className="path-control">
              <span title={settings.configPath}>{settings.configPath || t('settings.none')}</span>
              <button
                className="secondary-button icon-text-button"
                onClick={chooseConfigFile}
                type="button"
              >
                <FileCog size={16} />
                {t('settings.chooseFile')}
              </button>
            </div>
          </SettingRow>
          <SettingRow
            description={t('settings.browserCookiesDescription')}
            title={t('settings.browserCookies')}
          >
            <Combobox<AppSettings['browserForCookies']>
              ariaLabel={t('settings.browserCookies')}
              onChange={(browser) => update('browserForCookies', browser)}
              options={[
                { value: 'none', label: t('settings.none') },
                { value: 'chrome', label: 'Chrome' },
                { value: 'chromium', label: 'Chromium' },
                { value: 'edge', label: 'Microsoft Edge' },
                { value: 'firefox', label: 'Firefox' },
                { value: 'safari', label: 'Safari' },
                { value: 'brave', label: 'Brave' },
                { value: 'opera', label: 'Opera' },
                { value: 'vivaldi', label: 'Vivaldi' },
                { value: 'whale', label: 'Whale' }
              ]}
              value={settings.browserForCookies}
            />
          </SettingRow>
          <SettingRow
            description={t('settings.browserProfileDescription')}
            title={t('settings.browserProfile')}
          >
            <input
              aria-label={t('settings.browserProfile')}
              className="setting-text-input text-input"
              disabled={settings.browserForCookies === 'none'}
              onChange={(event) => update('browserCookiesProfile', event.target.value)}
              placeholder={t('settings.browserProfilePlaceholder')}
              spellCheck={false}
              value={settings.browserCookiesProfile}
            />
          </SettingRow>
        </section>
      ) : null}
    </div>
  )
}
