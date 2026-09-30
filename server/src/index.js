import express from 'express'
import cors from 'cors'
import { Server } from 'socket.io'
import { createServer } from 'http'
import path from 'path'
import { fileURLToPath } from 'url'
import dotenv from 'dotenv'
import { ConfigService } from './services/ConfigService.js'
import { LastfmService } from './services/LastfmService.js'
import { PlexAuthService } from './services/PlexAuthService.js'
import { DeviceSetupService } from './services/DeviceSetupService.js'
import { PlexClient } from './plex/PlexClient.js'
import { PlexEventStream } from './plex/PlexEventStream.js'
import { PlayerDirectory } from './plex/PlayerDirectory.js'
import { PlaybackController } from './plex/PlaybackController.js'
import { NowPlayingService } from './app/NowPlayingService.js'
import { DisplayPower, createBacklight } from './app/DisplayPower.js'
import { detectHyperPixelSquare } from './app/displayDetect.js'
import { attachSocketHandlers } from './realtime/socketHandlers.js'
import lastfmRouter, { setLastfmService } from './routes/lastfm.js'
import configRouter, { setConfigService } from './routes/config.js'
import authRouter, { setAuthServices } from './routes/auth.js'
import { createPlexRouter } from './routes/plex.js'
import { createHealthRouter } from './routes/health.js'
import { createLogger } from './lib/logger.js'

dotenv.config()

const log = createLogger('server')
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PORT = process.env.PORT || 3001
const CLIENT_URL = process.env.CLIENT_URL || 'http://localhost:3000'

// 📋 CONFIGURATION AND SERVICES
const configService = new ConfigService()
await configService.loadConfig()

const lastfmService = new LastfmService(configService)
const plexAuthService = new PlexAuthService(configService)
const deviceSetupService = new DeviceSetupService(configService)

// The Plex connection is read on every request: env > configuration.
// No default token or address: without a configuration the app waits for the setup.
function plexConnection() {
  const plex = configService.getConfig().plex || {}
  const baseUrl = process.env.PLEX_SERVER_URL || (plex.url ? `http://${plex.url}:${plex.port || 32400}` : '')
  return {
    baseUrl,
    token: process.env.PLEX_TOKEN || plex.token || '',
    clientIdentifier: plex.clientIdentifier || ''
  }
}

const plexClient = new PlexClient(plexConnection)
const eventStream = new PlexEventStream(() => plexClient.notificationsUrl())
const directory = new PlayerDirectory({
  plexClient,
  getPlayerResources: async () => {
    const { token } = plexConnection()
    return token ? plexAuthService.getPlayerResources(token) : []
  }
})
const playback = new PlaybackController({ plexClient, directory, getConnection: plexConnection })

// Screen sleep: off after some minutes with nothing playing (settings →
// Screen). Only with a HyperPixel 4.0 Square connected.
const hyperPixel = detectHyperPixelSquare()
const displayPower = new DisplayPower({
  available: hyperPixel.present,
  backlight: hyperPixel.present ? createBacklight() : { available: false, set: async () => {} },
  getSettings: () => configService.getConfig().display
})

const nowPlaying = new NowPlayingService({
  configService,
  plexClient,
  eventStream,
  directory,
  playback,
  lastfm: lastfmService,
  plexAuthService,
  displayPower
})

// 📋 EXPRESS
const app = express()
app.use(cors())
app.use(express.json())
app.use(express.static(path.join(__dirname, '../../client/dist')))

const reloadConfig = () => nowPlaying.reloadConfig()

setLastfmService(lastfmService)
app.use('/api/lastfm', lastfmRouter)
setConfigService(
  configService,
  reloadConfig,
  deviceSetupService,
  () => nowPlaying.filterOptions(),
  () => displayPower.available
)
app.use('/api/config', configRouter)
setAuthServices(configService, plexAuthService, reloadConfig, deviceSetupService)
app.use('/api/auth', authRouter)
app.use('/api/health', createHealthRouter({ nowPlaying }))
app.use(
  '/api',
  createPlexRouter({
    plexClient,
    nowPlaying,
    requireSession: deviceSetupService.requireSession,
    getToken: () => plexConnection().token
  })
)

// Kiosk display options (nothing confidential)
app.get('/api/display-settings', (req, res) => {
  const display = configService.getConfig().display || {}
  res.json({
    showControlsTimeout: display.showControlsTimeout || 4000,
    enableLastfmIdle: display.enableLastfmIdle !== false,
    screenSleepAvailable: displayPower.available,
    language: ['en', 'it'].includes(display.language) ? display.language : 'auto'
  })
})

// A tap on the sleeping kiosk, when its Socket.IO connection is down (the
// same as the 'wake' event): turning the screen on is harmless, no session
app.post('/api/display/wake', (req, res) => {
  nowPlaying.wake()
  res.json({ on: nowPlaying.isScreenOn() })
})

// Every other page is handled by the React app
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../../client/dist/index.html'))
})

// 📋 SOCKET.IO
const server = createServer(app)
const io = new Server(server, {
  cors: { origin: CLIENT_URL, methods: ['GET', 'POST'] },
  transports: ['websocket', 'polling'],
  pingTimeout: 60000,
  pingInterval: 25000,
  upgradeTimeout: 30000,
  allowEIO3: true
})

io.engine.on('connection_error', err => {
  log.debug('Socket.IO connection error:', err.message)
})

attachSocketHandlers(io, nowPlaying, displayPower)

// 📋 UNHANDLED ERRORS
process.on('uncaughtException', err => {
  if (err.code === 'EPIPE') return // client disconnected mid-response
  log.error('Unhandled error:', err)
  process.exit(1)
})

process.on('unhandledRejection', reason => {
  log.error('Unhandled promise rejection:', reason)
})

// 📋 STARTUP
server.listen(PORT, () => {
  log.info(`Server started on port ${PORT}`)
  log.info(
    `Screen sleep ${hyperPixel.present ? 'available' : 'not available'}: HyperPixel 4.0 Square ${hyperPixel.present ? 'found' : 'not found'} (${hyperPixel.reason})`
  )
  log.info(`Setup from the phone: ${deviceSetupService.getBaseUrl()}/setup`)

  // Configurations created before the QR login don't know the device's Plex
  // account, needed for "Forgot password": derive it from the token already
  // saved.
  const plexConfig = configService.getConfig().plex || {}
  if (plexConfig.token && !plexConfig.accountId) {
    plexAuthService
      .getAccount(plexConfig.token)
      .then(account => configService.setPlexAccountId(account.id))
      .catch(error => log.warn('Plex account not retrieved:', error.message))
  }

  if (!nowPlaying.isConfigured()) {
    log.info('Device not set up: scan the QR code on the screen')
  }
  displayPower.start()
  nowPlaying.start()
})

// Stopping (pm2 restart/stop, update): never leave the screen off
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, async () => {
    await displayPower.stop()
    process.exit(0)
  })
}
