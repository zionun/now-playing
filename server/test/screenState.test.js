import { test } from 'node:test'
import assert from 'node:assert/strict'
import { initialState, reduce, toNowPlaying, PAUSE_TO_IDLE_MS } from '../src/core/screenState.js'
import { extractMusicPlayers } from '../src/core/sessionAnalyzer.js'
import { track, sessions } from './fixtures.js'

const configured = () => reduce(initialState(), { type: 'CONFIG', configured: true, tokenValid: true })
const withSessions = (state, ...items) => reduce(state, { type: 'SESSIONS', players: extractMusicPlayers(sessions(...items)) })

test('CONFIG: setup senza password, login senza Plex, altrimenti idle', () => {
  assert.equal(reduce(initialState(), { type: 'CONFIG', configured: false, tokenValid: false }).screen, 'setup')
  assert.equal(reduce(initialState(), { type: 'CONFIG', configured: true, tokenValid: false }).screen, 'login')
  assert.equal(configured().screen, 'idle')
})

test('SESSIONS ignorate in setup/login', () => {
  const state = reduce(initialState(), { type: 'CONFIG', configured: true, tokenValid: false })
  assert.equal(withSessions(state, track({ machine: 'a' })).screen, 'login')
})

test('idle → playing → resume (pausa da altro dispositivo) → idle', () => {
  let state = withSessions(configured(), track({ machine: 'a' }))
  assert.equal(state.screen, 'playing')
  assert.equal(state.primary.machineIdentifier, 'a')

  state = withSessions(state, track({ machine: 'a', state: 'paused' }))
  assert.equal(state.screen, 'resume')
  assert.equal(state.resumeFrom.machineIdentifier, 'a')

  state = withSessions(state)
  assert.equal(state.screen, 'idle')
  assert.equal(state.resumeFrom, null)
})

test('pausa dal kiosk: paused con conto alla rovescia, poi resume', () => {
  let state = withSessions(configured(), track({ machine: 'a' }))
  state = reduce(state, { type: 'USER_PAUSED', machineIdentifier: 'a', now: 1000 })
  assert.equal(state.screen, 'paused')

  // Le sessioni (Plex dice "paused") non cambiano la schermata durante il conto alla rovescia
  state = withSessions(state, track({ machine: 'a', state: 'paused' }))
  assert.equal(state.screen, 'paused')

  const payload = toNowPlaying(state, { now: 1000 + 10000 })
  assert.equal(payload.isPaused, true)
  assert.equal(payload.pauseTimeRemaining, PAUSE_TO_IDLE_MS - 10000)

  state = reduce(state, { type: 'PAUSE_EXPIRED' })
  assert.equal(state.screen, 'resume')
  assert.equal(toNowPlaying(state).hasResumeOption, true)
})

test('pausa dal kiosk: se torna a suonare (anche da un altro dispositivo) → playing', () => {
  let state = withSessions(configured(), track({ machine: 'a' }))
  state = reduce(state, { type: 'USER_PAUSED', machineIdentifier: 'a', now: 0 })
  state = withSessions(state, track({ machine: 'a' }))
  assert.equal(state.screen, 'playing')
  assert.equal(state.pause, null)
})

test('USER_RESUMED dalla schermata resume → playing (ottimistico)', () => {
  let state = withSessions(configured(), track({ machine: 'a', state: 'paused' }))
  state = reduce(state, { type: 'USER_RESUMED' })
  assert.equal(state.screen, 'playing')
  assert.equal(toNowPlaying(state).isPlaying, true)
})

test('SELECT_PLAYER mantiene la scelta finché il player esiste', () => {
  let state = withSessions(configured(), track({ machine: 'a' }), track({ machine: 'b', ratingKey: 'r2' }))
  assert.equal(state.primary.machineIdentifier, 'a')
  state = reduce(state, { type: 'SELECT_PLAYER', machineIdentifier: 'b' })
  state = withSessions(state, track({ machine: 'a' }), track({ machine: 'b', ratingKey: 'r2' }))
  assert.equal(state.primary.machineIdentifier, 'b')

  // Il player scelto sparisce: la scelta manuale si azzera
  state = withSessions(state, track({ machine: 'a' }))
  assert.equal(state.manualSelection, null)
  assert.equal(state.primary.machineIdentifier, 'a')
})

test('toNowPlaying: playing con selettore dei player dello stesso utente', () => {
  const state = withSessions(configured(), track({ machine: 'a' }), track({ machine: 'b', ratingKey: 'r2' }), track({ machine: 'c', user: 2, ratingKey: 'r3' }))
  const payload = toNowPlaying(state, { isControllable: id => id === 'a' })
  assert.equal(payload.isPlaying, true)
  assert.equal(payload.hasControls, true)
  assert.equal(payload.multiplePlayers, true)
  assert.equal(payload.multipleUsers, true)
  assert.deepEqual(payload.activeUsers.map(p => p.id), ['a', 'b'])
  assert.match(payload.track.thumb, /^\/api\/art\?path=/)
})

test('toNowPlaying: idle usa la traccia Last.fm e non ha controlli', () => {
  const payload = toNowPlaying(configured(), { lastfmTrack: { title: 'LF', isLastFm: true } })
  assert.equal(payload.isPlaying, false)
  assert.equal(payload.hasControls, false)
  assert.equal(payload.track.title, 'LF')
})
