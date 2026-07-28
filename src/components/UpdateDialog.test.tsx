import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../i18n'
import type { AppUpdateProgress } from '../lib/updates'
import { UpdateDialog } from './UpdateDialog'

const updateMocks = vi.hoisted(() => ({
  installAppUpdate: vi.fn()
}))

vi.mock('../lib/updates', () => ({
  installAppUpdate: updateMocks.installAppUpdate
}))

const updateInfo = {
  currentVersion: '0.1.0',
  latestVersion: '0.2.0',
  updateAvailable: true,
  releaseNotes: '## Features\n- Faster downloads'
}

describe('UpdateDialog', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('en')
  })

  beforeEach(() => {
    updateMocks.installAppUpdate.mockReset()
  })

  afterEach(() => {
    cleanup()
  })

  it('downloads and installs the update inside the app', async () => {
    updateMocks.installAppUpdate.mockImplementation(
      async (onProgress: (progress: AppUpdateProgress) => void): Promise<void> => {
        onProgress({
          downloadedBytes: 50,
          phase: 'downloading',
          totalBytes: 100
        })
      }
    )

    render(<UpdateDialog info={updateInfo} onClose={vi.fn()} onDismiss={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: 'Update now' }))

    expect(await screen.findByRole('progressbar', { name: 'Downloading… 50%' })).toBeTruthy()
    expect(updateMocks.installAppUpdate).toHaveBeenCalledOnce()
    expect((screen.getByRole('button', { name: 'Later' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('lets the user retry when installation fails', async () => {
    updateMocks.installAppUpdate.mockRejectedValue(new Error('network error'))

    render(<UpdateDialog info={updateInfo} onClose={vi.fn()} onDismiss={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: 'Update now' }))

    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain(
        'The update could not be installed. Please try again.'
      )
    })
    expect((screen.getByRole('button', { name: 'Update now' }) as HTMLButtonElement).disabled).toBe(
      false
    )
  })
})
