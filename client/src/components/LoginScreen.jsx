import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useWebSocket } from '../context/WebSocketContext'
import './LoginScreen.css'

// Flusso di login Plex identico a quello delle app ufficiali (TV, Plexamp):
// il server genera un PIN, questo schermo mostra il QR corrispondente, e
// interroga il server finché l'utente non lo autorizza dal telefono.
const POLL_INTERVAL_MS = 2000

const LoginScreen = () => {
  const { markAuthenticated } = useWebSocket()
  const [pin, setPin] = useState(null)
  const [servers, setServers] = useState(null)
  const [error, setError] = useState('')
  const [selecting, setSelecting] = useState(false)
  const pollRef = useRef(null)
  const retryRef = useRef(null)

  const requestPin = useCallback(async () => {
    setError('')
    setServers(null)
    try {
      const response = await fetch('/api/auth/pin', { method: 'POST' })
      if (!response.ok) throw new Error('Richiesta PIN fallita')
      const data = await response.json()
      setPin(data)
    } catch (err) {
      setError('Impossibile contattare Plex, nuovo tentativo tra poco...')
      retryRef.current = setTimeout(requestPin, 5000)
    }
  }, [])

  useEffect(() => {
    requestPin()
    return () => {
      clearInterval(pollRef.current)
      clearTimeout(retryRef.current)
    }
  }, [requestPin])

  const selectServer = useCallback(async (server) => {
    setSelecting(true)
    setError('')
    try {
      const response = await fetch('/api/auth/select-server', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          password: '',
          url: server.url,
          port: server.port,
          token: server.accessToken
        })
      })

      if (!response.ok) {
        const body = await response.json().catch(() => ({}))
        if (response.status === 401) {
          setError('È impostata una password di configurazione: completa il login dalla pagina /config.')
        } else {
          setError(body.error || 'Impossibile salvare il server selezionato')
        }
        setSelecting(false)
        return
      }

      markAuthenticated()
    } catch (err) {
      setError('Impossibile salvare il server selezionato')
      setSelecting(false)
    }
  }, [markAuthenticated])

  useEffect(() => {
    if (!pin) return undefined

    pollRef.current = setInterval(async () => {
      try {
        const response = await fetch(`/api/auth/pin/${pin.pinId}`)
        if (!response.ok) {
          // Il PIN è scaduto lato server: chiedine subito uno nuovo
          clearInterval(pollRef.current)
          requestPin()
          return
        }

        const data = await response.json()
        if (data.authenticated) {
          clearInterval(pollRef.current)
          const found = data.servers || []
          setServers(found)
          if (found.length === 1) {
            selectServer(found[0])
          }
        }
      } catch (err) {
        // Errore di rete transitorio: il prossimo giro riprova da solo
      }
    }, POLL_INTERVAL_MS)

    return () => clearInterval(pollRef.current)
  }, [pin, requestPin, selectServer])

  return (
    <div className="login-screen">
      <div className="login-card">
        <h1>Accedi a Plex</h1>

        {!servers && pin && (
          <div className="login-qr-block">
            <p className="login-hint">Inquadra il QR code con il telefono per accedere</p>
            <img src={pin.qrDataUrl} alt="QR code di accesso Plex" className="login-qr" />
            <p className="login-alt">
              Oppure vai su <strong>plex.tv/link</strong> e inserisci il codice:
            </p>
            <div className="login-code">{pin.code}</div>
          </div>
        )}

        {!servers && !pin && !error && (
          <div className="login-loading">
            <div className="spinner" />
            <p>Preparazione del login...</p>
          </div>
        )}

        {servers && servers.length === 0 && (
          <p className="login-hint">Nessun server Plex trovato per questo account.</p>
        )}

        {servers && servers.length > 1 && (
          <div className="login-servers">
            <p className="login-hint">Scegli il server Plex da usare:</p>
            {servers.map(server => (
              <button
                key={server.machineIdentifier}
                className="btn btn-primary login-server-btn"
                disabled={selecting}
                onClick={() => selectServer(server)}
              >
                {server.name} {server.local ? '(rete locale)' : ''}
              </button>
            ))}
          </div>
        )}

        {servers && servers.length === 1 && (
          <div className="login-loading">
            <div className="spinner" />
            <p>Configurazione di "{servers[0].name}" in corso...</p>
          </div>
        )}

        {error && <div className="error-message">{error}</div>}
      </div>
    </div>
  )
}

export default LoginScreen
