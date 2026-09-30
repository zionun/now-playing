import { describe, test, expect, vi, afterEach } from 'vitest'
import { render, fireEvent, cleanup, act } from '@testing-library/react'
import ScreenSleep from './ScreenSleep'

let context = {}
vi.mock('../context/WebSocketContext', () => ({
  useWebSocket: () => context
}))

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

// A button that reacts on touchstart, like the "resume" play button of the idle screen
const Page = ({ onPress }) => (
  <>
    <button onTouchStart={onPress} onClick={onPress}>
      Play
    </button>
    <ScreenSleep />
  </>
)

describe('ScreenSleep', () => {
  test('nothing over the page while the screen is on', () => {
    context = { screenOn: true, wakeScreen: vi.fn() }
    const { container } = render(<ScreenSleep />)
    expect(container.innerHTML).toBe('')
  })

  test('screen off: a tap only wakes it, even on a button that reacts on touchstart', () => {
    const wakeScreen = vi.fn()
    const press = vi.fn()
    context = { screenOn: false, wakeScreen }
    const { container, getByText } = render(<Page onPress={press} />)
    expect(container.querySelector('.screen-sleep').className).toContain('off')

    // The touch lands on the button itself (as on the device, whatever is on top)
    const button = getByText('Play')
    fireEvent.touchStart(button)
    fireEvent.touchEnd(button)
    fireEvent.click(button)
    expect(wakeScreen).toHaveBeenCalledTimes(1)
    expect(press).not.toHaveBeenCalled()
  })

  test('screen still off: a later tap asks again', () => {
    vi.useFakeTimers()
    const wakeScreen = vi.fn()
    context = { screenOn: false, wakeScreen }
    render(<ScreenSleep />)
    fireEvent.touchStart(document.body)
    act(() => vi.advanceTimersByTime(10 * 60 * 1000))
    fireEvent.touchStart(document.body)
    expect(wakeScreen).toHaveBeenCalledTimes(2)
  })

  test('screen back on: touches stay blocked until the finger has been off for a while', () => {
    vi.useFakeTimers()
    const wakeScreen = vi.fn()
    const press = vi.fn()
    context = { screenOn: false, wakeScreen }
    const { container, getByText, rerender } = render(<Page onPress={press} />)
    const button = getByText('Play')
    fireEvent.touchStart(button)

    // The server confirms: screen on
    context = { screenOn: true, wakeScreen }
    rerender(<Page onPress={press} />)
    expect(container.querySelector('.screen-sleep').className).toContain('waking')

    // A second, impatient tap while the backlight comes on
    act(() => vi.advanceTimersByTime(1000))
    fireEvent.touchStart(button)
    fireEvent.click(button)
    act(() => vi.advanceTimersByTime(1000))
    expect(container.querySelector('.screen-sleep')).not.toBeNull()
    expect(press).not.toHaveBeenCalled()

    act(() => vi.advanceTimersByTime(1000))
    expect(container.querySelector('.screen-sleep')).toBeNull()
    fireEvent.touchStart(button)
    expect(press).toHaveBeenCalledTimes(1)
  })

  test('screen on: touches postpone the sleep, at most every 15 seconds', () => {
    const wakeScreen = vi.fn()
    context = { screenOn: true, wakeScreen }
    render(<ScreenSleep />)
    fireEvent.pointerDown(document.body)
    fireEvent.pointerDown(document.body)
    expect(wakeScreen).toHaveBeenCalledTimes(1)
  })
})
