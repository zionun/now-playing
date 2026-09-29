import express from 'express'

// 📋 STATO DI SALUTE - Plex (raggiungibile? eventi in tempo reale o polling?),
// Last.fm e player noti. Risponde 200 se tutto è ok o degradato, 503 se Plex
// non è raggiungibile. ?fresh=1 ignora la cache di 30 secondi.
export function createHealthRouter({ nowPlaying }) {
  const router = express.Router()

  router.get('/', async (req, res) => {
    const health = await nowPlaying.health({ fresh: req.query.fresh === '1' })
    res.status(health.status === 'error' ? 503 : 200).json(health)
  })

  return router
}
