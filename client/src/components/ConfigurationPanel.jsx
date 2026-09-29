import React, { useCallback, useEffect, useState } from 'react'
import { api, session, SessionExpiredError, useSessionExpired } from './phone/api'
import PhonePage from './phone/PhonePage'
import PasswordGate, { NewPasswordForm } from './phone/PasswordGate'
import PlexConnect, { hasPendingPlexPin } from './phone/PlexConnect'
import LastfmForm from './phone/LastfmForm'

// Configurazione generale, aperta dal telefono con il QR che il kiosk mostra
// toccando l'icona ⚙︎. Richiede sempre la password del dispositivo.
const ConfigurationPanel = () => {
  const [state, setState] = useState(null)
  const [config, setConfig] = useState(null)
  const [authenticated, setAuthenticated] = useState(false)
  const [error, setError] = useState('')

  const [changingPlex, setChangingPlex] = useState(() => hasPendingPlexPin('connect'))
  const [prefs, setPrefs] = useState(null)
  const [advanced, setAdvanced] = useState({ url: '', port: 32400, token: '' })
  const [prefsMessage, setPrefsMessage] = useState('')
  const [advancedMessage, setAdvancedMessage] = useState('')
  const [passwordMessage, setPasswordMessage] = useState('')
  const [resetPassword, setResetPassword] = useState('')
  const [resetError, setResetError] = useState('')

  useSessionExpired(useCallback(() => setAuthenticated(false), []))

  const handleError = useCallback(err => {
    if (err instanceof SessionExpiredError) {
      setAuthenticated(false)
    }
    setError(err.message)
  }, [])

  const load = useCallback(async () => {
    try {
      const [stateData, configData] = await Promise.all([api('/api/auth/state'), api('/api/config')])
      setState(stateData)
      setConfig(configData)
      setPrefs({
        preferredUser: configData.plex.preferredUser || '',
        showControlsTimeout: configData.display?.showControlsTimeout || 4000,
        enableLastfmIdle: configData.display?.enableLastfmIdle !== false
      })
      setAdvanced({ url: configData.plex.url || '', port: configData.plex.port || 32400, token: '' })
      setAuthenticated(true)
      setError('')
    } catch (err) {
      handleError(err)
    }
  }, [handleError])

  useEffect(() => {
    const init = async () => {
      try {
        const stateData = await api('/api/auth/state')
        setState(stateData)
        if (!stateData.hasPassword) {
          // Mai configurato: si passa dalla configurazione iniziale
          window.location.replace('/setup')
          return
        }
        if (session.get()) await load()
      } catch (err) {
        handleError(err)
      }
    }
    init()
  }, [load, handleError])

  const savePrefs = async e => {
    e.preventDefault()
    setPrefsMessage('')
    try {
      await api('/api/config', {
        method: 'POST',
        body: {
          config: {
            plex: { preferredUser: prefs.preferredUser || null },
            display: {
              showControlsTimeout: prefs.showControlsTimeout,
              enableLastfmIdle: prefs.enableLastfmIdle
            }
          }
        }
      })
      setPrefsMessage('Preferenze salvate')
    } catch (err) {
      handleError(err)
    }
  }

  const saveAdvanced = async e => {
    e.preventDefault()
    setAdvancedMessage('')
    try {
      await api('/api/config', {
        method: 'POST',
        body: { config: { plex: { url: advanced.url, port: advanced.port, token: advanced.token } } }
      })
      setAdvancedMessage('Impostazioni Plex salvate')
      await load()
    } catch (err) {
      handleError(err)
    }
  }

  const testPlexConnection = async () => {
    setAdvancedMessage('')
    try {
      const result = await api('/api/plex/test-connection', {
        method: 'POST',
        body: advanced.token ? advanced : { url: advanced.url, port: advanced.port }
      })
      setAdvancedMessage(`Connessione riuscita: ${result.server}`)
    } catch (err) {
      setAdvancedMessage(`Connessione non riuscita: ${err.message}`)
    }
  }

  const disconnectPlex = async () => {
    if (!window.confirm('Disconnettere Plex? Lo schermo tornerà alla configurazione iniziale.')) return
    try {
      await api('/api/auth/plex/disconnect', { method: 'POST' })
      // Senza Plex il dispositivo non è utilizzabile: si riparte dal setup
      window.location.href = '/setup'
    } catch (err) {
      handleError(err)
    }
  }

  const changePassword = async password => {
    const result = await api('/api/auth/password/change', { method: 'POST', body: { password } })
    session.set(result.session)
    setPasswordMessage('Password aggiornata')
  }

  const resetDevice = async e => {
    e.preventDefault()
    setResetError('')
    if (!window.confirm('Ripristinare il dispositivo? Verranno cancellate tutta la configurazione, la password e il collegamento all\'account Plex.')) return
    try {
      await api('/api/auth/reset-device', { method: 'POST', body: { password: resetPassword } })
      session.clear()
      window.location.href = '/setup'
    } catch (err) {
      if (err instanceof SessionExpiredError) handleError(err)
      else setResetError(err.message)
    }
  }

  const logout = () => {
    session.clear()
    setAuthenticated(false)
  }

  if (!state) {
    return (
      <PhonePage title="Configurazione">
        {error ? <p className="phone-error">{error}</p> : <div className="phone-waiting"><div className="spinner" /></div>}
      </PhonePage>
    )
  }

  if (!authenticated || !config || !prefs) {
    return (
      <PhonePage title="Configurazione">
        <PasswordGate canResetPassword={state.canResetPassword} onAuthenticated={load} />
      </PhonePage>
    )
  }

  return (
    <PhonePage title="Configurazione">
      {error && <p className="phone-error">{error}</p>}

      {/* Plex */}
      <section className="phone-section">
        <h2>Plex</h2>
        {state.plexConnected ? (
          <p className="phone-status">Collegato a {config.plex.serverName || config.plex.url}</p>
        ) : (
          <p className="phone-status off">Non collegato</p>
        )}

        {changingPlex ? (
          <PlexConnect
            bound={state.canResetPassword}
            onConnected={async () => { setChangingPlex(false); await load() }}
            onCancel={() => setChangingPlex(false)}
          />
        ) : (
          <div className="phone-block">
            <button className="phone-btn phone-btn-secondary" onClick={() => setChangingPlex(true)}>
              {state.plexConnected ? 'Ricollega Plex o cambia server' : 'Accedi con Plex'}
            </button>
            {state.plexConnected && (
              <button className="phone-btn phone-btn-danger" onClick={disconnectPlex}>
                Disconnetti Plex
              </button>
            )}
          </div>
        )}
      </section>

      {/* Last.fm */}
      <section className="phone-section">
        <h2>Last.fm</h2>
        {state.lastfmConfigured ? (
          <p className="phone-status">Collegato come {state.lastfmUsername}</p>
        ) : (
          <p className="phone-status off">Non collegato</p>
        )}
        <LastfmForm
          initialUsername={state.lastfmUsername}
          hasApiKey={state.hasLastfmApiKey}
          onSaved={() => load()}
        />
        <p className="phone-small">Per scollegare Last.fm svuota lo username e salva.</p>
      </section>

      {/* Preferenze */}
      <section className="phone-section">
        <h2>Schermo</h2>
        <form className="phone-block" onSubmit={savePrefs}>
          <label htmlFor="preferred-user">Utente Plex preferito (facoltativo)</label>
          <input
            id="preferred-user"
            value={prefs.preferredUser}
            onChange={e => setPrefs({ ...prefs, preferredUser: e.target.value })}
            placeholder="Vuoto = qualsiasi utente"
            autoCapitalize="none"
          />
          <label htmlFor="controls-timeout">Durata dei controlli a schermo (secondi)</label>
          <input
            id="controls-timeout"
            type="number"
            min="1"
            max="10"
            step="0.5"
            value={prefs.showControlsTimeout / 1000}
            onChange={e => setPrefs({ ...prefs, showControlsTimeout: Math.round(parseFloat(e.target.value || 0) * 1000) })}
          />
          <label className="phone-checkbox">
            <input
              type="checkbox"
              checked={prefs.enableLastfmIdle}
              onChange={e => setPrefs({ ...prefs, enableLastfmIdle: e.target.checked })}
            />
            Mostra i dati Last.fm quando non c'è musica
          </label>
          {prefsMessage && <p className="phone-success">{prefsMessage}</p>}
          <button type="submit" className="phone-btn phone-btn-primary">Salva preferenze</button>
        </form>
      </section>

      {/* Password */}
      <section className="phone-section">
        <h2>Password del dispositivo</h2>
        {passwordMessage && <p className="phone-success">{passwordMessage}</p>}
        <NewPasswordForm submitLabel="Cambia password" onSubmit={changePassword} />
      </section>

      {/* Avanzate */}
      <section className="phone-section">
        <details>
          <summary>Avanzate: server Plex manuale</summary>
          <form className="phone-block" onSubmit={saveAdvanced}>
            <p className="phone-small">
              Normalmente non serve: l'accesso con Plex imposta tutto da solo.
            </p>
            <label htmlFor="plex-url">Indirizzo del server</label>
            <input
              id="plex-url"
              value={advanced.url}
              onChange={e => setAdvanced({ ...advanced, url: e.target.value })}
              placeholder="192.168.1.100"
              autoCapitalize="none"
            />
            <label htmlFor="plex-port">Porta</label>
            <input
              id="plex-port"
              type="number"
              min="1"
              max="65535"
              value={advanced.port}
              onChange={e => setAdvanced({ ...advanced, port: parseInt(e.target.value, 10) || '' })}
            />
            <label htmlFor="plex-token">Token Plex</label>
            <input
              id="plex-token"
              type="password"
              value={advanced.token}
              onChange={e => setAdvanced({ ...advanced, token: e.target.value })}
              placeholder={config.plex.token ? 'Lascia vuoto per non cambiarlo' : ''}
            />
            {advancedMessage && <p className="phone-hint">{advancedMessage}</p>}
            <button type="button" className="phone-btn phone-btn-secondary" onClick={testPlexConnection}>
              Testa connessione
            </button>
            <button type="submit" className="phone-btn phone-btn-primary">Salva</button>
          </form>
        </details>
      </section>

      {/* Ripristino */}
      <section className="phone-section">
        <h2>Ripristina dispositivo</h2>
        <form className="phone-block" onSubmit={resetDevice}>
          <p className="phone-small">
            Cancella tutta la configurazione: password, collegamento a Plex (anche l'account
            associato), Last.fm e preferenze. Lo schermo tornerà al QR della configurazione
            iniziale. Serve per esempio per usare un altro account Plex.
          </p>
          <label htmlFor="reset-password">Conferma con la password</label>
          <input
            id="reset-password"
            type="password"
            autoComplete="current-password"
            value={resetPassword}
            onChange={e => setResetPassword(e.target.value)}
            required
          />
          {resetError && <p className="phone-error">{resetError}</p>}
          <button type="submit" className="phone-btn phone-btn-danger">Ripristina dispositivo</button>
        </form>
      </section>

      <button className="phone-link" onClick={logout}>Esci</button>
    </PhonePage>
  )
}

export default ConfigurationPanel
