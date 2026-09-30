import { useCallback, useEffect, useState } from 'react'
import { api } from './api'
import { useT } from '../../i18n'

// LAN, user and player filters. An empty list means "all": to make that
// clear, the interface shows an explicit choice between "All" and "Only the
// selected ones".
const ChoiceList = ({
  name,
  allLabel,
  someLabel,
  items,
  selected,
  onChange,
  getId,
  renderItem,
  emptyText
}) => {
  const t = useT()
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
          onChange={() => {
            setRestricted(false)
            onChange([])
          }}
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
          {selected.length === 0 && <p className="phone-small">{t('filters.noneSelected')}</p>}
        </div>
      )}
    </div>
  )
}

const FiltersForm = ({ initialFilters, onError }) => {
  const t = useT()
  const [filters, setFilters] = useState({
    lanOnly: !!initialFilters?.lanOnly,
    users: initialFilters?.users || [],
    players: initialFilters?.players || []
  })
  const [options, setOptions] = useState(null)
  const [loading, setLoading] = useState(false)
  const [saved, setSaved] = useState(false)

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

  useEffect(() => {
    loadOptions()
  }, [loadOptions])

  const update = changes => {
    setFilters(prev => ({ ...prev, ...changes }))
    setSaved(false)
  }

  const save = async e => {
    e.preventDefault()
    setSaved(false)
    try {
      await api('/api/config', { method: 'POST', body: { config: { filters } } })
      setSaved(true)
    } catch (err) {
      onError(err)
    }
  }

  return (
    <form className="phone-block" onSubmit={save}>
      <p className="phone-small">{t('filters.intro')}</p>

      <label className="phone-checkbox">
        <input
          type="checkbox"
          checked={filters.lanOnly}
          onChange={e => update({ lanOnly: e.target.checked })}
        />
        {t('filters.lanOnly')}
      </label>
      <p className="phone-small">{t('filters.lanOnlyHint')}</p>

      <h3>{t('filters.users')}</h3>
      {options ? (
        <ChoiceList
          name="users-mode"
          allLabel={t('filters.allUsers')}
          someLabel={t('filters.someUsers')}
          items={options.users}
          selected={filters.users}
          onChange={users => update({ users })}
          getId={user => user.id}
          renderItem={user => user.title}
          emptyText={t('filters.noUsers')}
        />
      ) : (
        <div className="phone-waiting">
          <div className="spinner" /> {t('common.loading')}
        </div>
      )}

      <h3>{t('filters.players')}</h3>
      {options ? (
        <ChoiceList
          name="players-mode"
          allLabel={t('filters.allPlayers')}
          someLabel={t('filters.somePlayers')}
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
          emptyText={t('filters.noPlayers')}
        />
      ) : null}

      <button type="button" className="phone-link" onClick={loadOptions} disabled={loading}>
        {loading ? t('filters.refreshing') : t('filters.refresh')}
      </button>

      {saved && <p className="phone-success">{t('filters.saved')}</p>}
      <button type="submit" className="phone-btn phone-btn-primary">
        {t('filters.save')}
      </button>
    </form>
  )
}

export default FiltersForm
