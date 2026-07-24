#!/usr/bin/env node

/**
 * Stamp a release tag (e.g. v0.1.0) into package.json, tauri.conf.json,
 * and Cargo.toml so the built artifacts carry the matching version.
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const tag = process.argv[2]
if (!tag) {
  console.error('Usage: node scripts/stamp-version.mjs <tag>')
  process.exit(1)
}

const version = tag.replace(/^v/, '')
if (!/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(version)) {
  console.error(`Invalid version derived from tag "${tag}": ${version}`)
  process.exit(1)
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const writeJsonVersion = (relativePath) => {
  const filePath = path.join(root, relativePath)
  const data = JSON.parse(fs.readFileSync(filePath, 'utf8'))
  data.version = version
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`)
  console.log(`Updated ${relativePath} → ${version}`)
}

writeJsonVersion('package.json')
writeJsonVersion('src-tauri/tauri.conf.json')

const cargoPath = path.join(root, 'src-tauri/Cargo.toml')
const cargo = fs.readFileSync(cargoPath, 'utf8')
const nextCargo = cargo.replace(/^version\s*=\s*"[^"]+"/m, `version = "${version}"`)
if (nextCargo === cargo) {
  console.error('Failed to update version in src-tauri/Cargo.toml')
  process.exit(1)
}
fs.writeFileSync(cargoPath, nextCargo)
console.log(`Updated src-tauri/Cargo.toml → ${version}`)
