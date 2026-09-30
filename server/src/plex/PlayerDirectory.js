import axios from 'axios'
import { discoverPlayers as gdmDiscover } from './gdm.js'
import { createLogger } from '../lib/logger.js'

const log = createLogger('players')

const REFRESH_INTERVAL_MS = 5 * 60 * 1000
const MIN_REFRESH_GAP_MS = 30 * 1000
const FAILURE_COOLDOWN_MS = 10 * 60 * 1000

// 📋 KNOWN PLAYERS AND HOW TO CONTROL THEM (replaces the nmap discovery)
// Sources, none of which needs shell commands:
// - GET /clients of the Plex server: players the server sees and can control
// - plex.tv resources with provides=player (Plexamp, mobile apps, TVs...)
// - GDM: UDP broadcast on the local network, answered by players accepting direct commands
// - sessions: Player.address of players on the LAN, checked with /resources
//
// So for each player we know whether it can be controlled through the Plex
// server (viaServer) and/or directly (direct: address and port). A failed
// command hides that player's controls for 10 minutes.
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

  // Refreshes the list from every source; close requests share the one in
  // progress.
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
      log.debug('GET /clients failed:', clients.reason?.message)
    }

    if (resources.status === 'fulfilled') {
      for (const resource of resources.value || []) {
        // pubsub-player: remotely controllable through Plex
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
      log.debug('plex.tv resources not available:', resources.reason?.message)
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
      `Known players: ${this.players.size} (${[...this.players.values()].filter(p => this.isControllable(p.machineIdentifier)).length} controllable)`
    )
  }

  // Players of LAN sessions have an address (Player.address): check once
  // whether they accept direct commands on port 32500.
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
            log.info(`Direct control available for ${player.name} (${player.address})`)
          }
        })
      }
    }
    // A player never seen before: the other sources may know about it
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

// Checks whether that very Plex player answers at the address
export async function probeDirect(address, port, machineIdentifier) {
  try {
    const response = await axios.get(`http://${address}:${port}/resources`, { timeout: 2000 })
    return String(response.data).includes(machineIdentifier)
  } catch {
    return false
  }
}
