import { test } from 'vitest'
import assert from 'node:assert/strict'
import { extractMusicPlayers, choosePrimary, countUsers } from '../src/core/sessionAnalyzer.js'
import { track, sessions } from './fixtures.js'

test('extractMusicPlayers: music only, one entry per player', () => {
  const players = extractMusicPlayers(
    sessions(
      track({ machine: 'a' }),
      track({ machine: 'b', type: 'episode' }),
      track({ machine: 'a', ratingKey: 'dup' })
    )
  )
  assert.equal(players.length, 1)
  assert.equal(players[0].machineIdentifier, 'a')
  assert.equal(players[0].trackInfo.duration, 200000)
  assert.equal(players[0].userId, '1')
  assert.equal(players[0].local, true)
})

test('extractMusicPlayers: empty response or a single object', () => {
  assert.deepEqual(extractMusicPlayers(null), [])
  assert.deepEqual(extractMusicPlayers({ MediaContainer: { size: 0 } }), [])
  assert.equal(extractMusicPlayers({ MediaContainer: { Metadata: track({ machine: 'x' }) } }).length, 1)
})

test('choosePrimary: manual selection first', () => {
  const players = extractMusicPlayers(
    sessions(track({ machine: 'a' }), track({ machine: 'b', ratingKey: 'r2' }))
  )
  assert.equal(choosePrimary(players, { manualSelection: 'b' }).machineIdentifier, 'b')
})

test('choosePrimary: continuity on the track shown', () => {
  const players = extractMusicPlayers(
    sessions(track({ machine: 'a', ratingKey: 'r1' }), track({ machine: 'b', ratingKey: 'r2' }))
  )
  assert.equal(choosePrimary(players, { displayedRatingKey: 'r2' }).machineIdentifier, 'b')
})

test('choosePrimary: prefers a controllable player among those playing', () => {
  const players = extractMusicPlayers(
    sessions(track({ machine: 'a', ratingKey: 'r1' }), track({ machine: 'b', ratingKey: 'r2' }))
  )
  assert.equal(choosePrimary(players, { isControllable: id => id === 'b' }).machineIdentifier, 'b')
})

test('choosePrimary: if none is playing, takes the first (paused)', () => {
  const players = extractMusicPlayers(sessions(track({ machine: 'a', state: 'paused' })))
  assert.equal(choosePrimary(players).machineIdentifier, 'a')
  assert.equal(choosePrimary([]), null)
})

test('countUsers', () => {
  const players = extractMusicPlayers(
    sessions(
      track({ machine: 'a', user: 1 }),
      track({ machine: 'b', user: 1, ratingKey: 'r2' }),
      track({ machine: 'c', user: 2, ratingKey: 'r3' })
    )
  )
  assert.equal(countUsers(players), 2)
})
