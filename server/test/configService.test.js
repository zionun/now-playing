import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'fs/promises'
import os from 'os'
import path from 'path'
import { ConfigService, resolveConfigPath } from '../src/services/ConfigService.js'

const tempDir = () => fs.mkdtemp(path.join(os.tmpdir(), 'now-playing-test-'))
const mode = async file => (await fs.stat(file)).mode & 0o777

test('resolveConfigPath: variabile d\'ambiente, poi cartella utente', () => {
  assert.equal(resolveConfigPath({ NOW_PLAYING_CONFIG: '/tmp/x/config.json' }), '/tmp/x/config.json')
  if (process.getuid?.() !== 0) {
    assert.equal(resolveConfigPath({ XDG_CONFIG_HOME: '/home/u/.config' }), '/home/u/.config/now-playing/config.json')
  }
})

test('prima esecuzione: crea la configurazione iniziale con permessi 600', async () => {
  const dir = await tempDir()
  const configPath = path.join(dir, 'nested', 'config.json')
  const service = new ConfigService({ configPath, legacyPath: path.join(dir, 'none.json') })
  await service.loadConfig()
  assert.equal(service.getConfig().plex.token, '')
  assert.equal(await mode(configPath), 0o600)
  assert.equal(await mode(path.dirname(configPath)), 0o700)
})

test('sposta la configurazione dalla vecchia posizione nel repository', async () => {
  const dir = await tempDir()
  const legacyPath = path.join(dir, 'app.json')
  const configPath = path.join(dir, 'new', 'config.json')
  await fs.writeFile(legacyPath, JSON.stringify({ plex: { token: 'abc', preferredUser: 'x' } }), { mode: 0o644 })

  const service = new ConfigService({ configPath, legacyPath })
  await service.loadConfig()

  assert.equal(service.getConfig().plex.token, 'abc')
  assert.equal('preferredUser' in service.getConfig().plex, false)
  await assert.rejects(fs.access(legacyPath)) // il vecchio file non c'è più
  assert.equal(await mode(configPath), 0o600)
})

test('non sovrascrive una configurazione già presente nella nuova posizione', async () => {
  const dir = await tempDir()
  const legacyPath = path.join(dir, 'app.json')
  const configPath = path.join(dir, 'config.json')
  await fs.writeFile(legacyPath, JSON.stringify({ plex: { token: 'vecchio' } }))
  await fs.writeFile(configPath, JSON.stringify({ plex: { token: 'nuovo' } }))

  const service = new ConfigService({ configPath, legacyPath })
  await service.loadConfig()
  assert.equal(service.getConfig().plex.token, 'nuovo')
})

test('file illeggibile: messo da parte, non sovrascritto', async () => {
  const dir = await tempDir()
  const configPath = path.join(dir, 'config.json')
  await fs.writeFile(configPath, '{ non è json')

  const service = new ConfigService({ configPath, legacyPath: null })
  await service.loadConfig()

  const files = await fs.readdir(dir)
  assert.ok(files.some(f => f.startsWith('config.json.broken-')))
  assert.equal(service.getConfig().plex.token, '')
})

test('salvataggio: permessi 600 e nessun file temporaneo rimasto', async () => {
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
