import express from 'express'

const router = express.Router()

let configService = null
let onConfigUpdated = null
let setupService = null

export function setConfigService(service, reloadCallback = null, deviceSetupService = null) {
  configService = service
  onConfigUpdated = reloadCallback
  setupService = deviceSetupService
}

// Tutta la configurazione richiede la sessione aperta con la password
router.use((req, res, next) => setupService.requireSession(req, res, next))

// Get configuration (excluding sensitive data)
router.get('/', (req, res) => {
  try {
    const config = configService.getConfig()
    
    // Remove sensitive data before sending
    const safeConfig = {
      plex: {
        url: config.plex?.url || '',
        port: config.plex?.port || 32400,
        token: config.plex?.token ? '***' : '',
        serverName: config.plex?.serverName || '',
        preferredUser: config.plex?.preferredUser
      },
      lastfm: {
        username: config.lastfm?.username || '',
        apiKey: config.lastfm?.apiKey ? '***' : '',
        apiSecret: config.lastfm?.apiSecret ? '***' : '',
        sessionKey: config.lastfm?.sessionKey ? '***' : ''
      },
      display: config.display,
      hasPassword: !!config.users?.configPassword
    }
    
    res.json(safeConfig)
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

// Update configuration
router.post('/', async (req, res) => {
  try {
    const { config: newConfig } = req.body

    // La password si cambia solo da /api/auth/password/change
    const { users, ...rest } = newConfig || {}
    await configService.updateConfig(rest)

    // Applica subito le modifiche (URL/token Plex, chiavi Last.fm...) senza
    // richiedere un riavvio del processo.
    if (onConfigUpdated) {
      await onConfigUpdated()
    }

    res.json({ success: true })
  } catch (error) {
    res.status(400).json({ error: error.message })
  }
})

export default router