import { useCallback, useEffect, useState } from 'react'
import { useWebSocket } from '../context/WebSocketContext'
import { useT } from '../i18n'
import './LoginScreen.css'

// The kiosk is not configured from the touch screen: it shows a QR code that
// opens the settings on the phone (initial setup on /setup, general settings
// on /config).
const STATE_POLL_MS = 3000

const useQr = target => {
  const [qr, setQr] = useState(null)
  const [failed, setFailed] = useState(false)

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
        setFailed(false)
      } catch {
        setFailed(true)
        retry = setTimeout(load, 5000)
      }
    }
    load()
    return () => clearTimeout(retry)
  }, [target])

  return { qr, failed }
}

const QrBlock = ({ qr, failed, alt }) => {
  const t = useT()
  return (
    <>
      {qr && (
        <div className="login-qr-block">
          <img src={qr.qrDataUrl} alt={alt} className="login-qr" />
          <p className="login-alt">
            {t('kiosk.orOpen')} <strong>{qr.url}</strong>
          </p>
          <p className="login-alt">{t('kiosk.sameWifi')}</p>
        </div>
      )}
      {!qr && !failed && (
        <div className="login-loading">
          <div className="spinner" />
        </div>
      )}
      {failed && <div className="error-message">{t('kiosk.qrError')}</div>}
    </>
  )
}

// Device not set up (first start, or Plex disconnected/token revoked)
const LoginScreen = () => {
  const t = useT()
  const { markAuthenticated } = useWebSocket()
  const { qr, failed } = useQr('setup')
  const [state, setState] = useState(null)

  // The setup happens on the phone: wait here until it is complete
  useEffect(() => {
    const check = async () => {
      try {
        const data = await fetch('/api/auth/state').then(r => r.json())
        setState(data)
        if (data.setupComplete) markAuthenticated()
      } catch {
        // Transient network error: the next round retries
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
        <h1>{isFirstSetup ? t('kiosk.setupTitle') : t('kiosk.reconnectTitle')}</h1>
        <p className="login-hint">{isFirstSetup ? t('kiosk.setupHint') : t('kiosk.reconnectHint')}</p>
        <QrBlock qr={qr} failed={failed} alt={t('kiosk.setupQrAlt')} />
      </div>
    </div>
  )
}

// ⚙︎ icon always available on the kiosk: shows the QR code that opens the
// general settings on the phone (which ask for the password).
const CONFIG_QR_TIMEOUT_MS = 60000

const ConfigQrOverlay = ({ onClose }) => {
  const t = useT()
  const { qr, failed } = useQr('config')

  useEffect(() => {
    const timeout = setTimeout(onClose, CONFIG_QR_TIMEOUT_MS)
    return () => clearTimeout(timeout)
  }, [onClose])

  const stop = e => e.stopPropagation()

  return (
    <div className="login-screen config-qr-overlay" onClick={onClose} onTouchEnd={onClose}>
      <div className="login-card" onClick={stop} onTouchEnd={stop}>
        <h1>{t('kiosk.settingsTitle')}</h1>
        <p className="login-hint">{t('kiosk.settingsHint')}</p>
        <QrBlock qr={qr} failed={failed} alt={t('kiosk.settingsQrAlt')} />
        <button className="btn btn-secondary" onClick={onClose}>
          {t('common.close')}
        </button>
      </div>
    </div>
  )
}

export const ConfigQrButton = () => {
  const t = useT()
  const [open, setOpen] = useState(false)
  const close = useCallback(() => setOpen(false), [])

  const toggle = e => {
    e.stopPropagation()
    e.preventDefault()
    setOpen(true)
  }

  return (
    <>
      <button
        className="config-qr-button"
        aria-label={t('kiosk.settingsTitle')}
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
