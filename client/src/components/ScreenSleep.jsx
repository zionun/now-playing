import { useEffect, useRef, useState } from 'react'
import { useWebSocket } from '../context/WebSocketContext'
import './ScreenSleep.css'

// After the first tap the layer stays (transparent) for a moment, so the
// touchend/click of that same tap can't reach a button underneath
const GUARD_MS = 700
// Taps while the screen is on only postpone its sleep: no need to tell the
// server about every single one
const ACTIVITY_THROTTLE_MS = 15000

// While the screen is off (backlight off, or black on displays without
// backlight control) a layer over everything catches touches: the first tap
// only turns the screen on, it never presses what is underneath.
const ScreenSleep = () => {
  const { screenOn, wakeScreen } = useWebSocket()
  const [guard, setGuard] = useState(false)
  const lastActivity = useRef(0)

  useEffect(() => {
    if (!guard) return undefined
    const timer = setTimeout(() => setGuard(false), GUARD_MS)
    return () => clearTimeout(timer)
  }, [guard])

  // Screen on: any touch postpones the sleep
  useEffect(() => {
    if (!screenOn) return undefined
    const onActivity = () => {
      const now = Date.now()
      if (now - lastActivity.current < ACTIVITY_THROTTLE_MS) return
      lastActivity.current = now
      wakeScreen()
    }
    document.addEventListener('pointerdown', onActivity, true)
    return () => document.removeEventListener('pointerdown', onActivity, true)
  }, [screenOn, wakeScreen])

  if (screenOn && !guard) return null

  const swallow = e => {
    e.preventDefault()
    e.stopPropagation()
    if (!screenOn && !guard) {
      setGuard(true)
      lastActivity.current = Date.now()
      wakeScreen()
    }
  }

  return (
    <div
      className={`screen-sleep ${screenOn ? 'waking' : 'off'}`}
      aria-hidden="true"
      onTouchStart={swallow}
      onTouchEnd={swallow}
      onMouseDown={swallow}
      onClick={swallow}
    />
  )
}

export default ScreenSleep
