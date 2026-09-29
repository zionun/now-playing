// 📋 FILTRI SU LAN, UTENTE E PLAYER
// Applicati alle sessioni di /status/sessions prima di qualsiasi altra
// elaborazione: ciò che viene scartato qui non compare mai nell'app (né come
// player primario, né nel selettore del touch overlay, né come "in pausa").

export const DEFAULT_FILTERS = { lanOnly: false, users: [], players: [] }

export function normalizeFilters(filters = {}) {
  const toIds = list => (Array.isArray(list) ? list.map(String).filter(Boolean) : [])
  return {
    lanOnly: !!filters.lanOnly,
    users: toIds(filters.users),
    players: toIds(filters.players)
  }
}

export function hasActiveFilters(filters) {
  const f = normalizeFilters(filters)
  return f.lanOnly || f.users.length > 0 || f.players.length > 0
}

const toArray = value => (Array.isArray(value) ? value : value ? [value] : [])

// Una sessione è in LAN se Plex la marca così: Session.location è il dato più
// affidabile, Player.local serve per i server che non lo riportano.
export function isLanSession(item) {
  const location = item?.Session?.location
  if (location) return location === 'lan'
  return item?.Player?.local === true || item?.Player?.local === '1' || item?.Player?.local === 1
}

export function sessionPasses(item, filters) {
  const f = normalizeFilters(filters)
  if (f.lanOnly && !isLanSession(item)) return false
  if (f.users.length > 0 && !f.users.includes(String(item?.User?.id ?? ''))) return false
  if (f.players.length > 0 && !f.players.includes(String(item?.Player?.machineIdentifier ?? ''))) return false
  return true
}

// Funzione pura: restituisce una copia della risposta di /status/sessions con
// solo le sessioni ammesse dai filtri (la risposta originale non viene toccata).
export function filterSessions(sessions, filters) {
  if (!sessions?.MediaContainer || !hasActiveFilters(filters)) return sessions

  const kept = toArray(sessions.MediaContainer.Metadata).filter(item => sessionPasses(item, filters))
  return {
    ...sessions,
    MediaContainer: {
      ...sessions.MediaContainer,
      size: kept.length,
      Metadata: kept
    }
  }
}

// Utenti e player visti nelle sessioni (prima dei filtri), per proporli
// nella configurazione con un nome leggibile anche quando non sono attivi.
export class SeenRegistry {
  constructor(maxAgeMs = 30 * 24 * 60 * 60 * 1000) {
    this.maxAgeMs = maxAgeMs
    this.users = new Map() // id -> { id, title, lastSeen }
    this.players = new Map() // machineIdentifier -> { machineIdentifier, title, product, local, lastSeen }
  }

  record(sessions) {
    const now = Date.now()
    for (const item of toArray(sessions?.MediaContainer?.Metadata)) {
      if (item?.User?.id !== undefined) {
        const id = String(item.User.id)
        this.users.set(id, { id, title: item.User.title || `Utente ${id}`, lastSeen: now })
      }
      if (item?.Player?.machineIdentifier) {
        const machineIdentifier = String(item.Player.machineIdentifier)
        this.players.set(machineIdentifier, {
          machineIdentifier,
          title: item.Player.title || item.Player.product || 'Player',
          product: item.Player.product || '',
          local: isLanSession(item),
          lastSeen: now
        })
      }
    }
  }

  recent(map) {
    const cutoff = Date.now() - this.maxAgeMs
    return [...map.values()].filter(entry => entry.lastSeen >= cutoff)
  }

  recentUsers() {
    return this.recent(this.users)
  }

  recentPlayers() {
    return this.recent(this.players)
  }
}
