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
  const [lastCloseTime, setLastCloseTime] = useState(0)

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

  // Effect to update progress when new data arrives from server
  useEffect(() => {
    if (nowPlaying?.track?.viewOffset !== undefined && nowPlaying?.track?.duration > 0) {
      setInterpolatedProgress((nowPlaying.track.viewOffset / nowPlaying.track.duration) * 100)
      setLastUpdateTime(Date.now())
    }
  }, [nowPlaying?.track?.viewOffset, nowPlaying?.track?.duration])

  // Effect to interpolate progress every second when music is playing
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
        // Don't exceed 100% and stop if we're near the end
        return Math.min(newProgress, 100)
      })
      setLastUpdateTime(now)
    }, 1000)

    return () => clearInterval(interval)
  }, [nowPlaying?.isPlaying, nowPlaying?.track?.duration, lastUpdateTime])

  const handleInteraction = () => {
    // Prevent multiple calls from touch + click
    const now = Date.now()
    
    // Prevent interaction if overlay is already visible
    if (showOverlay) {
      return
    }
    
    // Prevent immediate reopening if overlay was closed recently
    const timeSinceClose = now - lastCloseTime
    if (now - lastCloseTime < 500) { // 500ms delay after closing
      return
    }

    console.log('Interaction detected, showing overlay')
    
    // Clear existing timeout
    if (overlayTimeout) {
      clearTimeout(overlayTimeout)
    }
    
    setShowOverlay(true)
    
    // Set new timeout to hide overlay - longer to give time for animations
    const newTimeout = setTimeout(() => {
      setShowOverlay(false)
    }, 6000) // Increased from 4 to 6 seconds
    
    setOverlayTimeout(newTimeout)
  }

  const handleOverlayInteraction = () => {
    // Reset the timeout when user interacts with overlay
    if (overlayTimeout) {
      clearTimeout(overlayTimeout)
    }
    
    const newTimeout = setTimeout(() => {
      setShowOverlay(false)
    }, 6000) // Increased here too
    
    setOverlayTimeout(newTimeout)
  }

  const handleCloseOverlay = () => {
    // Close overlay immediately when clicking outside
    setShowOverlay(false)
    
    // Clean up existing timeout
    if (overlayTimeout) {
      clearTimeout(overlayTimeout)
      setOverlayTimeout(null)
    }
    
    // Update close timestamp to prevent immediate reopening
    setLastCloseTime(Date.now())
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
            {connectionStatus === 'connecting' && 'Connecting...'}
            {connectionStatus === 'disconnected' && 'Connection lost'}
            {connectionStatus === 'error' && 'Connection error'}
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
          <p>Loading data...</p>
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
        multiplePlayers={nowPlaying.multiplePlayers}
      />
    </div>
  )
}

export default NowPlayingDisplay