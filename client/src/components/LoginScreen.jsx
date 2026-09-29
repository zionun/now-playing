import React, { useEffect, useState } from 'react'
import { useWebSocket } from '../context/WebSocketContext'
import './LoginScreen.css'

// Il kiosk non si configura dal touch screen: mostra un QR che apre la
// configurazione sul telefono (iniziale su /setup, generale su /config).
const STATE_POLL_MS = 3000

const useQr = target => {
  const [qr, setQr] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let retry
    const load = async () => {
      try {
        const response = await fetch('/api/auth/qr', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ target })
        })
        if (!response.ok) throw new Error()
        setQr(await response.json())
        setError('')
      } catch (err) {
        setError('Impossibile preparare il QR code, nuovo tentativo tra poco...')
        retry = setTimeout(load, 5000)
      }
    }
    load()
    return () => clearTimeout(retry)
  }, [target])

  return { qr, error }
}

const QrBlock = ({ qr, error, alt }) => (
  <>
    {qr && (
      <div className="login-qr-block">
        <img src={qr.qrDataUrl} alt={alt} className="login-qr" />
        <p className="login-alt">Oppure apri <strong>{qr.url}</strong></p>
        <p className="login-alt">Il telefono deve essere sulla stessa rete Wi-Fi</p>
      </div>
    )}
    {!qr && !error && (
      <div className="login-loading"><div className="spinner" /></div>
    )}
    {error && <div className="error-message">{error}</div>}
  </>
)

// Dispositivo non configurato (primo avvio, o Plex scollegato/token revocato)
const LoginScreen = () => {
  const { markAuthenticated } = useWebSocket()
  const { qr, error } = useQr('setup')
  const [state, setState] = useState(null)

  // La configurazione avviene sul telefono: qui si attende che sia completa
  useEffect(() => {
    const check = async () => {
      try {
        const data = await fetch('/api/auth/state').then(r => r.json())
        setState(data)
        if (data.setupComplete) markAuthenticated()
      } catch (err) {
        // Errore di rete transitorio: il prossimo giro riprova da solo
      }
    }
    check()
    const interval = setInterval(check, STATE_POLL_MS)
    return () => clearInterval(interval)
  }, [markAuthenticated])

  const isFirstSetup = state ? !state.hasPassword : true

  return (
    <div className="login-screen">
      <div className="login-card">
        <h1>{isFirstSetup ? 'Configura il dispositivo' : 'Ricollega Plex'}</h1>
        <p className="login-hint">
          {isFirstSetup
            ? 'Inquadra il QR code con il telefono per iniziare la configurazione'
            : 'Il collegamento a Plex non è attivo: inquadra il QR code con il telefono per ripristinarlo'}
        </p>
        <QrBlock qr={qr} error={error} alt="QR code per configurare il dispositivo" />
      </div>
    </div>
  )
}

// Icona ⚙︎ sempre disponibile sul kiosk: mostra il QR per aprire la
// configurazione generale sul telefono (che chiede la password).
const CONFIG_QR_TIMEOUT_MS = 60000

const ConfigQrOverlay = ({ onClose }) => {
  const { qr, error } = useQr('config')

  useEffect(() => {
    const timeout = setTimeout(onClose, CONFIG_QR_TIMEOUT_MS)
    return () => clearTimeout(timeout)
  }, [onClose])

  const stop = e => e.stopPropagation()

  return (
    <div className="login-screen config-qr-overlay" onClick={onClose} onTouchEnd={onClose}>
      <div className="login-card" onClick={stop} onTouchEnd={stop}>
        <h1>Configurazione</h1>
        <p className="login-hint">Inquadra il QR code con il telefono</p>
        <QrBlock qr={qr} error={error} alt="QR code per aprire la configurazione" />
        <button className="btn btn-secondary" onClick={onClose}>Chiudi</button>
      </div>
    </div>
  )
}

export const ConfigQrButton = () => {
  const [open, setOpen] = useState(false)
  const close = React.useCallback(() => setOpen(false), [])

  const toggle = e => {
    e.stopPropagation()
    e.preventDefault()
    setOpen(true)
  }

  return (
    <>
      <button
        className="config-qr-button"
        aria-label="Configurazione"
        onClick={toggle}
        onTouchEnd={toggle}
      >
        ⚙︎
      </button>
      {open && <ConfigQrOverlay onClose={close} />}
    </>
  )
}

export default LoginScreen
