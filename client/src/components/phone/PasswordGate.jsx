import { useCallback, useState } from 'react'
import { api, session } from './api'
import { usePlexPin, hasPendingPlexPin } from './PlexConnect'
import { errorText, useT } from '../../i18n'

// Form for a new password (created at the first start, changed, or reset)
export const NewPasswordForm = ({ submitLabel, onSubmit }) => {
  const t = useT()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  const handleSubmit = async e => {
    e.preventDefault()
    setError('')
    if (password !== confirm) {
      setError(t('errors.passwords_mismatch'))
      return
    }
    setSaving(true)
    try {
      await onSubmit(password)
    } catch (err) {
      setError(errorText(t, err))
      setSaving(false)
    }
  }

  return (
    <form className="phone-block" onSubmit={handleSubmit}>
      <label htmlFor="new-password">{t('password.newPassword')}</label>
      <input
        id="new-password"
        type="password"
        autoComplete="new-password"
        value={password}
        onChange={e => setPassword(e.target.value)}
        required
        minLength={4}
      />
      <label htmlFor="confirm-password">{t('password.repeatPassword')}</label>
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
        {saving ? t('common.saving') : submitLabel}
      </button>
    </form>
  )
}

// Asks for the device password; "Forgot password?" logs in to Plex again
// with the account that set up the device, then lets the user choose a new one.
const PasswordGate = ({ canResetPassword, onAuthenticated }) => {
  const t = useT()
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
      setError(errorText(t, err))
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
        <h2>{t('password.newPasswordTitle')}</h2>
        <p className="phone-hint">{t('password.newPasswordHint')}</p>
        <NewPasswordForm submitLabel={t('password.savePassword')} onSubmit={saveNewPassword} />
      </>
    )
  }

  if (mode === 'forgot') {
    return (
      <>
        <h2>{t('password.resetTitle')}</h2>
        {reset.waiting ? (
          <div className="phone-block">
            <div className="phone-waiting">
              <div className="spinner" /> {t('common.waitingForPlex')}
            </div>
            <button className="phone-btn phone-btn-secondary" onClick={reset.cancel}>
              {t('common.cancel')}
            </button>
          </div>
        ) : (
          <div className="phone-block">
            <p className="phone-hint">{t('password.resetHint')}</p>
            <button className="phone-btn phone-btn-plex" onClick={reset.start} disabled={reset.starting}>
              {reset.starting ? t('common.openingPlex') : t('common.loginWithPlex')}
            </button>
            <button className="phone-btn phone-btn-secondary" onClick={() => setMode('login')}>
              {t('password.backToPassword')}
            </button>
            {reset.error && <p className="phone-error">{errorText(t, reset.error)}</p>}
          </div>
        )}
      </>
    )
  }

  return (
    <>
      <h2>{t('password.title')}</h2>
      <form className="phone-block" onSubmit={handleLogin}>
        <label htmlFor="password">{t('password.label')}</label>
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
          {checking ? t('common.checking') : t('password.login')}
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
            {t('password.forgot')}
          </button>
        )}
      </form>
    </>
  )
}

export default PasswordGate
