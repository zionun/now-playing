import { useState } from 'react'
import { api } from './api'

// Username e API key Last.fm. La API key già salvata non viene mai rimandata
// al browser: se il campo resta vuoto il server usa quella esistente.
const LastfmForm = ({ initialUsername = '', hasApiKey, submitLabel = 'Salva', onSaved, secondaryAction }) => {
  const [username, setUsername] = useState(initialUsername)
  const [apiKey, setApiKey] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState('')

  const handleSubmit = async e => {
    e.preventDefault()
    setError('')
    setSaved('')
    setSaving(true)
    try {
      const result = await api('/api/auth/lastfm', { method: 'POST', body: { username, apiKey } })
      setApiKey('')
      setSaved(result.username ? `Collegato come ${result.username}` : 'Last.fm scollegato')
      onSaved?.(result.username)
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <form className="phone-block" onSubmit={handleSubmit}>
      <label htmlFor="lastfm-username">Username Last.fm</label>
      <input
        id="lastfm-username"
        value={username}
        onChange={e => setUsername(e.target.value)}
        autoCapitalize="none"
        autoCorrect="off"
        autoComplete="username"
      />
      <label htmlFor="lastfm-apikey">API key Last.fm</label>
      <input
        id="lastfm-apikey"
        value={apiKey}
        onChange={e => setApiKey(e.target.value)}
        autoCapitalize="none"
        autoCorrect="off"
        placeholder={hasApiKey ? 'Già configurata (lascia vuoto)' : ''}
      />
      <p className="phone-small">Si ottiene gratis su last.fm/api/account/create</p>
      {error && <p className="phone-error">{error}</p>}
      {saved && <p className="phone-success">{saved}</p>}
      <button type="submit" className="phone-btn phone-btn-primary" disabled={saving}>
        {saving ? 'Verifica...' : submitLabel}
      </button>
      {secondaryAction}
    </form>
  )
}

export default LastfmForm
