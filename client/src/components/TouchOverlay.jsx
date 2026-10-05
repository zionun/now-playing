import { useWebSocket } from '../context/WebSocketContext'
import { useT } from '../i18n'
import './TouchOverlay.css'

const TouchOverlay = ({
  show,
  onClose,
  onActivity,
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
  // Every handler is on pointerdown: it comes once per tap (touch or mouse),
  // as soon as the finger touches the screen. The touch, mouse and click
  // events the browser makes from the same tap have no handler here.

  // A command keeps the controls open (pause, then play again, or several
  // skips in a row) and restarts their countdown
  const handleControl = (action, event) => {
    event.stopPropagation()
    event.preventDefault()
    if (!hasControls) return
    sendMediaControl(action)
    onActivity?.()
  }

  const handleUserSwitch = (playerId, event) => {
    event.stopPropagation()
    event.preventDefault()
    switchUser(playerId)
    onClose()
  }

  // A tap outside the controls closes them; one on the content restarts the
  // countdown
  const handleOverlayPress = event => {
    event.stopPropagation()
    if (event.target === event.currentTarget) onClose()
    else onActivity?.()
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
      onPointerDown={handleOverlayPress}
    >
      <div className="overlay-content">
        {/* Player switcher (when more than one player is playing) */}
        {showPlayerSwitch && (
          <div className="user-switcher">
            <h3>{t('overlay.selectPlayer')}</h3>
            <div className="user-buttons">
              {activeUsers.map(player => (
                <button
                  key={player.id}
                  className={`user-button ${player.id === selectedUser ? 'active' : ''}`}
                  onPointerDown={e => handleUserSwitch(player.id, e)}
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
              onPointerDown={e => handleControl('previous', e)}
              aria-label={t('overlay.previous')}
            >
              <svg viewBox="0 0 24 24" fill="currentColor">
                <path d="M6 6h2v12H6zm3.5 6l8.5 6V6z" />
              </svg>
            </button>

            <button
              className="control-button play-pause"
              onPointerDown={e => handleControl(isPlaying ? 'pause' : 'play', e)}
              aria-label={isPlaying ? t('overlay.pause') : t('overlay.play')}
            >
              <svg viewBox="0 0 24 24" fill="currentColor">
                {isPlaying ? <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" /> : <path d="M8 5v14l11-7z" />}
              </svg>
            </button>

            <button
              className="control-button"
              onPointerDown={e => handleControl('next', e)}
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
