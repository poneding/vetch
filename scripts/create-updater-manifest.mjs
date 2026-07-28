#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'

const GITHUB_REPOSITORY = 'poneding/vetch'

const readArgument = (name) => {
  const index = process.argv.indexOf(name)
  const value = index === -1 ? undefined : process.argv[index + 1]
  if (!value) {
    throw new Error(`Missing required argument: ${name}`)
  }
  return value
}

const tag = readArgument('--tag')
const notesPath = readArgument('--notes')
const assetsPath = readArgument('--assets')
const outputPath = readArgument('--output')
const version = tag.replace(/^v/, '')

if (!/^\d+\.\d+\.\d+(?:-[\w.]+)?$/.test(version)) {
  throw new Error(`Invalid release tag: ${tag}`)
}

const assetNames = fs
  .readdirSync(assetsPath, { withFileTypes: true })
  .filter((entry) => entry.isFile())
  .map((entry) => entry.name)

const findSignedAsset = (extensions) => {
  for (const extension of extensions) {
    const assetName = assetNames.find(
      (name) => name.endsWith(extension) && assetNames.includes(`${name}.sig`)
    )
    if (assetName) {
      return assetName
    }
  }
  throw new Error(`No signed updater asset found for ${extensions.join(' or ')}`)
}

const createPlatform = (assetName) => ({
  signature: fs.readFileSync(path.join(assetsPath, `${assetName}.sig`), 'utf8').trim(),
  url: `https://github.com/${GITHUB_REPOSITORY}/releases/download/${encodeURIComponent(tag)}/${encodeURIComponent(assetName)}`
})

const macAsset = findSignedAsset(['.app.tar.gz'])
const windowsAsset = findSignedAsset(['.exe', '.msi'])
const linuxAsset = findSignedAsset(['.AppImage'])
const macPlatform = createPlatform(macAsset)
const windowsPlatform = createPlatform(windowsAsset)
const linuxPlatform = createPlatform(linuxAsset)
const windowsInstaller = windowsAsset.endsWith('.exe') ? 'nsis' : 'msi'

const manifest = {
  version,
  notes: fs.readFileSync(notesPath, 'utf8').trim(),
  pub_date: new Date().toISOString(),
  platforms: {
    'darwin-aarch64': macPlatform,
    'darwin-aarch64-app': macPlatform,
    'linux-x86_64': linuxPlatform,
    'linux-x86_64-appimage': linuxPlatform,
    'windows-x86_64': windowsPlatform,
    [`windows-x86_64-${windowsInstaller}`]: windowsPlatform
  }
}

fs.writeFileSync(outputPath, `${JSON.stringify(manifest, null, 2)}\n`)
console.log(`Created updater manifest for ${version} at ${outputPath}`)
