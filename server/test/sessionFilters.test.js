import { test } from 'node:test'
import assert from 'node:assert/strict'
import { filterSessions, SeenRegistry } from '../src/services/sessionFilters.js'
import { track, sessions } from './fixtures.js'

const all = sessions(
  track({ machine: 'a', user: 1, location: 'lan' }),
  track({ machine: 'b', user: 1, location: 'wan' }),
  track({ machine: 'c', user: 2, location: 'lan' })
)
const ids = result => result.MediaContainer.Metadata.map(m => m.Player.machineIdentifier)

test('filtri: nessuno, LAN, utente, player e combinazioni', () => {
  assert.deepEqual(ids(filterSessions(all, {})), ['a', 'b', 'c'])
  assert.deepEqual(ids(filterSessions(all, { lanOnly: true })), ['a', 'c'])
  assert.deepEqual(ids(filterSessions(all, { users: ['1'] })), ['a', 'b'])
  assert.deepEqual(ids(filterSessions(all, { users: [1], lanOnly: true })), ['a'])
  assert.deepEqual(ids(filterSessions(all, { players: ['c'] })), ['c'])
  assert.deepEqual(ids(filterSessions(all, { users: ['2'], players: ['a'] })), [])
})

test('filtri: la risposta originale non viene modificata', () => {
  filterSessions(all, { lanOnly: true })
  assert.equal(all.MediaContainer.Metadata.length, 3)
})

test('SeenRegistry registra utenti e player', () => {
  const registry = new SeenRegistry()
  registry.record(all)
  assert.equal(registry.recentUsers().length, 2)
  assert.equal(registry.recentPlayers().length, 3)
})
