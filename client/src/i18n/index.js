import { createContext, useCallback, useContext } from 'react'
import { messages, LANGUAGE_NAMES } from './messages'

export { LANGUAGE_NAMES }
export const SUPPORTED_LANGUAGES = Object.keys(messages)
const FALLBACK_LANGUAGE = 'en'

// "auto" (or an unknown value) follows the language of the device showing the
// page: the kiosk and the phone can each use their own.
export function resolveLanguage(setting, browserLanguages = navigatorLanguages()) {
  if (SUPPORTED_LANGUAGES.includes(setting)) return setting
  for (const language of browserLanguages) {
    const base = String(language || '')
      .slice(0, 2)
      .toLowerCase()
    if (SUPPORTED_LANGUAGES.includes(base)) return base
  }
  return FALLBACK_LANGUAGE
}

function navigatorLanguages() {
  if (typeof navigator === 'undefined') return []
  return navigator.languages?.length ? navigator.languages : [navigator.language]
}

const lookup = (language, key) => key.split('.').reduce((node, part) => node?.[part], messages[language])

export function translate(language, key, params = {}) {
  const text = lookup(language, key) ?? lookup(FALLBACK_LANGUAGE, key)
  if (typeof text !== 'string') return key
  return text.replace(/\{(\w+)\}/g, (match, name) => (params[name] !== undefined ? params[name] : match))
}

export const LanguageContext = createContext(null)

// t('section.key', { name: value })
export function useT() {
  const contextLanguage = useContext(LanguageContext)
  const language = contextLanguage || resolveLanguage('auto')
  return useCallback((key, params) => translate(language, key, params), [language])
}

// Text for an error: API errors carry a code (see server/src/lib/errors.js)
// translated here; otherwise the error's own message.
export function errorText(t, error) {
  if (error?.code) {
    const key = `errors.${error.code}`
    const text = t(key, error.params)
    if (text !== key) return text
  }
  return error?.message || t('errors.unexpected')
}
