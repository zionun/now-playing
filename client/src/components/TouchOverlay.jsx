import React, { useState, useEffect } from 'react'
import { useWebSocket } from '../context/WebSocketContext'
import './TouchOverlay.css'

const TouchOverlay = ({ show, onInteraction, onClose, track, isPlaying, activeUsers, selectedUser, hasControls = false }) => {
  const { sendMediaControl, switchUser } = useWebSocket()
  const [isAnimating, setIsAnimating] = useState(false)

  const handleControlClick = (action, event) => {
    event.stopPropagation()
    if (!hasControls) return // Non fare nulla se i controlli sono disabilitati
    onInteraction()
    sendMediaControl(action)
  }

  const handleUserSwitch = (userId, event) => {
    event.stopPropagation()
    onInteraction()
    switchUser(userId)
  }

  // Gestisci clic sull'overlay di sfondo per chiudere
  const handleOverlayClick = (event) => {
    // Solo se il clic è direttamente sull'overlay (non sui suoi figli)
    if (event.target === event.currentTarget) {
      event.stopPropagation() // Ferma la propagazione dell'evento
      onClose() // Usa la funzione di chiusura specifica
    }
  }

  // Previeni la propagazione del clic sui controlli
  const handleContentClick = (event) => {
    event.stopPropagation()
  }

  if (!show) {
    return null
  }

  const showUserSwitch = activeUsers.length > 1

  return (
    <div 
      className="touch-overlay"
      onClick={handleOverlayClick}
      onTouchStart={(e) => e.stopPropagation()} // Previeni la propagazione anche del touch
    >
      <div 
        className="overlay-content"
        onClick={handleContentClick}
      >
        {/* User switcher (if multiple users) */}
        {showUserSwitch && (
          <div className="user-switcher">
            <h3>Seleziona utente:</h3>
            <div className="user-buttons">
              {activeUsers.map(user => (
                <button
                  key={user.id}
                  className={`user-button ${user.id === selectedUser ? 'active' : ''}`}
                  onClick={(e) => handleUserSwitch(user.id, e)}
                >
                  {user.thumb && (
                    <img src={user.thumb} alt={user.title} className="user-avatar" />
                  )}
                  <span>{user.title}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Media controls */}
        <div className="media-controls">
          <button 
            className={`control-button ${!hasControls ? 'disabled' : ''}`}
            onClick={(e) => handleControlClick('previous', e)}
            aria-label="Previous track"
            disabled={!hasControls}
          >
            <svg viewBox="0 0 24 24" fill="currentColor">
              <path d="M6 6h2v12H6zm3.5 6l8.5 6V6z"/>
            </svg>
            {!hasControls && <div className="spinner"></div>}
          </button>

          <button 
            className={`control-button play-pause ${!hasControls ? 'disabled' : ''}`}
            onClick={(e) => handleControlClick(isPlaying ? 'pause' : 'play', e)}
            aria-label={isPlaying ? "Pause" : "Play"}
            disabled={!hasControls}
          >
            <svg viewBox="0 0 24 24" fill="currentColor">
              {isPlaying ? (
                <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>
              ) : (
                <path d="M8 5v14l11-7z"/>
              )}
            </svg>
            {!hasControls && <div className="spinner"></div>}
          </button>

          <button 
            className={`control-button ${!hasControls ? 'disabled' : ''}`}
            onClick={(e) => handleControlClick('next', e)}
            aria-label="Next track"
            disabled={!hasControls}
          >
            <svg viewBox="0 0 24 24" fill="currentColor">
              <path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z"/>
            </svg>
            {!hasControls && <div className="spinner"></div>}
          </button>
        </div>

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