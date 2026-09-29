import { createLogger } from '../lib/logger.js'

const log = createLogger('socket')

// 📋 SOCKET.IO - Collega il kiosk al servizio principale.
// Dal server: nowPlaying, authRequired, configUpdated, health
// Dal kiosk: mediaControl, switchUser, resumeFromPause
export function attachSocketHandlers(io, nowPlaying) {
  const forward = event => data => io.emit(event, data)
  nowPlaying.on('nowPlaying', forward('nowPlaying'))
  nowPlaying.on('authRequired', forward('authRequired'))
  nowPlaying.on('configUpdated', () => io.emit('configUpdated', {}))
  nowPlaying.on('health', forward('health'))

  io.on('connection', async socket => {
    log.debug(`Kiosk connesso (${io.engine.clientsCount} in totale)`)

    // Dispositivo non configurato: il kiosk mostra subito il QR
    if (!nowPlaying.isConfigured()) {
      socket.emit('authRequired', { reason: 'not_configured' })
    }
    socket.emit('nowPlaying', await nowPlaying.currentPayload())
    const health = nowPlaying.healthSummary()
    if (health) socket.emit('health', health)

    socket.on('mediaControl', async (data = {}) => {
      // Formato nuovo {command} e vecchio {type}
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

    // Scelta del player dal touch overlay (nome storico: switchUser)
    socket.on('switchUser', async machineIdentifier => {
      await nowPlaying.selectPlayer(machineIdentifier)
    })

    socket.on('error', error => log.debug('Errore socket:', error.message))
    socket.on('disconnect', () => log.debug('Kiosk disconnesso'))
  })
}
