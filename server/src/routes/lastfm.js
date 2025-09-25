import express from 'express'
import { LastfmService } from '../services/LastfmService.js'

const router = express.Router()

let lastfmService = null

export function setLastfmService(service) {
  lastfmService = service
}

// Get idle screen data
router.get('/idle-data', async (req, res) => {
  try {
    const data = await lastfmService.getIdleScreenData()
    res.json(data)
  } catch (error) {
    res.status(400).json({ error: error.message })
  }
})

// Test Last.fm connection
router.post('/test-connection', async (req, res) => {
  try {
    const userInfo = await lastfmService.getUserInfo()
    res.json({ 
      success: true, 
      username: userInfo.name,
      playcount: userInfo.playcount 
    })
  } catch (error) {
    res.status(400).json({ error: error.message })
  }
})

export default router