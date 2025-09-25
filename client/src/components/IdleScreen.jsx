import React, { useState, useEffect } from 'react'
import './IdleScreen.css'

const IdleScreen = ({ onInteraction }) => {
  const [lastfmData, setLastfmData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    fetchLastfmData()
    
    // Refresh data every 5 minutes
    const interval = setInterval(fetchLastfmData, 5 * 60 * 1000)
    
    return () => clearInterval(interval)
  }, [])

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

  // Function to remove duplicate albums based on album name and artist
  const getUniqueAlbums = (albums) => {
    if (!albums || !Array.isArray(albums)) return []
    
    console.log('Original albums:', albums.map(album => ({
      name: album.name,
      artist: album.artist?.name || album.artist,
      playcount: album.playcount
    })))
    
    const uniqueMap = new Map()
    
    // Helper function to normalize strings for comparison
    const normalize = (str) => {
      if (!str) return 'unknown'
      return str
        .toLowerCase()
        .trim()
        .replace(/[^\w\s]/g, '') // Remove special characters
        .replace(/\s+/g, ' ')     // Normalize spaces
        .trim()
    }
    
    albums.forEach((album, index) => {
      const artistName = album.artist?.name || album.artist || 'Unknown Artist'
      const albumName = album.name || 'Unknown Album'
      
      const normalizedArtist = normalize(artistName)
      const normalizedAlbum = normalize(albumName)
      const key = `${normalizedArtist}-${normalizedAlbum}`
      
      console.log(`Album ${index}:`, {
        original: `${artistName} - ${albumName}`,
        normalized: key,
        hasKey: uniqueMap.has(key)
      })
      
      // Keep the first occurrence (which should have higher play count from API)
      if (!uniqueMap.has(key)) {
        uniqueMap.set(key, album)
      } else {
        console.log(`Duplicate found: ${artistName} - ${albumName}`)
      }
    })
    
    const uniqueAlbums = Array.from(uniqueMap.values()).slice(0, 12)
    console.log('Final unique albums count:', uniqueAlbums.length)
    
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
          {/* Header row with scrobbles and last track */}
          <div className="stats-row">
            <div className="scrobbles-stat">
              <div className="stat-number">{formatScrobbles(lastfmData.scrobbles)}</div>
              <div className="stat-label">Scrobbles</div>
            </div>
            
            {/* Last track */}
            {lastfmData.lastTrack && (
              <div className="last-track">
                <h3>Ultima traccia</h3>
                <div className="track-card">
                  <img 
                    src={getTrackImage(lastfmData.lastTrack)}
                    alt="Artwork"
                    className="track-artwork"
                    onError={(e) => {
                      e.target.src = '/placeholder-artwork.jpg'
                    }}
                  />
                  <div className="track-details">
                    <div className="track-title">{lastfmData.lastTrack.name}</div>
                    <div className="track-artist">{lastfmData.lastTrack.artist?.['#text'] || lastfmData.lastTrack.artist}</div>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Top albums grid - 4 columns x 3 rows */}
          {lastfmData.topAlbums && lastfmData.topAlbums.length > 0 && (
            <div className="top-albums">
              <h3>Album recenti</h3>
              <div className="albums-grid">
                {getUniqueAlbums(lastfmData.topAlbums).map((album, index) => (
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