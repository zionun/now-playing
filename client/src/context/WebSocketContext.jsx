import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import { io } from 'socket.io-client'
import { LanguageContext, resolveLanguage } from '../i18n'

const WebSocketContext = createContext()

export const useWebSocket = () => {
  const context = useContext(WebSocketContext)
  if (!context) {
    throw new Error('useWebSocket must be used within a WebSocketProvider')
  }
  return context
}

const DEFAULT_DISPLAY = { showControlsTimeout: 4000, enableLastfmIdle: true, language: 'auto' }

export const WebSocketProvider = ({ children }) => {
  const [socket, setSocket] = useState(null)
  const [nowPlaying, setNowPlaying] = useState({
    isPlaying: false,
    track: null,
    activeUsers: [],
    selectedUser: null
  })
  const [connectionStatus, setConnectionStatus] = useState('connecting')
  // The device is not set up yet, or the Plex token is no longer valid: the
  // kiosk shows the setup QR code instead of the normal interface. Checked
  // right away over HTTP (authChecked avoids a flash of the wrong screen) and
  // updated by the socket at runtime (e.g. token revoked while running).
  const [authRequired, setAuthRequired] = useState(false)
  const [authChecked, setAuthChecked] = useState(false)
  const [configVersion, setConfigVersion] = useState(0)
  // Plex/Last.fm status for the discreet on-screen indicator
  const [health, setHealth] = useState(null)
  // "Screen" options chosen from the phone (controls duration, Last.fm when idle, language)
  const [display, setDisplay] = useState(DEFAULT_DISPLAY)

  useEffect(() => {
    fetch('/api/display-settings')
      .then(res => res.json())
      .then(settings => setDisplay({ ...DEFAULT_DISPLAY, ...settings }))
      .catch(() => {}) // keep the defaults
  }, [configVersion])

  useEffect(() => {
    fetch('/api/auth/state')
      .then(res => res.json())
      .then(data => setAuthRequired(!data.setupComplete))
      .catch(() => {}) // the socket reports the "not set up" state anyway
      .finally(() => setAuthChecked(true))
  }, [])

  useEffect(() => {
    // In development the client (Vite, port 3000) connects straight to the
    // server; in production the server itself serves the page.
    const serverUrl = import.meta.env.PROD ? window.location.origin : 'http://localhost:3001'

    const socketConnection = io(serverUrl, {
      transports: ['websocket', 'polling'],
      upgrade: true,
      rememberUpgrade: true,
      timeout: 20000,
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      autoConnect: true
    })

    socketConnection.on('connect', () => setConnectionStatus('connected'))
    socketConnection.on('disconnect', () => setConnectionStatus('disconnected'))
    socketConnection.on('connect_error', () => setConnectionStatus('error'))

    socketConnection.on('nowPlaying', data => {
      // Ignore malformed data instead of breaking the screen
      if (data && typeof data === 'object') setNowPlaying(data)
    })

    // Settings changed from the phone: whatever depends on them reloads
    socketConnection.on('configUpdated', () => setConfigVersion(v => v + 1))
    socketConnection.on('health', setHealth)
    // Plex not set up, or its token revoked/expired
    socketConnection.on('authRequired', () => setAuthRequired(true))

    setSocket(socketConnection)

    return () => {
      socketConnection.disconnect()
    }
  }, [])

  const sendMediaControl = action => {
    if (socket && socket.connected) {
      socket.emit('mediaControl', { type: action })
    }
  }

  const switchUser = userId => {
    if (socket && socket.connected) {
      socket.emit('switchUser', userId)
    }
  }

  // Called by the QR screen as soon as the server confirms the device is set
  // up, to go back to the normal interface right away.
  const markAuthenticated = useCallback(() => setAuthRequired(false), [])

  const language = resolveLanguage(display.language)
  useEffect(() => {
    document.documentElement.lang = language
  }, [language])

  const value = {
    socket,
    nowPlaying,
    connectionStatus,
    sendMediaControl,
    switchUser,
    authRequired,
    authChecked,
    configVersion,
    health,
    display,
    markAuthenticated
  }

  return (
    <WebSocketContext.Provider value={value}>
      <LanguageContext.Provider value={language}>{children}</LanguageContext.Provider>
    </WebSocketContext.Provider>
  )
}

export default WebSocketContext
