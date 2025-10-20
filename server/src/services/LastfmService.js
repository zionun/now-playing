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

  async getTopAlbums(period = '7day', limit = 12) {
    const config = this.configService.getLastfmConfig()
    
    const params = {
      method: 'user.gettopalbums',
      user: config.username,
      api_key: config.apiKey,
      format: 'json',
      period: period,
      limit: limit
    }

    const response = await axios.get(this.baseUrl, { params })
    const topAlbums = response.data.topalbums?.album || []
    
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
    
    console.log(`Starting progressive album fetch to reach ${targetLimit} albums...`)
    
    for (const period of periods) {
      if (allAlbums.length >= targetLimit) {
        console.log(`Target of ${targetLimit} albums reached, stopping`)
        break
      }
      
      const remainingSlots = targetLimit - allAlbums.length
      console.log(`Fetching albums for period: ${period} (need ${remainingSlots} more albums)`)
      
      try {
        const periodAlbums = await this.getTopAlbums(period, 50) // Fetch more to increase chances of finding unique ones
        let addedFromThisPeriod = 0
        
        for (const album of periodAlbums) {
          if (allAlbums.length >= targetLimit) break
          
          const albumKey = `${album.artist.name}-${album.name}`.toLowerCase()
          
          if (!seenAlbums.has(albumKey)) {
            seenAlbums.add(albumKey)
            allAlbums.push(album)
            addedFromThisPeriod++
          }
        }
        
        console.log(`Added ${addedFromThisPeriod} unique albums from ${period} period (total: ${allAlbums.length})`)
        
      } catch (error) {
        console.error(`Error fetching albums for period ${period}:`, error.message)
        // Continue with next period even if this one fails
      }
    }
    
    const finalAlbums = allAlbums.slice(0, targetLimit)
    console.log(`Final album collection: ${finalAlbums.length} albums`)
    console.log('Albums:', finalAlbums.map((a, i) => `${i + 1}. ${a.artist.name} - ${a.name}`))
    
    return finalAlbums
  }

  async getIdleScreenData() {
    try {
      const [userInfo, recentTrack, topAlbums] = await Promise.all([
        this.getUserInfo(),
        this.getRecentTracks(1),
        this.getTopAlbumsWithFallback(12) // Use progressive fallback to ensure we get 12 albums
      ])

      return {
        scrobbles: parseInt(userInfo.playcount || 0),
        lastTrack: Array.isArray(recentTrack) ? recentTrack[0] : recentTrack,
        topAlbums: topAlbums // Albums from cascading time periods, ordered by relevance
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