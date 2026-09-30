import { useState } from 'react'
import { api } from './api'
import { errorText, useT } from '../../i18n'

// Last.fm username and API key. A saved API key is never sent back to the
// browser: when the field is left empty, the server keeps the existing one.
const LastfmForm = ({ initialUsername = '', hasApiKey, submitLabel, onSaved, secondaryAction }) => {
  const t = useT()
  const [username, setUsername] = useState(initialUsername)
  const [apiKey, setApiKey] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(null) // { key, params }

  const handleSubmit = async e => {
    e.preventDefault()
    setError('')
    setSaved(null)
    setSaving(true)
    try {
      const result = await api('/api/auth/lastfm', { method: 'POST', body: { username, apiKey } })
      setApiKey('')
      setSaved(
        result.username
          ? { key: 'lastfm.connectedAs', params: { username: result.username } }
          : { key: 'lastfm.disconnected' }
      )
      onSaved?.(result.username)
    } catch (err) {
      setError(errorText(t, err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <form className="phone-block" onSubmit={handleSubmit}>
      <label htmlFor="lastfm-username">{t('lastfm.username')}</label>
      <input
        id="lastfm-username"
        value={username}
        onChange={e => setUsername(e.target.value)}
        autoCapitalize="none"
        autoCorrect="off"
        autoComplete="username"
      />
      <label htmlFor="lastfm-apikey">{t('lastfm.apiKey')}</label>
      <input
        id="lastfm-apikey"
        value={apiKey}
        onChange={e => setApiKey(e.target.value)}
        autoCapitalize="none"
        autoCorrect="off"
        placeholder={hasApiKey ? t('lastfm.apiKeyConfigured') : ''}
      />
      <p className="phone-small">{t('lastfm.getKey')}</p>
      {error && <p className="phone-error">{error}</p>}
      {saved && <p className="phone-success">{t(saved.key, saved.params)}</p>}
      <button type="submit" className="phone-btn phone-btn-primary" disabled={saving}>
        {saving ? t('common.checking') : submitLabel || t('common.save')}
      </button>
      {secondaryAction}
    </form>
  )
}

export default LastfmForm
