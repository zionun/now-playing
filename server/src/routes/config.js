import express from 'express'

const router = express.Router()

let configService = null
let onConfigUpdated = null
let setupService = null
let getFilterOptions = null
let isScreenSleepAvailable = () => false

export function setConfigService(
  service,
  reloadCallback = null,
  deviceSetupService = null,
  filterOptions = null,
  screenSleepAvailable = null
) {
  configService = service
  onConfigUpdated = reloadCallback
  setupService = deviceSetupService
  getFilterOptions = filterOptions
  if (screenSleepAvailable) isScreenSleepAvailable = screenSleepAvailable
}

// All settings require the session opened with the password
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
        serverName: config.plex?.serverName || ''
      },
      filters: config.filters,
      lastfm: {
        username: config.lastfm?.username || '',
        apiKey: config.lastfm?.apiKey ? '***' : '',
        apiSecret: config.lastfm?.apiSecret ? '***' : '',
        sessionKey: config.lastfm?.sessionKey ? '***' : ''
      },
      display: config.display,
      // Screen sleep needs a HyperPixel 4.0 Square (backlight control)
      screenSleepAvailable: isScreenSleepAvailable(),
      hasPassword: !!config.users?.configPassword
    }

    res.json(safeConfig)
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

// Filter options: users of the Plex server and known players (from the
// server, plex.tv, the local network and recently seen sessions)
router.get('/filter-options', async (req, res) => {
  try {
    res.json(await getFilterOptions())
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

// Update configuration
router.post('/', async (req, res) => {
  try {
    const { config: newConfig } = req.body

    // The password can only be changed through /api/auth/password/change
    const { users, ...rest } = newConfig || {}
    await configService.updateConfig(rest)

    // Apply the changes (Plex URL/token, Last.fm keys...) right away, without
    // restarting the process.
    if (onConfigUpdated) {
      await onConfigUpdated()
    }

    res.json({ success: true })
  } catch (error) {
    res.status(400).json({ error: error.message })
  }
})

export default router
