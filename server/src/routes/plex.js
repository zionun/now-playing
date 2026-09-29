import express from 'express'
import axios from 'axios'
import { createLogger } from '../lib/logger.js'

const log = createLogger('api')

// 📋 ROUTE REST LEGATE A PLEX: proxy copertine, test di connessione, comandi
export function createPlexRouter({ plexClient, nowPlaying, requireSession, getToken }) {
  const router = express.Router()

  // Proxy delle copertine: il token Plex non deve mai raggiungere il browser.
  // Solo percorsi relativi del server configurato, mai URL assoluti (SSRF).
  router.get('/art', async (req, res) => {
    const { path: imagePath } = req.query
    if (!imagePath || typeof imagePath !== 'string' || !imagePath.startsWith('/') || imagePath.startsWith('//')) {
      return res.status(400).json({ error: 'Percorso immagine non valido' })
    }
    if (!plexClient.isConfigured()) {
      return res.status(503).json({ error: 'Plex non configurato' })
    }
    try {
      const response = await plexClient.streamArt(imagePath)
      res.set('Content-Type', response.headers['content-type'] || 'image/jpeg')
      res.set('Cache-Control', 'private, max-age=3600')
      response.data.pipe(res)
    } catch (error) {
      log.debug('Copertina non disponibile:', error.message)
      res.status(502).json({ error: 'Impossibile recuperare l\'immagine da Plex' })
    }
  })

  // Test di connessione dal pannello /config. Richiede la sessione: senza
  // token esplicito usa quello salvato, che non deve poter essere inviato a
  // un indirizzo scelto da chiunque.
  router.post('/plex/test-connection', requireSession, async (req, res) => {
    try {
      const { url, port } = req.body
      const token = req.body.token || getToken()
      if (!url || !token) {
        return res.status(400).json({ error: 'URL e token sono obbligatori' })
      }
      const response = await axios.get(`http://${url}:${port || 32400}/identity`, {
        headers: { 'X-Plex-Token': token, 'Accept': 'application/json' },
        timeout: 5000
      })
      const server = response.data?.MediaContainer
      res.json({ success: true, server: server?.friendlyName || server?.machineIdentifier || url })
    } catch (error) {
      res.status(400).json({ error: error.response?.status === 401 ? 'Token non valido' : error.message })
    }
  })

  // Comando di riproduzione via REST (stesso effetto dell'evento Socket.IO)
  router.post('/control/:command', async (req, res) => {
    const { sessionKey, machineIdentifier } = req.body || {}
    const result = await nowPlaying.mediaControl(req.params.command, { sessionKey, machineIdentifier })
    res.status(result.success ? 200 : 502).json(result)
  })

  return router
}
