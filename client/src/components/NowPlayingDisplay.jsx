import React, { useState, useEffect } from 'react'
import { useWebSocket } from '../context/WebSocketContext'
import TouchOverlay from './TouchOverlay'
import IdleScreen from './IdleScreen'
import './NowPlayingDisplay.css'

const NowPlayingDisplay = () => {
  const { nowPlaying, connectionStatus } = useWebSocket()
  const [showOverlay, setShowOverlay] = useState(false)
  const [overlayTimeout, setOverlayTimeout] = useState(null)
  const [interpolatedProgress, setInterpolatedProgress] = useState(0)
  const [lastUpdateTime, setLastUpdateTime] = useState(Date.now())

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

  // Effect per aggiornare il progresso quando arrivano nuovi dati dal server
  useEffect(() => {
    if (nowPlaying?.track?.viewOffset !== undefined && nowPlaying?.track?.duration > 0) {
      setInterpolatedProgress((nowPlaying.track.viewOffset / nowPlaying.track.duration) * 100)
      setLastUpdateTime(Date.now())
    }
  }, [nowPlaying?.track?.viewOffset, nowPlaying?.track?.duration])

  // Effect per interpolare il progresso ogni secondo quando la musica è in riproduzione
  useEffect(() => {
    if (!nowPlaying?.isPlaying || !nowPlaying?.track?.duration) {
      return
    }

    const interval = setInterval(() => {
      const now = Date.now()
      const timeSinceUpdate = now - lastUpdateTime
      const progressIncrement = (timeSinceUpdate / nowPlaying.track.duration) * 100
      
      setInterpolatedProgress(prev => {
        const newProgress = prev + progressIncrement
        // Non superare il 100% e fermarsi se siamo vicini alla fine
        return Math.min(newProgress, 100)
      })
      setLastUpdateTime(now)
    }, 1000)

    return () => clearInterval(interval)
  }, [nowPlaying?.isPlaying, nowPlaying?.track?.duration, lastUpdateTime])

  const handleInteraction = (event) => {
    // Previeni multiple chiamate da touch + click
    event.preventDefault()
    
    // Previeni l'interazione se l'overlay è già visibile
    if (showOverlay) {
      return
    }
    
    setShowOverlay(true)
    
    // Clear existing timeout
    if (overlayTimeout) {
      clearTimeout(overlayTimeout)
    }
    
    // Set new timeout to hide overlay - più lungo per dare tempo alle animazioni
    const timeout = setTimeout(() => {
      setShowOverlay(false)
    }, 6000) // Aumentato da 4 a 6 secondi
    
    setOverlayTimeout(timeout)
  }

  const handleOverlayInteraction = () => {
    // Reset the timeout when user interacts with overlay
    if (overlayTimeout) {
      clearTimeout(overlayTimeout)
    }
    
    const timeout = setTimeout(() => {
      setShowOverlay(false)
    }, 6000) // Aumentato anche qui
    
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

  // Safety check for malformed nowPlaying data
  if (!nowPlaying || !nowPlaying.track) {
    return (
      <div className="now-playing-container">
        <div className="connection-status">
          <div className="spinner"></div>
          <p>Caricamento dati...</p>
        </div>
      </div>
    )
  }

  // Show idle screen when no music is playing OR when there's a resume option available
  if ((!nowPlaying.isPlaying && !nowPlaying.isPaused) || nowPlaying.hasResumeOption) {
    return (
      <IdleScreen 
        onInteraction={handleInteraction}
        hasResumeOption={nowPlaying.hasResumeOption}
        resumeTrack={nowPlaying.resumeTrack}
        pauseTimeRemaining={nowPlaying.pauseTimeRemaining}
        isPaused={nowPlaying.isPaused}
        hasControls={nowPlaying.hasControls}
      />
    )
  }

  const { track } = nowPlaying

  // Determine the best artwork to use
  const getArtwork = () => {
    return track.thumb || track.parentThumb || track.grandparentThumb || '/placeholder-artwork.jpg'
  }

  return (
    <div 
      className="now-playing-container"
      onTouchEnd={handleInteraction}
      onClick={handleInteraction}
    >
      {/* Background artwork with blur effect */}
      <div 
        className="background-artwork"
        style={{ backgroundImage: `url(${getArtwork()})` }}
      />
      
      {/* Main content */}
      <div className="main-content">
        {/* Artwork */}
        {/* Artwork */}
        <div className="artwork-container">
          <img 
            src={getArtwork()}
            alt={`${track.title} - ${track.artist}`}
            className="main-artwork"
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
                  width: `${interpolatedProgress}%`
                }}
              />
            </div>
          )}
          
          {/* Pause timer indicator - posizionato sopra l'artwork */}
          {nowPlaying.isPaused && nowPlaying.pauseTimeRemaining > 0 && (
            <div className="pause-timer">
              <div className="pause-indicator">⏸️ In pausa</div>
              <div className="pause-countdown">
                Idle in {Math.ceil(nowPlaying.pauseTimeRemaining / 1000)}s
              </div>
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
        isPlaying={nowPlaying.isPlaying}
        activeUsers={nowPlaying.activeUsers}
        selectedUser={nowPlaying.selectedUser}
        hasControls={nowPlaying.hasControls}
      />
    </div>
  )
}

export default NowPlayingDisplay