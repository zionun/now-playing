import React, { useState, useEffect } from 'react'
import { useWebSocket } from '../context/WebSocketContext'
import './IdleScreen.css'

const IdleScreen = ({ onInteraction, hasResumeOption, resumeTrack, pauseTimeRemaining, isPaused, hasControls = false }) => {
  const { socket } = useWebSocket()
  const [lastfmData, setLastfmData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    // Carica sempre i dati Last.fm per la griglia
    fetchLastfmData()
    
    // Refresh data every 5 minutes
    const interval = setInterval(fetchLastfmData, 5 * 60 * 1000)
    
    return () => clearInterval(interval)
  }, [hasResumeOption])

  const fetchLastfmData = async () => {
    try {
      setLoading(true)
      setError(null)
      
      const response = await fetch('/api/lastfm/idle-data')
      
      if (!response.ok) {
        throw new Error('Last.fm not configured or connection failed')
      }
      
      const data = await response.json()
      setLastfmData(data)
    } catch (err) {
      console.error('Error fetching Last.fm data:', err)
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const handleResume = (event) => {
    event.stopPropagation() // Previene il trigger di onInteraction
    if (!hasControls) return // Non fare nulla se i controlli sono disabilitati
    console.log('handleResume clicked', { socket: !!socket, connected: socket?.connected })
    if (socket && socket.connected) {
      console.log('Richiesta resume da pausa manuale')
      socket.emit('resumeFromPause')
    } else {
      console.error('Socket non connessa per resume')
    }
  }

  const formatScrobbles = (count) => {
    if (count >= 1000000) {
      return `${(count / 1000000).toFixed(1)}M`
    } else if (count >= 1000) {
      return `${(count / 1000).toFixed(1)}K`
    }
    return count.toLocaleString()
  }

  const getAlbumImage = (album) => {
    if (album.image) {
      // Find the largest image
      const largeImage = album.image.find(img => img.size === 'extralarge') ||
                        album.image.find(img => img.size === 'large') ||
                        album.image.find(img => img.size === 'medium') ||
                        album.image[0]
      return largeImage?.['#text'] || '/placeholder-artwork.jpg'
    }
    return '/placeholder-artwork.jpg'
  }

  const getTrackImage = (track) => {
    if (track.image) {
      const largeImage = track.image.find(img => img.size === 'extralarge') ||
                        track.image.find(img => img.size === 'large') ||
                        track.image[0]
      return largeImage?.['#text'] || '/placeholder-artwork.jpg'
    }
    return '/placeholder-artwork.jpg'
  }

  // Function to remove duplicate albums (mantenendo solo deduplicazione)
  const getUniqueAlbums = (albums) => {
    if (!albums || !Array.isArray(albums)) return []
    
    console.log('Albums from Last.fm API:', albums.map(album => ({
      name: album.name,
      artist: album.artist?.name || album.artist,
      playcount: album.playcount,
      rank: album.rank
    })))
    
    // Last.fm weeklyalbumchart già fornisce ordinamento per rank, 
    // quindi manteniamo l'ordine originale
    const uniqueAlbums = albums.slice(0, 12)
    
    console.log('Final albums count:', uniqueAlbums.length)
    
    return uniqueAlbums
  }

  return (
    <div 
      className="idle-screen"
      onClick={onInteraction}
      onTouchStart={onInteraction}
    >
      {loading ? (
        <div className="idle-loading">
          <div className="spinner"></div>
          <p>Caricamento dati Last.fm...</p>
        </div>
      ) : error ? (
        <div className="idle-error">
          <div className="error-icon">♪</div>
          <h2>Nessuna musica in riproduzione</h2>
          <p>Last.fm non configurato o non disponibile</p>
          <small>Tocca per configurare</small>
        </div>
      ) : lastfmData ? (
        <div className="idle-content">
          {/* Scrobbles stat - Grid position 1,1 */}
          <div className="scrobbles-stat">
            <div className="stat-number">{formatScrobbles(lastfmData.scrobbles)}</div>
            <div className="stat-label">Scrobbles</div>
          </div>
          
          {/* Last track or resume track - Grid position 2-4,1 */}
          {hasResumeOption && resumeTrack ? (
            <div className="last-track">
              <div className="track-artwork-container">
                <img 
                  src={resumeTrack.thumb || '/placeholder-artwork.jpg'}
                  alt="Resume artwork"
                  className="track-artwork"
                  onError={(e) => {
                    e.target.src = '/placeholder-artwork.jpg'
                  }}
                />
                <button 
                  className={`play-overlay ${!hasControls ? 'disabled' : ''}`}
                  onClick={handleResume}
                  onTouchStart={handleResume}
                  disabled={!hasControls}
                >
                  <svg viewBox="0 0 24 24" fill="currentColor">
                    <path d="M8 5v14l11-7z"/>
                  </svg>
                  {!hasControls && <div className="spinner"></div>}
                </button>
              </div>
              <div className="track-info-container">
                <div className="track-label">Traccia in pausa</div>
                <div className="track-title">{resumeTrack.title}</div>
                <div className="track-album">{resumeTrack.album || 'Album sconosciuto'}</div>
                <div className="track-artist">{resumeTrack.artist}</div>
              </div>
            </div>
          ) : lastfmData.lastTrack ? (
            <div className="last-track">
              <img 
                src={getTrackImage(lastfmData.lastTrack)}
                alt="Artwork"
                className="track-artwork"
                onError={(e) => {
                  e.target.src = '/placeholder-artwork.jpg'
                }}
              />
              <div className="track-info-container">
                <div className="track-label">Ultima traccia riprodotta</div>
                <div className="track-title">{lastfmData.lastTrack.name}</div>
                <div className="track-album">{lastfmData.lastTrack.album?.['#text'] || 'Album sconosciuto'}</div>
                <div className="track-artist">{lastfmData.lastTrack.artist?.['#text'] || lastfmData.lastTrack.artist}</div>
              </div>
            </div>
          ) : null}

          {/* Top albums - Grid positions 1-4, 2-4 */}
          {lastfmData.topAlbums && lastfmData.topAlbums.length > 0 && (
            <div className="top-albums">
              <div className="albums-grid">
                {lastfmData.topAlbums.map((album, index) => (
                  <div key={`${album.artist?.name || album.artist}-${album.name}-${index}`} className="album-item">
                    <img 
                      src={getAlbumImage(album)}
                      alt={`${album.name} by ${album.artist?.name || album.artist}`}
                      className="album-artwork"
                      onError={(e) => {
                        e.target.src = '/placeholder-artwork.jpg'
                      }}
                    />
                    <div className="album-overlay">
                      <div className="album-name">{album.name}</div>
                      <div className="album-artist">{album.artist?.name || album.artist}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="idle-empty">
          <div className="empty-icon">♪</div>
          <h2>Nessuna musica in riproduzione</h2>
          <p>In attesa di contenuti dal server Plex</p>
        </div>
      )}
    </div>
  )
}

export default IdleScreen