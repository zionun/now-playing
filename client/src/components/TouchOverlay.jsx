import React from 'react'
import { useWebSocket } from '../context/WebSocketContext'
import './TouchOverlay.css'

const TouchOverlay = ({ show, onInteraction, track, activeUsers, selectedUser }) => {
  const { sendMediaControl, switchUser } = useWebSocket()

  const handleControlClick = (action, event) => {
    event.stopPropagation()
    onInteraction()
    sendMediaControl(action)
  }

  const handleUserSwitch = (userId, event) => {
    event.stopPropagation()
    onInteraction()
    switchUser(userId)
  }

  if (!show) return null

  const showUserSwitch = activeUsers.length > 1

  return (
    <div className="touch-overlay">
      <div className="overlay-content">
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
            className="control-button"
            onClick={(e) => handleControlClick('previous', e)}
            aria-label="Previous track"
          >
            <svg viewBox="0 0 24 24" fill="currentColor">
              <path d="M6 6h2v12H6zm3.5 6l8.5 6V6z"/>
            </svg>
          </button>

          <button 
            className="control-button play-pause"
            onClick={(e) => handleControlClick('pause', e)}
            aria-label="Pause"
          >
            <svg viewBox="0 0 24 24" fill="currentColor">
              <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>
            </svg>
          </button>

          <button 
            className="control-button"
            onClick={(e) => handleControlClick('next', e)}
            aria-label="Next track"
          >
            <svg viewBox="0 0 24 24" fill="currentColor">
              <path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z"/>
            </svg>
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