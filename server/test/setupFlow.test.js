// Full setup flow through the real REST routes, against a simulated plex.tv
// and Plex Media Server (axios is intercepted, no network access).
import { test, beforeAll, afterAll, vi } from 'vitest'
import assert from 'node:assert/strict'
import fs from 'fs/promises'
import os from 'os'
import path from 'path'
import express from 'express'
import axios from 'axios'
import { ConfigService } from '../src/services/ConfigService.js'
import { PlexAuthService } from '../src/services/PlexAuthService.js'
import { DeviceSetupService } from '../src/services/DeviceSetupService.js'
import authRouter, { setAuthServices } from '../src/routes/auth.js'
import configRouter, { setConfigService } from '../src/routes/config.js'

// 📋 Simulated Plex
const ACCOUNTS = { 'tok-owner': { id: 42, username: 'owner' }, 'tok-other': { id: 99, username: 'intruder' } }
const pins = new Map() // pinId -> { token, polls }
let nextPinId = 100
const authorizePinWith = new Map() // pinId -> token that will authorize it

const plexResources = [
  {
    name: 'Home',
    provides: 'server',
    clientIdentifier: 'srv-1',
    owned: true,
    accessToken: 'srv-token',
    connections: [
      { address: '172.17.0.2', port: 32400, local: true, relay: false }, // Docker-internal: unreachable
      { address: '81.1.1.1', port: 3400, local: false, relay: false }
    ]
  }
]

function fakeResponse(data) {
  return Promise.resolve({ data, status: 200, headers: {} })
}
function fakeError(status) {
  const error = new Error(`HTTP ${status || 'network error'}`)
  if (status) error.response = { status, data: {} }
  return Promise.reject(error)
}

function fakePlex(method, url, config = {}) {
  const token = config.headers?.['X-Plex-Token']
  if (method === 'post' && url === 'https://plex.tv/api/v2/pins') {
    const id = nextPinId++
    pins.set(String(id), { polls: 0 })
    return fakeResponse({ id, code: `CODE${id}` })
  }
  const pinMatch = url.match(/^https:\/\/plex\.tv\/api\/v2\/pins\/(\d+)$/)
  if (pinMatch) {
    const pin = pins.get(pinMatch[1])
    pin.polls += 1
    // Authorized from the second poll on, like a user tapping "Allow"
    return fakeResponse({ authToken: pin.polls > 1 ? authorizePinWith.get(pinMatch[1]) : null })
  }
  if (url === 'https://plex.tv/api/v2/user') {
    return ACCOUNTS[token] ? fakeResponse(ACCOUNTS[token]) : fakeError(401)
  }
  if (url === 'https://plex.tv/api/v2/resources') return fakeResponse(plexResources)
  if (url === 'http://81.1.1.1:3400/identity')
    return fakeResponse({ MediaContainer: { machineIdentifier: 'srv-1' } })
  if (url === 'http://172.17.0.2:32400/identity') return fakeError()
  return fakeError(404)
}

// 📋 App under test
let baseUrl
let server
let dir
let configService
let reloads = 0

beforeAll(async () => {
  vi.spyOn(axios, 'get').mockImplementation((url, config) => fakePlex('get', url, config))
  vi.spyOn(axios, 'post').mockImplementation((url, data, config) => fakePlex('post', url, config))

  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'now-playing-flow-'))
  configService = new ConfigService({ configPath: path.join(dir, 'config.json'), legacyPath: null })
  await configService.loadConfig()
  const plexAuthService = new PlexAuthService(configService)
  const setupService = new DeviceSetupService(configService)
  const reload = async () => {
    reloads += 1
  }

  setAuthServices(configService, plexAuthService, reload, setupService)
  setConfigService(configService, reload, setupService, async () => ({ users: [], players: [] }))

  const app = express()
  app.use(express.json())
  app.use('/api/auth', authRouter)
  app.use('/api/config', configRouter)
  await new Promise(resolve => {
    server = app.listen(0, '127.0.0.1', resolve)
  })
  baseUrl = `http://127.0.0.1:${server.address().port}`
})

afterAll(async () => {
  vi.restoreAllMocks()
  await new Promise(resolve => server.close(resolve))
  await fs.rm(dir, { recursive: true, force: true })
})

async function call(method, route, { body, session } = {}) {
  const response = await fetch(`${baseUrl}${route}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(session && { 'X-Config-Session': session }) },
    body: body === undefined ? undefined : JSON.stringify(body)
  })
  const text = await response.text()
  return { status: response.status, body: text ? JSON.parse(text) : {}, raw: text }
}

let session
let setupPinId

test('first run: the device is not set up', async () => {
  const { body } = await call('GET', '/api/auth/state')
  assert.equal(body.hasPassword, false)
  assert.equal(body.setupComplete, false)
})

test('step 1: password (too short is refused, then created once)', async () => {
  assert.equal((await call('POST', '/api/auth/password', { body: { password: 'ab' } })).status, 400)

  const created = await call('POST', '/api/auth/password', { body: { password: 'secret1' } })
  assert.equal(created.status, 200)
  session = created.body.session
  assert.ok(session)

  assert.equal((await call('POST', '/api/auth/password', { body: { password: 'another' } })).status, 409)
  assert.equal((await call('POST', '/api/auth/login', { body: { password: 'wrong' } })).status, 401)
  assert.equal((await call('POST', '/api/auth/login', { body: { password: 'secret1' } })).status, 200)
})

test('step 2: Plex PIN requires the session and returns to the phone page', async () => {
  assert.equal((await call('POST', '/api/auth/plex/pin', { body: {} })).status, 401)

  const pin = await call('POST', '/api/auth/plex/pin', {
    session,
    body: { forwardUrl: 'http://192.168.1.10:3001/setup' }
  })
  assert.equal(pin.status, 200)
  setupPinId = pin.body.pinId
  authorizePinWith.set(String(setupPinId), 'tok-owner')
  assert.match(pin.body.authUrl, /^https:\/\/app\.plex\.tv\/auth#\?/)
  assert.match(pin.body.authUrl, /forwardUrl=http%3A%2F%2F192\.168\.1\.10%3A3001%2Fsetup/)
})

test('step 2: polling until authorized; tokens never reach the browser', async () => {
  const pending = await call('GET', `/api/auth/plex/pin/${setupPinId}`, { session })
  assert.equal(pending.body.authenticated, false)

  const done = await call('GET', `/api/auth/plex/pin/${setupPinId}`, { session })
  assert.equal(done.body.authenticated, true)
  assert.deepEqual(
    done.body.servers.map(s => s.machineIdentifier),
    ['srv-1']
  )
  assert.ok(!done.raw.includes('tok-owner'))
  assert.ok(!done.raw.includes('srv-token'))
})

test('step 2: choosing the server saves a reachable connection and the account', async () => {
  const before = reloads
  const selected = await call('POST', '/api/auth/plex/select', {
    session,
    body: { pinId: setupPinId, machineIdentifier: 'srv-1' }
  })
  assert.equal(selected.status, 200)
  assert.equal(reloads, before + 1) // applied without a restart

  const plex = configService.getConfig().plex
  assert.equal(plex.url, '81.1.1.1') // not the unreachable Docker address
  assert.equal(plex.port, 3400)
  assert.equal(plex.token, 'srv-token')
  assert.equal(plex.accountId, '42')

  const state = (await call('GET', '/api/auth/state')).body
  assert.equal(state.setupComplete, true)
  assert.equal(state.canResetPassword, true)

  // A PIN can only be used once
  const again = await call('POST', '/api/auth/plex/select', {
    session,
    body: { pinId: setupPinId, machineIdentifier: 'srv-1' }
  })
  assert.equal(again.status, 400)
})

test('the device stays bound to the setup Plex account', async () => {
  const pin = await call('POST', '/api/auth/plex/pin', { session, body: {} })
  authorizePinWith.set(String(pin.body.pinId), 'tok-other')
  await call('GET', `/api/auth/plex/pin/${pin.body.pinId}`, { session })
  await call('GET', `/api/auth/plex/pin/${pin.body.pinId}`, { session })

  const selected = await call('POST', '/api/auth/plex/select', {
    session,
    body: { pinId: pin.body.pinId, machineIdentifier: 'srv-1' }
  })
  assert.equal(selected.status, 403)
  assert.equal(configService.getConfig().plex.accountId, '42')
})

test('forgot password: only the setup account can reset it', async () => {
  const other = await call('POST', '/api/auth/reset/pin', { body: {} })
  authorizePinWith.set(String(other.body.pinId), 'tok-other')
  await call('GET', `/api/auth/reset/pin/${other.body.pinId}`)
  assert.equal((await call('GET', `/api/auth/reset/pin/${other.body.pinId}`)).status, 403)

  const owner = await call('POST', '/api/auth/reset/pin', { body: {} })
  authorizePinWith.set(String(owner.body.pinId), 'tok-owner')
  await call('GET', `/api/auth/reset/pin/${owner.body.pinId}`)
  const reset = await call('GET', `/api/auth/reset/pin/${owner.body.pinId}`)
  assert.equal(reset.body.authenticated, true)

  const changed = await call('POST', '/api/auth/password/change', {
    session: reset.body.session,
    body: { password: 'newsecret' }
  })
  assert.equal(changed.status, 200)
  // Sessions opened with the old password are no longer valid
  assert.equal((await call('GET', '/api/config', { session })).status, 401)
  assert.equal((await call('POST', '/api/auth/login', { body: { password: 'newsecret' } })).status, 200)
})

test('reset device: wipes everything, including the bound account', async () => {
  const { body } = await call('POST', '/api/auth/login', { body: { password: 'newsecret' } })
  assert.equal(
    (await call('POST', '/api/auth/reset-device', { session: body.session, body: { password: 'nope' } }))
      .status,
    401
  )
  assert.equal(
    (await call('POST', '/api/auth/reset-device', { session: body.session, body: { password: 'newsecret' } }))
      .status,
    200
  )

  const state = (await call('GET', '/api/auth/state')).body
  assert.equal(state.hasPassword, false)
  assert.equal(state.plexConnected, false)
  assert.equal(state.canResetPassword, false)
})
