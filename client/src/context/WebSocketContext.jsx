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
    // Connect to WebSocket server
    const socketConnection = io(window.location.origin, {
      transports: ['websocket', 'polling']
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
      setNowPlaying(data)
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