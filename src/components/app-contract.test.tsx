import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../i18n'
import {
  type DownloadItem,
  defaultSettings,
  type RuntimeInfo,
  type StartDownloadRequest
} from '../types'
import { AboutPage } from './AboutPage'
import { BrowserMediaPanel } from './BrowserMediaPanel'
import { BrowserToolbar } from './BrowserToolbar'
import { DownloadDialog } from './DownloadDialog'
import { DownloadPage } from './DownloadPage'
import { DownloadRow } from './DownloadRow'
import { PanelDialog } from './PanelDialog'
import { PlaylistDownloadGroup } from './PlaylistDownloadGroup'
import { SettingsPage } from './SettingsPage'
import { TitleBar } from './TitleBar'

const backendMocks = vi.hoisted(() => ({
  browserBack: vi.fn(),
  browserFocusAddress: vi.fn(),
  browserForward: vi.fn(),
  browserNavigate: vi.fn(),
  browserReload: vi.fn(),
  clearBrowserMedia: vi.fn(),
  controlWindow: vi.fn(),
  getBrowserState: vi.fn(),
  isDesktopRuntime: vi.fn(() => false),
  probeUrl: vi.fn(),
  readClipboardUrl: vi.fn(),
  selectConfigFile: vi.fn(),
  selectCookiesFile: vi.fn(),
  selectBrowserMedia: vi.fn(),
  selectDirectory: vi.fn(),
  setBrowserMediaPanelOpen: vi.fn(),
  setBrowserMediaPanelWidth: vi.fn(),
  listenForBrowserState: vi.fn()
}))

vi.mock('../lib/backend', () => ({
  browserBack: backendMocks.browserBack,
  browserFocusAddress: backendMocks.browserFocusAddress,
  browserForward: backendMocks.browserForward,
  browserNavigate: backendMocks.browserNavigate,
  browserReload: backendMocks.browserReload,
  clearBrowserMedia: backendMocks.clearBrowserMedia,
  controlWindow: backendMocks.controlWindow,
  getBrowserState: backendMocks.getBrowserState,
  isDesktopRuntime: backendMocks.isDesktopRuntime,
  probeUrl: backendMocks.probeUrl,
  readClipboardUrl: backendMocks.readClipboardUrl,
  selectConfigFile: backendMocks.selectConfigFile,
  selectCookiesFile: backendMocks.selectCookiesFile,
  selectBrowserMedia: backendMocks.selectBrowserMedia,
  selectDirectory: backendMocks.selectDirectory,
  setBrowserMediaPanelOpen: backendMocks.setBrowserMediaPanelOpen,
  setBrowserMediaPanelWidth: backendMocks.setBrowserMediaPanelWidth,
  listenForBrowserState: backendMocks.listenForBrowserState
}))

const noop = async (): Promise<void> => undefined
const runtimeInfo: RuntimeInfo = {
  version: '0.1.0',
  platform: 'macos',
  architecture: 'aarch64',
  ytDlpReady: true,
  ffmpegReady: true
}
const completedDownload: DownloadItem = {
  id: 'download-1',
  url: 'https://example.com/video',
  title: 'Example video',
  mediaType: 'video',
  status: 'completed',
  progress: {
    percent: 100,
    downloadedBytes: 1024,
    totalBytes: 1024
  },
  log: '',
  createdAt: 1
}

describe('Vetch application contract', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('en')
  })

  beforeEach(async () => {
    await i18n.changeLanguage('en')
    backendMocks.controlWindow.mockClear()
    backendMocks.browserBack.mockReset()
    backendMocks.browserFocusAddress.mockReset()
    backendMocks.browserForward.mockReset()
    backendMocks.browserNavigate.mockReset()
    backendMocks.browserReload.mockReset()
    backendMocks.getBrowserState.mockReset()
    backendMocks.getBrowserState.mockResolvedValue({
      candidates: [],
      loading: false,
      mediaPanelOpen: false,
      pageUrl: '',
      title: ''
    })
    backendMocks.isDesktopRuntime.mockReset()
    backendMocks.isDesktopRuntime.mockReturnValue(false)
    backendMocks.readClipboardUrl.mockReset()
    backendMocks.probeUrl.mockReset()
    backendMocks.selectBrowserMedia.mockReset()
    backendMocks.setBrowserMediaPanelOpen.mockReset()
    backendMocks.setBrowserMediaPanelWidth.mockReset()
    backendMocks.listenForBrowserState.mockReset()
    backendMocks.listenForBrowserState.mockResolvedValue(() => undefined)
    backendMocks.selectConfigFile.mockClear()
    backendMocks.selectCookiesFile.mockClear()
    backendMocks.selectDirectory.mockClear()
  })

  afterEach(() => {
    cleanup()
  })

  it('centers the application title and keeps only panel actions in the title bar', () => {
    const onOpenSettings = vi.fn()
    const onOpenAbout = vi.fn()
    render(
      <TitleBar
        activePanel="settings"
        onOpenAbout={onOpenAbout}
        onOpenSettings={onOpenSettings}
        platform="macos"
      />
    )

    expect(document.querySelector('.titlebar-brand')).toBeTruthy()
    expect(screen.queryByLabelText('Open downloads')).toBeNull()
    const settingsButton = screen.getByLabelText('Open settings')
    const aboutButton = screen.getByLabelText('Open about')
    expect(settingsButton.getAttribute('aria-pressed')).toBe('true')
    expect(aboutButton.getAttribute('aria-pressed')).toBe('false')
    const browserButton = screen.getByLabelText('Open media browser')
    expect(settingsButton.closest('.titlebar-right')).toBeTruthy()
    expect(aboutButton.closest('.titlebar-right')).toBeTruthy()
    expect(aboutButton.querySelector('.lucide-info')).toBeTruthy()
    expect(screen.queryByLabelText('Close')).toBeNull()
    fireEvent.click(settingsButton)
    fireEvent.click(aboutButton)
    fireEvent.click(browserButton)

    expect(onOpenSettings).toHaveBeenCalledOnce()
    expect(onOpenAbout).toHaveBeenCalledOnce()
  })

  it('opens the detected media panel from the browser toolbar', async () => {
    backendMocks.getBrowserState.mockResolvedValue({
      candidates: [
        {
          id: 'stream-1',
          url: 'https://cdn.example.com/master.m3u8',
          pageUrl: 'https://example.com/watch',
          title: 'Example stream',
          mimeType: 'application/vnd.apple.mpegurl',
          kind: 'hls',
          source: 'fetch',
          score: 125,
          detectedAt: 1
        }
      ],
      loading: false,
      mediaPanelOpen: false,
      pageUrl: 'https://example.com/watch',
      title: 'Example stream'
    })
    render(<BrowserToolbar />)

    const mediaButton = await screen.findByRole('button', { name: 'Detected media' })
    await waitFor(() => expect(mediaButton.textContent).toContain('1'))
    fireEvent.click(mediaButton)

    expect(backendMocks.setBrowserMediaPanelOpen).toHaveBeenCalledWith(true)
  })

  it('handles browser keyboard shortcuts from the toolbar', async () => {
    backendMocks.getBrowserState.mockResolvedValue({
      candidates: [],
      loading: false,
      mediaPanelOpen: false,
      pageUrl: 'https://example.com/watch',
      title: 'Example stream'
    })
    render(<BrowserToolbar />)
    await waitFor(() => {
      expect((screen.getByRole('button', { name: 'Reload' }) as HTMLButtonElement).disabled).toBe(
        false
      )
    })

    fireEvent.keyDown(window, { key: 'r', metaKey: true })
    await waitFor(() => expect(backendMocks.browserReload).toHaveBeenCalled())

    fireEvent.keyDown(window, { key: '[', metaKey: true })
    await waitFor(() => expect(backendMocks.browserBack).toHaveBeenCalled())

    fireEvent.keyDown(window, { key: ']', metaKey: true })
    await waitFor(() => expect(backendMocks.browserForward).toHaveBeenCalled())

    fireEvent.keyDown(window, { key: 'b', metaKey: true })
    await waitFor(() => expect(backendMocks.setBrowserMediaPanelOpen).toHaveBeenCalledWith(true))

    const address = screen.getByRole('textbox', { name: 'Website address' }) as HTMLInputElement
    fireEvent.change(address, { target: { value: 'https://edited.example.com' } })
    fireEvent.keyDown(window, { key: 'l', metaKey: true })
    await waitFor(() => {
      expect(document.activeElement).toBe(address)
      expect(address.value).toBe('https://example.com/watch')
      expect(address.selectionStart).toBe(0)
      expect(address.selectionEnd).toBe(address.value.length)
    })
  })

  it('coalesces media panel resize requests while a native update is in flight', async () => {
    let resolveFirstRequest: (() => void) | undefined
    const firstRequest = new Promise<void>((resolve) => {
      resolveFirstRequest = resolve
    })
    backendMocks.setBrowserMediaPanelWidth
      .mockReturnValueOnce(firstRequest)
      .mockResolvedValue(undefined)
    render(<BrowserMediaPanel />)

    const resizeHandle = screen.getByRole('separator', {
      name: 'Resize detected media panel'
    })
    fireEvent.keyDown(resizeHandle, { key: 'ArrowRight' })
    await waitFor(() => expect(backendMocks.setBrowserMediaPanelWidth).toHaveBeenCalledTimes(1))

    fireEvent.keyDown(resizeHandle, { key: 'ArrowRight' })
    await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()))
    expect(backendMocks.setBrowserMediaPanelWidth).toHaveBeenCalledTimes(1)

    resolveFirstRequest?.()
    await waitFor(() => expect(backendMocks.setBrowserMediaPanelWidth).toHaveBeenCalledTimes(2))
    expect(backendMocks.setBrowserMediaPanelWidth).toHaveBeenLastCalledWith(448)
  })

  it('shows detected browser media and hands the selected candidate to Vetch', async () => {
    backendMocks.getBrowserState.mockResolvedValue({
      candidates: [
        {
          id: 'stream-1',
          url: 'https://cdn.example.com/master.m3u8',
          pageUrl: 'https://example.com/watch',
          title: 'Example stream',
          mimeType: 'application/vnd.apple.mpegurl',
          kind: 'hls',
          source: 'fetch',
          duration: 125,
          contentLength: 12_582_912,
          score: 125,
          detectedAt: 1
        }
      ],
      loading: false,
      mediaPanelOpen: true,
      pageUrl: 'https://example.com/watch',
      title: 'Example stream'
    })
    render(<BrowserMediaPanel />)

    expect(
      await screen.findByText(
        'HLS · cdn.example.com · 2:05 · 12.0 MB · application/vnd.apple.mpegurl'
      )
    ).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Configure download for Example stream' }))
    await waitFor(() => expect(backendMocks.selectBrowserMedia).toHaveBeenCalledWith('stream-1'))
  })

  it('navigates from the browser address action', async () => {
    render(<BrowserToolbar />)

    const address = await screen.findByRole('textbox', { name: 'Website address' })
    fireEvent.change(address, { target: { value: 'https://example.com/watch' } })
    fireEvent.click(screen.getByRole('button', { name: 'Go to address' }))

    await waitFor(() => {
      expect(backendMocks.browserNavigate).toHaveBeenCalledWith('https://example.com/watch')
    })
  })

  it('opens browser-detected media with its source-page referer', async () => {
    backendMocks.probeUrl.mockResolvedValue({
      id: 'stream-1',
      title: 'Example stream',
      url: 'https://cdn.example.com/master.m3u8',
      isPlaylist: false,
      entries: [],
      formats: []
    })
    const onHandled = vi.fn()
    render(
      <DownloadPage
        browserSelection={{
          id: 'stream-1',
          url: 'https://cdn.example.com/master.m3u8',
          pageUrl: 'https://example.com/watch',
          title: 'Example stream',
          kind: 'hls',
          source: 'fetch',
          score: 125,
          detectedAt: 1
        }}
        downloads={[]}
        onBrowserSelectionHandled={onHandled}
        onCancel={noop}
        onClearFinished={noop}
        onDeleteFile={async (_id: string): Promise<void> => undefined}
        onOpen={async (_path: string): Promise<void> => undefined}
        onOpenSource={async (_url: string): Promise<void> => undefined}
        onPause={noop}
        onQuickDownload={async (_url: string): Promise<void> => undefined}
        onRefreshPlaylist={async (): Promise<void> => undefined}
        onRemove={async (_id: string): Promise<void> => undefined}
        onRename={noop}
        onRenamePlaylist={noop}
        onResume={noop}
        onRetry={async (): Promise<void> => undefined}
        onReveal={async (_path: string): Promise<void> => undefined}
        onStart={async (): Promise<void> => undefined}
        settings={defaultSettings}
      />
    )

    await waitFor(() => {
      expect(backendMocks.probeUrl).toHaveBeenCalledWith(
        'https://cdn.example.com/master.m3u8',
        'https://example.com/watch',
        'summary'
      )
    })
    expect(await screen.findByRole('heading', { name: 'Download options' })).toBeTruthy()
    expect(onHandled).toHaveBeenCalled()
  })

  it('prefers the browser page title when probing a raw stream has a generic title', async () => {
    backendMocks.probeUrl.mockResolvedValue({
      id: 'master',
      title: 'master',
      url: 'https://cdn.example.com/master.m3u8',
      isPlaylist: false,
      entries: [],
      formats: []
    })
    const onStart = vi.fn(async (_requests: StartDownloadRequest[]): Promise<void> => undefined)
    render(
      <DownloadPage
        browserSelection={{
          id: 'stream-1',
          url: 'https://cdn.example.com/master.m3u8',
          pageUrl: 'https://example.com/watch',
          title: 'My Favorite Episode',
          kind: 'hls',
          source: 'fetch',
          score: 125,
          detectedAt: 1
        }}
        downloads={[]}
        onBrowserSelectionHandled={vi.fn()}
        onCancel={noop}
        onClearFinished={noop}
        onDeleteFile={async (_id: string): Promise<void> => undefined}
        onOpen={async (_path: string): Promise<void> => undefined}
        onOpenSource={async (_url: string): Promise<void> => undefined}
        onPause={noop}
        onQuickDownload={async (_url: string): Promise<void> => undefined}
        onRefreshPlaylist={async (): Promise<void> => undefined}
        onRemove={async (_id: string): Promise<void> => undefined}
        onRename={noop}
        onRenamePlaylist={noop}
        onResume={noop}
        onRetry={async (): Promise<void> => undefined}
        onReveal={async (_path: string): Promise<void> => undefined}
        onStart={onStart}
        settings={defaultSettings}
      />
    )

    expect(await screen.findByRole('heading', { name: 'My Favorite Episode' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Start download' }))
    await waitFor(() => {
      expect(onStart).toHaveBeenCalled()
    })
    expect(onStart.mock.calls[0]?.[0][0]?.title).toBe('My Favorite Episode')
  })

  it('keeps custom window controls operational outside macOS', () => {
    render(<TitleBar onOpenAbout={vi.fn()} onOpenSettings={vi.fn()} platform="windows" />)

    fireEvent.click(screen.getByLabelText('Minimize'))
    fireEvent.click(screen.getByLabelText('Close'))

    expect(backendMocks.controlWindow).toHaveBeenNthCalledWith(1, 'minimize')
    expect(backendMocks.controlWindow).toHaveBeenNthCalledWith(2, 'close')
    expect(screen.queryByLabelText('Maximize')).toBeNull()
  })

  it('renders settings and about as modal panels that close with Escape', () => {
    const onClose = vi.fn()
    render(
      <PanelDialog onClose={onClose} title="Settings" variant="settings">
        <SettingsPage onChange={vi.fn()} platform="macos" settings={defaultSettings} />
      </PanelDialog>
    )

    expect(screen.getByRole('dialog', { name: 'Settings' })).toBeTruthy()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledOnce()

    cleanup()
    render(
      <PanelDialog onClose={vi.fn()} title="About Vetch" variant="about">
        <AboutPage onCheckForUpdates={vi.fn()} onShowUpdate={vi.fn()} runtimeInfo={runtimeInfo} />
      </PanelDialog>
    )
    expect(screen.getByRole('dialog', { name: 'About Vetch' })).toBeTruthy()
  })

  it('supports playlist folder, bulk file deletion, and removal actions', async () => {
    const onDeleteFile = vi.fn(async (_id: string): Promise<void> => undefined)
    const onRemove = vi.fn(async (_id: string): Promise<void> => undefined)
    const onReveal = vi.fn(async (_path: string): Promise<void> => undefined)
    const onOpenSource = vi.fn(async (_url: string): Promise<void> => undefined)
    const playlistItems: DownloadItem[] = [
      {
        ...completedDownload,
        downloadDirectory: '/downloads/Example playlist [playlist-1]',
        filePath: '/downloads/Example playlist [playlist-1]/first.mp4',
        id: 'playlist-item-1',
        playlistId: 'playlist-1',
        playlistTitle: 'Example playlist',
        url: 'https://www.youtube.com/watch?v=first'
      },
      {
        ...completedDownload,
        downloadDirectory: '/downloads/Example playlist [playlist-1]',
        filePath: '/downloads/Example playlist [playlist-1]/second.mp4',
        id: 'playlist-item-2',
        playlistId: 'playlist-1',
        playlistTitle: 'Example playlist',
        status: 'cancelled',
        url: 'https://www.youtube.com/watch?v=second'
      }
    ]

    render(
      <PlaylistDownloadGroup
        allItems={playlistItems}
        items={playlistItems}
        onCancel={noop}
        onDeleteFile={onDeleteFile}
        onOpen={async (_path: string): Promise<void> => undefined}
        onOpenSource={onOpenSource}
        onPause={noop}
        onRefreshPlaylist={async (): Promise<void> => undefined}
        onRemove={onRemove}
        onRename={noop}
        onRenamePlaylist={noop}
        onResume={noop}
        onRetry={async (): Promise<void> => undefined}
        onReveal={onReveal}
        playlistId="playlist-1"
        title="Example playlist"
      />
    )

    fireEvent.click(screen.getByRole('link', { name: 'youtube.com' }))
    expect(onOpenSource).toHaveBeenCalledWith('https://www.youtube.com/watch?v=first')

    fireEvent.click(screen.getByRole('button', { name: 'Open playlist folder' }))
    expect(onReveal).toHaveBeenCalledWith('/downloads/Example playlist [playlist-1]')

    fireEvent.click(screen.getByRole('button', { name: 'Delete playlist files' }))
    expect(screen.getByRole('alertdialog', { name: 'Delete playlist files' })).toBeTruthy()
    expect(document.querySelector('.playlist-group-confirm')).toBeNull()
    expect(
      screen.getByText(
        'Permanently delete all downloaded files in this playlist and remove their history records?'
      )
    ).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Delete permanently' }))
    await waitFor(() => {
      expect(onDeleteFile).toHaveBeenCalledWith('playlist-item-1')
      expect(onDeleteFile).toHaveBeenCalledTimes(1)
    })

    fireEvent.click(screen.getByRole('button', { name: 'Remove playlist' }))
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }))
    await waitFor(() => {
      expect(onRemove).toHaveBeenCalledWith('playlist-item-1')
      expect(onRemove).toHaveBeenCalledWith('playlist-item-2')
    })
  })

  it('disables playlist rename for active children without disabling row rename', () => {
    const activeItem: DownloadItem = {
      ...completedDownload,
      id: 'active-playlist-item',
      playlistId: 'active-playlist',
      playlistTitle: 'Active playlist',
      status: 'downloading',
      title: 'Active video'
    }

    render(
      <PlaylistDownloadGroup
        allItems={[activeItem]}
        items={[activeItem]}
        onCancel={noop}
        onDeleteFile={noop}
        onOpen={noop}
        onOpenSource={noop}
        onPause={noop}
        onRefreshPlaylist={async (): Promise<void> => undefined}
        onRemove={noop}
        onRename={noop}
        onRenamePlaylist={noop}
        onResume={noop}
        onRetry={noop}
        onReveal={noop}
        playlistId="active-playlist"
        title="Active playlist"
      />
    )

    const playlistRenameButton = screen.getByText('Active playlist').closest('button')
    const rowRenameButton = screen.getByText('Active video').closest('button')
    expect((playlistRenameButton as HTMLButtonElement).disabled).toBe(true)
    expect((rowRenameButton as HTMLButtonElement).disabled).toBe(false)

    fireEvent.click(rowRenameButton as HTMLButtonElement)
    expect(screen.getByRole('textbox', { name: 'Filename' })).toBeTruthy()
  })

  it('uses all playlist children to disable rename and re-enables it for terminal-only groups', () => {
    const terminalItem: DownloadItem = {
      ...completedDownload,
      id: 'terminal-playlist-item',
      playlistId: 'filtered-playlist',
      playlistTitle: 'Filtered playlist'
    }
    const hiddenActiveItem: DownloadItem = {
      ...terminalItem,
      id: 'hidden-active-playlist-item',
      status: 'paused',
      title: 'Hidden active video'
    }
    const group = (allItems: DownloadItem[]) => (
      <PlaylistDownloadGroup
        allItems={allItems}
        items={[terminalItem]}
        onCancel={noop}
        onDeleteFile={noop}
        onOpen={noop}
        onOpenSource={noop}
        onPause={noop}
        onRefreshPlaylist={async (): Promise<void> => undefined}
        onRemove={noop}
        onRename={noop}
        onRenamePlaylist={noop}
        onResume={noop}
        onRetry={noop}
        onReveal={noop}
        playlistId="filtered-playlist"
        title="Filtered playlist"
      />
    )
    const { rerender } = render(group([terminalItem, hiddenActiveItem]))

    expect(
      (screen.getByText('Filtered playlist').closest('button') as HTMLButtonElement).disabled
    ).toBe(true)

    rerender(group([terminalItem]))
    const enabledRenameButton = screen.getByText('Filtered playlist').closest('button')
    expect((enabledRenameButton as HTMLButtonElement).disabled).toBe(false)
    fireEvent.click(enabledRenameButton as HTMLButtonElement)
    expect(screen.getByRole('textbox', { name: 'Filename' })).toBeTruthy()

    rerender(group([terminalItem, hiddenActiveItem]))
    expect(screen.queryByRole('textbox', { name: 'Filename' })).toBeNull()
    expect(
      (screen.getByText('Filtered playlist').closest('button') as HTMLButtonElement).disabled
    ).toBe(true)
  })

  it('confirms file deletion in a modal dialog', async () => {
    const onDeleteFile = vi.fn(async (_id: string): Promise<void> => undefined)
    render(
      <DownloadRow
        item={{ ...completedDownload, filePath: '/downloads/example.mp4' }}
        onCancel={noop}
        onDeleteFile={onDeleteFile}
        onOpen={noop}
        onOpenSource={noop}
        onPause={noop}
        onRemove={noop}
        onRename={noop}
        onResume={noop}
        onRetry={noop}
        onReveal={noop}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Delete file' }))
    const dialog = screen.getByRole('alertdialog', { name: 'Delete file' })
    expect(dialog.closest('.modal-backdrop')).toBeTruthy()
    expect(document.querySelector('.download-row .inline-confirm')).toBeNull()

    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByRole('alertdialog', { name: 'Delete file' })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Delete file' }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete permanently' }))
    await waitFor(() => {
      expect(onDeleteFile).toHaveBeenCalledWith('download-1')
      expect(screen.queryByRole('alertdialog', { name: 'Delete file' })).toBeNull()
    })
  })

  it('renders queue actions and opens the editable link dialog', async () => {
    render(
      <DownloadPage
        downloads={[]}
        onCancel={noop}
        onClearFinished={noop}
        onDeleteFile={async (_id: string): Promise<void> => undefined}
        onOpen={async (_path: string): Promise<void> => undefined}
        onOpenSource={async (_url: string): Promise<void> => undefined}
        onPause={noop}
        onQuickDownload={async (_url: string): Promise<void> => undefined}
        onRefreshPlaylist={async (): Promise<void> => undefined}
        onRemove={async (_id: string): Promise<void> => undefined}
        onRename={noop}
        onRenamePlaylist={noop}
        onResume={noop}
        onRetry={async (): Promise<void> => undefined}
        onReveal={async (_path: string): Promise<void> => undefined}
        onStart={async (): Promise<void> => undefined}
        settings={defaultSettings}
      />
    )

    expect(screen.queryByRole('heading', { name: 'Enter video URL' })).toBeNull()
    expect(
      (
        screen.getByRole('button', {
          name: 'Quick download from clipboard as Video'
        }) as HTMLButtonElement
      ).disabled
    ).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Add download' }))

    expect(await screen.findByRole('dialog', { name: 'Add download' })).toBeTruthy()
    expect(screen.getByLabelText('Enter video URL')).toBeTruthy()
    expect(screen.getByLabelText('Paste').textContent).toBe('')
    expect(screen.getByRole('button', { name: 'Configure download' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Download now' })).toBeTruthy()
    expect(screen.getByRole('button', { name: /All\s*0/ })).toBeTruthy()
    expect(screen.getByText('Your download queue is empty')).toBeTruthy()
  })

  it('downloads a valid clipboard URL and configures an edited URL', async () => {
    backendMocks.isDesktopRuntime.mockReturnValue(true)
    backendMocks.readClipboardUrl.mockResolvedValue('https://example.com/video')
    backendMocks.probeUrl.mockResolvedValue({
      id: 'video-1',
      title: 'Edited video',
      url: 'https://example.com/edited',
      isPlaylist: false,
      entries: [],
      formats: []
    })
    const onQuickDownload = vi.fn(async (_url: string): Promise<void> => undefined)
    render(
      <DownloadPage
        downloads={[]}
        onCancel={noop}
        onClearFinished={noop}
        onDeleteFile={async (_id: string): Promise<void> => undefined}
        onOpen={async (_path: string): Promise<void> => undefined}
        onOpenSource={async (_url: string): Promise<void> => undefined}
        onPause={noop}
        onQuickDownload={onQuickDownload}
        onRefreshPlaylist={async (): Promise<void> => undefined}
        onRemove={async (_id: string): Promise<void> => undefined}
        onRename={noop}
        onRenamePlaylist={noop}
        onResume={noop}
        onRetry={async (): Promise<void> => undefined}
        onReveal={async (_path: string): Promise<void> => undefined}
        onStart={async (): Promise<void> => undefined}
        settings={defaultSettings}
      />
    )

    const quickDownloadButton = screen.getByRole('button', {
      name: 'Quick download from clipboard as Video'
    })
    await waitFor(() => {
      expect(quickDownloadButton.getAttribute('data-clipboard-url')).toBe('true')
    })
    fireEvent.click(quickDownloadButton)
    await waitFor(() => {
      expect(onQuickDownload).toHaveBeenCalledWith('https://example.com/video')
    })

    fireEvent.click(screen.getByRole('button', { name: 'Add download' }))
    const urlInput = await screen.findByLabelText('Enter video URL')
    expect((urlInput as HTMLInputElement).value).toBe('https://example.com/video')
    fireEvent.change(urlInput, { target: { value: 'https://example.com/edited' } })
    fireEvent.click(screen.getByRole('button', { name: 'Configure download' }))

    await waitFor(() => {
      expect(backendMocks.probeUrl).toHaveBeenCalledWith(
        'https://example.com/edited',
        undefined,
        'summary'
      )
    })
    expect(await screen.findByRole('heading', { name: 'Download options' })).toBeTruthy()
  })

  it('opens clipboard downloads in the options dialog when one-click is disabled', async () => {
    backendMocks.isDesktopRuntime.mockReturnValue(true)
    backendMocks.readClipboardUrl.mockResolvedValue('https://example.com/playlist')
    backendMocks.probeUrl.mockResolvedValue({
      id: 'playlist-1',
      title: 'Example playlist',
      url: 'https://example.com/playlist',
      isPlaylist: true,
      entries: [
        {
          id: 'video-1',
          title: 'Example video',
          url: 'https://example.com/video'
        }
      ],
      formats: []
    })
    const onQuickDownload = vi.fn(async (_url: string): Promise<void> => undefined)
    render(
      <DownloadPage
        downloads={[]}
        onCancel={noop}
        onClearFinished={noop}
        onDeleteFile={async (_id: string): Promise<void> => undefined}
        onOpen={async (_path: string): Promise<void> => undefined}
        onOpenSource={async (_url: string): Promise<void> => undefined}
        onPause={noop}
        onQuickDownload={onQuickDownload}
        onRefreshPlaylist={async (): Promise<void> => undefined}
        onRemove={async (_id: string): Promise<void> => undefined}
        onRename={noop}
        onRenamePlaylist={noop}
        onResume={noop}
        onRetry={async (): Promise<void> => undefined}
        onReveal={async (_path: string): Promise<void> => undefined}
        onStart={async (): Promise<void> => undefined}
        settings={{ ...defaultSettings, oneClickDownload: false }}
      />
    )

    const configureButton = screen.getByRole('button', { name: 'Configure clipboard download' })
    await waitFor(() => {
      expect(configureButton.getAttribute('data-clipboard-url')).toBe('true')
    })
    fireEvent.click(configureButton)

    expect(await screen.findByRole('heading', { name: 'Download options' })).toBeTruthy()
    expect(onQuickDownload).not.toHaveBeenCalled()
    expect(backendMocks.probeUrl).toHaveBeenCalledOnce()
    expect(backendMocks.probeUrl).toHaveBeenCalledWith(
      'https://example.com/playlist',
      undefined,
      'summary'
    )
  })

  it('opens source links and keeps the clear action in the filter row', () => {
    const onClearFinished = vi.fn(async (): Promise<void> => undefined)
    const onOpenSource = vi.fn(async (_url: string): Promise<void> => undefined)
    render(
      <DownloadPage
        downloads={[completedDownload]}
        onCancel={noop}
        onClearFinished={onClearFinished}
        onDeleteFile={async (_id: string): Promise<void> => undefined}
        onOpen={async (_path: string): Promise<void> => undefined}
        onOpenSource={onOpenSource}
        onPause={noop}
        onQuickDownload={async (_url: string): Promise<void> => undefined}
        onRefreshPlaylist={async (): Promise<void> => undefined}
        onRemove={async (_id: string): Promise<void> => undefined}
        onRename={noop}
        onRenamePlaylist={noop}
        onResume={noop}
        onRetry={async (): Promise<void> => undefined}
        onReveal={async (_path: string): Promise<void> => undefined}
        onStart={async (): Promise<void> => undefined}
        settings={defaultSettings}
      />
    )

    const sourceLink = screen.getByRole('link', { name: /example\.com/ })
    expect(sourceLink.getAttribute('target')).toBe('_blank')
    expect(sourceLink.getAttribute('rel')).toContain('noopener')
    fireEvent.click(sourceLink)
    expect(onOpenSource).toHaveBeenCalledWith('https://example.com/video')

    const clearButton = screen.getByRole('button', { name: 'Clear finished' })
    expect(clearButton.closest('.filter-bar')).toBeTruthy()
    expect(clearButton.querySelector('.lucide-brush-cleaning')).toBeTruthy()
    fireEvent.click(clearButton)
    expect(onClearFinished).toHaveBeenCalledOnce()
  })

  it('loads thumbnails securely and falls back when an image fails', () => {
    render(
      <DownloadPage
        downloads={[
          {
            ...completedDownload,
            thumbnail: 'http://cdn.example.com/thumbnail.jpg'
          }
        ]}
        onCancel={noop}
        onClearFinished={noop}
        onDeleteFile={async (_id: string): Promise<void> => undefined}
        onOpen={async (_path: string): Promise<void> => undefined}
        onOpenSource={async (_url: string): Promise<void> => undefined}
        onPause={noop}
        onQuickDownload={async (_url: string): Promise<void> => undefined}
        onRefreshPlaylist={async (): Promise<void> => undefined}
        onRemove={async (_id: string): Promise<void> => undefined}
        onRename={noop}
        onRenamePlaylist={noop}
        onResume={noop}
        onRetry={async (): Promise<void> => undefined}
        onReveal={async (_path: string): Promise<void> => undefined}
        onStart={async (): Promise<void> => undefined}
        settings={defaultSettings}
      />
    )

    const thumbnail = document.querySelector('.download-thumbnail img') as HTMLImageElement
    expect(thumbnail.src).toBe('https://cdn.example.com/thumbnail.jpg')
    fireEvent.error(thumbnail)
    expect(document.querySelector('.download-thumbnail .lucide-file-play')).toBeTruthy()
  })

  it('renders operational download and system settings', () => {
    const onChange = vi.fn()
    render(<SettingsPage onChange={onChange} platform="macos" settings={defaultSettings} />)

    expect(screen.getByText('Download location')).toBeTruthy()
    expect(screen.getByText('Completion notifications')).toBeTruthy()
    expect(screen.getByText('Start at login')).toBeTruthy()
    expect(screen.getByText('Hide Dock icon')).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'General' })).toBeNull()
    expect(screen.getByRole('tab', { name: 'General' }).getAttribute('aria-selected')).toBe('true')
    fireEvent.click(screen.getByRole('combobox', { name: 'Language' }))
    fireEvent.click(screen.getByRole('option', { name: '简体中文' }))
    expect(onChange).toHaveBeenCalledWith({ ...defaultSettings, language: 'zh-CN' })
    expect(document.querySelector('select')).toBeNull()

    fireEvent.click(screen.getByRole('tab', { name: 'Download' }))
    expect(screen.getByRole('tab', { name: 'Download' }).getAttribute('aria-selected')).toBe('true')
    expect(screen.getByText('Filename template')).toBeTruthy()
    expect(screen.getByText('Preferred audio language')).toBeTruthy()
    expect(screen.getByRole('combobox', { name: 'Default video quality' })).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'Download' })).toBeNull()
    expect(document.querySelector('select')).toBeNull()

    fireEvent.click(screen.getByRole('tab', { name: 'Network' }))
    expect(screen.getByText('yt-dlp config file')).toBeTruthy()
    expect(screen.getByText('Browser profile')).toBeTruthy()
    expect(screen.getByRole('combobox', { name: 'Cookies from browser' })).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'Network' })).toBeNull()
    expect(document.querySelector('select')).toBeNull()
  })

  it('uses comboboxes for every download format selector', async () => {
    backendMocks.probeUrl.mockResolvedValue({
      id: 'video-1',
      title: 'Example video',
      url: 'https://example.com/video',
      isPlaylist: false,
      entries: [],
      formats: [
        {
          id: '137',
          extension: 'mp4',
          height: 1080,
          videoCodec: 'avc1',
          audioCodec: 'none'
        }
      ]
    })
    render(
      <DownloadDialog
        onClose={vi.fn()}
        onStart={async (): Promise<void> => undefined}
        open
        settings={defaultSettings}
        url="https://example.com/video"
      />
    )

    expect(await screen.findByRole('combobox', { name: 'Video quality' })).toBeTruthy()
    expect(screen.getByRole('combobox', { name: 'Video container' })).toBeTruthy()
    expect(screen.getByRole('combobox', { name: 'Exact format' })).toBeTruthy()
    expect(document.querySelector('select')).toBeNull()
  })

  it('renders the interface in Simplified Chinese', async () => {
    await i18n.changeLanguage('zh-CN')
    render(
      <DownloadPage
        downloads={[]}
        onCancel={noop}
        onClearFinished={noop}
        onDeleteFile={async (_id: string): Promise<void> => undefined}
        onOpen={async (_path: string): Promise<void> => undefined}
        onOpenSource={async (_url: string): Promise<void> => undefined}
        onPause={noop}
        onQuickDownload={async (_url: string): Promise<void> => undefined}
        onRefreshPlaylist={async (): Promise<void> => undefined}
        onRemove={async (_id: string): Promise<void> => undefined}
        onRename={noop}
        onRenamePlaylist={noop}
        onResume={noop}
        onRetry={async (): Promise<void> => undefined}
        onReveal={async (_path: string): Promise<void> => undefined}
        onStart={async (): Promise<void> => undefined}
        settings={{ ...defaultSettings, language: 'zh-CN' }}
      />
    )

    expect(screen.queryByRole('heading', { name: '输入视频链接' })).toBeNull()
    expect(screen.getByRole('button', { name: '添加下载' })).toBeTruthy()
    expect(screen.getByText('下载队列')).toBeTruthy()
  })

  it('renders Vetch about information without product links', () => {
    render(
      <AboutPage onCheckForUpdates={vi.fn()} onShowUpdate={vi.fn()} runtimeInfo={runtimeInfo} />
    )

    expect(screen.getByRole('heading', { name: 'About Vetch' })).toBeTruthy()
    expect(screen.getByText('yt-dlp')).toBeTruthy()
    expect(screen.getByText('FFmpeg')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Check for updates' })).toBeTruthy()
    expect(document.querySelectorAll('a').length).toBe(0)
  })

  it('shows an update icon on the about version badge when an update is available', () => {
    render(
      <AboutPage
        onCheckForUpdates={vi.fn()}
        onShowUpdate={vi.fn()}
        runtimeInfo={runtimeInfo}
        updateInfo={{
          currentVersion: '0.1.0',
          latestVersion: '0.2.0',
          updateAvailable: true,
          releaseNotes: '## Features\n- Faster downloads',
          htmlUrl: 'https://github.com/poneding/vetch/releases/tag/v0.2.0'
        }}
      />
    )

    expect(screen.getByRole('button', { name: 'Version 0.2.0 is available' })).toBeTruthy()
  })
})
