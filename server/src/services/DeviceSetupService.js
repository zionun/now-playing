import axios from 'axios'
import crypto from 'crypto'
import os from 'os'
import QRCode from 'qrcode'
import { AppError } from '../lib/errors.js'

// 📋 SETUP FROM THE PHONE - The kiosk shows a QR code that opens the initial
// setup (/setup) or the general settings (/config) on the phone. Every
// access requires the device password, which opens a temporary session: the
// following calls authenticate with it.
const LASTFM_API = 'http://ws.audioscrobbler.com/2.0/'
const SESSION_TTL_MS = 30 * 60 * 1000

export class DeviceSetupService {
  constructor(configService) {
    this.configService = configService
    // Active sessions: token -> { expiresAt }
    this.sessions = new Map()
  }

  createSession() {
    const token = crypto.randomBytes(24).toString('hex')
    this.sessions.set(token, { expiresAt: Date.now() + SESSION_TTL_MS })
    return token
  }

  // Validates the session and extends it (it only expires when idle)
  isValidSession(token) {
    const now = Date.now()
    for (const [key, session] of this.sessions) {
      if (session.expiresAt < now) this.sessions.delete(key)
    }
    const session = token && this.sessions.get(String(token))
    if (!session) return false
    session.expiresAt = now + SESSION_TTL_MS
    return true
  }

  // After a password change, open sessions must not stay valid
  clearSessions() {
    this.sessions.clear()
  }

  // Express middleware: requires the X-Config-Session header
  requireSession = (req, res, next) => {
    if (this.isValidSession(req.get('X-Config-Session'))) return next()
    res.status(401).json({
      error: 'Session expired: enter the password again',
      code: 'session_expired',
      sessionExpired: true
    })
  }

  // The phone must reach the server on the local network: localhost won't
  // do, this machine's LAN address is needed.
  getLanAddress() {
    const candidates = Object.values(os.networkInterfaces())
      .flat()
      .filter(i => i && i.family === 'IPv4' && !i.internal)
      .map(i => i.address)
    const isPrivate = a => /^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(a)
    return (
      candidates.find(a => a.startsWith('192.168.')) ||
      candidates.find(isPrivate) ||
      candidates[0] ||
      'localhost'
    )
  }

  getBaseUrl() {
    return `http://${this.getLanAddress()}:${process.env.PORT || 3001}`
  }

  async createQr(path) {
    const url = `${this.getBaseUrl()}${path}`
    const qrDataUrl = await QRCode.toDataURL(url, { margin: 1, width: 400 })
    return { url, qrDataUrl }
  }

  // The Last.fm API key: from the configuration or the environment
  getLastfmApiKey() {
    return this.configService.getConfig().lastfm?.apiKey || process.env.LASTFM_API_KEY || ''
  }

  // Checks that the username really exists before saving it; returns the
  // name with the capitalization used by Last.fm.
  async validateLastfmUser(username, apiKey) {
    try {
      const response = await axios.get(LASTFM_API, {
        params: { method: 'user.getinfo', user: username, api_key: apiKey, format: 'json' },
        timeout: 8000
      })
      return response.data.user?.name || username
    } catch (error) {
      const code = error.response?.data?.error
      if (code === 6) throw new AppError('lastfm_user_not_found', 'Last.fm user not found')
      if (code === 10 || code === 26) throw new AppError('lastfm_invalid_api_key', 'Invalid Last.fm API key')
      throw new AppError('lastfm_unreachable', "Can't reach Last.fm, please try again")
    }
  }
}
