import React, { useState, useEffect } from 'react'
import { useWebSocket } from '../context/WebSocketContext'
import './TouchOverlay.css'

const TouchOverlay = ({ show, onInteraction, onClose, track, isPlaying, activeUsers, selectedUser, hasControls = false, multiplePlayers = false }) => {
  const { sendMediaControl, switchUser } = useWebSocket()
  const [isAnimating, setIsAnimating] = useState(false)
  const [lastTouchTime, setLastTouchTime] = useState(0)

  const handleControlClick = (action, event) => {
    event.stopPropagation()
    event.preventDefault() // Prevent default behavior
    if (!hasControls) return // Do nothing if controls are disabled
    
    // Avoid touch/click event duplication
    const now = Date.now()
    if (now - lastTouchTime < 300) return // Ignore click if there was a touch in the last 300ms
    
    sendMediaControl(action)
    onClose() // Close overlay immediately after pressing a control
  }

  const handleControlTouch = (action, event) => {
    event.stopPropagation()
    event.preventDefault() // Prevent default behavior
    if (!hasControls) return // Do nothing if controls are disabled
    
    setLastTouchTime(Date.now())
    sendMediaControl(action)
    onClose() // Close overlay immediately after pressing a control
  }

  const handleUserSwitch = (playerId, event) => {
    event.stopPropagation()
    event.preventDefault()
    console.log('🔄 Switching to player:', playerId)
    
    switchUser(playerId) // Use existing function to switch player
    onClose() // Close overlay after selecting a player
  }

  const handleUserSwitchTouch = (playerId, event) => {
    event.stopPropagation()
    event.preventDefault()
    setLastTouchTime(Date.now())
    console.log('🔄 Touch switching to player:', playerId)
    
    switchUser(playerId)
    onClose()
  }

  // Handle click on overlay background to close
  const handleOverlayClick = (event) => {
    // Only if click is directly on overlay (not on its children)
    if (event.target === event.currentTarget) {
      event.stopPropagation() // Stop event propagation
      onClose() // Use specific close function
    }
  }

  // Handle touch on overlay background to close
  const handleOverlayTouch = (event) => {
    // Only if touch is directly on overlay (not on its children)
    if (event.target === event.currentTarget) {
      event.preventDefault()
      event.stopPropagation()
      setLastTouchTime(Date.now())
      onClose() // Close overlay with touch
    }
  }

  // Prevent click propagation on controls
  const handleContentClick = (event) => {
    event.stopPropagation()
  }

  if (!show) {
    return null
  }

  const showPlayerSwitch = multiplePlayers && activeUsers && activeUsers.length > 1

  return (
    <div 
      className="touch-overlay"
      onClick={handleOverlayClick}
      onTouchEnd={handleOverlayTouch}
    >
      <div 
        className="overlay-content"
        onClick={handleContentClick}
        onTouchEnd={(e) => e.stopPropagation()} // Previeni propagazione touch anche sul contenuto
      >
        {/* Player switcher (if multiple players of same user) */}
        {showPlayerSwitch && (
          <div className="user-switcher">
            <h3>Select player:</h3>
            <div className="user-buttons">
              {activeUsers.map(player => (
                <button
                  key={player.id}
                  className={`user-button ${player.id === selectedUser ? 'active' : ''}`}
                  onClick={(e) => handleUserSwitch(player.id, e)}
                  onTouchStart={(e) => handleUserSwitchTouch(player.id, e)}
                >
                  <span>{player.name || player.title || 'Unnamed player'}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Media controls: solo se il player accetta davvero comandi */}
        {hasControls ? (
        <div className="media-controls">
          <button 
            className="control-button"
            onClick={(e) => handleControlClick('previous', e)}
            onTouchStart={(e) => handleControlTouch('previous', e)}
            aria-label="Previous track"
          >
            <svg viewBox="0 0 24 24" fill="currentColor">
              <path d="M6 6h2v12H6zm3.5 6l8.5 6V6z"/>
            </svg>
          </button>

          <button 
            className="control-button play-pause"
            onClick={(e) => handleControlClick(isPlaying ? 'pause' : 'play', e)}
            onTouchStart={(e) => handleControlTouch(isPlaying ? 'pause' : 'play', e)}
            aria-label={isPlaying ? "Pause" : "Play"}
          >
            <svg viewBox="0 0 24 24" fill="currentColor">
              {isPlaying ? (
                <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>
              ) : (
                <path d="M8 5v14l11-7z"/>
              )}
            </svg>
          </button>

          <button 
            className="control-button"
            onClick={(e) => handleControlClick('next', e)}
            onTouchStart={(e) => handleControlTouch('next', e)}
            aria-label="Next track"
          >
            <svg viewBox="0 0 24 24" fill="currentColor">
              <path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z"/>
            </svg>
          </button>
        </div>
        ) : (
          <p className="controls-unavailable">Questo player non accetta comandi da qui</p>
        )}

        {/* Current track info */}
        <div className="overlay-track-info">
          <h2>{track?.title}</h2>
          <p>{track?.artist}</p>
        </div>
      </div>
    </div>
  )
}

export default TouchOverlay