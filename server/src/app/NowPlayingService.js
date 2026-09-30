import { EventEmitter } from 'events'
import {
  filterSessions,
  hasActiveFilters,
  normalizeFilters,
  SeenRegistry
} from '../services/sessionFilters.js'
import { extractMusicPlayers } from '../core/sessionAnalyzer.js'
import { initialState, reduce, toNowPlaying, PAUSE_TO_IDLE_MS } from '../core/screenState.js'
import { PlexUnauthorizedError } from '../plex/PlexClient.js'
import { createLogger } from '../lib/logger.js'

const log = createLogger('now-playing')

const FALLBACK_POLL_MS = 10000 // polling only while the Plex WebSocket is down
const EVENT_REFRESH_DELAY_MS = 400 // Plex updates the sessions shortly after the event
const COMMAND_REFRESH_DELAY_MS = 1000
const HEALTH_CACHE_MS = 30000

// 📋 MAIN SERVICE
// Coordinates Plex (HTTP + events), filters, the state machine and Last.fm,
// and is the only place with timers and mutable state. Emits:
//   'nowPlaying' (data for the kiosk), 'authRequired', 'configUpdated', 'health'
export class NowPlayingService extends EventEmitter {
  constructor({
    configService,
    plexClient,
    eventStream,
    directory,
    playback,
    lastfm,
    plexAuthService,
    displayPower
  }) {
    super()
    this.configService = configService
    this.plexClient = plexClient
    this.eventStream = eventStream
    this.directory = directory
    this.playback = playback
    this.lastfm = lastfm
    this.plexAuthService = plexAuthService
    this.displayPower = displayPower

    this.state = initialState()
    this.seen = new SeenRegistry()
    this.filters = normalizeFilters()
    this.allowedMachineIds = new Set()
    this.lastPayload = null

    this.refreshInFlight = null
    this.refreshQueued = false
    this.eventRefreshTimer = null
    this.pollTimer = null
    this.pauseTimer = null
    this.countdownTimer = null

    this.plexStatus = { reachable: null, lastOkAt: null, lastError: null }
    this.healthCache = null
    this.lastHealthKey = null

    this.eventStream.on('open', () => {
      this.stopPolling()
      this.refresh()
      this.publishHealth()
    })
    this.eventStream.on('close', () => {
      if (this.isConfigured()) this.startPolling()
      this.publishHealth()
    })
    this.eventStream.on('playing', notifications => this.onPlexNotifications(notifications))
  }

  // 📋 CONFIGURATION

  isConfigured() {
    return this.configService.hasConfigPassword() && this.plexClient.isConfigured()
  }

  start() {
    this.applyConfig()
  }

  stop() {
    this.eventStream.stop()
    this.directory.stop()
    this.stopPolling()
    this.clearPauseTimers()
    clearTimeout(this.eventRefreshTimer)
  }

  // Called after every configuration save
  async reloadConfig() {
    await this.configService.loadConfig()
    this.lastfm.clearCache()
    this.directory.clear()
    this.healthCache = null
    this.applyConfig()
    this.displayPower?.settingsChanged()
    this.emit('configUpdated')
  }

  applyConfig() {
    const config = this.configService.getConfig()
    this.filters = normalizeFilters(config.filters)
    const hasPassword = this.configService.hasConfigPassword()
    const plexConnected = this.plexClient.isConfigured()

    // setup: no password; login: no (or no longer valid) Plex connection
    this.dispatch({ type: 'CONFIG', configured: hasPassword, tokenValid: plexConnected })

    if (hasPassword && plexConnected) {
      this.eventStream.restart()
      this.directory.start()
      // Poll until the WebSocket is connected
      if (!this.eventStream.connected) this.startPolling()
      this.refresh()
    } else {
      this.eventStream.stop()
      this.directory.stop()
      this.stopPolling()
      this.emit('authRequired', { reason: hasPassword ? 'plex_not_connected' : 'not_configured' })
      this.broadcast()
    }
  }

  // 📋 SESSION UPDATES

  // Close requests are queued: at most one read in progress and one waiting,
  // never overlapping reads.
  refresh() {
    if (this.refreshInFlight) {
      this.refreshQueued = true
      return this.refreshInFlight
    }
    this.refreshInFlight = this.runRefresh().finally(() => {
      this.refreshInFlight = null
      if (this.refreshQueued) {
        this.refreshQueued = false
        this.refresh()
      }
    })
    return this.refreshInFlight
  }

  async runRefresh() {
    if (!this.isConfigured()) return
    let sessions
    try {
      sessions = await this.plexClient.getSessions()
      this.plexStatus = { reachable: true, lastOkAt: Date.now(), lastError: null }
    } catch (error) {
      if (error instanceof PlexUnauthorizedError) {
        await this.handleUnauthorized()
        return
      }
      this.plexStatus = { ...this.plexStatus, reachable: false, lastError: error.message }
      log.warn('Plex sessions not available:', error.message)
      this.publishHealth()
      return
    }

    // Filters are applied here, before anything else
    this.seen.record(sessions)
    const players = extractMusicPlayers(filterSessions(sessions, this.filters))
    this.allowedMachineIds = new Set(players.map(p => p.machineIdentifier))
    this.directory.noteSessionPlayers(players)

    this.dispatch({ type: 'SESSIONS', players, isControllable: id => this.directory.isControllable(id) })
    await this.broadcast()
    this.publishHealth()
  }

  scheduleRefresh(delayMs) {
    clearTimeout(this.eventRefreshTimer)
    this.eventRefreshTimer = setTimeout(() => this.refresh(), delayMs)
  }

  onPlexNotifications(notifications) {
    // Notifications only from filtered-out players: nothing to update
    if (hasActiveFilters(this.filters)) {
      const relevant = notifications.some(n => this.allowedMachineIds.has(n.clientIdentifier))
      // An allowed player that just started is not known yet: read again anyway
      // when the notification is a new "playing"
      if (!relevant && !notifications.some(n => n.state === 'playing')) return
    }
    this.scheduleRefresh(EVENT_REFRESH_DELAY_MS)
  }

  startPolling() {
    if (this.pollTimer) return
    log.info(`Polling every ${FALLBACK_POLL_MS / 1000}s until the Plex WebSocket is back`)
    this.pollTimer = setInterval(() => this.refresh(), FALLBACK_POLL_MS)
  }

  stopPolling() {
    if (!this.pollTimer) return
    clearInterval(this.pollTimer)
    this.pollTimer = null
    log.info('Plex WebSocket active: polling stopped')
  }

  async handleUnauthorized() {
    log.warn('Plex token no longer valid (401): a new login is needed')
    await this.configService.clearPlexToken()
    this.eventStream.stop()
    this.stopPolling()
    this.dispatch({ type: 'CONFIG', configured: this.configService.hasConfigPassword(), tokenValid: false })
    this.emit('authRequired', { reason: 'token_invalid' })
    this.publishHealth()
  }

  // 📋 STATE MACHINE AND TIMERS

  dispatch(event) {
    const previous = this.state.screen
    this.state = reduce(this.state, { now: Date.now(), ...event })
    if (previous !== this.state.screen) {
      log.info(`Screen: ${previous} → ${this.state.screen}`)
      this.onScreenChange(previous, this.state.screen)
    }
  }

  onScreenChange(previous, screen) {
    this.displayPower?.update(screen)
    if (screen === 'paused') {
      this.clearPauseTimers()
      this.pauseTimer = setTimeout(() => {
        this.pauseTimer = null
        this.dispatch({ type: 'PAUSE_EXPIRED', isControllable: id => this.directory.isControllable(id) })
        this.broadcast()
      }, PAUSE_TO_IDLE_MS)
      // The kiosk shows the countdown
      this.countdownTimer = setInterval(() => this.broadcast(), 1000)
    } else if (previous === 'paused') {
      this.clearPauseTimers()
    }
  }

  clearPauseTimers() {
    clearTimeout(this.pauseTimer)
    clearInterval(this.countdownTimer)
    this.pauseTimer = null
    this.countdownTimer = null
  }

  async broadcast() {
    const needsLastfm = !['playing', 'paused'].includes(this.state.screen)
    const lastfmTrack = needsLastfm ? await this.lastfm.getFallbackTrack() : null
    this.lastPayload = toNowPlaying(this.state, {
      lastfmTrack,
      isControllable: id => this.directory.isControllable(id)
    })
    this.emit('nowPlaying', this.lastPayload)
    return this.lastPayload
  }

  async currentPayload() {
    return this.lastPayload || this.broadcast()
  }

  // 📋 COMMANDS FROM THE KIOSK

  targetPlayer(machineIdentifier) {
    if (machineIdentifier) return machineIdentifier
    return (
      this.state.primary?.machineIdentifier ||
      this.state.pause?.player?.machineIdentifier ||
      this.state.resumeFrom?.machineIdentifier ||
      null
    )
  }

  async mediaControl(command, { machineIdentifier, sessionKey } = {}) {
    const target = this.targetPlayer(machineIdentifier)
    const player = this.state.players.find(p => p.machineIdentifier === target)
    const result = await this.playback.send(target, command, { sessionKey: sessionKey || player?.sessionKey })

    if (result.success) {
      if (command === 'pause') this.dispatch({ type: 'USER_PAUSED', machineIdentifier: target })
      if (command === 'play') this.dispatch({ type: 'USER_RESUMED' })
    }
    await this.broadcast()
    this.scheduleRefresh(COMMAND_REFRESH_DELAY_MS)
    return result
  }

  async resume() {
    const player =
      this.state.pause?.player || this.state.resumeFrom || this.state.players.find(p => p.state === 'paused')
    if (!player) return { success: false, error: 'No paused track found', code: 'no_paused_track' }
    return this.mediaControl('play', {
      machineIdentifier: player.machineIdentifier,
      sessionKey: player.sessionKey
    })
  }

  async selectPlayer(machineIdentifier) {
    this.dispatch({ type: 'SELECT_PLAYER', machineIdentifier })
    return this.broadcast()
  }

  // A tap on the kiosk: the screen turns on (if it was off) and its sleep
  // countdown restarts
  wake() {
    this.displayPower?.activity('tap')
  }

  isScreenOn() {
    return this.displayPower ? this.displayPower.isOn : true
  }

  // 📋 HEALTH (/api/health and the on-screen indicator)

  async health({ fresh = false } = {}) {
    if (!fresh && this.healthCache && Date.now() - this.healthCache.at < HEALTH_CACHE_MS) {
      return this.healthCache.value
    }
    const configured = this.isConfigured()

    // With the WebSocket active, sessions are only read on events: a light
    // request (/identity) tells whether Plex answers
    if (
      configured &&
      (!this.plexStatus.lastOkAt || Date.now() - this.plexStatus.lastOkAt > HEALTH_CACHE_MS)
    ) {
      try {
        await this.plexClient.getIdentity()
        this.plexStatus = { reachable: true, lastOkAt: Date.now(), lastError: null }
      } catch (error) {
        this.plexStatus = { ...this.plexStatus, reachable: false, lastError: error.message }
      }
    }

    const lastfmConfigured = this.lastfm.isConfigured()
    let lastfmReachable = null
    if (lastfmConfigured) {
      const recent = this.lastfm.lastOkAt && Date.now() - this.lastfm.lastOkAt < 5 * 60 * 1000
      if (recent) {
        lastfmReachable = true
      } else {
        try {
          await this.lastfm.getUserInfo()
          lastfmReachable = true
        } catch {
          lastfmReachable = false
        }
      }
    }

    const plexOk = !configured || this.plexStatus.reachable !== false
    const lastfmOk = !lastfmConfigured || lastfmReachable !== false
    const realtime = this.eventStream.connected

    const value = {
      status: !plexOk ? 'error' : !realtime && configured ? 'degraded' : !lastfmOk ? 'degraded' : 'ok',
      screen: this.state.screen,
      plex: {
        configured,
        reachable: configured ? this.plexStatus.reachable : null,
        lastOkAt: this.plexStatus.lastOkAt,
        lastError: this.plexStatus.lastError,
        websocket: realtime,
        updates: realtime ? 'realtime' : this.pollTimer ? 'polling' : 'off'
      },
      lastfm: {
        configured: lastfmConfigured,
        reachable: lastfmReachable,
        lastError: lastfmReachable === false ? this.lastfm.lastError : null
      },
      display: {
        sleepAvailable: this.displayPower ? this.displayPower.available : false,
        on: this.isScreenOn()
      },
      players: this.directory.list(),
      uptimeSeconds: Math.round(process.uptime())
    }
    this.healthCache = { at: Date.now(), value }
    return value
  }

  // Sends the health to the kiosk only when something visible changes
  async publishHealth() {
    this.healthCache = null
    const health = await this.health()
    const summary = {
      status: health.status,
      plex: health.plex.configured
        ? health.plex.reachable === false
          ? 'unreachable'
          : health.plex.updates
        : 'off',
      lastfm: health.lastfm.configured ? (health.lastfm.reachable === false ? 'unreachable' : 'ok') : 'off'
    }
    const key = JSON.stringify(summary)
    if (key !== this.lastHealthKey) {
      // A change (not the first report) turns the screen on, so a problem
      // (or its end) is noticed even when the screen was asleep
      if (this.lastHealthKey) this.displayPower?.activity('health change')
      this.lastHealthKey = key
      this.emit('health', summary)
    }
    return summary
  }

  healthSummary() {
    return this.lastHealthKey ? JSON.parse(this.lastHealthKey) : null
  }

  // 📋 DATA FOR THE SETTINGS (filters)

  async filterOptions() {
    const users = new Map()
    const players = new Map()
    const addPlayer = (id, data) => {
      if (!id) return
      const key = String(id)
      players.set(key, { machineIdentifier: key, ...players.get(key), ...data })
    }

    if (this.plexClient.isConfigured()) {
      const [accounts] = await Promise.allSettled([
        this.plexClient.getAccounts(),
        this.directory.refresh({ force: true })
      ])
      if (accounts.status === 'fulfilled') {
        for (const account of accounts.value) {
          // Account 0 is the server's system account, not a real user
          if (account?.id === undefined || String(account.id) === '0' || !account.name) continue
          users.set(String(account.id), { id: String(account.id), title: account.name })
        }
      }
    }
    for (const player of this.directory.list()) {
      addPlayer(player.machineIdentifier, { title: player.name, product: player.product || '' })
    }
    for (const user of this.seen.recentUsers()) {
      users.set(user.id, { id: user.id, title: user.title, ...users.get(user.id) })
    }
    for (const player of this.seen.recentPlayers()) {
      addPlayer(player.machineIdentifier, {
        title: player.title,
        product: player.product,
        local: player.local
      })
    }
    // Already selected entries stay in the list even when not found now
    for (const id of this.filters.users) {
      if (!users.has(id)) users.set(id, { id, title: `User ${id} (not found)` })
    }
    for (const id of this.filters.players) {
      if (!players.has(id)) addPlayer(id, { title: `Player ${id.slice(0, 8)}… (not found)`, product: '' })
    }

    const byTitle = (a, b) => (a.title || '').localeCompare(b.title || '')
    return {
      users: [...users.values()].sort(byTitle),
      players: [...players.values()]
        .map(p => ({ product: '', ...p, title: p.title || p.product || p.machineIdentifier }))
        .sort(byTitle)
    }
  }
}
