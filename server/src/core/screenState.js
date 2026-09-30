// 📋 SCREEN STATE MACHINE
// Replaces the old scattered flags (manualPauseState, pauseTimer,
// manualPlayerSelection, currentDisplayedTrack...). Everything is pure:
// reduce() takes the state and an event and returns the new state;
// toNowPlaying() builds the data sent to the kiosk. Timers and I/O live
// outside, in NowPlayingService.
//
// States:
//   setup    device not set up (no password)
//   login    password set but Plex not connected (or its token no longer valid)
//   idle     no music (Last.fm screen)
//   playing  a player is playing
//   paused   pause pressed on the kiosk: the artwork stays with a countdown,
//            then it moves to resume
//   resume   idle with the paused track ready to resume
import { choosePrimary, playersOfSameUser, countUsers } from './sessionAnalyzer.js'

export const PAUSE_TO_IDLE_MS = 30000

export const SCREENS = ['setup', 'login', 'idle', 'playing', 'paused', 'resume']

export function initialState() {
  return {
    screen: 'setup',
    players: [],
    primary: null,
    manualSelection: null,
    displayedRatingKey: null,
    pause: null, // { player, startedAt } when the pause was pressed on the kiosk
    resumeFrom: null // paused player that can be resumed (resume state)
  }
}

const withPlayer = (state, player, changes = {}) => ({
  ...state,
  primary: player,
  displayedRatingKey: player?.ratingKey ?? state.displayedRatingKey,
  ...changes
})

export function reduce(state, event) {
  switch (event.type) {
    case 'CONFIG': {
      if (!event.configured) return { ...initialState(), screen: 'setup' }
      if (!event.tokenValid) return { ...initialState(), screen: 'login' }
      if (state.screen === 'setup' || state.screen === 'login') return { ...state, screen: 'idle' }
      return state
    }

    case 'SESSIONS': {
      if (state.screen === 'setup' || state.screen === 'login') return state
      const players = event.players || []
      const manualSelection = players.some(p => p.machineIdentifier === state.manualSelection)
        ? state.manualSelection
        : null
      const primary = choosePrimary(players, {
        manualSelection,
        displayedRatingKey: state.displayedRatingKey,
        isControllable: event.isControllable
      })
      const base = { ...state, players, manualSelection }

      // Kiosk pause in progress: stays until it expires or something plays again
      if (state.screen === 'paused' && state.pause) {
        if (primary && primary.state === 'playing') {
          return withPlayer(base, primary, { screen: 'playing', pause: null, resumeFrom: null })
        }
        return base
      }

      if (primary && primary.state === 'playing') {
        return withPlayer(base, primary, { screen: 'playing', pause: null, resumeFrom: null })
      }
      if (primary && primary.state === 'paused') {
        return { ...base, primary, screen: 'resume', resumeFrom: primary, pause: null }
      }
      // No session (or only buffering/unknown state)
      if (primary) return { ...base, primary }
      return { ...base, primary: null, screen: 'idle', pause: null, resumeFrom: null }
    }

    case 'USER_PAUSED': {
      const player = state.players.find(p => p.machineIdentifier === event.machineIdentifier) || state.primary
      if (!player) return state
      return {
        ...state,
        screen: 'paused',
        primary: { ...player, state: 'paused' },
        pause: { player: { ...player, state: 'paused' }, startedAt: event.now },
        resumeFrom: null
      }
    }

    case 'PAUSE_EXPIRED': {
      if (state.screen !== 'paused' || !state.pause) return state
      return { ...state, screen: 'resume', resumeFrom: state.pause.player, pause: null }
    }

    case 'USER_RESUMED': {
      const player = state.pause?.player || state.resumeFrom
      if (!player) return state
      // Optimistic: the next SESSIONS event confirms (or corrects) it
      return withPlayer(
        state,
        { ...player, state: 'playing' },
        { screen: 'playing', pause: null, resumeFrom: null }
      )
    }

    case 'SELECT_PLAYER': {
      const player = state.players.find(p => p.machineIdentifier === event.machineIdentifier)
      if (!player) return state
      return withPlayer(state, player, {
        manualSelection: player.machineIdentifier,
        screen: player.state === 'playing' ? 'playing' : state.screen
      })
    }

    default:
      return state
  }
}

// Artwork paths go through the /api/art proxy: the Plex token must never
// reach the browser.
export function artUrl(path) {
  if (!path) return null
  if (path.startsWith('http://') || path.startsWith('https://')) return path
  if (path.startsWith('/')) return `/api/art?path=${encodeURIComponent(path)}`
  return path
}

const trackPayload = player => ({
  title: player.trackInfo.title,
  artist: player.trackInfo.artist,
  album: player.trackInfo.album,
  duration: player.trackInfo.duration,
  viewOffset: player.trackInfo.viewOffset,
  thumb: artUrl(player.trackInfo.thumb),
  art: artUrl(player.trackInfo.art),
  ratingKey: player.trackInfo.ratingKey,
  isLastFm: false
})

const playerEntry = player => ({
  id: player.machineIdentifier,
  name: player.name,
  title: player.name,
  state: player.state,
  sessionKey: player.sessionKey,
  userTitle: player.userTitle
})

// Data for the kiosk, in the usual format ("nowPlaying" event)
export function toNowPlaying(state, { lastfmTrack, isControllable = () => false, now = Date.now() } = {}) {
  const idle = {
    isPlaying: false,
    isPaused: false,
    track: lastfmTrack || { title: '', artist: '', album: '', isLastFm: true, isPlaying: false },
    activeUsers: [],
    selectedUser: null,
    hasControls: false,
    multiplePlayers: false,
    screen: state.screen
  }

  switch (state.screen) {
    case 'playing': {
      const primary = state.primary
      if (!primary) return idle
      const group = playersOfSameUser(state.players, primary)
      const list = group.length > 0 ? group : [primary]
      return {
        isPlaying: true,
        isPaused: false,
        track: trackPayload(primary),
        activeUsers: list.map(playerEntry),
        selectedUser: primary.machineIdentifier,
        hasControls: isControllable(primary.machineIdentifier),
        multipleUsers: countUsers(state.players) > 1,
        multiplePlayers: list.length > 1,
        screen: 'playing'
      }
    }

    case 'paused': {
      const player = state.pause?.player
      if (!player) return idle
      return {
        isPlaying: false,
        isPaused: true,
        track: trackPayload(player),
        activeUsers: [playerEntry(player)],
        selectedUser: player.machineIdentifier,
        pauseTimeRemaining: Math.max(0, PAUSE_TO_IDLE_MS - (now - state.pause.startedAt)),
        hasControls: isControllable(player.machineIdentifier),
        multiplePlayers: false,
        screen: 'paused'
      }
    }

    case 'resume': {
      const player = state.resumeFrom
      if (!player) return idle
      return {
        ...idle,
        hasResumeOption: true,
        hasControls: isControllable(player.machineIdentifier),
        resumeTrack: {
          title: player.trackInfo.title,
          artist: player.trackInfo.artist,
          album: player.trackInfo.album,
          thumb: artUrl(player.trackInfo.thumb),
          ratingKey: player.trackInfo.ratingKey,
          machineIdentifier: player.machineIdentifier,
          sessionKey: player.sessionKey,
          playerName: player.name
        },
        screen: 'resume'
      }
    }

    default:
      return idle
  }
}
