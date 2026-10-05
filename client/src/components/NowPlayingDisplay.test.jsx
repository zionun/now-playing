import { describe, test, expect, vi, afterEach } from 'vitest'
import { render, fireEvent, cleanup, act } from '@testing-library/react'
import NowPlayingDisplay from './NowPlayingDisplay'

let context
vi.mock('../context/WebSocketContext', () => ({
  useWebSocket: () => context
}))
vi.mock('./LoginScreen', () => ({ ConfigQrButton: () => null }))

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

const playing = (extra = {}) => ({
  connectionStatus: 'connected',
  display: { showControlsTimeout: 4000 },
  sendMediaControl: vi.fn(),
  switchUser: vi.fn(),
  nowPlaying: {
    isPlaying: true,
    isPaused: false,
    hasControls: true,
    track: { title: 'Song', artist: 'Artist', duration: 200000, viewOffset: 1000 },
    ...extra
  }
})

const overlayVisible = container => container.querySelector('.touch-overlay').className.includes('visible')

describe('NowPlayingDisplay controls', () => {
  test('one tap opens them, and the rest of the same tap does not close them', () => {
    context = playing()
    const { container } = render(<NowPlayingDisplay />)
    const screen = container.querySelector('.now-playing-container')

    fireEvent.pointerDown(screen)
    expect(overlayVisible(container)).toBe(true)
    // touchend and the click the browser makes from the tap land on the overlay
    const overlay = container.querySelector('.touch-overlay')
    fireEvent.touchEnd(overlay)
    fireEvent.click(overlay)
    expect(overlayVisible(container)).toBe(true)
  })

  test('they hide after the chosen time; a command restarts the countdown', () => {
    vi.useFakeTimers()
    context = playing()
    const { container, getByLabelText } = render(<NowPlayingDisplay />)
    fireEvent.pointerDown(container.querySelector('.now-playing-container'))

    act(() => vi.advanceTimersByTime(3000))
    fireEvent.pointerDown(getByLabelText('Pause'))
    act(() => vi.advanceTimersByTime(3000))
    expect(overlayVisible(container)).toBe(true)
    act(() => vi.advanceTimersByTime(1000))
    expect(overlayVisible(container)).toBe(false)
  })

  test('paused with the countdown running: a tap opens them, updates every second do not close them', () => {
    vi.useFakeTimers()
    context = playing({ isPlaying: false, isPaused: true, pauseTimeRemaining: 30000 })
    const { container, rerender } = render(<NowPlayingDisplay />)
    fireEvent.pointerDown(container.querySelector('.now-playing-container'))

    for (let left = 29000; left > 26000; left -= 1000) {
      context = playing({ isPlaying: false, isPaused: true, pauseTimeRemaining: left })
      rerender(<NowPlayingDisplay />)
      act(() => vi.advanceTimersByTime(1000))
    }
    expect(overlayVisible(container)).toBe(true)
  })

  test('closed with a tap outside, they open again with the next tap right away', () => {
    context = playing()
    const { container } = render(<NowPlayingDisplay />)
    const screen = container.querySelector('.now-playing-container')
    fireEvent.pointerDown(screen)
    fireEvent.pointerDown(container.querySelector('.touch-overlay'))
    expect(overlayVisible(container)).toBe(false)
    fireEvent.pointerDown(screen)
    expect(overlayVisible(container)).toBe(true)
  })
})
