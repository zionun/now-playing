import axios from 'axios'
import crypto from 'crypto'

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

  // Crea un PIN Plex e il link di autorizzazione da aprire sul telefono.
  // forwardUrl: dove Plex rimanda il browser dopo l'accesso.
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

    let authUrl = `https://app.plex.tv/auth#?clientID=${encodeURIComponent(clientIdentifier)}` +
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

  // Controlla se il PIN è stato autorizzato. Il token, l'account e i server
  // restano solo sul server (non vengono mai inviati al browser): il client
  // sceglie il server per machineIdentifier.
  async checkPin(pinId) {
    this.cleanupExpiredPins()
    const pending = this.pendingPins.get(String(pinId))
    if (!pending) {
      throw new Error('Accesso Plex scaduto, riprova')
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
      servers: servers.map(({ name, machineIdentifier, local, owned }) => ({ name, machineIdentifier, local, owned }))
    }
  }

  // Il PIN deve essere già autorizzato: restituisce i dati completi (token
  // compresi) e lo rimuove, perché ogni PIN si usa una volta sola.
  consumePin(pinId) {
    const pending = this.pendingPins.get(String(pinId))
    if (!pending?.result) {
      throw new Error('Accesso Plex non completato o scaduto')
    }
    this.pendingPins.delete(String(pinId))
    return pending.result
  }

  // L'account Plex che ha autorizzato il token: serve per riconoscere lo
  // stesso utente quando chiede di reimpostare la password.
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
          owned: !!resource.owned,
          accessToken
        }
      }))

    return servers.filter(Boolean)
  }

  // Dispositivi dell'account che fanno da player (Plexamp, app mobile,
  // Plex HTPC...), per proporli nei filtri con un nome leggibile.
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
        provides: (resource.provides || '').split(',').map(s => s.trim()).filter(Boolean),
        presence: !!resource.presence
      }))
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
