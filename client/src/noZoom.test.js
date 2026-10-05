import { test, expect, afterEach } from 'vitest'
import { disablePinchZoom } from './noZoom'

let restore
afterEach(() => restore?.())

const dispatch = (type, props = {}) => {
  const event = new Event(type, { cancelable: true, bubbles: true })
  Object.assign(event, props)
  document.body.dispatchEvent(event)
  return event.defaultPrevented
}

test('pinching is cancelled, one-finger scrolling is not', () => {
  restore = disablePinchZoom()
  expect(dispatch('touchmove', { touches: [{}, {}] })).toBe(true)
  expect(dispatch('touchmove', { touches: [{}] })).toBe(false)
  expect(dispatch('gesturestart')).toBe(true)
  expect(dispatch('wheel', { ctrlKey: true })).toBe(true)
  expect(dispatch('wheel', { ctrlKey: false })).toBe(false)
})
