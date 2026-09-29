import React, { useEffect } from 'react'
import './phone.css'

// Contenitore delle pagine aperte dal telefono: a differenza del kiosk qui
// la pagina deve poter scorrere e i campi di testo essere selezionabili.
const PhonePage = ({ title, subtitle, children }) => {
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
        <p className="phone-version">Versione {__BUILD_TIME__}</p>
      </main>
    </div>
  )
}

export default PhonePage
