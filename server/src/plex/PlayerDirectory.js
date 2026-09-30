import axios from 'axios'
import { discoverPlayers as gdmDiscover } from './gdm.js'
import { createLogger } from '../lib/logger.js'

const log = createLogger('players')

const REFRESH_INTERVAL_MS = 5 * 60 * 1000
const MIN_REFRESH_GAP_MS = 30 * 1000
const FAILURE_COOLDOWN_MS = 10 * 60 * 1000

// 📋 ELENCO DEI PLAYER E DI COME CONTROLLARLI (sostituisce la discovery nmap)
// Fonti, nessuna delle quali richiede comandi di shell:
// - GET /clients del server Plex: player che il server vede e sa controllare
// - risorse plex.tv con provides=player (Plexamp, app mobili, TV...)
// - GDM: broadcast UDP sulla rete locale, risponde chi accetta comandi diretti
// - sessioni: Player.address dei player in LAN, verificato con /resources
//
// Per ogni player si sa quindi se è controllabile tramite il server Plex
// (viaServer) e/o direttamente (direct: indirizzo e porta). Un comando
// fallito nasconde i controlli per quel player per 10 minuti.
export class PlayerDirectory {
  constructor({
    plexClient,
    getPlayerResources,
    discover = gdmDiscover,
    probe = probeDirect,
    now = () => Date.now()
  }) {
    this.plexClient = plexClient
    this.getPlayerResources = getPlayerResources
    this.discover = discover
    this.probe = probe
    this.now = now
    this.players = new Map()
    this.lastRefreshAt = 0
    this.refreshInFlight = null
    this.probed = new Set()
    this.timer = null
  }

  start() {
    this.stop()
    this.refresh()
    this.timer = setInterval(() => this.refresh(), REFRESH_INTERVAL_MS)
    this.timer.unref?.()
  }

  stop() {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  clear() {
    this.players.clear()
    this.probed.clear()
    this.lastRefreshAt = 0
  }

  upsert(machineIdentifier, data) {
    if (!machineIdentifier) return
    const id = String(machineIdentifier)
    const current = this.players.get(id) || {
      machineIdentifier: id,
      viaServer: false,
      direct: null,
      sources: []
    }
    const sources =
      data.source && !current.sources.includes(data.source)
        ? [...current.sources, data.source]
        : current.sources
    const { source, ...rest } = data
    this.players.set(id, { ...current, ...rest, sources, lastSeen: this.now() })
  }

  // Aggiorna l'elenco da tutte le fonti; le richieste ravvicinate condividono
  // quella in corso.
  refresh({ force = false } = {}) {
    if (this.refreshInFlight) return this.refreshInFlight
    if (!force && this.now() - this.lastRefreshAt < MIN_REFRESH_GAP_MS) return Promise.resolve()
    this.refreshInFlight = this.runRefresh().finally(() => {
      this.refreshInFlight = null
      this.lastRefreshAt = this.now()
    })
    return this.refreshInFlight
  }

  async runRefresh() {
    const [clients, resources, gdm] = await Promise.allSettled([
      this.plexClient.isConfigured() ? this.plexClient.getClients() : Promise.resolve([]),
      this.getPlayerResources(),
      this.discover()
    ])

    if (clients.status === 'fulfilled') {
      for (const client of clients.value) {
        this.upsert(client.machineIdentifier, {
          name: client.name,
          product: client.product || '',
          viaServer: true,
          ...(client.address &&
            client.port && { direct: { address: client.address, port: parseInt(client.port, 10) } }),
          source: 'server'
        })
      }
    } else {
      log.debug('GET /clients non riuscito:', clients.reason?.message)
    }

    if (resources.status === 'fulfilled') {
      for (const resource of resources.value || []) {
        // pubsub-player: controllabile a distanza tramite Plex
        const remote = (resource.provides || []).includes('pubsub-player')
        const known = this.players.get(String(resource.machineIdentifier))
        this.upsert(resource.machineIdentifier, {
          name: known?.name || resource.title,
          product: known?.product || resource.product,
          viaServer: known?.viaServer || remote,
          source: 'plex.tv'
        })
      }
    } else {
      log.debug('Risorse plex.tv non disponibili:', resources.reason?.message)
    }

    if (gdm.status === 'fulfilled') {
      for (const player of gdm.value) {
        const canPlay = player.capabilities.length === 0 || player.capabilities.includes('playback')
        this.upsert(player.machineIdentifier, {
          name: player.name,
          product: player.product,
          ...(canPlay && { direct: { address: player.address, port: player.port } }),
          source: 'gdm'
        })
      }
    }

    log.info(
      `Player noti: ${this.players.size} (${[...this.players.values()].filter(p => this.isControllable(p.machineIdentifier)).length} controllabili)`
    )
  }

  // I player delle sessioni in LAN hanno un indirizzo (Player.address): si
  // verifica una sola volta se accettano comandi diretti sulla porta 32500.
  noteSessionPlayers(players) {
    let unknown = false
    for (const player of players) {
      const known = this.players.get(player.machineIdentifier)
      if (!known) unknown = true
      this.upsert(player.machineIdentifier, {
        name: player.name,
        product: player.product || known?.product || '',
        source: 'session'
      })
      if (player.local && player.address && !known?.direct && !this.probed.has(player.machineIdentifier)) {
        this.probed.add(player.machineIdentifier)
        this.probe(player.address, 32500, player.machineIdentifier).then(ok => {
          if (ok) {
            this.upsert(player.machineIdentifier, {
              direct: { address: player.address, port: 32500 },
              source: 'probe'
            })
            log.info(`Controllo diretto disponibile per ${player.name} (${player.address})`)
          }
        })
      }
    }
    // Un player mai visto prima: forse le altre fonti ne sanno qualcosa
    if (unknown) this.refresh()
  }

  get(machineIdentifier) {
    return this.players.get(String(machineIdentifier)) || null
  }

  isControllable(machineIdentifier) {
    const player = this.get(machineIdentifier)
    if (!player) return false
    if (player.failedUntil && player.failedUntil > this.now()) return false
    return !!(player.viaServer || player.direct)
  }

  markFailed(machineIdentifier) {
    this.upsert(machineIdentifier, { failedUntil: this.now() + FAILURE_COOLDOWN_MS })
  }

  markOk(machineIdentifier) {
    this.upsert(machineIdentifier, { failedUntil: null })
  }

  list() {
    return [...this.players.values()].map(p => ({
      machineIdentifier: p.machineIdentifier,
      name: p.name,
      product: p.product,
      controllable: this.isControllable(p.machineIdentifier),
      viaServer: p.viaServer,
      direct: !!p.direct,
      sources: p.sources
    }))
  }
}

// Verifica se all'indirizzo risponde proprio quel player Plex
export async function probeDirect(address, port, machineIdentifier) {
  try {
    const response = await axios.get(`http://${address}:${port}/resources`, { timeout: 2000 })
    return String(response.data).includes(machineIdentifier)
  } catch {
    return false
  }
}
