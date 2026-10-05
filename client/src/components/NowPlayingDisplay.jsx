import { useState, useEffect, useRef, useCallback } from 'react'
import { useWebSocket } from '../context/WebSocketContext'
import TouchOverlay from './TouchOverlay'
import IdleScreen from './IdleScreen'
import { ConfigQrButton } from './LoginScreen'
import { useT } from '../i18n'
import './NowPlayingDisplay.css'

const NowPlayingDisplay = () => {
  const t = useT()
  const { nowPlaying, connectionStatus, display } = useWebSocket()
  // On-screen controls duration, chosen from the phone (Settings → Screen)
  const controlsTimeout = display?.showControlsTimeout || 4000
  const [showOverlay, setShowOverlay] = useState(false)
  const hideTimer = useRef(null)
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

  // The controls hide by themselves after the chosen time; every use of
  // them (a command, another tap) starts the countdown again
  const startHideTimer = useCallback(() => {
    clearTimeout(hideTimer.current)
    hideTimer.current = setTimeout(() => setShowOverlay(false), controlsTimeout)
  }, [controlsTimeout])

  const closeOverlay = useCallback(() => {
    clearTimeout(hideTimer.current)
    setShowOverlay(false)
  }, [])

  useEffect(() => () => clearTimeout(hideTimer.current), [])

  // A tap anywhere opens the controls. pointerdown only: it comes once per
  // tap, as soon as the finger touches the screen, and unlike touchend/click
  // it isn't lost when the finger moves slightly. The touch, mouse and click
  // events the browser makes from the same tap have no handler, so they
  // can't close the controls just opened.
  const openOverlay = () => {
    setShowOverlay(true)
    startHideTimer()
  }

  // The ⚙︎ settings button is always shown on the idle, Last.fm and loading
  // screens, but on the now playing screen only while the controls are open.
  // Same position in every branch, so an open settings QR panel survives a
  // change of screen.
  const withSettings = (content, settingsVisible) => (
    <>
      {content}
      <ConfigQrButton visible={settingsVisible} />
    </>
  )

  // Show connection status if not connected
  if (connectionStatus !== 'connected') {
    return withSettings(
      <div className="now-playing-container">
        <div className="connection-status">
          <div className="spinner"></div>
          <p>
            {connectionStatus === 'connecting' && t('connection.connecting')}
            {connectionStatus === 'disconnected' && t('connection.lost')}
            {connectionStatus === 'error' && t('connection.error')}
          </p>
        </div>
      </div>,
      true
    )
  }

  // Safety check for malformed nowPlaying data
  if (!nowPlaying || !nowPlaying.track) {
    return withSettings(
      <div className="now-playing-container">
        <div className="connection-status">
          <div className="spinner"></div>
          <p>{t('connection.loading')}</p>
        </div>
      </div>,
      true
    )
  }

  // Show idle screen when no music is playing OR when there's a resume option available
  if ((!nowPlaying.isPlaying && !nowPlaying.isPaused) || nowPlaying.hasResumeOption) {
    return withSettings(
      <IdleScreen
        hasResumeOption={nowPlaying.hasResumeOption}
        resumeTrack={nowPlaying.resumeTrack}
        hasControls={nowPlaying.hasControls}
      />,
      true
    )
  }

  const { track } = nowPlaying

  // Determine the best artwork to use
  const getArtwork = () => {
    return track.thumb || track.parentThumb || track.grandparentThumb || '/placeholder-artwork.jpg'
  }

  return withSettings(
    <div className="now-playing-container" onPointerDown={showOverlay ? undefined : openOverlay}>
      {/* Background artwork with blur effect */}
      <div className="background-artwork" style={{ backgroundImage: `url(${getArtwork()})` }} />

      {/* Main content */}
      <div className="main-content">
        {/* Artwork */}
        <div className="artwork-container">
          <img
            src={getArtwork()}
            alt={`${track.title} - ${track.artist}`}
            className="main-artwork"
            onError={e => {
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

          {/* Pause countdown, over the artwork */}
          {nowPlaying.isPaused && nowPlaying.pauseTimeRemaining > 0 && (
            <div className="pause-timer">
              <div className="pause-indicator">⏸️ {t('playing.paused')}</div>
              <div className="pause-countdown">
                {t('playing.idleIn', { seconds: Math.ceil(nowPlaying.pauseTimeRemaining / 1000) })}
              </div>
            </div>
          )}
        </div>

        {/* Track info */}
        <div className="track-info">
          <h1 className="track-title">{track.title}</h1>
          <h2 className="track-artist">{track.artist}</h2>
          {track.album && <h3 className="track-album">{track.album}</h3>}
        </div>
      </div>

      {/* Touch overlay with controls */}
      <TouchOverlay
        show={showOverlay}
        onClose={closeOverlay}
        onActivity={startHideTimer}
        track={track}
        isPlaying={nowPlaying.isPlaying}
        activeUsers={nowPlaying.activeUsers}
        selectedUser={nowPlaying.selectedUser}
        hasControls={nowPlaying.hasControls}
        multiplePlayers={nowPlaying.multiplePlayers}
        multipleUsers={nowPlaying.multipleUsers}
      />
    </div>,
    showOverlay
  )
}

export default NowPlayingDisplay
