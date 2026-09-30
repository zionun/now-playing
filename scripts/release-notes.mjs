#!/usr/bin/env node
// Prints the CHANGELOG.md section of a version, used as the GitHub release text.
// Usage: node scripts/release-notes.mjs 0.9.0   (or v0.9.0)
import { readFileSync } from 'fs'

const version = (process.argv[2] || '').replace(/^v/, '')
if (!version) {
  console.error('Usage: release-notes.mjs <version>')
  process.exit(1)
}

const changelog = readFileSync(new URL('../CHANGELOG.md', import.meta.url), 'utf8')
const lines = changelog.split('\n')
const start = lines.findIndex(line => line.startsWith(`## [${version}]`))
if (start === -1) {
  console.error(`Version ${version} not found in CHANGELOG.md`)
  process.exit(1)
}
const end = lines.findIndex((line, i) => i > start && (line.startsWith('## [') || line.startsWith('[')))
console.log(lines.slice(start + 1, end === -1 ? undefined : end).join('\n').trim())
