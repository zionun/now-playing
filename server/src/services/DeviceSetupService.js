import axios from 'axios'
import crypto from 'crypto'
import os from 'os'
import QRCode from 'qrcode'

// 📋 CONFIGURAZIONE DAL TELEFONO - Il kiosk mostra un QR che apre sul
// telefono la configurazione iniziale (/setup) o quella generale (/config).
// Ogni accesso richiede la password del dispositivo, che apre una sessione
// temporanea: le chiamate successive si autenticano con quella.
const LASTFM_API = 'http://ws.audioscrobbler.com/2.0/'
const SESSION_TTL_MS = 30 * 60 * 1000

export class DeviceSetupService {
  constructor(configService) {
    this.configService = configService
    // Sessioni attive: token -> { expiresAt }
    this.sessions = new Map()
  }

  createSession() {
    const token = crypto.randomBytes(24).toString('hex')
    this.sessions.set(token, { expiresAt: Date.now() + SESSION_TTL_MS })
    return token
  }

  // Valida la sessione e ne rinnova la scadenza (scade solo se inattiva)
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

  // Dopo un cambio password le sessioni aperte non devono restare valide
  clearSessions() {
    this.sessions.clear()
  }

  // Middleware Express: richiede l'header X-Config-Session
  requireSession = (req, res, next) => {
    if (this.isValidSession(req.get('X-Config-Session'))) return next()
    res.status(401).json({ error: 'Sessione scaduta: inserisci di nuovo la password', sessionExpired: true })
  }

  // Il telefono deve raggiungere il server sulla rete locale: localhost non
  // va bene, serve l'IP LAN di questa macchina.
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

  // La API key Last.fm: da configurazione oppure dalla variabile d'ambiente
  getLastfmApiKey() {
    return this.configService.getConfig().lastfm?.apiKey || process.env.LASTFM_API_KEY || ''
  }

  // Verifica che lo username esista davvero prima di salvarlo; restituisce
  // il nome con le maiuscole corrette secondo Last.fm.
  async validateLastfmUser(username, apiKey) {
    try {
      const response = await axios.get(LASTFM_API, {
        params: { method: 'user.getinfo', user: username, api_key: apiKey, format: 'json' },
        timeout: 8000
      })
      return response.data.user?.name || username
    } catch (error) {
      const code = error.response?.data?.error
      if (code === 6) throw new Error('Utente Last.fm non trovato')
      if (code === 10 || code === 26) throw new Error('API key Last.fm non valida')
      throw new Error('Impossibile contattare Last.fm, riprova')
    }
  }
}
