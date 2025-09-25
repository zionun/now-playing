import fs from 'fs/promises'
import path from 'path'
import bcrypt from 'bcrypt'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export class ConfigService {
  constructor() {
    this.configPath = path.join(__dirname, '../config/app.json')
    this.config = null
    // Don't call loadConfig here, it should be called explicitly
  }

  async loadConfig() {
    try {
      const configData = await fs.readFile(this.configPath, 'utf8')
      this.config = JSON.parse(configData)
      console.log('Configuration loaded successfully')
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
        configPassword: null // hashed password for config access
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
    // Hash password if provided
    if (updates.users?.configPassword) {
      const saltRounds = 12
      updates.users.configPassword = await bcrypt.hash(updates.users.configPassword, saltRounds)
    }

    this.config = { ...this.config, ...updates }
    await this.saveConfig()
    return this.config
  }

  async verifyConfigPassword(password) {
    if (!this.config.users?.configPassword) {
      return true // No password set
    }
    
    return await bcrypt.compare(password, this.config.users.configPassword)
  }

  getPlexConfig() {
    if (!this.config) {
      throw new Error('Configuration not loaded yet')
    }
    return this.config.plex || {}
  }

  getLastfmConfig() {
    if (!this.config) {
      throw new Error('Configuration not loaded yet')
    }
    return this.config.lastfm || {}
  }

  getDisplayConfig() {
    if (!this.config) {
      throw new Error('Configuration not loaded yet')
    }
    return this.config.display || {}
  }
}