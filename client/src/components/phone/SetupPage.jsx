import React, { useCallback, useEffect, useState } from 'react'
import { api, session, storage, SessionExpiredError, useSessionExpired } from './api'
import PasswordGate, { NewPasswordForm } from './PasswordGate'
import PlexConnect, { hasPendingPlexPin } from './PlexConnect'
import LastfmForm from './LastfmForm'
import PhonePage from './PhonePage'

// Configurazione iniziale del dispositivo, aperta dal telefono con il QR
// mostrato dal kiosk: 1) password, 2) accesso a Plex, 3) Last.fm (facoltativo).
// Lo step corrente resta in sessionStorage perché il login su plex.tv
// ricarica la pagina.
const STEP_KEY = 'nowPlayingSetupStep'
const STEPS = ['password', 'plex', 'lastfm']

const SetupPage = () => {
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
      setError('Impossibile contattare il dispositivo')
      return null
    }
  }, [])

  useEffect(() => {
    const init = async () => {
      const data = await loadState()
      if (!data) return

      if (!data.hasPassword) {
        setStep('password')
        return
      }
      // Una sessione già aperta (es. di ritorno da plex.tv) è ancora valida?
      if (session.get()) {
        try {
          await api('/api/config')
          setAuthenticated(true)
          if (!storage.get(STEP_KEY) || storage.get(STEP_KEY) === 'password') {
            setStep(hasPendingPlexPin('connect') || !data.plexConnected ? 'plex' : null)
          }
        } catch (err) {
          if (!(err instanceof SessionExpiredError)) setError(err.message)
        }
      }
    }
    init()
  }, [loadState, setStep])

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
    // Dispositivo già configurato: si continua solo se manca Plex
    setStep(data && !data.plexConnected ? 'plex' : (storage.get(STEP_KEY) || null))
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
      <PhonePage title="Configurazione iniziale">
        {error ? <p className="phone-error">{error}</p> : <div className="phone-waiting"><div className="spinner" /></div>}
      </PhonePage>
    )
  }

  const stepNumber = STEPS.indexOf(step) + 1
  const subtitle = stepNumber > 0 ? `Passo ${stepNumber} di ${STEPS.length}` : null

  // Primo avvio: si parte dalla creazione della password
  if (step === 'password' && !state.hasPassword) {
    return (
      <PhonePage title="Crea una password" subtitle={subtitle}>
        <p className="phone-hint">
          Servirà ogni volta che vorrai modificare la configurazione di questo dispositivo.
        </p>
        <NewPasswordForm submitLabel="Continua" onSubmit={createPassword} />
      </PhonePage>
    )
  }

  if (!authenticated) {
    return (
      <PhonePage title="Configurazione" subtitle={state.plexConnected ? null : 'Plex da ricollegare'}>
        <PasswordGate canResetPassword={state.canResetPassword} onAuthenticated={handleLoggedIn} />
      </PhonePage>
    )
  }

  if (step === 'plex') {
    // Plex già collegato (es. configurazione precedente): si può tenere
    if (state.plexConnected && !changingPlex && !hasPendingPlexPin('connect')) {
      return (
        <PhonePage title="Accedi a Plex" subtitle={subtitle}>
          <p className="phone-status">Già collegato a {state.plexServerName || 'un server Plex'}</p>
          <div className="phone-block">
            <button className="phone-btn phone-btn-primary" onClick={() => setStep('lastfm')}>Continua</button>
            <button className="phone-btn phone-btn-secondary" onClick={() => setChangingPlex(true)}>
              Ricollega Plex o cambia server
            </button>
          </div>
        </PhonePage>
      )
    }
    return (
      <PhonePage title="Accedi a Plex" subtitle={subtitle}>
        <PlexConnect onConnected={handlePlexConnected} bound={state.canResetPassword} />
      </PhonePage>
    )
  }

  if (step === 'lastfm') {
    return (
      <PhonePage title="Collega Last.fm" subtitle={subtitle}>
        <p className="phone-hint">
          Facoltativo: quando non c'è musica in riproduzione lo schermo mostra i tuoi album più
          ascoltati e l'ultimo brano ascoltato.
        </p>
        <LastfmForm
          initialUsername={state.lastfmUsername}
          hasApiKey={state.hasLastfmApiKey}
          submitLabel="Collega e termina"
          onSaved={finish}
          secondaryAction={
            <button type="button" className="phone-btn phone-btn-secondary" onClick={finish}>
              Salta
            </button>
          }
        />
      </PhonePage>
    )
  }

  if (step === 'done') {
    return (
      <PhonePage title="Configurazione completata">
        <p className="phone-success">✓ Il dispositivo è pronto: lo schermo si aggiorna da solo.</p>
        <p className="phone-hint">
          Per modificare la configurazione in futuro, tocca l'icona ⚙︎ sullo schermo e inquadra il QR code.
        </p>
        <button className="phone-btn phone-btn-secondary" onClick={() => { setStep(null); window.location.href = '/config' }}>
          Apri la configurazione
        </button>
      </PhonePage>
    )
  }

  return (
    <PhonePage title="Dispositivo già configurato">
      <p className="phone-hint">Puoi modificare le impostazioni dalla pagina di configurazione.</p>
      <button className="phone-btn phone-btn-primary" onClick={() => { window.location.href = '/config' }}>
        Apri la configurazione
      </button>
    </PhonePage>
  )
}

export default SetupPage
