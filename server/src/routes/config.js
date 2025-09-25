import express from 'express'

const router = express.Router()

let configService = null

export function setConfigService(service) {
  configService = service
}

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
    const { password, config: newConfig } = req.body
    
    // Verify password if one is set
    const isValidPassword = await configService.verifyConfigPassword(password)
    if (!isValidPassword) {
      return res.status(401).json({ error: 'Invalid password' })
    }
    
    await configService.updateConfig(newConfig)
    res.json({ success: true })
  } catch (error) {
    res.status(400).json({ error: error.message })
  }
})

// Verify password
router.post('/verify-password', async (req, res) => {
  try {
    const { password } = req.body
    const isValid = await configService.verifyConfigPassword(password)
    res.json({ valid: isValid })
  } catch (error) {
    res.status(400).json({ error: error.message })
  }
})

export default router