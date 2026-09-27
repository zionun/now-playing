import axios from 'axios'
import crypto from 'crypto'
import QRCode from 'qrcode'

// 📋 LOGIN PLEX CON QR CODE - Stesso flusso "PIN" usato dalle app ufficiali
// (TV, Plexamp): si genera un PIN, l'utente lo autorizza dal telefono
// scansionando un QR o inserendo il codice su plex.tv/link, il server
// interroga plex.tv finché il PIN non restituisce un token.
const PLEX_PRODUCT = 'Now Playing'
const PLEX_TV_API = 'https://plex.tv/api/v2'
const PIN_TTL_MS = 15 * 60 * 1000 // i PIN Plex scadono dopo ~15 minuti

export class PlexAuthService {
  constructor(configService) {
    this.configService = configService
    // PIN in corso di autorizzazione: pinId -> { code, clientIdentifier, createdAt }
    this.pendingPins = new Map()
  }

  // Un identificativo stabile per questa installazione, richiesto da Plex
  // per associare PIN e token al "dispositivo". Generato una sola volta e
  // salvato in config.
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
      'Accept': 'application/json',
      'X-Plex-Product': PLEX_PRODUCT,
      'X-Plex-Client-Identifier': clientIdentifier
    }
  }

  async createPin() {
    const clientIdentifier = await this.getClientIdentifier()

    const response = await axios.post(`${PLEX_TV_API}/pins`, null, {
      params: { strong: true },
      headers: this.plexHeaders(clientIdentifier),
      timeout: 8000
    })

    const { id, code } = response.data
    this.pendingPins.set(String(id), { code, clientIdentifier, createdAt: Date.now() })

    const authUrl = `https://app.plex.tv/auth#?clientID=${encodeURIComponent(clientIdentifier)}` +
      `&code=${encodeURIComponent(code)}` +
      `&context%5Bdevice%5D%5Bproduct%5D=${encodeURIComponent(PLEX_PRODUCT)}`

    const qrDataUrl = await QRCode.toDataURL(authUrl, { margin: 1, width: 400 })

    return { pinId: id, code, qrDataUrl, expiresIn: Math.floor(PIN_TTL_MS / 1000) }
  }

  async checkPin(pinId) {
    const pending = this.pendingPins.get(String(pinId))
    if (!pending) {
      throw new Error('PIN sconosciuto o già scaduto, richiedine uno nuovo')
    }
    if (Date.now() - pending.createdAt > PIN_TTL_MS) {
      this.pendingPins.delete(String(pinId))
      throw new Error('PIN scaduto, richiedine uno nuovo')
    }

    const response = await axios.get(`${PLEX_TV_API}/pins/${pinId}`, {
      headers: this.plexHeaders(pending.clientIdentifier),
      timeout: 8000
    })

    const authToken = response.data?.authToken
    if (!authToken) {
      return { authenticated: false }
    }

    // PIN consumato: non serve più tenerlo in memoria
    this.pendingPins.delete(String(pinId))

    const servers = await this.getServers(authToken, pending.clientIdentifier)
    return { authenticated: true, servers }
  }

  // Elenco dei server Plex accessibili con questo account (propri o
  // condivisi), con la connessione migliore per ciascuno: preferisce quella
  // sulla stessa rete locale, poi una diretta, infine il relay di Plex.
  async getServers(authToken, clientIdentifier) {
    const response = await axios.get(`${PLEX_TV_API}/resources`, {
      params: { includeHttps: 1, includeRelay: 1 },
      headers: { ...this.plexHeaders(clientIdentifier), 'X-Plex-Token': authToken },
      timeout: 8000
    })

    const resources = Array.isArray(response.data) ? response.data : []

    const servers = await Promise.all(resources
      .filter(resource => (resource.provides || '').split(',').includes('server'))
      .map(async resource => {
        // I server condivisi hanno un accessToken proprio, diverso da
        // quello dell'account: va usato quello quando presente.
        const accessToken = resource.accessToken || authToken
        const connection = await this.pickConnection(resource.connections || [], accessToken)

        if (!connection) return null

        return {
          name: resource.name || 'Server Plex',
          machineIdentifier: resource.clientIdentifier,
          local: !!connection.local,
          url: connection.address,
          port: connection.port,
          accessToken
        }
      }))

    return servers.filter(Boolean)
  }

  // Sceglie la connessione da usare: in ordine di preferenza locale, diretta,
  // relay, ma solo tra quelle che rispondono davvero. Gli indirizzi "locali"
  // annunciati da plex.tv non sempre sono raggiungibili (es. Plex in Docker
  // annuncia l'IP interno del container), quindi vanno provati.
  async pickConnection(connections, token) {
    const ordered = [
      ...connections.filter(c => c.local && !c.relay),
      ...connections.filter(c => !c.local && !c.relay),
      ...connections.filter(c => c.relay)
    ]

    const reachable = await Promise.all(ordered.map(async c => {
      try {
        await axios.get(`http://${c.address}:${c.port}/identity`, {
          headers: { 'Accept': 'application/json', 'X-Plex-Token': token },
          timeout: 3000
        })
        return true
      } catch {
        return false
      }
    }))

    return ordered.find((c, i) => reachable[i]) || ordered[0] || null
  }

  // Verifica se un token è ancora valido (non revocato dall'utente)
  async verifyToken(token) {
    try {
      await axios.get(`${PLEX_TV_API}/user`, {
        headers: { 'Accept': 'application/json', 'X-Plex-Token': token },
        timeout: 8000
      })
      return true
    } catch (error) {
      if (error.response?.status === 401) return false
      throw error // errore di rete: non sappiamo se il token è valido
    }
  }
}
