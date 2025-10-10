import axios from 'axios'
import xml2js from 'xml2js'
import PlexAPI from 'plex-api'

export class PlexService {
  constructor(configService, io) {
    this.configService = configService
    this.io = io
    this.plexClient = null
    this.currentState = {
      isPlaying: false,
      track: null,
      activeUsers: [],
      selectedUser: null
    }
    this.monitoringInterval = null
  }

  startMonitoring() {
    this.stopMonitoring()
    
    // Initialize Plex client
    const config = this.configService.getPlexConfig()
    if (config.url && config.token) {
      try {
        this.plexClient = new PlexAPI({
          hostname: config.url,
          port: config.port,
          token: config.token,
          options: {
            deviceName: 'now-playing-app',
            identifier: 'now-playing-app-' + Date.now()
          }
        })
        console.log('✅ PlexAPI client initialized successfully')
      } catch (error) {
        console.error('❌ Failed to initialize PlexAPI client:', error.message)
        this.plexClient = null
      }
    }
    
    // Initial check
    this.checkNowPlaying()
    
    // Check every 2 seconds
    this.monitoringInterval = setInterval(() => {
      this.checkNowPlaying()
    }, 2000)
  }

  stopMonitoring() {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval)
      this.monitoringInterval = null
    }
  }

  async checkNowPlaying() {
    try {
      const config = this.configService.getPlexConfig()
      
      if (!config.url || !config.token) {
        console.log('Plex config missing:', { hasUrl: !!config.url, hasToken: !!config.token })
        return
      }

      console.log('Checking Plex sessions...')
      const sessions = await this.getActiveSessions()
      console.log(`Found ${sessions.length} active sessions`)
      
      // Debug: log the first session structure
      if (sessions.length > 0) {
        console.log('First session structure:')
        console.log('- type:', sessions[0].type)
        console.log('- $:', sessions[0].$)
        console.log('- Player state:', sessions[0].Player?.[0]?.state || sessions[0].Player?.state)
        console.log('- Player:', sessions[0].Player)
      }
      
      const musicSessions = sessions.filter(session => {
        const playerState = session.Player?.[0]?.$?.state
        const sessionType = session.$.type
        
        console.log('Filtering session:', {
          type: sessionType,
          playerState: playerState,
          isTrack: sessionType === 'track',
          isPlaying: playerState === 'playing'
        })
        
        return sessionType === 'track' && playerState === 'playing'
      })
      
      console.log(`Found ${musicSessions.length} music sessions`)
      
      if (musicSessions.length > 0) {
        console.log('Music sessions:', musicSessions.map(s => ({
          user: s.User?.[0]?.$?.title || s.Player?.[0]?.$?.title,
          track: `${s.$.title} - ${s.$.grandparentTitle}`,
          state: s.Player?.[0]?.$?.state
        })))
      }

      const activeUsers = musicSessions.map(session => {
        const user = session.User?.[0]?.$
        const player = session.Player?.[0]?.$
        
        return {
          id: user?.userID,
          title: player?.title, // Nome del dispositivo
          thumb: user?.thumb
        }
      })

      let selectedSession = null
      
      if (config.preferredUser) {
        // Look for preferred user's session
        selectedSession = musicSessions.find(session => 
          session.User?.[0]?.$?.userID === config.preferredUser
        )
      } else if (musicSessions.length > 0) {
        // If no preferred user, take the first session
        selectedSession = musicSessions[0]
      }

      const newState = {
        isPlaying: !!selectedSession,
        track: selectedSession ? this.formatTrackData(selectedSession) : null,
        activeUsers,
        selectedUser: selectedSession?.User?.[0]?.$?.userID || null
      }

      // Only emit if state changed
      if (JSON.stringify(newState) !== JSON.stringify(this.currentState)) {
        this.currentState = newState
        this.io.emit('nowPlaying', newState)
      }

    } catch (error) {
      console.error('Error checking now playing:', error.message)
    }
  }

  async getActiveSessions() {
    const config = this.configService.getPlexConfig()
    const url = `http://${config.url}:${config.port}/status/sessions`
    
    console.log('Fetching Plex sessions from:', url)
    
    try {
      const response = await axios.get(url, {
        headers: {
          'X-Plex-Token': config.token,
          'Accept': 'application/xml'
        },
        timeout: 5000
      })

      console.log('Plex response status:', response.status)
      console.log('Plex response data length:', response.data.length)

      const parser = new xml2js.Parser()
      const result = await parser.parseStringPromise(response.data)
      
      console.log('Parsed MediaContainer:', result.MediaContainer)
      console.log('Videos found:', result.MediaContainer?.Video?.length || 0)
      console.log('Tracks found:', result.MediaContainer?.Track?.length || 0)
      
      // Return both Video and Track sessions
      const videos = result.MediaContainer?.Video || []
      const tracks = result.MediaContainer?.Track || []
      
      return [...videos, ...tracks]
      
    } catch (error) {
      console.error('Error fetching Plex sessions:', error.message)
      if (error.code) {
        console.error('Error code:', error.code)
      }
      return []
    }
  }

  formatTrackData(session) {
    const baseUrl = `http://${this.configService.getPlexConfig().url}:${this.configService.getPlexConfig().port}`
    const track = session.$
    const player = session.Player?.[0]?.$
    const user = session.User?.[0]?.$
    
    return {
      title: track.title,
      artist: track.grandparentTitle,
      album: track.parentTitle,
      thumb: track.thumb ? `${baseUrl}${track.thumb}?X-Plex-Token=${this.configService.getPlexConfig().token}` : null,
      parentThumb: track.parentThumb ? `${baseUrl}${track.parentThumb}?X-Plex-Token=${this.configService.getPlexConfig().token}` : null,
      grandparentThumb: track.grandparentThumb ? `${baseUrl}${track.grandparentThumb}?X-Plex-Token=${this.configService.getPlexConfig().token}` : null,
      duration: parseInt(track.duration || 0),
      viewOffset: parseInt(track.viewOffset || 0),
      sessionId: track.sessionKey,
      playerId: player?.machineIdentifier,
      user: {
        id: user?.userID,
        title: player?.title // Il nome del dispositivo/player
      }
    }
  }

  async mediaControl(action) {
    const config = this.configService.getPlexConfig()
    
    console.log('Media control request:', action) // Debug
    console.log('Current state track:', this.currentState.track) // Debug
    
    if (!this.currentState.track?.sessionId) {
      console.error('No active session available') // Debug
      throw new Error('No active session')
    }

    if (!this.currentState.track?.playerId) {
      console.error('No player ID available') // Debug
      throw new Error('No player ID available')
    }

    const sessionId = this.currentState.track.sessionId
    const playerId = this.currentState.track.playerId
    const baseUrl = `http://${config.url}:${config.port}`
    let endpoint = ''

    // Uso gli endpoint corretti di Plex per i controlli multimediali
    switch (action.type) {
      case 'play':
        endpoint = `/player/playback/play`
        break
      case 'pause':
        endpoint = `/player/playback/pause`
        break
      case 'previous':
        endpoint = `/player/playback/skipPrevious`
        break
      case 'next':
        endpoint = `/player/playback/skipNext`
        break
      default:
        throw new Error(`Unknown action: ${action.type}`)
    }

    const fullUrl = `${baseUrl}${endpoint}`
    console.log(`[PLEX DEBUG] Chiamata URL: ${fullUrl}`)
    try {
      await axios.get(fullUrl, {
        headers: {
          'X-Plex-Token': config.token
        },
        params: {
          'X-Plex-Client-Identifier': 'now-playing-app',
          'X-Plex-Target-Client-Identifier': playerId,
          type: 'music'
        },
        timeout: 5000
      })
      console.log('Media control successful') // Debug
    } catch (error) {
      console.error('Axios error:', error.response?.status, error.response?.statusText) // Debug
      console.error('Error details:', error.response?.data) // Debug
      throw error
    }

    // Immediately check for updates
    setTimeout(() => this.checkNowPlaying(), 500)
  }

  // Nuovo metodo usando plex-api per controlli media
  async mediaControlWithLibrary(action) {
    if (!this.plexClient) {
      console.error('❌ PlexAPI client not initialized')
      throw new Error('Plex client not initialized')
    }

    if (!this.currentState.track?.sessionId) {
      console.error('❌ No active session available')
      throw new Error('No active session')
    }

    if (!this.currentState.track?.playerId) {
      console.error('❌ No player ID available')
      throw new Error('No player ID available')
    }

    console.log('🎮 --- MEDIA CONTROL CON PLEX-API ---')
    console.log('📱 Azione:', action)
    console.log('🔑 Session ID:', this.currentState.track.sessionId)
    console.log('🎯 Player ID:', this.currentState.track.playerId)
    console.log('📡 PlexClient status:', this.plexClient ? 'initialized' : 'null')

    try {
      const playerId = this.currentState.track.playerId
      console.log('🎯 Attempting control with player ID:', playerId)
      
      switch (action.type) {
        case 'play':
          console.log('▶️ Sending PLAY command')
          await this.plexClient.perform('/player/playback/play', {
            'X-Plex-Target-Client-Identifier': playerId,
            'X-Plex-Client-Identifier': 'now-playing-app'
          })
          break
        case 'pause':
          console.log('⏸️ Sending PAUSE command')
          await this.plexClient.perform('/player/playback/pause', {
            'X-Plex-Target-Client-Identifier': playerId,
            'X-Plex-Client-Identifier': 'now-playing-app'
          })
          break
        case 'next':
          console.log('⏭️ Sending NEXT command')
          await this.plexClient.perform('/player/playback/skipNext', {
            'X-Plex-Target-Client-Identifier': playerId,
            'X-Plex-Client-Identifier': 'now-playing-app'
          })
          break
        case 'previous':
          console.log('⏮️ Sending PREVIOUS command')
          await this.plexClient.perform('/player/playback/skipPrevious', {
            'X-Plex-Target-Client-Identifier': playerId,
            'X-Plex-Client-Identifier': 'now-playing-app'
          })
          break
        default:
          throw new Error(`Unknown action: ${action.type}`)
      }
      
      console.log('✅ Media control con plex-api successful')
    } catch (error) {
      console.error('❌ Media control con plex-api error:', error.message)
      console.error('❌ Error details:', error)
      throw error
    }

    // Immediately check for updates
    setTimeout(() => this.checkNowPlaying(), 500)
  }

  async switchActiveUser(userId) {
    // This will be handled by updating the selectedUser in the current state
    // The frontend will filter based on this
    this.currentState.selectedUser = userId
    this.io.emit('nowPlaying', this.currentState)
  }

  getCurrentState() {
    return this.currentState
  }

  async testConnection() {
    try {
      const config = this.configService.getPlexConfig()
      const url = `http://${config.url}:${config.port}/`
      
      const response = await axios.get(url, {
        headers: {
          'X-Plex-Token': config.token
        },
        timeout: 5000
      })

      return { success: true, server: response.headers['x-plex-platform'] }
    } catch (error) {
      throw new Error(`Connection failed: ${error.message}`)
    }
  }
}