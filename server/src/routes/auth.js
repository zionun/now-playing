import express from 'express'

const router = express.Router()

let configService = null
let plexAuthService = null
let setupService = null
let onConfigUpdated = null

export function setAuthServices(cs, pas, reloadCallback, dss) {
  configService = cs
  plexAuthService = pas
  onConfigUpdated = reloadCallback
  setupService = dss
}

const MIN_PASSWORD_LENGTH = 4

async function applyConfig() {
  if (onConfigUpdated) {
    await onConfigUpdated()
  }
}

// Plex rimanda il browser a questo indirizzo dopo l'accesso: deve essere
// una pagina di questa app, non un sito qualsiasi.
function safeForwardUrl(value) {
  try {
    const url = new URL(value)
    return ['http:', 'https:'].includes(url.protocol) ? url.toString() : undefined
  } catch {
    return undefined
  }
}

// 📋 STATO - Usato dal kiosk (mostrare il QR di configurazione iniziale?) e
// dalle pagine sul telefono (quali step mancano?)
router.get('/state', (req, res) => {
  const config = configService.getConfig()
  const hasPassword = configService.hasConfigPassword()
  const plexConnected = !!(config.plex?.url && config.plex?.token)
  res.json({
    hasPassword,
    plexConnected,
    plexServerName: config.plex?.serverName || '',
    canResetPassword: !!config.plex?.accountId,
    lastfmConfigured: !!(config.lastfm?.username && setupService.getLastfmApiKey()),
    lastfmUsername: config.lastfm?.username || '',
    hasLastfmApiKey: !!setupService.getLastfmApiKey(),
    setupComplete: hasPassword && plexConnected
  })
})

// QR mostrato dal kiosk: configurazione iniziale o configurazione generale
router.post('/qr', async (req, res) => {
  try {
    const path = req.body?.target === 'config' ? '/config' : '/setup'
    res.json(await setupService.createQr(path))
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

// 📋 PASSWORD

// Prima configurazione: crea la password (possibile solo se non esiste)
router.post('/password', async (req, res) => {
  try {
    if (configService.hasConfigPassword()) {
      return res.status(409).json({ error: 'La password è già stata impostata' })
    }
    const password = String(req.body?.password || '')
    if (password.length < MIN_PASSWORD_LENGTH) {
      return res.status(400).json({ error: `La password deve avere almeno ${MIN_PASSWORD_LENGTH} caratteri` })
    }
    await configService.setConfigPassword(password)
    res.json({ session: setupService.createSession() })
  } catch (error) {
    res.status(400).json({ error: error.message })
  }
})

router.post('/login', async (req, res) => {
  try {
    if (!configService.hasConfigPassword()) {
      return res.status(409).json({ error: 'Password non ancora impostata', needsSetup: true })
    }
    const valid = await configService.verifyConfigPassword(String(req.body?.password || ''))
    if (!valid) {
      return res.status(401).json({ error: 'Password non corretta' })
    }
    res.json({ session: setupService.createSession() })
  } catch (error) {
    res.status(400).json({ error: error.message })
  }
})

router.post('/password/change', requireSession, async (req, res) => {
  try {
    const password = String(req.body?.password || '')
    if (password.length < MIN_PASSWORD_LENGTH) {
      return res.status(400).json({ error: `La password deve avere almeno ${MIN_PASSWORD_LENGTH} caratteri` })
    }
    await configService.setConfigPassword(password)
    // Le altre sessioni aperte con la vecchia password non valgono più
    setupService.clearSessions()
    res.json({ session: setupService.createSession() })
  } catch (error) {
    res.status(400).json({ error: error.message })
  }
})

// "Password dimenticata": si rifà l'accesso a Plex con lo stesso account
// che ha configurato il dispositivo; se coincide si apre una sessione per
// impostare una nuova password.
router.post('/reset/pin', async (req, res) => {
  try {
    if (!configService.getConfig().plex?.accountId) {
      return res.status(409).json({ error: 'Nessun account Plex associato al dispositivo' })
    }
    res.json(await plexAuthService.createPin(safeForwardUrl(req.body?.forwardUrl)))
  } catch (error) {
    res.status(502).json({ error: 'Impossibile contattare plex.tv, riprova tra poco' })
  }
})

router.get('/reset/pin/:id', async (req, res) => {
  try {
    const status = await plexAuthService.checkPin(req.params.id)
    if (!status.authenticated) return res.json({ authenticated: false })

    const { account } = plexAuthService.consumePin(req.params.id)
    if (account.id !== configService.getConfig().plex?.accountId) {
      return res.status(403).json({
        error: `L'account Plex "${account.username}" non è quello usato per configurare il dispositivo`
      })
    }
    res.json({ authenticated: true, session: setupService.createSession() })
  } catch (error) {
    res.status(400).json({ error: error.message })
  }
})

// 📋 PLEX (richiede sessione)

router.post('/plex/pin', requireSession, async (req, res) => {
  try {
    res.json(await plexAuthService.createPin(safeForwardUrl(req.body?.forwardUrl)))
  } catch (error) {
    console.error('❌ Errore creazione PIN Plex:', error.message)
    res.status(502).json({ error: 'Impossibile contattare plex.tv, riprova tra poco' })
  }
})

router.get('/plex/pin/:id', requireSession, async (req, res) => {
  try {
    res.json(await plexAuthService.checkPin(req.params.id))
  } catch (error) {
    res.status(400).json({ error: error.message })
  }
})

router.post('/plex/select', requireSession, async (req, res) => {
  try {
    const { pinId, machineIdentifier } = req.body || {}
    const { account, servers } = plexAuthService.consumePin(pinId)

    // Una volta configurato, il dispositivo resta legato al suo account
    // Plex: ricollegarsi o cambiare server è possibile solo con lo stesso.
    const boundAccountId = configService.getConfig().plex?.accountId
    if (boundAccountId && account.id !== boundAccountId) {
      return res.status(403).json({
        error: `L'account Plex "${account.username}" non è quello usato per configurare il dispositivo`
      })
    }

    const server = servers.find(s => s.machineIdentifier === machineIdentifier)
    if (!server) {
      return res.status(400).json({ error: 'Server Plex non valido' })
    }

    await configService.setPlexAuth({
      url: server.url,
      port: server.port,
      token: server.accessToken,
      accountId: account.id,
      serverName: server.name,
      machineIdentifier: server.machineIdentifier
    })
    await applyConfig()

    res.json({ success: true, serverName: server.name })
  } catch (error) {
    res.status(400).json({ error: error.message })
  }
})

router.post('/plex/disconnect', requireSession, async (req, res) => {
  try {
    await configService.clearPlexToken()
    await applyConfig()
    res.json({ success: true })
  } catch (error) {
    res.status(400).json({ error: error.message })
  }
})

// 📋 RIPRISTINO DEL DISPOSITIVO (richiede sessione e di nuovo la password)
// Azzera tutta la configurazione: il kiosk torna al QR di configurazione
// iniziale e il dispositivo può essere legato a un altro account Plex.
router.post('/reset-device', requireSession, async (req, res) => {
  try {
    const valid = await configService.verifyConfigPassword(String(req.body?.password || ''))
    if (!valid) {
      return res.status(401).json({ error: 'Password non corretta' })
    }
    await configService.resetToDefaults()
    setupService.clearSessions()
    await applyConfig()
    res.json({ success: true })
  } catch (error) {
    res.status(400).json({ error: error.message })
  }
})

// 📋 LAST.FM (richiede sessione)

router.post('/lastfm', requireSession, async (req, res) => {
  try {
    const username = String(req.body?.username || '').trim()
    const apiKey = String(req.body?.apiKey || '').trim() || setupService.getLastfmApiKey()

    // Username vuoto = scollega Last.fm
    if (!username) {
      await configService.updateConfig({ lastfm: { username: '' } })
      await applyConfig()
      return res.json({ success: true, username: '' })
    }
    if (!apiKey) {
      return res.status(400).json({ error: 'Serve una API key Last.fm' })
    }

    const name = await setupService.validateLastfmUser(username, apiKey)
    await configService.updateConfig({ lastfm: { username: name, apiKey } })
    await applyConfig()
    res.json({ success: true, username: name })
  } catch (error) {
    res.status(400).json({ error: error.message })
  }
})

// Il servizio viene iniettato dopo l'import delle route: il middleware lo
// risolve a ogni richiesta.
function requireSession(req, res, next) {
  return setupService.requireSession(req, res, next)
}

export default router
