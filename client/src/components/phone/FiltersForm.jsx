import React, { useCallback, useEffect, useState } from 'react'
import { api } from './api'

// Filtri su LAN, utente e player. Una lista vuota significa "tutti": per
// chiarezza l'interfaccia lo mostra come scelta esplicita tra "Tutti" e
// "Solo quelli selezionati".
const ChoiceList = ({ name, allLabel, someLabel, items, selected, onChange, getId, renderItem, emptyText }) => {
  const [restricted, setRestricted] = useState(selected.length > 0)

  useEffect(() => {
    if (selected.length > 0) setRestricted(true)
  }, [selected.length])

  const toggle = id => {
    onChange(selected.includes(id) ? selected.filter(x => x !== id) : [...selected, id])
  }

  return (
    <div className="phone-block">
      <label className="phone-checkbox">
        <input
          type="radio"
          name={name}
          checked={!restricted}
          onChange={() => { setRestricted(false); onChange([]) }}
        />
        {allLabel}
      </label>
      <label className="phone-checkbox">
        <input type="radio" name={name} checked={restricted} onChange={() => setRestricted(true)} />
        {someLabel}
      </label>
      {restricted && (
        <div className="phone-choice-list">
          {items.length === 0 && <p className="phone-small">{emptyText}</p>}
          {items.map(item => {
            const id = getId(item)
            return (
              <label key={id} className="phone-checkbox">
                <input type="checkbox" checked={selected.includes(id)} onChange={() => toggle(id)} />
                {renderItem(item)}
              </label>
            )
          })}
          {selected.length === 0 && (
            <p className="phone-small">Nessuna selezione: verranno mostrati tutti.</p>
          )}
        </div>
      )}
    </div>
  )
}

const FiltersForm = ({ initialFilters, onError }) => {
  const [filters, setFilters] = useState({
    lanOnly: !!initialFilters?.lanOnly,
    users: initialFilters?.users || [],
    players: initialFilters?.players || []
  })
  const [options, setOptions] = useState(null)
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')

  const loadOptions = useCallback(async () => {
    setLoading(true)
    try {
      setOptions(await api('/api/config/filter-options'))
    } catch (err) {
      onError(err)
    } finally {
      setLoading(false)
    }
  }, [onError])

  useEffect(() => { loadOptions() }, [loadOptions])

  const update = changes => {
    setFilters(prev => ({ ...prev, ...changes }))
    setMessage('')
  }

  const save = async e => {
    e.preventDefault()
    setMessage('')
    try {
      await api('/api/config', { method: 'POST', body: { config: { filters } } })
      setMessage('Filtri salvati: lo schermo si aggiorna subito')
    } catch (err) {
      onError(err)
    }
  }

  return (
    <form className="phone-block" onSubmit={save}>
      <p className="phone-small">
        Le sessioni escluse non compaiono mai sullo schermo: né in riproduzione, né in pausa,
        né nella scelta del player.
      </p>

      <label className="phone-checkbox">
        <input
          type="checkbox"
          checked={filters.lanOnly}
          onChange={e => update({ lanOnly: e.target.checked })}
        />
        Solo player sulla rete locale
      </label>
      <p className="phone-small">Esclude chi ascolta da fuori casa (es. dal telefono in mobilità).</p>

      <h3>Utenti</h3>
      {options ? (
        <ChoiceList
          name="users-mode"
          allLabel="Tutti gli utenti"
          someLabel="Solo gli utenti selezionati"
          items={options.users}
          selected={filters.users}
          onChange={users => update({ users })}
          getId={user => user.id}
          renderItem={user => user.title}
          emptyText="Nessun utente trovato sul server Plex."
        />
      ) : (
        <div className="phone-waiting"><div className="spinner" /> Caricamento...</div>
      )}

      <h3>Player</h3>
      {options ? (
        <ChoiceList
          name="players-mode"
          allLabel="Tutti i player"
          someLabel="Solo i player selezionati"
          items={options.players}
          selected={filters.players}
          onChange={players => update({ players })}
          getId={player => player.machineIdentifier}
          renderItem={player => (
            <span>
              {player.title}
              {player.product && player.product !== player.title && (
                <span className="phone-small"> · {player.product}</span>
              )}
            </span>
          )}
          emptyText="Nessun player trovato. Avvia la riproduzione su un player e aggiorna l'elenco."
        />
      ) : null}

      <button type="button" className="phone-link" onClick={loadOptions} disabled={loading}>
        {loading ? 'Aggiornamento...' : 'Aggiorna elenchi'}
      </button>

      {message && <p className="phone-success">{message}</p>}
      <button type="submit" className="phone-btn phone-btn-primary">Salva filtri</button>
    </form>
  )
}

export default FiltersForm
