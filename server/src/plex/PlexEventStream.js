import { EventEmitter } from 'events'
import WebSocket from 'ws'
import { backoffDelay } from '../lib/backoff.js'
import { createLogger } from '../lib/logger.js'

const log = createLogger('plex-ws')

// 📋 EVENTI IN TEMPO REALE DI PLEX (WebSocket /:/websockets/notifications)
// - riconnessione con ritardo esponenziale (1s, 2s, 4s... fino a 60s)
// - un solo timer di riconnessione attivo alla volta
// - eventi emessi: 'open', 'close', 'playing' (lista di PlaySessionStateNotification)
export class PlexEventStream extends EventEmitter {
  constructor(getUrl, { createSocket = url => new WebSocket(url), backoff = {} } = {}) {
    super()
    this.getUrl = getUrl
    this.createSocket = createSocket
    this.backoff = backoff
    this.socket = null
    this.reconnectTimer = null
    this.attempt = 0
    this.connected = false
    this.running = false
    this.lastMessageAt = null
    this.lastError = null
  }

  start() {
    this.running = true
    this.attempt = 0
    this.connect()
  }

  stop() {
    this.running = false
    this.clearReconnect()
    this.closeSocket()
    this.setConnected(false)
  }

  // Configurazione cambiata (es. nuovo server): chiude e riapre subito
  restart() {
    this.stop()
    this.start()
  }

  clearReconnect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
  }

  closeSocket() {
    if (!this.socket) return
    const socket = this.socket
    this.socket = null
    socket.removeAllListeners()
    socket.on('error', () => {}) // errori residui dopo la chiusura
    try {
      socket.terminate()
    } catch {
      // già chiuso
    }
  }

  setConnected(value) {
    if (this.connected === value) return
    this.connected = value
    this.emit(value ? 'open' : 'close')
  }

  connect() {
    this.clearReconnect()
    this.closeSocket()
    if (!this.running) return

    const url = this.getUrl()
    if (!url) {
      log.debug('Plex non configurato: WebSocket non avviato')
      return
    }

    log.debug(`Connessione (tentativo ${this.attempt + 1})`)
    const socket = this.createSocket(url)
    this.socket = socket

    socket.on('open', () => {
      if (socket !== this.socket) return
      this.attempt = 0
      this.lastError = null
      log.info('Connesso agli eventi in tempo reale di Plex')
      this.setConnected(true)
    })

    socket.on('message', data => {
      if (socket !== this.socket) return
      this.lastMessageAt = Date.now()
      let event
      try {
        event = JSON.parse(data.toString())
      } catch {
        log.debug('Messaggio non JSON ignorato')
        return
      }
      const notifications = event?.NotificationContainer?.PlaySessionStateNotification
      if (notifications) {
        const list = Array.isArray(notifications) ? notifications : [notifications]
        log.debug(`Evento playing: ${list.map(n => `${n.clientIdentifier}→${n.state}`).join(', ')}`)
        this.emit('playing', list)
      }
    })

    socket.on('error', error => {
      if (socket !== this.socket) return
      this.lastError = error.message
      log.debug('Errore WebSocket:', error.message)
    })

    socket.on('close', () => {
      if (socket !== this.socket) return
      this.socket = null
      this.setConnected(false)
      this.scheduleReconnect()
    })
  }

  scheduleReconnect() {
    if (!this.running || this.reconnectTimer) return
    const delay = backoffDelay(this.attempt, this.backoff)
    this.attempt += 1
    log.info(`WebSocket Plex chiuso, nuovo tentativo tra ${Math.round(delay / 1000)}s`)
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      this.connect()
    }, delay)
  }
}
