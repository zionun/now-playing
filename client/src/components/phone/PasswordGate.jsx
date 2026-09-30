import { useCallback, useState } from 'react'
import { api, session } from './api'
import { usePlexPin, hasPendingPlexPin } from './PlexConnect'

// Form per una nuova password (creazione al primo avvio, cambio, reset)
export const NewPasswordForm = ({ submitLabel, onSubmit }) => {
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  const handleSubmit = async e => {
    e.preventDefault()
    setError('')
    if (password !== confirm) {
      setError('Le due password non coincidono')
      return
    }
    setSaving(true)
    try {
      await onSubmit(password)
    } catch (err) {
      setError(err.message)
      setSaving(false)
    }
  }

  return (
    <form className="phone-block" onSubmit={handleSubmit}>
      <label htmlFor="new-password">Nuova password</label>
      <input
        id="new-password"
        type="password"
        autoComplete="new-password"
        value={password}
        onChange={e => setPassword(e.target.value)}
        required
        minLength={4}
      />
      <label htmlFor="confirm-password">Ripeti la password</label>
      <input
        id="confirm-password"
        type="password"
        autoComplete="new-password"
        value={confirm}
        onChange={e => setConfirm(e.target.value)}
        required
        minLength={4}
      />
      {error && <p className="phone-error">{error}</p>}
      <button type="submit" className="phone-btn phone-btn-primary" disabled={saving}>
        {saving ? 'Salvataggio...' : submitLabel}
      </button>
    </form>
  )
}

// Richiede la password del dispositivo; "Password dimenticata?" fa rifare
// l'accesso a Plex con l'account che ha configurato il dispositivo e poi
// permette di sceglierne una nuova.
const PasswordGate = ({ canResetPassword, onAuthenticated }) => {
  const [mode, setMode] = useState(() => (hasPendingPlexPin('reset') ? 'forgot' : 'login'))
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [checking, setChecking] = useState(false)

  const handleLogin = async e => {
    e.preventDefault()
    setError('')
    setChecking(true)
    try {
      const result = await api('/api/auth/login', { method: 'POST', body: { password } })
      session.set(result.session)
      onAuthenticated()
    } catch (err) {
      setError(err.message)
      setChecking(false)
    }
  }

  const handleResetAuthenticated = useCallback(result => {
    session.set(result.session)
    setMode('newPassword')
  }, [])

  const reset = usePlexPin('reset', handleResetAuthenticated)

  const saveNewPassword = async newPassword => {
    const result = await api('/api/auth/password/change', { method: 'POST', body: { password: newPassword } })
    session.set(result.session)
    onAuthenticated()
  }

  if (mode === 'newPassword') {
    return (
      <>
        <h2>Nuova password</h2>
        <p className="phone-hint">Accesso Plex verificato: scegli la nuova password del dispositivo.</p>
        <NewPasswordForm submitLabel="Salva password" onSubmit={saveNewPassword} />
      </>
    )
  }

  if (mode === 'forgot') {
    return (
      <>
        <h2>Reimposta password</h2>
        {reset.waiting ? (
          <div className="phone-block">
            <div className="phone-waiting">
              <div className="spinner" /> Attendo la conferma da Plex...
            </div>
            <button className="phone-btn phone-btn-secondary" onClick={reset.cancel}>
              Annulla
            </button>
          </div>
        ) : (
          <div className="phone-block">
            <p className="phone-hint">
              Accedi a Plex con lo stesso account usato per configurare questo dispositivo.
            </p>
            <button className="phone-btn phone-btn-plex" onClick={reset.start} disabled={reset.starting}>
              {reset.starting ? 'Apertura di Plex...' : 'Accedi con Plex'}
            </button>
            <button className="phone-btn phone-btn-secondary" onClick={() => setMode('login')}>
              Torna alla password
            </button>
            {reset.error && <p className="phone-error">{reset.error}</p>}
          </div>
        )}
      </>
    )
  }

  return (
    <>
      <h2>Password del dispositivo</h2>
      <form className="phone-block" onSubmit={handleLogin}>
        <label htmlFor="password">Password</label>
        <input
          id="password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={e => setPassword(e.target.value)}
          required
          autoFocus
        />
        {error && <p className="phone-error">{error}</p>}
        <button type="submit" className="phone-btn phone-btn-primary" disabled={checking}>
          {checking ? 'Verifica...' : 'Accedi'}
        </button>
        {canResetPassword && (
          <button
            type="button"
            className="phone-link"
            onClick={() => {
              setError('')
              setMode('forgot')
            }}
          >
            Password dimenticata?
          </button>
        )}
      </form>
    </>
  )
}

export default PasswordGate
