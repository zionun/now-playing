import { useEffect } from 'react'

// Chiamate delle pagine aperte dal telefono (/setup, /config). La sessione
// ottenuta con la password vive in sessionStorage: sopravvive al passaggio
// su plex.tv per il login, ma non resta sul telefono dopo aver chiuso la scheda.
const SESSION_KEY = 'nowPlayingConfigSession'

const storage = {
  get(key) {
    try { return sessionStorage.getItem(key) } catch { return null }
  },
  set(key, value) {
    try { sessionStorage.setItem(key, value) } catch { /* modalità privata */ }
  },
  remove(key) {
    try { sessionStorage.removeItem(key) } catch { /* modalità privata */ }
  }
}

export const session = {
  get: () => storage.get(SESSION_KEY),
  set: token => storage.set(SESSION_KEY, token),
  clear: () => storage.remove(SESSION_KEY)
}

export { storage }

export class SessionExpiredError extends Error {}

export const SESSION_EXPIRED_EVENT = 'nowplaying:session-expired'

export function useSessionExpired(onExpired) {
  useEffect(() => {
    window.addEventListener(SESSION_EXPIRED_EVENT, onExpired)
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, onExpired)
  }, [onExpired])
}

export async function api(path, { method = 'GET', body } = {}) {
  const headers = { 'Content-Type': 'application/json' }
  const token = session.get()
  if (token) headers['X-Config-Session'] = token

  let response
  try {
    response = await fetch(path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body)
    })
  } catch {
    // Errore di rete (Safari: "Load failed"): messaggio comprensibile
    throw new Error('Impossibile contattare il dispositivo, controlla la rete e riprova')
  }
  const data = await response.json().catch(() => ({}))

  if (response.status === 401 && data.sessionExpired) {
    session.clear()
    // Le pagine tornano alla richiesta della password
    window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT))
    throw new SessionExpiredError(data.error)
  }
  if (!response.ok) {
    throw new Error(data.error || 'Errore imprevisto, riprova')
  }
  return data
}
