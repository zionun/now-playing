import fs from 'fs/promises'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export class ConfigService {
  constructor() {
    this.configPath = path.join(__dirname, '../config/app.json')
    this.config = null
    this.loadConfig()
  }

  async loadConfig() {
    try {
      const configData = await fs.readFile(this.configPath, 'utf8')
      this.config = JSON.parse(configData)
    } catch (error) {
      console.log('No config file found, creating default...')
      this.config = this.getDefaultConfig()
      await this.saveConfig()
    }
  }

  getDefaultConfig() {
    return {
      plex: {
        url: '',
        port: 32400,
        token: '',
        preferredUser: null // null means show any user's music
      },
      lastfm: {
        username: '',
        apiKey: '',
        apiSecret: '',
        sessionKey: ''
      },
      display: {
        showControlsTimeout: 4000, // 4 seconds
        idleTimeout: 300000, // 5 minutes
        enableLastfmIdle: true
      },
      users: {
        configPassword: null // no password for now
      }
    }
  }

  async saveConfig() {
    try {
      // Ensure config directory exists
      const configDir = path.dirname(this.configPath)
      await fs.mkdir(configDir, { recursive: true })
      
      await fs.writeFile(this.configPath, JSON.stringify(this.config, null, 2))
    } catch (error) {
      console.error('Error saving config:', error)
      throw error
    }
  }

  getConfig() {
    return { ...this.config }
  }

  async updateConfig(updates) {
    // For now, skip password hashing
    if (updates.users?.configPassword) {
      updates.users.configPassword = updates.users.configPassword // store plain text for testing
    }

    this.config = { ...this.config, ...updates }
    await this.saveConfig()
    return this.config
  }

  async verifyConfigPassword(password) {
    if (!this.config.users?.configPassword) {
      return true // No password set
    }
    
    // Simple plain text comparison for testing
    return password === this.config.users.configPassword
  }

  getPlexConfig() {
    return this.config.plex
  }

  getLastfmConfig() {
    return this.config.lastfm
  }

  getDisplayConfig() {
    return this.config.display
  }
}