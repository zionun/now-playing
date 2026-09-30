import { useEffect } from 'react'

// Calls from the pages opened on the phone (/setup, /config). The session
// obtained with the password lives in sessionStorage: it survives the trip to
// plex.tv for the login, but doesn't stay on the phone once the tab is closed.
const SESSION_KEY = 'nowPlayingConfigSession'

const storage = {
  get(key) {
    try {
      return sessionStorage.getItem(key)
    } catch {
      return null
    }
  },
  set(key, value) {
    try {
      sessionStorage.setItem(key, value)
    } catch {
      /* private browsing */
    }
  },
  remove(key) {
    try {
      sessionStorage.removeItem(key)
    } catch {
      /* private browsing */
    }
  }
}

export const session = {
  get: () => storage.get(SESSION_KEY),
  set: token => storage.set(SESSION_KEY, token),
  clear: () => storage.remove(SESSION_KEY)
}

export { storage }

// API error: the code (and its params) is translated by errorText() in i18n
export class ApiError extends Error {
  constructor(message, code, params) {
    super(message)
    this.code = code
    this.params = params
  }
}

export class SessionExpiredError extends ApiError {}

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
    // Network error (Safari: "Load failed")
    throw new ApiError('Network error', 'network')
  }
  const data = await response.json().catch(() => ({}))

  if (response.status === 401 && data.sessionExpired) {
    session.clear()
    // The pages go back to asking for the password
    window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT))
    throw new SessionExpiredError(data.error, 'session_expired')
  }
  if (!response.ok) {
    throw new ApiError(
      data.error || 'Unexpected error',
      data.code || (data.error ? undefined : 'unexpected'),
      data.params
    )
  }
  return data
}
