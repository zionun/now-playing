import axios from 'axios'
import crypto from 'crypto'
import { createLogger } from '../lib/logger.js'

const log = createLogger('lastfm')
const FALLBACK_CACHE_TTL_MS = 30000

export class LastfmService {
  constructor(configService) {
    this.configService = configService
    this.baseUrl = 'http://ws.audioscrobbler.com/2.0/'
    this.fallbackCache = { data: null, fetchedAt: 0 }
    this.lastOkAt = null
    this.lastError = null
  }

  // Configurazione effettiva: la API key può arrivare anche da LASTFM_API_KEY
  config() {
    const config = this.configService.getLastfmConfig()
    return { ...config, apiKey: config.apiKey || process.env.LASTFM_API_KEY || '' }
  }

  isConfigured() {
    const { username, apiKey } = this.config()
    return !!(username && apiKey)
  }

  clearCache() {
    this.fallbackCache = { data: null, fetchedAt: 0 }
  }

  async call(params, timeout = 5000) {
    try {
      const response = await axios.get(this.baseUrl, { params: { ...params, format: 'json' }, timeout })
      this.lastOkAt = Date.now()
      this.lastError = null
      return response.data
    } catch (error) {
      this.lastError = error.response?.data?.message || error.message
      throw error
    }
  }

  // Ultima traccia ascoltata, mostrata come "traccia" quando non suona nulla.
  // In cache per 30s: viene richiesta a ogni aggiornamento dello schermo.
  async getFallbackTrack() {
    if (!this.isConfigured()) {
      return { title: 'Last.fm non configurato', artist: '', album: '', isLastFm: true, isPlaying: false }
    }
    if (this.fallbackCache.data && Date.now() - this.fallbackCache.fetchedAt < FALLBACK_CACHE_TTL_MS) {
      return this.fallbackCache.data
    }
    try {
      const [track] = await this.getRecentTracks(1)
      const data = track
        ? {
            title: track.name || 'Titolo sconosciuto',
            artist: track.artist?.['#text'] || track.artist || '',
            album: track.album?.['#text'] || track.album || '',
            thumb: track.image?.[2]?.['#text'] || null,
            isLastFm: true,
            isPlaying: !!track['@attr']?.nowplaying,
            lastfmUrl: track.url
          }
        : { title: 'Nessuna traccia trovata', artist: this.config().username, album: 'Last.fm', isLastFm: true, isPlaying: false }
      this.fallbackCache = { data, fetchedAt: Date.now() }
      return data
    } catch (error) {
      log.warn('Ultima traccia non disponibile:', this.lastError)
      return { title: 'Last.fm non raggiungibile', artist: '', album: 'Last.fm', isLastFm: true, isPlaying: false }
    }
  }

  async getUserInfo() {
    const config = this.config()
    if (!config.username || !config.apiKey) {
      throw new Error('Last.fm not configured')
    }
    const data = await this.call({ method: 'user.getinfo', user: config.username, api_key: config.apiKey })
    return data.user
  }

  async getRecentTracks(limit = 1) {
    const config = this.config()
    const data = await this.call({ method: 'user.getrecenttracks', user: config.username, api_key: config.apiKey, limit })
    const tracks = data.recenttracks?.track || []
    return Array.isArray(tracks) ? tracks : [tracks]
  }

  async getTopAlbums(period = '7day', limit = 12) {
    const config = this.config()
    const data = await this.call({ method: 'user.gettopalbums', user: config.username, api_key: config.apiKey, period, limit })
    const topAlbums = data.topalbums?.album || []
    
    // Albums are already sorted by playcount from Last.fm server
    const formattedAlbums = topAlbums
      .slice(0, limit)
      .map((album, index) => ({
        name: album.name,
        artist: {
          name: album.artist?.name || album.artist?.['#text'] || album.artist
        },
        image: album.image || [],
        playcount: album.playcount || '0',
        url: album.url || '',
        rank: (index + 1).toString() // Rank based on position in array
      }))
    
    return formattedAlbums
  }

  /**
   * Gets top albums by progressively expanding time periods to fill up to the target limit.
   * This function implements a cascading approach to ensure we always have enough albums:
   * 
   * 1. First, fetch top albums from the last 7 days
   * 2. If we don't have enough albums (< target limit), fetch from 1 month and append unique ones
   * 3. Continue with 3 months, 6 months, 12 months, and overall periods until we reach the target
   * 4. Albums are added in the order returned by each API call, maintaining Last.fm's relevance ranking
   * 5. Duplicates are filtered out based on artist name + album name combination
   * 
   * @param {number} targetLimit - Target number of albums to return (default: 12)
   * @returns {Array} Array of formatted album objects, up to targetLimit length
   */
  async getTopAlbumsWithFallback(targetLimit = 12) {
    const periods = ['7day', '1month', '3month', '6month', '12month', 'overall']
    let allAlbums = []
    const seenAlbums = new Set() // Track unique album+artist combinations
    
    
    for (const period of periods) {
      if (allAlbums.length >= targetLimit) {
        break
      }
      
      const remainingSlots = targetLimit - allAlbums.length
      log.debug(`Album dal periodo ${period} (ne mancano ${remainingSlots})`)
      
      try {
        const periodAlbums = await this.getTopAlbums(period, 50) // Fetch more to increase chances of finding unique ones
        
        for (const album of periodAlbums) {
          if (allAlbums.length >= targetLimit) break
          
          const albumKey = `${album.artist.name}-${album.name}`.toLowerCase()
          
          if (!seenAlbums.has(albumKey)) {
            seenAlbums.add(albumKey)
            allAlbums.push(album)
          }
        }
        
        
      } catch (error) {
        log.debug(`Album del periodo ${period} non disponibili:`, error.message)
        // Continue with next period even if this one fails
      }
    }
    
    return allAlbums.slice(0, targetLimit)
  }

  async getIdleScreenData() {
    try {
      const [userInfo, recentTrack, topAlbums] = await Promise.all([
        this.getUserInfo(),
        this.getRecentTracks(1),
        this.getTopAlbumsWithFallback(12) // Use progressive fallback to ensure we get 12 albums
      ])

      return {
        username: userInfo.name,
        scrobbles: parseInt(userInfo.playcount || 0),
        lastTrack: Array.isArray(recentTrack) ? recentTrack[0] : recentTrack,
        topAlbums: topAlbums // Albums from cascading time periods, ordered by relevance
      }
    } catch (error) {
      log.warn('Dati per la schermata idle non disponibili:', error.message)
      throw error
    }
  }

  async authenticate(username, password) {
    // This is a simplified auth flow - in production you'd want proper OAuth
    const config = this.config()

    const authToken = crypto.createHash('md5')
      .update(username + crypto.createHash('md5').update(password).digest('hex'))
      .digest('hex')

    const params = {
      method: 'auth.getMobileSession',
      username,
      authToken,
      api_key: config.apiKey,
      format: 'json'
    }

    // Add API signature
    const signature = this.generateSignature(params, config.apiSecret)
    params.api_sig = signature

    const response = await axios.post(this.baseUrl, new URLSearchParams(params))
    
    if (response.data.error) {
      throw new Error(response.data.message || 'Authentication failed')
    }

    return response.data.session
  }

  generateSignature(params, secret) {
    const sortedParams = Object.keys(params)
      .filter(key => key !== 'format')
      .sort()
      .map(key => `${key}${params[key]}`)
      .join('')

    return crypto.createHash('md5')
      .update(sortedParams + secret)
      .digest('hex')
  }
}