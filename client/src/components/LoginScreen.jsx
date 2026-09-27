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
  // Step 2 dopo il login Plex: proporre il collegamento a Last.fm
  const [lastfmStep, setLastfmStep] = useState(false)
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

      // Se Last.fm non è ancora collegato, proponilo come step 2
      const state = await fetch('/api/auth/state').then(r => r.json()).catch(() => ({}))
      if (state.lastfmConfigured) {
        markAuthenticated()
      } else {
        setLastfmStep(true)
      }
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

  if (lastfmStep) {
    return <LastfmStep onFinish={markAuthenticated} />
  }

  return (
    <div className="login-screen">
      <div className="login-card">
        <p className="login-step">Passo 1 di 2</p>
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

// Step 2: collegamento facoltativo a Last.fm. Il QR apre sul telefono una
// pagina del server dove inserire lo username; qui si attende il completamento.
const LastfmStep = ({ onFinish }) => {
  const [wantsLink, setWantsLink] = useState(false)
  const [link, setLink] = useState(null)
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)

  const requestLink = useCallback(async () => {
    setError('')
    try {
      const response = await fetch('/api/auth/lastfm/link', { method: 'POST' })
      if (!response.ok) throw new Error()
      setLink(await response.json())
    } catch (err) {
      setError('Impossibile preparare il collegamento a Last.fm')
    }
  }, [])

  useEffect(() => {
    if (wantsLink) requestLink()
  }, [wantsLink, requestLink])

  useEffect(() => {
    if (!link) return undefined
    const interval = setInterval(async () => {
      try {
        const response = await fetch(`/api/auth/lastfm/link/${link.token}`)
        if (response.status === 404) {
          // Link scaduto: ne serve uno nuovo
          clearInterval(interval)
          requestLink()
          return
        }
        const data = await response.json()
        if (data.done) {
          clearInterval(interval)
          setDone(true)
          setTimeout(onFinish, 1500)
        }
      } catch (err) {
        // Errore di rete transitorio: il prossimo giro riprova da solo
      }
    }, POLL_INTERVAL_MS)
    return () => clearInterval(interval)
  }, [link, requestLink, onFinish])

  return (
    <div className="login-screen">
      <div className="login-card">
        <p className="login-step">Passo 2 di 2</p>
        <h1>Collegare Last.fm?</h1>

        {!wantsLink && (
          <>
            <p className="login-hint">
              Con Last.fm, quando non c'è musica in riproduzione, lo schermo mostra
              i tuoi album più ascoltati e l'ultimo brano ascoltato.
            </p>
            <div className="login-actions">
              <button className="btn btn-primary" onClick={() => setWantsLink(true)}>
                Sì, collega Last.fm
              </button>
              <button className="btn btn-secondary" onClick={onFinish}>
                No, continua
              </button>
            </div>
          </>
        )}

        {wantsLink && !done && link && (
          <div className="login-qr-block">
            <p className="login-hint">Inquadra il QR code con il telefono e inserisci il tuo username Last.fm</p>
            <img src={link.qrDataUrl} alt="QR code per collegare Last.fm" className="login-qr" />
            <p className="login-alt">Il telefono deve essere sulla stessa rete Wi-Fi</p>
            <button className="btn btn-secondary" onClick={onFinish}>Salta</button>
          </div>
        )}

        {wantsLink && !done && !link && !error && (
          <div className="login-loading">
            <div className="spinner" />
          </div>
        )}

        {done && <p className="login-hint">✓ Last.fm collegato</p>}

        {error && (
          <>
            <div className="error-message">{error}</div>
            <button className="btn btn-secondary" onClick={onFinish}>Continua senza Last.fm</button>
          </>
        )}
      </div>
    </div>
  )
}

export default LoginScreen
