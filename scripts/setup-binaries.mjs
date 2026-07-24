#!/usr/bin/env node

/**
 * Download platform-matched yt-dlp, FFmpeg, FFprobe, and Deno into
 * src-tauri/resources/bin so Tauri can bundle them as app resources.
 *
 * Self-contained — does not depend on any parent monorepo scripts.
 */

import { execSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import https from 'node:https'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url))
const appDirectory = path.resolve(scriptDirectory, '..')
const binDirectory = path.join(appDirectory, 'src-tauri/resources/bin')
const cacheDirectory = path.join(appDirectory, '.vetch-bin-cache')
const manifestPath = path.join(appDirectory, 'third-party-binaries.json')
const binaryManifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
const platformKey = `${process.platform}-${os.arch()}`
const GITHUB_TOKEN =
  process.env.GITHUB_TOKEN || process.env.GH_TOKEN || process.env.GITHUB_API_TOKEN

const log = (message, type = 'info') => {
  const icons = {
    info: '📦',
    success: '✅',
    error: '❌',
    warn: '⚠️',
    download: '⬇️'
  }
  console.log(`${icons[type] || 'ℹ️'} ${message}`)
}

const validateManifest = () => {
  if (binaryManifest.schemaVersion !== 1) {
    throw new Error(`Unsupported binary manifest schema: ${binaryManifest.schemaVersion}`)
  }

  for (const componentName of ['yt-dlp', 'ffmpeg', 'deno']) {
    const component = binaryManifest.components?.[componentName]
    if (!(component?.license && component?.licenseFile && component?.assets)) {
      throw new Error(`Incomplete manifest entry for ${componentName}`)
    }
    if (!fs.existsSync(path.join(appDirectory, component.licenseFile))) {
      throw new Error(`Missing license file for ${componentName}: ${component.licenseFile}`)
    }

    for (const [assetKey, asset] of Object.entries(component.assets)) {
      if (!asset.url?.startsWith('https://')) {
        throw new Error(`Invalid download URL for ${componentName}/${assetKey}`)
      }
      if (/\/releases\/(latest|download\/latest)(\/|$)/.test(asset.url)) {
        throw new Error(`Mutable release URL is not allowed for ${componentName}/${assetKey}`)
      }
      if (!/^[a-f0-9]{64}$/.test(asset.sha256 ?? '')) {
        throw new Error(`Invalid SHA-256 for ${componentName}/${assetKey}`)
      }
    }
  }
}

const getAsset = (componentName) => {
  const asset = binaryManifest.components[componentName].assets[platformKey]
  if (!asset) {
    throw new Error(`Unsupported platform for ${componentName}: ${platformKey}`)
  }
  return asset
}

const ensureDir = (directory) => {
  fs.mkdirSync(directory, { recursive: true })
}

const safeUnlink = (filePath) => {
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath)
  }
}

const safeRm = (targetPath) => {
  if (fs.existsSync(targetPath)) {
    fs.rmSync(targetPath, { recursive: true, force: true })
  }
}

const setExecutable = (filePath) => {
  if (process.platform !== 'win32') {
    fs.chmodSync(filePath, 0o755)
  }
}

const fileExists = (filePath) => fs.existsSync(filePath)

const getDownloadHeaders = (url) => {
  const headers = {
    'User-Agent': 'vetch-setup',
    Accept: '*/*'
  }
  if (GITHUB_TOKEN && /github\.com|githubusercontent\.com/.test(url)) {
    headers.Authorization = `Bearer ${GITHUB_TOKEN}`
  }
  return headers
}

const downloadFile = (url, destination) =>
  new Promise((resolve, reject) => {
    const protocol = url.startsWith('https') ? https : http
    const file = fs.createWriteStream(destination)
    let settled = false

    const settle = () => {
      if (settled) {
        return false
      }
      settled = true
      request.setTimeout(0)
      return true
    }

    const request = protocol.get(url, { headers: getDownloadHeaders(url) }, (response) => {
      if (response.statusCode === 301 || response.statusCode === 302) {
        if (!settle()) {
          return
        }
        response.resume()
        file.close()
        safeUnlink(destination)
        const redirectUrl = response.headers.location
        if (!redirectUrl) {
          reject(new Error(`Redirect without location for ${url}`))
          return
        }
        downloadFile(redirectUrl, destination).then(resolve).catch(reject)
        return
      }

      if (response.statusCode !== 200) {
        if (!settle()) {
          return
        }
        response.resume()
        file.close()
        safeUnlink(destination)
        reject(new Error(`Failed to download ${url}: HTTP ${response.statusCode}`))
        return
      }

      response.pipe(file)
      file.on('finish', () => {
        if (!settle()) {
          return
        }
        file.close()
        resolve()
      })
    })

    request.setTimeout(60_000, () => {
      if (settled) {
        return
      }
      request.destroy(new Error('Download timeout'))
    })

    request.on('error', (error) => {
      if (!settle()) {
        return
      }
      file.close()
      safeUnlink(destination)
      reject(error)
    })
  })

const calculateSha256 = (filePath) =>
  new Promise((resolve, reject) => {
    const hash = createHash('sha256')
    const input = fs.createReadStream(filePath)
    input.on('error', reject)
    input.on('data', (chunk) => hash.update(chunk))
    input.on('end', () => resolve(hash.digest('hex')))
  })

const verifySha256 = async (filePath, expectedSha256) => {
  const actualSha256 = await calculateSha256(filePath)
  if (actualSha256 !== expectedSha256) {
    throw new Error(
      `SHA-256 mismatch for ${path.basename(filePath)}: expected ${expectedSha256}, got ${actualSha256}`
    )
  }
}

const downloadFileWithRetry = async (asset, destination, retries = 3) => {
  if (fileExists(destination)) {
    try {
      await verifySha256(destination, asset.sha256)
      log(`Using verified cache for ${path.basename(destination)}`, 'info')
      return
    } catch (error) {
      log(`Discarding invalid cache: ${error instanceof Error ? error.message : error}`, 'warn')
      safeUnlink(destination)
    }
  }

  let lastError
  for (let attempt = 1; attempt <= retries; attempt += 1) {
    try {
      log(`Downloading ${asset.url} (attempt ${attempt}/${retries})...`, 'download')
      await downloadFile(asset.url, destination)
      await verifySha256(destination, asset.sha256)
      log(`Verified SHA-256 for ${path.basename(destination)}`, 'success')
      return
    } catch (error) {
      lastError = error
      safeUnlink(destination)
      if (attempt < retries) {
        await new Promise((resolve) => setTimeout(resolve, 1500 * attempt))
      }
    }
  }
  throw lastError
}

const extractZip = (zipPath, extractDir) => {
  ensureDir(extractDir)
  if (process.platform === 'win32') {
    const zipAbs = path.resolve(zipPath).replace(/'/g, "''")
    const extractAbs = path.resolve(extractDir).replace(/'/g, "''")
    execSync(
      `powershell -NoProfile -Command "Expand-Archive -Path '${zipAbs}' -DestinationPath '${extractAbs}' -Force"`,
      { stdio: 'inherit' }
    )
    return
  }
  execSync(`unzip -q "${zipPath}" -d "${extractDir}"`, { stdio: 'inherit' })
}

const extractTarXz = (tarPath, extractDir) => {
  ensureDir(extractDir)
  execSync(`tar -xf "${tarPath}" -C "${extractDir}"`, { stdio: 'inherit' })
}

const findFirstFileByName = (directory, fileName) => {
  if (!fileExists(directory)) {
    return null
  }
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name)
    if (entry.isFile() && entry.name === fileName) {
      return fullPath
    }
    if (entry.isDirectory()) {
      const found = findFirstFileByName(fullPath, fileName)
      if (found) {
        return found
      }
    }
  }
  return null
}

const checkBinary = (filePath, args, label) => {
  const result = spawnSync(filePath, args, {
    encoding: 'utf8',
    // Freshly copied standalone binaries can trigger platform security scans.
    timeout: 45_000,
    windowsHide: true
  })
  if (result.error) {
    return { ok: false, message: result.error.message }
  }
  if (result.status !== 0) {
    const output = `${result.stdout || ''}\n${result.stderr || ''}`.trim()
    return { ok: false, message: output || `exit code ${result.status}` }
  }
  const output = `${result.stdout || ''}\n${result.stderr || ''}`.trim()
  const firstLine = output.split(/\r?\n/).find((line) => line.trim())
  return { ok: true, message: firstLine?.trim() || `${label} ok` }
}

const installBinary = (sourcePath, destinationPath, label) => {
  fs.copyFileSync(sourcePath, destinationPath)
  setExecutable(destinationPath)
  const args = label === 'yt-dlp' || label === 'deno' ? ['--version'] : ['-version']
  const checked = checkBinary(destinationPath, args, label)
  if (checked.ok) {
    log(`${label}: ${checked.message}`, 'info')
    return
  }
  safeUnlink(destinationPath)
  throw new Error(`${label} failed its version check after installation: ${checked.message}`)
}

const downloadYtDlp = async () => {
  const config = getAsset('yt-dlp')
  const destination = path.join(binDirectory, config.output)
  const assetPath = path.join(cacheDirectory, path.basename(new URL(config.url).pathname))
  await downloadFileWithRetry(config, assetPath)
  installBinary(assetPath, destination, 'yt-dlp')
  log('yt-dlp ready', 'success')
}

const downloadFfmpeg = async () => {
  const config = getAsset('ffmpeg')
  const ffmpegDestination = path.join(binDirectory, config.ffmpegOutput)
  const ffprobeDestination = path.join(binDirectory, config.ffprobeOutput)

  const archiveName = path.basename(new URL(config.url).pathname)
  const archivePath = path.join(cacheDirectory, archiveName)
  const extractDir = path.join(cacheDirectory, 'ffmpeg-extract')
  safeRm(extractDir)
  await downloadFileWithRetry(config, archivePath)

  if (config.extract === 'zip') {
    extractZip(archivePath, extractDir)
  } else {
    extractTarXz(archivePath, extractDir)
  }

  let ffmpegSource = path.join(extractDir, config.ffmpegInner)
  let ffprobeSource = path.join(extractDir, config.ffprobeInner)
  if (!fileExists(ffmpegSource)) {
    ffmpegSource = findFirstFileByName(extractDir, path.basename(config.ffmpegOutput))
  }
  if (!fileExists(ffprobeSource)) {
    ffprobeSource = findFirstFileByName(extractDir, path.basename(config.ffprobeOutput))
  }
  if (!(ffmpegSource && fileExists(ffmpegSource))) {
    throw new Error('ffmpeg binary not found in downloaded archive')
  }
  if (!(ffprobeSource && fileExists(ffprobeSource))) {
    throw new Error('ffprobe binary not found in downloaded archive')
  }

  installBinary(ffmpegSource, ffmpegDestination, 'ffmpeg')
  installBinary(ffprobeSource, ffprobeDestination, 'ffprobe')
  safeRm(extractDir)
  log('ffmpeg and ffprobe ready', 'success')
}

const downloadDeno = async () => {
  const config = getAsset('deno')
  const destination = path.join(binDirectory, config.output)

  const archivePath = path.join(cacheDirectory, path.basename(new URL(config.url).pathname))
  const extractDir = path.join(cacheDirectory, 'deno-extract')
  safeRm(extractDir)
  await downloadFileWithRetry(config, archivePath)
  extractZip(archivePath, extractDir)

  let sourcePath = path.join(extractDir, config.inner)
  if (!fileExists(sourcePath)) {
    sourcePath = findFirstFileByName(extractDir, path.basename(config.output))
  }
  if (!(sourcePath && fileExists(sourcePath))) {
    throw new Error('Deno binary not found in downloaded archive')
  }
  installBinary(sourcePath, destination, 'deno')
  safeRm(extractDir)
  log('deno ready', 'success')
}

const setup = async () => {
  log(`Preparing Vetch binaries for ${process.platform}/${os.arch()}...`, 'info')
  ensureDir(binDirectory)
  ensureDir(cacheDirectory)

  await downloadYtDlp()
  await downloadDeno()
  await downloadFfmpeg()

  log(`Binaries ready in ${binDirectory}`, 'success')
}

try {
  validateManifest()
  if (process.argv.includes('--verify-manifest')) {
    log(
      `Binary manifest is valid (${Object.keys(binaryManifest.components).join(', ')})`,
      'success'
    )
  } else {
    await setup()
  }
} catch (error) {
  log(error instanceof Error ? error.message : String(error), 'error')
  process.exit(1)
}
