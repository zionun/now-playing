import express from 'express'

// 📋 HEALTH - Plex (reachable? real-time events or polling?), Last.fm and
// known players. Answers 200 when everything is ok or degraded, 503 when
// Plex is not reachable. ?fresh=1 skips the 30-second cache.
export function createHealthRouter({ nowPlaying }) {
  const router = express.Router()

  router.get('/', async (req, res) => {
    const health = await nowPlaying.health({ fresh: req.query.fresh === '1' })
    res.status(health.status === 'error' ? 503 : 200).json(health)
  })

  return router
}
