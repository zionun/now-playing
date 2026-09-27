import express from 'express'

const router = express.Router()

let configService = null
let plexAuthService = null
let onConfigUpdated = null

export function setAuthServices(cs, pas, reloadCallback) {
  configService = cs
  plexAuthService = pas
  onConfigUpdated = reloadCallback
}

// Lo stato attuale: se Plex è già configurato con un token
router.get('/state', (req, res) => {
  const config = configService.getConfig()
  res.json({ configured: !!(config.plex?.url && config.plex?.token) })
})

// Avvia il login: crea un PIN Plex e il QR code corrispondente
router.post('/pin', async (req, res) => {
  try {
    const pin = await plexAuthService.createPin()
    res.json(pin)
  } catch (error) {
    console.error('❌ Errore creazione PIN Plex:', error.message)
    res.status(502).json({ error: 'Impossibile contattare plex.tv, riprova tra poco' })
  }
})

// Il client chiama questo endpoint ogni 1-2s finché il PIN non è autorizzato
router.get('/pin/:id', async (req, res) => {
  try {
    const result = await plexAuthService.checkPin(req.params.id)
    res.json(result)
  } catch (error) {
    res.status(400).json({ error: error.message })
  }
})

// L'utente ha scelto (o gli è stato scelto in automatico) un server Plex
// tra quelli visibili sul suo account
router.post('/select-server', async (req, res) => {
  try {
    const { password, url, port, token } = req.body

    const isValidPassword = await configService.verifyConfigPassword(password)
    if (!isValidPassword) {
      return res.status(401).json({ error: 'È impostata una password di configurazione' })
    }
    if (!url || !token) {
      return res.status(400).json({ error: 'Server Plex non valido' })
    }

    await configService.setPlexAuth({ url, port, token })
    if (onConfigUpdated) {
      await onConfigUpdated()
    }

    res.json({ success: true })
  } catch (error) {
    res.status(400).json({ error: error.message })
  }
})

// Disconnette l'account Plex corrente (per rifare il login, es. altro utente)
router.post('/logout', async (req, res) => {
  try {
    const { password } = req.body
    const isValidPassword = await configService.verifyConfigPassword(password)
    if (!isValidPassword) {
      return res.status(401).json({ error: 'Password non corretta' })
    }

    await configService.clearPlexToken()
    if (onConfigUpdated) {
      await onConfigUpdated()
    }

    res.json({ success: true })
  } catch (error) {
    res.status(400).json({ error: error.message })
  }
})

export default router
