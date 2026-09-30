import express from 'express'
import axios from 'axios'
import { createLogger } from '../lib/logger.js'
import { sendError } from '../lib/errors.js'

const log = createLogger('api')

// 📋 PLEX REST ROUTES: artwork proxy, connection test, playback commands
export function createPlexRouter({ plexClient, nowPlaying, requireSession, getToken }) {
  const router = express.Router()

  // Artwork proxy: the Plex token must never reach the browser. Only relative
  // paths of the configured server, never absolute URLs (SSRF).
  router.get('/art', async (req, res) => {
    const { path: imagePath } = req.query
    if (
      !imagePath ||
      typeof imagePath !== 'string' ||
      !imagePath.startsWith('/') ||
      imagePath.startsWith('//')
    ) {
      return res.status(400).json({ error: 'Invalid image path' })
    }
    if (!plexClient.isConfigured()) {
      return res.status(503).json({ error: 'Plex not configured' })
    }
    try {
      const response = await plexClient.streamArt(imagePath)
      res.set('Content-Type', response.headers['content-type'] || 'image/jpeg')
      res.set('Cache-Control', 'private, max-age=3600')
      response.data.pipe(res)
    } catch (error) {
      log.debug('Artwork not available:', error.message)
      res.status(502).json({ error: "Couldn't get the image from Plex" })
    }
  })

  // Connection test from the /config page. Requires the session: without an
  // explicit token it uses the saved one, which must not be sent to an
  // address chosen by anyone.
  router.post('/plex/test-connection', requireSession, async (req, res) => {
    try {
      const { url, port } = req.body
      const token = req.body.token || getToken()
      if (!url || !token) {
        return sendError(res, 400, 'url_token_required', 'Address and token are required')
      }
      const response = await axios.get(`http://${url}:${port || 32400}/identity`, {
        headers: { 'X-Plex-Token': token, Accept: 'application/json' },
        timeout: 5000
      })
      const server = response.data?.MediaContainer
      res.json({ success: true, server: server?.friendlyName || server?.machineIdentifier || url })
    } catch (error) {
      if (error.response?.status === 401) return sendError(res, 400, 'invalid_token', 'Invalid token')
      res.status(400).json({ error: error.message })
    }
  })

  // Playback command over REST (same effect as the Socket.IO event)
  router.post('/control/:command', async (req, res) => {
    const { sessionKey, machineIdentifier } = req.body || {}
    const result = await nowPlaying.mediaControl(req.params.command, { sessionKey, machineIdentifier })
    res.status(result.success ? 200 : 502).json(result)
  })

  return router
}
