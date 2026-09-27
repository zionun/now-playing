import React, { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import './ConfigurationPanel.css'

const ConfigurationPanel = () => {
  const navigate = useNavigate()
  
  // Enable scrolling for config page
  useEffect(() => {
    document.body.style.overflow = 'auto'
    document.documentElement.style.overflow = 'auto'
    
    return () => {
      // Restore original overflow when leaving config page
      document.body.style.overflow = 'hidden'
      document.documentElement.style.overflow = 'hidden'
    }
  }, [])
  const [config, setConfig] = useState(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [password, setPassword] = useState('')
  const [isAuthenticated, setIsAuthenticated] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  
  // Form state
  const [formData, setFormData] = useState({
    plex: {
      url: '',
      port: 32400,
      token: '',
      preferredUser: ''
    },
    lastfm: {
      username: '',
      apiKey: '',
      apiSecret: ''
    },
    display: {
      showControlsTimeout: 4000,
      enableLastfmIdle: true
    },
    users: {
      configPassword: ''
    }
  })

  useEffect(() => {
    loadConfig()
  }, [])

  const loadConfig = async () => {
    try {
      const response = await fetch('/api/config')
      if (response.ok) {
        const configData = await response.json()
        setConfig(configData)
        setFormData({
          plex: {
            url: configData.plex.url || '',
            port: configData.plex.port || 32400,
            token: configData.plex.token === '***' ? '' : configData.plex.token || '',
            preferredUser: configData.plex.preferredUser || ''
          },
          lastfm: {
            username: configData.lastfm.username || '',
            apiKey: configData.lastfm.apiKey === '***' ? '' : configData.lastfm.apiKey || '',
            apiSecret: configData.lastfm.apiSecret === '***' ? '' : configData.lastfm.apiSecret || ''
          },
          display: {
            showControlsTimeout: configData.display?.showControlsTimeout || 4000,
            enableLastfmIdle: configData.display?.enableLastfmIdle !== false
          },
          users: {
            configPassword: ''
          }
        })
        
        // If no password is set, authenticate immediately
        if (!configData.hasPassword) {
          setIsAuthenticated(true)
        }
      }
    } catch (err) {
      setError('Errore nel caricamento della configurazione')
    } finally {
      setLoading(false)
    }
  }

  const handleAuthentication = async (e) => {
    e.preventDefault()
    setError('')
    
    try {
      const response = await fetch('/api/config/verify-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password })
      })
      
      const result = await response.json()
      
      if (result.valid) {
        setIsAuthenticated(true)
      } else {
        setError('Password non corretta')
      }
    } catch (err) {
      setError('Errore di autenticazione')
    }
  }

  const handleInputChange = (section, field, value) => {
    setFormData(prev => ({
      ...prev,
      [section]: {
        ...prev[section],
        [field]: value
      }
    }))
    setError('')
    setSuccess('')
  }

  const testPlexConnection = async () => {
    setError('')
    setSuccess('')
    
    try {
      const response = await fetch('/api/plex/test-connection', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: formData.plex.url,
          port: formData.plex.port,
          token: formData.plex.token
        })
      })
      
      if (response.ok) {
        const result = await response.json()
        setSuccess(`Connessione Plex riuscita! Server: ${result.server}`)
      } else {
        const error = await response.json()
        setError(`Errore connessione Plex: ${error.error}`)
      }
    } catch (err) {
      setError('Errore nel test della connessione Plex')
    }
  }

  const disconnectPlex = async () => {
    setError('')
    setSuccess('')

    try {
      const response = await fetch('/api/auth/logout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password })
      })

      if (response.ok) {
        setSuccess('Plex disconnesso. Torna alla home per rifare il login con il QR code.')
        setFormData(prev => ({ ...prev, plex: { ...prev.plex, token: '' } }))
      } else {
        const error = await response.json()
        setError(`Errore nella disconnessione: ${error.error}`)
      }
    } catch (err) {
      setError('Errore nella disconnessione da Plex')
    }
  }

  const testLastfmConnection = async () => {
    setError('')
    setSuccess('')
    
    try {
      const response = await fetch('/api/lastfm/test-connection', {
        method: 'POST'
      })
      
      if (response.ok) {
        const result = await response.json()
        setSuccess(`Connessione Last.fm riuscita! Utente: ${result.username}`)
      } else {
        const error = await response.json()
        setError(`Errore connessione Last.fm: ${error.error}`)
      }
    } catch (err) {
      setError('Errore nel test della connessione Last.fm')
    }
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setSaving(true)
    setError('')
    setSuccess('')
    
    try {
      // Prepare config data, excluding empty password
      const configToSave = {
        ...formData,
        users: formData.users.configPassword ? formData.users : undefined
      }
      
      const response = await fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          password,
          config: configToSave
        })
      })
      
      if (response.ok) {
        setSuccess('Configurazione salvata con successo!')
        setTimeout(() => {
          navigate('/')
        }, 2000)
      } else {
        const error = await response.json()
        setError(`Errore nel salvataggio: ${error.error}`)
      }
    } catch (err) {
      setError('Errore nel salvataggio della configurazione')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="config-container" style={{ height: '100vh', overflowY: 'auto' }}>
        <div className="config-loading">
          <div className="spinner"></div>
          <p>Caricamento configurazione...</p>
        </div>
      </div>
    )
  }

  if (!isAuthenticated) {
    return (
      <div className="config-container" style={{ height: '100vh', overflowY: 'auto' }}>
        <div className="auth-form">
          <h1>Accesso Configurazione</h1>
          <form onSubmit={handleAuthentication}>
            <div className="form-group">
              <label htmlFor="password">Password:</label>
              <input
                type="password"
                id="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoFocus
              />
            </div>
            
            {error && <div className="error-message">{error}</div>}
            
            <button type="submit" className="btn btn-primary">
              Accedi
            </button>
            
            <button 
              type="button" 
              onClick={() => navigate('/')}
              className="btn btn-secondary"
            >
              Torna alla home
            </button>
          </form>
        </div>
      </div>
    )
  }

  return (
    <div className="config-container" style={{ height: '100vh', overflowY: 'auto' }}>
      <div className="config-header">
        <h1>Configurazione Now Playing</h1>
        <button onClick={() => navigate('/')} className="btn btn-secondary">
          Torna alla home
        </button>
      </div>

      <form onSubmit={handleSubmit} className="config-form">
        {/* Plex Configuration */}
        <section className="config-section">
          <h2>Configurazione Plex</h2>
          
          <div className="form-group">
            <label htmlFor="plex-url">URL Server Plex:</label>
            <input
              type="text"
              id="plex-url"
              value={formData.plex.url}
              onChange={(e) => handleInputChange('plex', 'url', e.target.value)}
              placeholder="192.168.1.100"
              required
            />
          </div>
          
          <div className="form-group">
            <label htmlFor="plex-port">Porta:</label>
            <input
              type="number"
              id="plex-port"
              value={formData.plex.port}
              onChange={(e) => handleInputChange('plex', 'port', parseInt(e.target.value))}
              min="1"
              max="65535"
              required
            />
          </div>
          
          <div className="form-group">
            <label htmlFor="plex-token">Token Plex:</label>
            <input
              type="password"
              id="plex-token"
              value={formData.plex.token}
              onChange={(e) => handleInputChange('plex', 'token', e.target.value)}
              placeholder={config?.plex?.token ? 'Lascia vuoto per non modificarlo' : 'Token di accesso Plex'}
            />
          </div>
          
          <div className="form-group">
            <label htmlFor="preferred-user">Utente preferito (opzionale):</label>
            <input
              type="text"
              id="preferred-user"
              value={formData.plex.preferredUser}
              onChange={(e) => handleInputChange('plex', 'preferredUser', e.target.value)}
              placeholder="Lascia vuoto per mostrare qualsiasi utente"
            />
          </div>
          
          <button type="button" onClick={testPlexConnection} className="btn btn-test">
            Testa connessione Plex
          </button>

          {config?.plex?.token && (
            <button type="button" onClick={disconnectPlex} className="btn btn-secondary">
              Disconnetti Plex (rifai il login con QR code)
            </button>
          )}
        </section>

        {/* Last.fm Configuration */}
        <section className="config-section">
          <h2>Configurazione Last.fm (opzionale)</h2>
          
          <div className="form-group">
            <label htmlFor="lastfm-username">Username Last.fm:</label>
            <input
              type="text"
              id="lastfm-username"
              value={formData.lastfm.username}
              onChange={(e) => handleInputChange('lastfm', 'username', e.target.value)}
              placeholder="Il tuo username Last.fm"
            />
          </div>
          
          <div className="form-group">
            <label htmlFor="lastfm-apikey">API Key Last.fm:</label>
            <input
              type="text"
              id="lastfm-apikey"
              value={formData.lastfm.apiKey}
              onChange={(e) => handleInputChange('lastfm', 'apiKey', e.target.value)}
              placeholder="La tua API Key Last.fm"
            />
          </div>
          
          <div className="form-group">
            <label htmlFor="lastfm-secret">API Secret Last.fm:</label>
            <input
              type="password"
              id="lastfm-secret"
              value={formData.lastfm.apiSecret}
              onChange={(e) => handleInputChange('lastfm', 'apiSecret', e.target.value)}
              placeholder="Il tuo API Secret Last.fm"
            />
          </div>
          
          <button type="button" onClick={testLastfmConnection} className="btn btn-test">
            Testa connessione Last.fm
          </button>
        </section>

        {/* Display Configuration */}
        <section className="config-section">
          <h2>Configurazione Display</h2>
          
          <div className="form-group">
            <label htmlFor="controls-timeout">Timeout controlli (ms):</label>
            <input
              type="number"
              id="controls-timeout"
              value={formData.display.showControlsTimeout}
              onChange={(e) => handleInputChange('display', 'showControlsTimeout', parseInt(e.target.value))}
              min="1000"
              max="10000"
              step="500"
            />
          </div>
          
          <div className="form-group checkbox-group">
            <label>
              <input
                type="checkbox"
                checked={formData.display.enableLastfmIdle}
                onChange={(e) => handleInputChange('display', 'enableLastfmIdle', e.target.checked)}
              />
              Mostra dati Last.fm quando idle
            </label>
          </div>
        </section>

        {/* Security Configuration */}
        <section className="config-section">
          <h2>Sicurezza</h2>
          
          <div className="form-group">
            <label htmlFor="config-password">Nuova password configurazione:</label>
            <input
              type="password"
              id="config-password"
              value={formData.users.configPassword}
              onChange={(e) => handleInputChange('users', 'configPassword', e.target.value)}
              placeholder="Lascia vuoto per non cambiare"
            />
          </div>
        </section>

        {error && <div className="error-message">{error}</div>}
        {success && <div className="success-message">{success}</div>}

        <div className="form-actions">
          <button 
            type="submit" 
            disabled={saving}
            className="btn btn-primary"
          >
            {saving ? 'Salvataggio...' : 'Salva configurazione'}
          </button>
          
          <button 
            type="button" 
            onClick={() => navigate('/')}
            className="btn btn-secondary"
          >
            Annulla
          </button>
        </div>
      </form>
    </div>
  )
}

export default ConfigurationPanel