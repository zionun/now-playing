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

// Try to serve static files, but don't fail if they don't exist
try {
  app.use(express.static(path.join(__dirname, '../../client/dist')))
} catch (error) {
  console.log('Client dist folder not found, serving API only')
}

// Routes
app.use('/api/plex', plexRoutes)
app.use('/api/config', configRoutes)
app.use('/api/lastfm', lastfmRoutes)

// Initialize services
const configService = new ConfigService()
const plexService = new PlexService(configService, io)
const lastfmService = new LastfmService(configService)

// Inject services into routes
setPlexService(plexService)
setConfigService(configService)
setLastfmService(lastfmService)

// WebSocket connection handler
io.on('connection', (socket) => {
  console.log('Client connected:', socket.id)
  
  // Send current now playing state immediately
  socket.emit('nowPlaying', plexService.getCurrentState())
  
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

// Test route
app.get('/', (req, res) => {
  res.json({ 
    message: 'Now Playing API Server', 
    version: '1.0.0',
    endpoints: {
      config: '/api/config',
      plex: '/api/plex',
      lastfm: '/api/lastfm'
    }
  })
})

// API route for testing
app.get('/api/test', (req, res) => {
  res.json({ message: 'API is working!', timestamp: new Date().toISOString() })
})

// Simple config page for testing
app.get('/config', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Now Playing - Configuration</title>
      <style>
        body { font-family: Arial, sans-serif; margin: 40px; background: #111; color: white; }
        .container { max-width: 600px; margin: 0 auto; }
        .section { margin: 30px 0; padding: 20px; background: #222; border-radius: 8px; }
        input { width: 100%; padding: 10px; margin: 5px 0; background: #333; border: 1px solid #555; color: white; border-radius: 4px; }
        button { padding: 10px 20px; background: #007acc; color: white; border: none; border-radius: 4px; cursor: pointer; margin: 5px; }
        button:hover { background: #005aa3; }
        .error { color: #ff6b6b; }
        .success { color: #51cf66; }
      </style>
    </head>
    <body>
      <div class="container">
        <h1>Now Playing - Configuration</h1>
        <div class="section">
          <h2>Test API Connection</h2>
          <button onclick="testAPI()">Test API</button>
          <div id="apiResult"></div>
        </div>
        <div class="section">
          <h2>Get Current Configuration</h2>
          <button onclick="getConfig()">Get Config</button>
          <div id="configResult"></div>
        </div>
      </div>
      
      <script>
        async function testAPI() {
          try {
            const response = await fetch('/api/test');
            const data = await response.json();
            document.getElementById('apiResult').innerHTML = '<div class="success">API OK: ' + JSON.stringify(data, null, 2) + '</div>';
          } catch (error) {
            document.getElementById('apiResult').innerHTML = '<div class="error">API Error: ' + error.message + '</div>';
          }
        }
        
        async function getConfig() {
          try {
            const response = await fetch('/api/config');
            const data = await response.json();
            document.getElementById('configResult').innerHTML = '<div class="success">Config: <pre>' + JSON.stringify(data, null, 2) + '</pre></div>';
          } catch (error) {
            document.getElementById('configResult').innerHTML = '<div class="error">Config Error: ' + error.message + '</div>';
          }
        }
      </script>
    </body>
    </html>
  `)
})

const PORT = process.env.PORT || 3001

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`)
  console.log(`Configuration available at: http://localhost:${PORT}/config`)
  console.log(`API test available at: http://localhost:${PORT}/api/test`)
  
  // Start Plex monitoring
  plexService.startMonitoring()
})