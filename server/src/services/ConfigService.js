import fs from 'fs/promises'
import os from 'os'
import path from 'path'
// bcryptjs: pure JavaScript (nothing to compile on the Raspberry Pi) and
// compatible with the hashes created earlier by bcrypt
import bcrypt from 'bcryptjs'
import { fileURLToPath } from 'url'
import { DEFAULT_FILTERS, normalizeFilters } from './sessionFilters.js'
import { createLogger } from '../lib/logger.js'

const log = createLogger('config')

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// 10 rounds: safe, and checked in under a second even on a Pi Zero 2
const BCRYPT_ROUNDS = 10

// Old location, inside the repository: moved away at the first start
export const LEGACY_CONFIG_PATH = path.join(__dirname, '../config/app.json')

// 📋 WHERE THE CONFIGURATION LIVES - Outside the repository, so updates
// (git) never touch it and secrets never end up in git:
// - NOW_PLAYING_CONFIG, when set
// - /var/lib/now-playing/config.json when the server runs as root (Raspberry)
// - ~/.config/now-playing/config.json otherwise (development)
export function resolveConfigPath(env = process.env) {
  if (env.NOW_PLAYING_CONFIG) return path.resolve(env.NOW_PLAYING_CONFIG)
  if (typeof process.getuid === 'function' && process.getuid() === 0) {
    return '/var/lib/now-playing/config.json'
  }
  const configHome = env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config')
  return path.join(configHome, 'now-playing', 'config.json')
}

const exists = async file =>
  fs.access(file).then(
    () => true,
    () => false
  )

export class ConfigService {
  constructor({ configPath = resolveConfigPath(), legacyPath = LEGACY_CONFIG_PATH } = {}) {
    this.configPath = configPath
    this.legacyPath = legacyPath
    this.config = null
    // Don't call loadConfig here, it should be called explicitly
  }

  async loadConfig() {
    await this.migrateLegacyFile()

    let configData
    try {
      configData = await fs.readFile(this.configPath, 'utf8')
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
      log.info(`No configuration in ${this.configPath}: creating the initial one`)
      this.config = this.getDefaultConfig()
      await this.saveConfig()
      return
    }

    try {
      this.config = this.migrate(JSON.parse(configData))
    } catch (error) {
      // Unreadable file: set it aside instead of overwriting it, so the
      // password and connections can still be recovered by hand
      const brokenPath = `${this.configPath}.broken-${Date.now()}`
      await fs.rename(this.configPath, brokenPath)
      log.error(`Invalid configuration, moved to ${brokenPath}: starting from the initial one`)
      this.config = this.getDefaultConfig()
      await this.saveConfig()
      return
    }

    // Permissions might have been loosened by hand
    await fs.chmod(this.configPath, 0o600).catch(() => {})
    log.info(`Configuration loaded from ${this.configPath}`)
  }

  // Configuration in the old location (inside the repository) and not yet in
  // the new one: move it, once.
  async migrateLegacyFile() {
    if (!this.legacyPath || this.legacyPath === this.configPath) return
    if (!(await exists(this.legacyPath)) || (await exists(this.configPath))) return

    const data = await fs.readFile(this.legacyPath, 'utf8')
    await this.writeAtomically(data)
    await fs.unlink(this.legacyPath)
    log.info(`Configuration moved from ${this.legacyPath} to ${this.configPath}`)
  }

  // Atomic write (temporary file + rename): a power cut while saving never
  // leaves a half-written file. Permissions 600: the configuration holds
  // tokens and the password hash.
  async writeAtomically(data) {
    const dir = path.dirname(this.configPath)
    await fs.mkdir(dir, { recursive: true, mode: 0o700 })
    const tmpPath = `${this.configPath}.tmp-${process.pid}`
    await fs.writeFile(tmpPath, data, { mode: 0o600 })
    await fs.rename(tmpPath, this.configPath)
  }

  // Configurations saved by older versions: plex.preferredUser (never used)
  // is replaced by filters.users, filters is always initialized and the
  // display language defaults to "auto".
  migrate(config) {
    if (config.plex && 'preferredUser' in config.plex) {
      const { preferredUser, ...plex } = config.plex
      config.plex = plex
    }
    config.filters = normalizeFilters(config.filters)
    // display.idleTimeout was never used: replaced by screenSleepMinutes
    const { idleTimeout, ...display } = config.display || {}
    config.display = { language: 'auto', screenAlwaysOn: false, screenSleepMinutes: 5, ...display }
    return config
  }

  getDefaultConfig() {
    return {
      plex: {
        url: '',
        port: 32400,
        token: '',
        clientIdentifier: '' // stable identifier for the Plex PIN login
      },
      // Session filters: empty lists = no restriction
      filters: { ...DEFAULT_FILTERS },
      lastfm: {
        username: '',
        apiKey: '',
        apiSecret: '',
        sessionKey: ''
      },
      display: {
        showControlsTimeout: 4000, // 4 seconds
        enableLastfmIdle: true,
        screenAlwaysOn: false, // true: the screen never turns off
        screenSleepMinutes: 5, // minutes with nothing playing before it turns off
        language: 'auto' // 'auto' (device language), 'en' or 'it'
      },
      users: {
        configPassword: null // hashed password for config access
      }
    }
  }

  async saveConfig() {
    try {
      await this.writeAtomically(JSON.stringify(this.config, null, 2))
    } catch (error) {
      log.error('Error saving config:', error)
      throw error
    }
  }

  getConfig() {
    return { ...this.config }
  }

  async updateConfig(updates) {
    // Hash password if provided
    if (updates.users?.configPassword) {
      const saltRounds = BCRYPT_ROUNDS
      updates.users.configPassword = await bcrypt.hash(updates.users.configPassword, saltRounds)
    }

    // Deep-merge section by section so untouched fields (and secrets left
    // blank by the client, e.g. a masked token) are preserved instead of
    // being wiped by a shallow top-level merge.
    this.config = {
      ...this.config,
      plex: { ...this.config.plex, ...this.stripEmptySecrets(updates.plex, ['token']) },
      lastfm: {
        ...this.config.lastfm,
        ...this.stripEmptySecrets(updates.lastfm, ['apiKey', 'apiSecret', 'sessionKey'])
      },
      display: { ...this.config.display, ...updates.display },
      // User/player lists replace the previous ones
      filters: updates.filters
        ? normalizeFilters({ ...this.config.filters, ...updates.filters })
        : this.config.filters,
      users: updates.users ? { ...this.config.users, ...updates.users } : this.config.users
    }
    await this.saveConfig()
    return this.config
  }

  // Drops secret fields the client sent back as empty (meaning "unchanged"),
  // so an empty field never overwrites a value already saved on the server.
  stripEmptySecrets(section, secretKeys) {
    if (!section) return {}
    const cleaned = { ...section }
    for (const key of secretKeys) {
      if (cleaned[key] === '' || cleaned[key] === undefined) {
        delete cleaned[key]
      }
    }
    return cleaned
  }

  // Used by the Plex login flow: they write the field directly; unlike
  // updateConfig() an empty string is not "unchanged", because here the token
  // must really be clearable.
  async setPlexClientIdentifier(clientIdentifier) {
    this.config.plex = { ...this.config.plex, clientIdentifier }
    await this.saveConfig()
  }

  // accountId/serverName/machineIdentifier: the Plex account that set up the
  // device (needed to reset the password) and the chosen server (shown in
  // the settings).
  async setPlexAuth({ url, port, token, accountId, serverName, machineIdentifier }) {
    this.config.plex = {
      ...this.config.plex,
      url,
      port: port || 32400,
      token,
      ...(accountId !== undefined && { accountId }),
      ...(serverName !== undefined && { serverName }),
      ...(machineIdentifier !== undefined && { machineIdentifier })
    }
    await this.saveConfig()
  }

  async setPlexAccountId(accountId) {
    this.config.plex = { ...this.config.plex, accountId }
    await this.saveConfig()
  }

  // Factory reset: back to the initial configuration, password and Plex
  // account binding included.
  async resetToDefaults() {
    this.config = this.getDefaultConfig()
    await this.saveConfig()
  }

  hasConfigPassword() {
    return !!this.config.users?.configPassword
  }

  async setConfigPassword(password) {
    const hash = await bcrypt.hash(password, BCRYPT_ROUNDS)
    this.config.users = { ...this.config.users, configPassword: hash }
    await this.saveConfig()
  }

  async clearPlexToken() {
    this.config.plex = { ...this.config.plex, token: '' }
    await this.saveConfig()
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
