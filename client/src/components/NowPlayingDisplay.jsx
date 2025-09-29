import React, { useState, useEffect } from 'react'
import { useWebSocket } from '../context/WebSocketContext'
import TouchOverlay from './TouchOverlay'
import IdleScreen from './IdleScreen'
import './NowPlayingDisplay.css'

const NowPlayingDisplay = () => {
  const { nowPlaying, connectionStatus } = useWebSocket()
  const [showOverlay, setShowOverlay] = useState(false)
  const [overlayTimeout, setOverlayTimeout] = useState(null)

  // Apply kiosk mode styles (no scroll) for the main display
  useEffect(() => {
    document.body.style.overflow = 'hidden'
    document.documentElement.style.overflow = 'hidden'
    
    return () => {
      // Reset when component unmounts
      document.body.style.overflow = 'auto'
      document.documentElement.style.overflow = 'auto'
    }
  }, [])

  const handleInteraction = (event) => {
    // Previeni l'interazione se l'overlay è già visibile
    if (showOverlay) {
      return
    }
    
    setShowOverlay(true)
    
    // Clear existing timeout
    if (overlayTimeout) {
      clearTimeout(overlayTimeout)
    }
    
    // Set new timeout to hide overlay
    const timeout = setTimeout(() => {
      setShowOverlay(false)
    }, 4000)
    
    setOverlayTimeout(timeout)
  }

  const handleOverlayInteraction = () => {
    // Reset the timeout when user interacts with overlay
    if (overlayTimeout) {
      clearTimeout(overlayTimeout)
    }
    
    const timeout = setTimeout(() => {
      setShowOverlay(false)
    }, 4000)
    
    setOverlayTimeout(timeout)
  }

  const handleCloseOverlay = () => {
    // Chiudi immediatamente l'overlay quando si clicca fuori
    setShowOverlay(false)
    
    // Pulisci il timeout esistente
    if (overlayTimeout) {
      clearTimeout(overlayTimeout)
      setOverlayTimeout(null)
    }
  }

  // Clean up timeout on unmount
  useEffect(() => {
    return () => {
      if (overlayTimeout) {
        clearTimeout(overlayTimeout)
      }
    }
  }, [overlayTimeout])

  // Show connection status if not connected
  if (connectionStatus !== 'connected') {
    return (
      <div className="now-playing-container">
        <div className="connection-status">
          <div className="spinner"></div>
          <p>
            {connectionStatus === 'connecting' && 'Connessione in corso...'}
            {connectionStatus === 'disconnected' && 'Connessione persa'}
            {connectionStatus === 'error' && 'Errore di connessione'}
          </p>
        </div>
      </div>
    )
  }

  // Show idle screen when no music is playing
  if (!nowPlaying.isPlaying) {
    return <IdleScreen onInteraction={handleInteraction} />
  }

  const { track } = nowPlaying

  // Determine the best artwork to use
  const getArtwork = () => {
    return track.thumb || track.parentThumb || track.grandparentThumb || '/placeholder-artwork.jpg'
  }

  return (
    <div 
      className="now-playing-container"
      onClick={handleInteraction}
      onTouchStart={handleInteraction}
    >
      {/* Background artwork with blur effect */}
      <div 
        className="background-artwork"
        style={{ backgroundImage: `url(${getArtwork()})` }}
      />
      
      {/* Main content */}
      <div className="main-content">
        {/* Artwork */}
        <div className="artwork-container">
          <img 
            src={getArtwork()}
            alt={`${track.title} artwork`}
            className="artwork"
            onError={(e) => {
              e.target.src = '/placeholder-artwork.jpg'
            }}
          />
          
          {/* Progress indicator */}
          {track.duration > 0 && (
            <div className="progress-container">
              <div 
                className="progress-bar"
                style={{
                  width: `${(track.viewOffset / track.duration) * 100}%`
                }}
              />
            </div>
          )}
        </div>
        
        {/* Track info */}
        <div className="track-info">
          <h1 className="track-title">{track.title}</h1>
          <h2 className="track-artist">{track.artist}</h2>
          {track.album && (
            <h3 className="track-album">{track.album}</h3>
          )}
        </div>
      </div>
      
      {/* Touch overlay with controls */}
      <TouchOverlay 
        show={showOverlay}
        onInteraction={handleOverlayInteraction}
        onClose={handleCloseOverlay}
        track={track}
        activeUsers={nowPlaying.activeUsers}
        selectedUser={nowPlaying.selectedUser}
      />
    </div>
  )
}

export default NowPlayingDisplay