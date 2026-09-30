import axios from 'axios'
import { createLogger } from '../lib/logger.js'

const log = createLogger('playback')

// Kiosk commands → Plex commands
const PLEX_COMMANDS = {
  play: 'play',
  pause: 'pause',
  stop: 'stop',
  next: 'skipNext',
  previous: 'skipPrevious',
  skipNext: 'skipNext',
  skipPrevious: 'skipPrevious'
}

// 📋 PLAYBACK CONTROL
// First through the Plex server (X-Plex-Target-Client-Identifier), which
// also works for players outside the LAN; then, if the player accepts
// direct commands, with a call to its own port (usually 32500).
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
    if (!plexCommand) return { success: false, error: `Unknown command: ${command}`, code: 'unknown_command' }
    if (!machineIdentifier) return { success: false, error: 'No player to control', code: 'no_player' }

    const player = this.directory.get(machineIdentifier)
    const params = {
      type: 'music',
      commandID: ++this.commandId,
      ...(sessionKey && { sessionKey })
    }

    const attempts = []
    if (player?.viaServer)
      attempts.push([
        'server',
        () => this.plexClient.sendPlayerCommand(machineIdentifier, plexCommand, params)
      ])
    if (player?.direct)
      attempts.push(['direct', () => this.sendDirect(player.direct, machineIdentifier, plexCommand, params)])
    // Player unknown to the directory: a try through the server costs little
    if (attempts.length === 0)
      attempts.push([
        'server',
        () => this.plexClient.sendPlayerCommand(machineIdentifier, plexCommand, params)
      ])

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

    // No route worked: controls hidden for a while
    this.directory.markFailed(machineIdentifier)
    log.warn(`${command} failed on ${player?.name || machineIdentifier} (${errors.join('; ')})`)
    return {
      success: false,
      error: "The player doesn't accept commands",
      code: 'player_rejected',
      details: errors
    }
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
