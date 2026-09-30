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

describe('ScreenSleep', () => {
  test('nothing over the page while the screen is on', () => {
    context = { screenOn: true, wakeScreen: vi.fn() }
    const { container } = render(<ScreenSleep />)
    expect(container.innerHTML).toBe('')
  })

  test('screen off: the first tap only wakes it, the button underneath is not pressed', () => {
    const wakeScreen = vi.fn()
    const buttonClick = vi.fn()
    context = { screenOn: false, wakeScreen }
    const { container } = render(
      <>
        <button onClick={buttonClick}>Play</button>
        <ScreenSleep />
      </>
    )
    const layer = container.querySelector('.screen-sleep')
    expect(layer.className).toContain('off')

    fireEvent.touchStart(layer)
    fireEvent.touchEnd(layer)
    fireEvent.click(layer)
    expect(wakeScreen).toHaveBeenCalledTimes(1)
    expect(buttonClick).not.toHaveBeenCalled()
  })

  test('after waking up the layer stays briefly (transparent), then goes away', () => {
    vi.useFakeTimers()
    const wakeScreen = vi.fn()
    context = { screenOn: false, wakeScreen }
    const { container, rerender } = render(<ScreenSleep />)
    fireEvent.touchStart(container.querySelector('.screen-sleep'))

    // The server confirms: screen on
    context = { screenOn: true, wakeScreen }
    rerender(<ScreenSleep />)
    expect(container.querySelector('.screen-sleep').className).toContain('waking')

    act(() => vi.advanceTimersByTime(800))
    expect(container.querySelector('.screen-sleep')).toBeNull()
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
