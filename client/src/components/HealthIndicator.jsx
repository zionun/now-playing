import { useEffect, useState } from 'react'
import { useWebSocket } from '../context/WebSocketContext'
import { useT } from '../i18n'
import './HealthIndicator.css'

// Discreet indicator: it appears only when something is wrong (Plex not
// reachable, updates by polling instead of real time, Last.fm not
// reachable). Tapping it shows the details for a few seconds.
const describe = (health, t) => {
  const problems = []
  if (health.plex === 'unreachable') problems.push(t('health.plexUnreachable'))
  else if (health.plex === 'polling') problems.push(t('health.plexPolling'))
  if (health.lastfm === 'unreachable') problems.push(t('health.lastfmUnreachable'))
  return problems
}

const HealthIndicator = () => {
  const t = useT()
  const { health, connectionStatus } = useWebSocket()
  const [expanded, setExpanded] = useState(false)

  useEffect(() => {
    if (!expanded) return undefined
    const timer = setTimeout(() => setExpanded(false), 5000)
    return () => clearTimeout(timer)
  }, [expanded])

  // Without a connection to the server the screen already shows its own message
  if (!health || connectionStatus !== 'connected') return null
  const problems = describe(health, t)
  if (problems.length === 0) return null

  const toggle = e => {
    e.stopPropagation()
    e.preventDefault()
    setExpanded(v => !v)
  }

  return (
    <button
      className={`health-indicator ${health.status === 'error' ? 'error' : 'degraded'}`}
      onClick={toggle}
      onTouchEnd={toggle}
      aria-label={problems.join('. ')}
    >
      <span className="health-dot" />
      {expanded && <span className="health-text">{problems.join(' · ')}</span>}
    </button>
  )
}

export default HealthIndicator
