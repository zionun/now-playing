import axios from 'axios'
import crypto from 'crypto'
import { AppError } from '../lib/errors.js'

// 📋 PLEX LOGIN - The same "PIN" flow used by the official apps (TV,
// Plexamp): a PIN is created, the user authorizes it on plex.tv from the
// phone and the server polls plex.tv until the PIN returns a token.
const PLEX_PRODUCT = 'Now Playing'
const PLEX_TV_API = 'https://plex.tv/api/v2'
const PIN_TTL_MS = 15 * 60 * 1000 // Plex PINs expire after ~15 minutes

export class PlexAuthService {
  constructor(configService) {
    this.configService = configService
    // PINs waiting for authorization: pinId -> { code, clientIdentifier, createdAt, result }
    this.pendingPins = new Map()
  }

  // A stable identifier for this installation, required by Plex to bind PINs
  // and tokens to the "device". Generated once and saved in the configuration.
  async getClientIdentifier() {
    const config = this.configService.getConfig()
    if (config.plex?.clientIdentifier) {
      return config.plex.clientIdentifier
    }
    const clientIdentifier = crypto.randomUUID()
    await this.configService.setPlexClientIdentifier(clientIdentifier)
    return clientIdentifier
  }

  plexHeaders(clientIdentifier) {
    return {
      Accept: 'application/json',
      'X-Plex-Product': PLEX_PRODUCT,
      'X-Plex-Client-Identifier': clientIdentifier
    }
  }

  // Creates a Plex PIN and the authorization link to open on the phone.
  // forwardUrl: where Plex sends the browser back after the login.
  async createPin(forwardUrl) {
    this.cleanupExpiredPins()
    const clientIdentifier = await this.getClientIdentifier()

    const response = await axios.post(`${PLEX_TV_API}/pins`, null, {
      params: { strong: true },
      headers: this.plexHeaders(clientIdentifier),
      timeout: 8000
    })

    const { id, code } = response.data
    this.pendingPins.set(String(id), { code, clientIdentifier, createdAt: Date.now(), result: null })

    let authUrl =
      `https://app.plex.tv/auth#?clientID=${encodeURIComponent(clientIdentifier)}` +
      `&code=${encodeURIComponent(code)}` +
      `&context%5Bdevice%5D%5Bproduct%5D=${encodeURIComponent(PLEX_PRODUCT)}`
    if (forwardUrl) {
      authUrl += `&forwardUrl=${encodeURIComponent(forwardUrl)}`
    }

    return { pinId: id, authUrl, expiresIn: Math.floor(PIN_TTL_MS / 1000) }
  }

  cleanupExpiredPins() {
    const now = Date.now()
    for (const [id, pin] of this.pendingPins) {
      if (now - pin.createdAt > PIN_TTL_MS) this.pendingPins.delete(id)
    }
  }

  // Checks whether the PIN has been authorized. Token, account and servers
  // stay on the server (never sent to the browser): the client picks the
  // server by machineIdentifier.
  async checkPin(pinId) {
    this.cleanupExpiredPins()
    const pending = this.pendingPins.get(String(pinId))
    if (!pending) {
      throw new AppError('plex_login_expired', 'Plex login expired, please try again')
    }

    if (!pending.result) {
      const response = await axios.get(`${PLEX_TV_API}/pins/${pinId}`, {
        headers: this.plexHeaders(pending.clientIdentifier),
        timeout: 8000
      })

      const authToken = response.data?.authToken
      if (!authToken) {
        return { authenticated: false }
      }

      const [account, servers] = await Promise.all([
        this.getAccount(authToken),
        this.getServers(authToken, pending.clientIdentifier)
      ])
      pending.result = { authToken, account, servers }
    }

    const { account, servers } = pending.result
    return {
      authenticated: true,
      account: { username: account.username },
      servers: servers.map(({ name, machineIdentifier, local, owned }) => ({
        name,
        machineIdentifier,
        local,
        owned
      }))
    }
  }

  // The PIN must already be authorized: returns the full data (tokens
  // included) and removes it, since each PIN can only be used once.
  consumePin(pinId) {
    const pending = this.pendingPins.get(String(pinId))
    if (!pending?.result) {
      throw new AppError('plex_login_incomplete', 'Plex login not completed or expired')
    }
    this.pendingPins.delete(String(pinId))
    return pending.result
  }

  // The Plex account that authorized the token: used to recognize the same
  // user when they ask to reset the password.
  async getAccount(authToken) {
    const clientIdentifier = await this.getClientIdentifier()
    const response = await axios.get(`${PLEX_TV_API}/user`, {
      headers: { ...this.plexHeaders(clientIdentifier), 'X-Plex-Token': authToken },
      timeout: 8000
    })
    return {
      id: String(response.data.id),
      username: response.data.username || response.data.title || response.data.email || ''
    }
  }

  // Plex servers available to this account (owned or shared), each with its
  // best connection: local network first, then direct, then Plex's relay.
  async getServers(authToken, clientIdentifier) {
    const response = await axios.get(`${PLEX_TV_API}/resources`, {
      params: { includeHttps: 1, includeRelay: 1 },
      headers: { ...this.plexHeaders(clientIdentifier), 'X-Plex-Token': authToken },
      timeout: 8000
    })

    const resources = Array.isArray(response.data) ? response.data : []

    const servers = await Promise.all(
      resources
        .filter(resource => (resource.provides || '').split(',').includes('server'))
        .map(async resource => {
          // Shared servers have their own accessToken, different from the
          // account's: use it when present.
          const accessToken = resource.accessToken || authToken
          const connection = await this.pickConnection(resource.connections || [], accessToken)

          if (!connection) return null

          return {
            name: resource.name || 'Plex server',
            machineIdentifier: resource.clientIdentifier,
            local: !!connection.local,
            url: connection.address,
            port: connection.port,
            owned: !!resource.owned,
            accessToken
          }
        })
    )

    return servers.filter(Boolean)
  }

  // Devices of the account acting as players (Plexamp, mobile apps, Plex
  // HTPC...), offered in the filters with a readable name.
  async getPlayerResources(authToken) {
    const clientIdentifier = await this.getClientIdentifier()
    const response = await axios.get(`${PLEX_TV_API}/resources`, {
      headers: { ...this.plexHeaders(clientIdentifier), 'X-Plex-Token': authToken },
      timeout: 8000
    })
    const resources = Array.isArray(response.data) ? response.data : []
    return resources
      .filter(resource => (resource.provides || '').split(',').includes('player'))
      .map(resource => ({
        machineIdentifier: resource.clientIdentifier,
        title: resource.name || resource.product || 'Player',
        product: resource.product || '',
        provides: (resource.provides || '')
          .split(',')
          .map(s => s.trim())
          .filter(Boolean),
        presence: !!resource.presence
      }))
  }

  // Picks the connection to use: local, then direct, then relay, but only
  // among those that actually answer. The "local" addresses advertised by
  // plex.tv are not always reachable (e.g. Plex in Docker advertises the
  // container's internal IP), so they are probed.
  async pickConnection(connections, token) {
    const ordered = [
      ...connections.filter(c => c.local && !c.relay),
      ...connections.filter(c => !c.local && !c.relay),
      ...connections.filter(c => c.relay)
    ]

    const reachable = await Promise.all(
      ordered.map(async c => {
        try {
          await axios.get(`http://${c.address}:${c.port}/identity`, {
            headers: { Accept: 'application/json', 'X-Plex-Token': token },
            timeout: 3000
          })
          return true
        } catch {
          return false
        }
      })
    )

    return ordered.find((c, i) => reachable[i]) || ordered[0] || null
  }

  // Checks whether a token is still valid (not revoked by the user)
  async verifyToken(token) {
    try {
      await axios.get(`${PLEX_TV_API}/user`, {
        headers: { Accept: 'application/json', 'X-Plex-Token': token },
        timeout: 8000
      })
      return true
    } catch (error) {
      if (error.response?.status === 401) return false
      throw error // network error: we can't tell whether the token is valid
    }
  }
}
