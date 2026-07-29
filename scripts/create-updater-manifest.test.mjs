import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const scriptPath = path.join(root, 'scripts/create-updater-manifest.mjs')

const writeSignedAsset = async (assetsPath, name, signature) => {
  await fs.writeFile(path.join(assetsPath, name), `${name} contents`)
  await fs.writeFile(path.join(assetsPath, `${name}.sig`), signature)
}

test('creates installer-specific Windows updater entries', async () => {
  const tempPath = await fs.mkdtemp(path.join(os.tmpdir(), 'vetch-updater-manifest-'))

  try {
    const assetsPath = path.join(tempPath, 'assets')
    const notesPath = path.join(tempPath, 'notes.md')
    const outputPath = path.join(tempPath, 'latest.json')
    await fs.mkdir(assetsPath)
    await fs.writeFile(notesPath, 'Release notes')
    await Promise.all([
      writeSignedAsset(assetsPath, 'Vetch.app.tar.gz', 'mac-signature'),
      writeSignedAsset(assetsPath, 'Vetch_1.2.3_amd64.AppImage', 'linux-signature'),
      writeSignedAsset(assetsPath, 'Vetch_1.2.3_x64-setup.exe', 'nsis-signature'),
      writeSignedAsset(assetsPath, 'Vetch_1.2.3_x64_en-US.msi', 'msi-signature')
    ])

    await execFileAsync(process.execPath, [
      scriptPath,
      '--tag',
      'v1.2.3',
      '--notes',
      notesPath,
      '--assets',
      assetsPath,
      '--output',
      outputPath
    ])

    const manifest = JSON.parse(await fs.readFile(outputPath, 'utf8'))
    const platforms = manifest.platforms

    assert.equal(platforms['windows-x86_64'].signature, 'nsis-signature')
    assert.equal(platforms['windows-x86_64-nsis'].signature, 'nsis-signature')
    assert.equal(platforms['windows-x86_64-msi'].signature, 'msi-signature')
    assert.match(platforms['windows-x86_64-nsis'].url, /x64-setup\.exe$/)
    assert.match(platforms['windows-x86_64-msi'].url, /x64_en-US\.msi$/)
  } finally {
    await fs.rm(tempPath, { force: true, recursive: true })
  }
})
