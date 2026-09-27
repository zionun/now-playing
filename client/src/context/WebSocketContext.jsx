import React, { createContext, useContext, useEffect, useState } from 'react'
import { io } from 'socket.io-client'

const WebSocketContext = createContext()

export const useWebSocket = () => {
  const context = useContext(WebSocketContext)
  if (!context) {
    throw new Error('useWebSocket must be used within a WebSocketProvider')
  }
  return context
}

export const WebSocketProvider = ({ children }) => {
  const [socket, setSocket] = useState(null)
  const [nowPlaying, setNowPlaying] = useState({
    isPlaying: false,
    track: null,
    activeUsers: [],
    selectedUser: null
  })
  const [connectionStatus, setConnectionStatus] = useState('connecting')
  // Plex non è (ancora) configurato o il suo token non è più valido: il
  // client deve mostrare la schermata di login invece dell'interfaccia
  // normale. Controllato subito via HTTP (authChecked evita un flash
  // dell'interfaccia sbagliata) e aggiornato dal socket se cambia a runtime
  // (es. token revocato mentre l'app è aperta).
  const [authRequired, setAuthRequired] = useState(false)
  const [authChecked, setAuthChecked] = useState(false)

  useEffect(() => {
    fetch('/api/auth/state')
      .then(res => res.json())
      .then(data => setAuthRequired(!data.configured))
      .catch(() => {}) // il socket coprirà comunque lo stato non configurato
      .finally(() => setAuthChecked(true))
  }, [])

  useEffect(() => {
    // Connect to WebSocket server with more robust settings
    // In development, connect directly to the server port
    // In production, use the same origin as the served content
    const serverUrl = process.env.NODE_ENV === 'production' ? window.location.origin : 'http://localhost:3001'
    console.log('WebSocket connection attempt to:', serverUrl)
    
    const socketConnection = io(serverUrl, {
      transports: ['websocket', 'polling'],
      upgrade: true,
      rememberUpgrade: true,
      timeout: 20000,
      forceNew: false,
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      maxReconnectionAttempts: 5,
      autoConnect: true
    })

    socketConnection.on('connect', () => {
      console.log('Connected to WebSocket server')
      setConnectionStatus('connected')
    })

    socketConnection.on('disconnect', () => {
      console.log('Disconnected from WebSocket server')
      setConnectionStatus('disconnected')
    })

    socketConnection.on('connect_error', (error) => {
      console.error('WebSocket connection error:', error)
      setConnectionStatus('error')
    })

    // Listen for now playing updates
    socketConnection.on('nowPlaying', (data) => {
      console.log('🔍 RECEIVED nowPlaying event from server:', data);
      
      // Fallback di sicurezza se il server invia null o dati malformati
      if (!data || typeof data !== 'object') {
        console.warn('Received invalid nowPlaying data:', data);
        const fallbackData = {
          isPlaying: false,
          track: {
            title: "Connecting...",
            artist: "System",
            album: "",
            isLastFm: false
          },
          activeUsers: [],
          selectedUser: null
        };
        setNowPlaying(fallbackData);
        return;
      }

      // Se i dati sono già nel formato corretto (con track object), usali direttamente
      if (data.track && typeof data.track === 'object') {
        console.log('🔍 Data already in correct format:', data);
        setNowPlaying(data);
        return;
      }

      // Altrimenti, converti i dati del server nel formato che il client si aspetta (legacy)
      console.log('Key track values:', {
        hasTrack: data.hasTrack,
        trackTitle: data.trackTitle,
        trackArtist: data.trackArtist,
        oldConditionResult: data.hasTrack && data.trackTitle,
        newConditionResult: !!data.trackTitle
      });

      const formattedData = {
        isPlaying: data.isPlaying || false,
        isPaused: data.isPaused || false,
        hasResumeOption: data.hasResumeOption || false,
        pauseTimeRemaining: data.pauseTimeRemaining || 0,
        track: data.trackTitle ? {
          title: data.trackTitle,
          artist: data.trackArtist || 'Unknown artist',
          album: data.trackAlbum || '',
          thumb: data.trackThumb || '',
          parentThumb: data.trackParentThumb || '',
          grandparentThumb: data.trackGrandparentThumb || '',
          duration: data.trackDuration || 0,
          viewOffset: data.trackViewOffset || 0,
          isLastFm: false
        } : null,
        resumeTrack: data.resumeTrack || null,
        activeUsers: Array.isArray(data.activeUsers) ? data.activeUsers : [],
        selectedUser: data.selectedUser || null,
        multiplePlayers: data.multiplePlayers || false
      };

      console.log('🔍 Formatted nowPlaying data (LEGACY):', formattedData);
      setNowPlaying(formattedData);
    })

    socketConnection.on('error', (error) => {
      console.error('WebSocket error:', error)
    })

    // Plex non configurato, oppure il token è stato revocato/è scaduto
    socketConnection.on('authRequired', () => {
      console.log('🔑 Login Plex richiesto')
      setAuthRequired(true)
    })

    setSocket(socketConnection)

    // Cleanup on unmount
    return () => {
      socketConnection.disconnect()
    }
  }, [])

  const sendMediaControl = (action) => {
    if (socket && socket.connected) {
      socket.emit('mediaControl', { type: action })
    }
  }

  const switchUser = (userId) => {
    if (socket && socket.connected) {
      socket.emit('switchUser', userId)
    }
  }

  // Chiamato dalla schermata di login appena il server conferma che Plex è
  // stato configurato, per tornare subito all'interfaccia normale senza
  // aspettare il prossimo evento del socket.
  const markAuthenticated = () => setAuthRequired(false)

  // Chiamato dopo "Disconnetti Plex": la home deve tornare subito al login
  const requireLogin = () => setAuthRequired(true)

  const value = {
    socket,
    nowPlaying,
    connectionStatus,
    sendMediaControl,
    switchUser,
    authRequired,
    authChecked,
    markAuthenticated,
    requireLogin
  }

  return (
    <WebSocketContext.Provider value={value}>
      {children}
    </WebSocketContext.Provider>
  )
}

export default WebSocketContext