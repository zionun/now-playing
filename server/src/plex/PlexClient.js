import axios from 'axios'

// 📋 CLIENT HTTP DEL SERVER PLEX
// Tutte le chiamate al server Plex configurato passano da qui. La
// connessione (URL, token, identificativo di questa app) viene letta a ogni
// richiesta, così un cambio di configurazione ha effetto subito.
export class PlexUnauthorizedError extends Error {}
export class PlexNotConfiguredError extends Error {}

export class PlexClient {
  constructor(getConnection) {
    this.getConnection = getConnection
  }

  isConfigured() {
    const { baseUrl, token } = this.getConnection()
    return !!(baseUrl && token)
  }

  headers(extra = {}) {
    const { token, clientIdentifier } = this.getConnection()
    return {
      Accept: 'application/json',
      'X-Plex-Token': token,
      'X-Plex-Product': 'Now Playing',
      ...(clientIdentifier && { 'X-Plex-Client-Identifier': clientIdentifier }),
      ...extra
    }
  }

  async get(path, { params, headers, timeout = 8000, responseType } = {}) {
    const { baseUrl, token } = this.getConnection()
    if (!baseUrl || !token) throw new PlexNotConfiguredError('Plex non configurato')
    try {
      return await axios.get(`${baseUrl}${path}`, {
        params,
        headers: this.headers(headers),
        // Senza timeout un server irraggiungibile blocca la chiamata per minuti
        timeout,
        responseType
      })
    } catch (error) {
      if (error.response?.status === 401) throw new PlexUnauthorizedError('Token Plex non valido')
      throw error
    }
  }

  async getSessions() {
    return (await this.get('/status/sessions')).data
  }

  async getIdentity(timeout = 5000) {
    return (await this.get('/identity', { timeout })).data?.MediaContainer || {}
  }

  async getAccounts() {
    const list = (await this.get('/accounts', { timeout: 5000 })).data?.MediaContainer?.Account || []
    return Array.isArray(list) ? list : [list]
  }

  // Player che il server Plex vede sulla rete e sa controllare
  async getClients() {
    const list = (await this.get('/clients', { timeout: 5000 })).data?.MediaContainer?.Server || []
    return Array.isArray(list) ? list : [list]
  }

  async streamArt(path) {
    return this.get(path, { responseType: 'stream', timeout: 10000, headers: { Accept: 'image/*' } })
  }

  // Comando di riproduzione inoltrato dal server Plex al player indicato
  async sendPlayerCommand(machineIdentifier, command, params = {}) {
    return this.get(`/player/playback/${command}`, {
      params,
      headers: { 'X-Plex-Target-Client-Identifier': machineIdentifier },
      timeout: 5000
    })
  }

  // URL della connessione WebSocket per le notifiche in tempo reale
  notificationsUrl() {
    const { baseUrl, token } = this.getConnection()
    if (!baseUrl || !token) return null
    return `${baseUrl.replace(/^http/, 'ws')}/:/websockets/notifications?X-Plex-Token=${encodeURIComponent(token)}&filters=playing`
  }
}
