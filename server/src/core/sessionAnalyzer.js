// 📋 ANALISI DELLE SESSIONI - Funzioni pure: ricevono la risposta di
// /status/sessions (già filtrata) e restituiscono dati, senza stato globale.
import { isLanSession } from '../services/sessionFilters.js'

const toArray = value => (Array.isArray(value) ? value : value ? [value] : [])

const isTrack = item =>
  !!item && (item.type === 'track' || (!item.type && item.grandparentTitle && item.parentTitle))

const toInt = value => (value ? parseInt(value, 10) || 0 : 0)

// Solo musica, un elemento per player, nel formato usato dal resto dell'app
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
        title: item.title || 'Titolo sconosciuto',
        artist: item.grandparentTitle || item.originalTitle || 'Artista sconosciuto',
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

// Sceglie il player da mostrare, in ordine di priorità:
// 1. quello scelto a mano dall'utente (se sta suonando)
// 2. quello che suona la traccia già mostrata (continuità se passa a un altro player)
// 3. un player controllabile tra quelli che suonano, altrimenti il primo che suona
// 4. se nessuno suona, il primo (es. in pausa)
export function choosePrimary(players, { manualSelection = null, displayedRatingKey = null, isControllable = () => false } = {}) {
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

// I player dello stesso utente del player principale: il selettore del
// touch overlay permette di passare dall'uno all'altro.
export function playersOfSameUser(players, primary) {
  if (!primary) return []
  const key = p => p.userId ?? p.userTitle ?? 'unknown-user'
  return players.filter(p => key(p) === key(primary))
}

export function countUsers(players) {
  return new Set(players.map(p => p.userId ?? p.userTitle ?? 'unknown-user')).size
}
