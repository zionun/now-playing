import { describe, test, expect } from 'vitest'
import { resolveLanguage, translate, errorText, SUPPORTED_LANGUAGES } from './index'
import { messages } from './messages'

const keys = (node, prefix = '') =>
  Object.entries(node).flatMap(([key, value]) =>
    typeof value === 'string' ? [`${prefix}${key}`] : keys(value, `${prefix}${key}.`)
  )

describe('i18n', () => {
  test('every language has exactly the same keys as English', () => {
    const reference = keys(messages.en).sort()
    for (const language of SUPPORTED_LANGUAGES) {
      expect(keys(messages[language]).sort()).toEqual(reference)
    }
  })

  test('resolveLanguage: explicit setting, then device language, then English', () => {
    expect(resolveLanguage('it', ['en-US'])).toBe('it')
    expect(resolveLanguage('auto', ['it-IT', 'en'])).toBe('it')
    expect(resolveLanguage('auto', ['de-DE', 'en-GB'])).toBe('en')
    expect(resolveLanguage('auto', ['fr-FR'])).toBe('en')
    expect(resolveLanguage(undefined, [])).toBe('en')
  })

  test('translate: placeholders and fallbacks', () => {
    expect(translate('it', 'setup.step', { step: 1, total: 3 })).toBe('Passo 1 di 3')
    expect(translate('en', 'setup.step', { step: 2, total: 3 })).toBe('Step 2 of 3')
    expect(translate('xx', 'common.save')).toBe('Save')
    expect(translate('en', 'no.such.key')).toBe('no.such.key')
  })

  test('errorText: translates API error codes, otherwise uses the message', () => {
    const t = (key, params) => translate('it', key, params)
    expect(errorText(t, { code: 'password_too_short', params: { min: 4 } })).toBe(
      'La password deve avere almeno 4 caratteri'
    )
    expect(errorText(t, { code: 'unknown_code', message: 'Something' })).toBe('Something')
    expect(errorText(t, {})).toBe('Errore imprevisto, riprova')
  })
})
