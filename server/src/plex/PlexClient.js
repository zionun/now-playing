import axios from 'axios'

// 📋 PLEX MEDIA SERVER HTTP CLIENT
// Every call to the configured Plex server goes through here. The
// connection (URL, token, this app's identifier) is read on every request,
// so a configuration change takes effect immediately.
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
    if (!baseUrl || !token) throw new PlexNotConfiguredError('Plex not configured')
    try {
      return await axios.get(`${baseUrl}${path}`, {
        params,
        headers: this.headers(headers),
        // Without a timeout an unreachable server blocks the call for minutes
        timeout,
        responseType
      })
    } catch (error) {
      if (error.response?.status === 401) throw new PlexUnauthorizedError('Invalid Plex token')
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

  // Players the Plex server sees on the network and can control
  async getClients() {
    const list = (await this.get('/clients', { timeout: 5000 })).data?.MediaContainer?.Server || []
    return Array.isArray(list) ? list : [list]
  }

  async streamArt(path) {
    return this.get(path, { responseType: 'stream', timeout: 10000, headers: { Accept: 'image/*' } })
  }

  // Playback command relayed by the Plex server to the given player
  async sendPlayerCommand(machineIdentifier, command, params = {}) {
    return this.get(`/player/playback/${command}`, {
      params,
      headers: { 'X-Plex-Target-Client-Identifier': machineIdentifier },
      timeout: 5000
    })
  }

  // WebSocket URL for real-time notifications
  notificationsUrl() {
    const { baseUrl, token } = this.getConnection()
    if (!baseUrl || !token) return null
    return `${baseUrl.replace(/^http/, 'ws')}/:/websockets/notifications?X-Plex-Token=${encodeURIComponent(token)}&filters=playing`
  }
}
