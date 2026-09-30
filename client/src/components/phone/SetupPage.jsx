import { useCallback, useEffect, useState } from 'react'
import { api, session, storage, SessionExpiredError, useSessionExpired } from './api'
import PasswordGate, { NewPasswordForm } from './PasswordGate'
import PlexConnect, { hasPendingPlexPin } from './PlexConnect'
import LastfmForm from './LastfmForm'
import PhonePage from './PhonePage'
import { errorText, useT } from '../../i18n'

// Initial device setup, opened on the phone from the QR code shown by the
// kiosk: 1) password, 2) Plex login, 3) Last.fm (optional). The current step
// is kept in sessionStorage because the login on plex.tv reloads the page.
const STEP_KEY = 'nowPlayingSetupStep'
const STEPS = ['password', 'plex', 'lastfm']

const openSettings = () => {
  window.location.href = '/config'
}

const SetupPage = () => {
  const t = useT()
  const [state, setState] = useState(null)
  const [authenticated, setAuthenticated] = useState(false)
  const [step, setStepState] = useState(() => storage.get(STEP_KEY))
  const [error, setError] = useState('')
  const [changingPlex, setChangingPlex] = useState(false)

  const setStep = useCallback(next => {
    if (next) storage.set(STEP_KEY, next)
    else storage.remove(STEP_KEY)
    setStepState(next)
  }, [])

  useSessionExpired(useCallback(() => setAuthenticated(false), []))

  const loadState = useCallback(async () => {
    try {
      const data = await api('/api/auth/state')
      setState(data)
      return data
    } catch (err) {
      setError(errorText(t, err))
      return null
    }
  }, [t])

  useEffect(() => {
    const init = async () => {
      const data = await loadState()
      if (!data) return

      if (!data.hasPassword) {
        setStep('password')
        return
      }
      // Is a session already open (e.g. coming back from plex.tv) still valid?
      if (session.get()) {
        try {
          await api('/api/config')
          setAuthenticated(true)
          if (!storage.get(STEP_KEY) || storage.get(STEP_KEY) === 'password') {
            setStep(hasPendingPlexPin('connect') || !data.plexConnected ? 'plex' : null)
          }
        } catch (err) {
          if (!(err instanceof SessionExpiredError)) setError(errorText(t, err))
        }
      }
    }
    init()
  }, [loadState, setStep, t])

  const createPassword = async password => {
    const result = await api('/api/auth/password', { method: 'POST', body: { password } })
    session.set(result.session)
    setAuthenticated(true)
    await loadState()
    setStep('plex')
  }

  const handleLoggedIn = async () => {
    setAuthenticated(true)
    const data = await loadState()
    // Device already set up: continue only when Plex is missing
    setStep(data && !data.plexConnected ? 'plex' : storage.get(STEP_KEY) || null)
  }

  const handlePlexConnected = async () => {
    await loadState()
    setStep('lastfm')
  }

  const finish = () => {
    setStep('done')
  }

  if (!state) {
    return (
      <PhonePage title={t('setup.title')}>
        {error ? (
          <p className="phone-error">{error}</p>
        ) : (
          <div className="phone-waiting">
            <div className="spinner" />
          </div>
        )}
      </PhonePage>
    )
  }

  const stepNumber = STEPS.indexOf(step) + 1
  const subtitle = stepNumber > 0 ? t('setup.step', { step: stepNumber, total: STEPS.length }) : null

  // First start: begin by creating the password
  if (step === 'password' && !state.hasPassword) {
    return (
      <PhonePage title={t('setup.createPasswordTitle')} subtitle={subtitle}>
        <p className="phone-hint">{t('setup.createPasswordHint')}</p>
        <NewPasswordForm submitLabel={t('common.continue')} onSubmit={createPassword} />
      </PhonePage>
    )
  }

  if (!authenticated) {
    return (
      <PhonePage
        title={t('setup.settingsTitle')}
        subtitle={state.plexConnected ? null : t('setup.plexToReconnect')}
      >
        <PasswordGate canResetPassword={state.canResetPassword} onAuthenticated={handleLoggedIn} />
      </PhonePage>
    )
  }

  if (step === 'plex') {
    // Plex already connected (e.g. an earlier configuration): it can be kept
    if (state.plexConnected && !changingPlex && !hasPendingPlexPin('connect')) {
      return (
        <PhonePage title={t('setup.plexTitle')} subtitle={subtitle}>
          <p className="phone-status">
            {t('setup.alreadyConnected', { server: state.plexServerName || t('setup.aPlexServer') })}
          </p>
          <div className="phone-block">
            <button className="phone-btn phone-btn-primary" onClick={() => setStep('lastfm')}>
              {t('common.continue')}
            </button>
            <button className="phone-btn phone-btn-secondary" onClick={() => setChangingPlex(true)}>
              {t('setup.reconnectOrChange')}
            </button>
          </div>
        </PhonePage>
      )
    }
    return (
      <PhonePage title={t('setup.plexTitle')} subtitle={subtitle}>
        <PlexConnect onConnected={handlePlexConnected} bound={state.canResetPassword} />
      </PhonePage>
    )
  }

  if (step === 'lastfm') {
    return (
      <PhonePage title={t('setup.lastfmTitle')} subtitle={subtitle}>
        <p className="phone-hint">{t('setup.lastfmHint')}</p>
        <LastfmForm
          initialUsername={state.lastfmUsername}
          hasApiKey={state.hasLastfmApiKey}
          submitLabel={t('setup.connectAndFinish')}
          onSaved={finish}
          secondaryAction={
            <button type="button" className="phone-btn phone-btn-secondary" onClick={finish}>
              {t('setup.skip')}
            </button>
          }
        />
      </PhonePage>
    )
  }

  if (step === 'done') {
    return (
      <PhonePage title={t('setup.doneTitle')}>
        <p className="phone-success">{t('setup.doneReady')}</p>
        <p className="phone-hint">{t('setup.doneHint')}</p>
        <button
          className="phone-btn phone-btn-secondary"
          onClick={() => {
            setStep(null)
            openSettings()
          }}
        >
          {t('setup.openSettings')}
        </button>
      </PhonePage>
    )
  }

  return (
    <PhonePage title={t('setup.alreadySetUpTitle')}>
      <p className="phone-hint">{t('setup.alreadySetUpHint')}</p>
      <button className="phone-btn phone-btn-primary" onClick={openSettings}>
        {t('setup.openSettings')}
      </button>
    </PhonePage>
  )
}

export default SetupPage
