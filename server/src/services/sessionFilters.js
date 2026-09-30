// 📋 LAN, USER AND PLAYER FILTERS
// Applied to the /status/sessions response before anything else: what is
// dropped here never appears in the app (not as the primary player, not in
// the touch overlay's player picker, not as "paused").

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

// A session is on the LAN when Plex says so: Session.location is the most
// reliable field, Player.local covers servers that don't report it.
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

// Pure function: returns a copy of the /status/sessions response with only
// the sessions allowed by the filters (the original is left untouched).
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

// Users and players seen in sessions (before filtering), offered in the
// settings with a readable name even when they are not active.
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
        this.users.set(id, { id, title: item.User.title || `User ${id}`, lastSeen: now })
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
