import { test } from 'vitest'
import assert from 'node:assert/strict'
import fs from 'fs/promises'
import os from 'os'
import path from 'path'
import { ConfigService, resolveConfigPath } from '../src/services/ConfigService.js'

const tempDir = () => fs.mkdtemp(path.join(os.tmpdir(), 'now-playing-test-'))
const mode = async file => (await fs.stat(file)).mode & 0o777

test('resolveConfigPath: environment variable, then user folder', () => {
  assert.equal(resolveConfigPath({ NOW_PLAYING_CONFIG: '/tmp/x/config.json' }), '/tmp/x/config.json')
  if (process.getuid?.() !== 0) {
    assert.equal(
      resolveConfigPath({ XDG_CONFIG_HOME: '/home/u/.config' }),
      '/home/u/.config/now-playing/config.json'
    )
  }
})

test('first run: creates the initial configuration with permissions 600', async () => {
  const dir = await tempDir()
  const configPath = path.join(dir, 'nested', 'config.json')
  const service = new ConfigService({ configPath, legacyPath: path.join(dir, 'none.json') })
  await service.loadConfig()
  assert.equal(service.getConfig().plex.token, '')
  assert.equal(await mode(configPath), 0o600)
  assert.equal(await mode(path.dirname(configPath)), 0o700)
})

test('moves the configuration from the old location in the repository', async () => {
  const dir = await tempDir()
  const legacyPath = path.join(dir, 'app.json')
  const configPath = path.join(dir, 'new', 'config.json')
  await fs.writeFile(legacyPath, JSON.stringify({ plex: { token: 'abc', preferredUser: 'x' } }), {
    mode: 0o644
  })

  const service = new ConfigService({ configPath, legacyPath })
  await service.loadConfig()

  assert.equal(service.getConfig().plex.token, 'abc')
  assert.equal('preferredUser' in service.getConfig().plex, false)
  await assert.rejects(fs.access(legacyPath)) // the old file is gone
  assert.equal(await mode(configPath), 0o600)
})

test('does not overwrite a configuration already in the new location', async () => {
  const dir = await tempDir()
  const legacyPath = path.join(dir, 'app.json')
  const configPath = path.join(dir, 'config.json')
  await fs.writeFile(legacyPath, JSON.stringify({ plex: { token: 'vecchio' } }))
  await fs.writeFile(configPath, JSON.stringify({ plex: { token: 'nuovo' } }))

  const service = new ConfigService({ configPath, legacyPath })
  await service.loadConfig()
  assert.equal(service.getConfig().plex.token, 'nuovo')
})

test('unreadable file: set aside, not overwritten', async () => {
  const dir = await tempDir()
  const configPath = path.join(dir, 'config.json')
  await fs.writeFile(configPath, '{ not json')

  const service = new ConfigService({ configPath, legacyPath: null })
  await service.loadConfig()

  const files = await fs.readdir(dir)
  assert.ok(files.some(f => f.startsWith('config.json.broken-')))
  assert.equal(service.getConfig().plex.token, '')
})

test('saving: permissions 600 and no temporary file left', async () => {
  const dir = await tempDir()
  const configPath = path.join(dir, 'config.json')
  const service = new ConfigService({ configPath, legacyPath: null })
  await service.loadConfig()
  await fs.chmod(configPath, 0o644)
  await service.setPlexAuth({ url: '1.2.3.4', port: 32400, token: 't' })

  assert.equal(await mode(configPath), 0o600)
  assert.deepEqual(await fs.readdir(dir), ['config.json'])
  assert.equal(JSON.parse(await fs.readFile(configPath, 'utf8')).plex.token, 't')
})
