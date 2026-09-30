import { useEffect, useRef, useState } from 'react'
import { useWebSocket } from '../context/WebSocketContext'
import './ScreenSleep.css'

// Once the screen is back on, touches are still blocked until the finger has
// been off the screen for this long: the rest of the waking tap (touchend,
// the click the browser makes from it) or a second impatient tap while the
// backlight comes on must not reach a button underneath
const GUARD_MS = 1200
// Taps while the screen is on only postpone its sleep: no need to tell the
// server about every single one
const ACTIVITY_THROTTLE_MS = 15000

const BLOCKED_EVENTS = [
  'touchstart',
  'touchmove',
  'touchend',
  'pointerdown',
  'pointerup',
  'mousedown',
  'mouseup',
  'click',
  'contextmenu'
]
const PRESS_EVENTS = new Set(['touchstart', 'pointerdown', 'mousedown'])

// While the screen is off (backlight off, or black on displays without
// backlight control) every touch is stopped before it reaches the page: the
// first one only turns the screen on, it never presses what is underneath.
// The listeners sit on window, in the capture phase and not passive, so no
// component handler (onTouchStart included) can see the event first and
// preventDefault also cancels the mouse events the browser makes from a tap.
const ScreenSleep = () => {
  const { screenOn, wakeScreen } = useWebSocket()
  const [guard, setGuard] = useState(false)
  const lastBlocked = useRef(0)
  const lastActivity = useRef(0)
  const blocking = !screenOn || guard

  // Screen off: from now on block touches until the guard expires
  useEffect(() => {
    if (!screenOn) setGuard(true)
  }, [screenOn])

  useEffect(() => {
    if (!blocking) return undefined
    const block = e => {
      if (e.cancelable) e.preventDefault()
      e.stopPropagation()
      e.stopImmediatePropagation()
      lastBlocked.current = Date.now()
      // Every press while the screen is off asks again: a lost request is
      // simply retried by the next tap
      if (!screenOn && PRESS_EVENTS.has(e.type)) {
        const now = Date.now()
        if (now - lastActivity.current > 300) {
          lastActivity.current = now
          wakeScreen()
        }
      }
    }
    const options = { capture: true, passive: false }
    BLOCKED_EVENTS.forEach(type => window.addEventListener(type, block, options))
    return () => BLOCKED_EVENTS.forEach(type => window.removeEventListener(type, block, options))
  }, [blocking, screenOn, wakeScreen])

  // Screen back on: lift the guard once touches have stopped for GUARD_MS
  useEffect(() => {
    if (!screenOn || !guard) return undefined
    const onAt = Date.now()
    let timer
    const check = () => {
      const quietSince = Math.max(onAt, lastBlocked.current)
      const left = quietSince + GUARD_MS - Date.now()
      if (left <= 0) setGuard(false)
      else timer = setTimeout(check, left)
    }
    timer = setTimeout(check, GUARD_MS)
    return () => clearTimeout(timer)
  }, [screenOn, guard])

  // Screen on: any touch postpones the sleep
  useEffect(() => {
    if (blocking) return undefined
    const onActivity = () => {
      const now = Date.now()
      if (now - lastActivity.current < ACTIVITY_THROTTLE_MS) return
      lastActivity.current = now
      wakeScreen()
    }
    document.addEventListener('pointerdown', onActivity, true)
    return () => document.removeEventListener('pointerdown', onActivity, true)
  }, [blocking, wakeScreen])

  if (!blocking) return null
  return <div className={`screen-sleep ${screenOn ? 'waking' : 'off'}`} aria-hidden="true" />
}

export default ScreenSleep
