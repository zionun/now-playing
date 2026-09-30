import { useState } from 'react'
import { useWebSocket } from '../context/WebSocketContext'
import { useT } from '../i18n'
import './TouchOverlay.css'

const TouchOverlay = ({
  show,
  onClose,
  track,
  isPlaying,
  activeUsers,
  selectedUser,
  hasControls = false,
  multiplePlayers = false,
  multipleUsers = false
}) => {
  const t = useT()
  const { sendMediaControl, switchUser } = useWebSocket()
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

    switchUser(playerId) // Use existing function to switch player
    onClose() // Close overlay after selecting a player
  }

  const handleUserSwitchTouch = (playerId, event) => {
    event.stopPropagation()
    event.preventDefault()
    setLastTouchTime(Date.now())

    switchUser(playerId)
    onClose()
  }

  // Handle click on overlay background to close
  const handleOverlayClick = event => {
    // Only if click is directly on overlay (not on its children)
    if (event.target === event.currentTarget) {
      event.stopPropagation() // Stop event propagation
      onClose() // Use specific close function
    }
  }

  // Handle touch on overlay background to close
  const handleOverlayTouch = event => {
    // Only if touch is directly on overlay (not on its children)
    if (event.target === event.currentTarget) {
      event.preventDefault()
      event.stopPropagation()
      setLastTouchTime(Date.now())
      onClose() // Close overlay with touch
    }
  }

  // Prevent click propagation on controls
  const handleContentClick = event => {
    event.stopPropagation()
  }

  // Every player in play (after the filters) can be chosen, not only the
  // ones of the same user
  const showPlayerSwitch = multiplePlayers && activeUsers?.length > 1

  // Always rendered and only shown/hidden: the first tap on the Pi doesn't
  // have to build the overlay from scratch
  return (
    <div
      className={`touch-overlay ${show ? 'visible' : ''}`}
      aria-hidden={!show}
      onClick={handleOverlayClick}
      onTouchEnd={handleOverlayTouch}
    >
      <div
        className="overlay-content"
        onClick={handleContentClick}
        onTouchEnd={e => e.stopPropagation()} // keep touches on the content from closing it
      >
        {/* Player switcher (when more than one player is playing) */}
        {showPlayerSwitch && (
          <div className="user-switcher">
            <h3>{t('overlay.selectPlayer')}</h3>
            <div className="user-buttons">
              {activeUsers.map(player => (
                <button
                  key={player.id}
                  className={`user-button ${player.id === selectedUser ? 'active' : ''}`}
                  onClick={e => handleUserSwitch(player.id, e)}
                  onTouchStart={e => handleUserSwitchTouch(player.id, e)}
                >
                  <span>{player.name || player.title || t('overlay.unnamedPlayer')}</span>
                  {multipleUsers && player.userTitle && <small>{player.userTitle}</small>}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Media controls: only when the player really accepts commands */}
        {hasControls ? (
          <div className="media-controls">
            <button
              className="control-button"
              onClick={e => handleControlClick('previous', e)}
              onTouchStart={e => handleControlTouch('previous', e)}
              aria-label={t('overlay.previous')}
            >
              <svg viewBox="0 0 24 24" fill="currentColor">
                <path d="M6 6h2v12H6zm3.5 6l8.5 6V6z" />
              </svg>
            </button>

            <button
              className="control-button play-pause"
              onClick={e => handleControlClick(isPlaying ? 'pause' : 'play', e)}
              onTouchStart={e => handleControlTouch(isPlaying ? 'pause' : 'play', e)}
              aria-label={isPlaying ? t('overlay.pause') : t('overlay.play')}
            >
              <svg viewBox="0 0 24 24" fill="currentColor">
                {isPlaying ? <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" /> : <path d="M8 5v14l11-7z" />}
              </svg>
            </button>

            <button
              className="control-button"
              onClick={e => handleControlClick('next', e)}
              onTouchStart={e => handleControlTouch('next', e)}
              aria-label={t('overlay.next')}
            >
              <svg viewBox="0 0 24 24" fill="currentColor">
                <path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z" />
              </svg>
            </button>
          </div>
        ) : (
          <p className="controls-unavailable">{t('overlay.controlsUnavailable')}</p>
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
