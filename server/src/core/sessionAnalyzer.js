// 📋 SESSION ANALYSIS - Pure functions: they take the (already filtered)
// /status/sessions response and return data, with no global state.
import { isLanSession } from '../services/sessionFilters.js'

const toArray = value => (Array.isArray(value) ? value : value ? [value] : [])

const isTrack = item =>
  !!item && (item.type === 'track' || (!item.type && item.grandparentTitle && item.parentTitle))

const toInt = value => (value ? parseInt(value, 10) || 0 : 0)

// Music only, one entry per player, in the format used by the rest of the app
export function extractMusicPlayers(sessions) {
  const players = []
  const seen = new Set()
  for (const item of toArray(sessions?.MediaContainer?.Metadata)) {
    if (!isTrack(item)) continue
    const machineIdentifier = item.Player?.machineIdentifier
    if (!machineIdentifier || seen.has(machineIdentifier)) continue
    seen.add(machineIdentifier)

    players.push({
      machineIdentifier,
      name: item.Player.title || item.Player.product || 'Player',
      product: item.Player.product || '',
      address: item.Player.address || null,
      local: isLanSession(item),
      state: item.Player.state || 'unknown',
      sessionKey: item.sessionKey || null,
      ratingKey: item.ratingKey || null,
      userId: item.User?.id !== undefined ? String(item.User.id) : null,
      userTitle: item.User?.title || null,
      trackInfo: {
        title: item.title || 'Unknown title',
        artist: item.grandparentTitle || item.originalTitle || 'Unknown artist',
        album: item.parentTitle || '',
        duration: toInt(item.duration),
        viewOffset: toInt(item.viewOffset),
        thumb: item.thumb || item.parentThumb || null,
        art: item.art || item.grandparentArt || null,
        ratingKey: item.ratingKey || null
      }
    })
  }
  return players
}

// Chooses the player to show, in order of priority:
// 1. the one picked by the user (if it is playing)
// 2. the one playing the track already shown (continuity when it moves to another player)
// 3. a controllable player among those playing, otherwise the first one playing
// 4. if none is playing, the first one (e.g. paused)
export function choosePrimary(
  players,
  { manualSelection = null, displayedRatingKey = null, isControllable = () => false } = {}
) {
  if (players.length === 0) return null
  const playing = players.filter(p => p.state === 'playing')

  const manual = manualSelection && playing.find(p => p.machineIdentifier === manualSelection)
  if (manual) return manual

  const sameTrack = displayedRatingKey && playing.find(p => p.ratingKey === displayedRatingKey)
  if (sameTrack) return sameTrack

  if (playing.length > 0) {
    return playing.find(p => isControllable(p.machineIdentifier)) || playing[0]
  }
  return players[0]
}

// The players of the same user as the primary player: the touch overlay's
// picker lets you switch between them.
export function playersOfSameUser(players, primary) {
  if (!primary) return []
  const key = p => p.userId ?? p.userTitle ?? 'unknown-user'
  return players.filter(p => key(p) === key(primary))
}

export function countUsers(players) {
  return new Set(players.map(p => p.userId ?? p.userTitle ?? 'unknown-user')).size
}
