import { useEffect, useState } from 'react'
import { useWebSocket } from '../context/WebSocketContext'
import './HealthIndicator.css'

// Indicatore discreto: compare solo se qualcosa non va (Plex irraggiungibile,
// aggiornamenti in polling invece che in tempo reale, Last.fm non
// raggiungibile). Toccandolo mostra il dettaglio per qualche secondo.
const describe = health => {
  const problems = []
  if (health.plex === 'unreachable') problems.push('Server Plex non raggiungibile')
  else if (health.plex === 'polling')
    problems.push('Aggiornamenti Plex rallentati (eventi in tempo reale non disponibili)')
  if (health.lastfm === 'unreachable') problems.push('Last.fm non raggiungibile')
  return problems
}

const HealthIndicator = () => {
  const { health, connectionStatus } = useWebSocket()
  const [expanded, setExpanded] = useState(false)

  useEffect(() => {
    if (!expanded) return undefined
    const timer = setTimeout(() => setExpanded(false), 5000)
    return () => clearTimeout(timer)
  }, [expanded])

  // Senza connessione al server lo schermo mostra già il suo messaggio
  if (!health || connectionStatus !== 'connected') return null
  const problems = describe(health)
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
