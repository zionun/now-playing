import { test } from 'vitest'
import assert from 'node:assert/strict'
import {
  extractMusicPlayers,
  choosePrimary,
  playersOfSameUser,
  countUsers
} from '../src/core/sessionAnalyzer.js'
import { track, sessions } from './fixtures.js'

test('extractMusicPlayers: solo musica, un elemento per player', () => {
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

test('extractMusicPlayers: risposta vuota o singolo oggetto', () => {
  assert.deepEqual(extractMusicPlayers(null), [])
  assert.deepEqual(extractMusicPlayers({ MediaContainer: { size: 0 } }), [])
  assert.equal(extractMusicPlayers({ MediaContainer: { Metadata: track({ machine: 'x' }) } }).length, 1)
})

test('choosePrimary: selezione manuale prima di tutto', () => {
  const players = extractMusicPlayers(
    sessions(track({ machine: 'a' }), track({ machine: 'b', ratingKey: 'r2' }))
  )
  assert.equal(choosePrimary(players, { manualSelection: 'b' }).machineIdentifier, 'b')
})

test('choosePrimary: continuità sulla traccia mostrata', () => {
  const players = extractMusicPlayers(
    sessions(track({ machine: 'a', ratingKey: 'r1' }), track({ machine: 'b', ratingKey: 'r2' }))
  )
  assert.equal(choosePrimary(players, { displayedRatingKey: 'r2' }).machineIdentifier, 'b')
})

test('choosePrimary: preferisce un player controllabile tra quelli che suonano', () => {
  const players = extractMusicPlayers(
    sessions(track({ machine: 'a', ratingKey: 'r1' }), track({ machine: 'b', ratingKey: 'r2' }))
  )
  assert.equal(choosePrimary(players, { isControllable: id => id === 'b' }).machineIdentifier, 'b')
})

test('choosePrimary: se nessuno suona prende il primo (in pausa)', () => {
  const players = extractMusicPlayers(sessions(track({ machine: 'a', state: 'paused' })))
  assert.equal(choosePrimary(players).machineIdentifier, 'a')
  assert.equal(choosePrimary([]), null)
})

test('playersOfSameUser e countUsers', () => {
  const players = extractMusicPlayers(
    sessions(
      track({ machine: 'a', user: 1 }),
      track({ machine: 'b', user: 1, ratingKey: 'r2' }),
      track({ machine: 'c', user: 2, ratingKey: 'r3' })
    )
  )
  assert.deepEqual(
    playersOfSameUser(players, players[0]).map(p => p.machineIdentifier),
    ['a', 'b']
  )
  assert.equal(countUsers(players), 2)
})
