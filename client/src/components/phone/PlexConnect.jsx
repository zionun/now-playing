import { useCallback, useEffect, useState } from 'react'
import { api, storage } from './api'
import { errorText, useT } from '../../i18n'

// Plex login from the phone: a PIN is created and plex.tv's login page opens;
// when done it sends the browser back to this same page, which waits for the
// PIN to be authorized. The pending PIN is kept in sessionStorage because the
// trip to plex.tv reloads the page.
const PIN_KEY = 'nowPlayingPlexPin'
const POLL_INTERVAL_MS = 2000
const MAX_POLLS = 90 // ~3 minutes after coming back from plex.tv

const readPendingPin = kind => {
  try {
    const pending = JSON.parse(storage.get(PIN_KEY) || 'null')
    return pending?.kind === kind ? pending.pinId : null
  } catch {
    return null
  }
}

export const hasPendingPlexPin = kind => !!readPendingPin(kind)

// kind: 'connect' (link the device) or 'reset' (forgot password).
// error is an error object: show it with errorText().
export function usePlexPin(kind, onAuthenticated) {
  const [pinId, setPinId] = useState(() => readPendingPin(kind))
  const [error, setError] = useState(null)
  const [starting, setStarting] = useState(false)

  const base = kind === 'reset' ? '/api/auth/reset/pin' : '/api/auth/plex/pin'

  const start = useCallback(async () => {
    setError(null)
    setStarting(true)
    try {
      const forwardUrl = window.location.origin + window.location.pathname
      const pin = await api(base, { method: 'POST', body: { forwardUrl } })
      storage.set(PIN_KEY, JSON.stringify({ kind, pinId: pin.pinId }))
      window.location.href = pin.authUrl
    } catch (err) {
      setError(err)
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

    const stop = failure => {
      stopped = true
      storage.remove(PIN_KEY)
      if (failure) {
        setPinId(null)
        setError(failure)
      }
    }

    const check = async () => {
      if (stopped) return
      polls += 1
      try {
        const result = await api(`${base}/${pinId}`)
        if (result.authenticated) {
          stop()
          onAuthenticated(result, pinId)
          return
        }
      } catch (err) {
        stop(err)
        return
      }
      if (polls >= MAX_POLLS) stop({ code: 'plex_login_timeout' })
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

// Links the device to a Plex server (initial setup or from /config)
const PlexConnect = ({ onConnected, onCancel, bound = false }) => {
  const t = useT()
  const [servers, setServers] = useState(null)
  const [authPinId, setAuthPinId] = useState(null)
  const [selecting, setSelecting] = useState(false)
  const [selectError, setSelectError] = useState(null)

  const selectServer = useCallback(
    async (pinId, server) => {
      setSelecting(true)
      setSelectError(null)
      try {
        const result = await api('/api/auth/plex/select', {
          method: 'POST',
          body: { pinId, machineIdentifier: server.machineIdentifier }
        })
        onConnected(result.serverName)
      } catch (err) {
        setSelectError(err)
        setSelecting(false)
      }
    },
    [onConnected]
  )

  const handleAuthenticated = useCallback(
    (result, pinId) => {
      const found = result.servers || []
      setAuthPinId(pinId)
      setServers(found)
      if (found.length === 1) selectServer(pinId, found[0])
    },
    [selectServer]
  )

  const { waiting, starting, error, start, cancel } = usePlexPin('connect', handleAuthenticated)

  const retry = () => {
    setServers(null)
    setSelectError(null)
    start()
  }

  if (servers) {
    if (servers.length === 0) {
      return (
        <div className="phone-block">
          <p className="phone-error">{t('plex.noServers')}</p>
          <button className="phone-btn phone-btn-secondary" onClick={retry}>
            {t('plex.anotherAccount')}
          </button>
        </div>
      )
    }
    return (
      <div className="phone-block">
        {servers.length > 1 && <p className="phone-hint">{t('plex.chooseServer')}</p>}
        {servers.length === 1 && (
          <p className="phone-hint">{t('plex.connectingTo', { name: servers[0].name })}</p>
        )}
        {servers.length > 1 &&
          servers.map(server => (
            <button
              key={server.machineIdentifier}
              className="phone-btn phone-btn-primary"
              disabled={selecting}
              onClick={() => selectServer(authPinId, server)}
            >
              {server.name}
              {server.owned ? '' : ` ${t('plex.shared')}`}
            </button>
          ))}
        {selectError && (
          <>
            <p className="phone-error">{errorText(t, selectError)}</p>
            <button className="phone-btn phone-btn-secondary" onClick={retry}>
              {t('plex.retryOtherAccount')}
            </button>
          </>
        )}
      </div>
    )
  }

  if (waiting) {
    return (
      <div className="phone-block">
        <div className="phone-waiting">
          <div className="spinner" /> {t('common.waitingForPlex')}
        </div>
        <button className="phone-btn phone-btn-secondary" onClick={cancel}>
          {t('common.cancel')}
        </button>
      </div>
    )
  }

  return (
    <div className="phone-block">
      <p className="phone-hint">{bound ? t('plex.hintBound') : t('plex.hintFree')}</p>
      <button className="phone-btn phone-btn-plex" onClick={start} disabled={starting}>
        {starting ? t('common.openingPlex') : t('common.loginWithPlex')}
      </button>
      {onCancel && (
        <button className="phone-btn phone-btn-secondary" onClick={onCancel}>
          {t('common.cancel')}
        </button>
      )}
      {error && <p className="phone-error">{errorText(t, error)}</p>}
    </div>
  )
}

export default PlexConnect
