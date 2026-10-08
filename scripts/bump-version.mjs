#!/usr/bin/env node
// Prepares a release: sets the version in the three package.json files (and
// their lockfiles) and moves the [Unreleased] entries of CHANGELOG.md under
// a new "## [x.y.z] - YYYY-MM-DD" heading, updating the links at the bottom.
// Commit the result in a pull request: when it is merged into main, the
// Release workflow tags the version and publishes the GitHub release.
// Usage: node scripts/bump-version.mjs 1.2.0
import { readFileSync, writeFileSync } from 'fs'

const REPO_URL = 'https://github.com/zionun/now-playing'
const PACKAGES = ['.', 'client', 'server']
const SEMVER = /^(\d+)\.(\d+)\.(\d+)(-[0-9A-Za-z.-]+)?$/

const root = new URL('../', import.meta.url)
const read = file => readFileSync(new URL(file, root), 'utf8')
const write = (file, text) => writeFileSync(new URL(file, root), text)
const fail = message => {
  console.error(message)
  process.exit(1)
}

// Precedence of two x.y.z[-pre] versions (a pre-release comes before its release)
const compare = (a, b) => {
  const [, ...pa] = a.match(SEMVER)
  const [, ...pb] = b.match(SEMVER)
  for (let i = 0; i < 3; i++) {
    if (Number(pa[i]) !== Number(pb[i])) return Number(pa[i]) - Number(pb[i])
  }
  if (pa[3] === pb[3]) return 0
  if (!pa[3]) return 1
  if (!pb[3]) return -1
  return pa[3] < pb[3] ? -1 : 1
}

const version = (process.argv[2] || '').replace(/^v/, '')
if (!SEMVER.test(version)) fail('Usage: node scripts/bump-version.mjs <x.y.z>   (e.g. 1.2.0 or 1.2.0-rc.1)')

const current = JSON.parse(read('package.json')).version
if (compare(version, current) <= 0) fail(`The new version must be greater than the current one (${current})`)

// CHANGELOG.md: [Unreleased] entries → new section, links updated
const changelog = read('CHANGELOG.md')
const lines = changelog.split('\n')
const unreleased = lines.findIndex(line => line.startsWith('## [Unreleased]'))
if (unreleased === -1) fail('No "## [Unreleased]" section in CHANGELOG.md')
const next = lines.findIndex((line, i) => i > unreleased && line.startsWith('## ['))
const entries = lines.slice(unreleased + 1, next === -1 ? undefined : next)
if (!entries.some(line => line.startsWith('- '))) fail('The [Unreleased] section of CHANGELOG.md is empty')

const date = new Date().toISOString().slice(0, 10)
const unreleasedLink = new RegExp(`^\\[Unreleased\\]: .*/compare/v(.+)\\.\\.\\.HEAD$`, 'm')
const previous = changelog.match(unreleasedLink)?.[1]
const updated = [
  ...lines.slice(0, unreleased + 1),
  '',
  `## [${version}] - ${date}`,
  ...entries,
  ...(next === -1 ? [] : lines.slice(next))
]
  .join('\n')
  .replace(
    unreleasedLink,
    `[Unreleased]: ${REPO_URL}/compare/v${version}...HEAD\n` +
      `[${version}]: ${previous ? `${REPO_URL}/compare/v${previous}...v${version}` : `${REPO_URL}/releases/tag/v${version}`}`
  )
write('CHANGELOG.md', updated)

// package.json and package-lock.json of the root, client and server
for (const dir of PACKAGES) {
  const pkgFile = `${dir}/package.json`
  const pkg = JSON.parse(read(pkgFile))
  pkg.version = version
  write(pkgFile, JSON.stringify(pkg, null, 2) + '\n')

  const lockFile = `${dir}/package-lock.json`
  const lock = JSON.parse(read(lockFile))
  lock.version = version
  if (lock.packages?.['']) lock.packages[''].version = version
  write(lockFile, JSON.stringify(lock, null, 2) + '\n')
}

console.log(`Version ${current} → ${version}, CHANGELOG section dated ${date}.`)
console.log('Review CHANGELOG.md, then commit in a pull request: merging it into main publishes the release.')
