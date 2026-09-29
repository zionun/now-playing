import { EventEmitter } from 'events'
import { filterSessions, hasActiveFilters, normalizeFilters, SeenRegistry } from '../services/sessionFilters.js'
import { extractMusicPlayers } from '../core/sessionAnalyzer.js'
import { initialState, reduce, toNowPlaying, PAUSE_TO_IDLE_MS } from '../core/screenState.js'
import { PlexUnauthorizedError } from '../plex/PlexClient.js'
import { createLogger } from '../lib/logger.js'

const log = createLogger('now-playing')

const FALLBACK_POLL_MS = 10000 // polling solo quando il WebSocket Plex è giù
const EVENT_REFRESH_DELAY_MS = 400 // Plex aggiorna le sessioni poco dopo l'evento
const COMMAND_REFRESH_DELAY_MS = 1000
const HEALTH_CACHE_MS = 30000

// 📋 SERVIZIO PRINCIPALE
// Coordina Plex (HTTP + eventi), filtri, macchina a stati e Last.fm, ed è
// l'unico punto con timer e stato mutabile. Emette:
//   'nowPlaying' (dati per il kiosk), 'authRequired', 'configUpdated', 'health'
export class NowPlayingService extends EventEmitter {
  constructor({ configService, plexClient, eventStream, directory, playback, lastfm, plexAuthService }) {
    super()
    this.configService = configService
    this.plexClient = plexClient
    this.eventStream = eventStream
    this.directory = directory
    this.playback = playback
    this.lastfm = lastfm
    this.plexAuthService = plexAuthService

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

  // 📋 CONFIGURAZIONE

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

  // Chiamato dopo ogni salvataggio della configurazione
  async reloadConfig() {
    await this.configService.loadConfig()
    this.lastfm.clearCache()
    this.directory.clear()
    this.healthCache = null
    this.applyConfig()
    this.emit('configUpdated')
  }

  applyConfig() {
    const config = this.configService.getConfig()
    this.filters = normalizeFilters(config.filters)
    const hasPassword = this.configService.hasConfigPassword()
    const plexConnected = this.plexClient.isConfigured()

    // setup: manca la password; login: manca (o non vale più) il collegamento a Plex
    this.dispatch({ type: 'CONFIG', configured: hasPassword, tokenValid: plexConnected })

    if (hasPassword && plexConnected) {
      this.eventStream.restart()
      this.directory.start()
      // Finché il WebSocket non è connesso si va in polling
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

  // 📋 AGGIORNAMENTO DELLE SESSIONI

  // Le richieste ravvicinate si accodano: al massimo una lettura in corso e
  // una in attesa, mai letture sovrapposte.
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
      log.warn('Sessioni Plex non disponibili:', error.message)
      this.publishHealth()
      return
    }

    // I filtri si applicano qui, prima di ogni altra elaborazione
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
    // Notifiche solo di player esclusi dai filtri: niente da aggiornare
    if (hasActiveFilters(this.filters)) {
      const relevant = notifications.some(n => this.allowedMachineIds.has(n.clientIdentifier))
      // Un player ammesso che inizia ora non è ancora noto: si rilegge comunque
      // se la notifica è un nuovo "playing"
      if (!relevant && !notifications.some(n => n.state === 'playing')) return
    }
    this.scheduleRefresh(EVENT_REFRESH_DELAY_MS)
  }

  startPolling() {
    if (this.pollTimer) return
    log.info(`Polling ogni ${FALLBACK_POLL_MS / 1000}s finché il WebSocket Plex non torna disponibile`)
    this.pollTimer = setInterval(() => this.refresh(), FALLBACK_POLL_MS)
  }

  stopPolling() {
    if (!this.pollTimer) return
    clearInterval(this.pollTimer)
    this.pollTimer = null
    log.info('WebSocket Plex attivo: polling sospeso')
  }

  async handleUnauthorized() {
    log.warn('Token Plex non più valido (401): serve un nuovo login')
    await this.configService.clearPlexToken()
    this.eventStream.stop()
    this.stopPolling()
    this.dispatch({ type: 'CONFIG', configured: this.configService.hasConfigPassword(), tokenValid: false })
    this.emit('authRequired', { reason: 'token_invalid' })
    this.publishHealth()
  }

  // 📋 MACCHINA A STATI E TIMER

  dispatch(event) {
    const previous = this.state.screen
    this.state = reduce(this.state, { now: Date.now(), ...event })
    if (previous !== this.state.screen) {
      log.info(`Schermata: ${previous} → ${this.state.screen}`)
      this.onScreenChange(previous, this.state.screen)
    }
  }

  onScreenChange(previous, screen) {
    if (screen === 'paused') {
      this.clearPauseTimers()
      this.pauseTimer = setTimeout(() => {
        this.pauseTimer = null
        this.dispatch({ type: 'PAUSE_EXPIRED' })
        this.broadcast()
      }, PAUSE_TO_IDLE_MS)
      // Il kiosk mostra il conto alla rovescia
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

  // 📋 COMANDI DAL KIOSK

  targetPlayer(machineIdentifier) {
    if (machineIdentifier) return machineIdentifier
    return this.state.primary?.machineIdentifier ||
      this.state.pause?.player?.machineIdentifier ||
      this.state.resumeFrom?.machineIdentifier ||
      null
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
    const player = this.state.pause?.player ||
      this.state.resumeFrom ||
      this.state.players.find(p => p.state === 'paused')
    if (!player) return { success: false, error: 'Nessuna traccia in pausa trovata' }
    return this.mediaControl('play', { machineIdentifier: player.machineIdentifier, sessionKey: player.sessionKey })
  }

  async selectPlayer(machineIdentifier) {
    this.dispatch({ type: 'SELECT_PLAYER', machineIdentifier })
    return this.broadcast()
  }

  // 📋 STATO DI SALUTE (/api/health e indicatore a schermo)

  async health({ fresh = false } = {}) {
    if (!fresh && this.healthCache && Date.now() - this.healthCache.at < HEALTH_CACHE_MS) {
      return this.healthCache.value
    }
    const configured = this.isConfigured()

    // Con il WebSocket attivo le sessioni si leggono solo sugli eventi: per
    // sapere se Plex risponde si fa una richiesta leggera (/identity)
    if (configured && (!this.plexStatus.lastOkAt || Date.now() - this.plexStatus.lastOkAt > HEALTH_CACHE_MS)) {
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
      players: this.directory.list(),
      uptimeSeconds: Math.round(process.uptime())
    }
    this.healthCache = { at: Date.now(), value }
    return value
  }

  // Invia lo stato di salute al kiosk solo quando cambia qualcosa di visibile
  async publishHealth() {
    this.healthCache = null
    const health = await this.health()
    const summary = {
      status: health.status,
      plex: health.plex.configured ? (health.plex.reachable === false ? 'unreachable' : health.plex.updates) : 'off',
      lastfm: health.lastfm.configured ? (health.lastfm.reachable === false ? 'unreachable' : 'ok') : 'off'
    }
    const key = JSON.stringify(summary)
    if (key !== this.lastHealthKey) {
      this.lastHealthKey = key
      this.emit('health', summary)
    }
    return summary
  }

  healthSummary() {
    return this.lastHealthKey ? JSON.parse(this.lastHealthKey) : null
  }

  // 📋 DATI PER LA CONFIGURAZIONE (filtri)

  async filterOptions() {
    const users = new Map()
    const players = new Map()
    const addPlayer = (id, data) => {
      if (!id) return
      const key = String(id)
      players.set(key, { machineIdentifier: key, ...players.get(key), ...data })
    }

    if (this.plexClient.isConfigured()) {
      const [accounts] = await Promise.allSettled([this.plexClient.getAccounts(), this.directory.refresh({ force: true })])
      if (accounts.status === 'fulfilled') {
        for (const account of accounts.value) {
          // L'account 0 è quello di sistema del server, non un utente reale
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
      addPlayer(player.machineIdentifier, { title: player.title, product: player.product, local: player.local })
    }
    // Gli elementi già selezionati restano in elenco anche se ora non si trovano
    for (const id of this.filters.users) {
      if (!users.has(id)) users.set(id, { id, title: `Utente ${id} (non trovato)` })
    }
    for (const id of this.filters.players) {
      if (!players.has(id)) addPlayer(id, { title: `Player ${id.slice(0, 8)}… (non trovato)`, product: '' })
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
