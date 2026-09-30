import { useCallback, useEffect, useState } from 'react'
import { api, session, SessionExpiredError, useSessionExpired } from './phone/api'
import PhonePage from './phone/PhonePage'
import PasswordGate, { NewPasswordForm } from './phone/PasswordGate'
import PlexConnect, { hasPendingPlexPin } from './phone/PlexConnect'
import LastfmForm from './phone/LastfmForm'
import FiltersForm from './phone/FiltersForm'
import { errorText, useT, SUPPORTED_LANGUAGES, LANGUAGE_NAMES } from '../i18n'

// General settings, opened on the phone from the QR code the kiosk shows when
// the ⚙︎ icon is tapped. Always asks for the device password.
const ConfigurationPanel = () => {
  const t = useT()
  const [state, setState] = useState(null)
  const [config, setConfig] = useState(null)
  const [authenticated, setAuthenticated] = useState(false)
  const [error, setError] = useState('')

  const [changingPlex, setChangingPlex] = useState(() => hasPendingPlexPin('connect'))
  const [prefs, setPrefs] = useState(null)
  const [advanced, setAdvanced] = useState({ url: '', port: 32400, token: '' })
  // Messages are kept as { key, params } so they follow a language change
  const [prefsMessage, setPrefsMessage] = useState(null)
  const [advancedMessage, setAdvancedMessage] = useState(null)
  const [passwordMessage, setPasswordMessage] = useState(null)
  const [resetPassword, setResetPassword] = useState('')
  const [resetError, setResetError] = useState('')

  useSessionExpired(useCallback(() => setAuthenticated(false), []))

  const handleError = useCallback(
    err => {
      if (err instanceof SessionExpiredError) {
        setAuthenticated(false)
      }
      setError(errorText(t, err))
    },
    [t]
  )

  const load = useCallback(async () => {
    try {
      const [stateData, configData] = await Promise.all([api('/api/auth/state'), api('/api/config')])
      setState(stateData)
      setConfig(configData)
      setPrefs({
        showControlsTimeout: configData.display?.showControlsTimeout || 4000,
        enableLastfmIdle: configData.display?.enableLastfmIdle !== false,
        language: configData.display?.language || 'auto'
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
          // Never set up: go through the initial setup
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
    setPrefsMessage(null)
    try {
      await api('/api/config', { method: 'POST', body: { config: { display: prefs } } })
      setPrefsMessage({ key: 'settings.prefsSaved' })
    } catch (err) {
      handleError(err)
    }
  }

  const saveAdvanced = async e => {
    e.preventDefault()
    setAdvancedMessage(null)
    try {
      await api('/api/config', {
        method: 'POST',
        body: { config: { plex: { url: advanced.url, port: advanced.port, token: advanced.token } } }
      })
      setAdvancedMessage({ key: 'settings.plexSaved' })
      await load()
    } catch (err) {
      handleError(err)
    }
  }

  const testPlexConnection = async () => {
    setAdvancedMessage(null)
    try {
      const result = await api('/api/plex/test-connection', {
        method: 'POST',
        body: advanced.token ? advanced : { url: advanced.url, port: advanced.port }
      })
      setAdvancedMessage({ key: 'settings.testOk', params: { server: result.server } })
    } catch (err) {
      setAdvancedMessage({ key: 'settings.testFailed', params: { error: errorText(t, err) } })
    }
  }

  const disconnectPlex = async () => {
    if (!window.confirm(t('settings.disconnectConfirm'))) return
    try {
      await api('/api/auth/plex/disconnect', { method: 'POST' })
      // Without Plex the device can't be used: start over from the setup
      window.location.href = '/setup'
    } catch (err) {
      handleError(err)
    }
  }

  const changePassword = async password => {
    const result = await api('/api/auth/password/change', { method: 'POST', body: { password } })
    session.set(result.session)
    setPasswordMessage({ key: 'settings.passwordUpdated' })
  }

  const resetDevice = async e => {
    e.preventDefault()
    setResetError('')
    if (!window.confirm(t('settings.resetConfirm'))) return
    try {
      await api('/api/auth/reset-device', { method: 'POST', body: { password: resetPassword } })
      session.clear()
      window.location.href = '/setup'
    } catch (err) {
      if (err instanceof SessionExpiredError) handleError(err)
      else setResetError(errorText(t, err))
    }
  }

  const logout = () => {
    session.clear()
    setAuthenticated(false)
  }

  if (!state) {
    return (
      <PhonePage title={t('settings.title')}>
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

  if (!authenticated || !config || !prefs) {
    return (
      <PhonePage title={t('settings.title')}>
        <PasswordGate canResetPassword={state.canResetPassword} onAuthenticated={load} />
      </PhonePage>
    )
  }

  return (
    <PhonePage title={t('settings.title')}>
      {error && <p className="phone-error">{error}</p>}

      {/* Plex */}
      <section className="phone-section">
        <h2>Plex</h2>
        {state.plexConnected ? (
          <p className="phone-status">
            {t('settings.connectedTo', { server: config.plex.serverName || config.plex.url })}
          </p>
        ) : (
          <p className="phone-status off">{t('settings.notConnected')}</p>
        )}

        {changingPlex ? (
          <PlexConnect
            bound={state.canResetPassword}
            onConnected={async () => {
              setChangingPlex(false)
              await load()
            }}
            onCancel={() => setChangingPlex(false)}
          />
        ) : (
          <div className="phone-block">
            <button className="phone-btn phone-btn-secondary" onClick={() => setChangingPlex(true)}>
              {state.plexConnected ? t('settings.reconnectOrChange') : t('common.loginWithPlex')}
            </button>
            {state.plexConnected && (
              <button className="phone-btn phone-btn-danger" onClick={disconnectPlex}>
                {t('settings.disconnect')}
              </button>
            )}
          </div>
        )}
      </section>

      {/* Last.fm */}
      <section className="phone-section">
        <h2>Last.fm</h2>
        {state.lastfmConfigured ? (
          <p className="phone-status">{t('lastfm.connectedAs', { username: state.lastfmUsername })}</p>
        ) : (
          <p className="phone-status off">{t('settings.notConnected')}</p>
        )}
        <LastfmForm
          initialUsername={state.lastfmUsername}
          hasApiKey={state.hasLastfmApiKey}
          onSaved={() => load()}
        />
        <p className="phone-small">{t('settings.lastfmUnlinkHint')}</p>
      </section>

      {/* Filters */}
      <section className="phone-section">
        <h2>{t('settings.filtersTitle')}</h2>
        <FiltersForm initialFilters={config.filters} onError={handleError} />
      </section>

      {/* Screen */}
      <section className="phone-section">
        <h2>{t('settings.screenTitle')}</h2>
        <form className="phone-block" onSubmit={savePrefs}>
          <label htmlFor="language">{t('settings.language')}</label>
          <select
            id="language"
            value={prefs.language}
            onChange={e => setPrefs({ ...prefs, language: e.target.value })}
          >
            <option value="auto">{t('settings.languageAuto')}</option>
            {SUPPORTED_LANGUAGES.map(language => (
              <option key={language} value={language}>
                {LANGUAGE_NAMES[language]}
              </option>
            ))}
          </select>
          <label htmlFor="controls-timeout">{t('settings.controlsDuration')}</label>
          <input
            id="controls-timeout"
            type="number"
            min="1"
            max="10"
            step="0.5"
            value={prefs.showControlsTimeout / 1000}
            onChange={e =>
              setPrefs({ ...prefs, showControlsTimeout: Math.round(parseFloat(e.target.value || 0) * 1000) })
            }
          />
          <label className="phone-checkbox">
            <input
              type="checkbox"
              checked={prefs.enableLastfmIdle}
              onChange={e => setPrefs({ ...prefs, enableLastfmIdle: e.target.checked })}
            />
            {t('settings.showLastfm')}
          </label>
          {prefsMessage && <p className="phone-success">{t(prefsMessage.key, prefsMessage.params)}</p>}
          <button type="submit" className="phone-btn phone-btn-primary">
            {t('settings.savePrefs')}
          </button>
        </form>
      </section>

      {/* Password */}
      <section className="phone-section">
        <h2>{t('settings.passwordTitle')}</h2>
        {passwordMessage && <p className="phone-success">{t(passwordMessage.key, passwordMessage.params)}</p>}
        <NewPasswordForm submitLabel={t('settings.changePassword')} onSubmit={changePassword} />
      </section>

      {/* Advanced */}
      <section className="phone-section">
        <details>
          <summary>{t('settings.advancedSummary')}</summary>
          <form className="phone-block" onSubmit={saveAdvanced}>
            <p className="phone-small">{t('settings.advancedHint')}</p>
            <label htmlFor="plex-url">{t('settings.serverAddress')}</label>
            <input
              id="plex-url"
              value={advanced.url}
              onChange={e => setAdvanced({ ...advanced, url: e.target.value })}
              placeholder="192.168.1.100"
              autoCapitalize="none"
            />
            <label htmlFor="plex-port">{t('settings.port')}</label>
            <input
              id="plex-port"
              type="number"
              min="1"
              max="65535"
              value={advanced.port}
              onChange={e => setAdvanced({ ...advanced, port: parseInt(e.target.value, 10) || '' })}
            />
            <label htmlFor="plex-token">{t('settings.token')}</label>
            <input
              id="plex-token"
              type="password"
              value={advanced.token}
              onChange={e => setAdvanced({ ...advanced, token: e.target.value })}
              placeholder={config.plex.token ? t('settings.tokenKeep') : ''}
            />
            {advancedMessage && (
              <p className="phone-hint">{t(advancedMessage.key, advancedMessage.params)}</p>
            )}
            <button type="button" className="phone-btn phone-btn-secondary" onClick={testPlexConnection}>
              {t('settings.testConnection')}
            </button>
            <button type="submit" className="phone-btn phone-btn-primary">
              {t('common.save')}
            </button>
          </form>
        </details>
      </section>

      {/* Reset */}
      <section className="phone-section">
        <h2>{t('settings.resetTitle')}</h2>
        <form className="phone-block" onSubmit={resetDevice}>
          <p className="phone-small">{t('settings.resetDescription')}</p>
          <label htmlFor="reset-password">{t('settings.resetConfirmLabel')}</label>
          <input
            id="reset-password"
            type="password"
            autoComplete="current-password"
            value={resetPassword}
            onChange={e => setResetPassword(e.target.value)}
            required
          />
          {resetError && <p className="phone-error">{resetError}</p>}
          <button type="submit" className="phone-btn phone-btn-danger">
            {t('settings.resetTitle')}
          </button>
        </form>
      </section>

      <button className="phone-link" onClick={logout}>
        {t('settings.logout')}
      </button>
    </PhonePage>
  )
}

export default ConfigurationPanel
