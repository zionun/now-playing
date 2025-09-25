import express from 'express'

const router = express.Router()

// This will be injected by the main server
let plexService = null

export function setPlexService(service) {
  plexService = service
}

// Get current now playing state
router.get('/now-playing', (req, res) => {
  try {
    const state = plexService.getCurrentState()
    res.json(state)
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

// Test Plex connection
router.post('/test-connection', async (req, res) => {
  try {
    const result = await plexService.testConnection()
    res.json(result)
  } catch (error) {
    res.status(400).json({ error: error.message })
  }
})

// Media control actions
router.post('/control/:action', async (req, res) => {
  try {
    const { action } = req.params
    await plexService.mediaControl({ type: action })
    res.json({ success: true })
  } catch (error) {
    res.status(400).json({ error: error.message })
  }
})

export default router