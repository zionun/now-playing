import axios from 'axios'
import { createLogger } from '../lib/logger.js'

const log = createLogger('playback')

// Comandi del kiosk → comandi Plex
const PLEX_COMMANDS = {
  play: 'play',
  pause: 'pause',
  stop: 'stop',
  next: 'skipNext',
  previous: 'skipPrevious',
  skipNext: 'skipNext',
  skipPrevious: 'skipPrevious'
}

// 📋 CONTROLLO DELLA RIPRODUZIONE
// Prima si prova tramite il server Plex (X-Plex-Target-Client-Identifier),
// che funziona anche per player fuori dalla LAN; poi, se il player accetta
// comandi diretti, con una chiamata alla sua porta (tipicamente 32500).
export class PlaybackController {
  constructor({ plexClient, directory, getConnection, httpGet = axios.get }) {
    this.plexClient = plexClient
    this.directory = directory
    this.getConnection = getConnection
    this.httpGet = httpGet
    this.commandId = 0
  }

  async send(machineIdentifier, command, { sessionKey } = {}) {
    const plexCommand = PLEX_COMMANDS[command]
    if (!plexCommand) return { success: false, error: `Comando sconosciuto: ${command}` }
    if (!machineIdentifier) return { success: false, error: 'Nessun player da controllare' }

    const player = this.directory.get(machineIdentifier)
    const params = {
      type: 'music',
      commandID: ++this.commandId,
      ...(sessionKey && { sessionKey })
    }

    const attempts = []
    if (player?.viaServer) attempts.push(['server', () => this.plexClient.sendPlayerCommand(machineIdentifier, plexCommand, params)])
    if (player?.direct) attempts.push(['diretto', () => this.sendDirect(player.direct, machineIdentifier, plexCommand, params)])
    // Player sconosciuto all'elenco: un tentativo tramite il server costa poco
    if (attempts.length === 0) attempts.push(['server', () => this.plexClient.sendPlayerCommand(machineIdentifier, plexCommand, params)])

    const errors = []
    for (const [route, attempt] of attempts) {
      try {
        await attempt()
        this.directory.markOk(machineIdentifier)
        log.info(`${command} → ${player?.name || machineIdentifier} (${route})`)
        return { success: true, command, plexCommand, route }
      } catch (error) {
        errors.push(`${route}: ${error.response?.status || error.code || error.message}`)
      }
    }

    // Nessuna strada ha funzionato: controlli nascosti per un po'
    this.directory.markFailed(machineIdentifier)
    log.warn(`${command} non riuscito su ${player?.name || machineIdentifier} (${errors.join('; ')})`)
    return { success: false, error: 'Il player non accetta comandi', details: errors }
  }

  sendDirect({ address, port }, machineIdentifier, plexCommand, params) {
    const { token, clientIdentifier } = this.getConnection()
    return this.httpGet(`http://${address}:${port}/player/playback/${plexCommand}`, {
      params,
      headers: {
        'X-Plex-Token': token,
        'X-Plex-Target-Client-Identifier': machineIdentifier,
        ...(clientIdentifier && { 'X-Plex-Client-Identifier': clientIdentifier })
      },
      timeout: 4000
    })
  }
}
