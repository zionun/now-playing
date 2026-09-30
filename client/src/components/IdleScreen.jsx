import { useState, useEffect } from 'react'
import { useWebSocket } from '../context/WebSocketContext'
import { useT } from '../i18n'
import './IdleScreen.css'

const PLACEHOLDER = '/placeholder-artwork.jpg'
const REFRESH_MS = 5 * 60 * 1000

// Largest image Last.fm provides for an album or track
const bestImage = (images, sizes) => {
  if (!images) return PLACEHOLDER
  const found = sizes.map(size => images.find(img => img.size === size)).find(Boolean) || images[0]
  return found?.['#text'] || PLACEHOLDER
}

const formatScrobbles = count => {
  if (count >= 1000000) return `${(count / 1000000).toFixed(1)}M`
  if (count >= 1000) return `${(count / 1000).toFixed(1)}K`
  return count.toLocaleString()
}

const showPlaceholder = e => {
  e.target.src = PLACEHOLDER
}

const IdleScreen = ({ onInteraction, hasResumeOption, resumeTrack, hasControls = false }) => {
  const t = useT()
  const { socket, configVersion, display } = useWebSocket()
  // Last.fm when idle can be turned off from the phone (Settings → Screen)
  const lastfmEnabled = display?.enableLastfmIdle !== false
  const [lastfmData, setLastfmData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const [lastTouchTime, setLastTouchTime] = useState(0)

  useEffect(() => {
    if (!lastfmEnabled) {
      setLastfmData(null)
      setLoading(false)
      return undefined
    }

    const fetchLastfmData = async () => {
      try {
        setLoading(true)
        setFailed(false)
        const response = await fetch('/api/lastfm/idle-data')
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        setLastfmData(await response.json())
      } catch {
        setFailed(true)
      } finally {
        setLoading(false)
      }
    }

    fetchLastfmData()
    const interval = setInterval(fetchLastfmData, REFRESH_MS)
    return () => clearInterval(interval)
    // configVersion: Last.fm just linked or changed from the phone
  }, [hasResumeOption, configVersion, lastfmEnabled])

  const handleResume = event => {
    event.stopPropagation() // don't trigger onInteraction
    event.preventDefault()
    if (!hasControls) return

    // A tap fires touchstart and then click: handle it only once
    if (event.type === 'click' && Date.now() - lastTouchTime < 300) return
    if (event.type === 'touchstart') setLastTouchTime(Date.now())

    if (socket && socket.connected) {
      socket.emit('resumeFromPause')
    }
  }

  const nothingPlaying = extra => (
    <div className="idle-error">
      <div className="error-icon">♪</div>
      <h2>{t('idle.nothingPlaying')}</h2>
      {extra}
    </div>
  )

  let content
  if (!lastfmEnabled) {
    content = nothingPlaying(
      hasResumeOption && resumeTrack && (
        <button
          className="idle-resume-button"
          onClick={handleResume}
          onTouchStart={handleResume}
          disabled={!hasControls}
        >
          ▶ {resumeTrack.title} — {resumeTrack.artist}
        </button>
      )
    )
  } else if (loading) {
    content = (
      <div className="idle-loading">
        <div className="spinner"></div>
        <p>{t('idle.loadingLastfm')}</p>
      </div>
    )
  } else if (failed) {
    content = nothingPlaying(
      <>
        <p>{t('idle.lastfmUnavailable')}</p>
        <small>{t('idle.tapToConfigure')}</small>
      </>
    )
  } else if (lastfmData) {
    const lastTrack = lastfmData.lastTrack
    content = (
      <div className="idle-content">
        {/* Scrobbles stat - grid position 1,1 */}
        <div className="scrobbles-stat">
          <div className="stat-number">{formatScrobbles(lastfmData.scrobbles)}</div>
          <div className="stat-label">{t('idle.scrobbles')}</div>
        </div>

        {/* Paused track to resume, or last played track - grid positions 2-4,1 */}
        {hasResumeOption && resumeTrack ? (
          <div className="last-track">
            <div className="track-artwork-container">
              <img
                src={resumeTrack.thumb || PLACEHOLDER}
                alt={t('idle.resume')}
                className="track-artwork"
                onError={showPlaceholder}
              />
              <button
                className={`play-overlay ${!hasControls ? 'disabled' : ''}`}
                onClick={handleResume}
                onTouchStart={handleResume}
                disabled={!hasControls}
                aria-label={t('idle.resume')}
              >
                <svg viewBox="0 0 24 24" fill="currentColor">
                  <path d="M8 5v14l11-7z" />
                </svg>
              </button>
            </div>
            <div className="track-info-container">
              <div className="track-label">{t('idle.pausedTrack')}</div>
              <div className="track-title">{resumeTrack.title}</div>
              <div className="track-album">{resumeTrack.album || t('idle.unknownAlbum')}</div>
              <div className="track-artist">{resumeTrack.artist}</div>
            </div>
          </div>
        ) : lastTrack ? (
          <div className="last-track">
            <img
              src={bestImage(lastTrack.image, ['extralarge', 'large'])}
              alt=""
              className="track-artwork"
              onError={showPlaceholder}
            />
            <div className="track-info-container">
              <div className="track-label">{t('idle.lastPlayed')}</div>
              <div className="track-title">{lastTrack.name}</div>
              <div className="track-album">{lastTrack.album?.['#text'] || t('idle.unknownAlbum')}</div>
              <div className="track-artist">{lastTrack.artist?.['#text'] || lastTrack.artist}</div>
            </div>
          </div>
        ) : null}

        {/* Top albums - grid positions 1-4, 2-4 */}
        {lastfmData.topAlbums?.length > 0 && (
          <div className="top-albums">
            <div className="albums-grid">
              {lastfmData.topAlbums.map((album, index) => {
                const artist = album.artist?.name || album.artist
                return (
                  <div key={`${artist}-${album.name}-${index}`} className="album-item">
                    <img
                      src={bestImage(album.image, ['extralarge', 'large', 'medium'])}
                      alt={`${album.name} — ${artist}`}
                      className="album-artwork"
                      onError={showPlaceholder}
                    />
                    <div className="album-overlay">
                      <div className="album-name">{album.name}</div>
                      <div className="album-artist">{artist}</div>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>
    )
  } else {
    content = (
      <div className="idle-empty">
        <div className="empty-icon">♪</div>
        <h2>{t('idle.nothingPlaying')}</h2>
        <p>{t('idle.waitingPlex')}</p>
      </div>
    )
  }

  return (
    <div className="idle-screen" onClick={onInteraction} onTouchStart={onInteraction}>
      {content}
    </div>
  )
}

export default IdleScreen
