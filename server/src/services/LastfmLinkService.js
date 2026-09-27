import axios from 'axios'
import crypto from 'crypto'
import os from 'os'
import QRCode from 'qrcode'

// 📋 COLLEGAMENTO LAST.FM DAL TELEFONO - Il kiosk mostra un QR che apre sul
// telefono una piccola pagina servita da questo server, con un campo per lo
// username Last.fm: niente OAuth e niente digitazione sul touch screen.
// Il kiosk interroga il server finché il telefono non ha salvato lo username.
const LASTFM_API = 'http://ws.audioscrobbler.com/2.0/'
const LINK_TTL_MS = 15 * 60 * 1000

export class LastfmLinkService {
  constructor(configService) {
    this.configService = configService
    // Collegamenti in attesa: token -> { createdAt, done }
    this.pendingLinks = new Map()
  }

  // La API key dell'app: da /config oppure dalla variabile d'ambiente
  getApiKey() {
    return this.configService.getConfig().lastfm?.apiKey || process.env.LASTFM_API_KEY || ''
  }

  // Il telefono deve raggiungere il server sulla rete locale: localhost non
  // va bene, serve l'IP LAN di questa macchina.
  getLanAddress() {
    const candidates = Object.values(os.networkInterfaces())
      .flat()
      .filter(i => i && i.family === 'IPv4' && !i.internal)
      .map(i => i.address)
    const isPrivate = a => /^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(a)
    return candidates.find(a => a.startsWith('192.168.')) ||
      candidates.find(isPrivate) ||
      candidates[0] ||
      'localhost'
  }

  cleanupExpired() {
    const now = Date.now()
    for (const [token, link] of this.pendingLinks) {
      if (now - link.createdAt > LINK_TTL_MS) this.pendingLinks.delete(token)
    }
  }

  async createLink() {
    this.cleanupExpired()
    const token = crypto.randomBytes(16).toString('hex')
    this.pendingLinks.set(token, { createdAt: Date.now(), done: false })

    const port = process.env.PORT || 3001
    const url = `http://${this.getLanAddress()}:${port}/api/auth/lastfm/connect?t=${token}`
    const qrDataUrl = await QRCode.toDataURL(url, { margin: 1, width: 320 })

    return { token, url, qrDataUrl }
  }

  getLink(token) {
    this.cleanupExpired()
    return this.pendingLinks.get(String(token)) || null
  }

  // Verifica che lo username esista davvero prima di salvarlo; restituisce
  // il nome con le maiuscole corrette secondo Last.fm.
  async validateUsername(username, apiKey) {
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

  async completeLink(token, { username, apiKey }) {
    const link = this.getLink(token)
    if (!link) throw new Error('Link scaduto: genera un nuovo QR code dallo schermo')

    const cleanUsername = (username || '').trim()
    const key = (apiKey || '').trim() || this.getApiKey()
    if (!cleanUsername) throw new Error('Inserisci lo username Last.fm')
    if (!key) throw new Error('Serve una API key Last.fm')

    const name = await this.validateUsername(cleanUsername, key)
    await this.configService.updateConfig({ lastfm: { username: name, apiKey: key } })

    link.done = true
    return name
  }
}
