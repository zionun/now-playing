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

  useEffect(() => {
    // Connect to WebSocket server with more robust settings
    // In development, connect directly to the server port
    // In production, use the same origin as the served content
    const serverUrl = process.env.NODE_ENV === 'production' ? window.location.origin : 'http://localhost:3001'
    console.log('Tentativo di connessione WebSocket a:', serverUrl)
    
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
      console.log('Ricevuti dati nowPlaying dal server:', data);
      
      // Fallback di sicurezza se il server invia null o dati malformati
      if (!data || typeof data !== 'object') {
        console.warn('Ricevuti dati nowPlaying non validi:', data);
        const fallbackData = {
          isPlaying: false,
          track: {
            title: "Connessione in corso...",
            artist: "Sistema",
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
        console.log('Dati già nel formato corretto:', data);
        setNowPlaying(data);
        return;
      }

      // Altrimenti, converti i dati del server nel formato che il client si aspetta (legacy)
      console.log('Valori chiave per track:', {
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
          artist: data.trackArtist || 'Artista sconosciuto',
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
        selectedUser: data.selectedUser || null
      };

      console.log('Dati nowPlaying formattati:', formattedData);
      console.log('Track risultante:', formattedData.track);
      setNowPlaying(formattedData);
    })

    socketConnection.on('error', (error) => {
      console.error('WebSocket error:', error)
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

  const value = {
    socket,
    nowPlaying,
    connectionStatus,
    sendMediaControl,
    switchUser
  }

  return (
    <WebSocketContext.Provider value={value}>
      {children}
    </WebSocketContext.Provider>
  )
}

export default WebSocketContext