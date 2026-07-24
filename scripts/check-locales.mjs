import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const localeDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src/locales')

const collectKeys = (value, prefix = '') => {
  const keys = []
  for (const [key, child] of Object.entries(value)) {
    const nextPrefix = prefix ? `${prefix}.${key}` : key
    if (child && typeof child === 'object' && !Array.isArray(child)) {
      keys.push(...collectKeys(child, nextPrefix))
    } else {
      keys.push(nextPrefix)
    }
  }
  return keys
}

const readLocale = async (filename) => {
  const contents = await readFile(path.join(localeDirectory, filename), 'utf8')
  return JSON.parse(contents)
}

const englishKeys = new Set(collectKeys(await readLocale('en.json')))
const localeFiles = (await readdir(localeDirectory)).filter(
  (filename) => filename.endsWith('.json') && filename !== 'en.json'
)
let hasErrors = false

for (const filename of localeFiles) {
  const localeKeys = new Set(collectKeys(await readLocale(filename)))
  const missingKeys = [...englishKeys].filter((key) => !localeKeys.has(key))
  const extraKeys = [...localeKeys].filter((key) => !englishKeys.has(key))
  if (missingKeys.length > 0 || extraKeys.length > 0) {
    hasErrors = true
    console.error(
      `${filename}: missing [${missingKeys.join(', ')}], extra [${extraKeys.join(', ')}]`
    )
  }
}

if (hasErrors) {
  process.exitCode = 1
} else {
  console.info('OK: Vetch locale files match en.json.')
}
