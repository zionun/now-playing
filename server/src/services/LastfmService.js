import axios from 'axios'
import crypto from 'crypto'

export class LastfmService {
  constructor(configService) {
    this.configService = configService
    this.baseUrl = 'http://ws.audioscrobbler.com/2.0/'
  }

  async getUserInfo() {
    const config = this.configService.getLastfmConfig()
    
    if (!config.username || !config.apiKey) {
      throw new Error('Last.fm not configured')
    }

    const params = {
      method: 'user.getinfo',
      user: config.username,
      api_key: config.apiKey,
      format: 'json'
    }

    const response = await axios.get(this.baseUrl, { params })
    return response.data.user
  }

  async getRecentTracks(limit = 1) {
    const config = this.configService.getLastfmConfig()
    
    const params = {
      method: 'user.getrecenttracks',
      user: config.username,
      api_key: config.apiKey,
      format: 'json',
      limit
    }

    const response = await axios.get(this.baseUrl, { params })
    return response.data.recenttracks?.track || []
  }

  async getTopAlbums(period = '1month', limit = 12) {
    const config = this.configService.getLastfmConfig()
    
    const params = {
      method: 'user.gettopalbums',
      user: config.username,
      api_key: config.apiKey,
      format: 'json',
      period,
      limit: Math.max(limit * 2, 24) // Get more albums to account for duplicates
    }

    const response = await axios.get(this.baseUrl, { params })
    return response.data.topalbums?.album || []
  }

  async getIdleScreenData() {
    try {
      const [userInfo, recentTrack, topAlbums] = await Promise.all([
        this.getUserInfo(),
        this.getRecentTracks(1),
        this.getTopAlbums('1month', 24) // Request more albums
      ])

      return {
        scrobbles: parseInt(userInfo.playcount || 0),
        lastTrack: Array.isArray(recentTrack) ? recentTrack[0] : recentTrack,
        topAlbums: topAlbums // Return all albums, deduplication will happen in frontend
      }
    } catch (error) {
      console.error('Error fetching Last.fm data:', error)
      throw error
    }
  }

  async authenticate(username, password) {
    // This is a simplified auth flow - in production you'd want proper OAuth
    const config = this.configService.getLastfmConfig()
    
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