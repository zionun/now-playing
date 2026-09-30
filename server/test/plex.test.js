import { test } from 'vitest'
import assert from 'node:assert/strict'
import { EventEmitter } from 'events'
import { backoffDelay } from '../src/lib/backoff.js'
import { parseGdmResponse } from '../src/plex/gdm.js'
import { PlexEventStream } from '../src/plex/PlexEventStream.js'
import { PlayerDirectory } from '../src/plex/PlayerDirectory.js'
import { PlaybackController } from '../src/plex/PlaybackController.js'

test('exponential backoff with a cap', () => {
  const noJitter = { jitter: 0, baseMs: 1000, maxMs: 60000 }
  assert.deepEqual(
    [0, 1, 2, 3].map(a => backoffDelay(a, noJitter)),
    [1000, 2000, 4000, 8000]
  )
  assert.equal(backoffDelay(20, noJitter), 60000)
  const d = backoffDelay(2, { baseMs: 1000, jitter: 0.2, random: () => 1 })
  assert.ok(d <= 4800 && d >= 3200)
})

test('GDM: a player response', () => {
  const player = parseGdmResponse(
    [
      'HTTP/1.0 200 OK',
      'Content-Type: plex/media-player',
      'Resource-Identifier: abc-123',
      'Name: Plexamp Salotto',
      'Port: 32500',
      'Product: Plexamp',
      'Protocol-Capabilities: timeline,playback,playqueues',
      ''
    ].join('\r\n')
  )
  assert.equal(player.machineIdentifier, 'abc-123')
  assert.equal(player.port, 32500)
  assert.ok(player.capabilities.includes('playback'))
  assert.equal(parseGdmResponse('HTTP/1.0 404 Not Found\r\n'), null)
})

class FakeSocket extends EventEmitter {
  terminate() {
    this.emit('close')
  }
}

test('WebSocket: a single reconnection timer, with a growing delay', async () => {
  const sockets = []
  const stream = new PlexEventStream(() => 'ws://plex', {
    createSocket: () => {
      const s = new FakeSocket()
      sockets.push(s)
      return s
    },
    backoff: { baseMs: 5, maxMs: 50, jitter: 0 }
  })
  const events = []
  stream.on('open', () => events.push('open'))
  stream.on('close', () => events.push('close'))
  stream.on('playing', list => events.push(`playing:${list.length}`))

  stream.start()
  sockets[0].emit('open')
  sockets[0].emit(
    'message',
    JSON.stringify({
      NotificationContainer: { PlaySessionStateNotification: [{ clientIdentifier: 'a', state: 'playing' }] }
    })
  )
  sockets[0].emit('close')
  // error + close arriving together must not create two timers
  assert.ok(stream.reconnectTimer)
  const timer = stream.reconnectTimer
  stream.scheduleReconnect()
  assert.equal(stream.reconnectTimer, timer)

  await new Promise(r => setTimeout(r, 20))
  assert.equal(sockets.length, 2)
  sockets[1].emit('open')
  assert.equal(stream.attempt, 0)
  assert.deepEqual(events, ['open', 'playing:1', 'close', 'open'])
  stream.stop()
  assert.equal(stream.connected, false)
})

const fakeDirectory = () =>
  new PlayerDirectory({
    plexClient: {
      isConfigured: () => true,
      getClients: async () => [{ machineIdentifier: 'srv', name: 'TV', product: 'Plex for LG' }]
    },
    getPlayerResources: async () => [
      {
        machineIdentifier: 'amp',
        title: 'iPhone',
        product: 'Plexamp',
        provides: ['player', 'pubsub-player']
      },
      { machineIdentifier: 'web', title: 'Browser', product: 'Plex Web', provides: ['player'] }
    ],
    discover: async () => [
      {
        machineIdentifier: 'gdm',
        name: 'Plexamp Pi',
        product: 'Plexamp',
        port: 32500,
        capabilities: ['playback'],
        address: '192.168.1.5'
      }
    ],
    probe: async () => false
  })

test('PlayerDirectory: controllability from the various sources', async () => {
  const dir = fakeDirectory()
  await dir.refresh({ force: true })
  assert.equal(dir.isControllable('srv'), true) // the server's /clients
  assert.equal(dir.isControllable('amp'), true) // plex.tv pubsub-player
  assert.equal(dir.isControllable('web'), false) // only "player", not remotely controllable
  assert.equal(dir.isControllable('gdm'), true) // GDM with playback
  assert.equal(dir.isControllable('ignoto'), false)
  dir.markFailed('gdm')
  assert.equal(dir.isControllable('gdm'), false)
  dir.markOk('gdm')
  assert.equal(dir.isControllable('gdm'), true)
})

test('PlaybackController: server, then direct; if all fail the controls are hidden', async () => {
  const dir = fakeDirectory()
  await dir.refresh({ force: true })
  dir.upsert('gdm', { viaServer: true })

  const calls = []
  const plexClient = {
    sendPlayerCommand: async (id, cmd) => {
      calls.push(`server:${id}:${cmd}`)
      throw new Error('404')
    }
  }
  const controller = new PlaybackController({
    plexClient,
    directory: dir,
    getConnection: () => ({ token: 't', clientIdentifier: 'me' }),
    httpGet: async url => {
      calls.push(`direct:${url}`)
      return {}
    }
  })

  const ok = await controller.send('gdm', 'next')
  assert.equal(ok.success, true)
  assert.equal(ok.route, 'direct')
  assert.deepEqual(calls, ['server:gdm:skipNext', 'direct:http://192.168.1.5:32500/player/playback/skipNext'])

  const failing = new PlaybackController({
    plexClient,
    directory: dir,
    getConnection: () => ({}),
    httpGet: async () => {
      throw new Error('down')
    }
  })
  const ko = await failing.send('amp', 'pause')
  assert.equal(ko.success, false)
  assert.equal(dir.isControllable('amp'), false)

  assert.equal((await controller.send('gdm', 'rewind')).success, false)
})
