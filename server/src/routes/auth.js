import express from 'express'

const router = express.Router()

let configService = null
let plexAuthService = null
let lastfmLinkService = null
let onConfigUpdated = null

export function setAuthServices(cs, pas, reloadCallback, lls) {
  configService = cs
  plexAuthService = pas
  onConfigUpdated = reloadCallback
  lastfmLinkService = lls
}

// Lo stato attuale: se Plex è già configurato con un token e se Last.fm è
// collegato (per decidere se proporre lo step 2 dopo il login Plex)
router.get('/state', (req, res) => {
  const config = configService.getConfig()
  res.json({
    configured: !!(config.plex?.url && config.plex?.token),
    lastfmConfigured: !!(config.lastfm?.username && lastfmLinkService.getApiKey())
  })
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

// 📋 STEP 2 - COLLEGAMENTO LAST.FM DAL TELEFONO

// Il kiosk chiede un nuovo link e il QR che lo codifica
router.post('/lastfm/link', async (req, res) => {
  try {
    res.json(await lastfmLinkService.createLink())
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

// Il kiosk interroga questo endpoint finché il telefono non ha completato
router.get('/lastfm/link/:token', (req, res) => {
  const link = lastfmLinkService.getLink(req.params.token)
  if (!link) return res.status(404).json({ error: 'Link scaduto' })
  res.json({ done: link.done })
})

// La pagina aperta dal telefono scansionando il QR
router.get('/lastfm/connect', (req, res) => {
  const token = String(req.query.t || '')
  if (!lastfmLinkService.getLink(token)) {
    return res.status(410).send(renderPhonePage({ expired: true }))
  }
  res.send(renderPhonePage({ token, needsApiKey: !lastfmLinkService.getApiKey() }))
})

router.post('/lastfm/connect', express.urlencoded({ extended: false }), async (req, res) => {
  const { t: token, username, apiKey } = req.body
  try {
    const name = await lastfmLinkService.completeLink(token, { username, apiKey })
    if (onConfigUpdated) {
      await onConfigUpdated()
    }
    res.send(renderPhonePage({ doneAs: name }))
  } catch (error) {
    res.status(400).send(renderPhonePage({
      token,
      username,
      needsApiKey: !lastfmLinkService.getApiKey(),
      error: error.message
    }))
  }
})

const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
))

function renderPhonePage({ token, username, needsApiKey, error, doneAs, expired }) {
  let body
  if (expired) {
    body = '<p>Questo link è scaduto. Genera un nuovo QR code dallo schermo.</p>'
  } else if (doneAs) {
    body = `<p class="ok">✓ Last.fm collegato come <strong>${escapeHtml(doneAs)}</strong>.</p>
      <p>Puoi chiudere questa pagina.</p>`
  } else {
    body = `<form method="post" action="/api/auth/lastfm/connect">
        <input type="hidden" name="t" value="${escapeHtml(token)}">
        <label for="username">Username Last.fm</label>
        <input id="username" name="username" value="${escapeHtml(username)}"
          autocapitalize="none" autocorrect="off" autocomplete="username" required autofocus>
        ${needsApiKey ? `<label for="apiKey">API key Last.fm</label>
        <input id="apiKey" name="apiKey" autocapitalize="none" autocorrect="off" required>
        <p class="hint">Si ottiene gratis su last.fm/api/account/create</p>` : ''}
        ${error ? `<p class="error">${escapeHtml(error)}</p>` : ''}
        <button type="submit">Collega</button>
      </form>`
  }

  return `<!doctype html>
<html lang="it">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Collega Last.fm</title>
<style>
  body { margin: 0; font-family: -apple-system, system-ui, sans-serif; background: #111; color: #eee;
    display: flex; justify-content: center; padding: 2rem 1rem; }
  main { width: 100%; max-width: 380px; }
  h1 { font-size: 1.4rem; margin: 0 0 1.5rem; }
  form { display: flex; flex-direction: column; gap: 0.6rem; }
  label { font-size: 0.9rem; color: #aaa; }
  input { font-size: 1.1rem; padding: 0.75rem; border-radius: 8px; border: 1px solid #333;
    background: #1c1c1c; color: #fff; }
  button { margin-top: 0.8rem; font-size: 1.1rem; padding: 0.8rem; border: 0; border-radius: 8px;
    background: #d51007; color: #fff; font-weight: 600; }
  .hint { font-size: 0.8rem; color: #888; margin: 0; }
  .error { color: #ff6b6b; margin: 0; }
  .ok { font-size: 1.1rem; }
</style>
</head>
<body><main><h1>Collega Last.fm</h1>${body}</main></body>
</html>`
}

export default router
