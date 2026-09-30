import express from 'express'
import { sendError, sendRouteError } from '../lib/errors.js'
import { createLogger } from '../lib/logger.js'

const log = createLogger('auth')
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

// Plex sends the browser back to this address after the login: it must be a
// page of this app, not any website.
function safeForwardUrl(value) {
  try {
    const url = new URL(value)
    return ['http:', 'https:'].includes(url.protocol) ? url.toString() : undefined
  } catch {
    return undefined
  }
}

const passwordTooShort = res =>
  sendError(
    res,
    400,
    'password_too_short',
    `The password must be at least ${MIN_PASSWORD_LENGTH} characters long`,
    { min: MIN_PASSWORD_LENGTH }
  )

const wrongAccount = (res, username) =>
  sendError(
    res,
    403,
    'wrong_plex_account',
    `The Plex account "${username}" is not the one bound to the device`,
    {
      username
    }
  )

// 📋 STATE - Used by the kiosk (show the setup QR code?) and by the phone
// pages (which steps are missing?)
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

// QR code shown by the kiosk: initial setup or general settings
router.post('/qr', async (req, res) => {
  try {
    const path = req.body?.target === 'config' ? '/config' : '/setup'
    res.json(await setupService.createQr(path))
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

// 📋 PASSWORD

// First run: create the password (only if none exists yet)
router.post('/password', async (req, res) => {
  try {
    if (configService.hasConfigPassword()) {
      return sendError(res, 409, 'password_exists', 'The password has already been set')
    }
    const password = String(req.body?.password || '')
    if (password.length < MIN_PASSWORD_LENGTH) return passwordTooShort(res)
    await configService.setConfigPassword(password)
    res.json({ session: setupService.createSession() })
  } catch (error) {
    sendRouteError(res, error)
  }
})

router.post('/login', async (req, res) => {
  try {
    if (!configService.hasConfigPassword()) {
      return res
        .status(409)
        .json({ error: 'The password has not been set yet', code: 'password_not_set', needsSetup: true })
    }
    const valid = await configService.verifyConfigPassword(String(req.body?.password || ''))
    if (!valid) return sendError(res, 401, 'wrong_password', 'Wrong password')
    res.json({ session: setupService.createSession() })
  } catch (error) {
    sendRouteError(res, error)
  }
})

router.post('/password/change', requireSession, async (req, res) => {
  try {
    const password = String(req.body?.password || '')
    if (password.length < MIN_PASSWORD_LENGTH) return passwordTooShort(res)
    await configService.setConfigPassword(password)
    // Other sessions opened with the old password are no longer valid
    setupService.clearSessions()
    res.json({ session: setupService.createSession() })
  } catch (error) {
    sendRouteError(res, error)
  }
})

// "Forgot password": log in to Plex again with the account that set up the
// device; if it matches, a session is opened to choose a new password.
router.post('/reset/pin', async (req, res) => {
  try {
    if (!configService.getConfig().plex?.accountId) {
      return sendError(res, 409, 'no_bound_account', 'No Plex account is bound to this device')
    }
    res.json(await plexAuthService.createPin(safeForwardUrl(req.body?.forwardUrl)))
  } catch (error) {
    log.warn('Plex PIN not created:', error.message)
    sendError(res, 502, 'plex_unreachable', "Can't reach plex.tv, please try again shortly")
  }
})

router.get('/reset/pin/:id', async (req, res) => {
  try {
    const status = await plexAuthService.checkPin(req.params.id)
    if (!status.authenticated) return res.json({ authenticated: false })

    const { account } = plexAuthService.consumePin(req.params.id)
    if (account.id !== configService.getConfig().plex?.accountId) {
      return wrongAccount(res, account.username)
    }
    res.json({ authenticated: true, session: setupService.createSession() })
  } catch (error) {
    sendRouteError(res, error)
  }
})

// 📋 PLEX (session required)

router.post('/plex/pin', requireSession, async (req, res) => {
  try {
    res.json(await plexAuthService.createPin(safeForwardUrl(req.body?.forwardUrl)))
  } catch (error) {
    log.warn('Plex PIN not created:', error.message)
    sendError(res, 502, 'plex_unreachable', "Can't reach plex.tv, please try again shortly")
  }
})

router.get('/plex/pin/:id', requireSession, async (req, res) => {
  try {
    res.json(await plexAuthService.checkPin(req.params.id))
  } catch (error) {
    sendRouteError(res, error)
  }
})

router.post('/plex/select', requireSession, async (req, res) => {
  try {
    const { pinId, machineIdentifier } = req.body || {}
    const { account, servers } = plexAuthService.consumePin(pinId)

    // Once set up, the device stays bound to its Plex account: reconnecting
    // or changing server is only possible with that same account.
    const boundAccountId = configService.getConfig().plex?.accountId
    if (boundAccountId && account.id !== boundAccountId) {
      return wrongAccount(res, account.username)
    }

    const server = servers.find(s => s.machineIdentifier === machineIdentifier)
    if (!server) return sendError(res, 400, 'invalid_server', 'Invalid Plex server')

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
    sendRouteError(res, error)
  }
})

router.post('/plex/disconnect', requireSession, async (req, res) => {
  try {
    await configService.clearPlexToken()
    await applyConfig()
    res.json({ success: true })
  } catch (error) {
    sendRouteError(res, error)
  }
})

// 📋 DEVICE RESET (session and the password again)
// Wipes the whole configuration: the kiosk goes back to the setup QR code and
// the device can be bound to another Plex account.
router.post('/reset-device', requireSession, async (req, res) => {
  try {
    const valid = await configService.verifyConfigPassword(String(req.body?.password || ''))
    if (!valid) return sendError(res, 401, 'wrong_password', 'Wrong password')
    await configService.resetToDefaults()
    setupService.clearSessions()
    await applyConfig()
    res.json({ success: true })
  } catch (error) {
    sendRouteError(res, error)
  }
})

// 📋 LAST.FM (session required)

router.post('/lastfm', requireSession, async (req, res) => {
  try {
    const username = String(req.body?.username || '').trim()
    const apiKey = String(req.body?.apiKey || '').trim() || setupService.getLastfmApiKey()

    // Empty username = unlink Last.fm
    if (!username) {
      await configService.updateConfig({ lastfm: { username: '' } })
      await applyConfig()
      return res.json({ success: true, username: '' })
    }
    if (!apiKey) {
      return sendError(res, 400, 'lastfm_api_key_required', 'A Last.fm API key is required')
    }

    const name = await setupService.validateLastfmUser(username, apiKey)
    await configService.updateConfig({ lastfm: { username: name, apiKey } })
    await applyConfig()
    res.json({ success: true, username: name })
  } catch (error) {
    sendRouteError(res, error)
  }
})

// The service is injected after the routes are imported: the middleware
// resolves it on every request.
function requireSession(req, res, next) {
  return setupService.requireSession(req, res, next)
}

export default router
