import { useEffect } from 'react'
import { useT } from '../../i18n'
import './phone.css'

// Container of the pages opened on the phone: unlike the kiosk, the page must
// scroll and its text fields must be selectable.
const PhonePage = ({ title, subtitle, children }) => {
  const t = useT()

  useEffect(() => {
    const previous = document.body.style.overflow
    document.body.style.overflow = 'auto'
    document.documentElement.style.overflow = 'auto'
    return () => {
      document.body.style.overflow = previous
      document.documentElement.style.overflow = previous
    }
  }, [])

  return (
    <div className="phone-page">
      <main className="phone-main">
        {subtitle && <p className="phone-step">{subtitle}</p>}
        {title && <h1>{title}</h1>}
        {children}
        <p className="phone-version">{t('common.version', { version: __BUILD_TIME__ })}</p>
      </main>
    </div>
  )
}

export default PhonePage
