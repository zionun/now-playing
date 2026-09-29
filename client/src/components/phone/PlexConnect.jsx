import React, { useCallback, useEffect, useState } from 'react'
import { api, storage } from './api'

// Accesso a Plex dal telefono: si crea un PIN, si apre la pagina di login di
// plex.tv, che al termine rimanda a questa stessa pagina; qui si attende che
// il PIN risulti autorizzato. Il PIN in corso resta in sessionStorage perché
// il passaggio su plex.tv ricarica la pagina.
const PIN_KEY = 'nowPlayingPlexPin'
const POLL_INTERVAL_MS = 2000
const MAX_POLLS = 90 // ~3 minuti dopo il ritorno da plex.tv

const readPendingPin = kind => {
  try {
    const pending = JSON.parse(storage.get(PIN_KEY) || 'null')
    return pending?.kind === kind ? pending.pinId : null
  } catch {
    return null
  }
}

export const hasPendingPlexPin = kind => !!readPendingPin(kind)

// kind: 'connect' (collegare il dispositivo) o 'reset' (password dimenticata)
export function usePlexPin(kind, onAuthenticated) {
  const [pinId, setPinId] = useState(() => readPendingPin(kind))
  const [error, setError] = useState('')
  const [starting, setStarting] = useState(false)

  const base = kind === 'reset' ? '/api/auth/reset/pin' : '/api/auth/plex/pin'

  const start = useCallback(async () => {
    setError('')
    setStarting(true)
    try {
      const forwardUrl = window.location.origin + window.location.pathname
      const pin = await api(base, { method: 'POST', body: { forwardUrl } })
      storage.set(PIN_KEY, JSON.stringify({ kind, pinId: pin.pinId }))
      window.location.href = pin.authUrl
    } catch (err) {
      setError(err.message)
      setStarting(false)
    }
  }, [base, kind])

  const cancel = useCallback(() => {
    storage.remove(PIN_KEY)
    setPinId(null)
  }, [])

  useEffect(() => {
    if (!pinId) return undefined
    let polls = 0
    let stopped = false

    const check = async () => {
      if (stopped) return
      polls += 1
      try {
        const result = await api(`${base}/${pinId}`)
        if (result.authenticated) {
          stopped = true
          storage.remove(PIN_KEY)
          onAuthenticated(result, pinId)
          return
        }
      } catch (err) {
        stopped = true
        storage.remove(PIN_KEY)
        setPinId(null)
        setError(err.message)
        return
      }
      if (polls >= MAX_POLLS) {
        stopped = true
        storage.remove(PIN_KEY)
        setPinId(null)
        setError('Accesso a Plex non completato. Riprova.')
      }
    }

    check()
    const interval = setInterval(check, POLL_INTERVAL_MS)
    return () => {
      stopped = true
      clearInterval(interval)
    }
  }, [pinId, base, onAuthenticated])

  return { waiting: !!pinId, starting, error, start, cancel }
}

// Collega il dispositivo a un server Plex (setup iniziale o da /config)
const PlexConnect = ({ onConnected, onCancel, bound = false }) => {
  const [servers, setServers] = useState(null)
  const [authPinId, setAuthPinId] = useState(null)
  const [selecting, setSelecting] = useState(false)
  const [selectError, setSelectError] = useState('')

  const selectServer = useCallback(async (pinId, server) => {
    setSelecting(true)
    setSelectError('')
    try {
      const result = await api('/api/auth/plex/select', {
        method: 'POST',
        body: { pinId, machineIdentifier: server.machineIdentifier }
      })
      onConnected(result.serverName)
    } catch (err) {
      setSelectError(err.message)
      setSelecting(false)
    }
  }, [onConnected])

  const handleAuthenticated = useCallback((result, pinId) => {
    const found = result.servers || []
    setAuthPinId(pinId)
    setServers(found)
    if (found.length === 1) selectServer(pinId, found[0])
  }, [selectServer])

  const { waiting, starting, error, start, cancel } = usePlexPin('connect', handleAuthenticated)

  const retry = () => {
    setServers(null)
    setSelectError('')
    start()
  }

  if (servers) {
    if (servers.length === 0) {
      return (
        <div className="phone-block">
          <p className="phone-error">Nessun server Plex trovato per questo account.</p>
          <button className="phone-btn phone-btn-secondary" onClick={retry}>
            Accedi con un altro account
          </button>
        </div>
      )
    }
    return (
      <div className="phone-block">
        {servers.length > 1 && <p className="phone-hint">Scegli il server Plex da usare:</p>}
        {servers.length === 1 && <p className="phone-hint">Collegamento a "{servers[0].name}"...</p>}
        {servers.length > 1 && servers.map(server => (
          <button
            key={server.machineIdentifier}
            className="phone-btn phone-btn-primary"
            disabled={selecting}
            onClick={() => selectServer(authPinId, server)}
          >
            {server.name}{server.owned ? '' : ' (condiviso)'}
          </button>
        ))}
        {selectError && (
          <>
            <p className="phone-error">{selectError}</p>
            <button className="phone-btn phone-btn-secondary" onClick={retry}>Riprova con un altro account</button>
          </>
        )}
      </div>
    )
  }

  if (waiting) {
    return (
      <div className="phone-block">
        <div className="phone-waiting"><div className="spinner" /> Attendo la conferma da Plex...</div>
        <button className="phone-btn phone-btn-secondary" onClick={cancel}>Annulla</button>
      </div>
    )
  }

  return (
    <div className="phone-block">
      <p className="phone-hint">
        {bound
          ? 'Accedi con lo stesso account Plex usato per configurare il dispositivo.'
          : 'Accedi con il tuo account Plex: verrai riportato qui al termine.'}
      </p>
      <button className="phone-btn phone-btn-plex" onClick={start} disabled={starting}>
        {starting ? 'Apertura di Plex...' : 'Accedi con Plex'}
      </button>
      {onCancel && (
        <button className="phone-btn phone-btn-secondary" onClick={onCancel}>Annulla</button>
      )}
      {error && <p className="phone-error">{error}</p>}
    </div>
  )
}

export default PlexConnect
