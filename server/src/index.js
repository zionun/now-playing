import express from 'express'
import { createServer } from 'http'
import { Server } from 'socket.io'
import cors from 'cors'
import path from 'path'
import { fileURLToPath } from 'url'
import dotenv from 'dotenv'

import plexRoutes, { setPlexService } from './routes/plex.js'
import configRoutes, { setConfigService } from './routes/config.js'
import lastfmRoutes, { setLastfmService } from './routes/lastfm.js'
import { PlexService } from './services/PlexService.js'
import { ConfigService } from './services/ConfigService.js'
import { LastfmService } from './services/LastfmService.js'

dotenv.config()

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const app = express()
const server = createServer(app)
const io = new Server(server, {
  cors: {
    origin: process.env.CLIENT_URL || "http://localhost:3000",
    methods: ["GET", "POST"]
  }
})

// Middleware
app.use(cors())
app.use(express.json())
app.use(express.static(path.join(__dirname, '../../client/dist')))

// Routes
app.use('/api/plex', plexRoutes)
app.use('/api/config', configRoutes)
app.use('/api/lastfm', lastfmRoutes)

async function startServer() {
  // Initialize services
  const configService = new ConfigService()

  // Wait for config to load before starting other services
  await configService.loadConfig()

  const plexService = new PlexService(configService, io)
  const lastfmService = new LastfmService(configService)

  // Inject services into routes
  setPlexService(plexService)
  setConfigService(configService)
  setLastfmService(lastfmService)

  // WebSocket connection handler
  io.on('connection', (socket) => {
    console.log('Client connected:', socket.id)

    socket.on('disconnect', () => {
      console.log('Client disconnected:', socket.id)
    })

    // Handle media controls
    socket.on('mediaControl', async (action) => {
      try {
        await plexService.mediaControl(action)
      } catch (error) {
        console.error('Media control error:', error)
        socket.emit('error', error.message)
      }
    })

    // Handle user switch
    socket.on('switchUser', async (userId) => {
      try {
        await plexService.switchActiveUser(userId)
      } catch (error) {
        console.error('User switch error:', error)
        socket.emit('error', error.message)
      }
    })
  })

  // Start Plex monitoring after everything is initialized
  plexService.startMonitoring()

  // Serve React app for all non-API routes
  app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '../../client/dist/index.html'))
  })

  const PORT = process.env.PORT || 3001

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on port ${PORT}`)
    console.log('Plex monitoring started')
  })
}

// Start the server
startServer().catch(console.error)