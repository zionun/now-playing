import { createLogger } from '../lib/logger.js'

const log = createLogger('socket')

// 📋 SOCKET.IO - Connects the kiosk to the main service.
// From the server: nowPlaying, authRequired, configUpdated, health
// From the kiosk: mediaControl, switchUser, resumeFromPause
export function attachSocketHandlers(io, nowPlaying) {
  const forward = event => data => io.emit(event, data)
  nowPlaying.on('nowPlaying', forward('nowPlaying'))
  nowPlaying.on('authRequired', forward('authRequired'))
  nowPlaying.on('configUpdated', () => io.emit('configUpdated', {}))
  nowPlaying.on('health', forward('health'))

  io.on('connection', async socket => {
    log.debug(`Kiosk connected (${io.engine.clientsCount} in total)`)

    // Device not set up: the kiosk shows the QR code right away
    if (!nowPlaying.isConfigured()) {
      socket.emit('authRequired', { reason: 'not_configured' })
    }
    socket.emit('nowPlaying', await nowPlaying.currentPayload())
    const health = nowPlaying.healthSummary()
    if (health) socket.emit('health', health)

    socket.on('mediaControl', async (data = {}) => {
      // New {command} and old {type} formats
      const command = data.command || data.type
      const result = await nowPlaying.mediaControl(command, {
        sessionKey: data.sessionKey,
        machineIdentifier: data.machineIdentifier
      })
      socket.emit('mediaControlResponse', result)
    })

    socket.on('resumeFromPause', async () => {
      socket.emit('resumeResponse', await nowPlaying.resume())
    })

    // Player chosen from the touch overlay (historical name: switchUser)
    socket.on('switchUser', async machineIdentifier => {
      await nowPlaying.selectPlayer(machineIdentifier)
    })

    socket.on('error', error => log.debug('Socket error:', error.message))
    socket.on('disconnect', () => log.debug('Kiosk disconnected'))
  })
}
